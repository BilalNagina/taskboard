import express from 'express';
import { parseId, schemas, validate } from '../validation.js';

const serverToday = () => new Date().toISOString().slice(0, 10);

// Dashboard, calendar and search across every board in a workspace. Any member can see
// them; viewers included.
export function insightRoutes({ repo, access, session }) {
  const router = express.Router();
  const auth = session.requireAuth;

  // ?today=YYYY-MM-DD lets "overdue" and "this week" follow the user's own calendar day.
  router.get('/workspaces/:id/dashboard', auth, async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    const { today = serverToday() } = validate(schemas.today, req.query);
    await access.workspace(req, id);
    res.json(await repo.dashboard(id, req.user.id, today));
  });

  router.get('/workspaces/:id/calendar', auth, async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    const range = validate(schemas.calendar, req.query);
    await access.workspace(req, id);
    res.json(await repo.calendar(id, range));
  });

  router.get('/workspaces/:id/search', auth, async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    const { q, assignee, priority, due, status = 'all', boardId, today = serverToday() } = validate(schemas.search, req.query);
    await access.workspace(req, id);
    const assigneeId = assignee === 'me' ? req.user.id : assignee === 'none' ? null : assignee;
    res.json(await repo.search(id, { q: q?.trim(), assigneeId, priority, due, status, boardId, today }));
  });

  return router;
}

export function notificationRoutes({ repo, session }) {
  const router = express.Router();
  const auth = session.requireAuth;

  router.get('/notifications', auth, async (req, res) => {
    const before = req.query.before ? parseId(req.query.before, 'notification') : null;
    const [items, unread] = await Promise.all([repo.listNotifications(req.user.id, { before }), repo.unreadCount(req.user.id)]);
    res.json({ items, unread });
  });

  router.get('/notifications/unread-count', auth, async (req, res) => {
    res.json({ unread: await repo.unreadCount(req.user.id) });
  });

  // { ids: [...] } marks those read; an empty body marks everything read.
  router.post('/notifications/read', auth, async (req, res) => {
    const { ids } = validate(schemas.markRead, req.body);
    await repo.markRead(req.user.id, ids);
    res.json({ unread: await repo.unreadCount(req.user.id) });
  });

  return router;
}
