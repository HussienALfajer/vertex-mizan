import { type CompanyLedgers, REPORT_FILE_STATES, REPORTS } from '@vertex-mizan/contracts';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  chartAccounts,
  createCompanyBooks,
  type Database,
  REPORT_FILE_STATES as DB_REPORT_FILE_STATES,
  journalBookPrints,
  type PersonActor,
  periods,
  post,
  REPORT_FILE_REPORTS,
  recordRate,
  reportFiles,
  type Transaction,
  users,
  withCompany,
  writePeriodTransition,
} from '../src/index.js';
import { closeMonthByHand, connect, refusal } from './connections.js';

// S09's reports module on the migrated database (0048, 0049): the PDF queue's states, the journal
// book's register of official prints (append-only, closed months only, its counts and totals the
// ledger's, ready with its file in one transaction) and what the jobs role reaches. All values are
// synthetic.

const { app, jobs, owner } = connect();

const SYP: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: null,
};

let person = '';
const actor = (): PersonActor => ({
  kind: 'person',
  userId: person,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-report-files-test',
  ipAddress: null,
  userAgent: null,
});

/** A SYP company with two entries on 2026-10-08 and one on 2026-11-08. */
async function company(): Promise<string> {
  const id = uuidv7();
  await withCompany(app, id, async (tx) => {
    await createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة تقارير تجريبية',
        nameLatin: null,
        ledgers: SYP,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'service-agency',
        createdByUserId: person,
      },
      actor(),
    );
    await recordRate(tx, id, actor(), {
      effectiveOn: '2026-10-01',
      base: 'USD',
      quote: 'SYP',
      rate: '121.5000',
      type: 'bulletin',
      source: 'manual',
    });
  });
  for (const [date, amount] of [
    ['2026-10-08', 50_000n],
    ['2026-10-09', 25_000n],
    ['2026-11-08', 10_000n],
  ] as const) {
    await withCompany(app, id, (tx) => postOne(tx, date, amount));
  }
  return id;
}

async function postOne(tx: Transaction, entryDate: string, amount: bigint) {
  const accounts = new Map(
    (await tx.select({ id: chartAccounts.id, code: chartAccounts.code }).from(chartAccounts)).map(
      (row) => [row.code, row.id],
    ),
  );
  const line = (code: string, amountMinor: bigint) => ({
    accountId: accounts.get(code) as string,
    dimensionValueIds: [],
    currency: 'SYP' as const,
    amountMinor,
    memo: null,
  });
  return post(tx, {
    client: 'manual',
    idempotencyKey: uuidv7(),
    entryDate,
    description: 'قيد تجريبي',
    reference: null,
    draftId: null,
    preparedByUserId: person,
    approvedByUserId: null,
    actor: actor(),
    content: {
      kind: 'manual',
      today: '2026-11-30',
      dealtRates: [],
      lines: [line('111003', amount), line('111001', -amount)],
    },
  });
}

let companyA = '';
let companyB = '';

beforeAll(async () => {
  const [row] = await app
    .insert(users)
    .values({ email: 'reports.accountant@example.test', name: 'محاسب تجريبي' })
    .returning({ id: users.id });
  person = row?.id as string;
  companyA = await company();
  companyB = await company();
  await closeMonthByHand(app, companyA, '2026-10');
});

const request = (
  values: Partial<typeof reportFiles.$inferInsert> = {},
  companyId = companyA,
  db: Database = app,
) =>
  withCompany(db, companyId, (tx) =>
    tx
      .insert(reportFiles)
      .values({
        companyId,
        report: 'trial_balance',
        params: { from: '2026-10-01', to: '2026-10-31' },
        requestedByUserId: person,
        ...values,
      })
      .returning({ id: reportFiles.id })
      .then(([row]) => row?.id as string),
  );

