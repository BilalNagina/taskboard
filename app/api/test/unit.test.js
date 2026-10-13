import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { roleAtLeast, toPrefixQuery } from '../src/data/index.js';
import { boardCsv, csvCell, pdfSafe, timesheetCsv } from '../src/exporters.js';
import { imageType } from '../src/http/routes/attachments.js';
import { buildInviteEmail, buildNotificationEmail, buildPasswordResetEmail, buildReminderEmail } from '../src/emails.js';
import { emailTypesFor } from '../src/data/notifications.js';
import { createApp } from '../src/http/app.js';
import { HttpError } from '../src/http/errors.js';
import { parseContentType, parseFilename, parseId, schemas, validate } from '../src/http/validation.js';
import { inviteLink, resetLink, sendInvite, sendPasswordReset } from '../src/jobs.js';
import { hashPassword, verifyPassword } from '../src/passwords.js';
import { nextDueDate } from '../src/recurrence.js';
import { describeDue, reminderJobId, scanDueTasks, sendReminder } from '../src/reminders.js';
import { LABEL_COLORS } from '../src/data/boards.js';
import { TEMPLATE_KEYS, TEMPLATES, templateSummaries } from '../src/templates.js';

const rejects = (schema, value) => assert.throws(() => validate(schema, value), HttpError);

// ---------------------------------------------------------------- validation

test('sign-up input is trimmed, lowercased and checked', () => {
  assert.deepEqual(validate(schemas.register, { name: '  Ada  ', email: ' Ada@Example.COM ', password: 'correct horse' }), {
    name: 'Ada',
    email: 'ada@example.com',
    password: 'correct horse',
  });
  rejects(schemas.register, { name: '', email: 'ada@example.com', password: 'correct horse' });
  rejects(schemas.register, { name: 'Ada', email: 'ada@example', password: 'correct horse' });
  rejects(schemas.register, { name: 'Ada', email: 'ada@example.com', password: 'short' });
  rejects(schemas.register, undefined);
  assert.throws(() => validate(schemas.register, { name: 'x'.repeat(81), email: 'a@b.co', password: '12345678' }), {
    message: 'name must be at most 80 characters',
  });
});

test('task input accepts only real dates and real changes', () => {
  assert.equal(validate(schemas.newTask, { title: 'Ship', dueDate: '2026-10-14' }).dueDate, '2026-10-14');
  assert.equal(validate(schemas.newTask, { title: 'Ship', dueDate: null }).dueDate, null);
  for (const dueDate of ['2026-02-30', '14/10/2026', 'tomorrow']) rejects(schemas.newTask, { title: 'Ship', dueDate });
  assert.throws(() => validate(schemas.updateTask, {}), { message: 'nothing to update' });
  assert.deepEqual(validate(schemas.updateTask, { dueDate: null }), { dueDate: null });
  rejects(schemas.updateTask, { done: 'yes' });
  rejects(schemas.profile, { theme: 'purple' });
});

test('ids, filenames and content types', () => {
  assert.equal(parseId('7', 'task'), 7);
  for (const bad of ['0', '-1', 'abc', '1.5', '99999999999']) assert.throws(() => parseId(bad, 'task'), { status: 400 });
  assert.equal(parseFilename(encodeURIComponent('Q3 report ü.pdf')), 'Q3 report ü.pdf');
  assert.equal(parseFilename(encodeURIComponent('../../etc/passwd')), 'passwd');
  assert.equal(parseFilename(encodeURIComponent('C:\\Users\\me\\notes.txt')), 'notes.txt');
  assert.equal(parseFilename('%E0%A4%A'), null);
  assert.equal(parseContentType('text/plain; charset=utf-8'), 'text/plain');
  assert.equal(parseContentType('not a type'), 'application/octet-stream');
});

test('roles rank viewer < member < owner', () => {
  assert.equal(roleAtLeast('owner', 'member'), true);
  assert.equal(roleAtLeast('member', 'member'), true);
  assert.equal(roleAtLeast('viewer', 'member'), false);
  assert.equal(roleAtLeast('member', 'owner'), false);
  assert.equal(roleAtLeast(undefined, 'viewer'), false);
});

