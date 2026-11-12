import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { monthsOf } from '@vertex-mizan/contracts';
import { asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import type { Database } from './client.js';
import { withCompany } from './company-context.js';
import { writePeriodTransition } from './posting/post.js';
import { ledgerHeads, periods } from './schema/ledger.js';

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
 * Drops the test database as the owner, which has no `pg_signal_backend` (role separation, ADR
 * 0008): it may terminate only its own backends. So the drop never relies on terminating another
 * role's (`DROP DATABASE … WITH (FORCE)` refuses the whole drop when it meets one):
 * - it waits until no runtime role's client backend is connected. A pool a test file has just
 *   ended can leave its backends listed for a moment; one still there at the deadline is a pool a
 *   test left open, and the error names its roles;
 * - it terminates the owner's own backends on the database;
 * - a plain `DROP DATABASE` then waits, up to 5 s, for backends that are still exiting, and stops
 *   autovacuum workers itself, with no right to signal anyone.
 */
async function dropDatabase(admin: pg.Client, name: string): Promise<void> {
  const deadline = Date.now() + DISCONNECT_DEADLINE_MS;
  for (;;) {
    const { rows } = await admin.query<{ role: string; backends: string }>(
      `SELECT usename AS role, count(*) AS backends FROM pg_stat_activity
        WHERE datname = $1 AND backend_type = 'client backend' AND usename <> current_user
        GROUP BY usename ORDER BY usename`,
      [name],
    );
    if (rows.length === 0) break;
    if (Date.now() >= deadline) {
      const still = rows.map((row) => `${row.role} (${row.backends})`).join(', ');
      throw new Error(
        `The test database ${name} still has connections after ${DISCONNECT_DEADLINE_MS} ms: ` +
          `${still}. A test left a pool open; end it in the file's afterAll.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND usename = current_user AND pid <> pg_backend_pid()`,
    [name],
  );
  await admin.query(`DROP DATABASE ${name}`);
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
      await dropDatabase(admin, name);
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

/**
 * Closes a month by hand for a test's setup (S07): the posting function's transition as the app
 * role, which the period guards check (in order, with its event), without the close service's
 * checklist, which the test is not about. `packages/db/test/periods.test.ts` tests the
 * close itself. For this package's and the apps' tests only.
 */
export async function closeMonthByHand(
  app: Database,
  companyId: string,
  period: string,
  /** Holds the close's transaction open after its writes, until `until` settles. */
  hold?: { readonly written: () => void; readonly until: Promise<void> },
) {
  await withCompany(app, companyId, async (tx) => {
    // The ledger head first (ADR 0008's lock order), as the close service takes it.
    await tx.select({ id: ledgerHeads.id }).from(ledgerHeads).for('update');
    // Months close in order (S07 rule 2): every month from the first period closes first.
    const rows = await tx
      .select({ period: periods.period, state: periods.state })
      .from(periods)
      .orderBy(asc(periods.period));
    const first =
      rows[0]?.period !== undefined && rows[0].period < period ? rows[0].period : period;
    for (const month of monthsOf({ from: first, to: period })) {
      if (rows.some((row) => row.period === month && row.state === 'closed')) continue;
      await writePeriodTransition(tx, {
        companyId,
        period: month,
        kind: 'closed',
        reason: 'إقفال للاختبار',
        userId: uuidv7(),
        checklist: [],
      });
    }
    if (hold !== undefined) {
      hold.written();
      await hold.until;
    }
  });
}
