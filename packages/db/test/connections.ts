import { monthsOf } from '@vertex-mizan/contracts';
import { asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, inject } from 'vitest';
import {
  createDatabase,
  type Database,
  ledgerHeads,
  periods,
  withCompany,
  writePeriodTransition,
} from '../src/index.js';
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

/**
 * Closes a month by hand for a test's setup (S07): the posting function's transition as the app
 * role, which the period guards check (in order, with its event), without the close service's
 * checklist, which the test is not about. `periods.test.ts` tests the close itself.
 */
export async function closeMonthByHand(
  app: Database,
  companyId: string,
  period: string,
  /** Holds the close's transaction open after its writes, until `until` settles. */
  hold?: { readonly written: () => void; readonly until: Promise<void> },
) {
  await withCompany(app, companyId, async (tx) => {
    const [head] = await tx
      .select({ entryCount: ledgerHeads.entryCount })
      .from(ledgerHeads)
      .for('update');
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
        headSequence: BigInt(head?.entryCount ?? 0),
      });
    }
    if (hold !== undefined) {
      hold.written();
      await hold.until;
    }
  });
}
