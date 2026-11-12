import { type CompanyLedgers, parseEventEnvelope } from '@vertex-mizan/contracts';
import {
  type AuditActor,
  createCompanyBooks,
  createDatabase,
  type Database,
  journalEntries,
  journalLines,
  type PersonActor,
  postingRuleAccounts,
  receiveEvent,
  recordRate,
  reopenPeriod,
  users,
  withCompany,
} from '@vertex-mizan/db';
import { closeMonthByHand } from '@vertex-mizan/db/testing';
import { asc, eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { RevenueReleaseMonthJob, runMonth } from '../src/jobs/revenue/release-month.job.js';

// S06's release job on the run's database, run directly with its clock: a retainer cycle released
// month by month, twice and at once, after a late invoice, and with its month closed; a company
// made before S06 gets the template's recognition slots; the server command `revenue:run-release`.
// The numbers are `revenue/over-time-release`'s. All people, companies and amounts are synthetic.

let db: Database;
let jobs: Database;
let job: RevenueReleaseMonthJob;
let personId = '';

const SYP_USD: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

const actor = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-worker-revenue-test',
  ipAddress: null,
  userAgent: null,
});

const CLIENT = uuidv7();
const hub: AuditActor = {
  kind: 'api_client',
  clientId: CLIENT,
  name: 'Vertex Hub',
  requestId: 'request-worker-revenue-test',
  ipAddress: null,
  userAgent: null,
};

async function company(): Promise<string> {
  const id = uuidv7();
  await withCompany(db, id, async (tx) => {
    await createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة إيراد تجريبية',
        nameLatin: null,
        ledgers: SYP_USD,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'service-agency',
        createdByUserId: personId,
      },
      actor(),
    );
    for (const on of ['2026-11-15', '2026-11-19']) {
      await recordRate(tx, id, actor(), {
        effectiveOn: on,
        base: 'USD',
        quote: 'SYP',
        rate: '121.0000',
        type: 'bulletin',
        source: 'manual',
      });
    }
  });
  return id;
}

