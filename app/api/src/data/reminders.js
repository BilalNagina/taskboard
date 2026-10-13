export function remindersRepo(db) {
  const one = async (text, params) => (await db.query(text, params)).rows[0] ?? null;

  // Reminders go to the task's assignees, or to whoever created it if nobody is assigned.
  const PERSON = `json_build_object('id', u.id, 'email', u.email, 'name', u.name,
      'emailReminders', COALESCE((u.notification_prefs ->> 'emailReminders')::boolean, true))`;
  const RECIPIENTS = `COALESCE(
      (SELECT json_agg(${PERSON} ORDER BY u.id) FROM task_assignees a JOIN users u ON u.id = a.user_id WHERE a.task_id = t.id),
      (SELECT json_agg(${PERSON}) FROM users u WHERE u.id = t.created_by),
      '[]'::json)`;

  return {
    // Open tasks due today or tomorrow (or overdue) that haven't had a reminder yet.
    tasksNeedingReminder: async (limit = 500) =>
      (
        await db.query(
          `SELECT id, due_date AS "dueDate" FROM tasks
            WHERE NOT done AND reminded_at IS NULL AND due_date <= current_date + 1
            ORDER BY due_date, id LIMIT $1`,
          [limit],
        )
      ).rows,

    // Re-checked right before sending: the task may have been completed, deleted or
    // given a new due date since the scan queued it.
    reminderDetails: (taskId, dueDate) =>
      one(
        `SELECT t.id, t.board_id AS "boardId", b.workspace_id AS "workspaceId", t.title, t.due_date AS "dueDate", b.name AS "boardName", ${RECIPIENTS} AS recipients
           FROM tasks t JOIN boards b ON b.id = t.board_id
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
