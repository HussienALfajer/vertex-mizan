import { createHash } from 'node:crypto';
import {
  type CompanyLedgers,
  type CrossRate,
  type CurrencyCode,
  checkCurrencyDate,
  DomainError,
  type ErrorCode,
  type ExchangeRate,
  exchangeRateSchema,
  type Ledger,
  money,
  type RateSource,
  type RateType,
} from '@vertex-mizan/contracts';
import {
  balanceEntry,
  type CanonicalValue,
  type ChainConversion,
  type ChainEntry,
  type ChartAccount,
  type ChartLine,
  type Conversion,
  canonicalJson,
  chainEntryValue,
  checkLineAgainstChart,
  checkManualEntryDate,
  type Dimensions,
  type EntrySource,
  entryHash,
  fiscalYearOf,
  keptLedgers,
  type Line,
  type LineDimensionValue,
  type MeasureContext,
  manualEntryLines,
  manualReversalLines,
  periodOf,
} from '@vertex-mizan/ledger';
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { type AuditActor, writeCompanyAudit } from '../audit.js';
import type { Transaction } from '../client.js';
import { accountRequiredDimensions, accountRoles, chartAccounts } from '../schema/chart.js';
import { companySettings } from '../schema/companies.js';
import { dimensionTypes, dimensionValues } from '../schema/dimensions.js';
import {
  dimensionSets,
  dimensionSetValues,
  entryNumberCounters,
  journalEntries,
  journalLines,
  ledgerHeads,
  lineConversions,
  periods,
  postingRequests,
} from '../schema/ledger.js';
import { exchangeRates, ratePairs } from '../schema/rates.js';
import { ledgersOf } from '../services/companies.js';
import { exchangeRateOf, publicationCalendar, rateSuperseded } from '../services/rates.js';

// The posting function (ADR 0005, ADR 0008, ADR 0012, S03 rules 1–3): the only writer of the
// ledger tables. The database guards every rule again for every role; this function checks first,
// so a refusal answers with its code, and builds every amount itself with `packages/ledger`.

/** A manual line as the accountant gives it: a transaction amount, never a ledger amount. */
export interface ManualLineSpec {
  readonly accountId: string;
  /** At most one value per dimension type. */
  readonly dimensionValueIds: readonly string[];
  readonly currency: CurrencyCode;
  /** Minor units, positive debit and negative credit; never zero. */
  readonly amountMinor: bigint;
  readonly memo: string | null;
}

/** The rate a manual entry was dealt at for a pair, quoted in the company's orientation of it. */
export interface DealtRateSpec {
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  readonly rate: string;
}

/**
 * What a request posts: line specifications the function measures, or an entry it reverses, never
 * posted amounts (`packages/ledger`: measured lines are built, never taken). `today` is the date in
 * Asia/Damascus at posting, from the caller's clock (S03 rule 6). Later specs add their own kinds.
 */
export type PostingContent =
  | {
      readonly kind: 'manual';
      readonly lines: readonly ManualLineSpec[];
      readonly dealtRates: readonly DealtRateSpec[];
      readonly today: string;
    }
  | { readonly kind: 'reversal'; readonly entryId: string; readonly today: string };

/** A request to post, once by its client's idempotency key (ADR 0005 invariant 5). */
export interface PostingRequest {
  /** `manual`, `system`, or an API client's id (S05). */
  readonly client: string;
  /** A manual entry's draft id; a reversal's `reversal:<entry id>`. */
  readonly idempotencyKey: string;
  readonly entryDate: string;
  /** البيان, 1–500 characters. */
  readonly description: string;
  readonly reference: string | null;
  readonly draftId: string | null;
  readonly preparedByUserId: string | null;
  readonly approvedByUserId: string | null;
  /** Who posts: a person for a manual entry; the audit row's actor. */
  readonly actor: AuditActor;
  readonly content: PostingContent;
}

/** The posted entry; `replayed` when the request had posted it before and nothing posted now. */
export interface PostedEntryRef {
  readonly id: string;
  readonly fiscalYear: number;
  readonly number: number;
  readonly sequence: bigint;
  readonly hash: string;
  readonly replayed: boolean;
}

/** A line ready to store: the ledger's line, its memo and its dimension values by type. */
interface BuiltLine {
  readonly line: Line;
  readonly memo: string | null;
}

