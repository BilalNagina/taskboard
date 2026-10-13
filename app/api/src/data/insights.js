// Read-only views across all boards in a workspace: dashboard, calendar and search.
// `today` comes from the browser (the user's own date), validated by the route.

// A compact task row with where it lives, for lists, the calendar and search results.
const ROW = `t.id, t.title, t.done, t.priority, t.due_date AS "dueDate", t.updated_at AS "updatedAt",
  t.board_id AS "boardId", b.name AS "boardName", c.name AS "columnName",
  COALESCE((SELECT array_agg(user_id ORDER BY user_id) FROM task_assignees WHERE task_id = t.id), '{}') AS "assigneeIds",
  COALESCE((SELECT json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color) ORDER BY l.id)
              FROM task_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.task_id = t.id), '[]') AS labels`;
const FROM = 'tasks t JOIN boards b ON b.id = t.board_id JOIN board_columns c ON c.id = t.column_id';

// Turns "inv rep" into 'inv:* & rep:*' so search matches as you type. Only letters and
// digits get through, so the query can't inject tsquery syntax.
export function toPrefixQuery(text) {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
}

export function insightsRepo(db) {
  const all = async (text, params) => (await db.query(text, params)).rows;
  const one = async (text, params) => (await db.query(text, params)).rows[0];

  return {
    async dashboard(workspaceId, userId, today) {
      const params = [workspaceId, today];
      const [totals, completed, created, byPriority, byBoard, byAssignee, overdue, upcoming, mine] = await Promise.all([
        one(
          `SELECT count(*) FILTER (WHERE NOT t.done)::int AS open,
                  count(*) FILTER (WHERE t.done)::int AS done,
                  count(*) FILTER (WHERE NOT t.done AND t.due_date < $2::date)::int AS overdue,
                  count(*) FILTER (WHERE NOT t.done AND t.due_date BETWEEN $2::date AND $2::date + 6)::int AS "dueThisWeek",
                  count(*) FILTER (WHERE t.done AND t.completed_at::date > $2::date - 7)::int AS "completedThisWeek"
             FROM tasks t JOIN boards b ON b.id = t.board_id WHERE b.workspace_id = $1`,
          params,
        ),
        // Completions per day for the last 14 days, zero-filled.
        all(
          `SELECT d::date AS date, count(t.id)::int AS count
             FROM generate_series($2::date - 13, $2::date, interval '1 day') d
             LEFT JOIN (tasks t JOIN boards b ON b.id = t.board_id AND b.workspace_id = $1)
               ON t.done AND t.completed_at::date = d::date
            GROUP BY d ORDER BY d`,
          params,
        ),
        all(
          `SELECT d::date AS date, count(t.id)::int AS count
             FROM generate_series($2::date - 13, $2::date, interval '1 day') d
             LEFT JOIN (tasks t JOIN boards b ON b.id = t.board_id AND b.workspace_id = $1)
               ON t.created_at::date = d::date
            GROUP BY d ORDER BY d`,
          params,
        ),
        all(
          `SELECT t.priority, count(*)::int AS count FROM tasks t JOIN boards b ON b.id = t.board_id
            WHERE b.workspace_id = $1 AND NOT t.done GROUP BY t.priority`,
          [workspaceId],
        ),
        all(
          `SELECT b.id, b.name, count(t.id) FILTER (WHERE NOT t.done)::int AS open, count(t.id) FILTER (WHERE t.done)::int AS done
             FROM boards b LEFT JOIN tasks t ON t.board_id = b.id
            WHERE b.workspace_id = $1 GROUP BY b.id ORDER BY b.id`,
          [workspaceId],
        ),
        all(
          `SELECT m.user_id AS "userId",
                  count(t.id) FILTER (WHERE NOT t.done)::int AS open,
                  count(t.id) FILTER (WHERE NOT t.done AND t.due_date < $2::date)::int AS overdue
             FROM workspace_members m
             LEFT JOIN task_assignees a ON a.user_id = m.user_id
             LEFT JOIN tasks t ON t.id = a.task_id AND t.board_id IN (SELECT id FROM boards WHERE workspace_id = $1)
            WHERE m.workspace_id = $1 GROUP BY m.user_id ORDER BY open DESC`,
          params,
        ),
        all(`SELECT ${ROW} FROM ${FROM} WHERE b.workspace_id = $1 AND NOT t.done AND t.due_date < $2::date ORDER BY t.due_date, t.id LIMIT 8`, params),
        all(
          `SELECT ${ROW} FROM ${FROM}
            WHERE b.workspace_id = $1 AND NOT t.done AND t.due_date BETWEEN $2::date AND $2::date + 7
            ORDER BY t.due_date, t.id LIMIT 8`,
          params,
        ),
        all(
          `SELECT ${ROW} FROM ${FROM} JOIN task_assignees a ON a.task_id = t.id AND a.user_id = $2
            WHERE b.workspace_id = $1 AND NOT t.done
            ORDER BY t.due_date NULLS LAST, t.id LIMIT 8`,
          [workspaceId, userId],
        ),
      ]);
      return { totals, completedByDay: completed, createdByDay: created, byPriority, byBoard, byAssignee, overdue, upcoming, mine };
    },

    // Every task on a board with names resolved, in board order, for CSV/PDF export.
    exportBoard: (boardId) =>
      all(
        `SELECT t.title, t.description, c.name AS "column", c.position AS "columnPosition", t.done, t.priority,
                t.due_date AS "dueDate", t.created_at AS "createdAt", t.completed_at AS "completedAt",
                COALESCE((SELECT string_agg(u.name, ', ' ORDER BY u.name) FROM task_assignees a JOIN users u ON u.id = a.user_id WHERE a.task_id = t.id), '') AS assignees,
                COALESCE((SELECT string_agg(l.name, ', ' ORDER BY l.name) FROM task_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.task_id = t.id), '') AS labels,
                (SELECT count(*)::int FROM checklist_items WHERE task_id = t.id AND done) AS "checklistDone",
                (SELECT count(*)::int FROM checklist_items WHERE task_id = t.id) AS "checklistTotal"
           FROM tasks t JOIN board_columns c ON c.id = t.column_id
          WHERE t.board_id = $1 ORDER BY c.position, t.position, t.id`,
        [boardId],
      ),

    calendar: (workspaceId, { from, to, boardId }) =>
      all(
        `SELECT ${ROW} FROM ${FROM}
          WHERE b.workspace_id = $1 AND t.due_date BETWEEN $2::date AND $3::date AND ($4::int IS NULL OR t.board_id = $4)
          ORDER BY t.due_date, t.done, t.priority = 'urgent' DESC, t.priority = 'high' DESC, t.id`,
        [workspaceId, from, to, boardId ?? null],
      ),

    // Filters combine with AND. With a text query, best matches come first; without one,
    // the most recently updated tasks do.
    search(workspaceId, { q, assigneeId, priority, due, status, boardId, today }) {
      const params = [workspaceId];
      const where = ['b.workspace_id = $1'];
      const param = (value) => `$${params.push(value)}`;
      const tsquery = q ? toPrefixQuery(q) : null;
      let rank = 't.updated_at DESC';
      if (tsquery) {
        const p = param(tsquery);
        where.push(`t.search @@ to_tsquery('simple', ${p})`);
        rank = `ts_rank(t.search, to_tsquery('simple', ${p})) DESC, t.updated_at DESC`;
      }
      if (assigneeId) where.push(`EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = ${param(assigneeId)})`);
      if (assigneeId === null) where.push('NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id)');
      if (priority) where.push(`t.priority = ${param(priority)}`);
      if (status === 'open') where.push('NOT t.done');
      if (status === 'done') where.push('t.done');
      if (boardId) where.push(`t.board_id = ${param(boardId)}`);
      // Every parameter must appear in the SQL (PostgreSQL can't type an unused one),
      // so today is only added for the filters that compare against it.
      if (due === 'none') where.push('t.due_date IS NULL');
      else if (due) {
        const d = param(today);
        if (due === 'overdue') where.push(`NOT t.done AND t.due_date < ${d}::date`);
        if (due === 'today') where.push(`t.due_date = ${d}::date`);
        if (due === 'week') where.push(`t.due_date BETWEEN ${d}::date AND ${d}::date + 6`);
      }
      return all(`SELECT ${ROW} FROM ${FROM} WHERE ${where.join(' AND ')} ORDER BY ${rank} LIMIT 100`, params);
    },
  };
}
