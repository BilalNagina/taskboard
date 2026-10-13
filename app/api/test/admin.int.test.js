// End-to-end tests for plan limits and the workspace admin panel.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isoDate, setupApi, skipIntegration } from './helpers.js';

describe('plan limits and the admin panel', { skip: skipIntegration }, () => {
  let db, storage, signUp, addMember, close;

  before(async () => {
    ({ db, storage, signUp, addMember, close } = await setupApi());
  });

  after(() => close());

  const upload = (agent, taskId, body = 'hello') => agent.post(`/api/tasks/${taskId}/attachments`).set('X-Filename', 'notes.txt').send(Buffer.from(body));

  test('the Free plan limits boards, seats and file storage', async () => {
    const { agent, workspace, board } = await signUp('Pia');
    const [listed] = (await agent.get('/api/workspaces')).body;
    assert.deepEqual(listed.limits, { name: 'Free', members: 5, boards: 3, storageBytes: 100 * 1024 * 1024 });

    // Boards: three on Free.
    const boardsUrl = `/api/workspaces/${workspace.id}/boards`;
    assert.equal((await agent.post(boardsUrl).send({ name: 'Two' })).status, 201);
    assert.equal((await agent.post(boardsUrl).send({ name: 'Three' })).status, 201);
    const fourth = await agent.post(boardsUrl).send({ name: 'Four' });
    assert.equal(fourth.status, 403);
    assert.match(fourth.body.error, /Free plan includes 3 boards/);

    // Seats: members plus pending invites, five on Free.
    const invitesUrl = `/api/workspaces/${workspace.id}/invites`;
    const emails = [1, 2, 3, 4].map((n) => `seat${n}-${randomUUID()}@example.com`);
    for (const email of emails) assert.equal((await agent.post(invitesUrl).send({ email, role: 'member' })).status, 201);
    const sixth = await agent.post(invitesUrl).send({ email: `extra-${randomUUID()}@example.com`, role: 'member' });
    assert.equal(sixth.status, 403);
    assert.match(sixth.body.error, /up to 5 members, counting pending invites/);
    assert.equal((await agent.post(invitesUrl).send({ email: emails[0], role: 'viewer' })).status, 201, 'inviting the same address again replaces its invite');

    // Joining checks the plan again, in case it changed after the invite went out.
    const joiner = await signUp('Joe');
    await agent.patch(`/api/workspaces/${workspace.id}/plan`).send({ plan: 'pro' });
    const invite = (await agent.post(invitesUrl).send({ email: joiner.email, role: 'member' })).body.invite;
    await addMember(workspace.id, (await signUp('Fil')).user.id, 'member');
    await addMember(workspace.id, (await signUp('Gus')).user.id, 'member');
    await addMember(workspace.id, (await signUp('Hal')).user.id, 'member');
    await addMember(workspace.id, (await signUp('Ivy')).user.id, 'member');
    await agent.patch(`/api/workspaces/${workspace.id}/plan`).send({ plan: 'free' });
    const full = await joiner.agent.post(`/api/me/invites/${invite.id}/accept`);
    assert.equal(full.status, 403);
    assert.match(full.body.error, /this workspace is full/);
    await agent.patch(`/api/workspaces/${workspace.id}/plan`).send({ plan: 'team' });
    assert.equal((await joiner.agent.post(`/api/me/invites/${invite.id}/accept`)).status, 200);

    // Storage: 100 MB on Free. A large existing file fills it up.
    await agent.patch(`/api/workspaces/${workspace.id}/plan`).send({ plan: 'free' });
    const task = (await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'Specs' })).body;
    await db.query(
      `INSERT INTO attachments (task_id, storage_key, filename, content_type, size_bytes) VALUES ($1, $2, 'big.zip', 'application/zip', $3)`,
      [task.id, `attachments/test/${randomUUID()}`, 100 * 1024 * 1024 - 3],
    );
    const tooBig = await upload(agent, task.id);
    assert.equal(tooBig.status, 403);
    assert.match(tooBig.body.error, /past the Free plan's 100 MB of files/);
    await agent.patch(`/api/workspaces/${workspace.id}/plan`).send({ plan: 'pro' });
    assert.equal((await upload(agent, task.id)).status, 201);

    // Going down a plan keeps what's there; it only blocks adding more.
    assert.equal((await agent.post(boardsUrl).send({ name: 'Four' })).status, 201);
    await agent.patch(`/api/workspaces/${workspace.id}/plan`).send({ plan: 'free' });
    assert.equal((await agent.get(`/api/workspaces/${workspace.id}/boards`)).body.length, 4);
    assert.equal((await agent.post(boardsUrl).send({ name: 'Five' })).status, 403);
  });

  test('only owners see the admin panel or change the plan', async () => {
    const owner = await signUp('Ola');
    const member = await signUp('Max');
    const outsider = await signUp('Out');
    await addMember(owner.workspace.id, member.user.id, 'member');
    const url = `/api/workspaces/${owner.workspace.id}`;
    assert.equal((await member.agent.get(`${url}/admin`)).status, 403);
    assert.equal((await outsider.agent.get(`${url}/admin`)).status, 404);
    assert.equal((await member.agent.patch(`${url}/plan`).send({ plan: 'team' })).status, 403);
    assert.equal((await member.agent.get(`${url}/activity`)).status, 403);
    assert.equal((await owner.agent.patch(`${url}/plan`).send({ plan: 'enterprise' })).status, 400);
  });

  test('the admin panel shows usage, members and the audit log', async () => {
    const { agent, workspace, board, user } = await signUp('Una');
    const member = await signUp('Val');
    await addMember(workspace.id, member.user.id, 'member');
    const url = `/api/workspaces/${workspace.id}`;

    const a = (await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'Plan the offsite', assigneeIds: [member.user.id] })).body;
    const b = (await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'Book the venue', assigneeIds: [user.id] })).body;
    await agent.patch(`/api/tasks/${b.id}`).send({ done: true });
    await member.agent.post(`/api/tasks/${a.id}/time`).send({ day: isoDate(0), minutes: 45 });
    await agent.post(`${url}/invites`).send({ email: `pending-${randomUUID()}@example.com`, role: 'viewer' });
    await upload(agent, a.id, 'twelve bytes');

    const admin = (await agent.get(`${url}/admin`)).body;
    assert.equal(admin.workspace.plan, 'free');
    assert.match(admin.workspace.createdAt, /^\d{4}-\d{2}-\d{2}T/, 'the page shows when the workspace was created');
    assert.equal(admin.workspace.limits.boards, 3);
    assert.deepEqual(admin.plans.map((p) => p.key), ['free', 'pro', 'team']);
    assert.deepEqual(
      { ...admin.usage },
      { members: 2, pendingInvites: 1, boards: 1, tasks: 2, openTasks: 1, files: 1, storageBytes: 12, minutesLast30Days: 45 },
    );
    const una = admin.members.find((m) => m.id === user.id);
    const val = admin.members.find((m) => m.id === member.user.id);
    assert.equal(una.role, 'owner');
    assert.ok(una.lastActiveAt, 'last activity comes from the activity log');
    assert.deepEqual([una.openTasks, una.completedLast30Days], [0, 1]);
    assert.deepEqual([val.openTasks, val.minutesLast30Days], [1, 45]);

    // The audit log covers the whole workspace, newest first, with board names.
    await agent.patch(url).send({ name: 'Offsite crew' });
    await agent.patch(`${url}/plan`).send({ plan: 'pro' });
    const extra = (await agent.post(`${url}/boards`).send({ name: 'Scratch' })).body;
    await agent.delete(`/api/boards/${extra.id}`);
    const log = (await agent.get(`${url}/activity`)).body;
    assert.deepEqual(log.slice(0, 4).map((e) => e.type), ['board.deleted', 'board.created', 'workspace.plan_changed', 'workspace.renamed']);
    assert.deepEqual(log[0].data, { name: 'Scratch' });
    assert.deepEqual(log[2].data, { from: 'free', to: 'pro' });
    assert.ok(log.some((e) => e.type === 'member.invited'));
    const created = log.find((e) => e.type === 'task.created' && e.taskId === a.id);
    assert.equal(created.boardName, 'My tasks');
    const older = (await agent.get(`${url}/activity?before=${log[1].id}`)).body;
    assert.equal(older[0].id, log[2].id, 'paging with ?before');
  });

  test('owners can delete a workspace, but not their only one', async () => {
    const { agent, workspace, board } = await signUp('Wes');
    const member = await signUp('Xia');
    await addMember(workspace.id, member.user.id, 'member');
    const task = (await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'Archive' })).body;
    await upload(agent, task.id);
    const fileCount = storage.files.size;

    assert.equal((await member.agent.delete(`/api/workspaces/${workspace.id}`)).status, 403);
    const only = await agent.delete(`/api/workspaces/${workspace.id}`);
    assert.equal(only.status, 409);
    assert.match(only.body.error, /only workspace/);

    const second = (await agent.post('/api/workspaces').send({ name: 'Next' })).body;
    assert.equal(second.limits.name, 'Free');
    assert.equal((await agent.delete(`/api/workspaces/${workspace.id}`)).status, 204);
    assert.deepEqual((await agent.get('/api/workspaces')).body.map((w) => w.name), ['Next']);
    assert.equal(storage.files.size, fileCount - 1, 'its files are deleted too');
    assert.equal((await member.agent.get(`/api/boards/${board.id}`)).status, 404, 'members lose it as well');
  });
});
