export function remindersRepo(db) {
  const one = async (text, params) => (await db.query(text, params)).rows[0] ?? null;

  return {
    // Open tasks due today or tomorrow (or overdue) that haven't had a reminder yet.
    tasksNeedingReminder: async (limit = 500) =>
      (
        await db.query(
          `SELECT id, due_date AS "dueDate" FROM tasks
            WHERE NOT done AND reminded_at IS NULL AND due_date <= current_date + 1 AND created_by IS NOT NULL
            ORDER BY due_date, id LIMIT $1`,
          [limit],
        )
      ).rows,

    // Re-checked right before sending: the task may have been completed, deleted or
    // given a new due date since the scan queued it.
    reminderDetails: (taskId, dueDate) =>
      one(
        `SELECT t.id, t.title, t.due_date AS "dueDate", b.name AS "boardName",
                u.email, u.name AS "userName"
           FROM tasks t JOIN boards b ON b.id = t.board_id JOIN users u ON u.id = t.created_by
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
