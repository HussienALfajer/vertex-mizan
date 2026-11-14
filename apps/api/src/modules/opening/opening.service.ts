import { Inject, Injectable } from '@nestjs/common';
import type {
  OpeningEntryResult,
  OpeningExportQuery,
  OpeningViewAnswer,
  SaveOpening,
} from '@vertex-mizan/contracts';
import {
  chartAccounts,
  type Database,
  dimensionValues,
  journalEntries,
  type OpeningView,
  openings,
  postOpening,
  readOpening,
  reverseOpening,
  saveOpening,
  type Transaction,
  withCompany,
} from '@vertex-mizan/db';
import { desc, eq, inArray } from 'drizzle-orm';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { writeCompanyAudit } from '../../core/audit/audit.js';
import { DATABASE } from '../../core/database/database.module.js';
import type { ExportFile } from '../chart/chart.service.js';
import { ledgerCurrencies } from '../entries/entry-shape.js';
import { openingWorkbook } from './opening-workbook.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const text = (minor: bigint) => minor.toString();
const textOrNull = (minor: bigint | null) => (minor === null ? null : minor.toString());

/** A check's failing item as plain values: amounts as text, anything nested as JSON. */
function failureOf(failure: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(failure).map(([key, value]) => {
      if (value === null || value === undefined) return [key, null];
      if (typeof value === 'bigint') return [key, value.toString()];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return [key, value];
      }
      return [
        key,
        JSON.stringify(value, (_, inner) => (typeof inner === 'bigint' ? inner.toString() : inner)),
      ];
    }),
  ) as Record<string, string | number | boolean | null>;
}

/** The entries an opening names, by id: their dates and numbers. */
async function entryRefs(tx: Transaction, ids: readonly (string | null)[]) {
  const wanted = ids.filter((id): id is string => id !== null);
  const rows =
    wanted.length === 0
      ? []
      : await tx
          .select({
            id: journalEntries.id,
            date: journalEntries.entryDate,
            fiscalYear: journalEntries.fiscalYear,
            number: journalEntries.number,
          })
          .from(journalEntries)
          .where(inArray(journalEntries.id, wanted));
  return new Map(rows.map((row) => [row.id, row]));
}

/** The view of `GET /api/opening` from `readOpening()`'s, in the API's types (S10 rule 20). */
async function answerOf(tx: Transaction, view: OpeningView): Promise<OpeningViewAnswer> {
  const live = view.opening;
  const [reversed] = await tx
    .select()
    .from(openings)
    .where(eq(openings.state, 'reversed'))
    .orderBy(desc(openings.reversedAt), desc(openings.id))
    .limit(1);
  const entries = await entryRefs(tx, [
    live?.entryId ?? null,
    reversed?.entryId ?? null,
    reversed?.reversalEntryId ?? null,
  ]);
  const entryOf = (id: string | null) => {
    const entry = id === null ? undefined : entries.get(id);
    if (entry === undefined) throw new Error('An opening without its entry');
    return entry;
  };
  return {
    booksStart: view.booksStart,
    asOf: view.asOf,
    state: (live?.state ?? null) as OpeningViewAnswer['state'],
    version: view.version,
    recordLines: view.recordLines.map((line) => ({
      lineNo: line.lineNo,
      accountId: line.accountId,
      dimensionValueIds: [...line.dimensionValueIds],
      currency: line.currency as OpeningViewAnswer['recordLines'][number]['currency'],
      amountMinor: text(line.amountMinor),
      bookMinor: textOrNull(line.bookMinor),
      parallelMinor: textOrNull(line.parallelMinor),
      itemReference: line.itemReference,
      itemDueOn: line.itemDueOn,
      memo: line.memo,
    })),
    lines: view.lines.map((line) => ({
      lineNo: line.lineNo,
      source: line.source,
      accountId: line.accountId,
      dimensionValueIds: [...line.dimensionValueIds],
      kind: line.kind,
      currency: line.currency,
      amountMinor: text(line.amountMinor),
      bookMinor: text(line.bookMinor),
      parallelMinor: textOrNull(line.parallelMinor),
      memo: line.memo,
      conversions: line.conversions.map((conversion) => ({
        ledger: conversion.ledger,
        base: conversion.base,
        quote: conversion.quote,
        rate: conversion.rate,
        effectiveOn: conversion.effectiveOn,
      })),
      itemReference: line.item?.reference ?? null,
    })),
    checks: view.checks.map((check) => ({
      check: check.check,
      passed: check.passed,
      failures: check.failures.map(failureOf),
    })),
    fingerprint: view.fingerprint,
    posted:
      live?.state === 'posted' && live.postedByUserId !== null && live.postedAt !== null
        ? { entry: entryOf(live.entryId), by: live.postedByUserId, at: live.postedAt.toISOString() }
        : null,
    reversed:
      reversed === undefined || reversed.reversedAt === null
        ? null
        : {
            entry: entryOf(reversed.entryId),
            reversalEntry: entryOf(reversed.reversalEntryId),
            reason: reversed.reverseReason ?? '',
            at: reversed.reversedAt.toISOString(),
          },
  };
}