type Role = 'conversion_rounding' | 'fx_realised_gain' | 'fx_realised_loss';

/** Where a role's line goes until the role's account is read: replaced, or `ACCOUNT_ROLE_MISSING`. */
const roleTarget = (role: Role) => `role:${role}`;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function refuse(code: ErrorCode, message: string, details: Record<string, unknown> = {}): never {
  throw new DomainError(code, message, details);
}

/** The request as its payload hash covers it: everything it posts, not who or when. */
function payloadOf(request: PostingRequest): CanonicalValue {
  const { content } = request;
  return {
    client: request.client,
    entryDate: request.entryDate,
    description: request.description,
    reference: request.reference,
    draftId: request.draftId,
    preparedByUserId: request.preparedByUserId,
    approvedByUserId: request.approvedByUserId,
    content:
      content.kind === 'manual'
        ? {
            kind: content.kind,
            lines: content.lines.map((line) => ({
              accountId: line.accountId,
              dimensionValueIds: [...line.dimensionValueIds].sort(),
              currency: line.currency,
              amountMinor: line.amountMinor,
              memo: line.memo,
            })),
            dealtRates: content.dealtRates.map((rate) => ({ ...rate })),
          }
        : { kind: content.kind, entryId: content.entryId },
  };
}

/** The company of the transaction's `withCompany` context. */
async function contextCompany(tx: Transaction): Promise<string> {
  const result = await tx.execute<{ id: string | null }>(sql`select current_company_id() as id`);
  const id = result.rows[0]?.id;
  if (!id) throw new TypeError('post() runs inside withCompany');
  return id;
}

