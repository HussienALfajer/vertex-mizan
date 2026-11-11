import {
  type CurrencyCode,
  chartTemplateIdSchema,
  createAccountSchema,
  createDimensionValueSchema,
  currencyCodeSchema,
  DomainError,
  type ExchangeRate,
} from '@vertex-mizan/contracts';
import {
  addBulletinHoliday,
  auditEntries,
  blockAccount,
  chartAccounts,
  createAccount,
  createCompanyBooks,
  createDimensionValue,
  dimensionSetValues,
  dimensionTypes,
  dimensionValues,
  entriesUsingRate,
  inboundEvents,
  journalEntries,
  journalLines,
  ledgerHeads,
  lockedAccount,
  openItemBalances,
  openItems,
  type PersonActor,
  post,
  postRevaluation,
  previewRevaluation,
  recordRate,
  setBulletinDaysOff,
  type Transaction,
  users,
  withCompany,
} from '@vertex-mizan/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { CaseCompany, Step } from './format.js';
import type {
  BalanceQuery,
  CaseContext,
  LedgerReader,
  ObservedBalance,
  ObservedOpenItem,
  OpenItemQuery,
  PostedEntry,
  ScenarioDatabase,
  StepResult,
} from './harness.js';
import { advanceClock, caseToday, dayAfterMonth, inboxActions, runRetries } from './hub.js';
import type { NamedValue } from './run.js';

// The parts of the book that run through the system itself (S03): the case's company made by the
// company, chart and rate services the API and the server commands use, the manual, reversal and
// rate steps through the posting function and the rate service, and the ledger read from the
// database as the reports read it, never from an executor's answer.

/** The accountant's inbox actions (S05), as the case's bookkeeper. */
export const actions = inboxActions((companyId) => bookkeeperOf(companyId));

/** Each case company's bookkeeper: the person who records its rates and posts its entries. */
const bookkeepers = new Map<string, PersonActor>();

function bookkeeperOf(companyId: string): PersonActor {
  const actor = bookkeepers.get(companyId);
  if (actor === undefined) throw new Error(`No setup ran for company ${companyId}`);
  return actor;
}

/** A refusal by a business rule is the step's outcome; anything else is the case's failure. */
async function outcomeOf(work: Promise<unknown>): Promise<StepResult> {
  try {
    await work;
    return { status: 'done' };
  } catch (error) {
    if (error instanceof DomainError) return { status: 'refused', reason: error.code };
    throw error;
  }
}

async function accountIdsByCode(tx: Transaction): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: chartAccounts.id, code: chartAccounts.code })
    .from(chartAccounts);
  return new Map(rows.map((row) => [row.code, row.id]));
}

/**
 * Makes the case's company (`docs/scenarios/README.md`): a bookkeeper; the company with its
 * ledgers and chart template (`createCompanyBooks`); the accounts the case adds, under their
 * template headers (`createAccount`); the dimension values it names, of the company's types, each
 * named by its code (`createDimensionValue`, S04); its bulletin calendar; and its rate rows, in
 * order (`recordRate`). Closed periods arrive with S07's close, Hub's rate rows with S05.
 */
