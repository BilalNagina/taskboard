import express from 'express';
import { boardCsv, writeBoardPdf } from '../../exporters.js';
import { templateSummaries } from '../../templates.js';
import { HttpError } from '../errors.js';
import { parseId, schemas, validate } from '../validation.js';

// Boards, their columns and labels, and the board activity feed.
export function boardRoutes({ repo, access, session, removeFiles, log }) {
  const router = express.Router();
  router.use(session.requireAuth);

  // ------------------------------------------------------------ boards

  router.get('/templates', (req, res) => {
    res.json(templateSummaries());
  });

  router.get('/boards/:id', async (req, res) => {
    const id = parseId(req.params.id, 'board');
    const { role } = await access.board(req, id);
    res.json({ ...(await repo.getBoard(id)), role });
  });

  // Everything the board view needs in one request.
  router.get('/boards/:id/full', async (req, res) => {
    const id = parseId(req.params.id, 'board');
    const { role, workspaceId } = await access.board(req, id);
    const [board, columns, cards, labels, members] = await Promise.all([
      repo.getBoard(id),
      repo.listColumns(id),
      repo.listCards(id),
      repo.listLabels(id),
      repo.listMembers(workspaceId),
    ]);
    res.json({ board: { ...board, role }, columns, cards, labels, members });
  });

  router.patch('/boards/:id', async (req, res) => {
    const id = parseId(req.params.id, 'board');
    const { name } = validate(schemas.board, req.body);
    const a = await access.board(req, id, 'member');
    const before = await repo.getBoard(id);
    const board = await repo.renameBoard(id, name);
    if (before.name !== name) await log(req, a, 'board.renamed', { from: before.name, to: name });
    res.json(board);
  });

  router.delete('/boards/:id', async (req, res) => {
    const id = parseId(req.params.id, 'board');
    const a = await access.board(req, id, 'owner');
    const board = await repo.getBoard(id);
    await removeFiles(req, await repo.deleteBoard(id));
    // Logged against the workspace only: the board's own history goes with it.
    await log(req, { ...a, boardId: null }, 'board.deleted', { name: board.name });
    res.status(204).end();
  });

  router.get('/boards/:id/activity', async (req, res) => {
    const id = parseId(req.params.id, 'board');
    await access.board(req, id);
    const before = req.query.before ? parseId(req.query.before, 'activity') : null;
    res.json(await repo.boardActivity(id, { before }));
  });

  // ------------------------------------------------------------ export

  const fileName = (name, ext) => `${name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-') || 'board'}.${ext}`;

  router.get('/boards/:id/export.csv', async (req, res) => {
    const id = parseId(req.params.id, 'board');
    await access.board(req, id);
    const [board, rows] = await Promise.all([repo.getBoard(id), repo.exportBoard(id)]);
    res.attachment(fileName(board.name, 'csv')).type('text/csv; charset=utf-8').send(boardCsv(rows));
  });

  router.get('/boards/:id/export.pdf', async (req, res) => {
    const id = parseId(req.params.id, 'board');
    const { workspaceId } = await access.board(req, id);
    const [board, rows, workspace] = await Promise.all([repo.getBoard(id), repo.exportBoard(id), repo.getWorkspace(workspaceId)]);
    res.attachment(fileName(board.name, 'pdf')).type('application/pdf');
    writeBoardPdf(res, { board, workspaceName: workspace.name, rows, generatedBy: req.user.name });
  });

  // ------------------------------------------------------------ columns

  router.post('/boards/:id/columns', async (req, res) => {
    const id = parseId(req.params.id, 'board');
    const body = validate(schemas.column, req.body);
    const a = await access.board(req, id, 'member');
    const column = await repo.createColumn(id, body);
    await log(req, a, 'column.created', { name: column.name });
    res.status(201).json(column);
  });

  router.patch('/columns/:id', async (req, res) => {
    const id = parseId(req.params.id, 'column');
    const changes = validate(schemas.updateColumn, req.body);
    const a = await access.column(req, id, 'member');
    const before = await repo.getColumn(id);
    const column = await repo.updateColumn(id, changes);
    if (changes.name && changes.name !== before.name) await log(req, a, 'column.renamed', { from: before.name, to: column.name });
    res.json(column);
  });

  router.post('/columns/:id/move', async (req, res) => {
    const id = parseId(req.params.id, 'column');
    const { index } = validate(schemas.moveColumn, req.body);
    await access.column(req, id, 'member');
    await repo.moveColumn(id, index);
    res.status(204).end();
  });

  // Cards in the column move to ?moveTo= (or the first remaining column) first.
  router.delete('/columns/:id', async (req, res) => {
    const id = parseId(req.params.id, 'column');
    const moveTo = req.query.moveTo ? parseId(req.query.moveTo, 'column') : null;
    const a = await access.column(req, id, 'member');
    const column = await repo.getColumn(id);
    const result = await repo.deleteColumn(id, moveTo);
    if (!result) throw new HttpError(409, "a board needs at least one column");
    await log(req, a, 'column.deleted', { name: column.name });
    res.json(result);
  });

  // ------------------------------------------------------------ labels

  router.post('/boards/:id/labels', async (req, res) => {
    const id = parseId(req.params.id, 'board');
    const body = validate(schemas.label, req.body);
    await access.board(req, id, 'member');
    const label = await repo.createLabel(id, body);
    if (!label) throw new HttpError(409, 'this board already has a label with that name');
    res.status(201).json(label);
  });

  router.patch('/labels/:id', async (req, res) => {
    const id = parseId(req.params.id, 'label');
    const changes = validate(schemas.updateLabel, req.body);
    await access.label(req, id, 'member');
    const label = await repo.updateLabel(id, changes);
    if (!label) throw new HttpError(409, 'this board already has a label with that name');
    res.json(label);
  });

  router.delete('/labels/:id', async (req, res) => {
    const id = parseId(req.params.id, 'label');
    await access.label(req, id, 'member');
    await repo.deleteLabel(id);
    res.status(204).end();
  });

  return router;
}
