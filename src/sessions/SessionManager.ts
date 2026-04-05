import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
  fetchLatestBaileysVersion,
  jidNormalizedUser
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { createHmac } from 'crypto';
import { CommandHandler } from '../CommandHandler.js';

// Use global fetch if available (Node 18+). Cast to any to avoid TS lib issues.

// Suppress overly-verbose libsignal logs that print full SessionEntry objects
// (these contain private keys). libsignal uses `console.info("Closing session:", session)`
// so we override `console.info` to redact that specific pattern.
const _origConsoleInfo = console.info.bind(console);
console.info = (...args: any[]) => {
  try {
    if (args.length >= 1 && typeof args[0] === 'string' && args[0].startsWith('Closing session')) {
      // Print a safe, redacted message instead of the full session object
      _origConsoleInfo('[libsignal] Closing session (redacted)');
      return;
    }
  } catch (e) {
    // fallthrough to default behavior
  }
  _origConsoleInfo(...args);
};


type SessionStatus = 'connecting' | 'open' | 'close' | 'loggedOut' | 'error';

type Session = {
  id: string;
  sock: any;
  status: SessionStatus;
  lastQr?: string | null;
  unsubscribeConnection?: () => void;
};

export class SessionManager {
  private sessions = new Map<string, Session>();
  private handler?: CommandHandler;
  private sendQueues = new Map<string, Array<{ jid: string; text: string }>>();
  private reconnectBlocks = new Map<string, { until: number; reason: string }>();

  public setCommandHandler(handler: CommandHandler) {
    this.handler = handler;
  }

  private getConflictBlockMs() {
    const fromEnv = Number(process.env.CONFLICT_RECONNECT_BLOCK_MS || 120000);
    if (!Number.isFinite(fromEnv) || fromEnv < 1000) return 120000;
    return fromEnv;
  }

  private setReconnectBlock(id: string, reason: string, durationMs?: number) {
    const ms = durationMs ?? this.getConflictBlockMs();
    this.reconnectBlocks.set(id, { until: Date.now() + ms, reason });
  }

  private getReconnectBlock(id: string) {
    const block = this.reconnectBlocks.get(id);
    if (!block) return null;
    if (block.until <= Date.now()) {
      this.reconnectBlocks.delete(id);
      return null;
    }
    return block;
  }

  // Cleanup socket and in-memory session but DO NOT remove auth files on disk
  private async cleanupSocketOnly(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    try {
      if (session.unsubscribeConnection) session.unsubscribeConnection();
    } catch (e) {}
    try {
      if (session.sock?.end) await session.sock.end();
    } catch (e) {}
    this.sessions.delete(id);
  }

  private async sendWebhook(event: string, payload: any) {
    const url = process.env.WEBHOOK_URL;
    if (!url) return;
    const body = JSON.stringify({ event, payload, ts: new Date().toISOString() });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const secret = process.env.WEBHOOK_SECRET;
    if (secret) {
      try {
        const sig = createHmac('sha256', secret).update(body).digest('hex');
        // prefix with algorithm to make verification explicit
        headers['x-jess-signature'] = `sha256=${sig}`;
        // Log that signature was generated (no secret printed)
        try { console.log(`[Webhook] assinatura gerada para evento ${event}: ${headers['x-jess-signature']}`); } catch (e) {}
      } catch (e) {
        console.error('Failed to compute webhook HMAC', e);
      }
    }

    // Operational log for debugging when a webhook is about to be sent
    try { console.log(`[Webhook] Disparado evento: ${event} -> ${url}`); } catch (e) {}

    try {
      await (globalThis as any).fetch(url, {
        method: 'POST',
        headers,
        body
      });
    } catch (err) {
      console.error('Failed to POST webhook', err);
    }
  }

