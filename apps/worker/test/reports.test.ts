import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ActiveReport, CompanyLedgers, RecordMovement } from '@vertex-mizan/contracts';
import {
  auditEntries,
  cancelMovement,
  chartAccounts,
  createCompanyBooks,
  createDatabase,
  createDimensionValue,
  createMaterial,
  createParty,
  createProject,
  type Database,
  type DocumentLineSpec,
  dimensionTypes,
  dimensionValues,
  entryDrafts,
  journalBookPrints,
  type MovementPrintReport,
  type PersonActor,
  type ProjectDocumentSpec,
  parseReportFileParams,
  post,
  postVoucher,
  projectDocuments,
  putProjectTerms,
  recordDayRates,
  recordMovement,
  recordRate,
  reportFiles,
  updateBranding,
  users,
  withCompany,
  writePeriodTransition,
} from '@vertex-mizan/db';
import { closeMonthByHand } from '@vertex-mizan/db/testing';
import { amountInWords, ar } from '@vertex-mizan/i18n';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { type Config, loadConfig } from '../src/core/config/config.js';
import { FileStore } from '../src/core/files/file-store.js';
import type { PdfPrinter, PrintOptions } from '../src/core/print/pdf-printer.js';
import { ReportsFilesExpireJob } from '../src/jobs/reports/files-expire.job.js';
import { RENDER_ATTEMPTS, ReportsRenderJob } from '../src/jobs/reports/render.job.js';

// S09's report jobs on the run's database (rules 28, 31, 36, "Jobs and events"): a render in one
// snapshot, written and ready for 24 hours; an official print with its register row and audit row
// in the render's transaction, the same content hash on a reprint, refused after a reopen; a draft
// of an open month; failures and the attempts limit; the hourly expiry. Chromium is replaced by a
// printer that keeps the HTML (its own check runs in `e2e/pdf.spec.ts`). All values are synthetic.

let db: Database;
let jobs: Database;
let config: Config;
let files: FileStore;
let person = '';

/**
 * Keeps every document it is given and answers a small PDF; `failNext` throws once; `whilePrinting`
 * runs while the render waits for it, as Chromium takes its time (a reopen committed meanwhile).
 */
class KeepingPrinter implements PdfPrinter {
  readonly printed: { html: string; options: PrintOptions }[] = [];
  failNext = false;
  whilePrinting: (() => Promise<unknown>) | null = null;

  async print(html: string, options: PrintOptions): Promise<Buffer> {
    if (this.whilePrinting) {
      const work = this.whilePrinting;
      this.whilePrinting = null;
      await work();
    }
    if (this.failNext) {
      this.failNext = false;
      throw Object.assign(new Error('Chromium crashed for a synthetic test'), {
        code: 'BROWSER_CLOSED',
      });
    }
    this.printed.push({ html, options });
    return Buffer.from(`%PDF-1.7 synthetic ${this.printed.length}`);
  }
}

const SYP: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: null,
};

const actor = (): PersonActor => ({
  kind: 'person',
  userId: person,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-worker-reports-test',
  ipAddress: null,
  userAgent: null,
});

