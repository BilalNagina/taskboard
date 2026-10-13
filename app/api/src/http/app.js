import express from 'express';
import { pinoHttp } from 'pino-http';
import client from 'prom-client';
import { createAccess } from './access.js';
import { HttpError } from './errors.js';
import { attachmentRoutes } from './routes/attachments.js';
import { accountRoutes, authRoutes } from './routes/auth.js';
import { boardRoutes } from './routes/boards.js';
import { memberRoutes } from './routes/members.js';
import { taskRoutes } from './routes/tasks.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { createSessionHelpers } from './session.js';

const QUIET_PATHS = new Set(['/healthz', '/readyz', '/metrics']);

export function createApp({ repo, sessions, limiter, storage, jobs, ping, logger, cookieSecure = false, appUrl = '' }) {
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

  async function removeFiles(req, keys) {
    const existing = keys.filter(Boolean);
    if (existing.length === 0) return;
    try {
      await storage.remove(existing);
    } catch (err) {
      req.log?.warn({ err, keys: existing }, 'could not delete attachment files');
    }
  }

  // Records an activity entry. `a` is an access row (workspace and board ids); taskId is
  // passed explicitly because a deleted task can't be referenced.
  async function log(req, a, type, data = {}, taskId = null) {
    await repo.logActivity({ workspaceId: a.workspaceId, boardId: a.boardId ?? null, taskId, actorId: req.user.id, type, data });
  }

  const session = createSessionHelpers({ sessions, repo, cookieSecure });
  const deps = { repo, sessions, limiter, storage, jobs, session, removeFiles, log, appUrl, access: createAccess(repo) };

  // Raw-body uploads first, before the JSON parser.
  app.use('/api', attachmentRoutes(deps));
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/auth', authRoutes(deps));
  app.use('/api/me', accountRoutes(deps));
  // Before the routers below, which require sign-in for everything under /api: the
  // invite lookup is public.
  app.use('/api', memberRoutes(deps));
  app.use('/api/workspaces', workspaceRoutes(deps));
  app.use('/api', boardRoutes(deps));
  app.use('/api', taskRoutes(deps));

  app.use((req, res) => res.status(404).json({ error: 'not found' }));
  // Express recognises error handlers by their four parameters, so _next must stay.
  app.use((err, req, res, _next) => {
    if (res.headersSent) {
      // A download failed midway; all we can do is cut the connection.
      req.log?.error({ err }, 'response failed after headers were sent');
      return res.destroy();
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'request too large' });
    req.log?.error({ err }, 'request failed');
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