  private extractText(msg: any): string | null {
    if (!msg?.message) return null;
    const m = msg.message;
    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage?.caption) return m.imageMessage.caption;
    if (m.videoMessage?.caption) return m.videoMessage.caption;
    if (m.buttonsResponseMessage?.selectedButtonId) return m.buttonsResponseMessage.selectedButtonId;
    if (m.listResponseMessage?.singleSelectReply?.selectedRowId) return m.listResponseMessage.singleSelectReply.selectedRowId;
    try { return JSON.stringify(m).slice(0, 200); } catch { return null; }
  }

  private normalizeJidInput(to: string): string {
    const raw = String(to || '').trim();
    if (!raw) throw new Error('Destination number is empty');
    if (raw.includes('@')) return jidNormalizedUser(raw);

    const digits = raw.replace(/\D/g, '');
    if (!digits) throw new Error('Invalid destination number');
    return `${digits}@s.whatsapp.net`;
  }

  // Resolve destination jid to a canonical WhatsApp jid when possible.
  // For plain phone numbers, this also validates if the number exists on WhatsApp.
  private async resolveDestinationJid(sock: any, to: string): Promise<string> {
    const candidate = this.normalizeJidInput(to);
    const domain = candidate.split('@')[1] || '';
    if (domain !== 's.whatsapp.net') return candidate;

    const numberOnly = candidate.split('@')[0];
    if (!sock || typeof sock.onWhatsApp !== 'function') return candidate;

    try {
      const lookup = await sock.onWhatsApp(numberOnly);
      const found = Array.isArray(lookup) ? lookup[0] : undefined;
      if (found && found.exists === false) {
        const err: any = new Error('Destination number is not on WhatsApp');
        err.code = 'NOT_ON_WHATSAPP';
        throw err;
      }
      if (found?.jid) return jidNormalizedUser(found.jid);
    } catch (err: any) {
      if (err?.code === 'NOT_ON_WHATSAPP') throw err;
      console.warn(`[jid] onWhatsApp lookup failed for ${numberOnly}, using fallback jid`);
    }

    return candidate;
  }

  listSessions() {
    return Array.from(this.sessions.values()).map(s => ({ id: s.id, status: s.status }));
  }

  async createSession(id: string) {
    if (this.sessions.has(id)) {
      const existing = this.sessions.get(id)!;
      if (existing.status === 'open') return { id, status: 'open' };
      // If exists but not open, cleanup socket only (preserve auth files) before reconnect
      await this.cleanupSocketOnly(id);
    }

    const block = this.getReconnectBlock(id);
    if (block) {
      const retryAfterSeconds = Math.max(1, Math.ceil((block.until - Date.now()) / 1000));
      console.warn(`[${id}] auto-reconnect blocked (${block.reason}). retry in ${retryAfterSeconds}s`);
      return { id, status: 'blocked', reason: block.reason, retry_after_seconds: retryAfterSeconds };
    }

    const authDir = path.join(process.cwd(), 'auth_sessions', id);
    await fsPromises.mkdir(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      auth: state,
      browser: ['JessAPI', 'Chrome', '1.0.0']
    });

    // Persist credentials on updates
    sock.ev.on('creds.update', saveCreds);

    const session: Session = {
      id,
      sock,
      status: 'connecting',
      lastQr: null,
      unsubscribeConnection: () => {}
    };

    this.sessions.set(id, session);

    // Persistent connection handler (use named handler so we can off() later)
    const connHandler = (update: any) => {
      const { connection, lastDisconnect, qr } = update as any;
      // minimal debug: avoid logging sensitive keys (SessionEntry)
      try {
        const summary: any = { connection, qr: !!qr };
        if (lastDisconnect?.error) {
          summary.lastDisconnect = { message: String(lastDisconnect.error).slice(0, 200) };
        }
        console.log(`[${id}] connection.update ->`, JSON.stringify(summary));
      } catch (e) {
        console.log(`[${id}] connection.update (non-serializable)`);
      }
      if (qr) {
        session.lastQr = qr;
        // webhook: QR generated
        void this.sendWebhook('qr_generated', { sessionId: id, qr });
      }
      if (connection === 'open') {
        session.status = 'open';
        session.lastQr = null;
        console.log(`[${id}] connected`);
        void this.sendWebhook('connected', { sessionId: id });
        // flush any queued messages for this session
        try {
          const q = this.sendQueues.get(id) || [];
          if (q.length > 0) {
            console.log(`[${id}] flushing ${q.length} queued message(s)`);
            (async () => {
              for (const item of q) {
                try {
                  const r = await sock.sendMessage(item.jid, { text: item.text });
                  try { console.log(`[${id}] flushed queued message:`, JSON.stringify(r?.key || r).slice(0,200)); } catch (e) {}
                } catch (err) {
                  console.error(`[${id}] failed to flush queued message`, err);
                }
              }
            })().catch(console.error);
            this.sendQueues.delete(id);
          }
        } catch (e) {
          // swallow
        }
      } else if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const error = lastDisconnect?.error ? String(lastDisconnect.error) : undefined;
        const errorText = String(error || '').toLowerCase();
        const isConflict = statusCode === DisconnectReason.connectionReplaced || /conflict|replaced/i.test(errorText);
        const shouldReconnect = !isLoggedOut && !isConflict;
        session.status = 'close';
        console.log(`[${id}] connection closed. shouldReconnect=${shouldReconnect}`);
        // webhook: disconnected
        const reason = isLoggedOut ? 'loggedOut' : (isConflict ? 'conflict' : 'closed');
        void this.sendWebhook('disconnected', { sessionId: id, reason, error });
        if (isConflict) {
          const blockMs = this.getConflictBlockMs();
          this.setReconnectBlock(id, 'conflict', blockMs);
          session.status = 'error';
          console.warn(`[${id}] conflict detected; auto-reconnect disabled for ${Math.ceil(blockMs / 1000)}s`);
          return;
        }
        if (shouldReconnect) {
          // cleanup socket but preserve auth files, then recreate
          void this.cleanupSocketOnly(id).then(() => setTimeout(() => this.createSession(id).catch(console.error), 2000)).catch(console.error);
        } else {
          session.status = 'loggedOut';
        }
      }
    };

    sock.ev.on('connection.update', connHandler);
    session.unsubscribeConnection = () => { try { sock.ev.off('connection.update', connHandler); } catch (e) {} };

    // messages listener: log, webhook and delegate to CommandHandler if present
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      const msg = messages[0];
      const from = msg?.key?.remoteJid;
      const fromNumber = from ? String(from).split('@')[0] : undefined;
      const text = this.extractText(msg) || undefined;
      console.log(`[${id}] 📥 nova mensagem de: ${from} | fromMe: ${msg?.key?.fromMe} | text: ${text}`);
      void this.sendWebhook('message_received', { sessionId: id, from: fromNumber, text });

      // If a CommandHandler was provided, let it handle commands
      if (this.handler) {
        try {
          await this.handler.handle(sock, msg);
        } catch (err) {
          console.error(`[${id}] Erro no CommandHandler:`, err);
        }
      }
    });

    // Track outgoing/incoming message status updates (ACK progression)
    // Useful to distinguish "created locally" from "accepted/delivered".
    sock.ev.on('messages.update', (updates: any[]) => {
      try {
        for (const u of updates || []) {
          const key = u?.key || {};
          const status = u?.update?.status;
          if (typeof status === 'undefined') continue;
          const remoteJid = key?.remoteJid;
          const idMsg = key?.id;
          const fromMe = Boolean(key?.fromMe);
          console.log(`[${id}] message status update: jid=${remoteJid} id=${idMsg} fromMe=${fromMe} status=${status}`);
          void this.sendWebhook('message_status', {
            sessionId: id,
            remoteJid,
            id: idMsg,
            fromMe,
            status
          });
        }
      } catch (err) {
        console.error(`[${id}] messages.update parse error`, err);
      }
    });

    // Resolve when QR generated or connected, with a fallback timeout
    return await new Promise((resolve) => {
      let resolved = false;
      const onceHandler = (update: any) => {
        if (resolved) return;
        const { connection, qr } = update as any;
        if (qr) {
          resolved = true;
          try { sock.ev.off('connection.update', onceHandler); } catch (e) {}
          resolve({ id, status: 'qr', qr });
        } else if (connection === 'open') {
          resolved = true;
          try { sock.ev.off('connection.update', onceHandler); } catch (e) {}
          resolve({ id, status: 'open' });
        }
      };

      sock.ev.on('connection.update', onceHandler);

      // fallback: return current status after 10s
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        try { sock.ev.off('connection.update', onceHandler); } catch (e) {}
        resolve({ id, status: session.status, qr: session.lastQr });
      }, 10000);
    });
  }

  getSession(id: string) {
    return this.sessions.get(id);
  }

  async deleteSession(id: string, removeAuth = false) {
    const session = this.sessions.get(id);
    if (session) {
      try {
        if (session.unsubscribeConnection) session.unsubscribeConnection();
      } catch (e) {}
      try {
        if (session.sock?.logout) {
          await session.sock.logout();
        } else if (session.sock?.end) {
          await session.sock.end();
        }
      } catch (e) {
        try { if (session.sock?.end) await session.sock.end(); } catch {}
      }
      this.sessions.delete(id);
    }

    this.sendQueues.delete(id);
    this.reconnectBlocks.delete(id);

    if (removeAuth) {
      const authDir = path.join(process.cwd(), 'auth_sessions', id);
      try {
        // Node 14+ supports rm with recursive; use force
        await fsPromises.rm(authDir, { recursive: true, force: true });
      } catch (e) {
        // best-effort cleanup
      }
    }
  }

  async sendMessage(sessionId: string, to: string, text: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    const sock = session.sock as any;
    if (!sock || typeof sock.sendMessage !== 'function') throw new Error('Session socket not ready');
    const jid = await this.resolveDestinationJid(sock, to);

    // Try immediate send whenever the session is logically open.
    // This mirrors command behavior (`!ping`) and avoids false negatives
    // from transport readiness heuristics.
    if (session.status === 'open') {
      try {
        return await sock.sendMessage(jid, { text });
      } catch (err: any) {
        const msg = String(err?.message || err || '');
        const transient = /not connected|connection closed|timed out|stream errored|socket|transport/i.test(msg.toLowerCase());
        if (!transient) {
          console.error(`[${sessionId}] sendMessage non-transient error:`, err);
          throw err;
        }
        console.warn(`[${sessionId}] transient send error, queueing message:`, msg);
      }
    }

    // Fallback: enqueue message for later flush when connection opens
    const queue = this.sendQueues.get(sessionId) || [];
    queue.push({ jid, text });
    this.sendQueues.set(sessionId, queue);
    console.log(`[${sessionId}] message queued (queue length=${queue.length}, status=${session.status})`);
    return { status: 'queued', queued: true, sessionStatus: session.status };
  }

  // Restore sessions found on disk under `auth_sessions`.
  // This schedules `createSession` calls spaced by `delayBetweenMs` to avoid connection spikes.
  async restoreSessionsFromDisk(delayBetweenMs = 500) {
    const authRoot = path.join(process.cwd(), 'auth_sessions');
    try {
      const entries = await fsPromises.readdir(authRoot, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
      if (!dirs || dirs.length === 0) {
        console.log('No auth sessions to restore');
        return;
      }
      console.log(`Found ${dirs.length} auth session(s). Scheduling restore...`);
      dirs.forEach((id, idx) => {
        const delay = idx * delayBetweenMs;
        setTimeout(() => {
          const block = this.getReconnectBlock(id);
          if (block) {
            const retryAfterSeconds = Math.max(1, Math.ceil((block.until - Date.now()) / 1000));
            console.log(`[${id}] restore skipped: blocked (${block.reason}) for ${retryAfterSeconds}s`);
            return;
          }
          if (this.sessions.has(id)) {
            console.log(`[${id}] already in-memory; skipping restore`);
            return;
          }
          console.log(`[${id}] restoring session (scheduled after ${delay}ms)`);
          this.createSession(id).then((res) => {
            try { console.log(`[${id}] restore finished:`, (res && (res as any).status) || res); } catch (e) {}
          }).catch(err => {
            console.error(`[${id}] failed to restore:`, err?.message || err);
          });
        }, delay);
      });
    } catch (err: any) {
      if (err && err.code === 'ENOENT') {
        console.log('auth_sessions directory not found; skipping restore');
        return;
      }
      console.error('Failed to scan auth_sessions for restore', err);
    }
  }

  // Return diagnostic info about a session (best-effort, non-sensitive)
  getSessionInfo(id: string) {
    const session = this.sessions.get(id);
    if (!session) return null;
    const sock = session.sock as any;
    const info: any = { id: session.id, status: session.status };
    const block = this.getReconnectBlock(id);
    if (block) {
      info.reconnectBlocked = {
        reason: block.reason,
        retryAfterMs: Math.max(1, block.until - Date.now())
      };
    }
    try {
      if (sock) {
        info.hasSocket = true;
        // user/jid info (may be in several places depending on baileys version)
        info.user = sock.user || sock.authState?.creds?.me || sock.state?.creds?.me || undefined;
        // ready state if underlying ws exists
        try { info.wsReady = Boolean(sock.ws && sock.ws.readyState === 1); } catch (e) { info.wsReady = undefined; }
        // indicate whether sendMessage function exists
        info.canSend = typeof sock.sendMessage === 'function';
      } else {
        info.hasSocket = false;
      }
    } catch (e) {
      // swallow
    }
    return info;
  }

  // Force reconnect: cleanup in-memory socket and attempt to create session again
  async reconnectSession(id: string) {
    // cleanup only socket in memory
    this.reconnectBlocks.delete(id);
    await this.cleanupSocketOnly(id);
    return await this.createSession(id);
  }
}

export default new SessionManager();
