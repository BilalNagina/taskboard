// In-app notifications. Each user's preferences decide which types they get: a missing
// preference counts as "on".
import { avatarUrl } from './users.js';

export const NOTIFICATION_TYPES = ['assigned', 'mentioned', 'comment', 'due'];

// The email switch for each emailed type ("due" has its own reminder emails). Like the
// in-app switches, a missing preference counts as "on".
export const EMAIL_PREFS = { assigned: 'emailAssigned', mentioned: 'emailMentioned', comment: 'emailComment' };
export const emailTypesFor = (prefs = {}) => Object.keys(EMAIL_PREFS).filter((type) => prefs[EMAIL_PREFS[type]] !== false);

const ENTRY = `n.id, n.type, n.data, n.read_at IS NOT NULL AS read, n.created_at AS "createdAt",
  n.workspace_id AS "workspaceId", n.board_id AS "boardId", n.task_id AS "taskId",
  t.title AS "taskTitle", b.name AS "boardName",
  CASE WHEN a.id IS NULL THEN NULL
       ELSE json_build_object('id', a.id, 'name', a.name, 'email', a.email, 'avatarUrl', ${avatarUrl('a')}) END AS actor`;

export function notificationsRepo(db) {
  const all = async (text, params) => (await db.query(text, params)).rows;

  return {
    // One notification per recipient, skipping the actor and anyone who turned the type off.
    // Returns the ids of the people notified.
    async notify({ userIds, type, actorId = null, workspaceId, boardId = null, taskId = null, data = {} }) {
      const recipients = [...new Set(userIds)].filter((id) => id !== actorId);
      if (!recipients.length) return [];
      const { rows } = await db.query(
        `INSERT INTO notifications (user_id, type, actor_id, workspace_id, board_id, task_id, data)
         SELECT u.id, $2, $3, $4, $5, $6, $7 FROM users u
          WHERE u.id = ANY($1::int[]) AND COALESCE((u.notification_prefs ->> $2)::boolean, true)
         RETURNING user_id AS "userId"`,
        [recipients, type, actorId, workspaceId, boardId, taskId, data],
      );
      return rows.map((r) => r.userId);
    },

    // Claims the person's unread, not-yet-emailed notifications of these types from the
    // last day, so two email jobs can never send the same one. Returns them in full.
    async claimEmailNotifications(userId, types) {
      const { rows } = await db.query(
        `UPDATE notifications SET emailed_at = now()
          WHERE id IN (SELECT id FROM notifications
                        WHERE user_id = $1 AND emailed_at IS NULL AND read_at IS NULL AND type = ANY($2::text[])
                          AND created_at > now() - interval '1 day'
                        ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)
          RETURNING id`,
        [userId, types],
      );
      if (!rows.length) return [];
      return all(
        `SELECT ${ENTRY} FROM notifications n
           LEFT JOIN users a ON a.id = n.actor_id LEFT JOIN tasks t ON t.id = n.task_id LEFT JOIN boards b ON b.id = n.board_id
          WHERE n.id = ANY($1::bigint[]) ORDER BY n.id`,
        [rows.map((r) => r.id)],
      );
    },

    // Puts claimed notifications back, when the email couldn't be sent.
    releaseEmailNotifications: async (ids) => {
      await db.query('UPDATE notifications SET emailed_at = NULL WHERE id = ANY($1::bigint[])', [ids]);
    },

    hasPendingEmail: async (userId, types) =>
      (
        await db.query(
          `SELECT EXISTS (SELECT 1 FROM notifications WHERE user_id = $1 AND emailed_at IS NULL AND read_at IS NULL
                            AND type = ANY($2::text[]) AND created_at > now() - interval '1 day') AS pending`,
          [userId, types],
        )
      ).rows[0].pending,

    listNotifications: (userId, { before = null, limit = 30 } = {}) =>
      all(
        `SELECT ${ENTRY} FROM notifications n
           LEFT JOIN users a ON a.id = n.actor_id LEFT JOIN tasks t ON t.id = n.task_id LEFT JOIN boards b ON b.id = n.board_id
          WHERE n.user_id = $1 AND ($2::bigint IS NULL OR n.id < $2)
          ORDER BY n.id DESC LIMIT $3`,
        [userId, before, limit],
      ),

    unreadCount: async (userId) =>
      (await db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId])).rows[0].n,

    // Marks the given ids read, or all of them when ids is omitted. Only the owner's rows change.
    markRead: async (userId, ids) => {
      await db.query(
        `UPDATE notifications SET read_at = now()
          WHERE user_id = $1 AND read_at IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2::bigint[]))`,
        [userId, ids ?? null],
      );
    },
  };
}