/** A SYP company with two entries in October 2026, October closed, and one in November. */
async function company(): Promise<string> {
  const id = uuidv7();
  await withCompany(db, id, async (tx) => {
    await createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة تقارير تجريبية',
        nameLatin: null,
        ledgers: SYP,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'general',
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
  for (const [entryDate, amount] of [
    ['2026-10-08', 50_000n],
    ['2026-10-09', 25_000n],
    ['2026-11-08', 10_000n],
  ] as const) {
    await withCompany(db, id, async (tx) => {
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
    });
  }
  await closeMonthByHand(db, id, '2026-10');
  return id;
}

const ask = (companyId: string, values: Partial<typeof reportFiles.$inferInsert>) =>
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
      .returning()
      .then(([row]) => row as typeof reportFiles.$inferSelect),
  );

const fileOf = (companyId: string, id: string) =>
  withCompany(db, companyId, (tx) =>
    tx
      .select()
      .from(reportFiles)
      .where(eq(reportFiles.id, id))
      .then(([row]) => row as typeof reportFiles.$inferSelect),
  );

const official = (companyId: string, to = '2026-10') =>
  ask(companyId, {
    report: 'journal_book',
    params: { fiscalYear: 2026, from: '2026-10', to, ledger: 'book' },
    official: true,
  });

beforeAll(async () => {
  db = createDatabase(inject('appUrl'));
  jobs = createDatabase(inject('jobsUrl'));
  const directory = await mkdtemp(join(tmpdir(), 'mizan-worker-reports-'));
  config = loadConfig({
    DATABASE_QUEUE_URL: inject('queueUrl'),
    DATABASE_APP_URL: inject('appUrl'),
    DATABASE_JOBS_URL: inject('jobsUrl'),
    APP_URL: 'https://mizan.example.test',
    MIZAN_FILES_DIR: directory,
    SMTP_URL: 'smtp://127.0.0.1:1',
    EMAIL_FROM: 'Mizan <mizan@example.test>',
    NODE_ENV: 'test',
  });
  files = new FileStore(config);
  const [row] = await db
    .insert(users)
    .values({ email: 'worker.reports@example.test', name: 'محاسب تجريبي' })
    .returning({ id: users.id });
  person = row?.id as string;
});
afterAll(async () => {
  await db.$client.end();
  await jobs.$client.end();
});

const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');

describe('reports.render', () => {
  it('renders a report in one snapshot, ready for 24 hours, and does nothing the second time', async () => {
    const id = await company();
    const printer = new KeepingPrinter();
    const job = new ReportsRenderJob(db, files, printer);
    const file = await ask(id, {});
    expect(await job.work({ companyId: id, fileId: file.id })).toEqual({ state: 'ready' });
    const ready = await fileOf(id, file.id);
    const pdf = await readFile(join(config.filesDir, id, file.id));
    expect(ready).toMatchObject({
      state: 'ready',
      attempts: 1,
      sizeBytes: pdf.length,
      sha256: digest(pdf),
      storageKey: `${id}/${file.id}`,
    });
    const hours =
      ((ready.expiresAt as Date).getTime() - (ready.readyAt as Date).getTime()) / 3_600_000;
    expect(hours).toBe(24);
    const [document] = printer.printed;
    expect(document?.options).toEqual({ pageNumbers: 'صفحة {page} من {pages}' });
    expect(document?.html).toContain('ميزان المراجعة');
    expect(document?.html).toContain('شركة تقارير تجريبية');
    expect(document?.html).toContain('750.00');
    expect(document?.html).toContain('@font-face');

    expect(await job.work({ companyId: id, fileId: file.id })).toEqual({ state: 'done' });
    expect(printer.printed).toHaveLength(1);
  });

  it('prints an official journal book with its register row and audit row, the same content again', async () => {
    const id = await company();
    const printer = new KeepingPrinter();
    const job = new ReportsRenderJob(db, files, printer);
    const first = await official(id);
    expect(await job.work({ companyId: id, fileId: first.id })).toEqual({ state: 'ready' });
    const second = await official(id);
    expect(await job.work({ companyId: id, fileId: second.id })).toEqual({ state: 'ready' });
    const [one, two] = await withCompany(db, id, (tx) =>
      tx.select().from(journalBookPrints).orderBy(journalBookPrints.createdAt),
    );
    const ready = await fileOf(id, first.id);
    expect(ready.expiresAt).toBeNull();
    expect(one).toMatchObject({
      reportFileId: first.id,
      fiscalYear: 2026,
      firstPage: 1,
      lastPage: 1,
      entryCount: 2,
      lineCount: 4,
      debitTotalMinor: 75_000n,
      creditTotalMinor: 75_000n,
      fileSha256: ready.sha256,
      printedByUserId: person,
    });
    // A reprint of the same closed range proves the same content (rule 31).
    expect(two?.contentSha256).toBe(one?.contentSha256);
    expect(printer.printed[0]?.options).toEqual({ pageNumbers: null });
    expect(printer.printed[0]?.html).toContain('صفحة 1');
    expect(printer.printed[0]?.html).not.toContain('مسودة — غير رسمية');
    const audited = await withCompany(db, id, (tx) =>
      tx
        .select({ action: auditEntries.action })
        .from(auditEntries)
        .where(eq(auditEntries.action, 'journal_book.printed')),
    );
    expect(audited).toHaveLength(2);
  });

  it('refuses an official print whose month was reopened, and prints a draft of an open month', async () => {
    const id = await company();
    const printer = new KeepingPrinter();
    const job = new ReportsRenderJob(db, files, printer);
    const file = await official(id);
    await withCompany(db, id, (tx) =>
      writePeriodTransition(tx, {
        companyId: id,
        period: '2026-10',
        kind: 'reopened',
        reason: 'إعادة فتح تجريبية',
        userId: person,
        checklist: null,
      }),
    );
    expect(await job.work({ companyId: id, fileId: file.id })).toEqual({ state: 'failed' });
    expect(await fileOf(id, file.id)).toMatchObject({
      state: 'failed',
      error: 'PERIOD_NOT_CLOSED',
    });
    expect(printer.printed).toEqual([]);
    expect(await withCompany(db, id, (tx) => tx.select().from(journalBookPrints))).toEqual([]);

    const draft = await ask(id, {
      report: 'journal_book',
      params: { fiscalYear: 2026, from: '2026-10', to: '2026-11', ledger: 'book' },
    });
    expect(await job.work({ companyId: id, fileId: draft.id })).toEqual({ state: 'ready' });
    expect(printer.printed[0]?.html).toContain('مسودة — غير رسمية');
    expect(await withCompany(db, id, (tx) => tx.select().from(journalBookPrints))).toEqual([]);
  });

  it('fails a render that throws, with its code and no file, and a file that keeps dying', async () => {
    const id = await company();
    const printer = new KeepingPrinter();
    const job = new ReportsRenderJob(db, files, printer);
    const file = await ask(id, {});
    printer.failNext = true;
    expect(await job.work({ companyId: id, fileId: file.id })).toEqual({ state: 'failed' });
    // A failure that is not an error code of the registry keeps `RENDER_FAILED`, never its own.
    expect(await fileOf(id, file.id)).toMatchObject({ state: 'failed', error: 'RENDER_FAILED' });
    expect(await files.size(id, file.id)).toBeNull();

    const dying = await ask(id, {});
    await withCompany(db, id, (tx) =>
      tx.update(reportFiles).set({ attempts: RENDER_ATTEMPTS }).where(eq(reportFiles.id, dying.id)),
    );
    expect(await job.work({ companyId: id, fileId: dying.id })).toEqual({ state: 'failed' });
    expect(await fileOf(id, dying.id)).toMatchObject({ state: 'failed', error: 'RENDER_FAILED' });
  });

  it('fails an official print with PERIOD_NOT_CLOSED when its month is reopened while it prints', async () => {
    const id = await company();
    const printer = new KeepingPrinter();
    const job = new ReportsRenderJob(db, files, printer);
    const file = await official(id);
    printer.whilePrinting = () =>
      withCompany(db, id, (tx) =>
        writePeriodTransition(tx, {
          companyId: id,
          period: '2026-10',
          kind: 'reopened',
          reason: 'إعادة فتح أثناء الطباعة',
          userId: person,
          checklist: null,
        }),
      );
    expect(await job.work({ companyId: id, fileId: file.id })).toEqual({ state: 'failed' });
    expect(await fileOf(id, file.id)).toMatchObject({
      state: 'failed',
      error: 'PERIOD_NOT_CLOSED',
    });
    expect(await files.size(id, file.id)).toBeNull();
    expect(await withCompany(db, id, (tx) => tx.select().from(journalBookPrints))).toEqual([]);
  });

  it('renders every report from the parameters the API stores, as the query string carries them', async () => {
    const id = await company();
    const printer = new KeepingPrinter();
    const job = new ReportsRenderJob(db, files, printer);
    const [cash, client] = await withCompany(db, id, async (tx) => {
      const [account] = await tx
        .select({ id: chartAccounts.id })
        .from(chartAccounts)
        .where(eq(chartAccounts.code, '111003'));
      const [type] = await tx
        .select({ id: dimensionTypes.id })
        .from(dimensionTypes)
        .where(eq(dimensionTypes.code, 'client'));
      const [value] = await tx
        .insert(dimensionValues)
        .values({ companyId: id, typeId: type?.id as string, name: 'عميل تجريبي' })
        .returning({ id: dimensionValues.id });
      return [account?.id as string, value?.id as string];
    });
    const asked = {
      trial_balance: { from: '2026-10-01', to: '2026-10-31', nonZero: 'false', level: '2' },
      general_ledger: { from: '2026-10-01', to: '2026-10-31', cursor: 'dropped' },
      account_statement: { account: cash, from: '2026-10-01', to: '2026-10-31', dims: '' },
      journal_book: { fiscalYear: '2026', from: '2026-10', to: '2026-11' },
      income_statement: { from: '2026-10-01', to: '2026-10-31', compare: 'false' },
      balance_sheet: { asOf: '2026-10-31' },
      profitability: { by: 'client', from: '2026-10-01', to: '2026-10-31' },
      ageing: { asOf: '2026-10-31' },
      client_statement: { client, from: '2026-10-01', to: '2026-10-31' },
      chart: {},
      // The cash reports print from a contracting company's vouchers: their own test below.
      // The project reports print from a project's documents: their own test below.
      // S13's three PDFs print from a company's movements: their own test below.
    } satisfies Record<
      Exclude<ActiveReport, CashReport | ProjectReportFile | MovementPrintReport>,
      Record<string, string>
    >;
    for (const [report, input] of Object.entries(asked) as [
      ActiveReport,
      Record<string, string>,
    ][]) {
      const file = await ask(id, { report, params: parseReportFileParams(report, input).stored });
      expect(await job.work({ companyId: id, fileId: file.id }), report).toEqual({
        state: 'ready',
      });
    }
    expect(printer.printed).toHaveLength(10);
  });
});

type CashReport = 'cash_position' | 'cash_statement' | 'voucher';

/** The client's shape (S11): a USD book at market accepting dealt rates, an SYP parallel. */
const CLIENT: CompanyLedgers = {
  book: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
  parallel: {
    currency: 'SYP',
    ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
  },
};

/** A contracting company whose USD box `111002` received 1,500.00 by a receipt on 2026-12-02. */
async function cashCompany(): Promise<{ id: string; box: string; voucher: string }> {
  const id = uuidv7();
  const accounts = await withCompany(db, id, async (tx) => {
    await createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة مقاولات تجريبية',
        nameLatin: null,
        ledgers: CLIENT,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'contracting',
        createdByUserId: person,
      },
      actor(),
    );
    // The bulletin is daily (S02 rule 16): the receipt's own day.
    await recordRate(tx, id, actor(), {
      effectiveOn: '2026-12-02',
      base: 'USD',
      quote: 'SYP',
      rate: '120.0000',
      type: 'bulletin',
      source: 'manual',
    });
    const rows = await tx
      .select({ id: chartAccounts.id, code: chartAccounts.code })
      .from(chartAccounts);
    return new Map(rows.map((row) => [row.code, row.id]));
  });
  const box = accounts.get('111002') as string;
  const voucher = await withCompany(db, id, async (tx) => {
    const draftId = uuidv7();
    await tx.insert(entryDrafts).values({
      id: draftId,
      companyId: id,
      state: 'draft',
      entryDate: '2026-12-02',
      description: 'إيداع رأس مال تجريبي',
      preparedByUserId: person,
      voucherKind: 'receipt',
      cashAccountId: box,
      partyName: 'شريك تجريبي',
    });
    const posted = await postVoucher(tx, {
      client: 'manual',
      idempotencyKey: draftId,
      entryDate: '2026-12-02',
      description: 'إيداع رأس مال تجريبي',
      reference: null,
      draftId,
      preparedByUserId: person,
      approvedByUserId: null,
      actor: actor(),
      voucher: {
        kind: 'receipt',
        cashAccountId: box,
        counterCashAccountId: null,
        partyName: 'شريك تجريبي',
        countedMinor: null,
        expectedMinor: null,
      },
      lines: [
        {
          accountId: box,
          dimensionValueIds: [],
          currency: 'USD',
          amountMinor: 150_000n,
          memo: null,
        },
        {
          accountId: accounts.get('311001') as string,
          dimensionValueIds: [],
          currency: 'USD',
          amountMinor: -150_000n,
          memo: null,
        },
      ],
      dealtRates: [],
      today: '2026-12-31',
    });
    await tx
      .update(entryDrafts)
      .set({ state: 'posted', postedEntryId: posted.entry?.id ?? null })
      .where(eq(entryDrafts.id, draftId));
    return posted.id;
  });
  return { id, box, voucher };
}

