// All task, board and attachment queries take the signed-in user's id and join through
// boards.user_id, so one user can never read or change another user's data.

const USER = 'u.id, u.email, u.name, u.created_at AS "createdAt"';

const TASK = `t.id, t.board_id AS "boardId", t.title, t.done, t.due_date AS "dueDate",
  t.created_at AS "createdAt", t.updated_at AS "updatedAt",
  COALESCE(
    (SELECT json_agg(json_build_object(
        'id', a.id, 'filename', a.filename, 'contentType', a.content_type,
        'size', a.size_bytes, 'createdAt', a.created_at) ORDER BY a.id)
       FROM attachments a WHERE a.task_id = t.id),
    '[]'::json) AS attachments`;

const UNIQUE_VIOLATION = '23505';

export function createRepo(db) {
  const one = async (text, params) => (await db.query(text, params)).rows[0] ?? null;
  const all = async (text, params) => (await db.query(text, params)).rows;

  const getTask = (userId, taskId) =>
    one(
      `SELECT ${TASK} FROM tasks t JOIN boards b ON b.id = t.board_id
        WHERE t.id = $1 AND b.user_id = $2`,
      [taskId, userId],
    );

  return {
    // ------------------------------------------------------------ users

    async createUser({ email, name, passwordHash }) {
      try {
        return await one(
          `INSERT INTO users AS u (email, name, password_hash) VALUES ($1, $2, $3) RETURNING ${USER}`,
          [email, name, passwordHash],
        );
      } catch (err) {
        if (err.code === UNIQUE_VIOLATION) return null;
        throw err;
      }
    },

    findUserById: (id) => one(`SELECT ${USER} FROM users u WHERE u.id = $1`, [id]),

    findUserForLogin: (email) =>
      one(`SELECT ${USER}, u.password_hash AS "passwordHash" FROM users u WHERE u.email = $1`, [email]),

    // ------------------------------------------------------------ boards

    listBoards: (userId) =>
      all(
        `SELECT b.id, b.name, b.created_at AS "createdAt",
                count(t.id)::int AS "taskCount",
                count(t.id) FILTER (WHERE NOT t.done)::int AS "openCount"
           FROM boards b LEFT JOIN tasks t ON t.board_id = b.id
          WHERE b.user_id = $1
          GROUP BY b.id ORDER BY b.id`,
        [userId],
      ),

    createBoard: (userId, name) =>
      one(
        `INSERT INTO boards (user_id, name) VALUES ($1, $2)
         RETURNING id, name, created_at AS "createdAt", 0 AS "taskCount", 0 AS "openCount"`,
        [userId, name],
      ),

    renameBoard: (userId, boardId, name) =>
      one(
        `UPDATE boards SET name = $3 WHERE id = $1 AND user_id = $2
         RETURNING id, name, created_at AS "createdAt"`,
        [boardId, userId, name],
      ),

    // Returns the storage keys of the deleted attachments (so the caller can remove the
    // files), or null if the board doesn't exist for this user.
    async deleteBoard(userId, boardId) {
      const keys = await all(
        `SELECT a.storage_key AS key FROM attachments a
           JOIN tasks t ON t.id = a.task_id JOIN boards b ON b.id = t.board_id
          WHERE b.id = $1 AND b.user_id = $2`,
        [boardId, userId],
      );
      const { rowCount } = await db.query('DELETE FROM boards WHERE id = $1 AND user_id = $2', [boardId, userId]);
      return rowCount ? keys.map((k) => k.key) : null;
    },

    // ------------------------------------------------------------ tasks

    // Returns null if the board doesn't exist for this user.
    async listTasks(userId, boardId) {
      const board = await one('SELECT id FROM boards WHERE id = $1 AND user_id = $2', [boardId, userId]);
      if (!board) return null;
      return all(
        `SELECT ${TASK} FROM tasks t WHERE t.board_id = $1
          ORDER BY t.done, t.due_date NULLS LAST, t.id`,
        [boardId],
      );
    },

    getTask,

    async createTask(userId, boardId, { title, dueDate = null }) {
      const row = await one(
        `INSERT INTO tasks (board_id, title, due_date)
         SELECT b.id, $3, $4 FROM boards b WHERE b.id = $1 AND b.user_id = $2
         RETURNING id`,
        [boardId, userId, title, dueDate],
      );
      return row && getTask(userId, row.id);
    },

    async updateTask(userId, taskId, { title, done, dueDate }) {
      const params = [taskId, userId];
      const sets = ['updated_at = now()'];
      const param = (value) => `$${params.push(value)}`;
      if (title !== undefined) sets.push(`title = ${param(title)}`);
      if (done !== undefined) sets.push(`done = ${param(done)}`);
      if (dueDate !== undefined) {
        const p = param(dueDate);
        // A new due date earns a new reminder.
        sets.push(
          `due_date = ${p}::date`,
          `reminded_at = CASE WHEN t.due_date IS DISTINCT FROM ${p}::date THEN NULL ELSE t.reminded_at END`,
        );
      }
      const row = await one(
        `UPDATE tasks t SET ${sets.join(', ')} FROM boards b
          WHERE t.id = $1 AND b.id = t.board_id AND b.user_id = $2 RETURNING t.id`,
        params,
      );
      return row && getTask(userId, taskId);
    },

    async deleteTask(userId, taskId) {
      const keys = await all(
        `SELECT a.storage_key AS key FROM attachments a
           JOIN tasks t ON t.id = a.task_id JOIN boards b ON b.id = t.board_id
          WHERE t.id = $1 AND b.user_id = $2`,
        [taskId, userId],
      );
      const { rowCount } = await db.query(
        'DELETE FROM tasks t USING boards b WHERE t.id = $1 AND b.id = t.board_id AND b.user_id = $2',
        [taskId, userId],
      );
      return rowCount ? keys.map((k) => k.key) : null;
    },

    // ------------------------------------------------------------ attachments

    addAttachment: (userId, taskId, { storageKey, filename, contentType, size }) =>
      one(
        `INSERT INTO attachments (task_id, storage_key, filename, content_type, size_bytes)
         SELECT t.id, $3, $4, $5, $6 FROM tasks t JOIN boards b ON b.id = t.board_id
          WHERE t.id = $1 AND b.user_id = $2
         RETURNING id, filename, content_type AS "contentType", size_bytes AS size, created_at AS "createdAt"`,
        [taskId, userId, storageKey, filename, contentType, size],
      ),

    getAttachment: (userId, attachmentId) =>
      one(
        `SELECT a.id, a.storage_key AS "storageKey", a.filename, a.content_type AS "contentType",
                a.size_bytes AS size
           FROM attachments a JOIN tasks t ON t.id = a.task_id JOIN boards b ON b.id = t.board_id
          WHERE a.id = $1 AND b.user_id = $2`,
        [attachmentId, userId],
      ),

    async deleteAttachment(userId, attachmentId) {
      const row = await one(
        `DELETE FROM attachments a USING tasks t, boards b
          WHERE a.id = $1 AND t.id = a.task_id AND b.id = t.board_id AND b.user_id = $2
         RETURNING a.storage_key AS key`,
        [attachmentId, userId],
      );
      return row?.key ?? null;
    },

    // ------------------------------------------------------------ reminders (worker)

    // Open tasks due today or tomorrow (or overdue) that haven't had a reminder yet.
    tasksNeedingReminder: (limit = 500) =>
      all(
        `SELECT id, due_date AS "dueDate" FROM tasks
          WHERE NOT done AND reminded_at IS NULL AND due_date <= current_date + 1
          ORDER BY due_date, id LIMIT $1`,
        [limit],
      ),

    // Re-checked right before sending: the task may have been completed, deleted or
    // given a new due date since the scan queued it.
    reminderDetails: (taskId, dueDate) =>
      one(
        `SELECT t.id, t.title, t.due_date AS "dueDate", b.name AS "boardName",
                u.email, u.name AS "userName"
           FROM tasks t JOIN boards b ON b.id = t.board_id JOIN users u ON u.id = b.user_id
          WHERE t.id = $1 AND t.due_date = $2 AND NOT t.done AND t.reminded_at IS NULL`,
        [taskId, dueDate],
      ),

    async markReminded(taskId, dueDate) {
      const { rowCount } = await db.query(
        'UPDATE tasks SET reminded_at = now() WHERE id = $1 AND due_date = $2 AND reminded_at IS NULL',
        [taskId, dueDate],
      );
      return rowCount > 0;
    },
  };
}
