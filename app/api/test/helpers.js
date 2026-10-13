// Shared setup for the integration tests: a real PostgreSQL and Redis (CI provides both),
// in-memory file storage, and captured background jobs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import request from 'supertest';
import { createRepo } from '../src/data/index.js';
import { createDb } from '../src/db.js';
import { createApp } from '../src/http/app.js';
import { createLivePublisher } from '../src/live.js';
import { migrate } from '../src/migrate.js';
import { createRedis } from '../src/redis.js';
import { createRateLimiter, createSessionStore } from '../src/sessions.js';

export const { DATABASE_URL, REDIS_URL } = process.env;
export const skipIntegration = !(DATABASE_URL && REDIS_URL) && 'DATABASE_URL and REDIS_URL not set';
export const PASSWORD = 'correct horse';
export const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

export function memoryStorage() {
  const files = new Map();
  return {
    files,
    put: async (key, body, contentType) => files.set(key, { body: Buffer.from(body), contentType }),
    get: async (key) => {
      const file = files.get(key);
      if (!file) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      return { body: Readable.from([file.body]), size: file.body.length, contentType: file.contentType };
    },
    remove: async (keys) => keys.forEach((key) => files.delete(key)),
  };
}

export async function setupApi() {
  const db = createDb(DATABASE_URL);
  const redis = createRedis(REDIS_URL);
  await migrate(db.pool);
  await redis.flushdb(); // test Redis only: clears rate-limit counters between runs
  const repo = createRepo(db);
  const storage = memoryStorage();
  const jobs = { added: [], add: async (name, data, opts) => jobs.added.push({ name, data, opts }) };
  const sessions = createSessionStore(redis);
  const live = createLivePublisher(redis);
  const app = createApp({
    repo,
    sessions,
    live,
    limiter: createRateLimiter(redis),
    storage,
    jobs,
    appUrl: 'https://app.example.com',
    ping: () => Promise.all([db.ping(), redis.ping()]),
  });

  // Registers a fresh user; returns a cookie-carrying agent, their workspace and an empty
  // board. New accounts come with a sample board full of cards, which most tests don't
  // want counted, so it's swapped for a blank one (the sample board has its own test).
  async function signUp(name = 'Ada') {
    const agent = request.agent(app);
    const email = `${name.toLowerCase()}-${randomUUID()}@example.com`;
    const res = await agent.post('/api/auth/register').send({ name, email, password: PASSWORD });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const [workspace] = (await agent.get('/api/workspaces')).body;
    const [sample] = (await agent.get(`/api/workspaces/${workspace.id}/boards`)).body;
    assert.equal((await agent.delete(`/api/boards/${sample.id}`)).status, 204);
    const board = (await agent.post(`/api/workspaces/${workspace.id}/boards`).send({ name: 'My tasks' })).body;
    const cookie = res.headers['set-cookie'][0].split(';')[0];
    return { agent, email, cookie, user: res.body.user, workspace, board };
  }

  const addMember = (workspaceId, userId, role) =>
    db.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)', [workspaceId, userId, role]);

  const close = async () => {
    await db.close();
    await redis.quit();
  };

  return { db, redis, repo, sessions, live, storage, jobs, app, signUp, addMember, close };
}
