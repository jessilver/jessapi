import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { createHmac } from 'crypto';

// Use global fetch if available (Node 18+). Cast to any to avoid TS lib issues.


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
      } catch (e) {
        console.error('Failed to compute webhook HMAC', e);
      }
    }

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

  listSessions() {
    return Array.from(this.sessions.values()).map(s => ({ id: s.id, status: s.status }));
  }

  async createSession(id: string) {
    if (this.sessions.has(id)) {
      const existing = this.sessions.get(id)!;
      if (existing.status === 'open') return { id, status: 'open' };
      // If exists but not open, attempt cleanup before reconnect
      await this.deleteSession(id);
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
      } else if (connection === 'close') {
        const isLoggedOut = (lastDisconnect?.error as Boom)?.output?.statusCode === DisconnectReason.loggedOut;
        const shouldReconnect = !isLoggedOut;
        session.status = 'close';
        console.log(`[${id}] connection closed. shouldReconnect=${shouldReconnect}`);
        // webhook: disconnected
        const reason = isLoggedOut ? 'loggedOut' : 'closed';
        const error = lastDisconnect?.error ? String(lastDisconnect.error) : undefined;
        void this.sendWebhook('disconnected', { sessionId: id, reason, error });
        if (shouldReconnect) {
          // schedule a reconnect attempt (will clean existing and recreate)
          setTimeout(() => this.createSession(id).catch(console.error), 2000);
        } else {
          session.status = 'loggedOut';
        }
      }
    };

    sock.ev.on('connection.update', connHandler);
    session.unsubscribeConnection = () => { try { sock.ev.off('connection.update', connHandler); } catch (e) {} };

    // messages listener: log and webhook
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      const msg = messages[0];
      const from = msg?.key?.remoteJid;
      const fromNumber = from ? String(from).split('@')[0] : undefined;
      const text = this.extractText(msg) || undefined;
      console.log(`[${id}] 📥 nova mensagem de: ${from} | fromMe: ${msg?.key?.fromMe} | text: ${text}`);
      void this.sendWebhook('message_received', { sessionId: id, from: fromNumber, text });
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

  async deleteSession(id: string) {
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

    const authDir = path.join(process.cwd(), 'auth_sessions', id);
    try {
      // Node 14+ supports rm with recursive; use force
      await fsPromises.rm(authDir, { recursive: true, force: true });
    } catch (e) {
      // best-effort cleanup
    }
  }

  async sendMessage(sessionId: string, to: string, text: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    return session.sock.sendMessage(jid, { text });
  }
}

export default new SessionManager();
