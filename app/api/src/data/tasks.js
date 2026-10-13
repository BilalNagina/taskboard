// Tasks and everything on them: moves between columns, labels, assignees, checklist
// items, comments and attachments. Callers check access first.
import { nextDueDate } from '../recurrence.js';
import { setPositions } from './boards.js';
import { avatarUrl } from './users.js';

// What a card on the board needs.
const CARD = `t.id, t.board_id AS "boardId", t.column_id AS "columnId", t.position, t.title, t.done,
  t.priority, t.due_date AS "dueDate", t.repeat, t.created_at AS "createdAt", t.updated_at AS "updatedAt",
  COALESCE((SELECT array_agg(label_id ORDER BY label_id) FROM task_labels WHERE task_id = t.id), '{}') AS "labelIds",
  COALESCE((SELECT array_agg(user_id ORDER BY user_id) FROM task_assignees WHERE task_id = t.id), '{}') AS "assigneeIds",
  (SELECT count(*)::int FROM checklist_items WHERE task_id = t.id) AS "checklistTotal",
  (SELECT count(*)::int FROM checklist_items WHERE task_id = t.id AND done) AS "checklistDone",
  (SELECT count(*)::int FROM comments WHERE task_id = t.id) AS "commentCount",
  (SELECT count(*)::int FROM attachments WHERE task_id = t.id) AS "attachmentCount",
  t.description <> '' AS "hasDescription"`;

const ATTACHMENT = 'id, filename, content_type AS "contentType", size_bytes AS size, created_at AS "createdAt"';
const CHECKLIST = 'id, task_id AS "taskId", text, done, position';

const clamp = (value, max) => Math.max(0, Math.min(value, max));

// Makes the next occurrence of a repeating task that was just completed: same details,
// assignees and labels, a fresh checklist and the next due date, at the end of the
// board's first open column. The repeat setting moves to the new task. Returns
// { id, dueDate } of the new task, or null if the task doesn't repeat.
async function createNextOccurrence(q, taskId) {
  const task = (
    await q.query('SELECT board_id, repeat, due_date, title, description, priority, created_by FROM tasks WHERE id = $1', [taskId])
  ).rows[0];
  if (!task?.repeat) return null;
  const column = (
    await q.query('SELECT id FROM board_columns WHERE board_id = $1 AND NOT is_done ORDER BY position, id LIMIT 1', [task.board_id])
  ).rows[0];
  if (!column) return null;
  const { today } = (await q.query('SELECT current_date AS today')).rows[0];
  const dueDate = nextDueDate(task.repeat, task.due_date, today);
  const { rows } = await q.query(
    `INSERT INTO tasks (board_id, column_id, created_by, title, description, priority, repeat, due_date, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT COALESCE(max(position) + 1, 0) FROM tasks WHERE column_id = $2))
     RETURNING id`,
    [task.board_id, column.id, task.created_by, task.title, task.description, task.priority, task.repeat, dueDate],
  );
  const nextId = rows[0].id;
  await q.query('INSERT INTO task_labels (task_id, label_id) SELECT $1, label_id FROM task_labels WHERE task_id = $2', [nextId, taskId]);
  await q.query('INSERT INTO task_assignees (task_id, user_id) SELECT $1, user_id FROM task_assignees WHERE task_id = $2', [nextId, taskId]);
  await q.query('INSERT INTO checklist_items (task_id, text, position) SELECT $1, text, position FROM checklist_items WHERE task_id = $2', [
    nextId,
    taskId,
  ]);
  await q.query('UPDATE tasks SET repeat = NULL WHERE id = $1', [taskId]);
  return { id: nextId, dueDate };
}

// Puts a task at `index` in `columnId` (same board) and keeps `done` in step with the
// column. Returns { fromColumnId, toColumnId, wasDone, done, next } (next: the new
// occurrence when this completed a repeating task), or null for a bad column.
async function moveWithin(q, taskId, columnId, index) {
  const task = (await q.query('SELECT board_id, column_id, done FROM tasks WHERE id = $1 FOR UPDATE', [taskId])).rows[0];
  const column = (
    await q.query('SELECT id, is_done FROM board_columns WHERE id = $1 AND board_id = $2', [columnId, task.board_id])
  ).rows[0];
  if (!column) return null;
  // Moves on one board take turns, so two people dragging at once can't scramble positions.
  await q.query('SELECT id FROM board_columns WHERE board_id = $1 ORDER BY id FOR UPDATE', [task.board_id]);

  await q.query(
    `UPDATE tasks SET column_id = $2, done = $3, updated_at = now(),
            completed_at = CASE WHEN $3 THEN COALESCE(completed_at, now()) ELSE NULL END
      WHERE id = $1`,
    [taskId, columnId, column.is_done],
  );
  const ids = (
    await q.query('SELECT id FROM tasks WHERE column_id = $1 AND id <> $2 ORDER BY position, id', [columnId, taskId])
  ).rows.map((r) => r.id);
  ids.splice(clamp(index ?? ids.length, ids.length), 0, taskId);
  await setPositions(q, 'tasks', ids);
  if (task.column_id !== columnId) {
    const left = (await q.query('SELECT id FROM tasks WHERE column_id = $1 ORDER BY position, id', [task.column_id])).rows;
    await setPositions(q, 'tasks', left.map((r) => r.id));
  }
  const next = !task.done && column.is_done ? await createNextOccurrence(q, taskId) : null;
  return { fromColumnId: task.column_id, toColumnId: columnId, wasDone: task.done, done: column.is_done, next };
}

