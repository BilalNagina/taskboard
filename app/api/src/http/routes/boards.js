import express from 'express';
import { parseId, schemas, validate } from '../validation.js';

// Boards and the tasks on them. Every handler checks the user's workspace role first.
export function boardRoutes({ repo, access, session, removeFiles }) {
  const router = express.Router();
  router.use(session.requireAuth);

  router.get('/boards/:id', async (req, res) => {
    const id = parseId(req.params.id, 'board');
    const { role } = await access.board(req, id);
    res.json({ ...(await repo.getBoard(id)), role });
  });

  router.patch('/boards/:id', async (req, res) => {
    const id = parseId(req.params.id, 'board');
    const { name } = validate(schemas.board, req.body);
    await access.board(req, id, 'member');
    res.json(await repo.renameBoard(id, name));
  });

  router.delete('/boards/:id', async (req, res) => {
    const id = parseId(req.params.id, 'board');
    await access.board(req, id, 'owner');
    await removeFiles(req, await repo.deleteBoard(id));
    res.status(204).end();
  });

  router.get('/boards/:id/tasks', async (req, res) => {
    const id = parseId(req.params.id, 'board');
    await access.board(req, id);
    res.json(await repo.listTasks(id));
  });

  router.post('/boards/:id/tasks', async (req, res) => {
    const id = parseId(req.params.id, 'board');
    const task = validate(schemas.newTask, req.body);
    await access.board(req, id, 'member');
    res.status(201).json(await repo.createTask(id, req.user.id, task));
  });

  router.patch('/tasks/:id', async (req, res) => {
    const id = parseId(req.params.id, 'task');
    const changes = validate(schemas.updateTask, req.body);
    await access.task(req, id, 'member');
    res.json(await repo.updateTask(id, changes));
  });

  router.delete('/tasks/:id', async (req, res) => {
    const id = parseId(req.params.id, 'task');
    await access.task(req, id, 'member');
    await removeFiles(req, await repo.deleteTask(id));
    res.status(204).end();
  });

  return router;
}
