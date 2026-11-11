import { createHash } from 'node:crypto';
import {
  type ClosingRate,
  type CrossRate,
  type CurrencyCode,
  DomainError,
  type ExchangeRate,
  type Ledger,
  type MissingClosingRate,
  type PostedRevaluation,
  type RevaluationBalance as RevaluationBalanceRow,
  type RevaluationPostResult,
  type RevaluationPreview,
  type RevaluationState,
} from '@vertex-mizan/contracts';
import {
  type ClosingRateRows,
  canonicalJson,
  type Dimensions,
  lastDayOfMonth,
  ledgerPolicyRate,
  type RevaluationBalance,
  type RevaluedBalance,
  revaluationFingerprintValue,
  revaluationTotals,
  revalueBalance,
} from '@vertex-mizan/ledger';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type AuditActor, writeCompanyAudit } from '../audit.js';
import type { Transaction } from '../client.js';
import { post, ratesOn } from '../posting/post.js';
import { chartAccounts } from '../schema/chart.js';
import { companySettings } from '../schema/companies.js';
import { dimensionTypes, dimensionValues } from '../schema/dimensions.js';
import {
  dimensionSetValues,
  journalEntries,
  ledgerHeads,
  periods,
  revaluations,
} from '../schema/ledger.js';
import { ledgersOf } from './companies.js';
import { publicationCalendar } from './rates.js';

// The month-end revaluation of one ledger (S07 rules 10–18, ADR 0007, ADR 0016; scenario
// `currency/month-end-revaluation`): the preview reads each monetary balance in another currency at
// the month's end, with its carrying amount and what the same day already revalued, and the closing
// rates; `packages/ledger` decides every amount. The posting repeats the preview under the ledger
// head's lock, and posts the entry and its reversal through `post()` in one transaction.

/** The ledger's names as the entry's description shows them (S07 "Printing"). */
const LEDGER_NAMES: Record<Ledger, string> = {
  book: 'الدفتر الأساسي',
  parallel: 'الدفتر الموازي',
};

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** One balance as read, with what the preview shows of it. */
interface ReadBalance extends RevaluationBalance {
  readonly accountCode: string;
  readonly accountName: string;
  readonly blocked: boolean;
  readonly reference: string | null;
  readonly dimensionSetId: string;
  readonly values: RevaluationBalanceRow['values'];
}

/** A ledger's revaluation of a month as computed now, before any posting. */
interface Computed {
  readonly ledgerCurrency: CurrencyCode;
  readonly lastDay: string;
  readonly balances: readonly (ReadBalance & {
    readonly targetMinor: bigint | null;
    readonly differenceMinor: bigint | null;
  })[];
  readonly closingRates: readonly ClosingRate[];
  readonly missingRates: readonly MissingClosingRate[];
  /** The first `RATE_MISSING` refusal, which a posting answers with. */
  readonly missing: DomainError | null;
  readonly fingerprint: string;
  readonly state: RevaluationState;
}

const ledgerColumns = (ledger: Ledger) =>
  ledger === 'book'
    ? {
        line: sql.raw('book_minor'),
        debit: sql.raw('book_debit_minor'),
        credit: sql.raw('book_credit_minor'),
      }
    : {
        line: sql.raw('parallel_minor'),
        debit: sql.raw('parallel_debit_minor'),
        credit: sql.raw('parallel_credit_minor'),
      };

/**
 * The open items of monetary control accounts in a currency other than `currency`, at the end of
 * `lastDay` (rule 10): the open transaction amount, the carrying amount in the ledger without
 * revaluation movements, and what revaluation entries dated on `lastDay` moved.
 */