describe('reports.render of the cash reports (S11)', () => {
  it('prints the cash position, a box statement and a voucher in Arabic with its amount in words', async () => {
    const { id, box, voucher } = await cashCompany();
    const printer = new KeepingPrinter();
    const job = new ReportsRenderJob(db, files, printer);
    const asked = {
      cash_position: { asOf: '2026-12-31' },
      cash_statement: {
        account: box,
        from: '2026-12-01',
        to: '2026-12-31',
        ledgers: 'book,parallel',
      },
      voucher: { voucher },
    } satisfies Record<CashReport, Record<string, string>>;
    for (const [report, input] of Object.entries(asked) as [CashReport, Record<string, string>][]) {
      const file = await ask(id, { report, params: parseReportFileParams(report, input).stored });
      expect(await job.work({ companyId: id, fileId: file.id }), report).toEqual({
        state: 'ready',
      });
    }
    const [position, statement, printed] = printer.printed;
    expect(position?.html).toContain('المركز النقدي');
    expect(position?.html).toContain('1,500.00');
    expect(statement?.html).toContain('كشف صندوق: 111002');
    expect(statement?.html).toContain('سند قبض 2026/1');
    expect(statement?.html).toContain('180,000.00');
    expect(printed?.html).toContain('size: A5 portrait');
    expect(printed?.html).toContain('فقط ألف وخمسمئة دولار أمريكي لا غير');
    expect(printed?.html).toContain('شريك تجريبي');
    expect(printed?.html).toContain('311001');
    expect(printed?.html).toContain('محاسب تجريبي');
    // The voucher numbers its own page: no footer.
    expect(printed?.options).toEqual({ pageNumbers: null });
  });
});

