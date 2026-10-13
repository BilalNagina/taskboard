// End-to-end API tests: accounts, workspaces, roles, files and reminders.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import request from 'supertest';
import { createRepo } from '../src/data/index.js';
import { createDb } from '../src/db.js';
import { MAX_UPLOAD_BYTES } from '../src/http/routes/attachments.js';
import { migrate } from '../src/migrate.js';
import { queueConnection } from '../src/queue.js';
import { scanDueTasks, sendReminder } from '../src/reminders.js';
import { DATABASE_URL, isoDate, PASSWORD, REDIS_URL, setupApi, skipIntegration } from './helpers.js';

describe('API against PostgreSQL and Redis', { skip: skipIntegration }, () => {
  let db, repo, storage, jobs, app, signUp, addMember, close;

  before(async () => {
    ({ db, repo, storage, jobs, app, signUp, addMember, close } = await setupApi());
  });

  after(() => close());

  test('readiness checks both PostgreSQL and Redis', async () => {
    assert.equal((await request(app).get('/readyz')).status, 200);
  });

  // ------------------------------------------------------------ accounts

  test('sign-up starts a secure session with a personal workspace and first board', async () => {
    const agent = request.agent(app);
    const email = `new-${randomUUID()}@example.com`;
    const res = await agent.post('/api/auth/register').send({ name: 'Grace Hopper', email: email.toUpperCase(), password: PASSWORD });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, email, 'emails are stored lowercase');
    assert.equal(res.body.user.theme, 'system');
    assert.equal(res.body.user.passwordHash, undefined);
    const cookie = res.headers['set-cookie'][0];
    assert.match(cookie, /^tb_session=.+HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);

    const workspaces = (await agent.get('/api/workspaces')).body;
    assert.equal(workspaces.length, 1);
    assert.equal(workspaces[0].name, "Grace's workspace");
    assert.equal(workspaces[0].role, 'owner');
    const boards = (await agent.get(`/api/workspaces/${workspaces[0].id}/boards`)).body;
    assert.deepEqual(boards.map((b) => b.name), ['My tasks']);

    assert.equal((await request(app).post('/api/auth/register').send({ name: 'G', email, password: PASSWORD })).status, 409);
  });

  test('sign-up validates input', async () => {
    const ok = { name: 'Ada', email: 'ada@example.com', password: PASSWORD };
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
    const res = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.passwordHash, undefined);
    assert.equal((await agent.get('/api/workspaces')).status, 200);
    assert.equal((await agent.post('/api/auth/logout')).status, 204);
    assert.equal((await agent.get('/api/workspaces')).status, 401, 'the session is gone server-side');
  });

  test('login attempts are rate limited per email', async () => {
    const { email } = await signUp('Barbara');
    for (let i = 0; i < 10; i++) {
      assert.equal((await request(app).post('/api/auth/login').send({ email, password: 'wrong password' })).status, 401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    assert.equal(blocked.status, 429, 'even the right password is refused once the limit is hit');
  });

  test('password reset: emailed token, single use, signs out old sessions', async () => {
    const { agent: oldSession, email } = await signUp('Katherine');

    jobs.added.length = 0;
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: `nobody-${randomUUID()}@example.com` });
    assert.equal(unknown.status, 202);
    assert.equal(jobs.added.length, 0, 'no email for unknown addresses, same response');

    const res = await request(app).post('/api/auth/forgot-password').send({ email: email.toUpperCase() });
    assert.equal(res.status, 202);
    assert.equal(jobs.added.length, 1);
    const { name, data } = jobs.added[0];
    assert.equal(name, 'password-reset');
    const stored = await db.query('SELECT token_hash FROM password_resets WHERE user_id = $1', [data.userId]);
    assert.notEqual(stored.rows[0].token_hash, data.token, 'only a hash of the token is stored');

    assert.equal((await request(app).post('/api/auth/reset-password').send({ token: 'x'.repeat(43), password: 'new password 1' })).status, 400);
    assert.equal((await request(app).post('/api/auth/reset-password').send({ token: data.token, password: 'short' })).status, 400);

    const fresh = request.agent(app);
    const reset = await fresh.post('/api/auth/reset-password').send({ token: data.token, password: 'new password 1' });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.user.email, email);
    assert.equal((await fresh.get('/api/workspaces')).status, 200, 'signed in after resetting');
    assert.equal((await oldSession.get('/api/workspaces')).status, 401, 'older sessions are signed out');

    assert.equal((await request(app).post('/api/auth/reset-password').send({ token: data.token, password: 'new password 2' })).status, 400, 'single use');
    assert.equal((await request(app).post('/api/auth/login').send({ email, password: PASSWORD })).status, 401);
    assert.equal((await request(app).post('/api/auth/login').send({ email, password: 'new password 1' })).status, 200);

    // Expired links are refused.
    jobs.added.length = 0;
    await request(app).post('/api/auth/forgot-password').send({ email });
    await db.query(`UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [data.userId]);
    const expired = await request(app).post('/api/auth/reset-password').send({ token: jobs.added[0].data.token, password: 'new password 3' });
    assert.equal(expired.status, 400);
  });

  test('profile, theme and password change', async () => {
    const { agent, email } = await signUp('Ada');
    const other = request.agent(app);
    await other.post('/api/auth/login').send({ email, password: PASSWORD });

    const updated = await agent.patch('/api/me').send({ name: 'Ada Lovelace', theme: 'dark' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.user.name, 'Ada Lovelace');
    assert.equal(updated.body.user.theme, 'dark');
    assert.equal((await agent.patch('/api/me').send({})).status, 400);
    assert.equal((await agent.patch('/api/me').send({ theme: 'neon' })).status, 400);

    assert.equal((await agent.post('/api/me/password').send({ currentPassword: 'wrong', newPassword: 'new password 1' })).status, 400);
    assert.equal((await agent.post('/api/me/password').send({ currentPassword: PASSWORD, newPassword: 'new password 1' })).status, 204);
    assert.equal((await agent.get('/api/auth/me')).status, 200, 'this session stays signed in');
    assert.equal((await other.get('/api/auth/me')).status, 401, 'other sessions are signed out');
  });

  // ------------------------------------------------------------ workspaces and roles

  test('workspaces: create, rename, boards and counts', async () => {
    const { agent, board } = await signUp();
    const created = await agent.post('/api/workspaces').send({ name: 'Acme Marketing' });
    assert.equal(created.status, 201);
    assert.equal(created.body.role, 'owner');
    assert.equal((await agent.patch(`/api/workspaces/${created.body.id}`).send({ name: 'Acme Growth' })).body.name, 'Acme Growth');

    const newBoard = await agent.post(`/api/workspaces/${created.body.id}/boards`).send({ name: 'Launch' });
    assert.equal(newBoard.status, 201);
    assert.equal(newBoard.body.workspaceId, created.body.id);
    assert.equal((await agent.patch(`/api/boards/${newBoard.body.id}`).send({ name: 'Launch v2' })).body.name, 'Launch v2');
    assert.equal((await agent.post(`/api/workspaces/${created.body.id}/boards`).send({ name: '' })).status, 400);

    await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'One' });
    const { body: two } = await agent.post(`/api/boards/${board.id}/tasks`).send({ title: 'Two' });
    await agent.patch(`/api/tasks/${two.id}`).send({ done: true });
    const counts = (await agent.get(`/api/boards/${board.id}`)).body;
    assert.equal(counts.taskCount, 2);
    assert.equal(counts.openCount, 1);
    assert.equal(counts.role, 'owner');

    assert.equal((await agent.delete(`/api/boards/${newBoard.body.id}`)).status, 204);
    assert.equal((await agent.get(`/api/boards/${newBoard.body.id}`)).status, 404);
  });

  test('roles: viewers read, members edit, owners manage, outsiders see nothing', async () => {
    const owner = await signUp('Olivia');
    const member = await signUp('Mateo');
    const viewer = await signUp('Vera');
    const outsider = await signUp('Oscar');
    await addMember(owner.workspace.id, member.user.id, 'member');
    await addMember(owner.workspace.id, viewer.user.id, 'viewer');
    const ws = owner.workspace.id;
    const { body: task } = await owner.agent.post(`/api/boards/${owner.board.id}/tasks`).send({ title: 'Shared task' });

    // Viewer: can read everything, change nothing.
    assert.equal((await viewer.agent.get(`/api/boards/${owner.board.id}/full`)).status, 200);
    assert.equal((await viewer.agent.get(`/api/boards/${owner.board.id}`)).body.role, 'viewer');
    assert.equal((await viewer.agent.get('/api/workspaces')).body.some((w) => w.id === ws && w.role === 'viewer'), true);
    for (const res of await Promise.all([
      viewer.agent.post(`/api/boards/${owner.board.id}/tasks`).send({ title: 'Nope' }),
      viewer.agent.patch(`/api/tasks/${task.id}`).send({ done: true }),
      viewer.agent.delete(`/api/tasks/${task.id}`),
      viewer.agent.post(`/api/workspaces/${ws}/boards`).send({ name: 'Nope' }),
      viewer.agent.post(`/api/tasks/${task.id}/attachments`).set('X-Filename', 'x.txt').send(Buffer.from('x')),
    ])) {
      assert.equal(res.status, 403, `viewer ${res.req.method} ${res.req.path}`);
    }

    // Member: can edit tasks and boards, but not delete boards or rename the workspace.
    assert.equal((await member.agent.patch(`/api/tasks/${task.id}`).send({ done: true })).status, 200);
    assert.equal((await member.agent.post(`/api/workspaces/${ws}/boards`).send({ name: 'Member board' })).status, 201);
    assert.equal((await member.agent.delete(`/api/boards/${owner.board.id}`)).status, 403);
    assert.equal((await member.agent.patch(`/api/workspaces/${ws}`).send({ name: 'Mine' })).status, 403);

    // Outsider: 404 on everything, so they can't even confirm it exists.
    for (const res of await Promise.all([
      outsider.agent.get(`/api/boards/${owner.board.id}`),
      outsider.agent.get(`/api/boards/${owner.board.id}/full`),
      outsider.agent.get(`/api/workspaces/${ws}/boards`),
      outsider.agent.patch(`/api/tasks/${task.id}`).send({ done: false }),
      outsider.agent.delete(`/api/boards/${owner.board.id}`),
      outsider.agent.patch(`/api/workspaces/${ws}`).send({ name: 'Mine' }),
    ])) {
      assert.equal(res.status, 404, `outsider ${res.req.method} ${res.req.path}`);
    }
    assert.equal((await outsider.agent.get('/api/workspaces')).body.some((w) => w.id === ws), false);
  });

  // ------------------------------------------------------------ tasks and files

  test('tasks: due dates, updates, done moves to the Done column, deletion', async () => {
    const { agent, board } = await signUp();
    const url = `/api/boards/${board.id}/tasks`;
    assert.equal((await agent.post(url).send({ title: 'Bad date', dueDate: '2026-02-30' })).status, 400);

    const { body: later } = await agent.post(url).send({ title: 'Later', dueDate: isoDate(9) });
    const { body: soon } = await agent.post(url).send({ title: 'Soon', dueDate: isoDate(1), priority: 'high' });
    const { body: undated } = await agent.post(url).send({ title: 'Someday' });
    assert.equal(soon.dueDate, isoDate(1));
    assert.equal(soon.priority, 'high');
    const full = (await agent.get(`/api/boards/${board.id}/full`)).body;
    const [todo, , doneColumn] = full.columns;
    assert.deepEqual(full.columns.map((c) => c.name), ['To do', 'In progress', 'Done']);
    assert.deepEqual(full.cards.filter((c) => c.columnId === todo.id).map((c) => c.title), ['Later', 'Soon', 'Someday'], 'new cards go to the end of the first column');

    const done = await agent.patch(`/api/tasks/${soon.id}`).send({ done: true });
    assert.equal(done.body.done, true);
    assert.equal(done.body.columnId, doneColumn.id, 'ticking done moves the card to the Done column');
    const reopened = await agent.patch(`/api/tasks/${soon.id}`).send({ done: false });
    assert.equal(reopened.body.columnId, todo.id, 'unticking moves it back');

    const cleared = await agent.patch(`/api/tasks/${later.id}`).send({ dueDate: null, title: 'Later, undated' });
    assert.equal(cleared.body.dueDate, null);
    assert.equal(cleared.body.title, 'Later, undated');

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

    const json = await agent.post(url).set('Content-Type', 'application/json').set('X-Filename', 'data.json').send(Buffer.from('{"not": "parsed"'));
    assert.equal(json.status, 201, 'a JSON file is stored as-is, not parsed');

    const down = await agent.get(`/api/attachments/${up.body.id}`);
    assert.equal(down.text, 'hello from S3');
    assert.match(down.headers['content-disposition'], /^attachment; filename="Release notes _.txt"; filename\*=UTF-8''Release%20notes%20%C3%BC.txt$/);

    assert.equal((await agent.post(url).set('X-Filename', 'empty.txt').send(Buffer.alloc(0))).status, 400);
    assert.equal((await agent.post(url).set('Content-Type', 'text/plain').send(Buffer.from('x'))).status, 400, 'filename required');
    const tooBig = await agent.post(url).set('Content-Type', 'application/octet-stream').set('X-Filename', 'big.bin').send(Buffer.alloc(MAX_UPLOAD_BYTES + 1));
    assert.equal(tooBig.status, 413);

    const key = (await repo.getAttachment(up.body.id)).storageKey;
    assert.equal((await agent.delete(`/api/attachments/${up.body.id}`)).status, 204);
    assert.equal(storage.files.has(key), false, 'the file is removed from storage');

    const jsonKey = (await repo.getAttachment(json.body.id)).storageKey;
    assert.equal((await agent.delete(`/api/tasks/${task.id}`)).status, 204);
    assert.equal(storage.files.has(jsonKey), false, 'deleting the task removes its files');
  });

  test('reminders: queued once, emailed once, re-armed by a new due date', async () => {
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

    const queue = new Queue(`test-${randomUUID()}`, { connection: queueConnection(REDIS_URL) });
    try {
      await scanDueTasks({ repo, queue });
      await scanDueTasks({ repo, queue });
      const jobsForTask = (await queue.getJobs(['waiting'])).filter((j) => j.data.taskId === due.id);
      assert.equal(jobsForTask.length, 1, 'the job id stops a second scan queueing it again');
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
    }

    const sent = [];
    const deps = { repo, mailer: { send: async (msg) => sent.push(msg) }, appUrl: 'https://app.example.com' };
    assert.deepEqual(await sendReminder(deps, { taskId: due.id, dueDate: isoDate(1) }), { sent: true });
    assert.deepEqual(await sendReminder(deps, { taskId: due.id, dueDate: isoDate(1) }), { sent: false }, 'not sent twice');
    assert.equal(sent[0].to, email);

    await agent.patch(`/api/tasks/${due.id}`).send({ dueDate: isoDate(0) });
    assert.equal((await pending()).includes(due.id), true, 'a new due date means a new reminder');
    assert.deepEqual(await sendReminder(deps, { taskId: due.id, dueDate: isoDate(1) }), { sent: false }, 'stale job skipped');
  });
});

describe('migrations', { skip: !DATABASE_URL && 'DATABASE_URL not set' }, () => {
  test('concurrent runs do not race, and re-runs are no-ops', async () => {
    const dbs = [createDb(DATABASE_URL), createDb(DATABASE_URL), createDb(DATABASE_URL)];
    try {
      await Promise.all(dbs.map((db) => migrate(db.pool)));
      await migrate(dbs[0].pool);
      const { rows } = await dbs[0].query('SELECT version FROM schema_migrations ORDER BY version');
      assert.deepEqual(rows.map((r) => r.version), [
        '001_create_tasks.sql',
        '002_accounts_boards_attachments.sql',
        '003_workspaces_password_resets.sql',
        '004_columns_details_invites_activity.sql',
        '005_search_notifications_profile.sql',
      ]);
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });
});

describe('upgrading existing data', { skip: !DATABASE_URL && 'DATABASE_URL not set' }, () => {
  // Builds a database at the previous schema version with real rows, then runs the new
  // migration, the same way the live server upgrades.
  test('003 gives each existing user a workspace that keeps their boards and tasks', async () => {
    const name = `tb_upgrade_${randomUUID().replaceAll('-', '')}`;
    const admin = createDb(DATABASE_URL);
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(DATABASE_URL);
    url.pathname = `/${name}`;
    const db = createDb(url.toString());
    try {
      const { readFile } = await import('node:fs/promises');
      await db.query('CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      for (const file of ['001_create_tasks.sql', '002_accounts_boards_attachments.sql']) {
        await db.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
        await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      }
      const { rows: [user] } = await db.query(
        `INSERT INTO users (email, name, password_hash) VALUES ('ada@example.com', 'Ada Lovelace', 'x') RETURNING id`,
      );
      const { rows: [board] } = await db.query(`INSERT INTO boards (user_id, name) VALUES ($1, 'Launch') RETURNING id`, [user.id]);
      await db.query(`INSERT INTO tasks (board_id, title) VALUES ($1, 'Keep me')`, [board.id]);

      await migrate(db.pool);

      const repo = createRepo(db);
      const [workspace] = await repo.listWorkspaces(user.id);
      assert.equal(workspace.name, "Ada's workspace");
      assert.equal(workspace.role, 'owner');
      const boards = await repo.listBoards(workspace.id);
      assert.deepEqual(boards.map((b) => [b.name, b.taskCount]), [['Launch', 1]]);
      const { rows: [task] } = await db.query('SELECT created_by FROM tasks');
      assert.equal(task.created_by, user.id, 'existing tasks are credited to the board creator');
    } finally {
      await db.close();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.close();
    }
  });
});
