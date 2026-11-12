import type { ReadStream } from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import {
  EXCEL_REPORT_QUERIES,
  type ExcelReport,
  type JournalBookPrint,
  type Permission,
  REPORT_EXCEL_ROW_LIMIT,
  REPORT_FILE_QUEUE_LIMIT,
  REPORTS_RENDER_QUEUE,
  type Report,
  type ReportExportQuery,
  type ReportFile,
  type ReportFileRequest,
  type ReportFileState,
  type ReportsRenderJob,
} from '@vertex-mizan/contracts';
import {
  checkOfficialRange,
  companySettings,
  countQueuedReportFiles,
  type Database,
  parseReportFileParams,
  readJournalBookPrints,
  readReportAnswer,
  readReportFiles,
  reportFiles,
  type Transaction,
  withCompany,
} from '@vertex-mizan/db';
import { ar } from '@vertex-mizan/i18n';
import { reportSheet } from '@vertex-mizan/ui/print/sheets';
import { and, eq, or, sql } from 'drizzle-orm';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { writeCompanyAudit } from '../../core/audit/audit.js';
import { todayInDamascus } from '../../core/clock/today.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { FileStore } from '../../core/files/file-store.js';
import { RetryQueue } from '../../core/jobs/retry-queue.js';
import type { ExportFile } from '../chart/chart.service.js';
import { peopleOf, personOf } from '../entries/entry-shape.js';
import { reportWorkbook } from './report-workbook.js';

type FileRow = typeof reportFiles.$inferSelect;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The files a person's list shows: the newest, enough for a working day's prints. */
const FILES_LISTED = 50;

/** What a report's file needs beyond `reports.read`, the route's own (S09 "Access"). */
const FILE_PERMISSION: Partial<Record<Report, Permission>> = {
  ageing: 'open_items.read',
  client_statement: 'open_items.read',
  chart: 'accounts.read',
};

const SHEET_TEXT = {
  reports: ar.reports,
  accounting: ar.accounting,
  openItems: ar.openItems,
  chart: ar.chart,
};

/** A ready PDF, to stream as a download. */
export interface ReportFileDownload {
  readonly stream: ReadStream;
  readonly size: number;
  readonly fileName: string;
}

/**
 * The exports and files of S09 (rules 28–30, 35–37): a report to Excel at once, a PDF queued for
 * the worker, the person's files and their downloads, and the journal book's print register. Each
 * export is audited (`export.<report>`) in the transaction that reads it; a download too.
 */
