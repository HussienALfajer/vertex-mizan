import type { CompanyLedgers } from '@vertex-mizan/contracts';
import {
  chartAccounts,
  createCompanyBooks,
  createDatabase,
  type Database,
  type PersonActor,
  post,
  recordRate,
  users,
  withCompany,
} from '@vertex-mizan/db';
import { createTestDatabase, type TestDatabase } from '@vertex-mizan/db/testing';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  COMMIT_MARGIN_MS,
  checkRestore,
  compareTrialBalances,
  type DrillDatabases,
} from '../src/core/drill/restore-check.js';

// The restore drill's checks (ADR 0020): the run's database stands for both production and a sound
// restore of it; a fresh empty database for a restore that lost a company; a trial balance that
// differs. The real restore, from pgBackRest into a temporary cluster, runs on the server
// (`deploy/bin/mizan-restore-drill`). All people, companies and amounts are synthetic.

const HOUR = 3_600_000;
let db: Database;
let jobs: Database;
let empty: TestDatabase;
let emptyDb: Database;
let emptyJobs: Database;
let personId = '';
let companyId = '';

const SYP_USD: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

const actor = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-worker-drill-test',
  ipAddress: null,
  userAgent: null,
});

beforeAll(async () => {
  db = createDatabase(inject('appUrl'));
  jobs = createDatabase(inject('jobsUrl'));
  empty = await createTestDatabase();
  emptyDb = createDatabase(empty.appUrl);
  emptyJobs = createDatabase(empty.jobsUrl);
  const [person] = await db
    .insert(users)
    .values({ email: 'worker.drill@example.test', name: 'محاسب تجريبي' })
    .returning({ id: users.id });
  personId = person?.id as string;
  companyId = uuidv7();
  await withCompany(db, companyId, async (tx) => {
    await createCompanyBooks(
      tx,
      companyId,
      {
        name: 'شركة تمرين الاستعادة',
        nameLatin: null,
        ledgers: SYP_USD,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'service-agency',
        createdByUserId: personId,
      },
      actor(),
    );
    for (const [type, rate] of [
      ['bulletin', '121.5000'],
      ['market', '122.0000'],
    ] as const) {
      await recordRate(tx, companyId, actor(), {
        effectiveOn: '2026-11-08',
        base: 'USD',
        quote: 'SYP',
        rate,
        type,
        source: 'manual',
      });
    }
  });
  for (const amount of [1_000n, 2_500n]) {
    await withCompany(db, companyId, async (tx) => {
      const accounts = new Map(
        (
          await tx.select({ id: chartAccounts.id, code: chartAccounts.code }).from(chartAccounts)
        ).map((row) => [row.code, row.id]),
      );
      const line = (code: string, amountMinor: bigint) => ({
        accountId: accounts.get(code) as string,
        dimensionValueIds: [],
        currency: 'SYP' as const,
        amountMinor,
        memo: null,
      });
      await post(tx, {
        client: 'manual',
        idempotencyKey: uuidv7(),
        entryDate: '2026-11-08',
        description: 'قيد تمرين',
        reference: null,
        draftId: null,
        preparedByUserId: personId,
        approvedByUserId: null,
        actor: actor(),
        content: {
          kind: 'manual',
          today: '2026-11-30',
          dealtRates: [],
          lines: [line('111003', amount), line('111001', -amount)],
        },
      });
    });
  }
});

afterAll(async () => {
  await Promise.all([db, jobs, emptyDb, emptyJobs].map((pool) => pool.$client.end()));
  await empty.drop();
});

const sound = (): DrillDatabases => ({
  production: db,
  productionJobs: jobs,
  restored: db,
  restoredJobs: jobs,
});

describe('checkRestore', () => {
  it('passes a restore that holds every company whole and matches production', async () => {
    const now = new Date();
    const result = await checkRestore(sound(), now, now, 26 * HOUR);
    expect(result.problems).toEqual([]);
    const company = result.companies.find((row) => row.companyId === companyId);
    expect(company).toEqual({
      companyId,
      entryCount: 2,
      headSequence: '2',
      problems: [],
    });
    expect(result.ok).toBe(true);
  });

  it('fails a restore older than the allowed age', async () => {
    const now = new Date();
    const result = await checkRestore(sound(), new Date(now.getTime() - 27 * HOUR), now, 26 * HOUR);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/older than 26 hours/);
  });

  it('fails a restore that lacks a company which had posted before its moment', async () => {
    const later = new Date(Date.now() + COMMIT_MARGIN_MS + HOUR);
    const result = await checkRestore(
      { ...sound(), restored: emptyDb, restoredJobs: emptyJobs },
      later,
      later,
      26 * HOUR,
    );
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(`company ${companyId} is missing from the restore`);
  });

  it('does not count a company created after the restored moment as missing', async () => {
    const before = new Date(Date.now() - HOUR);
    const result = await checkRestore(
      { ...sound(), restored: emptyDb, restoredJobs: emptyJobs },
      before,
      new Date(),
      26 * HOUR,
    );
    expect(result.problems).not.toContain(`company ${companyId} is missing from the restore`);
  });
});

describe('compareTrialBalances', () => {
  const row = (accountId: string, bookMinor: string) => ({
    accountId,
    currency: 'SYP',
    amountMinor: bookMinor,
    bookMinor,
    parallelMinor: '0',
  });

  it('finds nothing between equal balances, whatever their order', () => {
    expect(
      compareTrialBalances([row('a', '5'), row('b', '-5')], [row('b', '-5'), row('a', '5')]),
    ).toEqual([]);
  });

  it('names each account that differs or is missing on one side', () => {
    expect(compareTrialBalances([row('a', '5'), row('b', '-5')], [row('a', '4')])).toEqual([
      'trial balance a SYP: production 5/5/0, restored 4/4/0',
      'trial balance b SYP: production -5/-5/0, restored none',
    ]);
  });
});
