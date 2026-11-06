import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** A migrated throwaway database: its name, the URLs of the four roles for it, and how to drop it. */
export type TestDatabase = {
  name: string;
  ownerUrl: string;
  appUrl: string;
  jobsUrl: string;
  queueUrl: string;
  drop: () => Promise<void>;
};

function url(name: string): URL {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Tests that use the database need the local PostgreSQL 17: copy ` +
        '.env.example to .env, run docker compose up -d, then pnpm db:setup-local ' +
        '(packages/db/CLAUDE.md).',
    );
  }
  return new URL(value);
}

/** How long `drop` waits for the runtime roles' connections to the test database to end. */
const DISCONNECT_DEADLINE_MS = 10_000;

/**
 * Waits until no role but the owner is connected to the database. `DROP DATABASE … WITH (FORCE)`
 * may terminate only the owner's own backends: the owner has no `pg_signal_backend` (role
 * separation, ADR 0008), so a runtime role's backend still listed when the drop runs fails it.
 * A pool that a test file has just ended can leave its backends listed for a moment after the
 * client sees the socket close, so the drop waits for them. One still there at the deadline is a
 * pool a test left open: the error names its roles.
 */
async function waitForOtherRolesToLeave(admin: pg.Client, name: string): Promise<void> {
  const deadline = Date.now() + DISCONNECT_DEADLINE_MS;
  for (;;) {
    const { rows } = await admin.query<{ role: string; backends: string }>(
      `SELECT usename AS role, count(*) AS backends FROM pg_stat_activity
        WHERE datname = $1 AND usename <> current_user GROUP BY usename ORDER BY usename`,
      [name],
    );
    if (rows.length === 0) return;
    if (Date.now() >= deadline) {
      const still = rows.map((row) => `${row.role} (${row.backends})`).join(', ');
      throw new Error(
        `The test database ${name} still has connections after ${DISCONNECT_DEADLINE_MS} ms: ` +
          `${still}. A test left a pool open; end it in the file's afterAll.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Creates a fresh database as the owner role (from `DATABASE_OWNER_URL`, `DATABASE_APP_URL`,
 * `DATABASE_JOBS_URL` and `DATABASE_QUEUE_URL`) and applies every migration to it, so test runs
 * never share or leave data behind. For a package's or app's test global setup; call `drop` when
 * the run ends.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const owner = url('DATABASE_OWNER_URL');
  const roles = ['DATABASE_APP_URL', 'DATABASE_JOBS_URL', 'DATABASE_QUEUE_URL'];
  const [app, jobs, queue] = roles.map(url) as [URL, URL, URL];
  const name = `mizan_test_${Date.now()}_${randomBytes(3).toString('hex')}`;

  const admin = new pg.Client({ connectionString: owner.href });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8'`);
  const drop = async () => {
    try {
      await waitForOtherRolesToLeave(admin, name);
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  };

  for (const role of [owner, app, jobs, queue]) role.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: owner.href, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
    });
  } catch (error) {
    await drop();
    throw error;
  } finally {
    await pool.end();
  }

  return {
    name,
    ownerUrl: owner.href,
    appUrl: app.href,
    jobsUrl: jobs.href,
    queueUrl: queue.href,
    drop,
  };
}
