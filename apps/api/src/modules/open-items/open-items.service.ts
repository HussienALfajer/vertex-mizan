import { Inject, Injectable } from '@nestjs/common';
import {
  AGEING_BUCKETS,
  type AgeingQuery,
  type AgeingReport,
  type BucketAmounts,
  type ChangeDueDate,
  type ClientFunds,
  type ClientFundsQuery,
  type ClientRef,
  type ClientStatement,
  type ClientStatementQuery,
  type CurrencyCode,
  type Ledger,
  type OpenItem,
  type OpenItemPage,
  type OpenItemQuery,
  type OpenItemSummary,
  spreadsheetAmount,
} from '@vertex-mizan/contracts';
import {
  chartAccounts,
  type Database,
  dimensionTypes,
  dimensionValues,
  type ItemAtDate,
  type ItemDueDate,
  openItemDueDates,
  readClientStatement,
  readDueDates,
  readItemMovements,
  readItemsAt,
  type Transaction,
  withCompany,
} from '@vertex-mizan/db';
import { ar } from '@vertex-mizan/i18n';
import { ageingOf, type BucketTotals, dueDateInForce, fundTotals } from '@vertex-mizan/ledger';
import { and, eq, inArray, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { v7 as uuidv7 } from 'uuid';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { writeCompanyAudit } from '../../core/audit/audit.js';
import { todayInDamascus } from '../../core/clock/today.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { decodeCursor, encodeCursor } from '../../core/http/cursor.js';
import type { ExportFile } from '../chart/chart.service.js';
import { ledgerCurrencies, peopleOf, personOrNull } from '../entries/entry-shape.js';

const PAGE_SIZE = 100;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The statement line whose document control accounts the ageing reads by default (rule 16). */
const DEFAULT_AGEING_LINE = 'bs.trade_receivables';

const text = (amount: bigint | null) => amount?.toString() ?? null;

const clientOf = (item: ItemAtDate): ClientRef | null =>
  item.clientValueId === null
    ? null
    : { id: item.clientValueId, code: item.clientCode, name: item.clientName ?? '' };

/** An item as the lists answer it, with its due date in force at the date (rule 14). */
function summaryOf(
  item: ItemAtDate,
  dueDates: readonly ItemDueDate[],
  asOf: string,
): OpenItemSummary {
  return {
    id: item.id,
    account: { id: item.accountId, code: item.accountCode, name: item.accountName },
    kind: item.kind,
    reference: item.reference,
    source: item.source,
    client: clientOf(item),
    currency: item.currency,
    documentDate: item.documentDate,
    dueOn:
      item.kind === 'document'
        ? dueDateInForce(
            dueDates.filter((row) => row.itemId === item.id),
            item.documentDate,
            asOf,
          )
        : null,
    state: item.openMinor === 0n ? 'settled' : 'open',
    amounts: {
      openMinor: item.openMinor.toString(),
      bookMinor: item.bookMinor.toString(),
      parallelMinor: text(item.parallelMinor),
    },
    adjusted: item.adjusted,
  };
}

const bucketText = (totals: BucketTotals): BucketAmounts =>
  Object.fromEntries(
    AGEING_BUCKETS.map((bucket) => [bucket, totals[bucket].toString()]),
  ) as BucketAmounts;

/** Refuses the parallel ledger of a company that keeps none. */
function ledgerCurrency(
  currencies: { book: CurrencyCode; parallel: CurrencyCode | null },
  ledger: Ledger,
): CurrencyCode {
  const currency = ledger === 'book' ? currencies.book : currencies.parallel;
  if (currency === null) {
    throw new CodedException('VALIDATION_FAILED', 'The company keeps no parallel ledger', [
      { path: ['ledger'], message: 'The company keeps no parallel ledger' },
    ]);
  }
  return currency;
}

/**
 * Open items, the ageing, client funds and the client statement (S04 "API"), read in the
 * company's context; a manual item's due date changed with its audit row in the same transaction.
 * Every figure is summed in SQL or by `packages/ledger`, never here.
 */
@Injectable()
export class OpenItemsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `GET /api/open-items`: items by account, client, state and reference, at a date. */
  async list(access: CompanyRouteAccess, query: OpenItemQuery): Promise<OpenItemPage> {
    const asOf = query.asOf ?? todayInDamascus();
    return withCompany(this.db, access.company.id, async (tx) => {
      const rows = await readItemsAt(tx, {
        asOf,
        ...(query.account && { accountIds: [query.account] }),
        ...(query.client && { clientValueId: query.client }),
        state: query.state,
        ...(query.text && { text: query.text }),
        ...(query.cursor && { afterItemId: decodeCursor(query.cursor).id }),
        limit: PAGE_SIZE + 1,
      });
      const page = rows.slice(0, PAGE_SIZE);
      const dueDates = await readDueDates(
        tx,
        page.filter((row) => row.kind === 'document').map((row) => row.id),
      );
      const last = page.at(-1);
      return {
        items: page.map((row) => summaryOf(row, dueDates, asOf)),
        nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null,
      };
    });
  }

  /** `GET /api/open-items/:id`: the item at a date, its movements up to it, its due dates. */
  async get(access: CompanyRouteAccess, id: string, asOf?: string): Promise<OpenItem> {
    return withCompany(this.db, access.company.id, (tx) =>
      readOpenItem(tx, id, asOf ?? todayInDamascus()),
    );
  }

  /**
   * `PUT /api/open-items/:id/due-date` (rule 15): a manual document item's due date, from today in
   * Damascus, with a reason; a Hub item's comes only from Hub (`OPEN_ITEM_FROM_HUB`). The same date
   * again changes nothing (an idempotent replay).
   */
  async changeDueDate(
    access: CompanyRouteAccess,
    id: string,
    body: ChangeDueDate,
  ): Promise<OpenItem> {
    const companyId = access.company.id;
    const today = todayInDamascus();
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const [item] = await readItemsAt(tx, { asOf: today, itemIds: [id], includeUnopened: true });
      if (!item) throw new CodedException('NOT_FOUND', 'No such open item');
      if (item.kind !== 'document') {
        throw new CodedException('VALIDATION_FAILED', 'A running item has no due date', [
          { path: ['dueOn'], message: 'A running item has no due date' },
        ]);
      }
      if (item.source !== 'manual') {
        throw new CodedException('OPEN_ITEM_FROM_HUB', 'Hub sets this item’s due date');
      }
      const before = dueDateInForce(await readDueDates(tx, [id]), item.documentDate, today);
      if (before !== body.dueOn) {
        await tx.insert(openItemDueDates).values({
          id: uuidv7(),
          companyId,
          itemId: id,
          dueOn: body.dueOn,
          effectiveOn: today,
          setBy: 'user',
          userId: access.person.id,
          reason: body.reason,
        });
        await writeCompanyAudit(tx, companyId, actorOf(access), {
          action: 'open_item.due_date_changed',
          entityType: 'open_item',
          entityId: id,
          reason: body.reason,
          before: { reference: item.reference, dueOn: before },
          after: { reference: item.reference, dueOn: body.dueOn, effectiveOn: today },
        });
      }
      return readOpenItem(tx, id, today);
    });
  }

  /** `GET /api/receivables/ageing` (rule 16). */
  async ageing(access: CompanyRouteAccess, query: AgeingQuery): Promise<AgeingReport> {
    return withCompany(this.db, access.company.id, (tx) => readAgeing(tx, query));
  }

  /** `GET /api/receivables/ageing/export`: the ageing as an Arabic workbook, audited. */
  async ageingExport(access: CompanyRouteAccess, query: AgeingQuery): Promise<ExportFile> {
    const companyId = access.company.id;
    const report = await withCompany(this.db, companyId, async (tx) => {
      const report = await readAgeing(tx, query);
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: 'export.ageing',
        entityType: 'receivables_export',
        entityId: null,
        after: {
          format: 'xlsx',
          asOf: report.asOf,
          ledger: report.ledger,
          accountIds: report.accounts.map((account) => account.id),
          clientValueId: query.client ?? null,
        },
      });
      return report;
    });
    return {
      fileName: `receivables-ageing-${report.asOf}.xlsx`,
      contentType: XLSX,
      body: await ageingWorkbook(report),
    };
  }

  /** `GET /api/client-funds` (rule 17): each running item at the date. */
  async clientFunds(access: CompanyRouteAccess, query: ClientFundsQuery): Promise<ClientFunds> {
    const asOf = query.asOf ?? todayInDamascus();
    return withCompany(this.db, access.company.id, async (tx) => {
      const currencies = await ledgerCurrencies(tx);
      ledgerCurrency(currencies, query.ledger);
      const items = await readItemsAt(tx, { asOf, kind: 'running' });
      const sorted = [...items].sort(
        (a, b) =>
          (a.clientName ?? '').localeCompare(b.clientName ?? '', 'ar') ||
          (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0),
      );
      const totals = fundTotals(
        sorted.map((item) =>
          query.ledger === 'book' ? item.bookMinor : (item.parallelMinor ?? 0n),
        ),
      );
      return {
        asOf,
        ledger: query.ledger,
        bookCurrency: currencies.book,
        parallelCurrency: currencies.parallel,
        funds: sorted.map((item) => ({
          itemId: item.id,
          account: { id: item.accountId, code: item.accountCode, name: item.accountName },
          client: clientOf(item) ?? { id: item.reference, code: item.reference, name: '' },
          currency: item.currency,
          amounts: {
            openMinor: item.openMinor.toString(),
            bookMinor: item.bookMinor.toString(),
            parallelMinor: text(item.parallelMinor),
          },
          receivable: item.openMinor > 0n,
        })),
        heldMinor: totals.heldMinor.toString(),
        receivableMinor: totals.receivableMinor.toString(),
      };
    });
  }

  /** `GET /api/clients/:valueId/statement`. */
  async statement(
    access: CompanyRouteAccess,
    valueId: string,
    query: ClientStatementQuery,
  ): Promise<ClientStatement> {
    return withCompany(this.db, access.company.id, (tx) => readStatement(tx, valueId, query));
  }

  /** `GET /api/clients/:valueId/statement/export`: the statement as an Arabic workbook, audited. */
  async statementExport(
    access: CompanyRouteAccess,
    valueId: string,
    query: ClientStatementQuery,
  ): Promise<ExportFile> {
    const companyId = access.company.id;
    const statement = await withCompany(this.db, companyId, async (tx) => {
      const statement = await readStatement(tx, valueId, query);
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: 'export.client_statement',
        entityType: 'receivables_export',
        entityId: valueId,
        after: {
          format: 'xlsx',
          clientValueId: valueId,
          from: statement.from,
          to: statement.to,
          ledger: statement.ledger,
          currency: statement.currency,
        },
      });
      return statement;
    });
    return {
      fileName: `client-statement-${statement.client.code ?? statement.client.id}-${statement.to}.xlsx`,
      contentType: XLSX,
      body: await statementWorkbook(statement),
    };
  }
}

