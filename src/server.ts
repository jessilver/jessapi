import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import SessionManager from './sessions/SessionManager.js';
import { CommandHandler } from './CommandHandler.js';

const app = express();
app.use(cors());
app.use(express.json());

// Simple API key middleware
function apiKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKeyRaw = process.env.API_KEY;
  if (!apiKeyRaw) {
    console.error('API_KEY not configured');
    return res.status(500).json({ error: 'API_KEY not configured on server' });
  }

  // Prefer `x-api-key` but also accept `Authorization: Bearer <key>`
  const headerX = (req.header('x-api-key') || '') as string;
  const headerAuth = (req.header('authorization') || '') as string;
  const headerRaw = headerX || headerAuth || '';

  // normalize: if Authorization: Bearer <token>, extract token
  let incomingKey = headerRaw;
  if (typeof incomingKey === 'string' && incomingKey.toLowerCase().startsWith('bearer ')) {
    incomingKey = incomingKey.slice(7);
  }

  const expectedKey = String(apiKeyRaw);

  // Trim both sides to defend against CRLF / invisible characters
  const incomingKeyTrimmed = (incomingKey || '').trim();
  const expectedKeyTrimmed = (expectedKey || '').trim();

  // Diagnostic logs to help debug 401s
  console.log('--- DEBUG AUTH ---');
  console.log('Header recebido (x-api-key):', req.headers['x-api-key']);
  console.log('Header recebido (authorization):', req.headers['authorization']);
  console.log('Chave esperada (process.env):', process.env.API_KEY);
  console.log('incomingKey (trimmed):', incomingKeyTrimmed);
  console.log('expectedKey (trimmed):', expectedKeyTrimmed);
  console.log('São iguais?', incomingKeyTrimmed === expectedKeyTrimmed);

  if (!incomingKeyTrimmed || incomingKeyTrimmed !== expectedKeyTrimmed) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  return next();
}

// Protect all routes
app.use(apiKeyMiddleware);

app.post('/sessions/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  try {
    const result = await SessionManager.createSession(id);
    // If a QR string is present, include a ready-to-use image URL
    if (result && (result as any).qr) {
      try {
        (result as any).qr_url = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent((result as any).qr)}`;
      } catch (e) {
        // ignore encoding errors
      }
    }
    res.json(result);
  } catch (err: any) {
    console.error('createSession error', err);
    res.status(500).json({ error: err?.message || 'failed to create session' });
  }
});

app.get('/sessions', (req: Request, res: Response) => {
  const sessions = SessionManager.listSessions();
  res.json(sessions);
});

app.get('/sessions/:id/status', (req: Request, res: Response) => {
  const id = req.params.id;
  const session = SessionManager.getSession(id);
  if (!session) return res.status(404).json({ error: 'not found' });
  const response: any = { id, status: session.status, lastQr: session.lastQr || null };
  if (session.lastQr) {
    try {
      response.qr_url = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(session.lastQr)}`;
    } catch (e) {}
  }
  res.json(response);
});

// Diagnostic: get session info
app.get('/sessions/:id/info', (req: Request, res: Response) => {
  const id = req.params.id;
  const info = SessionManager.getSessionInfo(id);
  if (!info) return res.status(404).json({ error: 'not found' });
  res.json(info);
});

// Force reconnect a session (cleanup socket only and recreate)
app.post('/sessions/:id/reconnect', async (req: Request, res: Response) => {
  const id = req.params.id;
  try {
    const result = await SessionManager.reconnectSession(id);
    res.json(result);
  } catch (err: any) {
    console.error('reconnectSession error', err);
    res.status(500).json({ error: err?.message || 'failed to reconnect' });
  }
});

app.post('/messages/send', async (req: Request, res: Response) => {
  const { id_sessao, numero, texto } = req.body;
  if (!id_sessao || !numero || !texto) {
    return res.status(400).json({ error: 'missing parameters: id_sessao, numero, texto' });
  }
  try {
    const result = await SessionManager.sendMessage(id_sessao, numero, texto);
    const queued = Boolean(result && typeof result === 'object' && (result as any).queued);
    if (queued) {
      return res.status(202).json({ status: 'queued', result });
    }
    return res.json({ status: 'sent', result });
  } catch (err: any) {
    console.error('sendMessage error', err);
    const msg = String(err?.message || 'failed to send');
    if (/invalid destination number|destination number is empty|not on whatsapp/i.test(msg.toLowerCase())) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

app.delete('/sessions/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  try {
    const removeAuth = String(req.query.removeAuth || '').toLowerCase() === 'true' || String(req.query.removeAuth || '') === '1';
    await SessionManager.deleteSession(id, removeAuth);
    res.json({ status: 'deleted', removedAuth: removeAuth });
  } catch (err: any) {
    console.error('deleteSession error', err);
    res.status(500).json({ error: err?.message || 'failed to delete' });
  }
});

// Load command handlers and start the server inside an async IIFE
(async () => {
  const handler = new CommandHandler();
  try {
    await handler.loadCommands();
  } catch (e) {
    console.error('Failed to load commands', e);
  }
  SessionManager.setCommandHandler(handler);

  // Attempt to restore any existing auth sessions from disk (non-blocking)
  try {
    SessionManager.restoreSessionsFromDisk();
  } catch (e) {
    console.error('restoreSessionsFromDisk error', e);
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`JessAPI Session Manager listening on ${port}`);
  });
})().catch(err => {
  console.error('Startup error', err);
  process.exit(1);
});
