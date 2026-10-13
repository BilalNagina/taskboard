// End-to-end tests for live updates over WebSockets and notification emails.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { sendNotificationEmail } from '../src/jobs.js';
import { attachLive } from '../src/live.js';
import { createRedis } from '../src/redis.js';
import { REDIS_URL, setupApi, skipIntegration } from './helpers.js';

const ORIGIN = 'https://app.example.com';

describe('live updates and notification emails', { skip: skipIntegration }, () => {
  let repo, sessions, jobs, app, signUp, addMember, close;
  let server, live, url;
  const sockets = [];

  before(async () => {
    ({ repo, sessions, jobs, app, signUp, addMember, close } = await setupApi());
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    url = `ws://localhost:${server.address().port}/api/live`;
    live = await attachLive(server, { subscriber: createRedis(REDIS_URL), sessions, repo, appUrl: ORIGIN });
  });

  after(async () => {
    sockets.forEach((ws) => ws.terminate());
    await live.close();
    await new Promise((resolve) => server.close(resolve));
    await close();
  });

  // Opens a socket and collects its messages; resolves once the server says hello.
  function connect(cookie, origin = ORIGIN) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers: { ...(cookie ? { cookie } : {}), origin } });
      ws.messages = [];
      ws.on('message', (raw) => ws.messages.push(JSON.parse(raw)));
      ws.on('unexpected-response', (req, res) => reject(Object.assign(new Error('refused'), { status: res.statusCode })));
      ws.on('error', reject);
      ws.once('message', () => resolve(ws));
      sockets.push(ws);
    });
  }

  // Waits for a message matching `match` (among those from index `from` on), or fails
  // after a few seconds.
  async function waitFor(ws, match, what, from = 0) {
    for (let i = 0; i < 60; i++) {
      const found = ws.messages.slice(from).find(match);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`no ${what} message arrived`);
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

  test('only signed-in people on this site can connect', async () => {
    await assert.rejects(connect(null), { status: 401 });
    const { cookie } = await signUp('Oli');
    await assert.rejects(connect(cookie, 'https://evil.example.com'), { status: 403 });
    const ws = await connect(cookie);
    assert.deepEqual(ws.messages[0], { type: 'hello' });
  });

  test('changes reach the workspace’s members, and nobody else', async () => {
    const owner = await signUp('Ann');
    const member = await signUp('Ben');
    const outsider = await signUp('Cy');
    await addMember(owner.workspace.id, member.user.id, 'member');
    const [ownerWs, memberWs, outsiderWs] = await Promise.all([connect(owner.cookie), connect(member.cookie), connect(outsider.cookie)]);

    const task = (await owner.agent.post(`/api/boards/${owner.board.id}/tasks`).set('X-Client-Id', 'tab-1').send({ title: 'Live one' })).body;
    const change = await waitFor(memberWs, (m) => m.type === 'change', 'change');
    assert.deepEqual(change, { type: 'change', workspaceId: owner.workspace.id, boardId: owner.board.id, taskId: null, actorId: owner.user.id, clientId: 'tab-1' });
    await waitFor(ownerWs, (m) => m.type === 'change', 'change for the person who made it (their other tabs refresh)');

    await member.agent.patch(`/api/tasks/${task.id}`).send({ priority: 'high' });
    const edit = await waitFor(ownerWs, (m) => m.type === 'change' && m.taskId === task.id, 'task change');
    assert.equal(edit.actorId, member.user.id);
    await waitFor(memberWs, (m) => m.type === 'change' && m.taskId === task.id, 'task change for the editor');

    // Failed requests and reads announce nothing; outsiders never hear anything.
    const before = memberWs.messages.length;
    await member.agent.patch(`/api/tasks/${task.id}`).send({ priority: 'extreme' });
    await member.agent.get(`/api/boards/${owner.board.id}/full`);
    await settle();
    assert.equal(memberWs.messages.length, before);
    assert.equal(outsiderWs.messages.filter((m) => m.type === 'change').length, 0);
  });

  test('notifications arrive live and queue one delayed email per person', async () => {
    const owner = await signUp('Dee');
    const member = await signUp('Eli');
    await addMember(owner.workspace.id, member.user.id, 'member');
    const memberWs = await connect(member.cookie);
    jobs.added.length = 0;

    const task = (await owner.agent.post(`/api/boards/${owner.board.id}/tasks`).send({ title: 'Ship it', assigneeIds: [member.user.id] })).body;
    await waitFor(memberWs, (m) => m.type === 'notification', 'notification');
    await owner.agent.post(`/api/tasks/${task.id}/comments`).send({ body: 'Over to you' });

    const emailJobs = jobs.added.filter((j) => j.name === 'notification-email');
    assert.equal(emailJobs.length, 2, 'one per notification; the queue keeps only one waiting job per id');
    assert.ok(emailJobs.every((j) => j.opts.jobId === `notification-email-${member.user.id}` && j.opts.delay === 120_000));
  });

  test('presence: who is looking at a board', async () => {
    const owner = await signUp('Fay');
    const member = await signUp('Gil');
    const outsider = await signUp('Hob');
    await addMember(owner.workspace.id, member.user.id, 'member');
    const [ownerWs, memberWs, outsiderWs] = await Promise.all([connect(owner.cookie), connect(member.cookie), connect(outsider.cookie)]);

    ownerWs.send(JSON.stringify({ type: 'view', boardId: owner.board.id }));
    memberWs.send(JSON.stringify({ type: 'view', boardId: owner.board.id }));
    const both = await waitFor(ownerWs, (m) => m.type === 'presence' && m.users.length === 2, 'presence with both people');
    assert.deepEqual(both.users.map((u) => u.name).sort(), ['Fay', 'Gil']);

    // A board you can't see doesn't count you as viewing it.
    outsiderWs.send(JSON.stringify({ type: 'view', boardId: owner.board.id }));
    await settle();
    assert.equal(outsiderWs.messages.filter((m) => m.type === 'presence').length, 0);

    const seen = ownerWs.messages.length;
    memberWs.close();
    await waitFor(ownerWs, (m) => m.type === 'presence' && m.users.length === 1, 'presence after someone leaves', seen);
  });

  test('notification emails: one email for what is still unread, never twice, following the switches', async () => {
    const owner = await signUp('Ida');
    const member = await signUp('Jon');
    await addMember(owner.workspace.id, member.user.id, 'member');
    const sent = [];
    const mailer = { send: async (email) => sent.push(email) };
    const deps = { repo, mailer, appUrl: ORIGIN };
    const create = (title, assigneeIds = [member.user.id]) => owner.agent.post(`/api/boards/${owner.board.id}/tasks`).send({ title, assigneeIds });

    const task = (await create('Plan the launch')).body;
    await owner.agent.post(`/api/tasks/${task.id}/comments`).send({ body: 'Draft attached' });
    assert.deepEqual(await sendNotificationEmail(deps, { userId: member.user.id }), { sent: 2 });
    assert.equal(sent.length, 1, 'notifications close together share one email');
    assert.equal(sent[0].to, member.email);
    assert.equal(sent[0].subject, '2 updates in Tasklane');
    assert.match(sent[0].text, /Ida assigned you “Plan the launch”/);
    assert.match(sent[0].text, /"Draft attached"/);
    assert.match(sent[0].text, new RegExp(`${ORIGIN}/app/boards/${owner.board.id}\\?task=${task.id}`));
    assert.deepEqual(await sendNotificationEmail(deps, { userId: member.user.id }), { sent: 0 }, 'never emailed twice');

    // Read in the app first: no email.
    await create('Already seen');
    await member.agent.post('/api/notifications/read').send({});
    assert.deepEqual(await sendNotificationEmail(deps, { userId: member.user.id }), { sent: 0 });

    // A failed send puts them back for the retry.
    await create('Retry me');
    const failing = { send: async () => Promise.reject(new Error('SES said no')) };
    await assert.rejects(sendNotificationEmail({ ...deps, mailer: failing }, { userId: member.user.id }), /SES said no/);
    assert.deepEqual(await sendNotificationEmail(deps, { userId: member.user.id }), { sent: 1 });
    assert.equal(sent.at(-1).subject, 'Ida assigned you “Retry me”');

    // Turning the email switch off stops it; the bell still shows it.
    await member.agent.patch('/api/me').send({ notificationPrefs: { emailAssigned: false } });
    await create('Quiet please');
    assert.deepEqual(await sendNotificationEmail(deps, { userId: member.user.id }), { sent: 0 });
    assert.ok((await member.agent.get('/api/notifications')).body.items.some((n) => n.taskTitle === 'Quiet please'));
  });
});
