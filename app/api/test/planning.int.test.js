// End-to-end tests for the sample board, templates, recurring tasks and time tracking.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { isoDate, PASSWORD, setupApi, skipIntegration } from './helpers.js';

describe('templates, recurring tasks and time tracking', { skip: skipIntegration }, () => {
  let app, signUp, addMember, close;

  before(async () => {
    ({ app, signUp, addMember, close } = await setupApi());
  });

  after(() => close());

  const full = async (agent, boardId) => (await agent.get(`/api/boards/${boardId}/full`)).body;

  test('a new account gets a sample board and the welcome tour', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/register').send({ name: 'Nia', email: `nia-${randomUUID()}@example.com`, password: PASSWORD });
    const { user } = res.body;
    assert.equal(user.onboardedAt, null, 'the tour has not been seen yet');

    const [workspace] = (await agent.get('/api/workspaces')).body;
    const [board] = (await agent.get(`/api/workspaces/${workspace.id}/boards`)).body;
    assert.equal(board.name, 'Getting started');
    const state = await full(agent, board.id);
    assert.deepEqual(state.columns.map((c) => [c.name, c.isDone]), [['To do', false], ['In progress', false], ['Done', true]]);
    assert.equal(state.cards.length, 8);
    const card = (title) => state.cards.find((c) => c.title.startsWith(title));
    assert.equal(card('Create your Tasklane account').done, true);
    assert.deepEqual(card('Open this card').assigneeIds, [user.id]);
    assert.equal(card('Open this card').checklistTotal, 3);
    assert.equal(card('Weekly review').repeat, 'weekly');
    assert.equal(card('Weekly review').dueDate, isoDate(6));
    assert.deepEqual(state.cards.filter((c) => c.columnId === state.columns[0].id).map((c) => c.position).sort(), [0, 1, 2, 3, 4, 5]);

    const done = (await agent.patch('/api/me').send({ onboarded: true })).body.user;
    assert.ok(done.onboardedAt);
    const again = (await agent.patch('/api/me').send({ onboarded: true })).body.user;
    assert.equal(again.onboardedAt, done.onboardedAt, 'finishing twice keeps the first time');
  });

  test('boards can start from a template', async () => {
    const { agent, user, workspace } = await signUp();
    const templates = (await agent.get('/api/templates')).body;
    // Four boards is more than the Free plan holds.
    await agent.patch(`/api/workspaces/${workspace.id}/plan`).send({ plan: 'pro' });
    assert.deepEqual(templates.map((t) => t.key), ['blank', 'sprint', 'content', 'hiring']);

    const board = (await agent.post(`/api/workspaces/${workspace.id}/boards`).send({ name: 'Sprint 14', template: 'sprint', today: isoDate(0) })).body;
    assert.equal(board.name, 'Sprint 14');
    assert.equal(board.taskCount, 10);
    const state = await full(agent, board.id);
    assert.deepEqual(state.columns.map((c) => c.name), ['Backlog', 'Ready', 'In progress', 'In review', 'Done']);
    assert.deepEqual(state.labels.map((l) => l.name), ['Story', 'Bug', 'Chore', 'Spike']);
    const redesign = state.cards.find((c) => c.title === 'Redesign the settings page');
    assert.deepEqual(redesign.assigneeIds, [user.id], 'example cards can be assigned to whoever made the board');
    assert.equal(redesign.dueDate, isoDate(5));
    assert.deepEqual([redesign.checklistDone, redesign.checklistTotal], [1, 3]);
    assert.equal(state.labels.find((l) => l.id === redesign.labelIds[0]).name, 'Story');
    assert.equal(state.cards.find((c) => c.title === 'Set up the sprint board').done, true, 'cards in the done column start completed');

    const hiring = (await agent.post(`/api/workspaces/${workspace.id}/boards`).send({ name: 'Hiring', template: 'hiring' })).body;
    assert.equal((await full(agent, hiring.id)).columns.at(-1).name, 'Hired');

    const blank = (await agent.post(`/api/workspaces/${workspace.id}/boards`).send({ name: 'Blank' })).body;
    const blankState = await full(agent, blank.id);
    assert.deepEqual([blankState.columns.length, blankState.cards.length, blankState.labels.length], [3, 0, 4]);

    for (const template of ['starter', 'nope']) {
      assert.equal((await agent.post(`/api/workspaces/${workspace.id}/boards`).send({ name: 'X', template })).status, 400);
    }
  });

  test('completing a repeating task creates the next one', async () => {
    const { agent, user, board } = await signUp();
    let state = await full(agent, board.id);
    const [todo, , doneColumn] = state.columns;
    const label = state.labels[0];

    const task = (
      await agent
        .post(`/api/boards/${board.id}/tasks`)
        .send({ title: 'Water the plants', repeat: 'weekly', dueDate: isoDate(2), priority: 'high', labelIds: [label.id], assigneeIds: [user.id] })
    ).body;
    assert.equal(task.repeat, 'weekly');
    const item = (await agent.post(`/api/tasks/${task.id}/checklist`).send({ text: 'Fill the can' })).body;
    await agent.patch(`/api/checklist/${item.id}`).send({ done: true });

    const completed = (await agent.patch(`/api/tasks/${task.id}`).send({ done: true })).body;
    assert.equal(completed.done, true);
    assert.equal(completed.repeat, null, 'the repeat setting moves to the new task');
    assert.equal(completed.nextOccurrence.dueDate, isoDate(9));

    state = await full(agent, board.id);
    const next = state.cards.find((c) => c.id === completed.nextOccurrence.id);
    assert.equal(next.title, 'Water the plants');
    assert.equal(next.columnId, todo.id);
    assert.equal(next.done, false);
    assert.equal(next.repeat, 'weekly');
    assert.equal(next.priority, 'high');
    assert.deepEqual(next.labelIds, [label.id]);
    assert.deepEqual(next.assigneeIds, [user.id]);
    assert.deepEqual([next.checklistDone, next.checklistTotal], [0, 1], 'the checklist starts fresh');

    // Reopening and finishing the old one again doesn't make a third.
    await agent.patch(`/api/tasks/${task.id}`).send({ done: false });
    const again = (await agent.patch(`/api/tasks/${task.id}`).send({ done: true })).body;
    assert.equal(again.nextOccurrence, null);
    assert.equal((await full(agent, board.id)).cards.length, 2);

    // Dragging into the done column counts as completing it.
    const moved = (await agent.post(`/api/tasks/${next.id}/move`).send({ columnId: doneColumn.id, index: 0 })).body;
    assert.equal(moved.nextOccurrence.dueDate, isoDate(16));

    const activity = (await agent.get(`/api/boards/${board.id}/activity`)).body;
    assert.ok(activity.some((e) => e.type === 'task.recurred' && e.taskId === moved.nextOccurrence.id));

    // Overdue tasks skip ahead past today; tasks with no date count from today.
    const late = (await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'Stand-up notes', repeat: 'daily', dueDate: isoDate(-5) })).body;
    assert.equal((await agent.patch(`/api/tasks/${late.id}`).send({ done: true })).body.nextOccurrence.dueDate, isoDate(1));
    const undated = (await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'Back up laptop', repeat: 'weekly' })).body;
    assert.equal((await agent.patch(`/api/tasks/${undated.id}`).send({ done: true })).body.nextOccurrence.dueDate, isoDate(7));

    // Turning repeat off is logged like any other change.
    const plain = (await agent.patch(`/api/tasks/${moved.nextOccurrence.id}`).send({ repeat: null })).body;
    assert.equal(plain.repeat, null);
    assert.equal((await agent.patch(`/api/tasks/${task.id}`).send({ repeat: 'hourly' })).status, 400);
  });

  test('timers, time entered by hand, and the timesheet', async () => {
    const owner = await signUp('Olu');
    const member = await signUp('Mei');
    const viewer = await signUp('Vik');
    const outsider = await signUp('Out');
    await addMember(owner.workspace.id, member.user.id, 'member');
    await addMember(owner.workspace.id, viewer.user.id, 'viewer');
    const create = async (title) => (await owner.agent.post(`/api/boards/${owner.board.id}/tasks`).send({ title })).body;
    const a = await create('Write the brief');
    const b = await create('Review designs');
    const today = isoDate(0);

    // One running timer per person: starting another stops the first.
    const started = await owner.agent.post(`/api/tasks/${a.id}/timer`).send({ today });
    assert.equal(started.status, 201);
    assert.equal(started.body.timer.taskId, a.id);
    assert.equal(started.body.stopped, null);
    assert.equal((await owner.agent.get('/api/me/timer')).body.timer.title, 'Write the brief');
    const switched = (await owner.agent.post(`/api/tasks/${b.id}/timer`).send({ today })).body;
    assert.deepEqual([switched.stopped.taskId, switched.stopped.minutes], [a.id, 1], 'short timers count as a minute');
    assert.equal(switched.timer.taskId, b.id);
    const stopped = (await owner.agent.post('/api/me/timer/stop')).body.stopped;
    assert.equal(stopped.taskId, b.id);
    assert.equal((await owner.agent.post('/api/me/timer/stop')).status, 409);
    assert.equal((await owner.agent.get('/api/me/timer')).body.timer, null);

    const entry = await owner.agent.post(`/api/tasks/${a.id}/time`).send({ day: today, minutes: 90, note: 'Planning' });
    assert.equal(entry.status, 201);
    assert.equal((await owner.agent.post(`/api/tasks/${a.id}/time`).send({ day: today, minutes: 0 })).status, 400);
    const theirs = (await member.agent.post(`/api/tasks/${b.id}/time`).send({ day: isoDate(-1), minutes: 30 })).body;

    // Viewers can look but not track; outsiders can't see the task at all.
    assert.equal((await viewer.agent.post(`/api/tasks/${a.id}/time`).send({ day: today, minutes: 5 })).status, 403);
    assert.equal((await viewer.agent.post(`/api/tasks/${a.id}/timer`).send({ today })).status, 403);
    assert.equal((await outsider.agent.post(`/api/tasks/${a.id}/timer`).send({ today })).status, 404);

    const detail = (await owner.agent.get(`/api/tasks/${a.id}`)).body;
    assert.equal(detail.time.totalMinutes, 91);
    assert.deepEqual(detail.time.entries.map((e) => e.minutes).sort((x, y) => x - y), [1, 90]);
    assert.equal(detail.time.entries[0].user.id, owner.user.id);

    const range = `from=${isoDate(-6)}&to=${today}`;
    const sheet = (await viewer.agent.get(`/api/workspaces/${owner.workspace.id}/timesheet?${range}`)).body;
    assert.equal(sheet.reduce((sum, r) => sum + r.minutes, 0), 122);
    assert.deepEqual(
      sheet.filter((r) => r.taskId === a.id).map((r) => [r.userId, r.day, r.minutes]),
      [[owner.user.id, today, 91]],
      'entries for the same task, person and day are added up',
    );
    const mine = (await owner.agent.get(`/api/workspaces/${owner.workspace.id}/timesheet?${range}&userId=${member.user.id}`)).body;
    assert.deepEqual(mine.map((r) => [r.title, r.minutes]), [['Review designs', 30]]);
    assert.equal((await owner.agent.get(`/api/workspaces/${owner.workspace.id}/timesheet?from=2026-01-01&to=2026-12-31`)).status, 400);
    assert.equal((await outsider.agent.get(`/api/workspaces/${owner.workspace.id}/timesheet?${range}`)).status, 404);

    const csv = await owner.agent.get(`/api/workspaces/${owner.workspace.id}/timesheet.csv?${range}`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.match(csv.text, /Date,Person,Board,Task,Minutes,Hours,Note/);
    assert.match(csv.text, /Write the brief,90,1\.50,Planning/);

    // People remove their own time; owners can remove anyone's.
    assert.equal((await member.agent.delete(`/api/time/${entry.body.id}`)).status, 403);
    assert.equal((await owner.agent.delete(`/api/time/${theirs.id}`)).status, 204);
    assert.equal((await owner.agent.delete(`/api/time/${entry.body.id}`)).status, 204);
    assert.equal((await outsider.agent.delete(`/api/time/${entry.body.id}`)).status, 404);

    // Deleting a task takes its running timer with it.
    await member.agent.post(`/api/tasks/${a.id}/timer`).send({ today });
    await owner.agent.delete(`/api/tasks/${a.id}`);
    assert.equal((await member.agent.get('/api/me/timer')).body.timer, null);
  });
});
