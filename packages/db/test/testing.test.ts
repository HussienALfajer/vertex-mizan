import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../src/testing.js';

// The throwaway database every test run makes: its drop must not race the runtime roles'
// connections, which the owner may not terminate (it has no `pg_signal_backend`, ADR 0008).

/** The database names that exist, as the owner sees them. */
async function databaseExists(name: string): Promise<boolean> {
  const owner = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
  await owner.connect();
  try {
    const { rows } = await owner.query('select 1 from pg_database where datname = $1', [name]);
    return rows.length === 1;
  } finally {
    await owner.end();
  }
}

describe('createTestDatabase', () => {
  it('drops its database once a runtime role that is still connected leaves', async () => {
    const database = await createTestDatabase();
    const app = new pg.Client({ connectionString: database.appUrl });
    await app.connect();
    // Before the fix, the drop failed at once: "permission denied to terminate process".
    const dropped = database.drop();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await app.end();
    await dropped;
    expect(await databaseExists(database.name)).toBe(false);
  });

  it('drops its database with the owner still connected to it', async () => {
    const database = await createTestDatabase();
    const owner = new pg.Client({ connectionString: database.ownerUrl });
    owner.on('error', () => {});
    await owner.connect();
    try {
      await database.drop();
    } finally {
      await owner.end().catch(() => {});
    }
    expect(await databaseExists(database.name)).toBe(false);
  });
});
