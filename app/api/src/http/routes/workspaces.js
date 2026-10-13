import express from 'express';
import { parseId, schemas, validate } from '../validation.js';

export function workspaceRoutes({ repo, access, session }) {
  const router = express.Router();
  router.use(session.requireAuth);

  router.get('/', async (req, res) => {
    res.json(await repo.listWorkspaces(req.user.id));
  });

  router.post('/', async (req, res) => {
    const { name } = validate(schemas.workspace, req.body);
    res.status(201).json(await repo.createWorkspace(req.user.id, name));
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    const { name } = validate(schemas.workspace, req.body);
    await access.workspace(req, id, 'owner');
    res.json(await repo.renameWorkspace(id, name));
  });

  router.get('/:id/boards', async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    await access.workspace(req, id);
    res.json(await repo.listBoards(id));
  });

  router.post('/:id/boards', async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    const { name } = validate(schemas.board, req.body);
    await access.workspace(req, id, 'member');
    res.status(201).json(await repo.createBoard(id, req.user.id, name));
  });

  return router;
}