async function readItems(tx: Transaction, ledger: Ledger, currency: CurrencyCode, lastDay: string) {
  const { line } = ledgerColumns(ledger);
  const result = await tx.execute<{
    item_id: string;
    account_id: string;
    dimension_set_id: string;
    currency: string;
    reference: string;
    transaction: string;
    carrying: string;
    revalued: string;
  }>(sql`
    select i.id as item_id, i.account_id, i.dimension_set_id, i.currency, i.reference,
           sum(m.amount_minor)::text as transaction,
           coalesce(sum(m.${line}) filter (where m.kind <> 'revaluation'), 0)::text as carrying,
           coalesce(sum(m.${line}) filter (where m.kind = 'revaluation'
             and m.entry_date = ${lastDay} and e.reverses_entry_id is null), 0)::text as revalued
    from public.open_items i
    join public.chart_accounts a on a.company_id = i.company_id and a.id = i.account_id
    join public.open_item_movements m on m.company_id = i.company_id and m.item_id = i.id
    join public.journal_entries e on e.company_id = m.company_id and e.id = m.entry_id
    where a.is_monetary and i.currency <> ${currency} and m.entry_date <= ${lastDay}
    group by i.id, i.account_id, i.dimension_set_id, i.currency, i.reference
    having sum(m.amount_minor) <> 0
      or coalesce(sum(m.${line}) filter (where m.kind <> 'revaluation'), 0) <> 0
      or coalesce(sum(m.${line}) filter (where m.kind = 'revaluation'
        and m.entry_date = ${lastDay} and e.reverses_entry_id is null), 0) <> 0`);
  return result.rows;
}

/**
 * The balances of monetary accounts that are not control accounts, per account, dimension set and
 * currency other than `currency`, at the end of `period` (rule 10; owner, 2026-11-11): the
 * transaction balance and the ledger's from the period balances, less the lines of revaluation
 * entries and their reversals for the carrying amount, and what revaluation entries dated on
 * `lastDay` posted.
 */
async function readAccountBalances(
  tx: Transaction,
  ledger: Ledger,
  currency: CurrencyCode,
  period: string,
  lastDay: string,
) {
  const { line, debit, credit } = ledgerColumns(ledger);
  const result = await tx.execute<{
    account_id: string;
    dimension_set_id: string;
    currency: string;
    transaction: string;
    carrying: string;
    revalued: string;
  }>(sql`
    with totals as (
      select b.account_id, b.dimension_set_id, b.currency,
             sum(b.debit_minor - b.credit_minor) as transaction,
             sum(b.${debit} - b.${credit}) as total
      from public.period_balances b
      join public.periods p on p.company_id = b.company_id and p.id = b.period_id
      join public.chart_accounts a on a.company_id = b.company_id and a.id = b.account_id
      where p.period <= ${period} and a.is_monetary and not a.is_control
        and b.currency <> ${currency}
      group by b.account_id, b.dimension_set_id, b.currency
    ), revalued as (
      select l.account_id, l.dimension_set_id, l.currency,
             sum(l.${line}) as all_revaluations,
             coalesce(sum(l.${line}) filter (where e.entry_date = ${lastDay}
               and e.reverses_entry_id is null), 0) as revalued
      from public.journal_lines l
      join public.journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
      where e.source = 'revaluation' and e.entry_date <= ${lastDay} and l.currency <> ${currency}
      group by l.account_id, l.dimension_set_id, l.currency
    )
    select t.account_id, t.dimension_set_id, t.currency, t.transaction::text as transaction,
           (t.total - coalesce(r.all_revaluations, 0))::text as carrying,
           coalesce(r.revalued, 0)::text as revalued
    from totals t
    left join revalued r using (account_id, dimension_set_id, currency)
    where t.transaction <> 0 or t.total - coalesce(r.all_revaluations, 0) <> 0
      or coalesce(r.revalued, 0) <> 0`);
  return result.rows;
}

