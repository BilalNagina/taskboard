import express from 'express';
import { timesheetCsv } from '../../exporters.js';
import { HttpError } from '../errors.js';
import { parseId, schemas, validate } from '../validation.js';

// Timers, time entered by hand, and the workspace timesheet. Tracking time is a change to
// the work, so viewers can't; everyone in the workspace can see the timesheet.
export function timeRoutes({ repo, access, session }) {
  const router = express.Router();
  const auth = session.requireAuth;

  router.get('/me/timer', auth, async (req, res) => {
    res.json({ timer: await repo.runningTimer(req.user.id) });
  });

  // ?today= is the person's own date, so the time lands on the day they see.
  router.post('/tasks/:id/timer', auth, async (req, res) => {
    const id = parseId(req.params.id, 'task');
    const { today } = validate(schemas.startTimer, req.body);
    await access.task(req, id, 'member');
    const stopped = await repo.startTimer(req.user.id, id, today);
    res.status(201).json({ timer: await repo.runningTimer(req.user.id), stopped });
  });

  router.post('/me/timer/stop', auth, async (req, res) => {
    const stopped = await repo.stopTimer(req.user.id);
    if (!stopped) throw new HttpError(409, 'no timer is running');
    res.json({ stopped });
  });

  router.post('/tasks/:id/time', auth, async (req, res) => {
    const id = parseId(req.params.id, 'task');
    const body = validate(schemas.timeEntry, req.body);
    await access.task(req, id, 'member');
    res.status(201).json(await repo.addTimeEntry(id, req.user.id, body));
  });

  // People remove their own entries; owners can remove anyone's.
  router.delete('/time/:id', auth, async (req, res) => {
    const id = parseId(req.params.id, 'time entry');
    const a = await access.timeEntry(req, id);
    if (a.ownerId !== req.user.id && a.role !== 'owner') throw new HttpError(403, 'you can only remove your own time');
    await repo.deleteTimeEntry(id);
    res.status(204).end();
  });

  router.get('/workspaces/:id/timesheet', auth, async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    const query = validate(schemas.timesheet, req.query);
    await access.workspace(req, id);
    res.json(await repo.timesheet(id, query));
  });

  router.get('/workspaces/:id/timesheet.csv', auth, async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    const query = validate(schemas.timesheet, req.query);
    await access.workspace(req, id);
    const rows = await repo.timesheetEntries(id, query);
    res.attachment(`timesheet-${query.from}-to-${query.to}.csv`).type('text/csv; charset=utf-8').send(timesheetCsv(rows));
  });

  return router;
}
