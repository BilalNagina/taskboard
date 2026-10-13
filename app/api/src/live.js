// Live updates. Changes are published on a Redis channel by whichever process made them
// (an API request, or the worker sending a due-date notification); every API process
// subscribes and forwards them over WebSockets to the people they concern. Browsers then
// refetch just what changed, so nothing sensitive travels in the events themselves.
//
// Events on the channel:
//   { kind: 'change', workspaceId, boardId, taskId, actorId, clientId }  to workspace members
//   { kind: 'notification', userIds }                                    to those users
//
// "Who's viewing this board" is kept per process. With several API replicas it would
// move to Redis too; one process serves this deployment.
import { WebSocketServer } from 'ws';
import { readCookie, SESSION_COOKIE } from './http/session.js';

export const LIVE_CHANNEL = 'tasklane:live';
export const LIVE_PATH = '/api/live';
const HEARTBEAT_MS = 30_000;

export function createLivePublisher(redis, logger) {
  return {
    async publish(event) {
      try {
        await redis.publish(LIVE_CHANNEL, JSON.stringify(event));
      } catch (err) {
        // Live updates are a convenience; the change itself has already been saved.
        logger?.warn({ err: err.message }, 'could not publish live event');
      }
    },
  };
}

// Attaches the WebSocket endpoint to the HTTP server. `subscriber` is a Redis connection
// used only for subscribing. Returns { close, connectionCount }.
export async function attachLive(server, { subscriber, sessions, repo, appUrl, logger }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const byUser = new Map(); // userId -> Set<socket>

  const send = (socket, message) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(message));
  const sendToUser = (userId, message) => byUser.get(userId)?.forEach((socket) => send(socket, message));

  function presence(boardId) {
    if (!boardId) return;
    const viewers = new Map();
    const sockets = [];
    for (const set of byUser.values()) {
      for (const socket of set) {
        if (socket.boardId !== boardId) continue;
        sockets.push(socket);
        viewers.set(socket.user.id, socket.user);
      }
    }
    for (const socket of sockets) send(socket, { type: 'presence', boardId, users: [...viewers.values()] });
  }

  function reject(socket, status, text) {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  }

  server.on('upgrade', async (req, socket, head) => {
    if (new URL(req.url, 'http://local').pathname !== LIVE_PATH) return reject(socket, 404, 'Not Found');
    // The session cookie goes with any WebSocket handshake, from any site, so only this
    // app's own pages may connect (browsers always send Origin here).
    if (req.headers.origin !== appUrl) return reject(socket, 403, 'Forbidden');
    try {
      const token = readCookie(req, SESSION_COOKIE);
      const userId = await sessions.get(token);
      const user = userId ? await repo.findUserById(userId) : null;
      if (!user) return reject(socket, 401, 'Unauthorized');
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.token = token;
        ws.user = { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl };
        ws.boardId = null;
        ws.alive = true;
        wss.emit('connection', ws);
      });
    } catch (err) {
      logger?.warn({ err: err.message }, 'live connection failed');
      reject(socket, 500, 'Internal Server Error');
    }
  });

  wss.on('connection', (ws) => {
    const userId = ws.user.id;
    if (!byUser.has(userId)) byUser.set(userId, new Set());
    byUser.get(userId).add(ws);
    send(ws, { type: 'hello' });

    ws.on('pong', () => (ws.alive = true));

    // The only message a browser sends: which board it's looking at (or null).
    ws.on('message', async (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (message?.type !== 'view') return;
      const boardId = Number.isInteger(message.boardId) && message.boardId > 0 ? message.boardId : null;
      const allowed = boardId ? Boolean(await repo.boardAccess(userId, boardId)) : true;
      const previous = ws.boardId;
      ws.boardId = allowed ? boardId : null;
      if (previous !== ws.boardId) {
        presence(previous);
        presence(ws.boardId);
      }
    });

    ws.on('close', () => {
      const set = byUser.get(userId);
      set?.delete(ws);
      if (set?.size === 0) byUser.delete(userId);
      presence(ws.boardId);
    });
  });

  // Ping every connection; drop ones that stopped answering, and ones whose session was
  // signed out (logout, password change) since they connected.
  const heartbeat = setInterval(async () => {
    for (const set of byUser.values()) {
      for (const ws of set) {
        if (!ws.alive) {
          ws.terminate();
          continue;
        }
        ws.alive = false;
        ws.ping();
        if (!(await sessions.get(ws.token).catch(() => true))) ws.close(4001, 'signed out');
      }
    }
  }, HEARTBEAT_MS);

  await subscriber.subscribe(LIVE_CHANNEL);
  subscriber.on('message', async (channel, raw) => {
    if (channel !== LIVE_CHANNEL) return;
    try {
      const event = JSON.parse(raw);
      if (event.kind === 'notification') {
        for (const userId of event.userIds ?? []) sendToUser(userId, { type: 'notification' });
      } else if (event.kind === 'change' && event.workspaceId) {
        const { workspaceId, boardId = null, taskId = null, actorId = null, clientId = null } = event;
        for (const userId of await repo.workspaceMemberIds(workspaceId)) {
          sendToUser(userId, { type: 'change', workspaceId, boardId, taskId, actorId, clientId });
        }
      }
    } catch (err) {
      logger?.warn({ err: err.message }, 'bad live event');
    }
  });

  return {
    connectionCount: () => [...byUser.values()].reduce((n, set) => n + set.size, 0),
    async close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.close(1001, 'server shutting down');
      wss.close();
      await subscriber.quit().catch(() => {});
    },
  };
}
