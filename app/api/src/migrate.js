import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);
// Arbitrary constant: every instance takes the same lock, so only one migrates at a time.
// Without it, two replicas starting together on a fresh database race to create the schema.
const LOCK_ID = 727274;

export async function migrate(pool, logger) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger?.info({ migration: file }, 'applied migration');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

// `npm run migrate` runs migrations without starting the server.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { config } = await import('./config.js');
  const { createDb } = await import('./db.js');
  const db = createDb(config.databaseUrl);
  try {
    await migrate(db.pool, console);
  } finally {
    await db.close();
  }
}
