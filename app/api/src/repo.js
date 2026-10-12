const COLUMNS = 'id, title, done, created_at AS "createdAt", updated_at AS "updatedAt"';

export function createTaskRepo(db) {
  return {
    async list() {
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM tasks ORDER BY id`);
      return rows;
    },
    async create(title) {
      const { rows } = await db.query(`INSERT INTO tasks (title) VALUES ($1) RETURNING ${COLUMNS}`, [title]);
      return rows[0];
    },
    async update(id, { title, done }) {
      const { rows } = await db.query(
        `UPDATE tasks
            SET title = COALESCE($2, title), done = COALESCE($3, done), updated_at = now()
          WHERE id = $1
      RETURNING ${COLUMNS}`,
        [id, title ?? null, done ?? null],
      );
      return rows[0] ?? null;
    },
    async remove(id) {
      const { rowCount } = await db.query('DELETE FROM tasks WHERE id = $1', [id]);
      return rowCount > 0;
    },
  };
}