const change = (id: string, values: Partial<typeof reportFiles.$inferInsert>, db: Database = app) =>
  withCompany(db, companyA, (tx) =>
    tx.update(reportFiles).set(values).where(eq(reportFiles.id, id)),
  );

const ready = (id: string, expiresAt: Date | null, sha256 = 'c'.repeat(64)) => ({
  state: 'ready',
  storageKey: `${companyA}/${id}`,
  sizeBytes: 2048,
  sha256,
  readyAt: new Date(),
  expiresAt,
});

const stateOf = (id: string) =>
  withCompany(app, companyA, (tx) =>
    tx
      .select({ state: reportFiles.state })
      .from(reportFiles)
      .where(eq(reportFiles.id, id))
      .then(([row]) => row?.state),
  );

/** October's figures in company A: two entries of two lines, 75,000 each side. */
const OCTOBER = {
  entryCount: 2,
  lineCount: 4,
  debitTotalMinor: 75_000n,
  creditTotalMinor: 75_000n,
};

async function periodIds(tx: Transaction) {
  const rows = await tx.select({ id: periods.id, period: periods.period }).from(periods);
  return new Map(rows.map((row) => [row.period, row.id]));
}

/** An official print of `from`–`to`, its row and the file ready in one transaction. */
const print = (
  fileId: string,
  values: Partial<typeof journalBookPrints.$inferInsert> = {},
  { from = '2026-10', to = '2026-10', fileSha = 'e'.repeat(64), markReady = true } = {},
) =>
  withCompany(app, companyA, async (tx) => {
    const ids = await periodIds(tx);
    await tx.insert(journalBookPrints).values({
      companyId: companyA,
      reportFileId: fileId,
      fiscalYear: 2026,
      fromPeriodId: ids.get(from) as string,
      toPeriodId: ids.get(to) as string,
      firstPage: 1,
      lastPage: 1,
      ...OCTOBER,
      contentSha256: 'f'.repeat(64),
      fileSha256: 'e'.repeat(64),
      reopensSeen: 0,
      printedByUserId: person,
      ...values,
    });
    if (markReady) {
      await tx
        .update(reportFiles)
        .set(ready(fileId, null, fileSha))
        .where(eq(reportFiles.id, fileId));
    }
  });

const officialFile = () =>
  request({
    report: 'journal_book',
    params: { fiscalYear: 2026, from: '2026-10', to: '2026-10' },
    official: true,
  });