type ProjectReportFile = 'project_report' | 'material_quantities' | 'project_document';

/**
 * A contracting company with project P1 (USD terms, a 511001 budget), C1's 20,000.00 USD advance
 * on 2 November, S1's TRY invoice of cement on 3 December and billing 1 (cumulative 30,000.00) on
 * the 31st: `reports/project-report.md`'s December in short.
 */
async function projectCompany(): Promise<{
  id: string;
  project: string;
  purchase: string;
  billing: string;
}> {
  const id = uuidv7();
  return withCompany(db, id, async (tx) => {
    await createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة مقاولات تجريبية',
        nameLatin: null,
        ledgers: CLIENT,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'contracting',
        createdByUserId: person,
      },
      actor(),
    );
    for (const [effectiveOn, base, quote, rate, type] of [
      ['2026-11-02', 'USD', 'SYP', '115.0000', 'bulletin'],
      ['2026-12-03', 'TRY', 'SYP', '3.5000', 'bulletin'],
      ['2026-12-03', 'USD', 'TRY', '34.0000', 'market'],
      ['2026-12-31', 'USD', 'SYP', '120.0000', 'bulletin'],
    ] as const) {
      await recordRate(tx, id, actor(), { effectiveOn, base, quote, rate, type, source: 'manual' });
    }
    const types = new Map(
      (
        await tx.select({ id: dimensionTypes.id, code: dimensionTypes.code }).from(dimensionTypes)
      ).map((row) => [row.code, row.id]),
    );
    const value = async (type: string, code: string, extra: object = {}) =>
      (
        await createDimensionValue(
          tx,
          id,
          {
            typeId: types.get(type) as string,
            code,
            name: `${code} تجريبي`,
            nameLatin: null,
            contractKind: null,
            parentValueId: null,
            ...extra,
          },
          actor(),
        )
      ).id;
    const client = await value('client', 'C1');
    const project = await value('contract', 'P1', {
      contractKind: 'project',
      parentValueId: client,
    });
    const supplier = await value('supplier', 'S1');
    const cement = (
      await createMaterial(
        tx,
        id,
        { code: 'CEM', name: 'أسمنت بورتلاندي', nameLatin: null, unit: 'طن' },
        actor(),
      )
    ).id;
    const accounts = new Map(
      (await tx.select({ id: chartAccounts.id, code: chartAccounts.code }).from(chartAccounts)).map(
        (row) => [row.code, row.id],
      ),
    );
    const account = (code: string) => accounts.get(code) as string;
    await putProjectTerms(
      tx,
      id,
      project,
      {
        currency: 'USD',
        contractValueMinor: '10000000',
        retentionBp: 1000,
        advanceRecoveryBp: 2000,
        budget: [{ accountId: account('511001'), amountMinor: '4000000' }],
      },
      actor(),
    );
    const request = (on: string, draftId: string | null) => ({
      client: 'manual' as const,
      idempotencyKey: draftId ?? uuidv7(),
      entryDate: on,
      description: 'قيد تجريبي',
      reference: null,
      draftId,
      preparedByUserId: person,
      approvedByUserId: null,
      actor: actor(),
    });
    await post(tx, {
      ...request('2026-11-02', null),
      content: {
        kind: 'manual',
        today: '2026-12-31',
        dealtRates: [],
        lines: [
          {
            accountId: account('111004'),
            dimensionValueIds: [],
            currency: 'USD',
            amountMinor: 2000000n,
            memo: null,
          },
          {
            accountId: account('212002'),
            dimensionValueIds: [client, project],
            currency: 'USD',
            amountMinor: -2000000n,
            memo: null,
          },
        ],
      },
    });
    const documentOf = async (
      on: string,
      document: ProjectDocumentSpec,
      lines: DocumentLineSpec[],
    ): Promise<string> => {
      const draftId = uuidv7();
      await tx.insert(entryDrafts).values({
        id: draftId,
        companyId: id,
        state: 'draft',
        entryDate: on,
        description: 'مستند مشروع تجريبي',
        preparedByUserId: person,
        projectDocumentKind: document.kind,
        contractValueId: document.contractValueId,
        counterpartyValueId: document.counterpartyValueId,
        documentCurrency: document.currency,
        cumulativeMinor: document.cumulativeMinor,
        supplierReference: document.supplierReference,
      });
      const entry = await post(tx, {
        ...request(on, draftId),
        content: { kind: 'project_document', today: '2026-12-31', document, lines },
      });
      await tx
        .update(entryDrafts)
        .set({ state: 'posted', postedEntryId: entry.id })
        .where(eq(entryDrafts.id, draftId));
      const [row] = await tx
        .select({ id: projectDocuments.id })
        .from(projectDocuments)
        .where(eq(projectDocuments.entryId, entry.id));
      return row?.id as string;
    };
    const header = {
      contractValueId: project,
      side: null,
      periodFrom: null,
      periodTo: null,
      retentionMinor: null,
      advanceMinor: null,
    } as const;
    const purchase = await documentOf(
      '2026-12-03',
      {
        ...header,
        kind: 'purchase',
        counterpartyValueId: supplier,
        currency: 'TRY',
        cumulativeMinor: null,
        supplierReference: 'F-1024',
      },
      [
        {
          accountId: account('511001'),
          dimensionValueIds: [],
          amountMinor: null,
          memo: null,
          quantity: { materialId: cement, unit: 'طن', quantity: '12.500', unitPrice: '3150.0000' },
          advanceMinor: null,
        },
      ],
    );
    const billing = await documentOf(
      '2026-12-31',
      {
        ...header,
        kind: 'progress_billing',
        counterpartyValueId: null,
        currency: null,
        cumulativeMinor: 3000000n,
        supplierReference: null,
      },
      [],
    );
    return { id, project, purchase, billing };
  });
}

