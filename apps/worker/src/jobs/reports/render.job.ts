import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ActiveReport,
  type CurrencyCode,
  canonicalPayload,
  errorStatus,
  journalBookQuerySchema,
  REPORT_FILE_QUERIES,
  REPORT_FILE_TTL_HOURS,
  REPORTS_RENDER_QUEUE,
  reportsRenderJobSchema,
} from '@vertex-mizan/contracts';
import {
  type AuditActor,
  companies,
  companySettings,
  countRangeReopens,
  type Database,
  describeForLog,
  journalBookPrints,
  MOVEMENT_PRINT_REPORTS,
  type MovementPrintReport,
  readBranding,
  readJournalBook,
  readJournalBookTotals,
  readMaterialCosts,
  readProjectDocumentPrint,
  readProjectStatementPrint,
  readProjectsOverviewPrint,
  readRangePeriods,
  readReportAnswer,
  readVoucherPrint,
  reportFiles,
  SYSTEM_NAME,
  type Transaction,
  withCompany,
  writeCompanyAudit,
} from '@vertex-mizan/db';
import { amountInWords, ar } from '@vertex-mizan/i18n';
import {
  entryNumberText,
  formatProducedAt,
  type MovementsPrintData,
  movementsPageHeader,
  printedCurrency,
  printFontFaces,
  renderJournalBookHtml,
  renderMovementsHtml,
  renderProjectDocumentHtml,
  renderReportHtml,
  renderVoucherHtml,
  reportSheet,
} from '@vertex-mizan/ui/print';
import { and, eq, sql } from 'drizzle-orm';
import { todayInDamascus } from '../../core/clock/today.js';
import { DATABASE } from '../../core/database/database.module.js';
import { FileStore } from '../../core/files/file-store.js';
import { PDF_PRINTER, type PdfPrinter } from '../../core/print/pdf-printer.js';
import type { QueueWorker } from '../../core/queue/scheduled-job.js';

/** Renders a file may start: one that keeps dying (a crash, a kill) is then marked failed. */
export const RENDER_ATTEMPTS = 3;

/** How long a render may read in its snapshot and stay open while Chromium prints. */
const RENDER_TIMEOUT = '15min';

/**
 * The code a failed render keeps, never its message: an error code of the registry, or
 * `RENDER_FAILED` for anything else (a crash of Chromium, a database error).
 */
export function renderFailureCode(error: unknown, official: boolean): string {
  const failure = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = failure?.code ?? failure?.cause?.code;
  // An official print whose month was reopened after its snapshot: the register's guard refuses it
  // (restrict_violation), or its lock on the period row meets the reopen (serialization failure).
  if (official && (code === '40001' || code === '23001')) return 'PERIOD_NOT_CLOSED';
  return typeof code === 'string' && Object.hasOwn(errorStatus, code) ? code : 'RENDER_FAILED';
}

const renderActor: AuditActor = {
  kind: 'system',
  name: SYSTEM_NAME,
  requestId: `job:${REPORTS_RENDER_QUEUE}`,
  ipAddress: null,
  userAgent: null,
};

const SHEET_TEXT = {
  reports: ar.reports,
  accounting: ar.accounting,
  openItems: ar.openItems,
  chart: ar.chart,
  cash: ar.cash,
};

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/**
 * `reports.render` (S09 rule 36, "Jobs and events"): the API sends it once a file's row commits.
 * The file is claimed (its attempt counted, so one that keeps killing the worker fails at the
 * third), then, as the app role in its company, read in one repeatable-read snapshot under a
 * skip-locked row lock, rendered by `@vertex-mizan/ui/print` and printed by Chromium; its PDF is
 * written under its key and the row marked `ready` (24 hours, an official print kept). An official
 * print (rule 28) is refused `PERIOD_NOT_CLOSED` when a month of its range is no longer closed in
 * the snapshot; otherwise its register row and `journal_book.printed` are written in the same
 * transaction, its `content_sha256` the SHA-256 of the pages' RFC 8785 JSON (rule 31). Safe twice:
 * a file that is not queued is skipped, and the register's row is unique per file.
 */