/** One item at a date with its movements and due-date history; another company's is `NOT_FOUND`. */
async function readOpenItem(tx: Transaction, id: string, asOf: string): Promise<OpenItem> {
  const [item] = await readItemsAt(tx, { asOf, itemIds: [id], includeUnopened: true });
  if (!item) throw new CodedException('NOT_FOUND', 'No such open item');
  const dueDates = item.kind === 'document' ? await readDueDates(tx, [id]) : [];
  const movements = await readItemMovements(tx, id, asOf);
  const currencies = await ledgerCurrencies(tx);
  const people = await peopleOf(
    tx,
    dueDates.map((row) => row.userId),
  );
  return {
    ...summaryOf(item, dueDates, asOf),
    asOf,
    hubDocument: item.hubDocument,
    openedByEntryId: item.openedByEntryId,
    bookCurrency: currencies.book,
    parallelCurrency: currencies.parallel,
    movements: movements.map((row) => ({
      id: row.id,
      kind: row.kind,
      adjusted: row.adjusted,
      entryId: row.entryId,
      fiscalYear: row.fiscalYear,
      number: row.number,
      entryDate: row.entryDate,
      description: row.description,
      lineNo: row.lineNo,
      memo: row.memo,
      amounts: {
        openMinor: row.amountMinor.toString(),
        bookMinor: row.bookMinor.toString(),
        parallelMinor: text(row.parallelMinor),
      },
      balance: {
        openMinor: row.balanceMinor.toString(),
        bookMinor: row.balanceBookMinor.toString(),
        parallelMinor: text(row.balanceParallelMinor),
      },
    })),
    dueDates: dueDates.map((row) => ({
      dueOn: row.dueOn,
      effectiveOn: row.effectiveOn,
      setBy: row.setBy,
      by: personOrNull(people, row.userId),
      reason: row.reason,
      createdAt: row.recordedAt,
    })),
  };
}

