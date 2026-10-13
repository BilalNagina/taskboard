// Roles, lowest to highest. A role can do everything the roles before it can.
export const ROLES = ['viewer', 'member', 'owner'];
export const roleAtLeast = (role, needed) => ROLES.indexOf(role) >= ROLES.indexOf(needed);

export function workspacesRepo(db) {
  const one = async (text, params) => (await db.query(text, params)).rows[0] ?? null;
  const all = async (text, params) => (await db.query(text, params)).rows;

  return {
    listWorkspaces: (userId) =>
      all(
        `SELECT w.id, w.name, w.plan, m.role, w.created_at AS "createdAt",
                (SELECT count(*)::int FROM workspace_members x WHERE x.workspace_id = w.id) AS "memberCount",
                (SELECT count(*)::int FROM boards b WHERE b.workspace_id = w.id) AS "boardCount"
           FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
          WHERE m.user_id = $1
          ORDER BY w.id`,
        [userId],
      ),

    createWorkspace: (userId, name) =>
      db.tx(async (q) => {
        const workspace = (
          await q.query(
            `INSERT INTO workspaces (name) VALUES ($1)
             RETURNING id, name, plan, created_at AS "createdAt"`,
            [name],
          )
        ).rows[0];
        await q.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [
          workspace.id,
          userId,
        ]);
        return { ...workspace, role: 'owner', memberCount: 1, boardCount: 0 };
      }),

    renameWorkspace: (workspaceId, name) =>
      one(
        `UPDATE workspaces SET name = $2 WHERE id = $1
         RETURNING id, name, plan, created_at AS "createdAt"`,
        [workspaceId, name],
      ),

    // ------------------------------------------------------------ access checks
    // Each returns the user's role in the workspace that owns the thing, or null if they
    // aren't a member (callers answer 404, so outsiders can't tell whether it exists).

    workspaceRole: async (userId, workspaceId) =>
      (await one('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]))
        ?.role ?? null,

    // Every access check returns the role plus the ids callers need for logging.
    boardAccess: (userId, boardId) =>
      one(
        `SELECT m.role, b.id AS "boardId", b.workspace_id AS "workspaceId"
           FROM boards b JOIN workspace_members m ON m.workspace_id = b.workspace_id AND m.user_id = $1
          WHERE b.id = $2`,
        [userId, boardId],
      ),

    columnAccess: (userId, columnId) =>
      one(
        `SELECT m.role, c.board_id AS "boardId", b.workspace_id AS "workspaceId"
           FROM board_columns c JOIN boards b ON b.id = c.board_id
           JOIN workspace_members m ON m.workspace_id = b.workspace_id AND m.user_id = $1
          WHERE c.id = $2`,
        [userId, columnId],
      ),

    labelAccess: (userId, labelId) =>
      one(
        `SELECT m.role, l.board_id AS "boardId", b.workspace_id AS "workspaceId"
           FROM labels l JOIN boards b ON b.id = l.board_id
           JOIN workspace_members m ON m.workspace_id = b.workspace_id AND m.user_id = $1
          WHERE l.id = $2`,
        [userId, labelId],
      ),

    taskAccess: (userId, taskId) =>
      one(
        `SELECT m.role, t.id AS "taskId", t.board_id AS "boardId", b.workspace_id AS "workspaceId", t.title
           FROM tasks t JOIN boards b ON b.id = t.board_id
           JOIN workspace_members m ON m.workspace_id = b.workspace_id AND m.user_id = $1
          WHERE t.id = $2`,
        [userId, taskId],
      ),

    checklistAccess: (userId, itemId) =>
      one(
        `SELECT m.role, i.task_id AS "taskId", t.board_id AS "boardId", b.workspace_id AS "workspaceId"
           FROM checklist_items i JOIN tasks t ON t.id = i.task_id JOIN boards b ON b.id = t.board_id
           JOIN workspace_members m ON m.workspace_id = b.workspace_id AND m.user_id = $1
          WHERE i.id = $2`,
        [userId, itemId],
      ),

    commentAccess: (userId, commentId) =>
      one(
        `SELECT m.role, c.task_id AS "taskId", c.user_id AS "authorId", t.board_id AS "boardId", b.workspace_id AS "workspaceId"
           FROM comments c JOIN tasks t ON t.id = c.task_id JOIN boards b ON b.id = t.board_id
           JOIN workspace_members m ON m.workspace_id = b.workspace_id AND m.user_id = $1
          WHERE c.id = $2`,
        [userId, commentId],
      ),

    attachmentAccess: (userId, attachmentId) =>
      one(
        `SELECT m.role, a.task_id AS "taskId", t.board_id AS "boardId", b.workspace_id AS "workspaceId"
           FROM attachments a JOIN tasks t ON t.id = a.task_id JOIN boards b ON b.id = t.board_id
           JOIN workspace_members m ON m.workspace_id = b.workspace_id AND m.user_id = $1
          WHERE a.id = $2`,
        [userId, attachmentId],
      ),
  };
}