describe('reports.render of the project reports and documents (S12)', () => {
  it('prints the project report, the material quantities, a purchase and a billing', async () => {
    const { id, project, purchase, billing } = await projectCompany();
    const printer = new KeepingPrinter();
    const job = new ReportsRenderJob(db, files, printer);
    const asked: [ProjectReportFile, Record<string, string>][] = [
      ['project_report', { contract: project, from: '2026-12-01', to: '2026-12-31' }],
      ['material_quantities', { from: '2026-12-01', to: '2026-12-31', ledger: 'parallel' }],
      ['project_document', { document: purchase }],
      ['project_document', { document: billing }],
    ];
    for (const [report, input] of asked) {
      const file = await ask(id, { report, params: parseReportFileParams(report, input).stored });
      expect(await job.work({ companyId: id, fileId: file.id }), report).toEqual({
        state: 'ready',
      });
    }
    const [report, quantities, invoice, certified] = printer.printed;
    expect(report?.html).toContain('تقرير المشروع');
    expect(report?.html).toContain('التكاليف والموازنة');
    // 39,375.00 TRY = 1,158.09 USD of cement; billing 1's net, 21,000.00.
    expect(report?.html).toContain('1,158.09');
    expect(report?.html).toContain('21,000.00');
    expect(report?.options).toEqual({ pageNumbers: ar.reports.pageOf });
    // In the parallel ledger: 39,375.00 × 3.5 = 137,812.50 SYP, the new pound.
    expect(quantities?.html).toContain('137,812.50');
    expect(quantities?.html).toContain('الليرة السورية الجديدة');
    expect(invoice?.html).toContain('size: A5 portrait');
    expect(invoice?.html).toContain('F-1024');
    expect(invoice?.html).toContain('12.500');
    expect(invoice?.html).toContain('محاسب تجريبي');
    expect(certified?.html).toContain('size: A4 portrait');
    expect(certified?.html).toContain(ar.reports.projectDocument.kinds.progress_billing);
    expect(certified?.html).toContain('21,000.00');
    expect(certified?.html).toContain(amountInWords(2100000n, 'USD'));
    for (const label of ar.reports.projectDocument.signatures.billing) {
      expect(certified?.html).toContain(label);
    }
  });
});

