import express from 'express';
import { pinoHttp } from 'pino-http';
import client from 'prom-client';

const QUIET_PATHS = new Set(['/healthz', '/readyz', '/metrics']);

export function createApp({ repo, ping, logger }) {
  const app = express();
  app.disable('x-powered-by');

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

  app.use(express.json({ limit: '10kb' }));
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

  // Liveness: the process is up. Readiness: it can also reach the database.
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

  const api = express.Router();

  api.get('/tasks', async (req, res) => {
    res.json(await repo.list());
  });

  api.post('/tasks', async (req, res) => {
    const title = parseTitle(req.body?.title);
    if (!title) return res.status(400).json({ error: 'title is required (1-200 characters)' });
    res.status(201).json(await repo.create(title));
  });

  api.patch('/tasks/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid task id' });
    const { title, done } = req.body ?? {};
    if (title === undefined && done === undefined) {
      return res.status(400).json({ error: 'nothing to update' });
    }
    const cleanTitle = title === undefined ? undefined : parseTitle(title);
    if (title !== undefined && !cleanTitle) {
      return res.status(400).json({ error: 'title must be 1-200 characters' });
    }
    if (done !== undefined && typeof done !== 'boolean') {
      return res.status(400).json({ error: 'done must be true or false' });
    }
    const task = await repo.update(id, { title: cleanTitle, done });
    if (!task) return res.status(404).json({ error: 'task not found' });
    res.json(task);
  });

  api.delete('/tasks/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid task id' });
    if (!(await repo.remove(id))) return res.status(404).json({ error: 'task not found' });
    res.status(204).end();
  });

  app.use('/api', api);
  app.use((req, res) => res.status(404).json({ error: 'not found' }));
  // Express recognises error handlers by their four parameters, so _next must stay.
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'request too large' });
    req.log?.error({ err }, 'request failed');
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

function parseTitle(value) {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title.length >= 1 && title.length <= 200 ? title : null;
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
