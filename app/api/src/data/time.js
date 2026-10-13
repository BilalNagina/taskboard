// Time tracking: a running timer per person, time entered by hand, and the timesheet.
// Callers check access first.
import { avatarUrl } from './users.js';

const ENTRY = `e.id, e.task_id AS "taskId", e.day, e.minutes, e.started_at AS "startedAt", e.note, e.created_at AS "createdAt",
  json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'avatarUrl', ${avatarUrl('u')}) AS "user"`;

// Whole minutes since the timer started, at least 1 and at most a day.
const ELAPSED = 'LEAST(1440, GREATEST(1, round(extract(epoch FROM now() - started_at) / 60)))::int';

export function timeRepo(db) {
  const one = async (text, params) => (await db.query(text, params)).rows[0] ?? null;
  const all = async (text, params) => (await db.query(text, params)).rows;

  const stopRunning = (q, userId) =>
    q.query(`UPDATE time_entries SET minutes = ${ELAPSED} WHERE user_id = $1 AND minutes IS NULL RETURNING id, task_id AS "taskId", minutes`, [
      userId,
    ]);

  return {
    // The person's running timer, with where its task lives, or null.
    runningTimer: (userId) =>
      one(
        `SELECT e.id, e.task_id AS "taskId", e.started_at AS "startedAt", e.day, t.title, t.board_id AS "boardId", b.workspace_id AS "workspaceId"
           FROM time_entries e JOIN tasks t ON t.id = e.task_id JOIN boards b ON b.id = t.board_id
          WHERE e.user_id = $1 AND e.minutes IS NULL`,
        [userId],
      ),

    // Starting a timer stops the one already running, if any. Returns the stopped entry.
    startTimer: (userId, taskId, day) =>
      db.tx(async (q) => {
        const stopped = (await stopRunning(q, userId)).rows[0] ?? null;
        await q.query('INSERT INTO time_entries (task_id, user_id, day, started_at) VALUES ($1, $2, $3, now())', [taskId, userId, day]);
        return stopped;
      }),

    // Returns the finished entry, or null if no timer was running.
    stopTimer: async (userId) => (await stopRunning(db, userId)).rows[0] ?? null,

    addTimeEntry: async (taskId, userId, { day, minutes, note = '' }) =>
      one(
        `INSERT INTO time_entries (task_id, user_id, day, minutes, note) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, task_id AS "taskId", day, minutes, note`,
        [taskId, userId, day, minutes, note],
      ),

    deleteTimeEntry: async (entryId) => {
      await db.query('DELETE FROM time_entries WHERE id = $1', [entryId]);
    },

    timeEntryAccess: (userId, entryId) =>
      one(
        `SELECT m.role, e.user_id AS "ownerId", e.task_id AS "taskId", t.board_id AS "boardId", b.workspace_id AS "workspaceId"
           FROM time_entries e JOIN tasks t ON t.id = e.task_id JOIN boards b ON b.id = t.board_id
           JOIN workspace_members m ON m.workspace_id = b.workspace_id AND m.user_id = $1
          WHERE e.id = $2`,
        [userId, entryId],
      ),

    // A task's entries, newest first; the total leaves out running timers.
    async taskTime(taskId) {
      const entries = await all(
        `SELECT ${ENTRY} FROM time_entries e JOIN users u ON u.id = e.user_id
          WHERE e.task_id = $1 ORDER BY e.day DESC, e.id DESC LIMIT 100`,
        [taskId],
      );
      const { total } = await one('SELECT COALESCE(sum(minutes), 0)::int AS total FROM time_entries WHERE task_id = $1', [taskId]);
      return { totalMinutes: total, entries };
    },

    // Finished time per task, person and day across the workspace, for the timesheet grid.
    timesheet: (workspaceId, { from, to, userId = null }) =>
      all(
        `SELECT e.task_id AS "taskId", t.title, t.board_id AS "boardId", b.name AS "boardName",
                e.user_id AS "userId", e.day, sum(e.minutes)::int AS minutes
           FROM time_entries e JOIN tasks t ON t.id = e.task_id JOIN boards b ON b.id = t.board_id
          WHERE b.workspace_id = $1 AND e.day BETWEEN $2 AND $3 AND e.minutes IS NOT NULL
            AND ($4::int IS NULL OR e.user_id = $4)
          GROUP BY e.task_id, t.title, t.board_id, b.name, e.user_id, e.day
          ORDER BY b.name, t.title, e.day`,
        [workspaceId, from, to, userId],
      ),

    // Every finished entry in the range, for the CSV export.
    timesheetEntries: (workspaceId, { from, to, userId = null }) =>
      all(
        `SELECT e.day, u.name AS person, b.name AS board, t.title AS task, e.minutes, e.note
           FROM time_entries e JOIN tasks t ON t.id = e.task_id JOIN boards b ON b.id = t.board_id
           JOIN users u ON u.id = e.user_id
          WHERE b.workspace_id = $1 AND e.day BETWEEN $2 AND $3 AND e.minutes IS NOT NULL
            AND ($4::int IS NULL OR e.user_id = $4)
          ORDER BY e.day, u.name, b.name, t.title, e.id`,
        [workspaceId, from, to, userId],
      ),
  };
}
