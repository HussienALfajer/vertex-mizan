import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, inject } from 'vitest';
import { createDatabase, type Database } from '../src/index.js';
import * as schema from '../src/schema/index.js';

/**
 * The run's database as each role; pools close after the file. The app and jobs roles connect as
 * the apps do, through `createDatabase`. The owner and the superuser are never runtime roles, so
 * `createDatabase` refuses them: the tests reach them through plain pools. pg-boss's queue role
 * has no Drizzle database either.
 */
export function connect() {
  const app = createDatabase(inject('appUrl'));
  const jobs = createDatabase(inject('jobsUrl'));
  const owner: Database = drizzle({
    client: new pg.Pool({ connectionString: inject('ownerUrl') }),
    schema,
    casing: 'snake_case',
  });
  const queue = new pg.Pool({ connectionString: inject('queueUrl') });
  const superuser = new pg.Pool({ connectionString: inject('adminUrl') });
  afterAll(async () => {
    await Promise.all(
      [app.$client, jobs.$client, owner.$client, queue, superuser].map((p) => p.end()),
    );
  });
  return { app, jobs, owner, queue, superuser };
}

/** PostgreSQL's message for a refused statement; Drizzle wraps it as the cause of its error. */
export async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the database to refuse the statement');
}