/** S13: a USD company with a project, its movements (one cancelled) and a logo. */
async function movementsCompany(): Promise<{ id: string; project: string; logo: Buffer }> {
  const id = uuidv7();
  const today = '2026-12-31';
  // A 1 × 1 PNG, synthetic.
  const logo = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const logoId = uuidv7();
  await files.write(id, logoId, Readable.from([logo]));
  const project = await withCompany(db, id, async (tx) => {
    await createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة مقاولات تجريبية',
        nameLatin: null,
        ledgers: {
          book: {
            currency: 'USD',
            ratePolicy: { rateType: 'market', acceptsTransactionRate: true },
          },
          parallel: null,
        },
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'contracting',
        createdByUserId: person,
      },
      actor(),
    );
    await recordDayRates(tx, id, actor(), {
      date: '2026-12-01',
      rates: [
        { base: 'USD', quote: 'SYP', rate: '118.5' },
        { base: 'USD', quote: 'TRY', rate: '41' },
      ],
      reason: null,
    });
    const project = await createProject(tx, id, actor(), {
      name: 'فيلا تجريبية',
      clientId: null,
      clientName: 'عميل تجريبي',
      startDate: '2026-12-01',
      contractValue: { amountMinor: '2000000', currency: 'USD' },
    });
    const supplier = await createParty(tx, id, actor(), { type: 'supplier', name: 'مورد تجريبي' });
    const steel = (
      await createMaterial(
        tx,
        id,
        { code: 'STL', name: 'حديد تسليح', nameLatin: null, unit: 'طن' },
        actor(),
      )
    ).id;
    const context = { companyId: id, actor: actor(), today };
    const movement = (fields: Partial<RecordMovement>): RecordMovement => ({
      requestKey: uuidv7(),
      kind: 'received',
      date: '2026-12-01',
      projectId: project,
      supplierId: null,
      currency: 'USD',
      amountMinor: null,
      material: null,
      description: 'حركة تجريبية',
      dealtRate: null,
      ...fields,
    });
    await recordMovement(tx, context, movement({ kind: 'received', amountMinor: '500000' }));
    await recordMovement(
      tx,
      context,
      movement({
        kind: 'expense',
        material: { materialId: steel, quantity: '2.500', unitPrice: '820.0000' },
      }),
    );
    await recordMovement(
      tx,
      context,
      movement({
        kind: 'owed_by_us',
        supplierId: supplier,
        currency: 'TRY',
        amountMinor: '4100000',
      }),
    );
    const wages = await recordMovement(
      tx,
      context,
      movement({ kind: 'wages', amountMinor: '30000', description: 'أجور خطأ' }),
    );
    await cancelMovement(tx, context, wages, { reason: 'سُجّلت خطأً' });
    await updateBranding(tx, id, actor(), {
      displayName: 'مقاولات الشعار التجريبية',
      logo: {
        storageKey: `${id}/${logoId}`,
        contentType: 'image/png',
        sha256: createHash('sha256').update(logo).digest('hex'),
      },
    });
    return project;
  });
  return { id, project, logo };
}

