import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { CompanyLedgers } from '@vertex-mizan/contracts';
import {
  auditEntries,
  chartAccounts,
  createCompanyBooks,
  createDatabase,
  type Database,
  journalBookPrints,
  type PersonActor,
  post,
  recordRate,
  reportFiles,
  users,
  withCompany,
  writePeriodTransition,
} from '@vertex-mizan/db';
import { closeMonthByHand } from '@vertex-mizan/db/testing';
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

/** Keeps every document it is given and answers a small PDF; `failNext` throws once. */
class KeepingPrinter implements PdfPrinter {
  readonly printed: { html: string; options: PrintOptions }[] = [];
  failNext = false;

  async print(html: string, options: PrintOptions): Promise<Buffer> {
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
    expect(await fileOf(id, file.id)).toMatchObject({ state: 'failed', error: 'BROWSER_CLOSED' });
    expect(await files.size(id, file.id)).toBeNull();

    const dying = await ask(id, {});
    await withCompany(db, id, (tx) =>
      tx.update(reportFiles).set({ attempts: RENDER_ATTEMPTS }).where(eq(reportFiles.id, dying.id)),
    );
    expect(await job.work({ companyId: id, fileId: dying.id })).toEqual({ state: 'failed' });
    expect(await fileOf(id, dying.id)).toMatchObject({ state: 'failed', error: 'RENDER_FAILED' });
  });

  it('renders every other report and the receivables and the chart', async () => {
    const id = await company();
    const printer = new KeepingPrinter();
    const job = new ReportsRenderJob(db, files, printer);
    const cash = await withCompany(db, id, (tx) =>
      tx
        .select({ id: chartAccounts.id })
        .from(chartAccounts)
        .where(eq(chartAccounts.code, '111003'))
        .then(([row]) => row?.id as string),
    );
    for (const [report, params] of [
      ['general_ledger', { from: '2026-10-01', to: '2026-10-31' }],
      ['account_statement', { account: cash, from: '2026-10-01', to: '2026-10-31' }],
      ['income_statement', { from: '2026-10-01', to: '2026-10-31' }],
      ['balance_sheet', { asOf: '2026-10-31' }],
      ['profitability', { by: 'client', from: '2026-10-01', to: '2026-10-31' }],
      ['contract_position', { asOf: '2026-10-31' }],
      ['revenue_schedule', { from: '2026-10' }],
      ['ageing', { asOf: '2026-10-31' }],
      ['chart', {}],
    ] as const) {
      const file = await ask(id, { report, params });
      expect(await job.work({ companyId: id, fileId: file.id }), report).toEqual({
        state: 'ready',
      });
    }
    expect(printer.printed).toHaveLength(9);
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
