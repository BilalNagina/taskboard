import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createTaskRepo } from '../src/repo.js';

// Runs against a real PostgreSQL when DATABASE_URL is set (CI provides one).
const url = process.env.DATABASE_URL;

test('task repository against PostgreSQL', { skip: !url && 'DATABASE_URL not set' }, async () => {
  const db = createDb(url);
  try {
    await migrate(db.pool);
    await migrate(db.pool); // a second run must be a no-op
    await db.query('TRUNCATE tasks RESTART IDENTITY');

    const repo = createTaskRepo(db);
    const task = await repo.create('Integration test');
    assert.equal(task.title, 'Integration test');
    assert.equal(task.done, false);

    const updated = await repo.update(task.id, { done: true });
    assert.equal(updated.done, true);
    assert.equal(updated.title, 'Integration test');

    assert.equal((await repo.list()).length, 1);
    assert.equal(await repo.remove(task.id), true);
    assert.equal(await repo.remove(task.id), false);
    assert.equal(await repo.update(task.id, { done: false }), null);
  } finally {
    await db.close();
  }
});

test('concurrent migrations do not race', { skip: !url && 'DATABASE_URL not set' }, async () => {
  const dbs = [createDb(url), createDb(url), createDb(url)];
  try {
    await Promise.all(dbs.map((db) => migrate(db.pool)));
    const { rows } = await dbs[0].query('SELECT count(*)::int AS n FROM schema_migrations');
    assert.equal(rows[0].n, 1);
  } finally {
    await Promise.all(dbs.map((db) => db.close()));
  }
});
