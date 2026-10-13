import pg from 'pg';

// Return DATE columns as 'YYYY-MM-DD' strings. By default pg turns them into JavaScript
// Dates at local midnight, which shifts the day in any timezone other than UTC.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
// bigint (bigserial ids for activity and notifications) arrives as a string by default.
// These ids stay far below 2^53, so plain numbers are safe and keep ids one type.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export function createDb(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return {
    pool,
    query: (text, params) => pool.query(text, params),
    ping: async () => {
      await pool.query('SELECT 1');
    },
    // Runs fn inside a transaction. fn gets an object with the same query() as db.
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (text, params) => client.query(text, params) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// Containers can start before the database accepts connections, so retry briefly.
export async function waitForDb(db, logger, { attempts = 30, delayMs = 2000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await db.ping();
      return;
    } catch (err) {
      if (i === attempts) throw err;
      logger?.warn({ attempt: i, err: err.message }, 'database not ready, retrying');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
