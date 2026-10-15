// Live updates: one WebSocket per tab. A change event makes TanStack Query refetch the
// data it touched (only what's on screen is fetched straight away); presence says who
// else is looking at a board. If the connection drops it comes back with backoff, and
// everything is refreshed then in case something was missed.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { clientId } from './api.js';
import { keys } from './queries.js';

const NO_ONE = [];
const store = { status: 'connecting', presence: new Map(), listeners: new Set() };
const emit = () => store.listeners.forEach((listener) => listener());
const subscribe = (listener) => {
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
};
function setStatus(status) {
  if (store.status !== status) {
    store.status = status;
    emit();
  }
}

export const useLiveStatus = () => useSyncExternalStore(subscribe, () => store.status);
export const usePresence = (boardId) => useSyncExternalStore(subscribe, () => store.presence.get(boardId) ?? NO_ONE);

// Changes that arrive close together (a drag moves several cards) refresh once.
function refresh(client, { workspaces, boards, tasks }) {
  const run = (queryKey) => client.invalidateQueries({ queryKey });
  for (const id of boards) {
    run(keys.boardFull(id));
    run(keys.board(id));
    run(keys.activity(id));
  }
  for (const id of tasks) run(keys.task(id));
  for (const id of workspaces) {
    for (const key of [keys.boards(id), keys.dashboard(id), keys.members(id), keys.invites(id), keys.admin(id), keys.billing(id), keys.auditLog(id)]) run(key);
    for (const prefix of ['calendar', 'search', 'timesheet']) run([prefix, id]);
  }
  run(keys.workspaces);
  run(keys.timer);
}

// Keeps the tab connected while the app is open, and tells the server which board is on
// screen (for presence).
export function useLiveUpdates(boardId) {
  const client = useQueryClient();
  const socket = useRef(null);
  const board = useRef(boardId);
  board.current = boardId;

  const sendView = () => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'view', boardId: board.current }));
  };

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let retryTimer = null;
    let flushTimer = null;
    let connectedBefore = false;
    let pending = null;

    function queue(event) {
      pending ??= { workspaces: new Set(), boards: new Set(), tasks: new Set() };
      pending.workspaces.add(event.workspaceId);
      if (event.boardId) pending.boards.add(event.boardId);
      if (event.taskId) pending.tasks.add(event.taskId);
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => {
        const changes = pending;
        pending = null;
        refresh(client, changes);
      }, 250);
    }

    function connect() {
      setStatus('connecting');
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`);
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setStatus('open');
        sendView();
        if (connectedBefore) client.invalidateQueries();
        connectedBefore = true;
      };
      ws.onmessage = (e) => {
        let message;
        try {
          message = JSON.parse(e.data);
        } catch {
          return;
        }
        if (message.type === 'change' && message.clientId !== clientId) queue(message);
        else if (message.type === 'notification') {
          client.invalidateQueries({ queryKey: keys.unread });
          client.invalidateQueries({ queryKey: keys.notifications });
        } else if (message.type === 'presence') {
          store.presence = new Map(store.presence).set(message.boardId, message.users);
          emit();
        }
      };
      ws.onclose = (e) => {
        if (stopped) return;
        setStatus('closed');
        // Signed out elsewhere: re-checking the session sends this tab to the login page.
        if (e.code === 4001) return client.invalidateQueries({ queryKey: keys.me });
        const delay = Math.min(30_000, 1000 * 2 ** attempt++) * (0.75 + Math.random() * 0.5);
        retryTimer = setTimeout(connect, delay);
      };
    }

    // Back online: try again now rather than waiting out the backoff.
    const onOnline = () => {
      if (socket.current?.readyState === WebSocket.CLOSED) {
        clearTimeout(retryTimer);
        attempt = 0;
        connect();
      }
    };

    connect();
    window.addEventListener('online', onOnline);
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(flushTimer);
      window.removeEventListener('online', onOnline);
      socket.current?.close();
      store.presence = new Map();
    };
  }, [client]);

  useEffect(sendView, [boardId]);
}