/** The values of dimension sets, by set, with each value's type for `Dimensions`. */
async function setValuesOf(tx: Transaction, setIds: readonly string[]) {
  if (setIds.length === 0)
    return new Map<string, (RevaluationBalanceRow['values'][number] & { typeId: string })[]>();
  const rows = await tx
    .select({
      setId: dimensionSetValues.setId,
      typeId: dimensionSetValues.typeId,
      typeCode: dimensionTypes.code,
      id: dimensionValues.id,
      code: dimensionValues.code,
      name: dimensionValues.name,
      archivedAt: dimensionValues.archivedAt,
    })
    .from(dimensionSetValues)
    .innerJoin(
      dimensionTypes,
      and(
        eq(dimensionTypes.companyId, dimensionSetValues.companyId),
        eq(dimensionTypes.id, dimensionSetValues.typeId),
      ),
    )
    .innerJoin(
      dimensionValues,
      and(
        eq(dimensionValues.companyId, dimensionSetValues.companyId),
        eq(dimensionValues.id, dimensionSetValues.valueId),
      ),
    )
    .where(inArray(dimensionSetValues.setId, [...setIds]))
    .orderBy(asc(dimensionTypes.code));
  const sets = new Map<string, (RevaluationBalanceRow['values'][number] & { typeId: string })[]>();
  for (const row of rows) {
    const values = sets.get(row.setId) ?? [];
    values.push({
      typeId: row.typeId,
      typeCode: row.typeCode,
      id: row.id,
      code: row.code,
      name: row.name,
      archived: row.archivedAt !== null,
    });
    sets.set(row.setId, values);
  }
  return sets;
}

/** The ledger's settings, refusing the parallel ledger of a company that keeps none. */
async function settingsFor(tx: Transaction, ledger: Ledger) {
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  const ledgers = ledgersOf(settings);
  if (ledger === 'parallel' && ledgers.parallel === null) {
    throw new DomainError('VALIDATION_FAILED', 'The company keeps no parallel ledger', { ledger });
  }
  return { settings, ledgers };
}

