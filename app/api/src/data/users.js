export const USER = 'u.id, u.email, u.name, u.theme, u.created_at AS "createdAt"';
const UNIQUE_VIOLATION = '23505';

export function usersRepo(db) {
  const one = async (text, params) => (await db.query(text, params)).rows[0] ?? null;

  return {
    // A new account comes with a personal workspace (owner) and a first board.
    // Returns null if the email is taken.
    createUserWithWorkspace({ email, name, passwordHash }) {
      return db
        .tx(async (q) => {
          const user = (
            await q.query(
              `INSERT INTO users AS u (email, name, password_hash) VALUES ($1, $2, $3) RETURNING ${USER}`,
              [email, name, passwordHash],
            )
          ).rows[0];
          const firstName = name.split(' ')[0].slice(0, 60);
          const workspace = (
            await q.query('INSERT INTO workspaces (name) VALUES ($1) RETURNING id', [`${firstName}'s workspace`])
          ).rows[0];
          await q.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [
            workspace.id,
            user.id,
          ]);
          await q.query('INSERT INTO boards (workspace_id, created_by, name) VALUES ($1, $2, $3)', [
            workspace.id,
            user.id,
            'My tasks',
          ]);
          return user;
        })
        .catch((err) => {
          if (err.code === UNIQUE_VIOLATION) return null;
          throw err;
        });
    },

    findUserById: (id) => one(`SELECT ${USER} FROM users u WHERE u.id = $1`, [id]),

    findUserByEmail: (email) => one(`SELECT ${USER} FROM users u WHERE u.email = $1`, [email]),

    findUserForLogin: (email) =>
      one(`SELECT ${USER}, u.password_hash AS "passwordHash" FROM users u WHERE u.email = $1`, [email]),

    getPasswordHash: async (id) =>
      (await one('SELECT password_hash AS "passwordHash" FROM users WHERE id = $1', [id]))?.passwordHash ?? null,

    updateProfile: (id, { name, theme }) =>
      one(
        `UPDATE users u SET name = COALESCE($2, name), theme = COALESCE($3, theme)
          WHERE id = $1 RETURNING ${USER}`,
        [id, name ?? null, theme ?? null],
      ),

    setPassword: async (id, passwordHash) => {
      await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
    },

    // ------------------------------------------------------------ password resets

    // Issuing a new link cancels any earlier unused ones for the same user.
    async createPasswordReset(userId, tokenHash, ttlMinutes) {
      await db.tx(async (q) => {
        await q.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [userId]);
        await q.query(
          `INSERT INTO password_resets (token_hash, user_id, expires_at)
           VALUES ($1, $2, now() + make_interval(mins => $3))`,
          [tokenHash, userId, ttlMinutes],
        );
      });
    },

    // Marks the token used and sets the new password in one step. Returns the user id,
    // or null if the token is unknown, expired or already used.
    resetPassword(tokenHash, passwordHash) {
      return db.tx(async (q) => {
        const row = (
          await q.query(
            `UPDATE password_resets SET used_at = now()
              WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
          RETURNING user_id AS "userId"`,
            [tokenHash],
          )
        ).rows[0];
        if (!row) return null;
        await q.query('UPDATE users SET password_hash = $2 WHERE id = $1', [row.userId, passwordHash]);
        return row.userId;
      });
    },
  };
}
