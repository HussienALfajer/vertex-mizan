import { CURRENCY_CODES } from '@vertex-mizan/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type AuditActor,
  accountRequiredDimensions,
  accountRoles,
  auditEntries,
  bulletinHolidays,
  chartAccounts,
  companies,
  companySettings,
  dimensionTypes,
  dimensionValues,
  exchangeRates,
  post,
  ratePairs,
  type Transaction,
  tableRegistry,
  users,
  withCompany,
} from '../src/index.js';
import { connect } from './connections.js';

// ADR 0003's property: two companies with generated data, and no read of one ever includes the
// other's rows. Run on every company table of the registry (S01: the settings and the audit log);
// a later spec that adds a company table adds its rows here, and the first test fails until it
// does.

const { app } = connect();
const COVERED = [
  'company_settings',
  'audit_entries',
  'chart_accounts',
  'account_required_dimensions',
  'account_roles',
  'dimension_types',
  'dimension_values',
  'rate_pairs',
  'exchange_rates',
  'bulletin_holidays',
  'posting_requests',
  'journal_entries',
  'journal_lines',
  'line_conversions',
  'dimension_sets',
  'dimension_set_values',
  'ledger_heads',
  'entry_number_counters',
  'periods',
  'period_balances',
];

const auditRow = fc.record({
  action: fc.constantFrom('company.updated', 'membership.created', 'session.company_entered'),
  entityType: fc.constantFrom('company', 'membership', 'session'),
  reason: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
  // Plain objects: Drizzle cannot read a null-prototype one, which fc.dictionary makes by default.
  after: fc.option(
    fc.dictionary(fc.string({ maxLength: 8 }), fc.integer(), { noNullPrototype: true }),
    { nil: null },
  ),
});

const companyData = fc.record({
  bookCurrency: fc.constantFrom(...CURRENCY_CODES),
  fiscalYearStartMonth: fc.integer({ min: 1, max: 12 }),
  policyNote: fc.string({ minLength: 1, maxLength: 80 }).filter((note) => note.trim() !== ''),
  audit: fc.array(auditRow, { maxLength: 6 }),
  headers: fc.subarray(['11', '12', '21', '31']),
  clients: fc.array(
    fc.record({
      name: fc
        .string({ minLength: 1, maxLength: 40 })
        .filter((name) => name.trim() === name && name !== ''),
      hub: fc.boolean(),
    }),
    { maxLength: 5 },
  ),
  rates: fc.uniqueArray(
    fc.record({
      day: fc.integer({ min: 1, max: 28 }),
      rate: fc.integer({ min: 1, max: 999_999 }).map((value) => `${value}.0000`),
    }),
    { maxLength: 5, selector: (row) => row.day },
  ),
  holidays: fc.uniqueArray(fc.integer({ min: 1, max: 28 }), { maxLength: 4 }),
});

type CompanyData = typeof companyData extends fc.Arbitrary<infer T> ? T : never;

const day = (value: number) => `2026-11-${String(value).padStart(2, '0')}`;

/** An account under the company's account of `parentCode`. */
async function addAccount(
  tx: Transaction,
  companyId: string,
  parentCode: string,
  values: Partial<typeof chartAccounts.$inferInsert> & { code: string },
): Promise<string> {
  const [parent] = await tx
    .select()
    .from(chartAccounts)
    .where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.code, parentCode)));
  if (!parent) throw new Error(`no account ${parentCode}`);
  const [row] = await tx
    .insert(chartAccounts)
    .values({
      companyId,
      parentId: parent.id,
      level: values.code.length === 6 ? 4 : values.code.length,
      kind: 'header',
      class: parent.class,
      name: 'حساب مولّد',
      normalBalance: parent.normalBalance,
      ...values,
    })
    .returning({ id: chartAccounts.id });
  if (!row) throw new Error('no account inserted');
  return row.id;
}

