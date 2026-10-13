// What the workspace admin panel and the plan limits need: usage counts, per-member
// figures, the plan itself, and deleting a workspace. Callers check access first.
import { avatarUrl } from './users.js';

export function adminRepo(db) {
  const one = async (text, params) => (await db.query(text, params)).rows[0] ?? null;
  const all = async (text, params) => (await db.query(text, params)).rows;

  return {
    async usage(workspaceId) {
      return one(
        `SELECT (SELECT count(*)::int FROM workspace_members WHERE workspace_id = $1) AS members,
                (SELECT count(*)::int FROM invites WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > now()) AS "pendingInvites",
                (SELECT count(*)::int FROM boards WHERE workspace_id = $1) AS boards,
                (SELECT count(*)::int FROM tasks t JOIN boards b ON b.id = t.board_id WHERE b.workspace_id = $1) AS tasks,
                (SELECT count(*)::int FROM tasks t JOIN boards b ON b.id = t.board_id WHERE b.workspace_id = $1 AND NOT t.done) AS "openTasks",
                (SELECT count(*)::int FROM attachments a JOIN tasks t ON t.id = a.task_id JOIN boards b ON b.id = t.board_id
                  WHERE b.workspace_id = $1) AS files,
                (SELECT COALESCE(sum(a.size_bytes), 0)::bigint FROM attachments a JOIN tasks t ON t.id = a.task_id JOIN boards b ON b.id = t.board_id
                  WHERE b.workspace_id = $1) AS "storageBytes",
                (SELECT COALESCE(sum(e.minutes), 0)::int FROM time_entries e JOIN tasks t ON t.id = e.task_id JOIN boards b ON b.id = t.board_id
                  WHERE b.workspace_id = $1 AND e.day > current_date - 30) AS "minutesLast30Days"`,
        [workspaceId],
      );
    },

    // Each member with when they last did something and their recent workload.
    memberStats: (workspaceId) =>
      all(
        `SELECT u.id, u.name, u.email, ${avatarUrl('u')} AS "avatarUrl", m.role, m.joined_at AS "joinedAt",
                (SELECT max(a.created_at) FROM activity a WHERE a.workspace_id = $1 AND a.actor_id = u.id) AS "lastActiveAt",
                (SELECT count(*)::int FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id JOIN boards b ON b.id = t.board_id
                  WHERE ta.user_id = u.id AND b.workspace_id = $1 AND NOT t.done) AS "openTasks",
                (SELECT count(*)::int FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id JOIN boards b ON b.id = t.board_id
                  WHERE ta.user_id = u.id AND b.workspace_id = $1 AND t.done AND t.completed_at > now() - interval '30 days') AS "completedLast30Days",
                (SELECT COALESCE(sum(e.minutes), 0)::int FROM time_entries e JOIN tasks t ON t.id = e.task_id JOIN boards b ON b.id = t.board_id
                  WHERE e.user_id = u.id AND b.workspace_id = $1 AND e.day > current_date - 30) AS "minutesLast30Days"
           FROM workspace_members m JOIN users u ON u.id = m.user_id
          WHERE m.workspace_id = $1
          ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, u.name`,
        [workspaceId],
      ),

    setPlan: (workspaceId, plan) =>
      one('UPDATE workspaces SET plan = $2 WHERE id = $1 RETURNING id, name, plan, created_at AS "createdAt"', [workspaceId, plan]),

    // ------------------------------------------------------------ limits

    boardCount: async (workspaceId) => (await one('SELECT count(*)::int AS n FROM boards WHERE workspace_id = $1', [workspaceId])).n,

    memberCount: async (workspaceId) =>
      (await one('SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = $1', [workspaceId])).n,

    // Members plus pending invites, since each invite holds a seat. An invite to
    // `exceptEmail` is left out: inviting the same address again replaces it.
    seatsTaken: async (workspaceId, exceptEmail = null) =>
      (
        await one(
          `SELECT (SELECT count(*) FROM workspace_members WHERE workspace_id = $1)
                + (SELECT count(*) FROM invites WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > now()
                     AND email IS DISTINCT FROM $2) AS n`,
          [workspaceId, exceptEmail],
        )
      ).n,

    storageUsed: async (workspaceId) =>
      (
        await one(
          `SELECT COALESCE(sum(a.size_bytes), 0)::bigint AS n
             FROM attachments a JOIN tasks t ON t.id = a.task_id JOIN boards b ON b.id = t.board_id WHERE b.workspace_id = $1`,
          [workspaceId],
        )
      ).n,

    // ------------------------------------------------------------ deleting

    membershipCount: async (userId) => (await one('SELECT count(*)::int AS n FROM workspace_members WHERE user_id = $1', [userId])).n,

    // Everything in the workspace goes with it. Returns the attachment storage keys, so
    // the caller can delete the files.
    async deleteWorkspace(workspaceId) {
      const keys = (
        await all(
          `SELECT a.storage_key AS key FROM attachments a JOIN tasks t ON t.id = a.task_id JOIN boards b ON b.id = t.board_id
            WHERE b.workspace_id = $1`,
          [workspaceId],
        )
      ).map((r) => r.key);
      await db.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      return keys;
    },
  };
}