@Injectable()
export class ReportFilesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(RetryQueue) private readonly queue: RetryQueue,
    @Inject(FileStore) private readonly files: FileStore,
  ) {}

  /**
   * `GET /api/reports/:report/export?format=xlsx` (rule 35): the report read whole in one
   * snapshot, its sheet at most `REPORT_EXCEL_ROW_LIMIT` rows (`REPORT_TOO_LARGE` with the count),
   * audited with its parameters.
   */
  async excel(
    access: CompanyRouteAccess,
    report: ExcelReport,
    raw: ReportExportQuery,
  ): Promise<ExportFile> {
    const { format: _format, ...rest } = raw;
    const parsed = EXCEL_REPORT_QUERIES[report].safeParse(rest);
    if (!parsed.success) {
      throw new CodedException(
        'VALIDATION_FAILED',
        'The report’s query is not valid',
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String),
          message: issue.message,
        })),
      );
    }
    const companyId = access.company.id;
    const sheet = await withCompany(
      this.db,
      companyId,
      async (tx) => {
        const answer = await readReportAnswer(
          tx,
          report === 'journal_book' ? 'journal' : report,
          parsed.data,
          new Date(),
          todayInDamascus(),
        );
        const sheet = reportSheet(answer, {
          text: SHEET_TEXT,
          fiscalYearStartMonth: await fiscalYearStartMonth(tx),
        });
        if (sheet.rows.length > REPORT_EXCEL_ROW_LIMIT) {
          throw new CodedException('REPORT_TOO_LARGE', 'The report is too large for Excel', [], {
            rows: String(sheet.rows.length),
            limit: String(REPORT_EXCEL_ROW_LIMIT),
          });
        }
        await writeCompanyAudit(tx, companyId, actorOf(access), {
          action: `export.${report}`,
          entityType: 'report_export',
          entityId: null,
          after: { report, format: 'xlsx', params: auditedParams(parsed.data) },
        });
        return sheet;
      },
      { isolationLevel: 'repeatable read' },
    );
    return {
      fileName: `${report}-${todayInDamascus()}.xlsx`,
      contentType: XLSX,
      body: await reportWorkbook(sheet, access.company.name, {
        currency: ar.reports.columns.currency,
        none: ar.reports.none,
      }),
    };
  }

  /**
   * `POST /api/reports/files` (rule 36): a PDF queued with its validated parameters; at most
   * `REPORT_FILE_QUEUE_LIMIT` queued per person (`RATE_LIMITED`), counted under a lock of the
   * person's own; an official print of the book ledger's journal book only of closed months of one
   * fiscal year (`PERIOD_NOT_CLOSED` naming the first open one, rule 28). Audited as the report's
   * export; the worker's `reports.render` is sent once the row commits.
   */
  async request(access: CompanyRouteAccess, request: ReportFileRequest): Promise<ReportFile> {
    const needed = FILE_PERMISSION[request.report];
    if (needed !== undefined && !access.company.permissions.includes(needed)) {
      throw new CodedException('FORBIDDEN', 'Not allowed to export this report');
    }
    const companyId = access.company.id;
    const { stored, parsed: params } = parseReportFileParams(request.report, request.params);
    const row = await withCompany(this.db, companyId, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`report_files:${access.person.id}`}, 0))`,
      );
      const queued = await countQueuedReportFiles(tx, access.person.id);
      if (queued >= REPORT_FILE_QUEUE_LIMIT) {
        throw new CodedException('RATE_LIMITED', 'Too many files queued', [], {
          queued: String(queued),
          limit: String(REPORT_FILE_QUEUE_LIMIT),
        });
      }
      if (request.official) {
        if (params.ledger !== 'book') {
          throw new CodedException('VALIDATION_FAILED', 'An official print is of the book ledger', [
            { path: ['params', 'ledger'], message: 'An official print is of the book ledger' },
          ]);
        }
        await checkOfficialRange(tx, {
          fiscalYear: params.fiscalYear as number,
          from: params.from as string,
          to: params.to as string,
        });
      }
      const [inserted] = await tx
        .insert(reportFiles)
        .values({
          companyId,
          report: request.report,
          params: stored,
          official: request.official,
          requestedByUserId: access.person.id,
        })
        .returning();
      if (!inserted) throw new Error('No file inserted');
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: `export.${request.report}`,
        entityType: 'report_export',
        entityId: inserted.id,
        after: {
          report: request.report,
          format: 'pdf',
          params: stored,
          fileId: inserted.id,
          official: request.official,
        },
      });
      return inserted;
    });
    const job: ReportsRenderJob = { companyId, fileId: row.id };
    await this.queue.send(REPORTS_RENDER_QUEUE, job);
    return shape(row);
  }

  /** `GET /api/reports/files`: the person's own files, newest first. */
  async list(access: CompanyRouteAccess): Promise<ReportFile[]> {
    return withCompany(this.db, access.company.id, async (tx) =>
      (await readReportFiles(tx, access.person.id, FILES_LISTED)).map(shape),
    );
  }

  /** `GET /api/reports/files/:id`: the person's own file, or an official print (the register's). */
  async one(access: CompanyRouteAccess, id: string): Promise<ReportFile> {
    return withCompany(this.db, access.company.id, async (tx) =>
      shape(await visible(tx, access, id)),
    );
  }

  /**
   * `GET /api/reports/files/:id/download`: a ready PDF, the person's own within its 24 hours or an
   * official print at any time; audited `report_file.downloaded`. Past its time `LINK_INVALID`.
   */
  async download(access: CompanyRouteAccess, id: string): Promise<ReportFileDownload> {
    const companyId = access.company.id;
    const row = await withCompany(this.db, companyId, async (tx) => {
      const found = await visible(tx, access, id);
      if (found.state === 'queued' || found.state === 'failed') {
        throw new CodedException('NOT_FOUND', 'No such file to download');
      }
      const [current] = await tx
        .select({
          current: sql<boolean>`${reportFiles.expiresAt} is null or ${reportFiles.expiresAt} > now()`,
        })
        .from(reportFiles)
        .where(eq(reportFiles.id, id));
      if (found.state === 'expired' || !current?.current) {
        throw new CodedException('LINK_INVALID', 'The file has expired');
      }
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: 'report_file.downloaded',
        entityType: 'report_file',
        entityId: found.id,
        after: {
          report: found.report,
          official: found.official,
          sizeBytes: found.sizeBytes,
          sha256: found.sha256,
        },
      });
      return found;
    });
    const file = await this.files.open(companyId, row.id);
    return {
      ...file,
      fileName: `${row.report}-${row.createdAt.toISOString().slice(0, 10)}.pdf`,
    };
  }

  /** `GET /api/reports/journal-book/prints?fiscalYear=` (rule 29). */
  async prints(access: CompanyRouteAccess, fiscalYear: number): Promise<JournalBookPrint[]> {
    return withCompany(this.db, access.company.id, async (tx) => {
      const rows = await readJournalBookPrints(tx, fiscalYear);
      const people = await peopleOf(
        tx,
        rows.map((row) => row.printedByUserId),
      );
      return rows.map((row) => ({
        id: row.id,
        reportFileId: row.reportFileId,
        fiscalYear: row.fiscalYear,
        from: row.from,
        to: row.to,
        firstPage: row.firstPage,
        lastPage: row.lastPage,
        entryCount: row.entryCount,
        lineCount: row.lineCount,
        debitTotal: row.debitTotalMinor.toString(),
        creditTotal: row.creditTotalMinor.toString(),
        currency: row.currency,
        contentSha256: row.contentSha256,
        fileSha256: row.fileSha256,
        printedBy: personOf(people, row.printedByUserId),
        createdAt: row.createdAt.toISOString(),
        superseded: row.supersededAt !== null,
        supersededAt: row.supersededAt?.toISOString() ?? null,
      }));
    });
  }
}

/** The person's own file, or an official print, which the register shows to every reader. */
async function visible(tx: Transaction, access: CompanyRouteAccess, id: string): Promise<FileRow> {
  const [row] = await tx
    .select()
    .from(reportFiles)
    .where(
      and(
        eq(reportFiles.id, id),
        or(eq(reportFiles.requestedByUserId, access.person.id), eq(reportFiles.official, true)),
      ),
    );
  if (!row) throw new CodedException('NOT_FOUND', 'No such file');
  return row;
}

async function fiscalYearStartMonth(tx: Transaction): Promise<number> {
  const [settings] = await tx
    .select({ month: companySettings.fiscalYearStartMonth })
    .from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  return settings.month;
}

/** The parameters as audited: JSON values only (dates and arrays as sent). */
const auditedParams = (params: unknown) => JSON.parse(JSON.stringify(params)) as unknown;

function shape(row: FileRow): ReportFile {
  return {
    id: row.id,
    report: row.report as Report,
    params: row.params as Record<string, unknown>,
    format: 'pdf',
    official: row.official,
    state: row.state as ReportFileState,
    sizeBytes: row.sizeBytes,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    readyAt: row.readyAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}