/**
 * The accounts the ageing reads: those asked, each a document control account (`VALIDATION_FAILED`
 * otherwise), or by default the document control accounts on trade receivables.
 */
async function ageingAccounts(tx: Transaction, asked: readonly string[]) {
  const rows = await tx
    .select({ id: chartAccounts.id, code: chartAccounts.code, name: chartAccounts.name })
    .from(chartAccounts)
    .where(
      and(
        eq(chartAccounts.isControl, true),
        eq(chartAccounts.itemKind, 'document'),
        asked.length > 0
          ? inArray(chartAccounts.id, [...asked])
          : eq(chartAccounts.statementLine, DEFAULT_AGEING_LINE),
      ),
    )
    .orderBy(chartAccounts.code);
  if (rows.length < asked.length) {
    throw new CodedException('VALIDATION_FAILED', 'Not a document control account', [
      { path: ['accounts'], message: 'Each account must be a document control account' },
    ]);
  }
  return rows;
}

async function readAgeing(tx: Transaction, query: AgeingQuery): Promise<AgeingReport> {
  const asOf = query.asOf ?? todayInDamascus();
  const currencies = await ledgerCurrencies(tx);
  const currency = ledgerCurrency(currencies, query.ledger);
  const accounts = await ageingAccounts(tx, query.accounts);
  const items =
    accounts.length === 0
      ? []
      : await readItemsAt(tx, {
          asOf,
          kind: 'document',
          accountIds: accounts.map((account) => account.id),
          ...(query.client && { clientValueId: query.client }),
          state: 'open',
        });
  const dueDates = await readDueDates(
    tx,
    items.map((item) => item.id),
  );
  const byId = new Map(items.map((item) => [item.id, item]));
  const ageing = ageingOf(
    items.map((item) => ({
      itemId: item.id,
      clientId: item.clientValueId,
      currency: item.currency,
      documentDate: item.documentDate,
      dueDates: dueDates.filter((row) => row.itemId === item.id),
      openMinor: item.openMinor,
      carryingMinor: query.ledger === 'book' ? item.bookMinor : (item.parallelMinor ?? 0n),
    })),
    asOf,
  );
  const clients = ageing.clients.map((client) => {
    const first = byId.get(client.items[0]?.itemId ?? '');
    return {
      client: first ? clientOf(first) : null,
      buckets: bucketText(client.buckets),
      totalMinor: client.totalMinor.toString(),
      items: client.items.map((aged) => {
        const item = byId.get(aged.itemId) as ItemAtDate;
        return {
          itemId: aged.itemId,
          account: { id: item.accountId, code: item.accountCode, name: item.accountName },
          reference: item.reference,
          currency: item.currency,
          documentDate: item.documentDate,
          dueOn: aged.dueOn,
          daysPastDue: aged.daysPastDue,
          bucket: aged.bucket,
          openMinor: aged.openMinor.toString(),
          carryingMinor: aged.carryingMinor.toString(),
          adjusted: item.adjusted,
        };
      }),
    };
  });
  // By client name; the items without a client last.
  clients.sort((a, b) =>
    a.client === null
      ? 1
      : b.client === null
        ? -1
        : a.client.name.localeCompare(b.client.name, 'ar') || (a.client.id < b.client.id ? -1 : 1),
  );
  return {
    asOf,
    ledger: query.ledger,
    ledgerCurrency: currency,
    accounts,
    clients,
    buckets: bucketText(ageing.buckets),
    totalMinor: ageing.totalMinor.toString(),
    currencyTotals: ageing.currencies.map((total) => ({
      currency: total.currency,
      buckets: bucketText(total.buckets),
      totalMinor: total.totalMinor.toString(),
    })),
  };
}

