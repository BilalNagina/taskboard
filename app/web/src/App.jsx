import { useEffect, useState } from 'react';
import { api } from './api.js';

// Set at build time by CI, so the page shows exactly which commit is deployed.
const VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .list()
      .then(setTasks)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function run(action) {
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err.message);
    }
  }

  const addTask = (event) => {
    event.preventDefault();
    run(async () => {
      const task = await api.create(title);
      setTasks((current) => [...current, task]);
      setTitle('');
    });
  };

  const toggle = (task) =>
    run(async () => {
      const updated = await api.update(task.id, { done: !task.done });
      setTasks((current) => current.map((t) => (t.id === task.id ? updated : t)));
    });

  const remove = (task) =>
    run(async () => {
      await api.remove(task.id);
      setTasks((current) => current.filter((t) => t.id !== task.id));
    });

  const remaining = tasks.filter((t) => !t.done).length;

  return (
    <main className="card">
      <header>
        <h1>Taskboard</h1>
        <p className="muted">{loading ? 'Loading…' : `${remaining} of ${tasks.length} tasks open`}</p>
      </header>

      <form onSubmit={addTask} className="add">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          maxLength={200}
          aria-label="New task"
        />
        <button type="submit" disabled={!title.trim()}>
          Add
        </button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <ul className="tasks">
        {tasks.map((task) => (
          <li key={task.id} className={task.done ? 'done' : ''}>
            <label>
              <input type="checkbox" checked={task.done} onChange={() => toggle(task)} />
              <span>{task.title}</span>
            </label>
            <button className="ghost" onClick={() => remove(task)} aria-label={`Delete ${task.title}`}>
              ✕
            </button>
          </li>
        ))}
      </ul>

      {!loading && tasks.length === 0 && <p className="muted empty">No tasks yet. Add the first one above.</p>}

      <footer className="muted">Version {VERSION}</footer>
    </main>
  );
}
