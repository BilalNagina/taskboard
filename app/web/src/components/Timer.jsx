// The running timer: controls shared by the task panel and the sidebar, and the pill that
// shows it wherever you are in the app.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../lib/api.js';
import { formatElapsed, formatMinutes, localToday } from '../lib/format.js';
import { keys, useTimer } from '../lib/queries.js';
import Icon from './Icon.jsx';
import { useToast } from './Toaster.jsx';

export function useTimerControls() {
  const { data: timer, dataUpdatedAt } = useTimer();
  const client = useQueryClient();
  const toast = useToast();

  // Logged time shows up in the task panel and the timesheet.
  const refresh = (...taskIds) =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['timesheet'] }),
      ...taskIds.filter(Boolean).map((id) => client.invalidateQueries({ queryKey: keys.task(id) })),
    ]);

  async function start(task) {
    const previous = timer;
    try {
      const { timer: started, stopped } = await api.startTimer(task.id, localToday());
      client.setQueryData(keys.timer, started);
      if (stopped) toast(`Logged ${formatMinutes(stopped.minutes)} on “${previous?.title ?? 'the previous task'}”`);
      await refresh(task.id, stopped?.taskId);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function stop() {
    try {
      const { stopped } = await api.stopTimer();
      client.setQueryData(keys.timer, null);
      toast(`Logged ${formatMinutes(stopped.minutes)}`, 'success');
      await refresh(stopped.taskId);
    } catch (err) {
      toast(err.message, 'error');
      client.invalidateQueries({ queryKey: keys.timer });
    }
  }

  // When the timer started, on this browser's clock.
  const startedAt = timer ? dataUpdatedAt - timer.elapsedSeconds * 1000 : null;
  return { timer, startedAt, start, stop };
}

// Re-renders every second while `active`, for a ticking clock.
export function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function TimerPill({ compact = false }) {
  const { timer, startedAt, stop } = useTimerControls();
  const now = useNow(Boolean(timer));
  if (!timer) return null;
  const elapsed = formatElapsed((now - startedAt) / 1000);
  return (
    <div className={`timer-pill ${compact ? 'is-compact' : ''}`} role="status" aria-label={`Timer running on ${timer.title}: ${elapsed}`}>
      <span className="timer-dot" aria-hidden="true" />
      <Link to={`/app/boards/${timer.boardId}?task=${timer.taskId}`} className="timer-text" title={timer.title}>
        <b>{elapsed}</b>
        {!compact && <span>{timer.title}</span>}
      </Link>
      <button className="icon-btn" onClick={stop} aria-label="Stop timer" title="Stop timer">
        <Icon name="stop" size={14} strokeWidth={2.2} />
      </button>
    </div>
  );
}