describe('report_files', () => {
  it('keeps the reports and states of the contracts', () => {
    expect(REPORT_FILE_REPORTS).toEqual(REPORTS);
    expect(DB_REPORT_FILE_STATES).toEqual(REPORT_FILE_STATES);
  });

  it('is requested queued, as a PDF of a known report, official only for the journal book', async () => {
    expect(await stateOf(await request())).toBe('queued');
    expect(await refusal(request({ ...ready(uuidv7(), new Date()) }))).toMatch(/requested queued/);
    expect(await refusal(request({ attempts: 2 }))).toMatch(/requested queued/);
    expect(await refusal(request({ report: 'cash_flow' }))).toMatch(/report_files_report/);
    expect(await refusal(request({ format: 'xlsx' }))).toMatch(/report_files_format/);
    expect(await refusal(request({ official: true }))).toMatch(/report_files_official/);
    expect(await refusal(request({ params: [] }))).toMatch(/report_files_params/);
  });

  it('becomes ready or failed once, then a ready one expires past its time, as it was', async () => {
    const failed = await request();
    await change(failed, { attempts: 1 });
    expect(await refusal(change(failed, { attempts: 0 }))).toMatch(/attempts only grow/);
    await change(failed, { state: 'failed', error: 'RENDER_FAILED' });
    expect(await refusal(change(failed, { state: 'queued', error: null }))).toMatch(
      /failed to queued refused/,
    );

    const id = await request();
    expect(await refusal(change(id, { state: 'ready' }))).toMatch(/report_files_ready_fields/);
    expect(await refusal(change(id, ready(id, null)))).toMatch(/report_files_ready_fields/);
    expect(
      await refusal(
        change(id, { ...ready(id, new Date()), storageKey: `${companyA}/${uuidv7()}` }),
      ),
    ).toMatch(/report_files_storage_key/);
    await change(id, ready(id, new Date(Date.now() + 24 * 3600 * 1000)));
    expect(await refusal(change(id, { state: 'expired' }))).toMatch(/past its time/);

    const past = await request();
    await change(past, ready(past, new Date(Date.now() - 1000)));
    expect(await refusal(change(past, { state: 'expired', sha256: 'd'.repeat(64) }))).toMatch(
      /past its time, as it was/,
    );
    await change(past, { state: 'expired' });
    expect(await stateOf(past)).toBe('expired');
    expect(await refusal(change(past, { state: 'ready' }))).toMatch(/expired to ready refused/);
  });

  it('keeps what was asked: the app role updates the state columns only, the owner not even them', async () => {
    const id = await request();
    for (const values of [
      { params: { from: '2026-01-01' } },
      { report: 'balance_sheet' },
      { requestedByUserId: uuidv7() },
      { official: true },
    ]) {
      expect(await refusal(change(id, values)), JSON.stringify(values)).toMatch(
        /permission denied/,
      );
      expect(await refusal(change(id, values, owner)), JSON.stringify(values)).toMatch(
        /keeps what was asked/,
      );
    }
    expect(await refusal(withCompany(app, companyA, (tx) => tx.delete(reportFiles)))).toMatch(
      /permission denied/,
    );
  });

  it('shows a company only its own files', async () => {
    const other = await request({}, companyB);
    const seen = await withCompany(app, companyA, (tx) =>
      tx.select({ id: reportFiles.id }).from(reportFiles),
    );
    expect(seen.map((row) => row.id)).not.toContain(other);
    expect(
      await refusal(
        withCompany(app, companyA, (tx) =>
          tx.insert(reportFiles).values({
            companyId: companyB,
            report: 'chart',
            params: {},
            requestedByUserId: person,
          }),
        ),
      ),
    ).toMatch(/row-level security/);
  });
});

