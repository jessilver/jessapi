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
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error('API_KEY not configured');
    return res.status(500).json({ error: 'API_KEY not configured on server' });
  }
  const header = req.header('x-api-key');
  if (!header || header !== apiKey) {
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

app.post('/messages/send', async (req: Request, res: Response) => {
  const { id_sessao, numero, texto } = req.body;
  if (!id_sessao || !numero || !texto) {
    return res.status(400).json({ error: 'missing parameters: id_sessao, numero, texto' });
  }
  try {
    const result = await SessionManager.sendMessage(id_sessao, numero, texto);
    res.json({ status: 'sent', result });
  } catch (err: any) {
    console.error('sendMessage error', err);
    res.status(500).json({ error: err?.message || 'failed to send' });
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

// Load command handlers before starting the server
const handler = new CommandHandler();
await handler.loadCommands();
SessionManager.setCommandHandler(handler);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`JessAPI Session Manager listening on ${port}`);
});
