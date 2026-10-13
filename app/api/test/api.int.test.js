// End-to-end API tests against a real PostgreSQL and Redis (CI provides both).
// File storage is in memory, so no S3 is needed.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Queue } from 'bullmq';
import request from 'supertest';
import { createApp, MAX_UPLOAD_BYTES } from '../src/app.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createRedis } from '../src/redis.js';
import { createRepo } from '../src/repo.js';
import { scanDueTasks, sendReminder } from '../src/reminders.js';
import { createRateLimiter, createSessionStore } from '../src/sessions.js';

const { DATABASE_URL, REDIS_URL } = process.env;
const skip = !(DATABASE_URL && REDIS_URL) && 'DATABASE_URL and REDIS_URL not set';

function memoryStorage() {
  const files = new Map();
  return {
    files,
    put: async (key, body, contentType) => files.set(key, { body: Buffer.from(body), contentType }),
    get: async (key) => {
      const file = files.get(key);
      if (!file) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      return { body: Readable.from([file.body]), size: file.body.length };
    },
    remove: async (keys) => keys.forEach((key) => files.delete(key)),
  };
}

const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

describe('API against PostgreSQL and Redis', { skip }, () => {
  let db, redis, repo, storage, app;

  before(async () => {
    db = createDb(DATABASE_URL);
    redis = createRedis(REDIS_URL);
    await migrate(db.pool);
    await redis.flushdb(); // test Redis only: clears rate-limit counters between runs
    repo = createRepo(db);
    storage = memoryStorage();
    app = createApp({
      repo,
      sessions: createSessionStore(redis),
      limiter: createRateLimiter(redis),
      storage,
      ping: () => Promise.all([db.ping(), redis.ping()]),
    });
  });

  after(async () => {
    await db.close();
    await redis.quit();
  });

  // Registers a fresh user and returns a cookie-carrying agent plus their default board.
  async function signUp(name = 'Ada') {
    const agent = request.agent(app);
    const email = `${name.toLowerCase()}-${randomUUID()}@example.com`;
    const res = await agent.post('/api/auth/register').send({ name, email, password: 'correct horse' });
    assert.equal(res.status, 201);
    const [board] = (await agent.get('/api/boards')).body;
    return { agent, email, user: res.body.user, board };
  }

  test('readiness checks both PostgreSQL and Redis', async () => {
    assert.equal((await request(app).get('/readyz')).status, 200);
  });

  test('sign-up starts a secure session and creates a first board', async () => {
    const agent = request.agent(app);
    const email = `new-${randomUUID()}@example.com`;
    const res = await agent.post('/api/auth/register').send({ name: 'Grace', email: email.toUpperCase(), password: 'correct horse' });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, email, 'emails are stored lowercase');
    assert.equal(res.body.user.passwordHash, undefined);
    const cookie = res.headers['set-cookie'][0];
    assert.match(cookie, /^tb_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);

    assert.equal((await agent.get('/api/auth/me')).body.user.name, 'Grace');
    const boards = (await agent.get('/api/boards')).body;
    assert.deepEqual(boards.map((b) => b.name), ['My tasks']);

    const again = await request(app).post('/api/auth/register').send({ name: 'Grace', email, password: 'correct horse' });
    assert.equal(again.status, 409);
  });

  test('sign-up validates input', async () => {
    const ok = { name: 'Ada', email: 'ada@example.com', password: 'correct horse' };
    for (const bad of [{ name: '' }, { email: 'nope' }, { password: 'short' }]) {
      const res = await request(app).post('/api/auth/register').send({ ...ok, ...bad });
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
  });

  test('login, logout and wrong passwords', async () => {
    const { email } = await signUp('Linus');
    const agent = request.agent(app);
    assert.equal((await agent.post('/api/auth/login').send({ email, password: 'wrong password' })).status, 401);
    assert.equal(
      (await agent.post('/api/auth/login').send({ email: `nobody-${randomUUID()}@example.com`, password: 'x' })).status,
      401,
      'unknown emails get the same answer as wrong passwords',
    );
    const res = await agent.post('/api/auth/login').send({ email, password: 'correct horse' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, email);
    assert.equal(res.body.user.passwordHash, undefined);
    assert.equal((await agent.get('/api/boards')).status, 200);

    assert.equal((await agent.post('/api/auth/logout')).status, 204);
    assert.equal((await agent.get('/api/boards')).status, 401, 'the session is gone server-side');
  });

  test('login attempts are rate limited per email', async () => {
    const { email } = await signUp('Barbara');
    for (let i = 0; i < 10; i++) {
      assert.equal((await request(app).post('/api/auth/login').send({ email, password: 'wrong password' })).status, 401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ email, password: 'correct horse' });
    assert.equal(blocked.status, 429, 'even the right password is refused once the limit is hit');
  });

  test('boards: create, rename, count and delete', async () => {
    const { agent, board } = await signUp();
    const created = await agent.post('/api/boards').send({ name: 'Launch' });
    assert.equal(created.status, 201);
    assert.equal((await agent.patch(`/api/boards/${created.body.id}`).send({ name: 'Launch v2' })).body.name, 'Launch v2');
    assert.equal((await agent.post('/api/boards').send({ name: '' })).status, 400);

    await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'One' });
    const { body: two } = await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'Two' });
    await agent.patch(`/api/tasks/${two.id}`).send({ done: true });
    const counts = (await agent.get('/api/boards')).body.find((b) => b.id === board.id);
    assert.equal(counts.taskCount, 2);
    assert.equal(counts.openCount, 1);

    assert.equal((await agent.delete(`/api/boards/${created.body.id}`)).status, 204);
    assert.equal((await agent.get(`/api/boards/${created.body.id}/tasks`)).status, 404);
  });

  test('tasks: due dates, updates, ordering and deletion', async () => {
    const { agent, board } = await signUp();
    const url = `/api/boards/${board.id}/tasks`;
    assert.equal((await agent.post(url).send({ title: 'Bad date', dueDate: '2026-02-30' })).status, 400);
    assert.equal((await agent.post(url).send({ title: '' })).status, 400);

    const { body: later } = await agent.post(url).send({ title: 'Later', dueDate: isoDate(9) });
    const { body: soon } = await agent.post(url).send({ title: 'Soon', dueDate: isoDate(1) });
    const { body: undated } = await agent.post(url).send({ title: 'Someday' });
    assert.equal(soon.dueDate, isoDate(1));
    assert.equal(undated.dueDate, null);
    assert.deepEqual(soon.attachments, []);

    let list = (await agent.get(url)).body;
    assert.deepEqual(list.map((t) => t.title), ['Soon', 'Later', 'Someday'], 'open tasks by due date, undated last');

    const done = await agent.patch(`/api/tasks/${soon.id}`).send({ done: true });
    assert.equal(done.body.done, true);
    assert.equal(done.body.title, 'Soon');
    list = (await agent.get(url)).body;
    assert.equal(list.at(-1).title, 'Soon', 'done tasks sort last');

    const cleared = await agent.patch(`/api/tasks/${later.id}`).send({ dueDate: null, title: 'Later, undated' });
    assert.equal(cleared.body.dueDate, null);
    assert.equal(cleared.body.title, 'Later, undated');
    assert.equal((await agent.patch(`/api/tasks/${later.id}`).send({})).status, 400);
    assert.equal((await agent.patch(`/api/tasks/${later.id}`).send({ done: 'yes' })).status, 400);
    assert.equal((await agent.patch(`/api/tasks/${later.id}`).send({ dueDate: 'tomorrow' })).status, 400);

    assert.equal((await agent.delete(`/api/tasks/${undated.id}`)).status, 204);
    assert.equal((await agent.delete(`/api/tasks/${undated.id}`)).status, 404);
  });

  test('attachments: upload, download, delete', async () => {
    const { agent, board } = await signUp();
    const { body: task } = await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'With files' });
    const url = `/api/tasks/${task.id}/attachments`;

    const up = await agent
      .post(url)
      .set('Content-Type', 'text/plain')
      .set('X-Filename', encodeURIComponent('Release notes ü.txt'))
      .send(Buffer.from('hello from S3'));
    assert.equal(up.status, 201);
    assert.equal(up.body.filename, 'Release notes ü.txt');
    assert.equal(up.body.size, 13);
    assert.equal(storage.files.size >= 1, true);

    // A JSON file is stored as-is, not parsed as a JSON request body.
    const json = await agent
      .post(url)
      .set('Content-Type', 'application/json')
      .set('X-Filename', 'data.json')
      .send(Buffer.from('{"not": "parsed"'));
    assert.equal(json.status, 201);

    const listed = (await agent.get(`/api/boards/${board.id}/tasks`)).body[0].attachments;
    assert.deepEqual(listed.map((a) => a.filename), ['Release notes ü.txt', 'data.json']);

    const down = await agent.get(`/api/attachments/${up.body.id}`);
    assert.equal(down.status, 200);
    assert.equal(down.text, 'hello from S3');
    assert.match(down.headers['content-disposition'], /^attachment; filename="Release notes _.txt"; filename\*=UTF-8''Release%20notes%20%C3%BC.txt$/);
    assert.equal(down.headers['cache-control'], 'private, no-store');

    assert.equal((await agent.post(url).set('X-Filename', 'empty.txt').send(Buffer.alloc(0))).status, 400);
    assert.equal((await agent.post(url).set('Content-Type', 'text/plain').send(Buffer.from('x'))).status, 400, 'filename required');
    const tooBig = await agent
      .post(url)
      .set('Content-Type', 'application/octet-stream')
      .set('X-Filename', 'big.bin')
      .send(Buffer.alloc(MAX_UPLOAD_BYTES + 1));
    assert.equal(tooBig.status, 413);

    const keyOf = async (id) => (await repo.getAttachment((await agent.get('/api/auth/me')).body.user.id, id)).storageKey;
    const key = await keyOf(up.body.id);
    assert.equal((await agent.delete(`/api/attachments/${up.body.id}`)).status, 204);
    assert.equal(storage.files.has(key), false, 'the file is removed from storage');
    assert.equal((await agent.get(`/api/attachments/${up.body.id}`)).status, 404);

    // Deleting the task removes its remaining files too.
    const jsonKey = await keyOf(json.body.id);
    assert.equal((await agent.delete(`/api/tasks/${task.id}`)).status, 204);
    assert.equal(storage.files.has(jsonKey), false);
  });

  test("users can't see or change each other's data", async () => {
    const ada = await signUp('Ada');
    const eve = await signUp('Eve');
    const { body: task } = await ada.agent.post(`/api/boards/${ada.board.id}/tasks`).send({ title: 'Private' });
    const { body: file } = await ada.agent
      .post(`/api/tasks/${task.id}/attachments`)
      .set('Content-Type', 'text/plain')
      .set('X-Filename', 'secret.txt')
      .send(Buffer.from('secret'));

    const attempts = [
      eve.agent.get(`/api/boards/${ada.board.id}/tasks`),
      eve.agent.post(`/api/boards/${ada.board.id}/tasks`).send({ title: 'Intruder' }),
      eve.agent.patch(`/api/boards/${ada.board.id}`).send({ name: 'Mine now' }),
      eve.agent.patch(`/api/tasks/${task.id}`).send({ done: true }),
      eve.agent.get(`/api/attachments/${file.id}`),
      eve.agent.delete(`/api/attachments/${file.id}`),
      eve.agent.post(`/api/tasks/${task.id}/attachments`).set('X-Filename', 'x.txt').send(Buffer.from('x')),
      eve.agent.delete(`/api/tasks/${task.id}`),
      eve.agent.delete(`/api/boards/${ada.board.id}`),
    ];
    for (const res of await Promise.all(attempts)) {
      assert.equal(res.status, 404, `${res.req.method} ${res.req.path}`);
    }
    const still = (await ada.agent.get(`/api/boards/${ada.board.id}/tasks`)).body;
    assert.equal(still.length, 1);
    assert.equal(still[0].done, false);
    assert.equal(still[0].attachments.length, 1);
    assert.deepEqual((await eve.agent.get('/api/boards')).body.map((b) => b.name), ['My tasks']);
  });

  test('reminders: due tasks are queued once, emailed once, and re-armed by a new due date', async () => {
    const { agent, board, email } = await signUp('Margaret');
    const url = `/api/boards/${board.id}/tasks`;
    const { body: due } = await agent.post(url).send({ title: 'Due tomorrow', dueDate: isoDate(1) });
    const { body: farOff } = await agent.post(url).send({ title: 'Next month', dueDate: isoDate(30) });
    const { body: finished } = await agent.post(url).send({ title: 'Already done', dueDate: isoDate(0) });
    await agent.patch(`/api/tasks/${finished.id}`).send({ done: true });

    const pending = async () => (await repo.tasksNeedingReminder()).map((t) => t.id);
    assert.equal((await pending()).includes(due.id), true);
    assert.equal((await pending()).includes(farOff.id), false);
    assert.equal((await pending()).includes(finished.id), false);

    // The scan, through a real BullMQ queue: the job id stops a second scan queueing it again.
    const queue = new Queue(`reminders-test-${randomUUID()}`, { connection: { url: REDIS_URL, maxRetriesPerRequest: null } });
    try {
      await scanDueTasks({ repo, queue });
      await scanDueTasks({ repo, queue });
      const jobs = (await queue.getJobs(['waiting'])).filter((j) => j.data.taskId === due.id);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].id, `reminder-${due.id}-${isoDate(1)}`);
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
    }

    const sent = [];
    const deps = { repo, mailer: { send: async (msg) => sent.push(msg) }, appUrl: 'https://taskboard.example.com' };
    assert.deepEqual(await sendReminder(deps, { taskId: due.id, dueDate: isoDate(1) }), { sent: true });
    assert.deepEqual(await sendReminder(deps, { taskId: due.id, dueDate: isoDate(1) }), { sent: false }, 'not sent twice');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, email);
    assert.match(sent[0].subject, /"Due tomorrow" is due tomorrow/);
    assert.equal((await pending()).includes(due.id), false);

    // A new due date means a new reminder.
    await agent.patch(`/api/tasks/${due.id}`).send({ dueDate: isoDate(0) });
    assert.equal((await pending()).includes(due.id), true);
    // A stale job for the old date is skipped.
    assert.deepEqual(await sendReminder(deps, { taskId: due.id, dueDate: isoDate(1) }), { sent: false });
  });
});

describe('migrations', { skip: !DATABASE_URL && 'DATABASE_URL not set' }, () => {
  test('concurrent runs do not race, and re-runs are no-ops', async () => {
    const dbs = [createDb(DATABASE_URL), createDb(DATABASE_URL), createDb(DATABASE_URL)];
    try {
      await Promise.all(dbs.map((db) => migrate(db.pool)));
      await migrate(dbs[0].pool);
      const { rows } = await dbs[0].query('SELECT version FROM schema_migrations ORDER BY version');
      assert.deepEqual(rows.map((r) => r.version), ['001_create_tasks.sql', '002_accounts_boards_attachments.sql']);
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });
});
