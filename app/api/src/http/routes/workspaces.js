import express from 'express';
import { planLimits } from '../../plans.js';
import { HttpError } from '../errors.js';
import { parseId, schemas, validate } from '../validation.js';

// Each workspace comes with its plan's limits, so the app can say "2 of 3 boards" and
// warn before someone runs into one.
const withLimits = (workspace) => ({ ...workspace, limits: planLimits(workspace.plan) });

export function workspaceRoutes({ repo, access, limits, session, removeFiles, log }) {
  const router = express.Router();
  router.use(session.requireAuth);

  router.get('/', async (req, res) => {
    res.json((await repo.listWorkspaces(req.user.id)).map(withLimits));
  });

  router.post('/', async (req, res) => {
    const { name } = validate(schemas.workspace, req.body);
    res.status(201).json(withLimits(await repo.createWorkspace(req.user.id, name)));
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    const { name } = validate(schemas.workspace, req.body);
    const a = await access.workspace(req, id, 'owner');
    const before = await repo.getWorkspace(id);
    const workspace = await repo.renameWorkspace(id, name);
    if (before.name !== name) await log(req, a, 'workspace.renamed', { from: before.name, to: name });
    res.json(workspace);
  });

  // Owners only, and not someone's last workspace: everyone keeps somewhere to work.
  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    await access.workspace(req, id, 'owner');
    if ((await repo.membershipCount(req.user.id)) <= 1) {
      throw new HttpError(409, "you can't delete your only workspace; create another one first");
    }
    // Deleting would leave the subscription billing for nothing.
    if (await repo.liveSubscription(id)) throw new HttpError(409, 'cancel this workspace’s subscription in Billing first');
    await removeFiles(req, await repo.deleteWorkspace(id));
    res.status(204).end();
  });

  router.get('/:id/boards', async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    await access.workspace(req, id);
    res.json(await repo.listBoards(id));
  });

  router.post('/:id/boards', async (req, res) => {
    const id = parseId(req.params.id, 'workspace');
    const body = validate(schemas.newBoard, req.body);
    const a = await access.workspace(req, id, 'member');
    await limits.board(id);
    const board = await repo.createBoard(id, req.user.id, body);
    await log(req, { ...a, boardId: board.id }, 'board.created', { name: board.name, template: body.template ?? 'blank' });
    res.status(201).json(board);
  });

  return router;
}