/** S02's rows: headers, a revenue account with a role and a required client, clients, rates. */
async function seedChart(tx: Transaction, companyId: string, userId: string, data: CompanyData) {
  for (const code of data.headers) await addAccount(tx, companyId, code[0] as string, { code });
  await addAccount(tx, companyId, '4', { code: '41' });
  await addAccount(tx, companyId, '41', { code: '411' });
  const revenue = await addAccount(tx, companyId, '411', {
    code: '411001',
    kind: 'postable',
    statementLine: 'is.revenue',
  });
  await tx.insert(accountRoles).values({ companyId, role: 'fx_realised_gain', accountId: revenue });
  const [client] = await tx
    .select()
    .from(dimensionTypes)
    .where(and(eq(dimensionTypes.companyId, companyId), eq(dimensionTypes.code, 'client')));
  if (!client) throw new Error('no client type');
  await tx
    .insert(accountRequiredDimensions)
    .values({ companyId, accountId: revenue, dimensionTypeId: client.id });
  for (const [index, value] of data.clients.entries()) {
    await tx.insert(dimensionValues).values({
      companyId,
      typeId: client.id,
      name: value.name,
      ...(value.hub ? { externalSource: 'hub', externalId: `generated-${index}` } : {}),
    });
  }
  await tx.insert(ratePairs).values({ companyId, base: 'USD', quote: 'SYP' });
  for (const row of data.rates) {
    await tx.insert(exchangeRates).values({
      companyId,
      effectiveOn: day(row.day),
      base: 'USD',
      quote: 'SYP',
      rate: row.rate,
      type: 'bulletin',
      source: 'manual',
      recordedByUserId: userId,
    });
  }
  for (const holiday of data.holidays) {
    await tx.insert(bulletinHolidays).values({ companyId, holidayOn: day(holiday), note: 'عطلة' });
  }
}

/**
 * S03's rows: an expense in a foreign currency carrying a service, converted at a market rate,
 * and its reversal, posted through the posting function.
 */
async function seedLedger(tx: Transaction, companyId: string, userId: string, data: CompanyData) {
  await addAccount(tx, companyId, '5', { code: '59' });
  await addAccount(tx, companyId, '59', { code: '591' });
  const debit = await addAccount(tx, companyId, '591', {
    code: '591001',
    kind: 'postable',
    statementLine: 'is.other_expenses',
  });
  const credit = await addAccount(tx, companyId, '591', {
    code: '591002',
    kind: 'postable',
    statementLine: 'is.other_expenses',
  });
  const [service] = await tx
    .select()
    .from(dimensionTypes)
    .where(and(eq(dimensionTypes.companyId, companyId), eq(dimensionTypes.code, 'service')));
  const [value] = await tx
    .insert(dimensionValues)
    .values({ companyId, typeId: service?.id as string, code: 'S1', name: 'خدمة مولّدة' })
    .returning({ id: dimensionValues.id });
  const foreign = data.bookCurrency === 'USD' ? 'EUR' : 'USD';
  if (data.bookCurrency !== 'SYP') {
    await tx.insert(ratePairs).values({ companyId, base: foreign, quote: data.bookCurrency });
  }
  await tx.insert(exchangeRates).values({
    companyId,
    effectiveOn: '2026-11-01',
    base: foreign,
    quote: data.bookCurrency,
    rate: '2.0000',
    type: 'market',
    source: 'manual',
    recordedByUserId: userId,
  });
  const actor: AuditActor = {
    kind: 'person',
    userId,
    name: 'شخص مولّد',
    sessionId: null,
    requestId: 'request-generated',
    ipAddress: null,
    userAgent: null,
  };
  const common = {
    client: 'manual',
    description: 'قيد مولّد',
    reference: null,
    draftId: null,
    preparedByUserId: userId,
    approvedByUserId: null,
    actor,
  };
  const entry = await post(tx, {
    ...common,
    idempotencyKey: `generated-${companyId}`,
    entryDate: '2026-11-02',
    content: {
      kind: 'manual',
      today: '2026-11-30',
      dealtRates: [],
      lines: [
        {
          accountId: debit,
          dimensionValueIds: [value?.id as string],
          currency: foreign,
          amountMinor: 10_000n,
          memo: null,
        },
        {
          accountId: credit,
          dimensionValueIds: [],
          currency: foreign,
          amountMinor: -10_000n,
          memo: null,
        },
      ],
    },
  });
  await post(tx, {
    ...common,
    idempotencyKey: `reversal:${entry.id}`,
    entryDate: '2026-11-03',
    content: { kind: 'reversal', entryId: entry.id, today: '2026-11-30' },
  });
}