export async function setUp(
  database: ScenarioDatabase,
  company: CaseCompany,
  rates: readonly ExchangeRate[],
  values: readonly NamedValue[] = [],
): Promise<string> {
  if (company.closedPeriods.length > 0) {
    throw new Error('A case with closed periods runs once S07 brings the close');
  }
  const companyId = uuidv7();
  const [person] = await database.app
    .insert(users)
    .values({ email: `scenario-${companyId}@example.test`, name: 'محاسب السيناريو' })
    .returning({ id: users.id });
  if (!person) throw new Error('No bookkeeper was made');
  const actor: PersonActor = {
    kind: 'person',
    userId: person.id,
    name: 'محاسب السيناريو',
    sessionId: null,
    requestId: `scenario-${companyId}`,
    ipAddress: null,
    userAgent: 'scenario book',
  };
  await withCompany(database.app, companyId, async (tx) => {
    await createCompanyBooks(
      tx,
      companyId,
      {
        name: 'شركة سيناريو',
        nameLatin: null,
        ledgers: company.ledgers,
        fiscalYearStartMonth: 1,
        policyNote: 'سياسة الشركة في كتاب السيناريوهات.',
        template: company.template === null ? null : chartTemplateIdSchema.parse(company.template),
        createdByUserId: person.id,
      },
      actor,
    );
    const accounts = await accountIdsByCode(tx);
    for (const account of company.accounts) {
      await createAccount(
        tx,
        companyId,
        createAccountSchema.parse({
          parentId: accounts.get(account.code.slice(0, 3)),
          code: account.code,
          kind: 'postable',
          name: account.name,
          nameLatin: account.nameLatin,
          statementLine: account.statementLine,
          currency: account.currency,
          isMonetary: account.isMonetary,
        }),
        actor,
      );
    }
    const types = await tx.select().from(dimensionTypes);
    for (const value of values) {
      const type = types.find((candidate) => candidate.code === value.type);
      if (type === undefined) throw new Error(`The company has no dimension type ${value.type}`);
      if (type.code === 'contract') throw new Error('A contract value needs its kind and client');
      await createDimensionValue(
        tx,
        companyId,
        createDimensionValueSchema.parse({
          typeId: type.id,
          code: value.code,
          name: `${type.name} ${value.code}`,
        }),
        actor,
      );
    }
    await setBulletinDaysOff(tx, companyId, actor, company.calendar.daysOff);
    for (const on of company.calendar.holidays) {
      await addBulletinHoliday(tx, companyId, actor, { on, note: 'عطلة في السيناريو' });
    }
    for (const rate of rates) {
      if (rate.source !== 'manual') throw new Error(`A ${rate.source} rate row arrives with S05`);
      await recordRate(tx, companyId, actor, { ...rate, source: 'manual' });
    }
  });
  bookkeepers.set(companyId, actor);
  return companyId;
}

/** A manual step's payload, as the manual-entry form sends it (README "YAML schema"). */
const manualPayloadSchema = z.strictObject({
  description: z.string().trim().min(1).max(500).optional(),
  reference: z.string().trim().min(1).max(100).optional(),
  dealt_rates: z
    .array(
      z.strictObject({ base: currencyCodeSchema, quote: currencyCodeSchema, rate: z.string() }),
    )
    .default([]),
  lines: z
    .array(
      z.strictObject({
        account: z.string().regex(/^[1-5][0-9]{0,5}$/),
        dims: z.record(z.string(), z.string()).default({}),
        currency: currencyCodeSchema,
        amount: z.bigint(),
        memo: z.string().trim().min(1).max(300).optional(),
        // S04: the document item a line opens, or the item it moves by its reference.
        open_item: z
          .strictObject({
            ref: z.string().trim().min(1).max(100),
            due: z.iso.date().optional(),
          })
          .optional(),
        item: z.string().trim().min(1).max(100).optional(),
      }),
    )
    .min(1),
});

/** The id of the document item of `reference` on an account, if the company has one. */
async function itemIdOf(
  tx: Transaction,
  accountId: string | undefined,
  reference: string,
): Promise<string | null> {
  if (accountId === undefined) return null;
  const [found] = await tx
    .select({ id: openItems.id })
    .from(openItems)
    .where(
      and(
        eq(openItems.accountId, accountId),
        eq(openItems.kind, 'document'),
        eq(openItems.reference, reference),
      ),
    );
  return found?.id ?? null;
}

/** The ids of a line's dimension values, named by type code and value code. */
async function dimensionValueIds(
  tx: Transaction,
  dims: Readonly<Record<string, string>>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const [type, code] of Object.entries(dims)) {
    const [value] = await tx
      .select({ id: dimensionValues.id })
      .from(dimensionValues)
      .innerJoin(
        dimensionTypes,
        and(
          eq(dimensionTypes.companyId, dimensionValues.companyId),
          eq(dimensionTypes.id, dimensionValues.typeId),
        ),
      )
      .where(and(eq(dimensionTypes.code, type), eq(dimensionValues.code, code)));
    if (!value) throw new Error(`The company has no ${type} value ${code}`);
    ids.push(value.id);
  }
  return ids;
}