/** The transaction time to the millisecond, as the entry stores and hashes it. */
async function transactionTime(tx: Transaction): Promise<Date> {
  // As text: Drizzle's client returns timestamps of a raw query unparsed.
  const result = await tx.execute<{ at: string }>(
    sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at`,
  );
  const at = result.rows[0]?.at;
  if (at === undefined) throw new Error('No transaction time');
  return new Date(at);
}

/** The chart as `checkLineAgainstChart` reads it, for the accounts of `ids`. */
async function chartOf(
  tx: Transaction,
  ids: readonly string[],
): Promise<Map<string, ChartAccount>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(chartAccounts)
    .where(inArray(chartAccounts.id, [...ids]));
  const required = await tx
    .select({
      accountId: accountRequiredDimensions.accountId,
      typeId: accountRequiredDimensions.dimensionTypeId,
    })
    .from(accountRequiredDimensions)
    .where(
      and(
        inArray(accountRequiredDimensions.accountId, [...ids]),
        isNull(accountRequiredDimensions.archivedAt),
      ),
    );
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        kind: row.kind as ChartAccount['kind'],
        currency: row.currency as CurrencyCode | null,
        blocked: row.blockedAt !== null,
        archived: row.archivedAt !== null,
        isControl: row.isControl,
        requiredDimensionTypeIds: required
          .filter((link) => link.accountId === row.id)
          .map((link) => link.typeId),
      },
    ]),
  );
}

/** The dimension values of `ids` with their types; an unknown one is `NOT_FOUND`. */
async function dimensionValuesOf(
  tx: Transaction,
  ids: readonly string[],
): Promise<Map<string, LineDimensionValue>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      id: dimensionValues.id,
      typeId: dimensionValues.typeId,
      typeCode: dimensionTypes.code,
      parentValueId: dimensionValues.parentValueId,
      archivedAt: dimensionValues.archivedAt,
    })
    .from(dimensionValues)
    .innerJoin(
      dimensionTypes,
      and(
        eq(dimensionTypes.companyId, dimensionValues.companyId),
        eq(dimensionTypes.id, dimensionValues.typeId),
      ),
    )
    .where(inArray(dimensionValues.id, [...ids]));
  const values = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        typeId: row.typeId,
        typeCode: row.typeCode,
        parentValueId: row.parentValueId,
        archived: row.archivedAt !== null,
      },
    ]),
  );
  for (const id of ids) {
    if (!values.has(id)) refuse('NOT_FOUND', 'Unknown dimension value', { valueId: id });
  }
  return values;
}

/** The accounts of the roles that are set (S02 rule 7). */
async function roleAccounts(tx: Transaction): Promise<Map<string, string>> {
  const rows = await tx
    .select({ role: accountRoles.role, accountId: accountRoles.accountId })
    .from(accountRoles)
    .where(isNull(accountRoles.archivedAt));
  return new Map(rows.map((row) => [roleTarget(row.role as Role), row.accountId]));
}

/**
 * The rate rows that can be in force on `on`: of each pair and type, the newest row effective on
 * or before it, never a superseded one (S02 rules 15–16), with each row's id.
 */
async function ratesOn(
  tx: Transaction,
  on: string,
): Promise<{ rates: ExchangeRate[]; ids: Map<ExchangeRate, string> }> {
  const rows = await tx
    .selectDistinctOn([exchangeRates.base, exchangeRates.quote, exchangeRates.type])
    .from(exchangeRates)
    .where(and(lte(exchangeRates.effectiveOn, on), sql`not ${rateSuperseded}`))
    .orderBy(
      asc(exchangeRates.base),
      asc(exchangeRates.quote),
      asc(exchangeRates.type),
      desc(exchangeRates.effectiveOn),
    );
  const ids = new Map<ExchangeRate, string>();
  const rates = rows.map((row) => {
    const rate = exchangeRateOf(row);
    ids.set(rate, row.id);
    return rate;
  });
  return { rates, ids };
}

/**
 * A manual entry's dealt rates (S03 rule 13) as rates of the entry date: positive, of two
 * currencies, never SYP before the new pound (`INVALID_RATE`, `SYP_BEFORE_REDENOMINATION`), and in
 * the orientation of the company's pair when it holds one (`RATE_ORIENTATION`).
 */
async function dealtRatesOf(
  tx: Transaction,
  specs: readonly DealtRateSpec[],
  on: string,
): Promise<ExchangeRate[]> {
  const dealt: ExchangeRate[] = [];
  for (const spec of specs) {
    const parsed = exchangeRateSchema.safeParse({
      effectiveOn: on,
      base: spec.base,
      quote: spec.quote,
      rate: spec.rate,
      type: 'market',
      source: 'manual',
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const named = issue?.code === 'custom' ? issue.params?.code : undefined;
      refuse(named === 'SYP_BEFORE_REDENOMINATION' ? named : 'INVALID_RATE', 'A dealt rate', {
        base: spec.base,
        quote: spec.quote,
      });
    }
    const [held] = await tx
      .select({ base: ratePairs.base, quote: ratePairs.quote })
      .from(ratePairs)
      .where(
        or(
          and(eq(ratePairs.base, spec.base), eq(ratePairs.quote, spec.quote)),
          and(eq(ratePairs.base, spec.quote), eq(ratePairs.quote, spec.base)),
        ),
      );
    if (held && held.base !== spec.base) {
      refuse('RATE_ORIENTATION', `The pair is held as ${held.base}/${held.quote}`, {
        base: held.base,
        quote: held.quote,
      });
    }
    dealt.push(parsed.data);
  }
  return dealt;
}

/** Puts each role's account on its lines, or refuses with `ACCOUNT_ROLE_MISSING`. */
function withRoleAccounts(lines: readonly Line[], roles: ReadonlyMap<string, string>): Line[] {
  return lines.map((line) => {
    if (!line.account.startsWith('role:')) return line;
    const account = roles.get(line.account);
    if (account === undefined) {
      refuse('ACCOUNT_ROLE_MISSING', `The company has no ${line.account.slice(5)} account`, {
        role: line.account.slice(5),
      });
    }
    return { ...line, account };
  });
}

/** Checks lines against the chart (S02 rule 8, S03 rule 16), each with its dimension values. */
async function checkAgainstChart(
  tx: Transaction,
  lines: readonly Line[],
  origin: ChartLine['origin'],
): Promise<void> {
  const chart = await chartOf(tx, [...new Set(lines.map((line) => line.account))]);
  const values = await dimensionValuesOf(tx, [
    ...new Set(lines.flatMap((line) => Object.values(line.dimensions))),
  ]);
  for (const line of lines) {
    checkLineAgainstChart({
      account: chart.get(line.account),
      currency: line.transaction.currency,
      dimensions: Object.values(line.dimensions).map((id) => values.get(id) as LineDimensionValue),
      origin,
    });
  }
}

/**
 * A manual entry's lines (S03 rules 12–16): the typed lines checked against the chart first, then
 * measured anew per ledger with the dealt rates, the realised differences of an entry in several
 * currencies and the conversion rounding of an entry in one, each on its role's account.
 */
async function manualLines(
  tx: Transaction,
  content: Extract<PostingContent, { kind: 'manual' }>,
  on: string,
  ledgers: CompanyLedgers,
  daysOff: readonly number[],
): Promise<{ lines: BuiltLine[]; rateIds: Map<ExchangeRate, string> }> {
  const typed: Line[] = [];
  const specs = content.lines.map((spec) => {
    if (spec.amountMinor === 0n) refuse('VALIDATION_FAILED', 'A line of zero amount');
    return spec;
  });
  // The values of one line by type, for the chart check and the line's dimension set.
  const values = await dimensionValuesOf(tx, [
    ...new Set(specs.flatMap((spec) => spec.dimensionValueIds)),
  ]);
  const chart = await chartOf(tx, [...new Set(specs.map((spec) => spec.accountId))]);
  const dimensionsOf = specs.map((spec) => {
    const lineValues = spec.dimensionValueIds.map((id) => values.get(id) as LineDimensionValue);
    checkLineAgainstChart({
      account: chart.get(spec.accountId),
      currency: spec.currency,
      dimensions: lineValues,
      origin: 'manual',
    });
    return Object.fromEntries(lineValues.map((value) => [value.typeId, value.id])) as Dimensions;
  });
  const { rates, ids } = await ratesOn(tx, on);
  const context: MeasureContext = {
    ledgers,
    on,
    rates,
    calendar: await publicationCalendar(tx, daysOff),
  };
  const measured = manualEntryLines(
    {
      lines: specs.map((spec, index) => ({
        account: spec.accountId,
        dimensions: dimensionsOf[index] as Dimensions,
        amount: money(spec.amountMinor, spec.currency),
      })),
      dealtRates: await dealtRatesOf(tx, content.dealtRates, on),
    },
    context,
    {
      gain: { account: roleTarget('fx_realised_gain') },
      loss: { account: roleTarget('fx_realised_loss') },
    },
  );
  typed.push(
    ...balanceEntry({
      on,
      ledgers,
      lines: measured,
      rounding: { account: roleTarget('conversion_rounding') },
    }),
  );
  const lines = withRoleAccounts(typed, await roleAccounts(tx));
  // The difference and rounding lines go on the role accounts: checked as manual lines too.
  await checkAgainstChart(tx, lines.slice(specs.length), 'manual');
  return {
    lines: lines.map((line, index) => ({ line, memo: specs[index]?.memo ?? null })),
    rateIds: ids,
  };
}

/** A stored conversion as `packages/ledger` reads it: one rate, or the two quotes of a cross. */
function conversionOf(
  rows: readonly (typeof lineConversions.$inferSelect)[],
  on: string,
): Conversion | null {
  const sorted = [...rows].sort((a, b) => a.quoteNo - b.quoteNo);
  const rates = sorted.map(
    (row): ExchangeRate => ({
      effectiveOn: row.effectiveOn,
      base: row.base as CurrencyCode,
      quote: row.quote as CurrencyCode,
      rate: row.rate,
      type: row.rateType as RateType,
      source: row.rateSource as RateSource,
    }),
  );
  const [first, second] = rates;
  if (first === undefined) return null;
  if (sorted[0]?.basis === 'transaction') return { basis: 'transaction', rate: first };
  if (second === undefined) return { basis: 'policy', rate: first };
  const cross: CrossRate = { on, legs: [first, second] };
  return { basis: 'policy', rate: cross };
}

/**
 * The accountant's reversal of a posted entry (S03 rule 9): the original read with its lines,
 * dimensions and conversions; `manualReversalLines()` refuses what is not reversible by hand and
 * negates every line at its amounts, so no rate is read; each account is checked again for its
 * state only.
 */
async function reversalLines(
  tx: Transaction,
  content: Extract<PostingContent, { kind: 'reversal' }>,
  on: string,
  ledgers: CompanyLedgers,
): Promise<BuiltLine[]> {
  const [original] = await tx
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, content.entryId));
  if (!original) refuse('NOT_FOUND', 'No such entry', { entryId: content.entryId });
  const [reversal] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(eq(journalEntries.reversesEntryId, original.id));
  const stored = await tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.entryId, original.id))
    .orderBy(asc(journalLines.lineNo));
  const conversions = await tx
    .select()
    .from(lineConversions)
    .where(
      inArray(
        lineConversions.lineId,
        stored.map((line) => line.id),
      ),
    );
  const setValues = await tx
    .select()
    .from(dimensionSetValues)
    .where(
      inArray(dimensionSetValues.setId, [...new Set(stored.map((line) => line.dimensionSetId))]),
    );
  const lines = stored.map((row): Line => {
    const fields = {
      account: row.accountId,
      dimensions: Object.fromEntries(
        setValues
          .filter((value) => value.setId === row.dimensionSetId)
          .map((value) => [value.typeId, value.valueId]),
      ) as Dimensions,
      transaction: money(row.amountMinor, row.currency as CurrencyCode),
      bookMinor: row.bookMinor,
      parallelMinor: row.parallelMinor,
    };
    if (row.kind === 'difference' || row.kind === 'rounding') {
      return { ...fields, kind: row.kind, ledger: row.ledger as Ledger };
    }
    if (row.kind === 'carried') return { ...fields, kind: 'carried' };
    const of = (ledger: Ledger) =>
      conversionOf(
        conversions.filter((c) => c.lineId === row.id && c.ledger === ledger),
        original.entryDate,
      );
    return {
      ...fields,
      kind: 'measured',
      conversions: { book: of('book'), parallel: of('parallel') },
    };
  });
  const negated = manualReversalLines(
    {
      source: original.source as EntrySource,
      date: original.entryDate,
      isReversal: original.reversesEntryId !== null,
      reversed: reversal !== undefined,
      lines,
    },
    on,
  );
  await checkAgainstChart(tx, negated, 'reversal');
  // The reversal carries its own rounding lines, so balancing adds nothing (ADR 0007).
  const balanced = balanceEntry({
    on,
    ledgers,
    lines: negated,
    rounding: { account: roleTarget('conversion_rounding') },
  });
  if (balanced.length !== negated.length) throw new Error('A reversal needed a rounding line');
  return negated.map((line, index) => ({ line, memo: stored[index]?.memo ?? null }));
}

/** The conversions of a line as stored: one row per rate it used, two for a cross. */
function conversionsOf(
  line: Line,
  rateIds: ReadonlyMap<ExchangeRate, string>,
  measuredHere: boolean,
): ChainConversion[] {
  if (line.kind !== 'measured' || !measuredHere) return [];
  return (['book', 'parallel'] as const).flatMap((ledger) => {
    const conversion = line.conversions[ledger];
    if (conversion === null) return [];
    const rates = 'legs' in conversion.rate ? [...conversion.rate.legs] : [conversion.rate];
    return rates.map((rate, index) => {
      const rateId = conversion.basis === 'policy' ? rateIds.get(rate) : undefined;
      if (conversion.basis === 'policy' && rateId === undefined) {
        throw new Error('A policy rate without its row');
      }
      return {
        ledger,
        basis: conversion.basis,
        quoteNo: index + 1,
        rateId: rateId ?? null,
        base: rate.base,
        quote: rate.quote,
        rate: rate.rate,
        rateType: rate.type,
        rateSource: rate.source,
        effectiveOn: rate.effectiveOn,
      };
    });
  });
}

/** The key of a set of dimension values: its `type:value` ids, sorted by type. */
function dimensionKey(dimensions: Dimensions): string {
  return Object.entries(dimensions)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([type, value]) => `${type}:${value}`)
    .join(',');
}

/** The id of the company's set of these values, made the first time a line carries them. */
async function dimensionSetOf(
  tx: Transaction,
  companyId: string,
  dimensions: Dimensions,
): Promise<string> {
  const key = dimensionKey(dimensions);
  const [found] = await tx
    .select({ id: dimensionSets.id })
    .from(dimensionSets)
    .where(eq(dimensionSets.key, key));
  if (found) return found.id;
  const id = uuidv7();
  await tx.insert(dimensionSets).values({ id, companyId, key });
  const pairs = Object.entries(dimensions);
  if (pairs.length > 0) {
    await tx
      .insert(dimensionSetValues)
      .values(pairs.map(([typeId, valueId]) => ({ companyId, setId: id, typeId, valueId })));
  }
  return id;
}

/**
 * Posts an entry, inside `withCompany` (S03 rules 1–3), in the lock order of ADR 0008:
 * 1. the posting request: its key posted before with the same payload answers that entry and posts
 *    nothing; with another payload it is `IDEMPOTENCY_CONFLICT`;
 * 2. the company's ledger head `FOR UPDATE`, then its settings row `FOR UPDATE`;
 * 3. a manual date up to the end of the current month (`ENTRY_DATE_OUT_OF_RANGE`), then the
 *    period of the entry date, made open when missing, `FOR SHARE` (`PERIOD_CLOSED`);
 * 4. the lines, checked against the chart and built by `packages/ledger` (`balanceEntry()` last);
 * 5. the accounts and the books marked as used, the next number of the fiscal year of the entry
 *    date, the dimension sets;
 * 6. the hash over the entry as stored (`chainEntryValue()`) and the previous hash;
 * 7. the entry, its lines and conversions, the `entry.posted` audit row, then the head.
 * Any refusal throws and the caller's transaction rolls back, so no number is used up. The
 * deferred guards check the balance, the reversal, the head and the number at commit.
 */
export async function post(tx: Transaction, request: PostingRequest): Promise<PostedEntryRef> {
  const companyId = await contextCompany(tx);
  const payloadHash = sha256(canonicalJson(payloadOf(request)));
  const [created] = await tx
    .insert(postingRequests)
    .values({
      companyId,
      client: request.client,
      idempotencyKey: request.idempotencyKey,
      payloadHash,
    })
    .onConflictDoNothing({
      target: [postingRequests.companyId, postingRequests.client, postingRequests.idempotencyKey],
    })
    .returning({ id: postingRequests.id });
  if (!created) return replay(tx, request, payloadHash);

  const [head] = await tx.select().from(ledgerHeads).for('update');
  const [settings] = await tx.select().from(companySettings).for('update');
  if (!head || !settings) throw new Error('A company without its ledger head or settings');
  const ledgers = ledgersOf(settings);
  const on = request.entryDate;
  const { content } = request;
  checkManualEntryDate(on, content.today);
  // No SYP amount before the new pound, in a ledger or on a line (ADR 0005 invariant 8).
  for (const [, ledger] of keptLedgers(ledgers)) checkCurrencyDate(ledger.currency, on);
  if (content.kind === 'manual') {
    for (const line of content.lines) checkCurrencyDate(line.currency, on);
  }
  const fiscalYear = fiscalYearOf(on, settings.fiscalYearStartMonth);
  const period = periodOf(on);
  await tx
    .insert(periods)
    .values({ companyId, period, fiscalYear, state: 'open' })
    .onConflictDoNothing({ target: [periods.companyId, periods.period] });
  const [periodRow] = await tx
    .select({ state: periods.state })
    .from(periods)
    .where(eq(periods.period, period))
    .for('share');
  if (periodRow?.state !== 'open') {
    refuse('PERIOD_CLOSED', `The period ${period} is closed`, { period });
  }

  const built =
    content.kind === 'manual'
      ? await manualLines(tx, content, on, ledgers, settings.bulletinDaysOff)
      : { lines: await reversalLines(tx, content, on, ledgers), rateIds: new Map() };
  const reversesEntryId = content.kind === 'reversal' ? content.entryId : null;

  const postedAt = await transactionTime(tx);
  const accountIds = [...new Set(built.lines.map(({ line }) => line.account))];
  await tx
    .update(chartAccounts)
    .set({ firstPostedAt: postedAt })
    .where(and(inArray(chartAccounts.id, accountIds), isNull(chartAccounts.firstPostedAt)));
  await tx
    .update(companySettings)
    .set({ booksStartedAt: postedAt })
    .where(and(eq(companySettings.id, settings.id), isNull(companySettings.booksStartedAt)));
  const [counter] = await tx
    .insert(entryNumberCounters)
    .values({ companyId, fiscalYear, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [entryNumberCounters.companyId, entryNumberCounters.fiscalYear],
      set: { lastNumber: sql`${entryNumberCounters.lastNumber} + 1`, updatedAt: sql`now()` },
    })
    .returning({ lastNumber: entryNumberCounters.lastNumber });
  if (!counter) throw new Error('No entry number');
  const sets = new Map<string, string>();
  for (const { line } of built.lines) {
    const key = dimensionKey(line.dimensions);
    if (!sets.has(key)) sets.set(key, await dimensionSetOf(tx, companyId, line.dimensions));
  }

  const entryId = uuidv7();
  const sequence = head.entryCount + 1n;
  const lines = built.lines.map(({ line, memo }, index) => ({
    id: uuidv7(),
    lineNo: index + 1,
    accountId: line.account,
    dimensionSetId: sets.get(dimensionKey(line.dimensions)) as string,
    dimensionKey: dimensionKey(line.dimensions),
    kind: line.kind,
    ledger: line.kind === 'difference' || line.kind === 'rounding' ? line.ledger : null,
    currency: line.transaction.currency,
    amountMinor: line.transaction.amountMinor,
    bookMinor: line.bookMinor,
    parallelMinor: line.parallelMinor,
    memo,
    // A reversal carries amounts: it used no rate (S02 rule 15 lists the entries that did).
    conversions: conversionsOf(line, built.rateIds, reversesEntryId === null),
  }));
  const actor = request.actor;
  const header = {
    id: entryId,
    companyId,
    requestId: created.id,
    sequence,
    fiscalYear,
    number: counter.lastNumber,
    entryDate: on,
    postedAt: postedAt.toISOString(),
    source: 'manual' as const,
    sourceRef: null,
    hubDocument: null,
    description: request.description,
    reference: request.reference,
    reversesEntryId,
    draftId: request.draftId,
    preparedByUserId: request.preparedByUserId,
    approvedByUserId: request.approvedByUserId,
    postedByUserId: actor.kind === 'person' ? actor.userId : null,
    postedByClientId: null,
  };
  const chained: ChainEntry = { ...header, lines };
  const hash = entryHash(chainEntryValue(chained), head.lastHash);

  await tx.insert(journalEntries).values({
    ...header,
    postedAt,
    lineCount: lines.length,
    previousHash: head.lastHash,
    hash,
  });
  await tx.insert(journalLines).values(
    lines.map((line) => ({
      id: line.id,
      companyId,
      entryId,
      lineNo: line.lineNo,
      accountId: line.accountId,
      dimensionSetId: line.dimensionSetId,
      kind: line.kind,
      ledger: line.ledger,
      currency: line.currency,
      amountMinor: line.amountMinor,
      bookMinor: line.bookMinor,
      parallelMinor: line.parallelMinor,
      memo: line.memo,
    })),
  );
  const conversions = lines.flatMap((line) =>
    line.conversions.map((conversion) => ({ companyId, lineId: line.id, ...conversion })),
  );
  if (conversions.length > 0) await tx.insert(lineConversions).values(conversions);
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'entry.posted',
    entityType: 'journal_entry',
    entityId: entryId,
    after: {
      fiscalYear,
      number: counter.lastNumber,
      entryDate: on,
      source: header.source,
      description: request.description,
      reference: request.reference,
      lineCount: lines.length,
      ...(reversesEntryId !== null && { reverses: reversesEntryId }),
    },
  });
  await tx
    .update(ledgerHeads)
    .set({ entryCount: sequence, lastEntryId: entryId, lastHash: hash })
    .where(eq(ledgerHeads.id, head.id));
  return { id: entryId, fiscalYear, number: counter.lastNumber, sequence, hash, replayed: false };
}

/** A request posted before: its entry, when its payload is the same (ADR 0005 invariant 5). */
async function replay(
  tx: Transaction,
  request: PostingRequest,
  payloadHash: string,
): Promise<PostedEntryRef> {
  const [first] = await tx
    .select()
    .from(postingRequests)
    .where(
      and(
        eq(postingRequests.client, request.client),
        eq(postingRequests.idempotencyKey, request.idempotencyKey),
      ),
    );
  if (!first) throw new Error('A posting request neither made nor found');
  if (first.payloadHash !== payloadHash) {
    refuse('IDEMPOTENCY_CONFLICT', 'The key was used with another request', {
      idempotencyKey: request.idempotencyKey,
    });
  }
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.requestId, first.id));
  if (!entry) throw new Error('A posting request without its entry');
  return {
    id: entry.id,
    fiscalYear: entry.fiscalYear,
    number: entry.number,
    sequence: entry.sequence,
    hash: entry.hash,
    replayed: true,
  };
}