/** The ledger's revaluation of `period` as the books and the rates stand now (rules 10–12, 15). */
async function compute(tx: Transaction, period: string, ledger: Ledger): Promise<Computed> {
  const { settings, ledgers } = await settingsFor(tx, ledger);
  const ledgerCurrency = (ledger === 'book' ? ledgers.book : ledgers.parallel)
    ?.currency as CurrencyCode;
  const lastDay = lastDayOfMonth(`${period}-01`);
  const [items, accounts] = [
    await readItems(tx, ledger, ledgerCurrency, lastDay),
    await readAccountBalances(tx, ledger, ledgerCurrency, period, lastDay),
  ];
  const accountIds = [...new Set([...items, ...accounts].map((row) => row.account_id))];
  const chart =
    accountIds.length === 0
      ? []
      : await tx
          .select({
            id: chartAccounts.id,
            code: chartAccounts.code,
            name: chartAccounts.name,
            blockedAt: chartAccounts.blockedAt,
          })
          .from(chartAccounts)
          .where(inArray(chartAccounts.id, accountIds));
  const sets = await setValuesOf(tx, [
    ...new Set([...items, ...accounts].map((row) => row.dimension_set_id)),
  ]);
  const read = [
    ...items.map((row) => ({ ...row, item: row.item_id as string | null })),
    ...accounts.map((row) => ({ ...row, item: null, reference: null })),
  ].map((row): ReadBalance => {
    const account = chart.find((candidate) => candidate.id === row.account_id);
    if (account === undefined) throw new Error('A balance on an unknown account');
    const values = sets.get(row.dimension_set_id) ?? [];
    return {
      account: row.account_id,
      dimensions: Object.fromEntries(values.map((value) => [value.typeId, value.id])) as Dimensions,
      ...(row.item !== null && { item: row.item }),
      currency: row.currency as CurrencyCode,
      transactionMinor: BigInt(row.transaction),
      carryingMinor: BigInt(row.carrying),
      revaluedMinor: BigInt(row.revalued),
      accountCode: account.code,
      accountName: account.name,
      blocked: account.blockedAt !== null,
      reference: row.reference,
      dimensionSetId: row.dimension_set_id,
      values: values.map(({ typeId: _, ...value }) => value),
    };
  });
  const textOf = (balance: ReadBalance) =>
    (sets.get(balance.dimensionSetId) ?? []).map((value) => value.code ?? value.name).join('/');
  read.sort(
    (a, b) =>
      a.accountCode.localeCompare(b.accountCode) ||
      (a.reference ?? '').localeCompare(b.reference ?? '') ||
      textOf(a).localeCompare(textOf(b)) ||
      a.currency.localeCompare(b.currency) ||
      a.dimensionSetId.localeCompare(b.dimensionSetId),
  );

  const { rates, ids } = await ratesOn(tx, lastDay);
  const calendar = await publicationCalendar(tx, settings.bulletinDaysOff);
  const rateType = (ledger === 'book' ? ledgers.book : ledgers.parallel)?.ratePolicy.rateType;
  if (rateType === undefined) throw new Error('A ledger without its policy');
  const currencies = [...new Set(read.map((balance) => balance.currency))].sort();
  const closing = new Map<CurrencyCode, ExchangeRate | CrossRate>();
  const missingRates: MissingClosingRate[] = [];
  let missing: DomainError | null = null;
  for (const currency of currencies) {
    try {
      closing.set(
        currency,
        ledgerPolicyRate({ ledgers, ledger, from: currency, on: lastDay, rates, calendar }),
      );
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== 'RATE_MISSING') throw error;
      missing ??= error;
      missingRates.push({ currency, to: ledgerCurrency, rateType, on: lastDay });
    }
  }
  const rowsOf = (rate: ExchangeRate | CrossRate) =>
    ('legs' in rate ? [...rate.legs] : [rate]).map((row) => {
      const rateId = ids.get(row);
      if (rateId === undefined) throw new Error('A closing rate without its row');
      return {
        rateId,
        base: row.base,
        quote: row.quote,
        rate: row.rate,
        effectiveOn: row.effectiveOn,
      };
    });
  const closingRates: ClosingRate[] = [...closing].map(([currency, rate]) => ({
    currency,
    rateType,
    rows: rowsOf(rate),
  }));
  const balances = read.map((balance) => {
    const rate = closing.get(balance.currency);
    if (rate === undefined) return { ...balance, targetMinor: null, differenceMinor: null };
    const revalued = revalueBalance(balance, ledgers, ledger, rate);
    return {
      ...balance,
      targetMinor: revalued.targetMinor,
      differenceMinor: revalued.differenceMinor,
    };
  });
  const fingerprint = sha256(
    canonicalJson(
      revaluationFingerprintValue({
        period,
        ledger,
        posted: (await postedRevaluations(tx, period, ledger)).map((revaluation) => revaluation.id),
        rates: closingRates.map(
          (rate): ClosingRateRows => ({
            currency: rate.currency,
            rowIds: rate.rows.map((row) => row.rateId),
          }),
        ),
        balances,
      }),
    ),
  );
  const state: RevaluationState =
    missingRates.length > 0
      ? 'rate_missing'
      : balances.some((balance) => balance.differenceMinor !== 0n)
        ? 'to_post'
        : 'current';
  return {
    ledgerCurrency,
    lastDay,
    balances,
    closingRates,
    missingRates,
    missing,
    fingerprint,
    state,
  };
}