test('search text becomes a safe prefix query', () => {
  assert.equal(toPrefixQuery('Inv rep'), 'inv:* & rep:*');
  assert.equal(toPrefixQuery('launch & (draft) | !x:*'), 'launch:* & draft:* & x:*', 'tsquery operators are stripped');
  assert.equal(toPrefixQuery('Café ü'), 'café:* & ü:*');
  assert.equal(toPrefixQuery('  !!  '), null);
});

test('CSV cells are quoted and protected against formula injection', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell(null), '');
  const csv = boardCsv([
    { title: 'Ship', column: 'Done', done: true, priority: 'high', dueDate: '2026-10-14', assignees: 'Ada', labels: 'Bug', checklistDone: 1, checklistTotal: 2, description: '', createdAt: '2026-10-01T10:00:00Z', completedAt: null },
  ]);
  assert.ok(csv.startsWith('﻿Title,Column,Status'));
  assert.match(csv, /\r\nShip,Done,Done,High,2026-10-14,Ada,Bug,1\/2,,2026-10-01,\r\n$/);
});

test('PDF text keeps Western characters and replaces the rest', () => {
  assert.equal(pdfSafe('Café – “ok” …'), 'Café – “ok” …');
  assert.equal(pdfSafe('مرحبا 你好'), '????? ??');
});

