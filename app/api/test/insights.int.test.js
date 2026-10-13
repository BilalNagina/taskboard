// End-to-end tests for the dashboard, calendar, search, notifications, avatars and exports.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sendReminder } from '../src/reminders.js';
import { isoDate, setupApi, skipIntegration } from './helpers.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('dashboard, calendar, search, notifications, avatars, exports', { skip: skipIntegration }, () => {
  let db, repo, signUp, addMember, close;

  before(async () => {
    ({ db, repo, signUp, addMember, close } = await setupApi());
  });

  after(() => close());

  const columnsOf = async (agent, boardId) => (await agent.get(`/api/boards/${boardId}/full`)).body.columns;

  test('dashboard counts, charts and lists follow the user’s own date', async () => {
    const { agent, board, workspace, user } = await signUp('Dana');
    const url = `/api/boards/${board.id}/tasks`;
    const today = isoDate(0);
    await agent.post(url).send({ title: 'Late', dueDate: isoDate(-2), priority: 'urgent', assigneeIds: [user.id] });
    await agent.post(url).send({ title: 'Soon', dueDate: isoDate(3), priority: 'high' });
    await agent.post(url).send({ title: 'Later', dueDate: isoDate(20) });
    const { body: shipped } = await agent.post(url).send({ title: 'Shipped' });
    await agent.patch(`/api/tasks/${shipped.id}`).send({ done: true });

    const res = await agent.get(`/api/workspaces/${workspace.id}/dashboard?today=${today}`);
    assert.equal(res.status, 200);
    const d = res.body;
    assert.deepEqual(d.totals, { open: 3, done: 1, overdue: 1, dueThisWeek: 1, completedThisWeek: 1 });
    assert.equal(d.completedByDay.length, 14);
    assert.equal(d.completedByDay.at(-1).count, 1, 'today’s completion is in the last bar');
    assert.equal(d.createdByDay.at(-1).count, 4);
    assert.deepEqual(Object.fromEntries(d.byPriority.map((p) => [p.priority, p.count])), { urgent: 1, high: 1, none: 1 });
    assert.deepEqual(d.byBoard.map((b) => [b.name, b.open, b.done]), [['My tasks', 3, 1]]);
    assert.deepEqual(d.byAssignee, [{ userId: user.id, open: 1, overdue: 1 }]);
    assert.deepEqual(d.overdue.map((t) => t.title), ['Late']);
    assert.deepEqual(d.upcoming.map((t) => t.title), ['Soon']);
    assert.deepEqual(d.mine.map((t) => t.title), ['Late']);
    assert.equal(d.overdue[0].boardName, 'My tasks');

    assert.equal((await agent.get(`/api/workspaces/${workspace.id}/dashboard?today=13/10/2026`)).status, 400);
    const outsider = await signUp('Olaf');
    assert.equal((await outsider.agent.get(`/api/workspaces/${workspace.id}/dashboard`)).status, 404);
  });

  test('calendar returns tasks due in a range, optionally for one board', async () => {
    const { agent, board, workspace } = await signUp('Cal');
    const other = (await agent.post(`/api/workspaces/${workspace.id}/boards`).send({ name: 'Second' })).body;
    await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'In range', dueDate: isoDate(2), labelIds: [] });
    await agent.post(`/api/boards/${other.id}/tasks`).send({ title: 'Other board', dueDate: isoDate(3) });
    await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'Too late', dueDate: isoDate(40) });
    await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'No date' });

    const all = (await agent.get(`/api/workspaces/${workspace.id}/calendar?from=${isoDate(0)}&to=${isoDate(30)}`)).body;
    assert.deepEqual(all.map((t) => t.title), ['In range', 'Other board']);
    assert.equal(all[0].columnName, 'To do');
    const one = (await agent.get(`/api/workspaces/${workspace.id}/calendar?from=${isoDate(0)}&to=${isoDate(30)}&boardId=${other.id}`)).body;
    assert.deepEqual(one.map((t) => t.title), ['Other board']);
    assert.equal((await agent.get(`/api/workspaces/${workspace.id}/calendar?from=${isoDate(0)}&to=${isoDate(90)}`)).status, 400, 'range capped');
    assert.equal((await agent.get(`/api/workspaces/${workspace.id}/calendar?from=${isoDate(5)}&to=${isoDate(0)}`)).status, 400);
  });

  test('search matches as you type, combines filters, and stays inside the workspace', async () => {
    const owner = await signUp('Sara');
    const teammate = await signUp('Tom');
    await addMember(owner.workspace.id, teammate.user.id, 'member');
    const url = `/api/boards/${owner.board.id}/tasks`;
    await owner.agent.post(url).send({ title: 'Send invoice to client', priority: 'high', assigneeIds: [teammate.user.id], dueDate: isoDate(-1) });
    await owner.agent.post(url).send({ title: 'Quarterly report', description: 'Include the invoice totals' });
    await owner.agent.post(url).send({ title: 'Plan offsite' });
    const outsider = await signUp('Uma');
    await outsider.agent.post(`/api/boards/${outsider.board.id}/tasks`).send({ title: 'Invoice from another company' });

    const search = async (query, agent = owner.agent) => (await agent.get(`/api/workspaces/${owner.workspace.id}/search?${query}`)).body;
    assert.deepEqual((await search('q=invoi')).map((t) => t.title).sort(), ['Quarterly report', 'Send invoice to client'], 'prefix match, title and description');
    assert.equal((await search('q=invoice%20client'))[0].title, 'Send invoice to client');
    assert.deepEqual((await search('q=invoice&priority=high')).map((t) => t.title), ['Send invoice to client']);
    assert.deepEqual((await search(`assignee=${teammate.user.id}`)).map((t) => t.title), ['Send invoice to client']);
    assert.deepEqual((await search('assignee=me', teammate.agent)).map((t) => t.title), ['Send invoice to client']);
    assert.equal((await search('assignee=none')).length, 2);
    assert.deepEqual((await search(`due=overdue&today=${isoDate(0)}`)).map((t) => t.title), ['Send invoice to client']);
    assert.equal((await search('due=none')).length, 2);
    assert.equal((await search('q=(%26%26')).length, 3, 'punctuation-only text is ignored');
    assert.equal((await search('priority=extreme')).error, 'priority must be none, low, medium, high or urgent');
    assert.equal((await outsider.agent.get(`/api/workspaces/${owner.workspace.id}/search?q=invoice`)).status, 404);
  });

  test('notifications: assignments, mentions and comments, with preferences and read state', async () => {
    const owner = await signUp('Nia');
    const alex = await signUp('Alex');
    const bo = await signUp('Bo');
    await addMember(owner.workspace.id, alex.user.id, 'member');
    await addMember(owner.workspace.id, bo.user.id, 'member');
    const { body: task } = await owner.agent.post(`/api/boards/${owner.board.id}/tasks`).send({ title: 'Prep demo', assigneeIds: [alex.user.id, owner.user.id] });

    let alexFeed = (await alex.agent.get('/api/notifications')).body;
    assert.equal(alexFeed.unread, 1);
    assert.equal(alexFeed.items[0].type, 'assigned');
    assert.equal(alexFeed.items[0].actor.name, 'Nia');
    assert.equal(alexFeed.items[0].taskTitle, 'Prep demo');
    assert.equal((await owner.agent.get('/api/notifications')).body.unread, 0, 'no notification for your own action');

    // Bo turns off comment notifications; a mention still reaches them.
    await bo.agent.patch('/api/me').send({ notificationPrefs: { comment: false } });
    await owner.agent.patch(`/api/tasks/${task.id}`).send({ assigneeIds: [alex.user.id, owner.user.id, bo.user.id] });
    const boAfterAssign = (await bo.agent.get('/api/notifications')).body;
    assert.equal(boAfterAssign.items[0].type, 'assigned');
    await owner.agent.post(`/api/tasks/${task.id}/comments`).send({ body: 'Looks good @Alex', mentions: [alex.user.id] });
    alexFeed = (await alex.agent.get('/api/notifications')).body;
    assert.equal(alexFeed.items[0].type, 'mentioned', 'mentioned, not also notified as a comment');
    assert.equal(alexFeed.items[0].data.excerpt, 'Looks good @Alex');
    assert.equal((await bo.agent.get('/api/notifications')).body.items.length, 1, 'comment notifications are off for Bo');
    await owner.agent.post(`/api/tasks/${task.id}/comments`).send({ body: 'And you too @Bo', mentions: [bo.user.id] });
    assert.equal((await bo.agent.get('/api/notifications')).body.items[0].type, 'mentioned');

    // Read state belongs to each user.
    const firstId = alexFeed.items[1].id;
    assert.equal((await bo.agent.post('/api/notifications/read').send({ ids: [firstId] })).body.unread, 2, "can't mark someone else's");
    assert.equal((await alex.agent.post('/api/notifications/read').send({ ids: [firstId] })).body.unread, 1);
    assert.equal((await alex.agent.post('/api/notifications/read').send({})).body.unread, 0);
    assert.equal((await alex.agent.get('/api/notifications/unread-count')).body.unread, 0);

    assert.equal((await bo.agent.patch('/api/me').send({ notificationPrefs: { shouting: true } })).status, 400);
    assert.deepEqual((await bo.agent.get('/api/auth/me')).body.user.notificationPrefs, { comment: false });
  });

  test('due reminders notify in-app and email only people who want email', async () => {
    const { agent, board, user, email } = await signUp('Remy');
    await agent.patch('/api/me').send({ notificationPrefs: { emailReminders: false } });
    const { body: task } = await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'Renew domain', dueDate: isoDate(1), assigneeIds: [user.id] });
    const sent = [];
    const result = await sendReminder({ repo, mailer: { send: async (m) => sent.push(m) }, appUrl: 'https://app.example.com' }, { taskId: task.id, dueDate: isoDate(1) });
    assert.deepEqual(result, { sent: false });
    assert.equal(sent.length, 0, 'email reminders are off');
    const feed = (await agent.get('/api/notifications')).body;
    assert.equal(feed.items[0].type, 'due');
    assert.equal(feed.items[0].data.when, 'due tomorrow');
    assert.ok(email);
  });

  test('avatars: upload, serve to teammates only, replace and remove', async () => {
    const ana = await signUp('Ana');
    const teammate = await signUp('Ben');
    const stranger = await signUp('Cy');
    await addMember(ana.workspace.id, teammate.user.id, 'member');

    assert.equal((await ana.agent.post('/api/me/avatar').set('Content-Type', 'image/svg+xml').send(Buffer.from('<svg onload="x"></svg>'))).status, 400);
    const up = await ana.agent.post('/api/me/avatar').set('Content-Type', 'image/png').send(PNG);
    assert.equal(up.status, 200);
    assert.match(up.body.user.avatarUrl, new RegExp(`^/api/avatars/${ana.user.id}\\?v=\\d+$`));

    const seen = await teammate.agent.get(up.body.user.avatarUrl).buffer(true).parse(binary);
    assert.equal(seen.status, 200);
    assert.equal(seen.headers['content-type'], 'image/png');
    assert.ok(seen.body.equals(PNG));
    assert.equal((await stranger.agent.get(up.body.user.avatarUrl)).status, 404, "people who don't share a workspace can't see it");
    const members = (await teammate.agent.get(`/api/workspaces/${ana.workspace.id}/members`)).body;
    assert.equal(members.find((m) => m.id === ana.user.id).avatarUrl, up.body.user.avatarUrl);

    const oldKey = (await db.query('SELECT avatar_key FROM users WHERE id = $1', [ana.user.id])).rows[0].avatar_key;
    await ana.agent.post('/api/me/avatar').set('Content-Type', 'image/png').send(PNG);
    const removed = await ana.agent.delete('/api/me/avatar');
    assert.equal(removed.body.user.avatarUrl, null);
    assert.equal((await teammate.agent.get(`/api/avatars/${ana.user.id}`)).status, 404);
    assert.ok(oldKey.startsWith(`attachments/avatars/${ana.user.id}/`));
  });

  test('exports: CSV with every task, and a real PDF', async () => {
    const { agent, board } = await signUp('Eve');
    const cols = await columnsOf(agent, board.id);
    await agent.post(`/api/boards/${board.id}/tasks`).send({ title: '=cmd|calc', priority: 'urgent', description: 'line one\nline, two' });
    await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'Ship "v2"', columnId: cols[2].id, dueDate: '2026-11-01' });

    const csv = await agent.get(`/api/boards/${board.id}/export.csv`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-type'], /^text\/csv/);
    assert.match(csv.headers['content-disposition'], /attachment; filename="My-tasks.csv"/);
    const lines = csv.text.replace(/^﻿/, '').split('\r\n');
    assert.equal(lines[0], 'Title,Column,Status,Priority,Due date,Assignees,Labels,Checklist,Description,Created,Completed');
    assert.match(lines[1], /^'=cmd\|calc,To do,Open,Urgent,,,,,"line one\nline, two",/);
    assert.ok(csv.text.includes('"Ship ""v2""",Done,Done,,2026-11-01'));

    const pdf = await agent.get(`/api/boards/${board.id}/export.pdf`).buffer(true).parse(binary);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.body.length > 1000);

    const outsider = await signUp('Finn');
    assert.equal((await outsider.agent.get(`/api/boards/${board.id}/export.csv`)).status, 404);
  });
});
