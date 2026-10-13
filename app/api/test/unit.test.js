import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/passwords.js';
import { buildReminderEmail, describeDue, reminderJobId, scanDueTasks, sendReminder } from '../src/reminders.js';
import { parseContentType, parseDate, parseEmail, parseFilename, parseId, parseText } from '../src/validate.js';

// ---------------------------------------------------------------- validation

test('parses text, ids and emails', () => {
  assert.equal(parseText('  Ship it  ', 200), 'Ship it');
  for (const bad of [undefined, '', '   ', 42, 'x'.repeat(201)]) assert.equal(parseText(bad, 200), null);
  assert.equal(parseId('7'), 7);
  for (const bad of ['0', '-1', 'abc', '1.5', '99999999999']) assert.equal(parseId(bad), null);
  assert.equal(parseEmail(' Ada@Example.COM '), 'ada@example.com');
  for (const bad of ['ada', 'ada@example', '@example.com', 'a b@example.com', 5]) assert.equal(parseEmail(bad), null);
});

test('accepts only real calendar dates', () => {
  assert.equal(parseDate('2026-10-14'), '2026-10-14');
  for (const bad of ['2026-02-30', '2026-13-01', '14/10/2026', '2026-10-14T00:00:00Z', null]) {
    assert.equal(parseDate(bad), null, `${bad} should be rejected`);
  }
});

test('cleans uploaded filenames and content types', () => {
  assert.equal(parseFilename(encodeURIComponent('Q3 report ü.pdf')), 'Q3 report ü.pdf');
  assert.equal(parseFilename(encodeURIComponent('../../etc/passwd')), 'passwd');
  assert.equal(parseFilename(encodeURIComponent('C:\\Users\\me\\notes.txt')), 'notes.txt');
  assert.equal(parseFilename('%E0%A4%A'), null);
  assert.equal(parseFilename(undefined), null);
  assert.equal(parseContentType('image/png'), 'image/png');
  assert.equal(parseContentType('text/plain; charset=utf-8'), 'text/plain');
  assert.equal(parseContentType('not a type'), 'application/octet-stream');
});

// ---------------------------------------------------------------- passwords

test('hashes and verifies passwords', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(hash, await hashPassword('correct horse battery'), 'salt makes each hash unique');
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('wrong horse battery', hash), false);
  assert.equal(await verifyPassword('anything', 'not-a-hash'), false);
});

// ---------------------------------------------------------------- reminders

const dueTask = {
  id: 4,
  title: 'Renew <TLS> cert',
  dueDate: '2026-10-14',
  boardName: 'Ops',
  email: 'ada@example.com',
  userName: 'Ada',
};

test('describes how soon a task is due', () => {
  assert.equal(describeDue('2026-10-12', '2026-10-13'), 'overdue');
  assert.equal(describeDue('2026-10-13', '2026-10-13'), 'due today');
  assert.equal(describeDue('2026-10-14', '2026-10-13'), 'due tomorrow');
  assert.equal(describeDue('2026-10-20', '2026-10-13'), 'due in 7 days');
});

test('builds a reminder email with escaped HTML', () => {
  const email = buildReminderEmail(dueTask, 'https://taskboard.example.com', '2026-10-13');
  assert.equal(email.to, 'ada@example.com');
  assert.equal(email.subject, 'Reminder: "Renew <TLS> cert" is due tomorrow');
  assert.match(email.text, /board "Ops" is due tomorrow \(2026-10-14\)/);
  assert.match(email.html, /Renew &lt;TLS&gt; cert/);
  assert.doesNotMatch(email.html, /<TLS>/);
});

test('scan queues one email job per due task, keyed by task and due date', async () => {
  const added = [];
  const repo = { tasksNeedingReminder: async () => [{ id: 4, dueDate: '2026-10-14' }, { id: 9, dueDate: '2026-10-13' }] };
  const queue = { addBulk: async (jobs) => added.push(...jobs) };
  assert.deepEqual(await scanDueTasks({ repo, queue }), { queued: 2 });
  assert.deepEqual(
    added.map((j) => j.opts.jobId),
    ['reminder-4-2026-10-14', 'reminder-9-2026-10-13'],
  );
  assert.equal(reminderJobId({ id: 4, dueDate: '2026-10-14' }).includes(':'), false, 'BullMQ rejects ":" in ids');
});

test('sends a reminder only if the task still needs one', async () => {
  const sent = [];
  const marked = [];
  const mailer = { send: async (msg) => sent.push(msg) };
  const repo = {
    reminderDetails: async (id) => (id === 4 ? dueTask : null),
    markReminded: async (id, due) => marked.push([id, due]),
  };
  const deps = { repo, mailer, appUrl: 'https://taskboard.example.com' };

  assert.deepEqual(await sendReminder(deps, { taskId: 4, dueDate: '2026-10-14' }, '2026-10-13'), { sent: true });
  assert.deepEqual(await sendReminder(deps, { taskId: 5, dueDate: '2026-10-14' }, '2026-10-13'), { sent: false });
  assert.equal(sent.length, 1);
  assert.deepEqual(marked, [[4, '2026-10-14']]);
});

// ---------------------------------------------------------------- HTTP basics

const stubApp = ({ ping = async () => {} } = {}) =>
  createApp({
    repo: {},
    sessions: { ttlSeconds: 60, get: async () => null },
    limiter: {},
    storage: {},
    ping,
  });

test('liveness probe is always ok', async () => {
  const res = await request(stubApp()).get('/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('readiness probe reports dependency state', async () => {
  assert.equal((await request(stubApp()).get('/readyz')).status, 200);
  const down = stubApp({ ping: async () => { throw new Error('redis down'); } });
  const res = await request(down).get('/readyz');
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { status: 'unavailable' });
});

test('API routes require a session', async () => {
  const app = stubApp();
  for (const [method, path] of [
    ['get', '/api/auth/me'],
    ['get', '/api/boards'],
    ['patch', '/api/tasks/1'],
    ['post', '/api/tasks/1/attachments'],
    ['get', '/api/attachments/1'],
  ]) {
    const res = await request(app)[method](path);
    assert.equal(res.status, 401, `${method.toUpperCase()} ${path}`);
  }
});

test('returns 400 for malformed JSON', async () => {
  const res = await request(stubApp())
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send('{"email":');
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'invalid JSON' });
});

test('exposes Prometheus metrics labelled by route', async () => {
  const app = stubApp();
  await request(app).get('/readyz');
  const res = await request(app).get('/metrics');
  assert.equal(res.status, 200);
  assert.match(res.text, /http_requests_total\{method="GET",route="\/readyz",status="200"\} 1/);
});