/**
 * A manual entry, posted through the posting function with the clock at the step's date (S03
 * rule 6: the cases are dated after the month they were written in).
 */
export function manual(
  context: CaseContext,
  step: Extract<Step, { kind: 'manual' }>,
): Promise<StepResult> {
  const payload = manualPayloadSchema.parse(step.payload);
  const actor = bookkeeperOf(context.companyId);
  advanceClock(context.companyId, step.accountingDate);
  return outcomeOf(
    withCompany(context.database.app, context.companyId, async (tx) => {
      const accounts = await accountIdsByCode(tx);
      const lines = [];
      for (const line of payload.lines) {
        const accountId = accounts.get(line.account);
        lines.push({
          // An unknown code is the posting function's to refuse (`NOT_FOUND`).
          accountId: accountId ?? uuidv7(),
          dimensionValueIds: await dimensionValueIds(tx, line.dims),
          currency: line.currency,
          amountMinor: line.amount,
          memo: line.memo ?? null,
          ...(line.open_item !== undefined && {
            newItem: { reference: line.open_item.ref, dueOn: line.open_item.due ?? null },
          }),
          // An unknown reference is the posting function's to refuse (`NOT_FOUND`).
          ...(line.item !== undefined && {
            openItemId: (await itemIdOf(tx, accountId, line.item)) ?? uuidv7(),
          }),
        });
      }
      await post(tx, {
        client: 'manual',
        idempotencyKey: uuidv7(),
        entryDate: step.accountingDate,
        description: payload.description ?? step.description,
        reference: payload.reference ?? null,
        draftId: null,
        preparedByUserId: actor.userId,
        approvedByUserId: null,
        actor,
        content: {
          kind: 'manual',
          today: step.accountingDate,
          dealtRates: payload.dealt_rates,
          lines,
        },
      });
    }),
  );
}

/** The case's entry of a number in posting order (the chain's sequence). */
async function entryInPostingOrder(tx: Transaction, number: number) {
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.sequence, BigInt(number)));
  if (!entry) throw new Error(`The case posted no entry ${number}`);
  return entry;
}

/** The accountant's reversal of the case's entry `step.entry`, as the entry page posts it. */
export function reversal(
  context: CaseContext,
  step: Extract<Step, { kind: 'reversal' }>,
): Promise<StepResult> {
  const actor = bookkeeperOf(context.companyId);
  advanceClock(context.companyId, step.accountingDate);
  return outcomeOf(
    withCompany(context.database.app, context.companyId, async (tx) => {
      const original = await entryInPostingOrder(tx, step.entry);
      await post(tx, {
        client: 'manual',
        idempotencyKey: `reversal:${original.id}`,
        entryDate: step.accountingDate,
        description: `عكس القيد ${original.fiscalYear}/${original.number}`,
        reference: null,
        draftId: null,
        preparedByUserId: actor.userId,
        approvedByUserId: null,
        actor,
        content: { kind: 'reversal', entryId: original.id, today: step.accountingDate },
      });
    }),
  );
}

/**
 * The accountant's month-end revaluation of one ledger (S07 rules 16–18), as `/revaluation` posts
 * it: the preview read, then posted with its fingerprint. The case's clock moves to the first day
 * of the next month, as a job step's does, since a month is revalued once it has ended. Every
 * difference zero posts nothing and is done (`posted: false`); a refusal is the step's outcome.
 */
