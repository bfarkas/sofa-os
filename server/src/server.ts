import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { ApiError, DraftUpdate, LoginRequest, ServerMessage, SessionInfo } from '@sofa/shared';
import { WebSocket, WebSocketServer } from 'ws';
import { checkSession, createSession, deleteSession, readCookie, SESSION_COOKIE, SESSION_DAYS, sessionCookie, verifySecret } from './auth.ts';
import type { Config } from './config.ts';
import { createDraft, currentSnapshot, deleteDraft, getDraft, publishDraft, saveDraft } from './layout.ts';
import { log } from './log.ts';

const MAX_BODY = 4096;
const MAX_LAYOUT = 256 * 1024;
const HEARTBEAT_MS = 30_000; // the TV's standby kills sockets silently (close code 1006), so ping both ways
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, limit = MAX_BODY): Promise<unknown> {
  // Requiring JSON forces a CORS preflight for cross-site posts; with SameSite=Strict that covers CSRF.
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'expected application/json');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

export function startServer(config: Config, db: DatabaseSync): Server {
  const companionRoot = resolve(config.companionDir);
  const sessionOf = (req: IncomingMessage) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const expiresAt = checkSession(db, token);
    return expiresAt ? { token, expiresAt } : null;
  };
  // Seam for Session 06, which replaces the open-access flag with a check of the TV's device token.
  const isTv = (_req: IncomingMessage) => config.tvOpenAccess;
  const canRead = (req: IncomingMessage) => sessionOf(req) !== null || isTv(req);
  const info = (expiresAt: number): SessionInfo => ({ signedIn: true, expiresAt: new Date(expiresAt).toISOString() });

  async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
    // Paths without an extension are Companion routes and get the app shell.
    const file = resolve(join(companionRoot, extname(pathname) ? pathname : 'index.html'));
    if (!file.startsWith(companionRoot + sep)) throw new HttpError(404, 'not found');
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      throw new HttpError(404, 'not found');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=300',
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'",
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const key = `${req.method} ${pathname}`;

    if (key === 'GET /healthz') return send(res, 200, { ok: true });

    if (key === 'POST /api/login') {
      const body = (await readJson(req)) as Partial<LoginRequest>;
      if (typeof body?.password !== 'string' || !(await verifySecret(body.password, config.passwordHash))) {
        log.warn('login failed', { ip: req.socket.remoteAddress });
        return send(res, 401, { error: 'wrong password' } satisfies ApiError);
      }
      const { token, expiresAt } = createSession(db);
      log.info('login');
      return send(res, 200, info(expiresAt), { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86_400, config.secureCookies) });
    }

    if (key === 'POST /api/logout') {
      deleteSession(db, readCookie(req.headers.cookie, SESSION_COOKIE));
      return send(res, 200, {}, { 'Set-Cookie': sessionCookie('', 0, config.secureCookies) });
    }

    if (key === 'GET /api/snapshot') {
      if (!canRead(req)) return send(res, 401, { error: 'not signed in' } satisfies ApiError);
      return send(res, 200, currentSnapshot(db));
    }

    if (pathname.startsWith('/api/')) {
      const session = sessionOf(req);
      if (!session) return send(res, 401, { error: 'not signed in' } satisfies ApiError);
      if (key === 'GET /api/session') return send(res, 200, info(session.expiresAt));
      if (key === 'POST /api/drafts') return send(res, 201, createDraft(db));
      const m = /^\/api\/drafts\/(\d+)(\/publish)?$/.exec(pathname);
      if (m) return draftRoute(req, res, Number(m[1]), req.method + (m[2] ?? ''));
      throw new HttpError(404, 'not found');
    }

    return serveStatic(req, res, pathname);
  }

  // Companion drafts. Only signed-in Companion sessions get here.
  async function draftRoute(req: IncomingMessage, res: ServerResponse, id: number, action: string): Promise<void> {
    const missing = () => send(res, 404, { error: 'no such draft' } satisfies ApiError);
    if (action === 'GET') {
      const draft = getDraft(db, id);
      return draft ? send(res, 200, draft) : missing();
    }
    if (action === 'PUT') {
      const body = (await readJson(req, MAX_LAYOUT)) as Partial<DraftUpdate>;
      if (typeof body?.base !== 'number' || !('layout' in body)) throw new HttpError(400, 'expected { base, layout }');
      const saved = saveDraft(db, id, body.base, body.layout);
      if (saved === 'missing') return missing();
      if (saved === 'stale') return send(res, 409, { error: 'draft has moved on; reload it' } satisfies ApiError);
      return send(res, 200, saved);
    }
    if (action === 'DELETE') return deleteDraft(db, id) ? send(res, 200, {}) : missing();
    if (action === 'POST/publish') {
      const result = publishDraft(db, id);
      if (result.ok) {
        log.info('published', { revision: result.snapshot.revision, draft: id });
        broadcast({ type: 'revision', revision: result.snapshot.revision });
        return send(res, 200, result.snapshot);
      }
      if (result.reason === 'missing') return missing();
      log.warn('publish refused', { draft: id, reason: result.reason, errors: result.errors.slice(0, 5) });
      const status = result.reason === 'stale' ? 409 : 422;
      return send(res, status, { error: result.reason === 'stale' ? 'draft is out of date' : 'layout is invalid', errors: result.errors } satisfies ApiError);
    }
    throw new HttpError(405, 'method not allowed');
  }

  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    route(req, res).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) log.error('request failed', { method: req.method, url: req.url, err: String(err?.stack ?? err) });
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'internal error' : err.message } satisfies ApiError);
      else res.destroy();
    });
  });

  // WebSocket at /ws for signed-in Companion clients and Sofa Home. It only signals; data comes over REST.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const alive = new WeakMap<WebSocket, boolean>();
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname !== '/ws' || !canRead(req)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });
  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('error', (err) => log.warn('websocket error', { err: String(err) }));
    ws.send(JSON.stringify({ type: 'hello', serverTime: new Date().toISOString() } satisfies ServerMessage));
  });
  function broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  server.on('close', () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
  });

  server.listen(config.port, () => log.info('listening', { port: config.port, ha: config.ha ? config.ha.url : 'off' }));
  return server;
}
