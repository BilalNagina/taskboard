import pg from 'pg';

export function createDb(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return {
    pool,
    query: (text, params) => pool.query(text, params),
    ping: async () => {
      await pool.query('SELECT 1');
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
