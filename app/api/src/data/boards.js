// Boards, their columns and labels. Callers check access first; these queries work on
// ids they've already been allowed to touch.
import { TEMPLATES } from '../templates.js';

const BOARD = `b.id, b.workspace_id AS "workspaceId", b.name, b.created_at AS "createdAt",
  (SELECT count(*)::int FROM tasks t WHERE t.board_id = b.id) AS "taskCount",
  (SELECT count(*)::int FROM tasks t WHERE t.board_id = b.id AND NOT t.done) AS "openCount"`;

const COLUMN = 'id, board_id AS "boardId", name, position, is_done AS "isDone"';
const LABEL = 'id, board_id AS "boardId", name, color';

export const LABEL_COLORS = ['gray', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'];

// Fills a new board with a template's columns, labels and example cards. `userId` is
// who the template's "assign" cards go to (and who created the cards, if `createdBy`).
// `today` anchors the cards' due dates; the database's date when it isn't given.
export async function applyTemplate(q, boardId, templateKey, { userId, createdBy = userId, today = null }) {
  const template = TEMPLATES[templateKey];
  const columns = (
    await q.query(
      `INSERT INTO board_columns (board_id, name, is_done, position)
       SELECT $1, c.name, c.done, c.pos - 1 FROM unnest($2::text[], $3::boolean[]) WITH ORDINALITY AS c (name, done, pos)
       RETURNING id, position, is_done`,
      [boardId, template.columns.map((c) => c.name), template.columns.map((c) => Boolean(c.done))],
    )
  ).rows.sort((a, b) => a.position - b.position);
  const labels = (
    await q.query(
      `INSERT INTO labels (board_id, name, color) SELECT $1, l.name, l.color FROM unnest($2::text[], $3::text[]) AS l (name, color)
       RETURNING id, name`,
      [boardId, template.labels.map(([name]) => name), template.labels.map(([, color]) => color)],
    )
  ).rows;
  const labelId = new Map(labels.map((l) => [l.name, l.id]));
  const nextPosition = columns.map(() => 0);

  for (const task of template.tasks) {
    const column = columns[task.column];
    const { rows } = await q.query(
      `INSERT INTO tasks (board_id, column_id, created_by, title, description, priority, repeat, position, done, completed_at, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $9 THEN now() END,
               CASE WHEN $10::int IS NOT NULL THEN COALESCE($11::date, current_date) + $10::int END)
       RETURNING id`,
      [
        boardId,
        column.id,
        createdBy,
        task.title,
        task.description ?? '',
        task.priority ?? 'none',
        task.repeat ?? null,
        nextPosition[task.column]++,
        column.is_done,
        task.due ?? null,
        today,
      ],
    );
    const taskId = rows[0].id;
    if (task.labels?.length) {
      await q.query('INSERT INTO task_labels (task_id, label_id) SELECT $1, unnest($2::int[])', [taskId, task.labels.map((name) => labelId.get(name))]);
    }
    if (task.assign && userId) await q.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2)', [taskId, userId]);
    if (task.checklist?.length) {
      const items = task.checklist.map((item) => (Array.isArray(item) ? item : [item, false]));
      await q.query(
        `INSERT INTO checklist_items (task_id, text, done, position)
         SELECT $1, i.text, i.done, i.pos - 1 FROM unnest($2::text[], $3::boolean[]) WITH ORDINALITY AS i (text, done, pos)`,
        [taskId, items.map(([text]) => text), items.map(([, done]) => done)],
      );
    }
  }
}

// Rewrites positions 0..n-1 in the given order.
export async function setPositions(q, table, orderedIds) {
  await q.query(
    `UPDATE ${table} x SET position = o.pos - 1
       FROM unnest($1::int[]) WITH ORDINALITY AS o (id, pos) WHERE x.id = o.id`,
    [orderedIds],
  );
}

const clamp = (value, max) => Math.max(0, Math.min(value, max));

