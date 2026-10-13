import express from 'express';
import { HttpError } from '../errors.js';
import { parseId, schemas, validate } from '../validation.js';

const excerpt = (text, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Tasks, their checklist items and comments.
export function taskRoutes({ repo, access, session, removeFiles, log, notify }) {
  const router = express.Router();
  router.use(session.requireAuth);

  // Assignees must be workspace members and labels must belong to the board.
  async function checkRefs(a, { assigneeIds, labelIds }) {
    if (assigneeIds?.length) {
      const valid = await repo.validMemberIds(a.workspaceId, assigneeIds);
      if (valid.length !== new Set(assigneeIds).size) throw new HttpError(400, 'assignees must be members of this workspace');
    }
    if (labelIds?.length) {
      const valid = await repo.validLabelIds(a.boardId, labelIds);
      if (valid.length !== new Set(labelIds).size) throw new HttpError(400, 'labels must belong to this board');
    }
  }

  async function memberNames(workspaceId, ids) {
    if (!ids.length) return [];
    const members = await repo.listMembers(workspaceId);
    return members.filter((m) => ids.includes(m.id)).map((m) => m.name);
  }

  // ------------------------------------------------------------ tasks

  router.post('/boards/:id/tasks', async (req, res) => {
    const boardId = parseId(req.params.id, 'board');
    const body = validate(schemas.newTask, req.body);
    const a = await access.board(req, boardId, 'member');
    await checkRefs(a, body);
    const task = await repo.createTask(boardId, req.user.id, body);
    if (!task) throw new HttpError(400, 'that column is not on this board');
    await log(req, a, 'task.created', { title: task.title }, task.id);
    if (body.assigneeIds?.length) {
      await log(req, a, 'task.assigned', { userIds: body.assigneeIds, names: await memberNames(a.workspaceId, body.assigneeIds) }, task.id);
      await notify(req, a, 'assigned', body.assigneeIds, task.id);
    }
    res.status(201).json(task);
  });

  router.get('/tasks/:id', async (req, res) => {
    const id = parseId(req.params.id, 'task');
    const { role } = await access.task(req, id);
    const [task, activity, time] = await Promise.all([repo.getTaskDetail(id), repo.taskActivity(id), repo.taskTime(id)]);
    res.json({ ...task, role, activity, time });
  });

  router.patch('/tasks/:id', async (req, res) => {
    const id = parseId(req.params.id, 'task');
    const changes = validate(schemas.updateTask, req.body);
    const a = await access.task(req, id, 'member');
    await checkRefs(a, changes);
    const { task, before, next } = await repo.updateTask(id, changes);

    // One activity entry per meaningful change.
    if (changes.done !== undefined && changes.done !== before.done) {
      await log(req, a, changes.done ? 'task.completed' : 'task.reopened', { title: task.title }, id);
    }
    if (changes.title !== undefined && changes.title !== before.title) {
      await log(req, a, 'task.renamed', { from: before.title, to: task.title }, id);
    }
    if (changes.dueDate !== undefined && changes.dueDate !== before.dueDate) {
      await log(req, a, 'task.due_changed', { dueDate: task.dueDate }, id);
    }
    if (changes.priority !== undefined && changes.priority !== before.priority) {
      await log(req, a, 'task.priority_changed', { priority: task.priority }, id);
    }
    if (changes.description !== undefined && changes.description !== before.description) {
      await log(req, a, 'task.description_changed', {}, id);
    }
    if (changes.repeat !== undefined && changes.repeat !== before.repeat) {
      await log(req, a, 'task.repeat_changed', { repeat: changes.repeat }, id);
    }
    if (changes.assigneeIds !== undefined) {
      const added = task.assigneeIds.filter((uid) => !before.assigneeIds.includes(uid));
      if (added.length) {
        await log(req, a, 'task.assigned', { userIds: added, names: await memberNames(a.workspaceId, added) }, id);
        await notify(req, a, 'assigned', added, id);
      }
    }
    if (next) await log(req, a, 'task.recurred', { title: task.title, dueDate: next.dueDate }, next.id);
    res.json({ ...task, nextOccurrence: next });
  });

  router.post('/tasks/:id/move', async (req, res) => {
    const id = parseId(req.params.id, 'task');
    const { columnId, index } = validate(schemas.moveTask, req.body);
    const a = await access.task(req, id, 'member');
    const move = await repo.moveTask(id, columnId, index);
    if (!move) throw new HttpError(400, 'that column is not on this board');
    if (move.fromColumnId !== move.toColumnId) {
      const [from, to] = await Promise.all([repo.getColumn(move.fromColumnId), repo.getColumn(move.toColumnId)]);
      await log(req, a, 'task.moved', { from: from?.name, to: to.name }, id);
      if (move.done !== move.wasDone) await log(req, a, move.done ? 'task.completed' : 'task.reopened', { title: a.title }, id);
    }
    if (move.next) await log(req, a, 'task.recurred', { title: a.title, dueDate: move.next.dueDate }, move.next.id);
    res.json({ ...(await repo.getCard(id)), nextOccurrence: move.next });
  });

  router.delete('/tasks/:id', async (req, res) => {
    const id = parseId(req.params.id, 'task');
    const a = await access.task(req, id, 'member');
    await removeFiles(req, await repo.deleteTask(id));
    await log(req, a, 'task.deleted', { title: a.title });
    res.status(204).end();
  });

  // ------------------------------------------------------------ checklist

  router.post('/tasks/:id/checklist', async (req, res) => {
    const id = parseId(req.params.id, 'task');
    const { text } = validate(schemas.checklistItem, req.body);
    await access.task(req, id, 'member');
    res.status(201).json(await repo.addChecklistItem(id, text));
  });

  router.patch('/checklist/:id', async (req, res) => {
    const id = parseId(req.params.id, 'checklist item');
    const changes = validate(schemas.updateChecklistItem, req.body);
    await access.checklistItem(req, id, 'member');
    res.json(await repo.updateChecklistItem(id, changes));
  });

  router.delete('/checklist/:id', async (req, res) => {
    const id = parseId(req.params.id, 'checklist item');
    await access.checklistItem(req, id, 'member');
    await repo.deleteChecklistItem(id);
    res.status(204).end();
  });

  // ------------------------------------------------------------ comments
  // Viewers can comment: they can't change the work, but they can talk about it.

  router.post('/tasks/:id/comments', async (req, res) => {
    const id = parseId(req.params.id, 'task');
    const { body, mentions = [] } = validate(schemas.comment, req.body);
    const a = await access.task(req, id);
    // Mentions of people outside the workspace are dropped rather than rejected.
    const valid = await repo.validMemberIds(a.workspaceId, [...new Set(mentions)]);
    const comment = await repo.addComment(id, req.user.id, body, valid);
    await log(req, a, 'comment.added', { excerpt: excerpt(body), mentions: valid }, id);
    // Mentioned people hear about it as a mention; the task's other assignees as a comment.
    await notify(req, a, 'mentioned', valid, id, { excerpt: excerpt(body) });
    const { assigneeIds } = await repo.getCard(id);
    await notify(req, a, 'comment', assigneeIds.filter((uid) => !valid.includes(uid)), id, { excerpt: excerpt(body) });
    res.status(201).json(comment);
  });

  router.patch('/comments/:id', async (req, res) => {
    const id = parseId(req.params.id, 'comment');
    const { body, mentions = [] } = validate(schemas.comment, req.body);
    const a = await access.comment(req, id);
    if (a.authorId !== req.user.id) throw new HttpError(403, 'you can only edit your own comments');
    const valid = await repo.validMemberIds(a.workspaceId, [...new Set(mentions)]);
    res.json(await repo.updateComment(id, body, valid));
  });

  router.delete('/comments/:id', async (req, res) => {
    const id = parseId(req.params.id, 'comment');
    const a = await access.comment(req, id);
    if (a.authorId !== req.user.id && a.role !== 'owner') throw new HttpError(403, 'you can only delete your own comments');
    await repo.deleteComment(id);
    res.status(204).end();
  });

  return router;
}