describe('reports.render of the project movements (S13)', () => {
  it('prints all projects, one project and the materials under the company name and logo', async () => {
    const { id, project, logo } = await movementsCompany();
    const printer = new KeepingPrinter();
    const job = new ReportsRenderJob(db, files, printer);
    const asked: [MovementPrintReport, Record<string, string>][] = [
      ['projects_overview', {}],
      ['project_statement', { project }],
      ['material_costs', { project, from: '2026-12-01', to: '2026-12-31' }],
    ];
    for (const [report, input] of asked) {
      const file = await ask(id, { report, params: parseReportFileParams(report, input).stored });
      expect(await job.work({ companyId: id, fileId: file.id }), report).toEqual({
        state: 'ready',
      });
    }
    const [overview, statement, materials] = printer.printed;
    for (const printed of [overview, statement, materials]) {
      const header = printed?.options.pageHeader ?? '';
      expect(printed?.options.pageNumbers).toBe(ar.reports.pageOf);
      expect(header).toContain('مقاولات الشعار التجريبية');
      expect(header).toContain(`data:image/png;base64,${logo.toString('base64')}`);
      // No mark of the product (ADR 0024 §8).
      for (const text of [printed?.html ?? '', header]) {
        expect(text).not.toContain('Vertex');
        expect(text).not.toContain(ar.common.productName);
      }
    }
    expect(overview?.html).toContain(ar.reports.names.projects_overview);
    expect(overview?.html).toContain('فيلا تجريبية');
    // Received 5,000.00; the steel 2.500 × 820.0000 = 2,050.00; 41,000.00 TRY = 1,000.00 USD.
    expect(overview?.html).toContain('5,000.00');
    expect(overview?.html).toContain('2,050.00');
    expect(overview?.html).toContain('41,000.00');
    expect(overview?.html).toContain('مورد تجريبي');
    expect(overview?.html).toContain('سُجّلت خطأً');
    expect(overview?.html).toContain(ar.movements.print.rates);
    expect(statement?.html).toContain('عميل تجريبي');
    expect(statement?.html).toContain('20,000.00');
    expect(statement?.html).not.toContain(ar.movements.print.rates);
    expect(materials?.html).toContain('حديد تسليح');
    expect(materials?.html).toContain('2.500');
    expect(materials?.options.pageHeader).toContain('2026-12-01 – 2026-12-31');
  });
});