/** The revaluations posted for `period` and `ledger`, oldest first, with their entries. */
async function postedRevaluations(
  tx: Transaction,
  period: string,
  ledger: Ledger,
): Promise<PostedRevaluation[]> {
  const entry = alias(journalEntries, 'entry');
  const reversal = alias(journalEntries, 'reversal');
  const rows = await tx
    .select({
      revaluation: revaluations,
      entry: {
        id: entry.id,
        date: entry.entryDate,
        fiscalYear: entry.fiscalYear,
        number: entry.number,
      },
      reversal: {
        id: reversal.id,
        date: reversal.entryDate,
        fiscalYear: reversal.fiscalYear,
        number: reversal.number,
      },
    })
    .from(revaluations)
    .innerJoin(
      periods,
      and(eq(periods.companyId, revaluations.companyId), eq(periods.id, revaluations.periodId)),
    )
    .innerJoin(
      entry,
      and(eq(entry.companyId, revaluations.companyId), eq(entry.id, revaluations.entryId)),
    )
    .innerJoin(
      reversal,
      and(
        eq(reversal.companyId, revaluations.companyId),
        eq(reversal.id, revaluations.reversalEntryId),
      ),
    )
    .where(and(eq(periods.period, period), eq(revaluations.ledger, ledger)))
    .orderBy(asc(revaluations.createdAt), asc(revaluations.id));
  return rows.map((row) => ({
    id: row.revaluation.id,
    period,
    ledger,
    adjusting: row.revaluation.adjusting,
    fingerprint: row.revaluation.fingerprint,
    entry: row.entry,
    reversal: row.reversal,
    userId: row.revaluation.userId,
    createdAt: row.revaluation.createdAt.toISOString(),
  }));
}

async function periodState(tx: Transaction, period: string): Promise<string | null> {
  const [row] = await tx
    .select({ state: periods.state })
    .from(periods)
    .where(eq(periods.period, period));
  return row?.state ?? null;
}

function refuseClosed(state: string | null, period: string): void {
  if (state === 'closed') {
    throw new DomainError('PERIOD_CLOSED', `The period ${period} is closed`, { period });
  }
}

/**
 * A ledger's revaluation preview of `period` (S07 rules 10–17, "API"): the closing rates with
 * their rows, the rates missing, each balance with its transaction, carrying, target, already
 * revalued and difference amounts, the gains and losses a posting adds, the revaluations posted,
 * the state and the fingerprint. Refused for a closed month (`PERIOD_CLOSED`); open at any time
 * otherwise, `ended` saying whether a posting may follow (rule 16). `today` is the date in
 * Asia/Damascus.
 */
export async function previewRevaluation(
  tx: Transaction,
  input: { readonly period: string; readonly ledger: Ledger; readonly today: string },
): Promise<RevaluationPreview> {
  const { period, ledger } = input;
  refuseClosed(await periodState(tx, period), period);
  const computed = await compute(tx, period, ledger);
  const totals = revaluationTotals(
    computed.balances.flatMap((balance) =>
      balance.differenceMinor === null ? [] : [balance.differenceMinor],
    ),
  );
  return {
    period,
    ledger,
    ledgerCurrency: computed.ledgerCurrency,
    lastDay: computed.lastDay,
    ended: input.today > computed.lastDay,
    state: computed.state,
    fingerprint: computed.fingerprint,
    closingRates: [...computed.closingRates],
    missingRates: [...computed.missingRates],
    balances: computed.balances.map((balance) => ({
      accountId: balance.account,
      accountCode: balance.accountCode,
      accountName: balance.accountName,
      blocked: balance.blocked,
      item:
        balance.item === undefined
          ? null
          : { id: balance.item, reference: balance.reference ?? '' },
      values: [...balance.values],
      currency: balance.currency,
      transactionMinor: balance.transactionMinor.toString(),
      carryingMinor: balance.carryingMinor.toString(),
      targetMinor: balance.targetMinor?.toString() ?? null,
      revaluedMinor: balance.revaluedMinor.toString(),
      differenceMinor: balance.differenceMinor?.toString() ?? null,
    })),
    gainMinor: totals.gainMinor.toString(),
    lossMinor: totals.lossMinor.toString(),
    posted: await postedRevaluations(tx, period, ledger),
  };
}

/**
 * Posts a ledger's revaluation of `period` exactly as previewed (S07 rules 13–18), inside
 * `withCompany`, in the lock order of ADR 0008: the ledger head `FOR UPDATE` first, so nothing
 * posts between the recomputation and the entries. A preview already posted (its fingerprint) is
 * answered with its first result (a double submit, rule 17). Refused for a closed month
 * (`PERIOD_CLOSED`), a month not ended in Asia/Damascus (`PERIOD_NOT_ENDED`), a closing rate
 * missing (`RATE_MISSING`, the pair and the day) and a preview that changed (`REVALUATION_CHANGED`,
 * with the new fingerprint). With every difference zero it posts nothing (`posted: false`).
 * Otherwise `post()` writes, under `revaluation:<period>:<ledger>:<fingerprint>`, the entry on the
 * month's last day, its reversal on the next month's first day and the revaluation's row
 * (`adjusting` when one of the month and ledger stands); then its `revaluation.posted` audit row.
 */