export function revalue(
  context: CaseContext,
  step: Extract<Step, { kind: 'revalue' }>,
): Promise<StepResult> {
  const actor = bookkeeperOf(context.companyId);
  advanceClock(context.companyId, dayAfterMonth(step.period));
  const today = caseToday(context.companyId);
  return outcomeOf(
    withCompany(context.database.app, context.companyId, async (tx) => {
      const { fingerprint } = await previewRevaluation(tx, {
        period: step.period,
        ledger: step.ledger,
        today,
      });
      await postRevaluation(tx, {
        period: step.period,
        ledger: step.ledger,
        fingerprint,
        today,
        actor,
      });
    }),
  );
}

/** An account blocked with a reason, as the chart's screen blocks it (S02 rule 5). */
export function block(
  context: CaseContext,
  step: Extract<Step, { kind: 'block' }>,
): Promise<StepResult> {
  const actor = bookkeeperOf(context.companyId);
  return outcomeOf(
    withCompany(context.database.app, context.companyId, async (tx) => {
      // The ledger head before the account, as the posting function locks them (ADR 0008).
      await tx.select({ id: ledgerHeads.id }).from(ledgerHeads).for('update');
      const id = (await accountIdsByCode(tx)).get(step.account);
      if (id === undefined) throw new Error(`No account ${step.account} in the case's chart`);
      await blockAccount(
        tx,
        context.companyId,
        actor,
        await lockedAccount(tx, id, 'update'),
        step.reason,
      );
    }),
  );
}

/**
 * A rate row recorded now, as on the rates screen; a correction answers the entries that
 * converted at the row it supersedes, by their number in posting order (S02 rule 15).
 */
export async function rate(
  context: CaseContext,
  step: Extract<Step, { kind: 'rate' }>,
): Promise<StepResult> {
  const actor = bookkeeperOf(context.companyId);
  try {
    const result = await withCompany(context.database.app, context.companyId, async (tx) => {
      const recorded = await recordRate(tx, context.companyId, actor, {
        ...step.rate,
        source: 'manual',
        ...(step.reason !== null && { reason: step.reason }),
      });
      if (recorded.supersededId === null) return { status: 'done' as const };
      const usedBy = await entriesUsingRate(tx, recorded.supersededId);
      return { status: 'done' as const, usedBy: usedBy.map((entry) => Number(entry.sequence)) };
    });
    // The held events of that date and after are retried, as the worker does after the commit.
    await runRetries(context.database, context.companyId, [
      { kind: 'rate', on: step.rate.effectiveOn },
    ]);
    return result;
  } catch (error) {
    if (error instanceof DomainError) return { status: 'refused', reason: error.code };
    throw error;
  }
}

/** The value of a dimension as a case names it: its code, else its Hub id, else its name. */
const valueName = sql<string>`coalesce(${dimensionValues.code}, ${dimensionValues.externalId}, ${dimensionValues.name})`;

/**
 * The company's ledger as the reports read it: the entries in posting order with their lines
 * (a reversal's source is `reversal`) and the audit rows of each posting; the balances from the
 * period balances; an open item from its balance row (S04), a document by its reference and a
 * running item by its client's code, with its dimensions by name.
 */