@Injectable()
export class ReportsRenderJob implements QueueWorker {
  readonly queue = REPORTS_RENDER_QUEUE;
  readonly queueOptions = { retryLimit: 2, retryDelay: 30, retryBackoff: true };
  private readonly logger = new Logger(ReportsRenderJob.name);
  private fonts: string | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FileStore) private readonly files: FileStore,
    @Inject(PDF_PRINTER) private readonly printer: PdfPrinter,
  ) {}

  async work(data: unknown): Promise<{ state: string }> {
    const { companyId, fileId } = reportsRenderJobSchema.parse(data);
    const claim = await this.claim(companyId, fileId);
    if (claim !== 'claimed') {
      if (claim === 'failed') await this.files.removePartials(companyId, fileId);
      return { state: claim };
    }
    try {
      return { state: await this.render(companyId, fileId) };
    } catch (error) {
      this.logger.error(`File ${fileId} failed: ${describeForLog(error)}`);
      await this.files.remove(companyId, fileId);
      await this.files.removePartials(companyId, fileId);
      await this.fail(companyId, fileId, error);
      return { state: 'failed' };
    }
  }

  /** Counts the attempt in its own transaction; at the limit the file fails instead. */
  private claim(companyId: string, fileId: string): Promise<string> {
    return withCompany(this.db, companyId, async (tx) => {
      const [row] = await tx
        .select({ state: reportFiles.state, attempts: reportFiles.attempts })
        .from(reportFiles)
        .where(eq(reportFiles.id, fileId))
        .for('update', { skipLocked: true });
      if (!row) return 'busy';
      if (row.state !== 'queued') return 'done';
      if (row.attempts >= RENDER_ATTEMPTS) {
        await tx
          .update(reportFiles)
          .set({ state: 'failed', error: 'RENDER_FAILED' })
          .where(eq(reportFiles.id, fileId));
        return 'failed';
      }
      await tx
        .update(reportFiles)
        .set({ attempts: row.attempts + 1 })
        .where(eq(reportFiles.id, fileId));
      return 'claimed';
    });
  }

  private fail(companyId: string, fileId: string, error: unknown): Promise<unknown> {
    return withCompany(this.db, companyId, async (tx) => {
      const [row] = await tx
        .select({ official: reportFiles.official })
        .from(reportFiles)
        .where(eq(reportFiles.id, fileId));
      await tx
        .update(reportFiles)
        .set({ state: 'failed', error: renderFailureCode(error, row?.official ?? false) })
        .where(and(eq(reportFiles.id, fileId), eq(reportFiles.state, 'queued')));
    });
  }

  private render(companyId: string, fileId: string): Promise<string> {
    return withCompany(
      this.db,
      companyId,
      async (tx) => {
        await tx.execute(sql`set local statement_timeout = ${sql.raw(`'${RENDER_TIMEOUT}'`)}`);
        await tx.execute(
          sql`set local idle_in_transaction_session_timeout = ${sql.raw(`'${RENDER_TIMEOUT}'`)}`,
        );
        const [row] = await tx
          .select()
          .from(reportFiles)
          .where(and(eq(reportFiles.id, fileId), eq(reportFiles.state, 'queued')))
          .for('update', { skipLocked: true });
        if (!row) return 'done';
        const now = new Date();
        const [company] = await tx
          .select({ name: companies.name })
          .from(companies)
          .where(eq(companies.id, companyId));
        const [settings] = await tx
          .select({ startMonth: companySettings.fiscalYearStartMonth })
          .from(companySettings);
        if (!company || !settings) throw new Error('A company without its settings');
        const report = row.report as ActiveReport;
        let pdf: Buffer;
        let print: OfficialPrint | null = null;
        if (report === 'journal_book') {
          const params = journalBookQuerySchema.parse(row.params);
          const book = await readJournalBook(tx, params, now);
          if (row.official && !book.official) {
            await tx
              .update(reportFiles)
              .set({ state: 'failed', error: 'PERIOD_NOT_CLOSED' })
              .where(eq(reportFiles.id, fileId));
            return 'failed';
          }
          const currency = book.header.currency as CurrencyCode;
          const html = renderJournalBookHtml({
            company: company.name,
            fiscalYear: String(params.fiscalYear),
            currency,
            currencyLabel: printedCurrency(currency, SHEET_TEXT),
            pages: book.pages,
            text: {
              ...ar.reports.journalBook,
              fiscalYear: ar.reports.header.fiscalYear,
              currency: ar.reports.header.currency,
              columns: ar.reports.columns,
            },
            entryNumber: (number) =>
              entryNumberText({ fiscalYear: params.fiscalYear, number }, settings.startMonth),
            ...(row.official ? {} : { draft: ar.reports.draft }),
            fontFaces: this.fontFaces(),
          });
          pdf = await this.printer.print(html, { pageNumbers: null });
          if (row.official) {
            print = {
              content: sha256(canonicalPayload(book.pages)),
              range: { fiscalYear: params.fiscalYear, from: params.from, to: params.to },
              firstPage: book.pages[0]?.page ?? null,
              lastPage: book.pages.at(-1)?.page ?? null,
            };
          }
        } else if (report === 'voucher') {
          // The printed voucher (S11 "Printing and legal books"): one A5 page of its own.
          const params = REPORT_FILE_QUERIES.voucher.parse(row.params);
          const voucher = await readVoucherPrint(tx, params.voucher);
          const shown =
            voucher.kind === 'count'
              ? (voucher.countedMinor ?? '0')
              : (voucher.exchangedMinor ?? voucher.amountMinor);
          const html = renderVoucherHtml({
            company: company.name,
            voucher,
            text: ar.cash,
            amountInWords: amountInWords(BigInt(shown), voucher.cashAccount.currency),
            currencyName: (currency) => printedCurrency(currency, SHEET_TEXT),
            fiscalYearStartMonth: settings.startMonth,
            fontFaces: this.fontFaces(),
          });
          pdf = await this.printer.print(html, { pageNumbers: null });
        } else if (report === 'project_document') {
          // A printed project document (S12 "Printing and legal books"): its own page size by
          // kind; a long wage sheet runs over pages, numbered.
          const params = REPORT_FILE_QUERIES.project_document.parse(row.params);
          const document = await readProjectDocumentPrint(tx, params.document);
          const html = renderProjectDocumentHtml({
            company: company.name,
            document,
            text: ar.reports.projectDocument,
            amountInWords: amountInWords(BigInt(document.netMinor), document.currency),
            currencyName: (currency) => printedCurrency(currency, SHEET_TEXT),
            fiscalYearStartMonth: settings.startMonth,
            fontFaces: this.fontFaces(),
          });
          pdf = await this.printer.print(html, { pageNumbers: ar.reports.pageOf });
        } else if ((MOVEMENT_PRINT_REPORTS as readonly string[]).includes(report)) {
          // S13 "Printing": under the company's display name and logo, on every page.
          pdf = await this.printMovements(
            tx,
            companyId,
            report as MovementPrintReport,
            row.params,
            now,
          );
        } else {
          const params = REPORT_FILE_QUERIES[report as SheetReportOf].parse(row.params);
          const answer = await readReportAnswer(
            tx,
            report as SheetReportOf,
            params,
            now,
            todayInDamascus(),
          );
          const sheet = reportSheet(answer, {
            text: SHEET_TEXT,
            fiscalYearStartMonth: settings.startMonth,
          });
          const html = renderReportHtml({
            company: company.name,
            sheet,
            none: ar.reports.none,
            fontFaces: this.fontFaces(),
          });
          pdf = await this.printer.print(html, { pageNumbers: ar.reports.pageOf });
        }
        const digest = sha256(pdf);
        await this.files.write(companyId, fileId, Readable.from([pdf]));
        if (print !== null) {
          await this.register(tx, row, print, digest);
        }
        await tx
          .update(reportFiles)
          .set({
            state: 'ready',
            storageKey: `${companyId}/${fileId}`,
            sizeBytes: pdf.length,
            sha256: digest,
            readyAt: now,
            expiresAt: row.official
              ? null
              : new Date(now.getTime() + REPORT_FILE_TTL_HOURS * 3600_000),
          })
          .where(eq(reportFiles.id, fileId));
        return 'ready';
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  /** The register's row and its audit row, in the render's transaction (rule 28). */
  private async register(
    tx: Transaction,
    row: typeof reportFiles.$inferSelect,
    print: OfficialPrint,
    fileSha256: string,
  ): Promise<void> {
    const { range } = print;
    const months = await readRangePeriods(tx, range.from, range.to);
    const first = months[0];
    const last = months.at(-1);
    if (!first || !last) throw new Error('An official print without its periods');
    const totals = await readJournalBookTotals(tx, range);
    const pages = { first: print.firstPage, last: print.lastPage };
    const [inserted] = await tx
      .insert(journalBookPrints)
      .values({
        companyId: row.companyId,
        reportFileId: row.id,
        fiscalYear: range.fiscalYear,
        fromPeriodId: first.id,
        toPeriodId: last.id,
        firstPage: pages.first,
        lastPage: pages.last,
        entryCount: totals.entryCount,
        lineCount: totals.lineCount,
        debitTotalMinor: totals.debitMinor,
        creditTotalMinor: totals.creditMinor,
        contentSha256: print.content,
        fileSha256,
        reopensSeen: await countRangeReopens(tx, range),
        printedByUserId: row.requestedByUserId,
      })
      .returning({ id: journalBookPrints.id });
    if (!inserted) throw new Error('No register row inserted');
    await writeCompanyAudit(tx, row.companyId, renderActor, {
      action: 'journal_book.printed',
      entityType: 'journal_book_print',
      entityId: inserted.id,
      after: {
        reportFileId: row.id,
        fiscalYear: range.fiscalYear,
        from: range.from,
        to: range.to,
        firstPage: pages.first,
        lastPage: pages.last,
        entryCount: totals.entryCount,
        lineCount: totals.lineCount,
        debitTotalMinor: totals.debitMinor.toString(),
        creditTotalMinor: totals.creditMinor.toString(),
        contentSha256: print.content,
        fileSha256,
      },
    });
  }

  /** One of S13's three PDFs (S13 "Printing"), read in the render's snapshot. */
  private async printMovements(
    tx: Transaction,
    companyId: string,
    report: MovementPrintReport,
    params: unknown,
    now: Date,
  ): Promise<Buffer> {
    const text = ar.movements.print;
    const branding = await readBranding(tx);
    const logo = await this.logoOf(companyId, branding.logo);
    const today = todayInDamascus();
    let content: MovementsPrintData;
    let bookCurrency: CurrencyCode;
    let scope = text.asOf.replace('{date}', today);
    if (report === 'projects_overview') {
      const data = await readProjectsOverviewPrint(tx);
      content = { report, data };
      bookCurrency = data.bookCurrency;
    } else if (report === 'project_statement') {
      const { project } = REPORT_FILE_QUERIES.project_statement.parse(params);
      const { bookCurrency: book, section } = await readProjectStatementPrint(tx, project);
      content = { report, data: section };
      bookCurrency = book;
      scope = `${section.project.name} · ${scope}`;
    } else {
      const query = REPORT_FILE_QUERIES.material_costs.parse(params);
      const costs = await readMaterialCosts(tx, query);
      content = {
        report,
        data: { materials: costs.materials, totalBookMinor: costs.totalBookMinor },
      };
      bookCurrency = costs.bookCurrency;
      const range =
        query.from !== undefined && query.to !== undefined
          ? text.range.replace('{from}', query.from).replace('{to}', query.to)
          : query.from !== undefined
            ? text.since.replace('{date}', query.from)
            : query.to !== undefined
              ? text.until.replace('{date}', query.to)
              : text.allDates;
      let project: string = text.allProjectsScope;
      if (query.project !== undefined) {
        const statement = await readProjectStatementPrint(tx, query.project);
        project = statement.section.project.name;
      }
      scope = `${project} · ${range}`;
    }
    const title = ar.reports.names[report];
    const printedAt = formatProducedAt(now.toISOString());
    const html = renderMovementsHtml({
      company: branding.displayName,
      logo,
      title,
      scope,
      printedAt,
      bookCurrency,
      currencyName: (currency) => printedCurrency(currency, SHEET_TEXT),
      text: {
        print: text,
        kinds: ar.movements.kinds,
        states: ar.movements.states,
        figures: ar.movements.figures,
      },
      content,
      fontFaces: this.fontFaces(),
    });
    return this.printer.print(html, {
      pageNumbers: ar.reports.pageOf,
      pageHeader: movementsPageHeader({
        company: branding.displayName,
        logo,
        title,
        scope,
        printedAt,
      }),
    });
  }

  /** The company's logo as a `data:` URL, PNG or JPEG only as uploaded; none when it is gone. */
  private async logoOf(
    companyId: string,
    logo: { storageKey: string; contentType: string } | null,
  ): Promise<string | null> {
    if (logo === null) return null;
    if (logo.contentType !== 'image/png' && logo.contentType !== 'image/jpeg') return null;
    const [owner, id] = logo.storageKey.split('/');
    if (owner !== companyId || id === undefined) return null;
    const file = await this.files.read(companyId, id);
    return file === null ? null : `data:${logo.contentType};base64,${file.toString('base64')}`;
  }

  private fontFaces(): string {
    this.fonts ??= printFontFaces();
    return this.fonts;
  }
}

/** The reports printed as a sheet. */
type SheetReportOf = Exclude<
  ActiveReport,
  'journal_book' | 'voucher' | 'project_document' | MovementPrintReport
>;

interface JournalRange {
  readonly fiscalYear: number;
  readonly from: string;
  readonly to: string;
}

/** An official print's register facts, from the render's own read of the book. */
interface OfficialPrint {
  /** The SHA-256 of the pages' RFC 8785 JSON (rule 31). */
  readonly content: string;
  readonly range: JournalRange;
  /** The pages in the year's numbering, none for a range with no entries (edge case 23). */
  readonly firstPage: number | null;
  readonly lastPage: number | null;
}