describe('reports.files-expire', () => {
  it('expires ready files past their time, keeps an official print, fails a file the queue lost', async () => {
    const id = await company();
    const render = new ReportsRenderJob(db, files, new KeepingPrinter());
    // A file made ready two days ago, its 24 hours over.
    const old = await ask(id, {});
    const pdf = Buffer.from('%PDF-1.7 synthetic old');
    await files.write(id, old.id, Readable.from([pdf]));
    await withCompany(db, id, (tx) =>
      tx
        .update(reportFiles)
        .set({
          state: 'ready',
          storageKey: `${id}/${old.id}`,
          sizeBytes: pdf.length,
          sha256: digest(pdf),
          readyAt: new Date(Date.now() - 48 * 3_600_000),
          expiresAt: new Date(Date.now() - 24 * 3_600_000),
        })
        .where(eq(reportFiles.id, old.id)),
    );
    const kept = await official(id);
    await render.work({ companyId: id, fileId: kept.id });
    const fresh = await ask(id, {});
    await render.work({ companyId: id, fileId: fresh.id });
    // A file asked two hours ago whose job the queue lost.
    const lost = await ask(id, { createdAt: new Date(Date.now() - 2 * 3_600_000) });
    const waiting = await ask(id, {});

    const job = new ReportsFilesExpireJob(jobs, db, files);
    const result = await job.run();
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(result.lost).toBeGreaterThanOrEqual(1);
    expect(await fileOf(id, old.id)).toMatchObject({ state: 'expired', sha256: digest(pdf) });
    expect(await files.size(id, old.id)).toBeNull();
    expect(await fileOf(id, kept.id)).toMatchObject({ state: 'ready' });
    expect(await fileOf(id, fresh.id)).toMatchObject({ state: 'ready' });
    expect(await fileOf(id, lost.id)).toMatchObject({ state: 'failed', error: 'RENDER_LOST' });
    expect(await fileOf(id, waiting.id)).toMatchObject({ state: 'queued' });
    expect(await job.run()).toEqual({ expired: 0, lost: 0 });
  });
});
