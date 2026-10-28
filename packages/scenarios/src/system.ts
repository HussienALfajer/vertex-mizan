import {
  type CurrencyCode,
  chartTemplateIdSchema,
  createAccountSchema,
  currencyCodeSchema,
  DomainError,
  type ExchangeRate,
} from '@vertex-mizan/contracts';
import {
  addBulletinHoliday,
  auditEntries,
  chartAccounts,
  createAccount,
  createCompanyBooks,
  dimensionSetValues,
  dimensionTypes,
  dimensionValues,
  entriesUsingRate,
  journalEntries,
  journalLines,
  type PersonActor,
  post,
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
  PostedEntry,
  ScenarioDatabase,
  StepResult,
} from './harness.js';

// The parts of the book that run through the system itself (S03): the case's company made by the
// company, chart and rate services the API and the server commands use, the manual, reversal and
// rate steps through the posting function and the rate service, and the ledger read from the
// database as the reports read it, never from an executor's answer.

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
 * template headers (`createAccount`); its bulletin calendar; and its rate rows, in order
 * (`recordRate`). Closed periods arrive with S07's close, Hub's rate rows with S05.
 */
export async function setUp(
  database: ScenarioDatabase,
  company: CaseCompany,
  rates: readonly ExchangeRate[],
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
      }),
    )
    .min(1),
});

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
  return outcomeOf(
    withCompany(context.database.app, context.companyId, async (tx) => {
      const accounts = await accountIdsByCode(tx);
      const lines = [];
      for (const line of payload.lines) {
        lines.push({
          // An unknown code is the posting function's to refuse (`NOT_FOUND`).
          accountId: accounts.get(line.account) ?? uuidv7(),
          dimensionValueIds: await dimensionValueIds(tx, line.dims),
          currency: line.currency,
          amountMinor: line.amount,
          memo: line.memo ?? null,
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
 * A rate row recorded now, as on the rates screen; a correction answers the entries that
 * converted at the row it supersedes, by their number in posting order (S02 rule 15).
 */
export async function rate(
  context: CaseContext,
  step: Extract<Step, { kind: 'rate' }>,
): Promise<StepResult> {
  const actor = bookkeeperOf(context.companyId);
  try {
    return await withCompany(context.database.app, context.companyId, async (tx) => {
      const recorded = await recordRate(tx, context.companyId, actor, {
        ...step.rate,
        source: 'manual',
        ...(step.reason !== null && { reason: step.reason }),
      });
      if (recorded.supersededId === null) return { status: 'done' as const };
      const usedBy = await entriesUsingRate(tx, recorded.supersededId);
      return { status: 'done' as const, usedBy: usedBy.map((entry) => Number(entry.sequence)) };
    });
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
 * period balances; open items arrive with S04.
 */
export const ledger: LedgerReader = {
  entries: (context) =>
    withCompany(context.database.app, context.companyId, async (tx) => {
      const entries = await tx.select().from(journalEntries).orderBy(asc(journalEntries.sequence));
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
          source: entry.reversesEntryId === null ? entry.source : 'reversal',
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

  openItem: async () => {
    throw new Error('Open items arrive with S04');
  },
};