async function replaceSet(q, table, column, taskId, ids) {
  await q.query(`DELETE FROM ${table} WHERE task_id = $1`, [taskId]);
  if (ids.length) {
    await q.query(`INSERT INTO ${table} (task_id, ${column}) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`, [
      taskId,
      ids,
    ]);
  }
}

export function tasksRepo(db) {
  const one = async (text, params) => (await db.query(text, params)).rows[0] ?? null;
  const all = async (text, params) => (await db.query(text, params)).rows;
  const getCard = (taskId, q = db) => q.query(`SELECT ${CARD} FROM tasks t WHERE t.id = $1`, [taskId]).then((r) => r.rows[0] ?? null);

  return {
    listCards: (boardId) => all(`SELECT ${CARD} FROM tasks t WHERE t.board_id = $1 ORDER BY t.column_id, t.position, t.id`, [boardId]),

    getCard,

    // Everything the task panel shows.
    async getTaskDetail(taskId) {
      const task = await one(`SELECT ${CARD}, t.description, t.completed_at AS "completedAt", t.created_by AS "createdBy" FROM tasks t WHERE t.id = $1`, [taskId]);
      if (!task) return null;
      const [checklist, attachments, comments] = await Promise.all([
        all(`SELECT ${CHECKLIST} FROM checklist_items WHERE task_id = $1 ORDER BY position, id`, [taskId]),
        all(`SELECT ${ATTACHMENT} FROM attachments WHERE task_id = $1 ORDER BY id`, [taskId]),
        all(
          `SELECT c.id, c.body, c.mentions, c.created_at AS "createdAt", c.updated_at AS "updatedAt",
                  json_build_object('id', u.id, 'name', COALESCE(u.name, 'Deleted user'), 'email', u.email, 'avatarUrl', ${avatarUrl('u')}) AS author
             FROM comments c LEFT JOIN users u ON u.id = c.user_id
            WHERE c.task_id = $1 ORDER BY c.id`,
          [taskId],
        ),
      ]);
      return { ...task, checklist, attachments, comments };
    },

    // New cards go to the end of the column (the board's first column by default).
    createTask: (boardId, userId, { title, columnId, dueDate = null, priority = 'none', description = '', repeat = null, assigneeIds = [], labelIds = [] }) =>
      db.tx(async (q) => {
        const column = (
          await q.query(
            `SELECT id, is_done FROM board_columns WHERE board_id = $1 AND ($2::int IS NULL OR id = $2)
              ORDER BY position, id LIMIT 1`,
            [boardId, columnId ?? null],
          )
        ).rows[0];
        if (!column) return null;
        const { rows } = await q.query(
          `INSERT INTO tasks (board_id, column_id, created_by, title, due_date, priority, description, repeat, done, completed_at, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $9 THEN now() END,
                   (SELECT COALESCE(max(position) + 1, 0) FROM tasks WHERE column_id = $2))
           RETURNING id`,
          [boardId, column.id, userId, title, dueDate, priority, description, repeat, column.is_done],
        );
        const taskId = rows[0].id;
        await replaceSet(q, 'task_assignees', 'user_id', taskId, assigneeIds);
        await replaceSet(q, 'task_labels', 'label_id', taskId, labelIds);
        return getCard(taskId, q);
      }),

    // Returns { task, before, next } so the caller can log what changed (next: the new
    // occurrence when this completed a repeating task).
    updateTask: (taskId, changes) =>
      db.tx(async (q) => {
        const before = (await q.query(`SELECT ${CARD}, t.description FROM tasks t WHERE t.id = $1 FOR UPDATE`, [taskId])).rows[0];
        const params = [taskId];
        const sets = ['updated_at = now()'];
        const param = (value) => `$${params.push(value)}`;
        if (changes.title !== undefined) sets.push(`title = ${param(changes.title)}`);
        if (changes.description !== undefined) sets.push(`description = ${param(changes.description)}`);
        if (changes.priority !== undefined) sets.push(`priority = ${param(changes.priority)}`);
        if (changes.repeat !== undefined) sets.push(`repeat = ${param(changes.repeat)}`);
        if (changes.dueDate !== undefined) {
          const p = param(changes.dueDate);
          // A new due date earns a new reminder.
          sets.push(`due_date = ${p}::date`, `reminded_at = CASE WHEN due_date IS DISTINCT FROM ${p}::date THEN NULL ELSE reminded_at END`);
        }
        await q.query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $1`, params);
        if (changes.assigneeIds !== undefined) await replaceSet(q, 'task_assignees', 'user_id', taskId, changes.assigneeIds);
        if (changes.labelIds !== undefined) await replaceSet(q, 'task_labels', 'label_id', taskId, changes.labelIds);

        // Ticking a card done moves it to the board's done column (and back), if there is one.
        let next = null;
        if (changes.done !== undefined && changes.done !== before.done) {
          const target = (
            await q.query(
              `SELECT id FROM board_columns WHERE board_id = $1 AND is_done = $2 ORDER BY position, id LIMIT 1`,
              [before.boardId, changes.done],
            )
          ).rows[0];
          if (target) {
            next = (await moveWithin(q, taskId, target.id, changes.done ? 0 : undefined)).next;
          } else {
            await q.query(
              `UPDATE tasks SET done = $2, completed_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1`,
              [taskId, changes.done],
            );
            if (changes.done) next = await createNextOccurrence(q, taskId);
          }
        }
        return { task: await getCard(taskId, q), before, next };
      }),

    moveTask: (taskId, columnId, index) => db.tx((q) => moveWithin(q, taskId, columnId, index)),

    async deleteTask(taskId) {
      const keys = (await all('SELECT storage_key AS key FROM attachments WHERE task_id = $1', [taskId])).map((r) => r.key);
      const row = await one('DELETE FROM tasks WHERE id = $1 RETURNING column_id', [taskId]);
      if (row) {
        const left = await all('SELECT id FROM tasks WHERE column_id = $1 ORDER BY position, id', [row.column_id]);
        await setPositions(db, 'tasks', left.map((r) => r.id));
      }
      return keys;
    },

    // ------------------------------------------------------------ checklist

    addChecklistItem: (taskId, text) =>
      one(
        `INSERT INTO checklist_items (task_id, text, position)
         VALUES ($1, $2, (SELECT COALESCE(max(position) + 1, 0) FROM checklist_items WHERE task_id = $1))
         RETURNING ${CHECKLIST}`,
        [taskId, text],
      ),

    updateChecklistItem: (itemId, { text, done }) =>
      one(
        `UPDATE checklist_items SET text = COALESCE($2, text), done = COALESCE($3, done) WHERE id = $1 RETURNING ${CHECKLIST}`,
        [itemId, text ?? null, done ?? null],
      ),

    deleteChecklistItem: async (itemId) => {
      await db.query('DELETE FROM checklist_items WHERE id = $1', [itemId]);
    },

    // ------------------------------------------------------------ comments

    addComment: async (taskId, userId, body, mentions) => {
      const { id } = await one('INSERT INTO comments (task_id, user_id, body, mentions) VALUES ($1, $2, $3, $4) RETURNING id', [
        taskId,
        userId,
        body,
        mentions,
      ]);
      return one(
        `SELECT c.id, c.body, c.mentions, c.created_at AS "createdAt", c.updated_at AS "updatedAt",
                json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'avatarUrl', ${avatarUrl('u')}) AS author
           FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
        [id],
      );
    },

    updateComment: (commentId, body, mentions) =>
      one(
        `UPDATE comments SET body = $2, mentions = $3, updated_at = now() WHERE id = $1
         RETURNING id, body, mentions, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [commentId, body, mentions],
      ),

    deleteComment: async (commentId) => {
      await db.query('DELETE FROM comments WHERE id = $1', [commentId]);
    },

    // ------------------------------------------------------------ attachments

    addAttachment: (taskId, { storageKey, filename, contentType, size }) =>
      one(
        `INSERT INTO attachments (task_id, storage_key, filename, content_type, size_bytes)
         SELECT id, $2, $3, $4, $5 FROM tasks WHERE id = $1 RETURNING ${ATTACHMENT}`,
        [taskId, storageKey, filename, contentType, size],
      ),

    getAttachment: (attachmentId) =>
      one(`SELECT ${ATTACHMENT}, storage_key AS "storageKey", task_id AS "taskId" FROM attachments WHERE id = $1`, [attachmentId]),

    async deleteAttachment(attachmentId) {
      const row = await one('DELETE FROM attachments WHERE id = $1 RETURNING storage_key AS key', [attachmentId]);
      return row?.key ?? null;
    },
  };
}