const external = (n: number) => `01934b6e-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** A retainer cycle's monthly charge received from Hub with the clock at `today`. */
function receiveCycle(
  companyId: string,
  cycle: { n: number; on: string; amount: number; from: string; to: string },
  today: string,
) {
  const client = { external_id: external(9001), code: 'C1', name: 'عميل تجريبي' };
  const raw = {
    id: uuidv7(),
    type: 'invoice.issued',
    version: 1,
    occurred_at: `${cycle.on}T12:00:00+03:00`,
    accounting_date: cycle.on,
    payload: {
      invoice: { id: uuidv7(), number: `INV-2026-${cycle.n}` },
      client,
      contract: {
        external_id: external(9004),
        code: 'R1',
        name: 'اشتراك',
        kind: 'retainer',
        client_external_id: client.external_id,
      },
      currency: 'USD',
      syp_per_usd: '122.0000',
      issued_on: cycle.on,
      due_on: '2026-12-31',
      lines: [
        {
          id: uuidv7(),
          amount: cycle.amount,
          service: { external_id: external(9002), code: 'S1', name: 'خدمة' },
          source: 'retainer_charge',
          charge_kind: 'monthly',
          cycle_start: cycle.from,
          cycle_end: cycle.to,
        },
      ],
    },
  };
  return withCompany(db, companyId, (tx) =>
    receiveEvent(
      tx,
      companyId,
      { raw, envelope: parseEventEnvelope(raw), apiClientId: CLIENT, requestId: 'request-test' },
      { actor: hub, today },
    ),
  );
}

const NOVEMBER = { n: 20, on: '2026-11-15', amount: 90_000, from: '2026-11-15', to: '2026-12-14' };

/** The company's release entries: date, then the liability line's amount and book amount. */
const releases = (companyId: string) =>
  withCompany(db, companyId, async (tx) => {
    const rows = await tx
      .select({
        date: journalEntries.entryDate,
        amount: journalLines.amountMinor,
        book: journalLines.bookMinor,
      })
      .from(journalEntries)
      .innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
      .where(sql`${journalEntries.source} = 'revenue_release' and ${journalLines.lineNo} = 1`)
      .orderBy(asc(journalEntries.sequence));
    return rows.map((row) => [row.date, row.amount, row.book]);
  });

/** Runs SQL as the owner in the company's context, as S07's close and an old company would. */
async function asOwner(companyId: string, statements: readonly string[], values: unknown[] = []) {
  const owner = new pg.Client({ connectionString: inject('ownerUrl') });
  await owner.connect();
  try {
    await owner.query('begin');
    await owner.query(`select set_config('app.company_id', $1, true)`, [companyId]);
    for (const statement of statements) {
      await owner.query(statement, statement.includes('$1') ? values : []);
    }
    await owner.query('commit');
  } finally {
    await owner.end();
  }
}

beforeAll(async () => {
  db = createDatabase(inject('appUrl'));
  jobs = createDatabase(inject('jobsUrl'));
  job = new RevenueReleaseMonthJob(jobs, db);
  const [row] = await db
    .insert(users)
    .values({ email: `worker.revenue.${uuidv7()}@example.test`, name: 'شخص تجريبي' })
    .returning({ id: users.id });
  personId = row?.id as string;
});
afterAll(async () => {
  await db.$client.end();
  await jobs.$client.end();
});

describe('revenue.release-month', () => {
  it('releases each ended month once, however many times and at once it runs', async () => {
    const companyId = await company();
    await receiveCycle(companyId, NOVEMBER, '2026-11-15');
    // November has not ended on its last day.
    await job.run('2026-11-30');
    expect(await releases(companyId)).toEqual([]);
    await Promise.all([job.run('2026-12-01'), job.run('2026-12-01')]);
    await job.run('2026-12-01');
    expect(await releases(companyId)).toEqual([['2026-11-30', 48_000n, 5_808_000n]]);
    await job.run('2027-01-01');
    await job.run('2027-01-02');
    expect(await releases(companyId)).toEqual([
      ['2026-11-30', 48_000n, 5_808_000n],
      ['2026-12-31', 42_000n, 5_082_000n],
    ]);
  });

  it('posts nothing for an invoice that released its ended month in its own transaction', async () => {
    const companyId = await company();
    await job.run('2026-12-01');
    const late = { n: 25, on: '2026-11-19', amount: 60_000, from: '2026-11-19', to: '2026-12-18' };
    await receiveCycle(companyId, late, '2026-12-01');
    expect(await releases(companyId)).toEqual([['2026-11-30', 24_000n, 2_904_000n]]);
    await job.run('2026-12-01');
    expect(await releases(companyId)).toEqual([['2026-11-30', 24_000n, 2_904_000n]]);
  });

  it('leaves a closed month’s release missing, and posts the next open month', async () => {
    const companyId = await company();
    await receiveCycle(companyId, NOVEMBER, '2026-11-15');
    // The invoice opened November's period; the close turns it closed.
    await closeMonthByHand(db, companyId, '2026-11');
    const run = await job.run('2027-01-01');
    expect(run.refused).toBeGreaterThanOrEqual(1);
    expect(await releases(companyId)).toEqual([['2026-12-31', 42_000n, 5_082_000n]]);
  });

  it('releases a reopened month that misses its release (S07 "Jobs"), once', async () => {
    const companyId = await company();
    await receiveCycle(companyId, NOVEMBER, '2026-11-15');
    await closeMonthByHand(db, companyId, '2026-11');
    expect((await job.run('2026-12-01')).refused).toBeGreaterThanOrEqual(1);
    expect(await releases(companyId)).toEqual([]);
    await withCompany(db, companyId, (tx) =>
      reopenPeriod(tx, {
        period: '2026-11',
        reason: 'إعادة فتح للاختبار',
        today: '2026-12-02',
        actor: {
          kind: 'person',
          userId: uuidv7(),
          name: 'محاسب تجريبي',
          sessionId: null,
          requestId: 'request-reopen-test',
          ipAddress: null,
          userAgent: null,
        },
      }),
    );
    await job.run('2026-12-02');
    await job.run('2026-12-02');
    expect((await releases(companyId)).map(([on]) => on)).toEqual(['2026-11-30']);
  });

  it('maps the template’s recognition slots in a company made before S06', async () => {
    const companyId = await company();
    await asOwner(companyId, [
      'alter table posting_rule_accounts disable trigger posting_rule_accounts_refuse_delete',
      `delete from posting_rule_accounts where slot in ('contract_liability', 'contract_asset', 'released_revenue', 'cancelled_project_refund')`,
      'alter table posting_rule_accounts enable always trigger posting_rule_accounts_refuse_delete',
    ]);
    await job.run('2026-11-15');
    const slots = await withCompany(db, companyId, (tx) =>
      tx.select({ slot: postingRuleAccounts.slot }).from(postingRuleAccounts),
    );
    expect(slots.map((row) => row.slot)).toEqual(
      expect.arrayContaining([
        'contract_liability',
        'contract_asset',
        'released_revenue',
        'cancelled_project_refund',
      ]),
    );
  });
});

describe('revenue:run-release --month', () => {
  it('posts one ended month’s releases once, and refuses a month it cannot read', async () => {
    const companyId = await company();
    await receiveCycle(companyId, NOVEMBER, '2026-11-15');
    await expect(runMonth(jobs, db, '2026-13', '2026-12-01')).rejects.toThrow(RangeError);
    // Before the month ends, nothing.
    await runMonth(jobs, db, '2026-11', '2026-11-30');
    expect(await releases(companyId)).toEqual([]);
    await runMonth(jobs, db, '2026-11', '2026-12-01');
    await runMonth(jobs, db, '2026-11', '2026-12-01');
    expect(await releases(companyId)).toEqual([['2026-11-30', 48_000n, 5_808_000n]]);
  });
});
