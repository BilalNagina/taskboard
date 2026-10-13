// Callers check access first (workspacesRepo.boardAccess / taskAccess); these queries
// work on ids they've already been allowed to touch.

const BOARD = `b.id, b.workspace_id AS "workspaceId", b.name, b.created_at AS "createdAt",
  (SELECT count(*)::int FROM tasks t WHERE t.board_id = b.id) AS "taskCount",
  (SELECT count(*)::int FROM tasks t WHERE t.board_id = b.id AND NOT t.done) AS "openCount"`;

const TASK = `t.id, t.board_id AS "boardId", t.title, t.done, t.due_date AS "dueDate",
  t.created_at AS "createdAt", t.updated_at AS "updatedAt",
  COALESCE(
    (SELECT json_agg(json_build_object(
        'id', a.id, 'filename', a.filename, 'contentType', a.content_type,
        'size', a.size_bytes, 'createdAt', a.created_at) ORDER BY a.id)
       FROM attachments a WHERE a.task_id = t.id),
    '[]'::json) AS attachments`;

export function boardsRepo(db) {
  const one = async (text, params) => (await db.query(text, params)).rows[0] ?? null;
  const all = async (text, params) => (await db.query(text, params)).rows;
  const keysFor = async (where, params) =>
    (
      await all(
        `SELECT a.storage_key AS key FROM attachments a JOIN tasks t ON t.id = a.task_id WHERE ${where}`,
        params,
      )
    ).map((row) => row.key);

  const getTask = (taskId) => one(`SELECT ${TASK} FROM tasks t WHERE t.id = $1`, [taskId]);

  return {
    // ------------------------------------------------------------ boards

    listBoards: (workspaceId) =>
      all(`SELECT ${BOARD} FROM boards b WHERE b.workspace_id = $1 ORDER BY b.id`, [workspaceId]),

    getBoard: (boardId) => one(`SELECT ${BOARD} FROM boards b WHERE b.id = $1`, [boardId]),

    createBoard: (workspaceId, userId, name) =>
      one(
        `WITH b AS (INSERT INTO boards (workspace_id, created_by, name) VALUES ($1, $2, $3) RETURNING *)
         SELECT ${BOARD} FROM b`,
        [workspaceId, userId, name],
      ),

    renameBoard: (boardId, name) =>
      one(
        `WITH b AS (UPDATE boards SET name = $2 WHERE id = $1 RETURNING *) SELECT ${BOARD} FROM b`,
        [boardId, name],
      ),

    // Returns the storage keys of the board's attachments, so the caller can delete the files.
    async deleteBoard(boardId) {
      const keys = await keysFor('t.board_id = $1', [boardId]);
      await db.query('DELETE FROM boards WHERE id = $1', [boardId]);
      return keys;
    },

    // ------------------------------------------------------------ tasks

    listTasks: (boardId) =>
      all(`SELECT ${TASK} FROM tasks t WHERE t.board_id = $1 ORDER BY t.done, t.due_date NULLS LAST, t.id`, [
        boardId,
      ]),

    getTask,

    async createTask(boardId, userId, { title, dueDate = null }) {
      const row = await one(
        'INSERT INTO tasks (board_id, created_by, title, due_date) VALUES ($1, $2, $3, $4) RETURNING id',
        [boardId, userId, title, dueDate],
      );
      return getTask(row.id);
    },

    async updateTask(taskId, { title, done, dueDate }) {
      const params = [taskId];
      const sets = ['updated_at = now()'];
      const param = (value) => `$${params.push(value)}`;
      if (title !== undefined) sets.push(`title = ${param(title)}`);
      if (done !== undefined) sets.push(`done = ${param(done)}`);
      if (dueDate !== undefined) {
        const p = param(dueDate);
        // A new due date earns a new reminder.
        sets.push(
          `due_date = ${p}::date`,
          `reminded_at = CASE WHEN due_date IS DISTINCT FROM ${p}::date THEN NULL ELSE reminded_at END`,
        );
      }
      await db.query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $1`, params);
      return getTask(taskId);
    },

    async deleteTask(taskId) {
      const keys = await keysFor('t.id = $1', [taskId]);
      await db.query('DELETE FROM tasks WHERE id = $1', [taskId]);
      return keys;
    },

    // ------------------------------------------------------------ attachments

    addAttachment: (taskId, { storageKey, filename, contentType, size }) =>
      one(
        `INSERT INTO attachments (task_id, storage_key, filename, content_type, size_bytes)
         SELECT id, $2, $3, $4, $5 FROM tasks WHERE id = $1
         RETURNING id, filename, content_type AS "contentType", size_bytes AS size, created_at AS "createdAt"`,
        [taskId, storageKey, filename, contentType, size],
      ),

    getAttachment: (attachmentId) =>
      one(
        `SELECT id, storage_key AS "storageKey", filename, content_type AS "contentType", size_bytes AS size
           FROM attachments WHERE id = $1`,
        [attachmentId],
      ),

    async deleteAttachment(attachmentId) {
      const row = await one('DELETE FROM attachments WHERE id = $1 RETURNING storage_key AS key', [attachmentId]);
      return row?.key ?? null;
    },
  };
}