export function boardsRepo(db) {
  const one = async (text, params) => (await db.query(text, params)).rows[0] ?? null;
  const all = async (text, params) => (await db.query(text, params)).rows;

  return {
    // ------------------------------------------------------------ boards

    listBoards: (workspaceId) =>
      all(`SELECT ${BOARD} FROM boards b WHERE b.workspace_id = $1 ORDER BY b.id`, [workspaceId]),

    getBoard: (boardId) => one(`SELECT ${BOARD} FROM boards b WHERE b.id = $1`, [boardId]),

    createBoard: (workspaceId, userId, { name, template = 'blank', today = null }) =>
      db.tx(async (q) => {
        const { rows } = await q.query(
          'INSERT INTO boards (workspace_id, created_by, name) VALUES ($1, $2, $3) RETURNING id',
          [workspaceId, userId, name],
        );
        await applyTemplate(q, rows[0].id, template, { userId, today });
        return (await q.query(`SELECT ${BOARD} FROM boards b WHERE b.id = $1`, [rows[0].id])).rows[0];
      }),

    renameBoard: (boardId, name) =>
      one(`WITH b AS (UPDATE boards SET name = $2 WHERE id = $1 RETURNING *) SELECT ${BOARD} FROM b`, [boardId, name]),

    // Returns the storage keys of the board's attachments, so the caller can delete the files.
    async deleteBoard(boardId) {
      const keys = (
        await all(
          'SELECT a.storage_key AS key FROM attachments a JOIN tasks t ON t.id = a.task_id WHERE t.board_id = $1',
          [boardId],
        )
      ).map((row) => row.key);
      await db.query('DELETE FROM boards WHERE id = $1', [boardId]);
      return keys;
    },

    // ------------------------------------------------------------ columns

    listColumns: (boardId) => all(`SELECT ${COLUMN} FROM board_columns WHERE board_id = $1 ORDER BY position, id`, [boardId]),

    getColumn: (columnId) => one(`SELECT ${COLUMN} FROM board_columns WHERE id = $1`, [columnId]),

    createColumn: (boardId, { name, isDone = false }) =>
      one(
        `INSERT INTO board_columns (board_id, name, is_done, position)
         VALUES ($1, $2, $3, (SELECT COALESCE(max(position) + 1, 0) FROM board_columns WHERE board_id = $1))
         RETURNING ${COLUMN}`,
        [boardId, name, isDone],
      ),

    // Changing whether a column counts as done updates its cards to match.
    updateColumn: (columnId, { name, isDone }) =>
      db.tx(async (q) => {
        const column = (
          await q.query(
            `UPDATE board_columns SET name = COALESCE($2, name), is_done = COALESCE($3, is_done)
              WHERE id = $1 RETURNING ${COLUMN}`,
            [columnId, name ?? null, isDone ?? null],
          )
        ).rows[0];
        if (isDone !== undefined) {
          await q.query(
            `UPDATE tasks SET done = $2,
                    completed_at = CASE WHEN $2 THEN COALESCE(completed_at, now()) ELSE NULL END
              WHERE column_id = $1 AND done <> $2`,
            [columnId, isDone],
          );
        }
        return column;
      }),

    moveColumn: (columnId, index) =>
      db.tx(async (q) => {
        const column = (await q.query('SELECT board_id FROM board_columns WHERE id = $1', [columnId])).rows[0];
        const ids = (
          await q.query('SELECT id FROM board_columns WHERE board_id = $1 AND id <> $2 ORDER BY position, id FOR UPDATE', [
            column.board_id,
            columnId,
          ])
        ).rows.map((r) => r.id);
        ids.splice(clamp(index, ids.length), 0, columnId);
        await setPositions(q, 'board_columns', ids);
      }),

    // Cards move to the end of `moveToId` first. Returns false if this is the board's last column.
    deleteColumn: (columnId, moveToId) =>
      db.tx(async (q) => {
        const column = (await q.query('SELECT board_id FROM board_columns WHERE id = $1 FOR UPDATE', [columnId])).rows[0];
        const remaining = (
          await q.query('SELECT id, is_done FROM board_columns WHERE board_id = $1 AND id <> $2 ORDER BY position, id', [
            column.board_id,
            columnId,
          ])
        ).rows;
        if (remaining.length === 0) return false;
        const target = remaining.find((c) => c.id === moveToId) ?? remaining[0];
        const moving = (await q.query('SELECT id FROM tasks WHERE column_id = $1 ORDER BY position, id', [columnId])).rows;
        if (moving.length) {
          const existing = (await q.query('SELECT id FROM tasks WHERE column_id = $1 ORDER BY position, id', [target.id])).rows;
          await q.query(
            `UPDATE tasks SET column_id = $2, done = $3,
                    completed_at = CASE WHEN $3 THEN COALESCE(completed_at, now()) ELSE NULL END
              WHERE column_id = $1`,
            [columnId, target.id, target.is_done],
          );
          await setPositions(q, 'tasks', [...existing, ...moving].map((r) => r.id));
        }
        await q.query('DELETE FROM board_columns WHERE id = $1', [columnId]);
        await setPositions(q, 'board_columns', remaining.map((c) => c.id));
        return { movedTo: target.id };
      }),

    // ------------------------------------------------------------ labels

    listLabels: (boardId) => all(`SELECT ${LABEL} FROM labels WHERE board_id = $1 ORDER BY id`, [boardId]),

    getLabel: (labelId) => one(`SELECT ${LABEL} FROM labels WHERE id = $1`, [labelId]),

    createLabel: (boardId, { name, color }) =>
      one(
        `INSERT INTO labels (board_id, name, color) VALUES ($1, $2, $3)
         ON CONFLICT (board_id, name) DO NOTHING RETURNING ${LABEL}`,
        [boardId, name, color],
      ),

    updateLabel: async (labelId, { name, color }) => {
      try {
        return await one(
          `UPDATE labels SET name = COALESCE($2, name), color = COALESCE($3, color) WHERE id = $1 RETURNING ${LABEL}`,
          [labelId, name ?? null, color ?? null],
        );
      } catch (err) {
        if (err.code === '23505') return null;
        throw err;
      }
    },

    deleteLabel: async (labelId) => {
      await db.query('DELETE FROM labels WHERE id = $1', [labelId]);
    },

    // Ids from `ids` that are labels on this board.
    validLabelIds: async (boardId, ids) =>
      ids.length
        ? (await all('SELECT id FROM labels WHERE board_id = $1 AND id = ANY($2::int[])', [boardId, ids])).map((r) => r.id)
        : [],
  };
}