export async function postRevaluation(
  tx: Transaction,
  input: {
    readonly period: string;
    readonly ledger: Ledger;
    readonly fingerprint: string;
    readonly today: string;
    readonly actor: Extract<AuditActor, { kind: 'person' }>;
  },
): Promise<RevaluationPostResult> {
  const { period, ledger, fingerprint, today, actor } = input;
  const [head] = await tx
    .select({ companyId: ledgerHeads.companyId })
    .from(ledgerHeads)
    .for('update');
  if (!head) throw new Error('A company without its ledger head');
  const done = (await postedRevaluations(tx, period, ledger)).find(
    (revaluation) => revaluation.fingerprint === fingerprint,
  );
  if (done !== undefined) {
    return {
      posted: true,
      revaluation: done,
      entryId: done.entry.id,
      reversalEntryId: done.reversal.id,
    };
  }
  refuseClosed(await periodState(tx, period), period);
  const lastDay = lastDayOfMonth(`${period}-01`);
  if (today <= lastDay) {
    throw new DomainError('PERIOD_NOT_ENDED', `The month ${period} has not ended`, { period });
  }
  const computed = await compute(tx, period, ledger);
  if (computed.missing !== null) throw computed.missing;
  if (computed.fingerprint !== fingerprint) {
    throw new DomainError('REVALUATION_CHANGED', 'The revaluation changed since its preview', {
      fingerprint: computed.fingerprint,
    });
  }
  const balances: RevaluedBalance[] = computed.balances.flatMap((balance) =>
    balance.differenceMinor === null ||
    balance.targetMinor === null ||
    balance.differenceMinor === 0n
      ? []
      : [
          {
            account: balance.account,
            dimensions: balance.dimensions,
            ...(balance.item !== undefined && { item: balance.item }),
            currency: balance.currency,
            transactionMinor: balance.transactionMinor,
            carryingMinor: balance.carryingMinor,
            revaluedMinor: balance.revaluedMinor,
            targetMinor: balance.targetMinor,
            differenceMinor: balance.differenceMinor,
          },
        ],
  );
  if (balances.length === 0) {
    return { posted: false, revaluation: null, entryId: null, reversalEntryId: null };
  }
  const rates = [...computed.closingRates];
  const entry = await post(tx, {
    client: 'system',
    idempotencyKey: `revaluation:${period}:${ledger}:${fingerprint}`,
    entryDate: lastDay,
    description: `إعادة تقييم آخر الشهر ${period} — ${LEDGER_NAMES[ledger]}`,
    reference: null,
    draftId: null,
    preparedByUserId: actor.userId,
    approvedByUserId: null,
    actor,
    content: { kind: 'revaluation', period, ledger, fingerprint, rates, balances, today },
  });
  const [row] = await tx.select().from(revaluations).where(eq(revaluations.entryId, entry.id));
  if (!row) throw new Error('A revaluation entry without its row');
  await writeCompanyAudit(tx, row.companyId, actor, {
    action: 'revaluation.posted',
    entityType: 'revaluation',
    entityId: row.id,
    after: {
      period,
      ledger,
      adjusting: row.adjusting,
      fingerprint,
      rates,
      entryId: entry.id,
      reversalEntryId: row.reversalEntryId,
    },
  });
  const revaluation = (await postedRevaluations(tx, period, ledger)).find(
    (candidate) => candidate.id === row.id,
  );
  if (revaluation === undefined) throw new Error('A revaluation not read back');
  return { posted: true, revaluation, entryId: entry.id, reversalEntryId: row.reversalEntryId };
}
