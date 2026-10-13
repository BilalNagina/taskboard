// End-to-end tests for boards: columns, moves, labels, assignees, checklists, comments,
// invites, members and the activity log.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PASSWORD, setupApi, skipIntegration } from './helpers.js';

describe('boards, teams and activity', { skip: skipIntegration }, () => {
  let app, jobs, signUp, addMember, close;

  before(async () => {
    ({ app, jobs, signUp, addMember, close } = await setupApi());
  });

  after(() => close());

  const full = async (agent, boardId) => (await agent.get(`/api/boards/${boardId}/full`)).body;
  const titlesIn = (board, columnId) => board.cards.filter((c) => c.columnId === columnId).sort((a, b) => a.position - b.position).map((c) => c.title);

  test('moving cards within and between columns keeps positions tidy and done in step', async () => {
    const { agent, board } = await signUp();
    for (const title of ['A', 'B', 'C']) await agent.post(`/api/boards/${board.id}/tasks`).send({ title });
    let state = await full(agent, board.id);
    const [todo, doing, done] = state.columns;
    const card = (title) => state.cards.find((c) => c.title === title);

    // Reorder: C to the top of To do.
    assert.equal((await agent.post(`/api/tasks/${card('C').id}/move`).send({ columnId: todo.id, index: 0 })).status, 200);
    state = await full(agent, board.id);
    assert.deepEqual(titlesIn(state, todo.id), ['C', 'A', 'B']);

    // Across columns, then into Done.
    await agent.post(`/api/tasks/${card('A').id}/move`).send({ columnId: doing.id, index: 0 });
    const moved = (await agent.post(`/api/tasks/${card('B').id}/move`).send({ columnId: done.id, index: 5 })).body;
    assert.equal(moved.done, true, 'a card dropped in the Done column is complete');
    state = await full(agent, board.id);
    assert.deepEqual(titlesIn(state, todo.id), ['C']);
    assert.deepEqual(titlesIn(state, doing.id), ['A']);
    assert.deepEqual(titlesIn(state, done.id), ['B']);
    assert.deepEqual(state.cards.map((c) => c.position).sort(), [0, 0, 0], 'positions are rewritten 0..n-1');
    assert.equal(state.board.openCount, 2);

    const back = (await agent.post(`/api/tasks/${card('B').id}/move`).send({ columnId: todo.id, index: 1 })).body;
    assert.equal(back.done, false);
    assert.deepEqual(titlesIn(await full(agent, board.id), todo.id), ['C', 'B']);

    // A column from someone else's board is refused.
    const other = await signUp('Other');
    const otherColumn = (await full(other.agent, other.board.id)).columns[0];
    assert.equal((await agent.post(`/api/tasks/${card('C').id}/move`).send({ columnId: otherColumn.id, index: 0 })).status, 400);
  });

  test('columns: create, rename, reorder, mark done, delete with cards moved', async () => {
    const { agent, board, workspace } = await signUp();
    const viewer = await signUp('Vic');
    await addMember(workspace.id, viewer.user.id, 'viewer');

    const review = (await agent.post(`/api/boards/${board.id}/columns`).send({ name: 'Review' })).body;
    assert.equal(review.position, 3);
    assert.equal((await agent.patch(`/api/columns/${review.id}`).send({ name: 'In review' })).body.name, 'In review');
    await agent.post(`/api/columns/${review.id}/move`).send({ index: 2 });
    let state = await full(agent, board.id);
    assert.deepEqual(state.columns.map((c) => c.name), ['To do', 'In progress', 'In review', 'Done']);

    await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'Ship it', columnId: review.id });
    await agent.patch(`/api/columns/${review.id}`).send({ isDone: true });
    state = await full(agent, board.id);
    assert.equal(state.cards.find((c) => c.title === 'Ship it').done, true, 'marking a column done completes its cards');

    const todo = state.columns[0];
    const removed = await agent.delete(`/api/columns/${review.id}?moveTo=${todo.id}`);
    assert.equal(removed.status, 200);
    state = await full(agent, board.id);
    const shipped = state.cards.find((c) => c.title === 'Ship it');
    assert.equal(shipped.columnId, todo.id, 'cards move to the chosen column');
    assert.equal(shipped.done, false, 'and take on its done state');

    assert.equal((await viewer.agent.post(`/api/boards/${board.id}/columns`).send({ name: 'Nope' })).status, 403);
    for (const column of state.columns.slice(1)) await agent.delete(`/api/columns/${column.id}`);
    assert.equal((await agent.delete(`/api/columns/${todo.id}`)).status, 409, 'the last column stays');
  });

  test('labels and assignees are checked against the board and workspace', async () => {
    const owner = await signUp('Olga');
    const teammate = await signUp('Tomas');
    const stranger = await signUp('Sven');
    await addMember(owner.workspace.id, teammate.user.id, 'member');
    const state = await full(owner.agent, owner.board.id);
    assert.deepEqual(state.labels.map((l) => l.name), ['Bug', 'Feature', 'Design', 'Research']);
    assert.equal(state.members.length, 2);

    const label = (await owner.agent.post(`/api/boards/${owner.board.id}/labels`).send({ name: 'Ops', color: 'amber' })).body;
    assert.equal((await owner.agent.post(`/api/boards/${owner.board.id}/labels`).send({ name: 'Ops', color: 'red' })).status, 409);
    assert.equal((await owner.agent.post(`/api/boards/${owner.board.id}/labels`).send({ name: 'X', color: 'neon' })).status, 400);
    const strangerLabel = (await full(stranger.agent, stranger.board.id)).labels[0];

    const url = `/api/boards/${owner.board.id}/tasks`;
    const task = (await owner.agent.post(url).send({ title: 'Labelled', labelIds: [label.id], assigneeIds: [teammate.user.id] })).body;
    assert.deepEqual(task.labelIds, [label.id]);
    assert.deepEqual(task.assigneeIds, [teammate.user.id]);
    assert.equal((await owner.agent.patch(`/api/tasks/${task.id}`).send({ labelIds: [strangerLabel.id] })).status, 400);
    assert.equal((await owner.agent.patch(`/api/tasks/${task.id}`).send({ assigneeIds: [stranger.user.id] })).status, 400);
    const both = (await owner.agent.patch(`/api/tasks/${task.id}`).send({ assigneeIds: [owner.user.id, teammate.user.id] })).body;
    assert.deepEqual(both.assigneeIds.sort(), [owner.user.id, teammate.user.id].sort());

    assert.equal((await owner.agent.delete(`/api/labels/${label.id}`)).status, 204);
    assert.deepEqual((await owner.agent.get(`/api/tasks/${task.id}`)).body.labelIds, [], 'deleting a label removes it from cards');
  });

  test('task details: description, checklist and comments with mentions', async () => {
    const owner = await signUp('Priya');
    const viewer = await signUp('Wen');
    const outsider = await signUp('Xavier');
    await addMember(owner.workspace.id, viewer.user.id, 'viewer');
    const task = (await owner.agent.post(`/api/boards/${owner.board.id}/tasks`).send({ title: 'Launch plan' })).body;

    await owner.agent.patch(`/api/tasks/${task.id}`).send({ description: 'Steps for launch day.' });
    const a = (await owner.agent.post(`/api/tasks/${task.id}/checklist`).send({ text: 'Draft post' })).body;
    await owner.agent.post(`/api/tasks/${task.id}/checklist`).send({ text: 'Schedule post' });
    await owner.agent.patch(`/api/checklist/${a.id}`).send({ done: true });
    const card = (await full(owner.agent, owner.board.id)).cards.find((c) => c.id === task.id);
    assert.equal(card.checklistTotal, 2);
    assert.equal(card.checklistDone, 1);
    assert.equal(card.hasDescription, true);

    // Viewers can comment but not change the task or its checklist.
    const comment = await viewer.agent.post(`/api/tasks/${task.id}/comments`).send({
      body: '@Priya looks good',
      mentions: [owner.user.id, outsider.user.id],
    });
    assert.equal(comment.status, 201);
    assert.deepEqual(comment.body.mentions, [owner.user.id], 'mentions outside the workspace are dropped');
    assert.equal((await viewer.agent.patch(`/api/tasks/${task.id}`).send({ title: 'Mine' })).status, 403);
    assert.equal((await viewer.agent.patch(`/api/checklist/${a.id}`).send({ done: false })).status, 403);

    // Only the author edits a comment; the author or an owner can delete it.
    assert.equal((await owner.agent.patch(`/api/comments/${comment.body.id}`).send({ body: 'edited' })).status, 403);
    assert.equal((await viewer.agent.patch(`/api/comments/${comment.body.id}`).send({ body: '@Priya looks great' })).status, 200);
    assert.equal((await outsider.agent.delete(`/api/comments/${comment.body.id}`)).status, 404);

    const detail = (await owner.agent.get(`/api/tasks/${task.id}`)).body;
    assert.equal(detail.description, 'Steps for launch day.');
    assert.deepEqual(detail.checklist.map((i) => [i.text, i.done]), [['Draft post', true], ['Schedule post', false]]);
    assert.equal(detail.comments[0].body, '@Priya looks great');
    assert.equal(detail.comments[0].author.name, 'Wen');
    assert.equal((await owner.agent.delete(`/api/comments/${comment.body.id}`)).status, 204, "owners can remove anyone's comment");
  });

  test('invites: owner invites, invitee with that email accepts, links are single use', async () => {
    const owner = await signUp('Omar');
    const member = await signUp('Mia');
    await addMember(owner.workspace.id, member.user.id, 'member');
    const inviteeEmail = `invitee-${randomUUID()}@example.com`;
    const invitesUrl = `/api/workspaces/${owner.workspace.id}/invites`;

    assert.equal((await member.agent.post(invitesUrl).send({ email: inviteeEmail, role: 'member' })).status, 403, 'only owners invite');
    assert.equal((await owner.agent.post(invitesUrl).send({ email: member.email, role: 'viewer' })).status, 409, 'already a member');

    jobs.added.length = 0;
    const created = await owner.agent.post(invitesUrl).send({ email: inviteeEmail.toUpperCase(), role: 'viewer' });
    assert.equal(created.status, 201);
    assert.equal(created.body.invite.email, inviteeEmail);
    assert.equal(jobs.added[0].name, 'invite');
    const token = new URL(created.body.link).pathname.split('/').pop();
    assert.equal(decodeURIComponent(token), jobs.added[0].data.token);

    const lookup = await request(app).post('/api/invites/lookup').send({ token: decodeURIComponent(token) });
    assert.equal(lookup.status, 200);
    assert.equal(lookup.body.workspaceName, owner.workspace.name);
    assert.equal(lookup.body.invitedBy.name, 'Omar');
    assert.equal(lookup.body.id, undefined);

    // Someone else can't use the link.
    assert.equal((await member.agent.post('/api/invites/accept').send({ token: decodeURIComponent(token) })).status, 403);

    // Resending replaces the token, so the first link stops working.
    const resent = await owner.agent.post(`/api/invites/${created.body.invite.id}/resend`);
    const newToken = decodeURIComponent(new URL(resent.body.link).pathname.split('/').pop());
    assert.equal((await request(app).post('/api/invites/lookup').send({ token: decodeURIComponent(token) })).status, 404);

    const invitee = request.agent(app);
    await invitee.post('/api/auth/register').send({ name: 'Ivy', email: inviteeEmail, password: PASSWORD });
    const accepted = await invitee.post('/api/invites/accept').send({ token: newToken });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.workspaceId, owner.workspace.id);
    const workspaces = (await invitee.get('/api/workspaces')).body;
    assert.equal(workspaces.find((w) => w.id === owner.workspace.id).role, 'viewer');
    assert.equal((await invitee.post('/api/invites/accept').send({ token: newToken })).status, 409, 'single use');
    assert.equal((await owner.agent.get(invitesUrl)).body.length, 0, 'no pending invites left');

    // Revoked invites can't be looked up.
    const second = await owner.agent.post(invitesUrl).send({ email: `x-${randomUUID()}@example.com`, role: 'member' });
    await owner.agent.delete(`/api/invites/${second.body.invite.id}`);
    const secondToken = decodeURIComponent(new URL(second.body.link).pathname.split('/').pop());
    assert.equal((await request(app).post('/api/invites/lookup').send({ token: secondToken })).status, 404);
  });

  test('members: role changes, removal, and a workspace always keeps an owner', async () => {
    const owner = await signUp('Nora');
    const member = await signUp('Leo');
    await addMember(owner.workspace.id, member.user.id, 'member');
    const membersUrl = `/api/workspaces/${owner.workspace.id}/members`;
    const task = (await owner.agent.post(`/api/boards/${owner.board.id}/tasks`).send({ title: 'Assigned', assigneeIds: [member.user.id] })).body;

    assert.deepEqual((await member.agent.get(membersUrl)).body.map((m) => m.role), ['owner', 'member']);
    assert.equal((await member.agent.patch(`${membersUrl}/${owner.user.id}`).send({ role: 'viewer' })).status, 403);
    assert.equal((await owner.agent.patch(`${membersUrl}/${owner.user.id}`).send({ role: 'member' })).status, 409, 'last owner');
    assert.equal((await owner.agent.delete(`${membersUrl}/${owner.user.id}`)).status, 409, 'last owner cannot leave');

    assert.equal((await owner.agent.patch(`${membersUrl}/${member.user.id}`).send({ role: 'owner' })).body.role, 'owner');
    assert.equal((await owner.agent.patch(`${membersUrl}/${owner.user.id}`).send({ role: 'member' })).status, 200, 'fine once there is another owner');

    // Member (now owner) removes the original owner, who loses access and their assignments.
    assert.equal((await member.agent.delete(`${membersUrl}/${owner.user.id}`)).status, 204);
    assert.equal((await owner.agent.get(`/api/boards/${owner.board.id}`)).status, 404);
    const card = (await member.agent.get(`/api/tasks/${task.id}`)).body;
    assert.deepEqual(card.assigneeIds, [member.user.id], 'removed members are taken off tasks');
    assert.equal((await member.agent.delete(`${membersUrl}/${member.user.id}`)).status, 409, 'the only owner cannot leave');
  });

  test('activity log records what happened on a board and a task', async () => {
    const { agent, board, user } = await signUp('Ana');
    const task = (await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'Write docs', assigneeIds: [user.id] })).body;
    const columns = (await full(agent, board.id)).columns;
    await agent.post(`/api/tasks/${task.id}/move`).send({ columnId: columns[1].id, index: 0 });
    await agent.post(`/api/tasks/${task.id}/move`).send({ columnId: columns[2].id, index: 0 });
    await agent.post(`/api/tasks/${task.id}/comments`).send({ body: 'Done and dusted' });
    await agent.patch(`/api/boards/${board.id}`).send({ name: 'Docs' });

    const feed = (await agent.get(`/api/boards/${board.id}/activity`)).body;
    assert.deepEqual(feed.map((e) => e.type).reverse(), [
      'task.created',
      'task.assigned',
      'task.moved',
      'task.moved',
      'task.completed',
      'comment.added',
      'board.renamed',
    ]);
    const moved = feed.find((e) => e.type === 'task.moved');
    assert.deepEqual(moved.data, { from: 'In progress', to: 'Done' });
    assert.equal(moved.actor.name, 'Ana');
    assert.equal(moved.taskTitle, 'Write docs');

    const older = (await agent.get(`/api/boards/${board.id}/activity?before=${feed[2].id}`)).body;
    assert.equal(older.length, feed.length - 3, 'paging with ?before');

    const detail = (await agent.get(`/api/tasks/${task.id}`)).body;
    assert.equal(detail.activity.length, 6, 'the task panel shows its own entries');

    await agent.delete(`/api/tasks/${task.id}`);
    const afterDelete = (await agent.get(`/api/boards/${board.id}/activity`)).body;
    assert.equal(afterDelete[0].type, 'task.deleted');
    assert.equal(afterDelete[0].data.title, 'Write docs');
  });
});