/** A value of the client type, or `NOT_FOUND` (another company's id answers the same). */
async function clientValue(tx: Transaction, valueId: string): Promise<ClientRef> {
  const [value] = await tx
    .select({ id: dimensionValues.id, code: dimensionValues.code, name: dimensionValues.name })
    .from(dimensionValues)
    .innerJoin(
      dimensionTypes,
      sql`${dimensionTypes.companyId} = ${dimensionValues.companyId} and ${dimensionTypes.id} = ${dimensionValues.typeId}`,
    )
    .where(and(eq(dimensionValues.id, valueId), eq(dimensionTypes.code, 'client')));
  if (!value) throw new CodedException('NOT_FOUND', 'No such client');
  return value;
}

async function readStatement(
  tx: Transaction,
  valueId: string,
  query: ClientStatementQuery,
): Promise<ClientStatement> {
  const client = await clientValue(tx, valueId);
  const currencies = await ledgerCurrencies(tx);
  const currency = ledgerCurrency(currencies, query.ledger);
  const to = query.to ?? todayInDamascus();
  const from = query.from ?? null;
  const rows = await readClientStatement(tx, {
    clientValueId: valueId,
    from,
    to,
    ledger: query.ledger,
    currency: query.currency ?? null,
  });
  const balance = (row: { currency: CurrencyCode; amountMinor: bigint; ledgerMinor: bigint }) => ({
    currency: row.currency,
    amountMinor: row.amountMinor.toString(),
    ledgerMinor: row.ledgerMinor.toString(),
  });
  return {
    client,
    from,
    to,
    ledger: query.ledger,
    ledgerCurrency: currency,
    currency: query.currency ?? null,
    opening: rows.opening.map(balance),
    openingLedgerMinor: rows.openingLedgerMinor.toString(),
    lines: rows.movements.map((row) => ({
      movementId: row.id,
      entryId: row.entryId,
      fiscalYear: row.fiscalYear,
      number: row.number,
      entryDate: row.entryDate,
      description: row.description,
      memo: row.memo,
      itemId: row.itemId,
      itemReference: row.itemReference,
      itemKind: row.itemKind,
      account: { id: row.accountId, code: row.accountCode, name: row.accountName },
      kind: row.kind,
      adjusted: row.adjusted,
      currency: row.currency,
      amountMinor: row.amountMinor.toString(),
      ledgerMinor: row.ledgerMinor.toString(),
      balanceMinor: row.balanceMinor.toString(),
      ledgerBalanceMinor: row.ledgerBalanceMinor.toString(),
    })),
    closing: rows.closing.map(balance),
    closingLedgerMinor: rows.closingLedgerMinor.toString(),
  };
}

