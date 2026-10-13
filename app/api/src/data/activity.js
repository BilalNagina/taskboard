// The activity log: one row per thing that happened, with who did it. Boards and tasks
// show their slice of it; notifications (later) are built from the same events.

import { avatarUrl } from './users.js';

const ENTRY = `a.id, a.type, a.data, a.created_at AS "createdAt", a.board_id AS "boardId", a.task_id AS "taskId",
  json_build_object('id', u.id, 'name', COALESCE(u.name, 'Someone'), 'email', u.email, 'avatarUrl', ${avatarUrl('u')}) AS actor,
  t.title AS "taskTitle"`;

export function activityRepo(db) {
  const all = async (text, params) => (await db.query(text, params)).rows;

  return {
    logActivity: async ({ workspaceId, boardId = null, taskId = null, actorId, type, data = {} }) => {
      await db.query(
        `INSERT INTO activity (workspace_id, board_id, task_id, actor_id, type, data) VALUES ($1, $2, $3, $4, $5, $6)`,
        [workspaceId, boardId, taskId, actorId, type, data],
      );
    },

    // Newest first; pass the last id seen as `before` for the next page.
    boardActivity: (boardId, { before = null, limit = 50 } = {}) =>
      all(
        `SELECT ${ENTRY} FROM activity a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN tasks t ON t.id = a.task_id
          WHERE a.board_id = $1 AND ($2::bigint IS NULL OR a.id < $2)
          ORDER BY a.id DESC LIMIT $3`,
        [boardId, before, limit],
      ),

    taskActivity: (taskId, limit = 30) =>
      all(
        `SELECT ${ENTRY} FROM activity a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN tasks t ON t.id = a.task_id
          WHERE a.task_id = $1 ORDER BY a.id DESC LIMIT $2`,
        [taskId, limit],
      ),
  };
}
