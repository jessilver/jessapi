import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import SessionManager from './sessions/SessionManager.js';

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
  res.json({ id, status: session.status, lastQr: session.lastQr || null });
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
    await SessionManager.deleteSession(id);
    res.json({ status: 'deleted' });
  } catch (err: any) {
    console.error('deleteSession error', err);
    res.status(500).json({ error: err?.message || 'failed to delete' });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`JessAPI Session Manager listening on ${port}`);
});