test('avatars must really be images', () => {
  const pad = (bytes) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);
  assert.equal(imageType(pad([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(imageType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(imageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])), 'image/webp');
  assert.equal(imageType(pad([0x3c, 0x73, 0x76, 0x67])), null, 'SVG (and anything else) is refused');
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

// ---------------------------------------------------------------- emails and jobs

const dueTask = {
  id: 4,
  boardId: 2,
  title: 'Renew <TLS> cert',
  dueDate: '2026-10-14',
  boardName: 'Ops',
  workspaceId: 1,
  recipients: [
    { id: 1, email: 'ada@example.com', name: 'Ada', emailReminders: true },
    { id: 2, email: 'grace@example.com', name: 'Grace', emailReminders: true },
    { id: 3, email: 'quiet@example.com', name: 'Quiet', emailReminders: false },
  ],
};

test('describes how soon a task is due', () => {
  assert.equal(describeDue('2026-10-12', '2026-10-13'), 'overdue');
  assert.equal(describeDue('2026-10-13', '2026-10-13'), 'due today');
  assert.equal(describeDue('2026-10-14', '2026-10-13'), 'due tomorrow');
  assert.equal(describeDue('2026-10-20', '2026-10-13'), 'due in 7 days');
});

test('reminder and reset emails escape user content', () => {
  const reminder = buildReminderEmail({ ...dueTask, email: 'ada@example.com', userName: 'Ada' }, 'https://app.example.com/app/boards/2?task=4', 'due tomorrow');
  assert.equal(reminder.subject, 'Reminder: "Renew <TLS> cert" is due tomorrow');
  assert.match(reminder.html, /Renew &lt;TLS&gt; cert/);
  assert.doesNotMatch(reminder.html, /<TLS>/);
  assert.match(reminder.text, /boards\/2\?task=4/);

  const invite = buildInviteEmail({ email: 'bo@example.com', inviterName: 'Ada <script>', workspaceName: 'Acme', role: 'member' }, 'https://app.example.com/invite/tok', 7);
  assert.equal(invite.to, 'bo@example.com');
  assert.equal(invite.subject, 'Ada <script> invited you to Acme on Tasklane');
  assert.match(invite.text, /as a member/);
  assert.doesNotMatch(invite.html, /<script>/);

  const reset = buildPasswordResetEmail({ name: '<b>Ada</b>', email: 'ada@example.com' }, 'https://app.example.com/reset-password?token=abc', 30);
  assert.equal(reset.to, 'ada@example.com');
  assert.match(reset.subject, /Reset your Tasklane password/);
  assert.match(reset.text, /reset-password\?token=abc/);
  assert.match(reset.text, /within 30 minutes/);
  assert.doesNotMatch(reset.html, /<b>Ada<\/b>/);
});

test('scan queues one email job per due task, keyed by task and due date', async () => {
  const added = [];
  const repo = { tasksNeedingReminder: async () => [{ id: 4, dueDate: '2026-10-14' }, { id: 9, dueDate: '2026-10-13' }] };
  assert.deepEqual(await scanDueTasks({ repo, queue: { addBulk: async (jobs) => added.push(...jobs) } }), { queued: 2 });
  assert.deepEqual(added.map((j) => j.opts.jobId), ['reminder-4-2026-10-14', 'reminder-9-2026-10-13']);
  assert.equal(reminderJobId({ id: 4, dueDate: '2026-10-14' }).includes(':'), false, 'BullMQ rejects ":" in ids');
});

test('sends a reminder to every recipient, only if the task still needs one', async () => {
  const sent = [];
  const marked = [];
  const notified = [];
  const repo = {
    reminderDetails: async (id) => (id === 4 ? dueTask : null),
    markReminded: async (id, due) => marked.push([id, due]),
    notify: async (n) => notified.push(n),
  };
  const deps = { repo, mailer: { send: async (msg) => sent.push(msg) }, appUrl: 'https://app.example.com' };
  assert.deepEqual(await sendReminder(deps, { taskId: 4, dueDate: '2026-10-14' }, '2026-10-13'), { sent: true });
  assert.deepEqual(await sendReminder(deps, { taskId: 5, dueDate: '2026-10-14' }, '2026-10-13'), { sent: false });
  assert.deepEqual(sent.map((m) => m.to), ['ada@example.com', 'grace@example.com'], 'no email for people who turned reminders off');
  assert.deepEqual(notified[0].userIds, [1, 2, 3], 'but everyone gets the in-app notification');
  assert.equal(notified[0].type, 'due');
  assert.match(sent[0].text, /app\/boards\/2\?task=4/);
  assert.deepEqual(marked, [[4, '2026-10-14']]);
});

test('password-reset job emails a link with the token', async () => {
  const sent = [];
  const repo = { findUserById: async (id) => (id === 1 ? { id: 1, name: 'Ada', email: 'ada@example.com' } : null) };
  const deps = { repo, mailer: { send: async (msg) => sent.push(msg) }, appUrl: 'https://app.example.com' };
  assert.deepEqual(await sendPasswordReset(deps, { userId: 1, token: 'tok+en/=' }), { sent: true });
  assert.deepEqual(await sendPasswordReset(deps, { userId: 2, token: 'x' }), { sent: false });
  assert.equal(resetLink('https://app.example.com', 'tok+en/='), 'https://app.example.com/reset-password?token=tok%2Ben%2F%3D');
  assert.match(sent[0].text, /token=tok%2Ben%2F%3D/);
});

test('invite job emails the invitee unless the invite is gone', async () => {
  const sent = [];
  const invite = { id: 3, email: 'bo@example.com', role: 'viewer', workspaceName: 'Acme', invitedBy: { name: 'Ada' } };
  const repo = { getInvite: async (id) => (id === 3 ? invite : null) };
  const deps = { repo, mailer: { send: async (msg) => sent.push(msg) }, appUrl: 'https://app.example.com' };
  assert.deepEqual(await sendInvite(deps, { inviteId: 3, token: 'abc' }), { sent: true });
  assert.deepEqual(await sendInvite(deps, { inviteId: 9, token: 'abc' }), { sent: false });
  assert.equal(inviteLink('https://app.example.com', 'a/b'), 'https://app.example.com/invite/a%2Fb');
  assert.match(sent[0].text, /invite\/abc/);
  assert.match(sent[0].subject, /Ada invited you to Acme/);
});

// ---------------------------------------------------------------- HTTP basics

const stubApp = ({ ping = async () => {} } = {}) =>
  createApp({ repo: {}, sessions: { ttlSeconds: 60, get: async () => null }, limiter: {}, storage: {}, jobs: {}, ping });

test('liveness probe is always ok', async () => {
  const res = await request(stubApp()).get('/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('readiness probe reports dependency state', async () => {
  assert.equal((await request(stubApp()).get('/readyz')).status, 200);
  const res = await request(stubApp({ ping: async () => { throw new Error('redis down'); } })).get('/readyz');
  assert.equal(res.status, 503);
});

test('API routes require a session', async () => {
  const app = stubApp();
  for (const [method, path] of [
    ['get', '/api/auth/me'],
    ['patch', '/api/me'],
    ['get', '/api/workspaces'],
    ['get', '/api/boards/1'],
    ['patch', '/api/tasks/1'],
    ['post', '/api/tasks/1/attachments'],
    ['get', '/api/attachments/1'],
  ]) {
    assert.equal((await request(app)[method](path)).status, 401, `${method.toUpperCase()} ${path}`);
  }
});

test('returns 400 for malformed JSON', async () => {
  const res = await request(stubApp()).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'invalid JSON' });
});

test('exposes Prometheus metrics labelled by route', async () => {
  const app = stubApp();
  await request(app).get('/readyz');
  const res = await request(app).get('/metrics');
  assert.match(res.text, /http_requests_total\{method="GET",route="\/readyz",status="200"\} 1/);
});

// ---------------------------------------------------------------- recurring tasks

test('repeating tasks get their next due date after today', () => {
  const today = '2026-10-14'; // a Wednesday
  assert.equal(nextDueDate('daily', '2026-10-14', today), '2026-10-15');
  assert.equal(nextDueDate('weekly', '2026-10-16', today), '2026-10-23', 'finished early: the following week');
  assert.equal(nextDueDate('weekly', '2026-09-30', today), '2026-10-21', 'overdue: skips to the first date after today');
  assert.equal(nextDueDate('daily', '2026-10-01', today), '2026-10-15');
  assert.equal(nextDueDate('weekly', null, today), '2026-10-21', 'no due date: counts from today');
  assert.equal(nextDueDate('weekdays', '2026-10-16', '2026-10-16'), '2026-10-19', 'Friday to Monday');
  assert.equal(nextDueDate('weekdays', '2026-10-17', '2026-10-16'), '2026-10-19', 'Saturday to Monday');
  assert.equal(nextDueDate('monthly', '2026-01-31', '2026-01-31'), '2026-02-28', 'the 31st becomes the end of February');
  assert.equal(nextDueDate('monthly', '2028-01-31', '2028-01-31'), '2028-02-29', 'leap years too');
  assert.equal(nextDueDate('monthly', '2026-12-15', '2026-12-15'), '2027-01-15', 'across the year end');
  assert.equal(nextDueDate('daily', '2026-03-28', '2026-03-28'), '2026-03-29', 'daylight saving changes do not shift days');
  assert.throws(() => nextDueDate('hourly', null, today));
});

test('task input accepts a repeat setting', () => {
  assert.equal(validate(schemas.newTask, { title: 'Rent', repeat: 'monthly' }).repeat, 'monthly');
  assert.deepEqual(validate(schemas.updateTask, { repeat: null }), { repeat: null });
  rejects(schemas.updateTask, { repeat: 'hourly' });
});

// ---------------------------------------------------------------- templates

test('every template is internally consistent', () => {
  assert.deepEqual(TEMPLATE_KEYS, ['blank', 'sprint', 'content', 'hiring'], 'the sample board is not offered as a template');
  for (const [key, t] of Object.entries(TEMPLATES)) {
    assert.ok(t.columns.length >= 1 && t.columns.length <= 8, key);
    assert.ok(t.columns.some((c) => c.done), `${key} has a done column`);
    assert.ok(t.columns.every((c) => c.name.length <= 40), `${key} column names fit`);
    const labels = new Set(t.labels.map(([name]) => name));
    assert.equal(labels.size, t.labels.length, `${key} label names are unique`);
    for (const [, color] of t.labels) assert.ok(LABEL_COLORS.includes(color), `${key} uses known colours`);
    for (const task of t.tasks) {
      assert.ok(task.title.length <= 200 && task.column >= 0 && task.column < t.columns.length, `${key}: ${task.title}`);
      for (const name of task.labels ?? []) assert.ok(labels.has(name), `${key}: ${task.title} uses label ${name}`);
      assert.ok(!task.repeat || ['daily', 'weekdays', 'weekly', 'monthly'].includes(task.repeat));
      assert.ok((task.description ?? '').length <= 5000);
      // Reminders go out for tasks due today or tomorrow; example cards shouldn't trigger them on day one.
      assert.ok(task.due === undefined || task.due >= 2, `${key}: ${task.title} is not due straight away`);
    }
  }
  const summary = templateSummaries().find((t) => t.key === 'sprint');
  assert.deepEqual(summary.columns, ['Backlog', 'Ready', 'In progress', 'In review', 'Done']);
  assert.equal(summary.taskCount, TEMPLATES.sprint.tasks.length);
});

test('board, timer and time entry input', () => {
  assert.deepEqual(validate(schemas.newBoard, { name: ' Sprint 14 ', template: 'sprint' }), { name: 'Sprint 14', template: 'sprint' });
  rejects(schemas.newBoard, { name: 'Sample', template: 'starter' });
  rejects(schemas.startTimer, {});
  assert.deepEqual(validate(schemas.timeEntry, { day: '2026-10-14', minutes: 90, note: ' Planning ' }), { day: '2026-10-14', minutes: 90, note: 'Planning' });
  for (const minutes of [0, 1441, 1.5, '30']) rejects(schemas.timeEntry, { day: '2026-10-14', minutes });
  assert.deepEqual(validate(schemas.timesheet, { from: '2026-10-12', to: '2026-10-18', userId: '7' }), { from: '2026-10-12', to: '2026-10-18', userId: 7 });
  assert.throws(() => validate(schemas.timesheet, { from: '2026-01-01', to: '2026-12-31' }), { message: 'the range can be at most 62 days' });
  assert.deepEqual(validate(schemas.profile, { onboarded: true }), { onboarded: true });
  rejects(schemas.profile, { onboarded: false });
});

test('timesheet CSV has hours and is safe for spreadsheets', () => {
  const csv = timesheetCsv([{ day: '2026-10-14', person: 'Ada', board: 'Launch', task: '=SUM(A1)', minutes: 90, note: 'Call, then notes' }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const lines = csv.slice(1).split(String.fromCharCode(13, 10));
  assert.equal(lines[0], 'Date,Person,Board,Task,Minutes,Hours,Note');
  assert.equal(lines[1], `2026-10-14,Ada,Launch,'=SUM(A1),90,1.50,"Call, then notes"`);
});

// ---------------------------------------------------------------- notification emails

test('notification emails follow the email switches, which default to on', () => {
  assert.deepEqual(emailTypesFor({}), ['assigned', 'mentioned', 'comment']);
  assert.deepEqual(emailTypesFor({ emailComment: false, comment: true }), ['assigned', 'mentioned']);
  assert.deepEqual(emailTypesFor({ emailAssigned: false, emailMentioned: false, emailComment: false }), []);
  assert.deepEqual(validate(schemas.profile, { notificationPrefs: { emailMentioned: false } }), { notificationPrefs: { emailMentioned: false } });
});

test('notification email: subject for one or several, links, and escaped content', () => {
  const user = { name: 'Ada', email: 'ada@example.com' };
  const base = { boardId: 3, taskId: 9, boardName: 'Launch', actor: { name: '<Bo>' }, data: {} };
  const one = buildNotificationEmail(user, [{ ...base, type: 'mentioned', taskTitle: 'Fix <b>it</b>', data: { excerpt: '@Ada look <here>' } }], 'https://app.example.com');
  assert.equal(one.to, 'ada@example.com');
  assert.equal(one.subject, '<Bo> mentioned you on “Fix <b>it</b>”', 'subjects are plain text');
  assert.match(one.text, /https:\/\/app\.example\.com\/app\/boards\/3\?task=9/);
  assert.ok(one.html.includes('&lt;Bo&gt; mentioned you on “Fix &lt;b&gt;it&lt;/b&gt;”'));
  assert.ok(one.html.includes('@Ada look &lt;here&gt;'));
  assert.ok(!one.html.includes('<b>it</b>'));
  assert.match(one.text, /notification settings/);
  const many = buildNotificationEmail(user, [{ ...base, type: 'assigned', taskTitle: 'A' }, { ...base, type: 'comment', taskTitle: 'B' }], 'https://app.example.com');
  assert.equal(many.subject, '2 updates in Tasklane');
  assert.match(many.text, /<Bo> assigned you “A” \(Launch\)/);
  assert.match(many.text, /<Bo> commented on “B”/);
});