export const ledger: LedgerReader = {
  entries: (context) =>
    withCompany(context.database.app, context.companyId, async (tx) => {
      const entries = await tx.select().from(journalEntries).orderBy(asc(journalEntries.sequence));
      // A Hub entry's source is its event's type, its reversals' too (S05 rule 14).
      const events = await tx
        .select({ id: inboundEvents.id, type: inboundEvents.type })
        .from(inboundEvents);
      const sourceOf = (entry: (typeof entries)[number]) =>
        entry.source === 'hub_event'
          ? (events.find((event) => event.id === entry.sourceRef)?.type ?? 'hub_event')
          : entry.reversesEntryId === null
            ? entry.source
            : 'reversal';
      const lines = await tx
        .select({ line: journalLines, code: chartAccounts.code })
        .from(journalLines)
        .innerJoin(
          chartAccounts,
          and(
            eq(chartAccounts.companyId, journalLines.companyId),
            eq(chartAccounts.id, journalLines.accountId),
          ),
        )
        .orderBy(asc(journalLines.lineNo));
      const dims = await tx
        .select({ setId: dimensionSetValues.setId, type: dimensionTypes.code, value: valueName })
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
        );
      const audit = await tx
        .select({ entityId: auditEntries.entityId, rows: sql<number>`count(*)::int` })
        .from(auditEntries)
        .where(eq(auditEntries.action, 'entry.posted'))
        .groupBy(auditEntries.entityId);
      return entries.map(
        (entry): PostedEntry => ({
          source: sourceOf(entry),
          date: entry.entryDate,
          lines: lines
            .filter(({ line }) => line.entryId === entry.id)
            .map(({ line, code }) => ({
              account: code,
              dims: Object.fromEntries(
                dims
                  .filter((pair) => pair.setId === line.dimensionSetId)
                  .map((pair) => [pair.type, pair.value]),
              ),
              currency: line.currency as CurrencyCode,
              amount: line.amountMinor,
              book: line.bookMinor,
              parallel: line.parallelMinor,
            })),
          auditRows: audit.find((row) => row.entityId === entry.id)?.rows ?? 0,
        }),
      );
    }),

  balance: (context, query: BalanceQuery) =>
    withCompany(context.database.app, context.companyId, async (tx): Promise<ObservedBalance> => {
      const pairs = Object.entries(query.dims).map(
        ([type, value]) => sql`exists (
          select 1 from ${dimensionSetValues} v
          join ${dimensionTypes} t on t.company_id = v.company_id and t.id = v.type_id
          join ${dimensionValues} dv on dv.company_id = v.company_id and dv.id = v.value_id
          where v.set_id = b.dimension_set_id and t.code = ${type}
            and coalesce(dv.code, dv.external_id, dv.name) = ${value})`,
      );
      const result = await tx.execute<{
        amount: string | null;
        book: string | null;
        parallel: string | null;
      }>(sql`
        select sum(b.debit_minor - b.credit_minor)::text as amount,
               sum(b.book_debit_minor - b.book_credit_minor)::text as book,
               sum(b.parallel_debit_minor - b.parallel_credit_minor)::text as parallel
        from period_balances b
        join ${chartAccounts} a on a.company_id = b.company_id and a.id = b.account_id
        where a.code = ${query.account}
          ${query.currency === null ? sql`` : sql`and b.currency = ${query.currency}`}
          ${sql.join(
            pairs.map((pair) => sql`and ${pair}`),
            sql` `,
          )}`);
      const [row] = result.rows;
      const minor = (value: string | null | undefined) => BigInt(value ?? '0');
      return {
        amount: query.currency === null ? null : minor(row?.amount),
        book: minor(row?.book),
        parallel: context.company.ledgers.parallel === null ? null : minor(row?.parallel),
      };
    }),

  openItem: (context, query: OpenItemQuery) =>
    withCompany(
      context.database.app,
      context.companyId,
      async (tx): Promise<ObservedOpenItem | null> => {
        const [found] = await tx
          .select({ item: openItems, balance: openItemBalances })
          .from(openItems)
          .innerJoin(
            chartAccounts,
            and(
              eq(chartAccounts.companyId, openItems.companyId),
              eq(chartAccounts.id, openItems.accountId),
            ),
          )
          .innerJoin(
            openItemBalances,
            and(
              eq(openItemBalances.companyId, openItems.companyId),
              eq(openItemBalances.itemId, openItems.id),
            ),
          )
          .where(and(eq(chartAccounts.code, query.account), eq(openItems.reference, query.item)));
        if (!found) return null;
        const dims = await tx
          .select({ type: dimensionTypes.code, value: valueName })
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
          .where(eq(dimensionSetValues.setId, found.item.dimensionSetId));
        return {
          dims: Object.fromEntries(dims.map((pair) => [pair.type, pair.value])),
          currency: found.item.currency as CurrencyCode,
          amount: found.balance.openMinor,
          book: found.balance.bookMinor,
          parallel: found.balance.parallelMinor,
        };
      },
    ),
};
