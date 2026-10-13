import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, MAX_UPLOAD_BYTES } from './api.js';
import TaskItem from './TaskItem.jsx';

export default function Workspace({ user, onSignOut, onSessionExpired }) {
  const [boards, setBoards] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [error, setError] = useState('');
  const [newBoard, setNewBoard] = useState('');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');

  const run = useCallback(
    async (action) => {
      setError('');
      try {
        return await action();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return onSessionExpired();
        setError(err.message);
      }
    },
    [onSessionExpired],
  );

  useEffect(() => {
    run(async () => {
      const list = await api.boards();
      setBoards(list);
      setActiveId((current) => current ?? list[0]?.id ?? null);
    });
  }, [run]);

  useEffect(() => {
    if (!activeId) return setTasks([]);
    setLoadingTasks(true);
    run(async () => setTasks(await api.tasks(activeId))).finally(() => setLoadingTasks(false));
  }, [activeId, run]);

  // Re-read the sidebar's open-task counts after a task changes.
  const refreshCounts = () => api.boards().then(setBoards).catch(() => {});

  const activeBoard = boards.find((b) => b.id === activeId);
  const replaceTask = (task) => setTasks((list) => list.map((t) => (t.id === task.id ? task : t)));

  const addBoard = (event) => {
    event.preventDefault();
    run(async () => {
      const board = await api.createBoard(newBoard);
      setBoards((list) => [...list, board]);
      setActiveId(board.id);
      setNewBoard('');
    });
  };

  const renameBoard = () => {
    const name = window.prompt('Rename board', activeBoard.name)?.trim();
    if (!name || name === activeBoard.name) return;
    run(async () => {
      const board = await api.renameBoard(activeBoard.id, name);
      setBoards((list) => list.map((b) => (b.id === board.id ? { ...b, name: board.name } : b)));
    });
  };

  const deleteBoard = () => {
    if (!window.confirm(`Delete "${activeBoard.name}" and all of its tasks and files?`)) return;
    run(async () => {
      await api.deleteBoard(activeBoard.id);
      const rest = boards.filter((b) => b.id !== activeBoard.id);
      setBoards(rest);
      setActiveId(rest[0]?.id ?? null);
    });
  };

  const addTask = (event) => {
    event.preventDefault();
    run(async () => {
      const task = await api.createTask(activeId, title, dueDate);
      setTasks((list) => [...list, task]);
      refreshCounts();
      setTitle('');
      setDueDate('');
    });
  };

  const updateTask = (task, changes) =>
    run(async () => {
      replaceTask(await api.updateTask(task.id, changes));
      if ('done' in changes) refreshCounts();
    });

  const deleteTask = (task) =>
    run(async () => {
      await api.deleteTask(task.id);
      setTasks((list) => list.filter((t) => t.id !== task.id));
      refreshCounts();
    });

  const upload = (task, file) => {
    if (file.size > MAX_UPLOAD_BYTES) return setError(`"${file.name}" is larger than 10 MB.`);
    return run(async () => {
      const attachment = await api.upload(task.id, file);
      replaceTask({ ...task, attachments: [...task.attachments, attachment] });
    });
  };

  const deleteAttachment = (task, attachment) =>
    run(async () => {
      await api.deleteAttachment(attachment.id);
      replaceTask({ ...task, attachments: task.attachments.filter((a) => a.id !== attachment.id) });
    });

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  return (
    <div className="workspace">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">✓</span>
          <strong>Taskboard</strong>
        </div>
        <div className="account">
          <span className="muted">{user.name}</span>
          <button className="ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <h2>Boards</h2>
        <nav>
          {boards.map((board) => (
            <button
              key={board.id}
              className={`board-link ${board.id === activeId ? 'active' : ''}`}
              onClick={() => setActiveId(board.id)}
            >
              <span>{board.name}</span>
              <span className="count">{board.openCount}</span>
            </button>
          ))}
        </nav>
        <form onSubmit={addBoard} className="new-board">
          <input
            value={newBoard}
            onChange={(e) => setNewBoard(e.target.value)}
            placeholder="New board"
            maxLength={80}
            aria-label="New board name"
          />
          <button type="submit" disabled={!newBoard.trim()} aria-label="Create board">
            +
          </button>
        </form>
      </aside>

      <main className="board card">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {!activeBoard && <p className="muted center">Create a board to get started.</p>}

        {activeBoard && (
          <>
            <div className="board-head">
              <div>
                <h1>{activeBoard.name}</h1>
                <p className="muted">
                  {loadingTasks ? 'Loading…' : `${open.length} open · ${done.length} done`}
                </p>
              </div>
              <div className="board-actions">
                <button className="ghost" onClick={renameBoard}>
                  Rename
                </button>
                <button className="ghost danger" onClick={deleteBoard}>
                  Delete
                </button>
              </div>
            </div>

            <form onSubmit={addTask} className="add">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs doing?"
                maxLength={200}
                aria-label="New task"
              />
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-label="Due date (optional)"
                title="Due date (optional)"
              />
              <button type="submit" disabled={!title.trim()}>
                Add
              </button>
            </form>

            <ul className="tasks">
              {[...open, ...done].map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  onUpdate={(changes) => updateTask(task, changes)}
                  onDelete={() => deleteTask(task)}
                  onUpload={(file) => upload(task, file)}
                  onDeleteAttachment={(attachment) => deleteAttachment(task, attachment)}
                />
              ))}
            </ul>

            {!loadingTasks && tasks.length === 0 && (
              <p className="muted center empty">No tasks yet. Add the first one above.</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