/** The entries `seedLedger` posts, each with one audit row. */
const POSTED = 2;

/** The rows each S02 and S03 table holds for a company seeded with `data`. */
const expectedRows = (data: CompanyData): Record<string, number> => ({
  chart_accounts: 5 + data.headers.length + 3 + 4,
  account_required_dimensions: 1,
  account_roles: 1,
  dimension_types: 4,
  dimension_values: data.clients.length + 1,
  rate_pairs: data.bookCurrency === 'SYP' ? 1 : 2,
  exchange_rates: data.rates.length + 1,
  bulletin_holidays: data.holidays.length,
  posting_requests: POSTED,
  journal_entries: POSTED,
  journal_lines: 4,
  // The expense's two lines convert into the book currency; the reversal carries its amounts.
  line_conversions: 2,
  dimension_sets: 2,
  dimension_set_values: 1,
  ledger_heads: 1,
  entry_number_counters: 1,
  periods: 1,
  period_balances: 2,
});

async function seed(userId: string, data: CompanyData): Promise<string> {
  const [row] = await app
    .insert(companies)
    .values({ name: 'شركة مولّدة', createdByUserId: userId })
    .returning({ id: companies.id });
  if (!row) throw new Error('no company inserted');
  await withCompany(app, row.id, async (tx) => {
    await tx.insert(companySettings).values({
      companyId: row.id,
      bookCurrency: data.bookCurrency,
      bookRateType: 'market',
      bookAcceptsTransactionRate: false,
      fiscalYearStartMonth: data.fiscalYearStartMonth,
      policyNote: data.policyNote,
    });
    for (const entry of data.audit) {
      await tx.insert(auditEntries).values({
        companyId: row.id,
        actorKind: 'person',
        actorUserId: userId,
        actorName: 'شخص مولّد',
        requestId: 'request-generated',
        entityId: row.id,
        ...entry,
      });
    }
    await seedChart(tx, row.id, userId, data);
    await seedLedger(tx, row.id, userId, data);
  });
  return row.id;
}

describe('company isolation, as a property', () => {
  it('covers every company table of the registry', () => {
    const company = Object.entries(tableRegistry)
      .filter(([, info]) => info.scope === 'company')
      .map(([name]) => name);
    expect(company.sort()).toEqual([...COVERED].sort());
  });

  it("never shows one company the other's rows", async () => {
    const [user] = await app
      .insert(users)
      .values({ email: 'generated@example.test', name: 'شخص مولّد' })
      .returning({ id: users.id });
    if (!user) throw new Error('no user inserted');

    await fc.assert(
      fc.asyncProperty(companyData, companyData, async (first, second) => {
        const ids = [await seed(user.id, first), await seed(user.id, second)];
        for (const [index, id] of ids.entries()) {
          const data = index === 0 ? first : second;
          const seen = await withCompany(app, id, async (tx) => ({
            settings: await tx
              .select({ companyId: companySettings.companyId, note: companySettings.policyNote })
              .from(companySettings)
              .where(inArray(companySettings.companyId, ids)),
            audit: await tx
              .select({ companyId: auditEntries.companyId })
              .from(auditEntries)
              .where(inArray(auditEntries.companyId, ids)),
          }));
          expect(seen.settings).toEqual([{ companyId: id, note: data.policyNote }]);
          expect(seen.audit).toHaveLength(data.audit.length + POSTED);
          for (const row of seen.audit) expect(row.companyId).toBe(id);
          const listed = sql.join(
            ids.map((value) => sql`${value}::uuid`),
            sql`, `,
          );
          for (const [table, count] of Object.entries(expectedRows(data))) {
            const rows = await withCompany(app, id, (tx) =>
              tx.execute<{ company_id: string }>(
                sql`select company_id from ${sql.identifier(table)} where company_id in (${listed})`,
              ),
            );
            expect(rows.rows, table).toHaveLength(count);
            for (const row of rows.rows) expect(row.company_id).toBe(id);
          }
        }
      }),
      { numRuns: 25, includeErrorInReport: true },
    );
  }, 60_000);
});
