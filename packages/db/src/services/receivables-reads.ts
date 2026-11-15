import {
  AGEING_BUCKETS,
  type AgeingQuery,
  type AgeingReport,
  ageingAccountIds,
  type BucketAmounts,
  COUNTERPARTY_TYPES,
  type CounterpartyRef,
  type CounterpartyStatement,
  type CounterpartyStatementQuery,
  type CounterpartyType,
  type CurrencyCode,
  DomainError,
  type Ledger,
} from '@vertex-mizan/contracts';
import { ageingOf, type BucketTotals } from '@vertex-mizan/ledger';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Transaction } from '../client.js';
import {
  type ItemAtDate,
  readCounterpartyStatement,
  readDueDates,
  readItemsAt,
} from '../posting/item-reads.js';
import { chartAccounts } from '../schema/chart.js';
import { companySettings } from '../schema/companies.js';
import { dimensionTypes, dimensionValues } from '../schema/dimensions.js';
import { ledgersOf } from './companies.js';

// The receivables' reports (S04 "Reports"), moved from apps/api in S09 so the worker prints the
// same ageing and counterparty statement as PDFs (S09 rule 36); S11 (ADR 0022) reads any
// counterparty, a client, supplier or worker. Every figure is summed in SQL or by
// `packages/ledger`, never here.

/** The statement line whose document control accounts the ageing reads by default (rule 16). */
const DEFAULT_AGEING_LINE = 'bs.trade_receivables';

/** The company's ledger currencies. */
async function ledgerCurrencies(
  tx: Transaction,
): Promise<{ book: CurrencyCode; parallel: CurrencyCode | null }> {
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  const ledgers = ledgersOf(settings);
  return { book: ledgers.book.currency, parallel: ledgers.parallel?.currency ?? null };
}

/** An item's counterparty as the reports name it; null for an item without one. */
export const counterpartyRefOf = (item: ItemAtDate): CounterpartyRef | null =>
  item.counterpartyValueId === null || item.counterpartyType === null
    ? null
    : {
        id: item.counterpartyValueId,
        type: item.counterpartyType,
        code: item.counterpartyCode,
        name: item.counterpartyName ?? '',
      };

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
    throw new DomainError('VALIDATION_FAILED', 'The company keeps no parallel ledger', {
      issues: [{ path: ['ledger'], message: 'The company keeps no parallel ledger' }],
    });
  }
  return currency;
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
    throw new DomainError('VALIDATION_FAILED', 'Not a document control account', {
      issues: [{ path: ['accounts'], message: 'Each account must be a document control account' }],
    });
  }
  return rows;
}

/**
 * The receivables ageing as of a date (S04 rule 16): the document control accounts asked, or those on
 * trade receivables, their open items aged by `packages/ledger`'s `ageingOf()` in the ledger asked.
 * `today` (in Damascus) is the date when none is asked. Shared by the API and the worker's PDF.
 */
export async function readAgeingReport(
  tx: Transaction,
  query: AgeingQuery,
  today: string,
): Promise<AgeingReport> {
  const asOf = query.asOf ?? today;
  const currencies = await ledgerCurrencies(tx);
  const currency = ledgerCurrency(currencies, query.ledger);
  const accounts = await ageingAccounts(tx, ageingAccountIds(query));
  const items =
    accounts.length === 0
      ? []
      : await readItemsAt(tx, {
          asOf,
          kind: 'document',
          accountIds: accounts.map((account) => account.id),
          ...(query.counterparty && { counterpartyValueId: query.counterparty }),
          ...(query.counterpartyType && { counterpartyType: query.counterpartyType }),
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
      clientId: item.counterpartyValueId,
      currency: item.currency,
      documentDate: item.documentDate,
      dueDates: dueDates.filter((row) => row.itemId === item.id),
      openMinor: item.openMinor,
      carryingMinor: query.ledger === 'book' ? item.bookMinor : (item.parallelMinor ?? 0n),
    })),
    asOf,
  );
  const counterparties = ageing.clients.map((client) => {
    const first = byId.get(client.items[0]?.itemId ?? '');
    return {
      counterparty: first ? counterpartyRefOf(first) : null,
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
  // By counterparty name; the items without one last.
  counterparties.sort((a, b) =>
    a.counterparty === null
      ? 1
      : b.counterparty === null
        ? -1
        : a.counterparty.name.localeCompare(b.counterparty.name, 'ar') ||
          (a.counterparty.id < b.counterparty.id ? -1 : 1),
  );
  return {
    asOf,
    ledger: query.ledger,
    ledgerCurrency: currency,
    accounts,
    counterparties,
    buckets: bucketText(ageing.buckets),
    totalMinor: ageing.totalMinor.toString(),
    currencyTotals: ageing.currencies.map((total) => ({
      currency: total.currency,
      buckets: bucketText(total.buckets),
      totalMinor: total.totalMinor.toString(),
    })),
  };
}

/**
 * A value of a built-in counterparty type (client, supplier or worker), or `NOT_FOUND` (another
 * company's id answers the same).
 */
async function counterpartyValue(tx: Transaction, valueId: string): Promise<CounterpartyRef> {
  const [value] = await tx
    .select({
      id: dimensionValues.id,
      type: dimensionTypes.code,
      code: dimensionValues.code,
      name: dimensionValues.name,
    })
    .from(dimensionValues)
    .innerJoin(
      dimensionTypes,
      sql`${dimensionTypes.companyId} = ${dimensionValues.companyId} and ${dimensionTypes.id} = ${dimensionValues.typeId}`,
    )
    .where(
      and(
        eq(dimensionValues.id, valueId),
        eq(dimensionTypes.builtin, true),
        inArray(dimensionTypes.code, [...COUNTERPARTY_TYPES]),
      ),
    );
  if (!value) throw new DomainError('NOT_FOUND', 'No such counterparty');
  return { ...value, type: value.type as CounterpartyType };
}

/**
 * A counterparty's statement (S04 "Reports", S11 rule 6): its items' movements on every control
 * account with running balances, opening and closing, in the ledger asked; `NOT_FOUND` for a value
 * that is not a client, supplier or worker of the company. Shared by the API and the worker's PDF.
 */
export async function readCounterpartyStatementReport(
  tx: Transaction,
  valueId: string,
  query: CounterpartyStatementQuery,
  today: string,
): Promise<CounterpartyStatement> {
  const counterparty = await counterpartyValue(tx, valueId);
  const currencies = await ledgerCurrencies(tx);
  const currency = ledgerCurrency(currencies, query.ledger);
  const to = query.to ?? today;
  const from = query.from ?? null;
  const rows = await readCounterpartyStatement(tx, {
    counterpartyValueId: valueId,
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
    counterparty,
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
