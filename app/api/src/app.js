import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import { pinoHttp } from 'pino-http';
import client from 'prom-client';
import { DUMMY_HASH, hashPassword, verifyPassword } from './passwords.js';
import {
  parseContentType,
  parseDate,
  parseEmail,
  parseFilename,
  parseId,
  parsePassword,
  parseText,
} from './validate.js';

const QUIET_PATHS = new Set(['/healthz', '/readyz', '/metrics']);
const SESSION_COOKIE = 'tb_session';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function createApp({ repo, sessions, limiter, storage, ping, logger, cookieSecure = false }) {
  const app = express();
  app.disable('x-powered-by');
  // Requests arrive through the NGINX proxy on the private Docker network; trust its
  // X-Forwarded-For so req.ip (used for rate limiting) is the real client address.
  app.set('trust proxy', 'loopback, uniquelocal');

  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });
  const labelNames = ['method', 'route', 'status'];
  const httpRequests = new client.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames,
    registers: [registry],
  });
  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames,
    buckets: [0.01, 0.05, 0.1, 0.3, 1, 3],
    registers: [registry],
  });

  if (logger) {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => QUIET_PATHS.has(req.url) } }));
  }
  app.use((req, res, next) => {
    const stop = httpDuration.startTimer();
    res.on('finish', () => {
      // Label by route pattern, not raw URL, so /api/tasks/1 and /api/tasks/2 share one series.
      const route = req.route ? req.baseUrl + req.route.path : 'unmatched';
      const labels = { method: req.method, route, status: String(res.statusCode) };
      httpRequests.inc(labels);
      stop(labels);
    });
    next();
  });

  // Liveness: the process is up. Readiness: it can also reach PostgreSQL and Redis.
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', async (req, res) => {
    try {
      await ping();
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.get('/metrics', async (req, res) => {
    res.type(registry.contentType).send(await registry.metrics());
  });

  // ---------------------------------------------------------------- sessions

  async function startSession(res, userId) {
    const token = await sessions.create(userId);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: cookieSecure,
      // Lax keeps the cookie off cross-site POST/PATCH/DELETE requests, which is the
      // CSRF protection for this API.
      sameSite: 'lax',
      path: '/',
      maxAge: sessions.ttlSeconds * 1000,
    });
  }

  async function requireAuth(req, res, next) {
    const userId = await sessions.get(readCookie(req, SESSION_COOKIE));
    const user = userId ? await repo.findUserById(userId) : null;
    if (!user) return res.status(401).json({ error: 'sign in required' });
    req.user = user;
    next();
  }

  async function removeFiles(req, keys) {
    try {
      await storage.remove(keys);
    } catch (err) {
      req.log?.warn({ err, keys }, 'could not delete attachment files');
    }
  }

  // ---------------------------------------------------------------- uploads
  // Registered before the JSON parser: the request body is the raw file, so a JSON file
  // upload isn't parsed (and rejected) as a JSON request.

  app.post(
    '/api/tasks/:id/attachments',
    requireAuth,
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    async (req, res) => {
      const taskId = parseId(req.params.id);
      if (!taskId) return res.status(400).json({ error: 'invalid task id' });
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'the file is empty' });
      }
      const filename = parseFilename(req.get('x-filename'));
      if (!filename) return res.status(400).json({ error: 'X-Filename header is required (1-200 characters)' });
      if (!(await limiter.hit(`upload:${req.user.id}`, { limit: 30, windowSeconds: 3600 }))) {
        return res.status(429).json({ error: 'upload limit reached, try again later' });
      }
      if (!(await repo.getTask(req.user.id, taskId))) return res.status(404).json({ error: 'task not found' });

      // Keys never contain the user's filename, so names can't collide or escape the prefix.
      const storageKey = `attachments/${req.user.id}/${randomUUID()}`;
      const contentType = parseContentType(req.get('content-type'));
      await storage.put(storageKey, req.body, contentType);
      const attachment = await repo.addAttachment(req.user.id, taskId, {
        storageKey,
        filename,
        contentType,
        size: req.body.length,
      });
      if (!attachment) {
        // The task was deleted while the file was uploading.
        await removeFiles(req, [storageKey]);
        return res.status(404).json({ error: 'task not found' });
      }
      res.status(201).json(attachment);
    },
  );

  app.use(express.json({ limit: '10kb' }));

  // ---------------------------------------------------------------- auth

  const auth = express.Router();

  auth.post('/register', async (req, res) => {
    const name = parseText(req.body?.name, 80);
    const email = parseEmail(req.body?.email);
    const password = parsePassword(req.body?.password);
    if (!name) return res.status(400).json({ error: 'name is required (1-80 characters)' });
    if (!email) return res.status(400).json({ error: 'a valid email is required' });
    if (!password) return res.status(400).json({ error: 'password must be 8-128 characters' });
    if (!(await limiter.hit(`register:${req.ip}`, { limit: 20, windowSeconds: 3600 }))) {
      return res.status(429).json({ error: 'too many sign-ups from this address, try again later' });
    }

    const user = await repo.createUser({ email, name, passwordHash: await hashPassword(password) });
    if (!user) return res.status(409).json({ error: 'an account with this email already exists' });
    await repo.createBoard(user.id, 'My tasks');
    await startSession(res, user.id);
    res.status(201).json({ user });
  });

  auth.post('/login', async (req, res) => {
    const email = parseEmail(req.body?.email);
    const password = req.body?.password;
    if (!email || typeof password !== 'string' || password.length > 128) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const limitKey = `login:${email}`;
    if (!(await limiter.hit(limitKey, { limit: 10, windowSeconds: 900 }))) {
      return res.status(429).json({ error: 'too many attempts, try again in 15 minutes' });
    }

    const found = await repo.findUserForLogin(email);
    const valid = await verifyPassword(password, found?.passwordHash ?? DUMMY_HASH);
    if (!found || !valid) return res.status(401).json({ error: 'wrong email or password' });

    await limiter.reset(limitKey);
    await startSession(res, found.id);
    const { passwordHash, ...user } = found;
    res.json({ user });
  });

  auth.post('/logout', async (req, res) => {
    await sessions.destroy(readCookie(req, SESSION_COOKIE));
    res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: cookieSecure, sameSite: 'lax' });
    res.status(204).end();
  });

  auth.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

  app.use('/api/auth', auth);

  // ---------------------------------------------------------------- boards, tasks, files

  const api = express.Router();
  api.use(requireAuth);

  api.get('/boards', async (req, res) => {
    res.json(await repo.listBoards(req.user.id));
  });

  api.post('/boards', async (req, res) => {
    const name = parseText(req.body?.name, 80);
    if (!name) return res.status(400).json({ error: 'board name is required (1-80 characters)' });
    res.status(201).json(await repo.createBoard(req.user.id, name));
  });

  api.patch('/boards/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const name = parseText(req.body?.name, 80);
    if (!id) return res.status(400).json({ error: 'invalid board id' });
    if (!name) return res.status(400).json({ error: 'board name is required (1-80 characters)' });
    const board = await repo.renameBoard(req.user.id, id, name);
    if (!board) return res.status(404).json({ error: 'board not found' });
    res.json(board);
  });

  api.delete('/boards/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid board id' });
    const keys = await repo.deleteBoard(req.user.id, id);
    if (!keys) return res.status(404).json({ error: 'board not found' });
    await removeFiles(req, keys);
    res.status(204).end();
  });

  api.get('/boards/:id/tasks', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid board id' });
    const tasks = await repo.listTasks(req.user.id, id);
    if (!tasks) return res.status(404).json({ error: 'board not found' });
    res.json(tasks);
  });

  api.post('/boards/:id/tasks', async (req, res) => {
    const boardId = parseId(req.params.id);
    if (!boardId) return res.status(400).json({ error: 'invalid board id' });
    const title = parseText(req.body?.title, 200);
    if (!title) return res.status(400).json({ error: 'title is required (1-200 characters)' });
    const dueDate = req.body?.dueDate ?? null;
    if (dueDate !== null && !parseDate(dueDate)) {
      return res.status(400).json({ error: 'dueDate must be a date (YYYY-MM-DD) or null' });
    }
    const task = await repo.createTask(req.user.id, boardId, { title, dueDate });
    if (!task) return res.status(404).json({ error: 'board not found' });
    res.status(201).json(task);
  });

  api.patch('/tasks/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid task id' });
    const { title, done, dueDate } = req.body ?? {};
    if (title === undefined && done === undefined && dueDate === undefined) {
      return res.status(400).json({ error: 'nothing to update' });
    }
    const cleanTitle = title === undefined ? undefined : parseText(title, 200);
    if (title !== undefined && !cleanTitle) {
      return res.status(400).json({ error: 'title must be 1-200 characters' });
    }
    if (done !== undefined && typeof done !== 'boolean') {
      return res.status(400).json({ error: 'done must be true or false' });
    }
    if (dueDate !== undefined && dueDate !== null && !parseDate(dueDate)) {
      return res.status(400).json({ error: 'dueDate must be a date (YYYY-MM-DD) or null' });
    }
    const task = await repo.updateTask(req.user.id, id, { title: cleanTitle, done, dueDate });
    if (!task) return res.status(404).json({ error: 'task not found' });
    res.json(task);
  });

  api.delete('/tasks/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid task id' });
    const keys = await repo.deleteTask(req.user.id, id);
    if (!keys) return res.status(404).json({ error: 'task not found' });
    await removeFiles(req, keys);
    res.status(204).end();
  });

  api.get('/attachments/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid attachment id' });
    const attachment = await repo.getAttachment(req.user.id, id);
    if (!attachment) return res.status(404).json({ error: 'attachment not found' });

    let file;
    try {
      file = await storage.get(attachment.storageKey);
    } catch (err) {
      if (err.name === 'NoSuchKey') return res.status(404).json({ error: 'file is missing from storage' });
      throw err;
    }
    res.set({
      'Content-Type': attachment.contentType,
      'Content-Length': String(file.size ?? attachment.size),
      // Always download, never render inline: an uploaded HTML or SVG file must not run
      // as a page on this site.
      'Content-Disposition': contentDisposition(attachment.filename),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    await pipeline(file.body, res);
  });

  api.delete('/attachments/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid attachment id' });
    const key = await repo.deleteAttachment(req.user.id, id);
    if (!key) return res.status(404).json({ error: 'attachment not found' });
    await removeFiles(req, [key]);
    res.status(204).end();
  });

  app.use('/api', api);

  app.use((req, res) => res.status(404).json({ error: 'not found' }));
  // Express recognises error handlers by their four parameters, so _next must stay.
  app.use((err, req, res, _next) => {
    if (res.headersSent) {
      // A download failed midway; all we can do is cut the connection.
      req.log?.error({ err }, 'response failed after headers were sent');
      return res.destroy();
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'request too large' });
    req.log?.error({ err }, 'request failed');
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

// An ASCII fallback plus the RFC 5987 UTF-8 form, so non-English filenames survive.
function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const utf8 = encodeURIComponent(filename).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