/** A currency as the exports name it: SYP under its printed name (ADR 0007). */
const currencyName = (currency: CurrencyCode) =>
  currency === 'SYP' ? ar.accounting.sypPrintedName : ar.accounting.currencies[currency];

const cell = (amountMinor: string, currency: CurrencyCode) =>
  spreadsheetAmount(BigInt(amountMinor), currency);

/** The ageing's workbook: one row per item under its client, amounts as numbers (S04 "Printing"). */
export async function ageingWorkbook(report: AgeingReport): Promise<Buffer> {
  const labels = ar.openItems.ageingExport;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(labels.sheet, { views: [{ rightToLeft: true }] });
  sheet.addRow([labels.asOf, report.asOf]);
  sheet.addRow([labels.ledger, ar.accounting.ledger[report.ledger]]);
  sheet.addRow([]);
  const header = sheet.addRow([
    labels.client,
    labels.clientCode,
    labels.account,
    labels.reference,
    labels.documentDate,
    labels.dueOn,
    labels.daysPastDue,
    labels.bucket,
    labels.currency,
    labels.openAmount,
    labels.carryingCurrency,
    labels.carryingAmount,
    labels.adjusted,
  ]);
  header.font = { bold: true };
  for (const client of report.clients) {
    for (const item of client.items) {
      sheet.addRow([
        client.client?.name ?? ar.openItems.labels.noClient,
        client.client?.code ?? '',
        item.account.code,
        item.reference,
        item.documentDate,
        item.dueOn,
        item.daysPastDue,
        ar.openItems.buckets[item.bucket],
        currencyName(item.currency),
        cell(item.openMinor, item.currency),
        currencyName(report.ledgerCurrency),
        cell(item.carryingMinor, report.ledgerCurrency),
        item.adjusted ? labels.adjusted : '',
      ]);
    }
  }
  sheet.addRow([]);
  const totals = sheet.addRow([
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    ...AGEING_BUCKETS.map((bucket) => ar.openItems.buckets[bucket]),
  ]);
  totals.font = { bold: true };
  sheet.addRow([
    currencyName(report.ledgerCurrency),
    '',
    '',
    '',
    '',
    '',
    '',
    ...AGEING_BUCKETS.map((bucket) => cell(report.buckets[bucket], report.ledgerCurrency)),
  ]);
  for (const total of report.currencyTotals) {
    sheet.addRow([
      currencyName(total.currency),
      '',
      '',
      '',
      '',
      '',
      '',
      ...AGEING_BUCKETS.map((bucket) => cell(total.buckets[bucket], total.currency)),
    ]);
  }
  sheet.getColumn(2).numFmt = '@';
  sheet.getColumn(3).numFmt = '@';
  sheet.getColumn(4).numFmt = '@';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** The client statement's workbook: the opening, every movement, the closing (S04 "Printing"). */
export async function statementWorkbook(statement: ClientStatement): Promise<Buffer> {
  const labels = ar.openItems.statementExport;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(labels.sheet, { views: [{ rightToLeft: true }] });
  sheet.addRow([labels.client, statement.client.name, statement.client.code ?? '']);
  sheet.addRow([labels.from, statement.from ?? '']);
  sheet.addRow([labels.to, statement.to]);
  sheet.addRow([labels.ledger, ar.accounting.ledger[statement.ledger]]);
  sheet.addRow([]);
  const header = sheet.addRow([
    labels.date,
    labels.entry,
    labels.description,
    labels.memo,
    labels.account,
    labels.item,
    labels.movement,
    labels.currency,
    labels.amount,
    labels.balance,
    labels.ledgerCurrency,
    labels.ledgerAmount,
    labels.ledgerBalance,
    labels.adjusted,
  ]);
  header.font = { bold: true };
  const ledgerName = currencyName(statement.ledgerCurrency);
  for (const opening of statement.opening) {
    sheet.addRow([
      statement.from ?? '',
      '',
      labels.opening,
      '',
      '',
      '',
      '',
      currencyName(opening.currency),
      '',
      cell(opening.amountMinor, opening.currency),
      ledgerName,
      '',
      cell(opening.ledgerMinor, statement.ledgerCurrency),
      '',
    ]);
  }
  for (const line of statement.lines) {
    sheet.addRow([
      line.entryDate,
      `${line.fiscalYear}/${line.number}`,
      line.description,
      line.memo ?? '',
      line.account.code,
      line.itemReference,
      ar.openItems.movements[line.kind],
      currencyName(line.currency),
      cell(line.amountMinor, line.currency),
      cell(line.balanceMinor, line.currency),
      ledgerName,
      cell(line.ledgerMinor, statement.ledgerCurrency),
      cell(line.ledgerBalanceMinor, statement.ledgerCurrency),
      line.adjusted ? labels.adjusted : '',
    ]);
  }
  for (const closing of statement.closing) {
    sheet.addRow([
      statement.to,
      '',
      labels.closing,
      '',
      '',
      '',
      '',
      currencyName(closing.currency),
      '',
      cell(closing.amountMinor, closing.currency),
      ledgerName,
      '',
      cell(closing.ledgerMinor, statement.ledgerCurrency),
      '',
    ]);
  }
  sheet.getColumn(2).numFmt = '@';
  sheet.getColumn(5).numFmt = '@';
  sheet.getColumn(6).numFmt = '@';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
