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
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
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
