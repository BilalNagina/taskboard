// Workspace members and invitations.

const MEMBER = `u.id, u.name, u.email, m.role, m.joined_at AS "joinedAt"`;
const INVITE = `i.id, i.workspace_id AS "workspaceId", i.email, i.role, i.created_at AS "createdAt",
  i.expires_at AS "expiresAt", i.expires_at < now() AS expired,
  json_build_object('id', inviter.id, 'name', inviter.name) AS "invitedBy"`;

export function membersRepo(db) {
  const one = async (text, params) => (await db.query(text, params)).rows[0] ?? null;
  const all = async (text, params) => (await db.query(text, params)).rows;

  return {
    listMembers: (workspaceId) =>
      all(
        `SELECT ${MEMBER} FROM workspace_members m JOIN users u ON u.id = m.user_id
          WHERE m.workspace_id = $1
          ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, u.name`,
        [workspaceId],
      ),

    getMember: (workspaceId, userId) =>
      one(`SELECT ${MEMBER} FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND m.user_id = $2`, [
        workspaceId,
        userId,
      ]),

    ownerCount: async (workspaceId) =>
      (await one(`SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = $1 AND role = 'owner'`, [workspaceId])).n,

    setMemberRole: (workspaceId, userId, role) =>
      one('UPDATE workspace_members SET role = $3 WHERE workspace_id = $1 AND user_id = $2 RETURNING role', [workspaceId, userId, role]),

    // Also takes them off every task in the workspace.
    removeMember: (workspaceId, userId) =>
      db.tx(async (q) => {
        await q.query(
          `DELETE FROM task_assignees a USING tasks t, boards b
            WHERE a.task_id = t.id AND t.board_id = b.id AND b.workspace_id = $1 AND a.user_id = $2`,
          [workspaceId, userId],
        );
        await q.query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
      }),

    // Ids from `ids` that are members of the workspace (any role).
    validMemberIds: async (workspaceId, ids) =>
      ids.length
        ? (await all('SELECT user_id AS id FROM workspace_members WHERE workspace_id = $1 AND user_id = ANY($2::int[])', [workspaceId, ids])).map(
            (r) => r.id,
          )
        : [],

    // ------------------------------------------------------------ invites

    // Inviting an address that already has a pending invite replaces it.
    createInvite: ({ workspaceId, email, role, tokenHash, invitedBy, ttlDays }) =>
      db.tx(async (q) => {
        await q.query('DELETE FROM invites WHERE workspace_id = $1 AND email = $2 AND accepted_at IS NULL', [workspaceId, email]);
        const { rows } = await q.query(
          `INSERT INTO invites (workspace_id, email, role, token_hash, invited_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6)) RETURNING id`,
          [workspaceId, email, role, tokenHash, invitedBy, ttlDays],
        );
        return (await q.query(`SELECT ${INVITE} FROM invites i LEFT JOIN users inviter ON inviter.id = i.invited_by WHERE i.id = $1`, [rows[0].id]))
          .rows[0];
      }),

    listInvites: (workspaceId) =>
      all(
        `SELECT ${INVITE} FROM invites i LEFT JOIN users inviter ON inviter.id = i.invited_by
          WHERE i.workspace_id = $1 AND i.accepted_at IS NULL ORDER BY i.id DESC`,
        [workspaceId],
      ),

    getInvite: (inviteId) =>
      one(
        `SELECT ${INVITE}, w.name AS "workspaceName"
           FROM invites i JOIN workspaces w ON w.id = i.workspace_id LEFT JOIN users inviter ON inviter.id = i.invited_by
          WHERE i.id = $1 AND i.accepted_at IS NULL`,
        [inviteId],
      ),

    // A fresh token and expiry, for "resend" (the old link stops working).
    renewInvite: (inviteId, tokenHash, ttlDays) =>
      one(
        `UPDATE invites SET token_hash = $2, expires_at = now() + make_interval(days => $3)
          WHERE id = $1 AND accepted_at IS NULL RETURNING id`,
        [inviteId, tokenHash, ttlDays],
      ),

    revokeInvite: async (inviteId) => {
      await db.query('DELETE FROM invites WHERE id = $1 AND accepted_at IS NULL', [inviteId]);
    },

    // What the invite page shows before someone accepts.
    findInviteByToken: (tokenHash) =>
      one(
        `SELECT ${INVITE}, w.name AS "workspaceName", i.accepted_at IS NOT NULL AS accepted
           FROM invites i JOIN workspaces w ON w.id = i.workspace_id LEFT JOIN users inviter ON inviter.id = i.invited_by
          WHERE i.token_hash = $1`,
        [tokenHash],
      ),

    // Joins the workspace. Someone already in it keeps their current role.
    acceptInvite: (inviteId, userId) =>
      db.tx(async (q) => {
        const invite = (
          await q.query(
            `UPDATE invites SET accepted_at = now()
              WHERE id = $1 AND accepted_at IS NULL AND expires_at > now()
          RETURNING workspace_id AS "workspaceId", role`,
            [inviteId],
          )
        ).rows[0];
        if (!invite) return null;
        const joined = await q.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [invite.workspaceId, userId, invite.role],
        );
        return { ...invite, alreadyMember: joined.rowCount === 0 };
      }),
  };
}
