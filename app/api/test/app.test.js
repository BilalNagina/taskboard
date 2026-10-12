import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

function fakeRepo() {
  const tasks = [];
  let nextId = 1;
  return {
    list: async () => tasks,
    create: async (title) => {
      const task = { id: nextId++, title, done: false };
      tasks.push(task);
      return task;
    },
    update: async (id, { title, done }) => {
      const task = tasks.find((t) => t.id === id);
      if (!task) return null;
      if (title !== undefined) task.title = title;
      if (done !== undefined) task.done = done;
      return task;
    },
    remove: async (id) => {
      const i = tasks.findIndex((t) => t.id === id);
      if (i < 0) return false;
      tasks.splice(i, 1);
      return true;
    },
  };
}

const appWith = ({ ping = async () => {} } = {}) => createApp({ repo: fakeRepo(), ping });

test('liveness probe is always ok', async () => {
  const res = await request(appWith()).get('/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('readiness probe reports database state', async () => {
  assert.equal((await request(appWith()).get('/readyz')).status, 200);
  const down = appWith({ ping: async () => { throw new Error('db down'); } });
  const res = await request(down).get('/readyz');
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { status: 'unavailable' });
});

test('creates and lists tasks', async () => {
  const app = appWith();
  const created = await request(app).post('/api/tasks').send({ title: '  Ship it  ' });
  assert.equal(created.status, 201);
  assert.equal(created.body.title, 'Ship it');
  const list = await request(app).get('/api/tasks');
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
});

test('rejects invalid titles', async () => {
  const app = appWith();
  for (const title of [undefined, '', '   ', 42, 'x'.repeat(201)]) {
    const res = await request(app).post('/api/tasks').send({ title });
    assert.equal(res.status, 400, `title ${JSON.stringify(title)} should be rejected`);
  }
});

test('updates a task', async () => {
  const app = appWith();
  const { body: task } = await request(app).post('/api/tasks').send({ title: 'Write docs' });
  const res = await request(app).patch(`/api/tasks/${task.id}`).send({ done: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.done, true);
});

test('validates updates', async () => {
  const app = appWith();
  const { body: task } = await request(app).post('/api/tasks').send({ title: 'Write docs' });
  assert.equal((await request(app).patch(`/api/tasks/${task.id}`).send({})).status, 400);
  assert.equal((await request(app).patch(`/api/tasks/${task.id}`).send({ done: 'yes' })).status, 400);
  assert.equal((await request(app).patch(`/api/tasks/${task.id}`).send({ title: '' })).status, 400);
  assert.equal((await request(app).patch('/api/tasks/abc').send({ done: true })).status, 400);
  assert.equal((await request(app).patch('/api/tasks/999').send({ done: true })).status, 404);
});

test('deletes a task', async () => {
  const app = appWith();
  const { body: task } = await request(app).post('/api/tasks').send({ title: 'Temporary' });
  assert.equal((await request(app).delete(`/api/tasks/${task.id}`)).status, 204);
  assert.equal((await request(app).delete(`/api/tasks/${task.id}`)).status, 404);
});

test('returns 400 for malformed JSON', async () => {
  const res = await request(appWith())
    .post('/api/tasks')
    .set('Content-Type', 'application/json')
    .send('{"title":');
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'invalid JSON' });
});

test('exposes Prometheus metrics labelled by route', async () => {
  const app = appWith();
  await request(app).get('/api/tasks');
  const res = await request(app).get('/metrics');
  assert.equal(res.status, 200);
  assert.match(res.text, /http_requests_total\{method="GET",route="\/api\/tasks",status="200"\} 1/);
});