/**
 * `/api/opening` (S10 rules 10–26): the opening's view with its checks and preview, the
 * accountant's save, the owner's post and whole reversal, through `packages/db`'s opening service
 * in the company's context. Every write locks the company row first (an archived company refused);
 * the service locks the ledger head and writes its audit row in the same transaction.
 */
@Injectable()
export class OpeningService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `GET /api/opening`: a read, not audited; `NO_BOOKS_START` without a books start. */
  read(access: CompanyRouteAccess): Promise<OpeningViewAnswer> {
    return withCompany(
      this.db,
      access.company.id,
      async (tx) => answerOf(tx, await readOpening(tx)),
      { isolationLevel: 'repeatable read' },
    );
  }

  /**
   * `GET /api/opening/export?part=preview`: the preview as an Arabic workbook, read in one
   * repeatable-read snapshot and audited `export.opening` (S10 "Screens", Export).
   */
  async export(access: CompanyRouteAccess, query: OpeningExportQuery): Promise<ExportFile> {
    const companyId = access.company.id;
    const { view, names } = await withCompany(
      this.db,
      companyId,
      async (tx) => {
        const view = await answerOf(tx, await readOpening(tx));
        const accounts = await tx
          .select({ id: chartAccounts.id, code: chartAccounts.code, name: chartAccounts.name })
          .from(chartAccounts);
        const values = await tx
          .select({
            id: dimensionValues.id,
            code: dimensionValues.code,
            name: dimensionValues.name,
          })
          .from(dimensionValues);
        await writeCompanyAudit(tx, companyId, actorOf(access), {
          action: 'export.opening',
          entityType: 'opening_export',
          entityId: null,
          after: { format: 'xlsx', part: query.part, version: view.version },
        });
        return {
          view,
          names: {
            accounts: new Map(accounts.map((row) => [row.id, row])),
            values: new Map(values.map((row) => [row.id, row])),
            ledgers: await ledgerCurrencies(tx),
          },
        };
      },
      { isolationLevel: 'repeatable read' },
    );
    return {
      fileName: `opening-${query.part}-${view.booksStart}.xlsx`,
      contentType: XLSX,
      body: await openingWorkbook(view, query.part, names),
    };
  }

  /** `PUT /api/opening`: the draft saved against its version, then read again. */
  save(access: CompanyRouteAccess, input: SaveOpening): Promise<OpeningViewAnswer> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      await saveOpening(tx, input, actorOf(access) as Parameters<typeof saveOpening>[2]);
      return answerOf(tx, await readOpening(tx));
    });
  }

  /** `POST /api/opening/post`: the owner's post, with the preview's fingerprint. */
  post(access: CompanyRouteAccess, fingerprint: string): Promise<OpeningEntryResult> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const posted = await postOpening(tx, {
        fingerprint,
        actor: actorOf(access) as Parameters<typeof postOpening>[1]['actor'],
      });
      return this.result(tx, posted.openingId, posted.entry.id);
    });
  }

  /** `POST /api/opening/reverse`: the whole reversal while the opening is the only entry. */
  reverse(access: CompanyRouteAccess, reason: string): Promise<OpeningEntryResult> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const reversed = await reverseOpening(tx, {
        reason,
        actor: actorOf(access) as Parameters<typeof reverseOpening>[1]['actor'],
      });
      return this.result(tx, reversed.openingId, reversed.entry.id);
    });
  }

  private async result(
    tx: Transaction,
    openingId: string,
    entryId: string,
  ): Promise<OpeningEntryResult> {
    const entry = (await entryRefs(tx, [entryId])).get(entryId);
    if (entry === undefined) throw new Error('A posted opening without its entry');
    return { openingId, entry };
  }
}