describe('journal_book_prints', () => {
  it('registers an official print of closed months, ready with its file in one transaction', async () => {
    const file = await officialFile();
    await print(file);
    expect(await stateOf(file)).toBe('ready');
    const [row] = await withCompany(app, companyA, (tx) =>
      tx.select().from(journalBookPrints).where(eq(journalBookPrints.reportFileId, file)),
    );
    expect(row).toMatchObject({ ...OCTOBER, firstPage: 1, fiscalYear: 2026 });
    // One print per file; an official print never expires.
    expect(await refusal(print(file, {}, { markReady: false }))).toMatch(
      /journal_book_prints_report_file_key|official journal-book file/,
    );
    expect(await refusal(change(file, { state: 'expired' }))).toMatch(
      /report_files_official_kept|past its time/,
    );
  });

  it('refuses an official file ready without its print, or with another file digest', async () => {
    const file = await officialFile();
    expect(await refusal(change(file, ready(file, null)))).toMatch(/ready with its print/);
    expect(await refusal(print(file, {}, { fileSha: 'd'.repeat(64) }))).toMatch(
      /ready with its print/,
    );
    expect(await refusal(print(file, {}, { markReady: false }))).toMatch(/ready with its print/);
    // A file refused by the worker fails with no print.
    await change(file, { state: 'failed', error: 'PERIOD_NOT_CLOSED' });
    expect(await stateOf(file)).toBe('failed');
    expect(await refusal(print(file))).toMatch(/official journal-book file/);
  });

  it('refuses a print of an open month, another fiscal year or a range out of order', async () => {
    expect(await refusal(print(await officialFile(), {}, { to: '2026-11' }))).toMatch(
      /PERIOD_NOT_CLOSED/,
    );
    expect(await refusal(print(await officialFile(), { fiscalYear: 2027 }))).toMatch(
      /months of its fiscal year/,
    );
    await closeMonthByHand(app, companyA, '2026-11');
    expect(
      await refusal(print(await officialFile(), {}, { from: '2026-11', to: '2026-10' })),
    ).toMatch(/in order/);
    // November closed: October and November print with the three entries' figures.
    await print(
      await officialFile(),
      { entryCount: 3, lineCount: 6, debitTotalMinor: 85_000n, creditTotalMinor: 85_000n },
      { to: '2026-11' },
    );
    // Reopened, November prints no more.
    await withCompany(app, companyA, (tx) =>
      writePeriodTransition(tx, {
        companyId: companyA,
        period: '2026-11',
        kind: 'reopened',
        reason: 'إعادة فتح تجريبية',
        userId: person,
        checklist: null,
      }),
    );
    expect(await refusal(print(await officialFile(), {}, { to: '2026-11' }))).toMatch(
      /PERIOD_NOT_CLOSED/,
    );
    // Closed again, a print of November records the reopen its snapshot saw, so the register
    // reads the earlier print as superseded whichever transaction committed first (rule 29).
    await closeMonthByHand(app, companyA, '2026-11');
    const november = {
      entryCount: 3,
      lineCount: 6,
      debitTotalMinor: 85_000n,
      creditTotalMinor: 85_000n,
    };
    expect(
      await refusal(
        print(await officialFile(), { ...november, reopensSeen: 0 }, { to: '2026-11' }),
      ),
    ).toMatch(/reopens of its months/);
    await print(await officialFile(), { ...november, reopensSeen: 1 }, { to: '2026-11' });
    expect(await refusal(print(await officialFile(), { reopensSeen: 1 }))).toMatch(
      /reopens of its months/,
    );
  });

  it('refuses counts or totals other than the months’ entries, and another person’s print', async () => {
    for (const values of [
      { entryCount: 3 },
      { lineCount: 5 },
      { debitTotalMinor: 75_001n, creditTotalMinor: 75_001n },
    ]) {
      expect(
        await refusal(print(await officialFile(), values)),
        Object.keys(values).join(),
      ).toMatch(/counts and totals/);
    }
    expect(await refusal(print(await officialFile(), { debitTotalMinor: 75_001n }))).toMatch(
      /journal_book_prints_totals|counts and totals/,
    );
    expect(await refusal(print(await officialFile(), { firstPage: 2, lastPage: 1 }))).toMatch(
      /journal_book_prints_pages/,
    );
    expect(await refusal(print(await officialFile(), { printedByUserId: uuidv7() }))).toMatch(
      /requester/,
    );
    expect(await refusal(print(await request()))).toMatch(/official journal-book file/);
  });

  it('is never changed or removed by any role', async () => {
    for (const db of [app, owner]) {
      for (const statement of [
        sql`update journal_book_prints set first_page = 2`,
        sql`delete from journal_book_prints`,
        sql`truncate journal_book_prints`,
      ]) {
        expect(await refusal(withCompany(db, companyA, (tx) => tx.execute(statement)))).toMatch(
          /permission denied|refused|append-only/,
        );
      }
    }
  });
});

describe('the jobs role', () => {
  it('finds every company’s files by their granted columns only, and changes none', async () => {
    const found = await jobs
      .select({ companyId: reportFiles.companyId, state: reportFiles.state })
      .from(reportFiles);
    expect(found.map((row) => row.companyId)).toEqual(expect.arrayContaining([companyA, companyB]));
    for (const statement of [
      'select params from report_files',
      'select storage_key from report_files',
      'select * from journal_book_prints',
      "update report_files set state = 'failed', error = 'X'",
    ]) {
      expect(await refusal(jobs.$client.query(statement)), statement).toMatch(/permission denied/);
    }
  });
});
