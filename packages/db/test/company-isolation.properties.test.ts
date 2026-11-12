import { CURRENCY_CODES } from '@vertex-mizan/contracts';
import { fiscalYearOf } from '@vertex-mizan/ledger';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import fc from 'fast-check';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import {
  type AuditActor,
  accountRequiredDimensions,
  accountRoles,
  apiClients,
  auditEntries,
  bulletinHolidays,
  chainAnchors,
  chartAccounts,
  companies,
  companyExports,
  companySettings,
  dimensionTypes,
  dimensionValues,
  documentSources,
  entryAttachments,
  entryDraftLines,
  entryDrafts,
  exchangeRates,
  inboundEventActions,
  inboundEventStates,
  inboundEvents,
  journalBookPrints,
  journalEntries,
  openingLines,
  openingRecordFigures,
  openingSnapshots,
  openings,
  periods,
  post,
  postingRuleAccounts,
  postRevaluation,
  previewRevaluation,
  ratePairs,
  recognitionMovements,
  recognitionSchedules,
  reconciliationReportEvents,
  reconciliationReports,
  reportFiles,
  serviceDepartments,
  type Transaction,
  tableRegistry,
  users,
  withCompany,
  writePeriodTransition,
} from '../src/index.js';
import { connect } from './connections.js';

// ADR 0003's property: two companies with generated data, and no read of one ever includes the
// other's rows. Run on every company table of the registry (S01: the settings and the audit log);
// a later spec that adds a company table adds its rows here, and the first test fails until it
// does.

const { app, jobs } = connect();
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
  'revaluations',
  'period_events',
  'entry_drafts',
  'entry_draft_lines',
  'entry_attachments',
  'chain_anchors',
  'company_exports',
  'open_items',
  'open_item_movements',
  'open_item_due_dates',
  'open_item_balances',
  'posting_rule_accounts',
  'inbound_events',
  'inbound_event_states',
  'inbound_event_actions',
  'document_sources',
  'recognition_schedules',
  'recognition_movements',
  'reconciliation_reports',
  'reconciliation_report_events',
  'service_departments',
  'report_files',
  'journal_book_prints',
  'opening_snapshots',
  'openings',
  'opening_lines',
  'opening_record_figures',
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
 * and its reversal, posted through the posting function; S04's: an invoice opening an item.
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
  // A draft being prepared, with a line typed and one not yet, and a file on it and on the entry.
  const [draft] = await tx
    .insert(entryDrafts)
    .values({ companyId, state: 'draft', entryDate: '2026-11-04', preparedByUserId: userId })
    .returning({ id: entryDrafts.id });
  const draftId = draft?.id as string;
  await tx.insert(entryDraftLines).values([
    { companyId, draftId, lineNo: 1, accountId: debit, currency: foreign, amountMinor: 500n },
    { companyId, draftId, lineNo: 2 },
  ]);
  // S04's rows: a manual invoice opening a document item on a control account, with a due date.
  await addAccount(tx, companyId, '1', { code: '13' });
  await addAccount(tx, companyId, '13', { code: '131' });
  const receivables = await addAccount(tx, companyId, '131', {
    code: '131001',
    kind: 'postable',
    statementLine: 'bs.trade_receivables',
    isControl: true,
    itemKind: 'document',
  });
  await post(tx, {
    ...common,
    idempotencyKey: `generated-item-${companyId}`,
    entryDate: '2026-11-05',
    content: {
      kind: 'manual',
      today: '2026-11-30',
      dealtRates: [],
      lines: [
        {
          accountId: receivables,
          dimensionValueIds: [],
          currency: data.bookCurrency,
          amountMinor: 1_000n,
          memo: null,
          newItem: { reference: 'M-1', dueOn: '2026-11-20' },
        },
        {
          accountId: credit,
          dimensionValueIds: [],
          currency: data.bookCurrency,
          amountMinor: -1_000n,
          memo: null,
        },
      ],
    },
  });
  for (const owner of [{ draftId }, { entryId: entry.id }]) {
    const id = uuidv7();
    await tx.insert(entryAttachments).values({
      id,
      companyId,
      ...owner,
      fileName: 'مرفق.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
      storageKey: `${companyId}/${id}`,
      uploadedByUserId: userId,
    });
  }
}

/** The entries `seedOpening`, `seedLedger` and `seedRevaluation` post, each with one audit row. */
const POSTED = 7;

/** The rows each S02, S03 and S04 table holds for a company seeded with `data`. */
const expectedRows = (data: CompanyData): Record<string, number> => ({
  // S06 adds a contract liability header, its parent and the account; S07 a monetary account and
  // the unrealised gain and loss accounts.
  // S10 adds two headers and a postable account under assets and under equity for the opening.
  chart_accounts: 5 + data.headers.length + 3 + 4 + 3 + 3 + 3 + 6,
  account_required_dimensions: 1,
  account_roles: 3,
  dimension_types: 4,
  // S06 adds a client and a service for its schedule.
  // The clients, S04's value, S06's client and service, and S09's service and department.
  // S10's client of the records' figure.
  dimension_values: data.clients.length + 1 + 2 + 2 + 1,
  rate_pairs: data.bookCurrency === 'SYP' ? 1 : 2,
  exchange_rates: data.rates.length + 2,
  bulletin_holidays: data.holidays.length,
  posting_requests: POSTED,
  journal_entries: POSTED,
  // S10's opening: two stated lines.
  journal_lines: 14,
  // The expense's and S07's cash entry's two lines convert into the book currency; the reversal
  // carries its amounts, the invoice is in the book currency and a revaluation converts nothing.
  line_conversions: 4,
  dimension_sets: 2,
  dimension_set_values: 1,
  ledger_heads: 1,
  // The revaluation's reversal falls in the next fiscal year when it starts in December.
  entry_number_counters:
    fiscalYearOf('2026-12-01', data.fiscalYearStartMonth) ===
    fiscalYearOf('2026-11-30', data.fiscalYearStartMonth)
      ? 1
      : 2,
  // November, and December for the revaluation's reversal.
  periods: 2,
  // The expense's two accounts in its currency, the invoice's two in the book currency; S07's cash
  // account in the foreign currency and the gain account in the book currency, in November and
  // again in December.
  // S10's opening: its two accounts in November.
  period_balances: 10,
  entry_drafts: 1,
  entry_draft_lines: 2,
  entry_attachments: 2,
  chain_anchors: 1,
  company_exports: 1,
  open_items: 1,
  open_item_movements: 1,
  open_item_due_dates: 1,
  open_item_balances: 1,
  posting_rule_accounts: 1,
  // S05's held expense and S06's invoice.
  inbound_events: 2,
  inbound_event_states: 1,
  inbound_event_actions: 2,
  document_sources: 1,
  recognition_schedules: 1,
  recognition_movements: 1,
  revaluations: 1,
  period_events: 1,
  reconciliation_reports: 1,
  reconciliation_report_events: 1,
  service_departments: 1,
  // A draft PDF queued and November's official print, ready with its register row.
  report_files: 2,
  journal_book_prints: 1,
  // S10: Hub's snapshot, the posted opening, its two lines and the records' figure.
  opening_snapshots: 1,
  openings: 1,
  opening_lines: 2,
  opening_record_figures: 1,
});

/**
 * S10's rows: the company's books start on 1 November, Hub's snapshot as of the eve, the opening's
 * draft at version 1 with two lines and a records' figure, and its entry posted through the posting
 * function as the company's first entry: a stated asset and a stated capital, in the book currency.
 */
async function seedOpening(tx: Transaction, companyId: string, userId: string) {
  await addAccount(tx, companyId, '1', { code: '19' });
  await addAccount(tx, companyId, '19', { code: '191' });
  const asset = await addAccount(tx, companyId, '191', {
    code: '191001',
    kind: 'postable',
    statementLine: 'bs.ppe',
  });
  await addAccount(tx, companyId, '3', { code: '39' });
  await addAccount(tx, companyId, '39', { code: '391' });
  const capital = await addAccount(tx, companyId, '391', {
    code: '391001',
    kind: 'postable',
    statementLine: 'bs.share_capital',
  });
  const [client] = await tx
    .select()
    .from(dimensionTypes)
    .where(and(eq(dimensionTypes.companyId, companyId), eq(dimensionTypes.code, 'client')));
  const [value] = await tx
    .insert(dimensionValues)
    .values({ companyId, typeId: client?.id as string, code: 'C-OPEN', name: 'عميل الافتتاح' })
    .returning({ id: dimensionValues.id });
  const [snapshot] = await tx
    .insert(openingSnapshots)
    .values({
      companyId,
      apiClientId: uuidv7(),
      snapshotKey: 'snapshot-generated',
      asOf: '2026-10-31',
      generatedAt: new Date('2026-11-01T08:00:00Z'),
      payload: { as_of: '2026-10-31' },
      payloadHash: 'b'.repeat(64),
      invoiceCount: 0,
      walletCount: 0,
      milestoneCount: 0,
      priorDocumentCount: 0,
    })
    .returning({ id: openingSnapshots.id });
  const [opening] = await tx
    .insert(openings)
    .values({ companyId, preparedByUserId: userId })
    .returning();
  if (!opening || !snapshot || !value) throw new Error('no opening seeded');
  const settings = await tx.select().from(companySettings);
  const currency = settings[0]?.bookCurrency as 'SYP';
  await tx.insert(openingLines).values([
    { companyId, openingId: opening.id, version: 1, lineNo: 1, accountId: asset, currency, amountMinor: 1000n },
    { companyId, openingId: opening.id, version: 1, lineNo: 2, accountId: capital, currency, amountMinor: -1000n },
  ]);
  await tx.insert(openingRecordFigures).values({
    companyId,
    openingId: opening.id,
    version: 1,
    slot: 'receivable',
    clientValueId: value.id,
    currency,
    amountMinor: 0n,
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
  const entry = await post(tx, {
    client: 'manual',
    idempotencyKey: `opening:${opening.id}`,
    entryDate: '2026-11-01',
    description: 'قيد الأرصدة الافتتاحية',
    reference: null,
    draftId: null,
    preparedByUserId: userId,
    approvedByUserId: null,
    actor,
    content: {
      kind: 'opening',
      openingId: opening.id,
      measuredOn: '2026-10-31',
      today: '2026-11-01',
      lines: [
        { accountId: asset, dimensionValueIds: [], currency, amountMinor: 1000n, memo: null, fromHub: false, stated: { bookMinor: 1000n, parallelMinor: null } },
        { accountId: capital, dimensionValueIds: [], currency, amountMinor: -1000n, memo: null, fromHub: false, stated: { bookMinor: -1000n, parallelMinor: null } },
      ],
    },
  });
  await tx
    .update(openings)
    .set({
      state: 'posted',
      entryId: entry.id,
      snapshotId: snapshot.id,
      postedByUserId: userId,
      postedAt: new Date(),
      fingerprint: 'c'.repeat(64),
    })
    .where(eq(openings.id, opening.id));
}

/**
 * S07's rows: a monetary account in the foreign currency, funded on 6 November at the market rate
 * of 2, and revalued in the book ledger at 2.5 on 30 November through the revaluation service, with
 * its entry, its reversal on 1 December and its revaluation row.
 */
async function seedRevaluation(
  tx: Transaction,
  companyId: string,
  userId: string,
  data: CompanyData,
) {
  const foreign = data.bookCurrency === 'USD' ? 'EUR' : 'USD';
  const cash = await addAccount(tx, companyId, '131', {
    code: '131002',
    kind: 'postable',
    statementLine: 'bs.trade_receivables',
    isMonetary: true,
  });
  const gain = await addAccount(tx, companyId, '411', {
    code: '411002',
    kind: 'postable',
    statementLine: 'is.revenue',
  });
  const loss = await addAccount(tx, companyId, '591', {
    code: '591003',
    kind: 'postable',
    statementLine: 'is.other_expenses',
  });
  await tx.insert(accountRoles).values([
    { companyId, role: 'fx_unrealised_gain', accountId: gain },
    { companyId, role: 'fx_unrealised_loss', accountId: loss },
  ]);
  await tx.insert(exchangeRates).values({
    companyId,
    effectiveOn: '2026-11-29',
    base: foreign,
    quote: data.bookCurrency,
    rate: '2.5000',
    type: 'market',
    source: 'manual',
    recordedByUserId: userId,
  });
  const [credit] = await tx
    .select({ id: chartAccounts.id })
    .from(chartAccounts)
    .where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.code, '591002')));
  const actor: AuditActor = {
    kind: 'person',
    userId,
    name: 'شخص مولّد',
    sessionId: null,
    requestId: 'request-generated',
    ipAddress: null,
    userAgent: null,
  };
  await post(tx, {
    client: 'manual',
    idempotencyKey: `generated-cash-${companyId}`,
    entryDate: '2026-11-06',
    description: 'قيد مولّد',
    reference: null,
    draftId: null,
    preparedByUserId: userId,
    approvedByUserId: null,
    actor,
    content: {
      kind: 'manual',
      today: '2026-11-30',
      dealtRates: [],
      lines: [
        {
          accountId: cash,
          dimensionValueIds: [],
          currency: foreign,
          amountMinor: 1_000n,
          memo: null,
        },
        {
          accountId: credit?.id as string,
          dimensionValueIds: [],
          currency: foreign,
          amountMinor: -1_000n,
          memo: null,
        },
      ],
    },
  });
  const today = '2026-12-01';
  const { fingerprint } = await previewRevaluation(tx, {
    period: '2026-11',
    ledger: 'book',
    today,
  });
  const posted = await postRevaluation(tx, {
    period: '2026-11',
    ledger: 'book',
    fingerprint,
    today,
    actor,
  });
  if (!posted.posted) throw new Error('no revaluation posted');
}

/** S05's rows: a slot's account, and an event Hub sent, held, with its two actions. */
async function seedInbox(tx: Transaction, companyId: string) {
  const [account] = await tx
    .select({ id: chartAccounts.id })
    .from(chartAccounts)
    .where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.code, '591001')));
  await tx
    .insert(postingRuleAccounts)
    .values({ companyId, slot: 'project_cost', accountId: account?.id as string });
  const [event] = await tx
    .insert(inboundEvents)
    .values({
      companyId,
      apiClientId: uuidv7(),
      eventId: uuidv7(),
      type: 'project_expense.recorded',
      version: 1,
      occurredAt: new Date('2026-11-10T09:00:00Z'),
      accountingDate: '2026-11-10',
      payload: { expense: { id: uuidv7(), number: 'EXP-1' } },
      payloadHash: 'b'.repeat(64),
      documentType: 'project_expense',
      documentId: uuidv7(),
      documentNumber: 'EXP-1',
      itemKey: 'project_expense:generated',
      requestId: 'request-generated',
    })
    .returning({ id: inboundEvents.id });
  const eventId = event?.id as string;
  await tx
    .insert(inboundEventStates)
    .values({ companyId, eventId, state: 'held', holdReason: 'NO_MAPPING' });
  await tx.insert(inboundEventActions).values([
    { companyId, eventId, action: 'received', actorKind: 'system' },
    { companyId, eventId, action: 'held', holdReason: 'NO_MAPPING', actorKind: 'system' },
  ]);
}

/**
 * S06's rows: an invoice's schedule deferred to a contract liability account, with its `deferred`
 * movement describing an entry of this transaction (the guard of 0032).
 */
async function seedRecognition(tx: Transaction, companyId: string) {
  await addAccount(tx, companyId, '2', { code: '23' });
  await addAccount(tx, companyId, '23', { code: '231' });
  const liability = await addAccount(tx, companyId, '231', {
    code: '231001',
    kind: 'postable',
    statementLine: 'bs.contract_liabilities',
  });
  const newValue = async (type: string) => {
    const [found] = await tx
      .select({ id: dimensionTypes.id })
      .from(dimensionTypes)
      .where(and(eq(dimensionTypes.companyId, companyId), eq(dimensionTypes.code, type)));
    const [made] = await tx
      .insert(dimensionValues)
      .values({ companyId, typeId: found?.id as string, name: `قيمة ${type}` })
      .returning({ id: dimensionValues.id });
    return made?.id as string;
  };
  const [event] = await tx
    .insert(inboundEvents)
    .values({
      companyId,
      apiClientId: uuidv7(),
      eventId: uuidv7(),
      type: 'invoice.issued',
      version: 1,
      occurredAt: new Date('2026-11-10T09:00:00Z'),
      accountingDate: '2026-11-10',
      payload: { invoice: { id: uuidv7(), number: 'INV-1' } },
      payloadHash: 'c'.repeat(64),
      documentType: 'invoice',
      documentId: uuidv7(),
      documentNumber: 'INV-1',
      itemKey: 'invoice:generated',
      requestId: 'request-generated',
    })
    .returning({ id: inboundEvents.id });
  const [schedule] = await tx
    .insert(recognitionSchedules)
    .values({
      companyId,
      eventId: event?.id as string,
      invoiceDocumentId: uuidv7(),
      invoiceNumber: 'INV-1',
      lineId: uuidv7(),
      pattern: 'over_time',
      lineSource: 'manual',
      serviceFrom: '2026-11-01',
      serviceTo: '2026-11-30',
      clientValueId: await newValue('client'),
      serviceValueId: await newValue('service'),
      liabilityAccountId: liability,
      currency: 'USD',
    })
    .returning({ id: recognitionSchedules.id });
  const [entry] = await tx.select({ id: journalEntries.id }).from(journalEntries).limit(1);
  await tx.insert(recognitionMovements).values({
    companyId,
    scheduleId: schedule?.id as string,
    kind: 'deferred',
    entryId: entry?.id as string,
    transactionMinor: 10_000n,
    bookMinor: 10_000n,
  });
}

/** S05's document source: the company's Hub client is the source of its invoices. */
async function seedSources(tx: Transaction, companyId: string, userId: string) {
  const [client] = await tx
    .insert(apiClients)
    .values({
      scopeCompanyId: companyId,
      name: 'Vertex Hub',
      system: 'hub',
      scopes: ['events:write'],
      reconcileFrom: '2026-10-19',
      createdByUserId: userId,
    })
    .returning({ id: apiClients.id });
  await tx
    .insert(documentSources)
    .values({ companyId, documentType: 'invoice', apiClientId: client?.id as string });
}

/** S08's rows: a daily report of the Hub client listing one event, as the service stores one. */
async function seedReconciliation(tx: Transaction, companyId: string) {
  const [report] = await tx
    .insert(reconciliationReports)
    .values({
      companyId,
      apiClientId: uuidv7(),
      reportId: uuidv7(),
      reportDate: '2026-11-03',
      generatedAt: new Date('2026-11-03T21:05:00Z'),
      payload: { events: 1 },
      payloadHash: 'a'.repeat(64),
      eventCount: 1,
      requestId: 'request-generated',
      statusAtReceipt: 'differences',
      gapsAtReceipt: 1,
    })
    .returning({ id: reconciliationReports.id });
  await tx.insert(reconciliationReportEvents).values({
    companyId,
    reportId: report?.id as string,
    eventId: uuidv7(),
    type: 'invoice.issued',
    currency: 'USD',
    amountMinor: 50_000n,
    delivery: 'delivered',
  });
}

/** S09's row: a manual service's department from a date, set by the accountant. */
async function seedServiceDepartment(tx: Transaction, companyId: string, userId: string) {
  const newValue = async (type: string) => {
    const [found] = await tx
      .select({ id: dimensionTypes.id })
      .from(dimensionTypes)
      .where(and(eq(dimensionTypes.companyId, companyId), eq(dimensionTypes.code, type)));
    const [made] = await tx
      .insert(dimensionValues)
      .values({ companyId, typeId: found?.id as string, name: `قيمة ${type}` })
      .returning({ id: dimensionValues.id });
    return made?.id as string;
  };
  await tx.insert(serviceDepartments).values({
    companyId,
    serviceValueId: await newValue('service'),
    departmentValueId: await newValue('department'),
    effectiveFrom: '2026-12-01',
    source: 'manual',
    recordedByUserId: userId,
    reason: 'قسم مولّد',
  });
}

/**
 * S09's rows: a trial balance's PDF queued, and November's official journal book, closed, ready
 * with its register row in one transaction, its counts and totals the month's, as the worker
 * writes them.
 */
async function seedReportFiles(tx: Transaction, companyId: string, userId: string) {
  await tx.insert(reportFiles).values({
    companyId,
    report: 'trial_balance',
    params: { from: '2026-11-01', to: '2026-11-30' },
    requestedByUserId: userId,
  });
  const [november] = await tx
    .select({ id: periods.id, fiscalYear: periods.fiscalYear })
    .from(periods)
    .where(eq(periods.period, '2026-11'));
  const [file] = await tx
    .insert(reportFiles)
    .values({
      companyId,
      report: 'journal_book',
      params: { fiscalYear: november?.fiscalYear, from: '2026-11', to: '2026-11' },
      official: true,
      requestedByUserId: userId,
    })
    .returning({ id: reportFiles.id });
  const totals = await tx.execute<{
    entries: number;
    lines: number;
    debits: string;
    credits: string;
  }>(sql`select count(distinct e.id)::int as entries, count(l.id)::int as lines,
      coalesce(sum(greatest(l.book_minor, 0)), 0)::text as debits,
      coalesce(sum(greatest(-l.book_minor, 0)), 0)::text as credits
    from journal_entries e join journal_lines l on l.entry_id = e.id
    where e.fiscal_year = ${november?.fiscalYear}
      and e.entry_date between '2026-11-01' and '2026-11-30'`);
  const row = totals.rows[0];
  const sha256 = 'a'.repeat(64);
  await tx.insert(journalBookPrints).values({
    companyId,
    reportFileId: file?.id as string,
    fiscalYear: november?.fiscalYear as number,
    fromPeriodId: november?.id as string,
    toPeriodId: november?.id as string,
    firstPage: row?.entries ? 1 : null,
    lastPage: row?.entries ? 1 : null,
    entryCount: row?.entries ?? 0,
    lineCount: row?.lines ?? 0,
    debitTotalMinor: BigInt(row?.debits ?? '0'),
    creditTotalMinor: BigInt(row?.credits ?? '0'),
    contentSha256: 'b'.repeat(64),
    fileSha256: sha256,
    reopensSeen: 0,
    printedByUserId: userId,
  });
  await tx
    .update(reportFiles)
    .set({
      state: 'ready',
      storageKey: `${companyId}/${file?.id}`,
      sizeBytes: 1,
      sha256,
      readyAt: new Date(),
    })
    .where(eq(reportFiles.id, file?.id as string));
}

async function seed(userId: string, data: CompanyData): Promise<string> {
  const [row] = await app
    .insert(companies)
    .values({ name: 'شركة مولّدة', createdByUserId: userId })
    .returning({ id: companies.id });
  if (!row) throw new Error('no company inserted');
  const [head] = await withCompany(app, row.id, async (tx) => {
    await tx.insert(companySettings).values({
      companyId: row.id,
      bookCurrency: data.bookCurrency,
      bookRateType: 'market',
      bookAcceptsTransactionRate: false,
      fiscalYearStartMonth: data.fiscalYearStartMonth,
      policyNote: data.policyNote,
      // S10: the books start, so the opening posts first.
      booksStart: '2026-11-01',
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
    await seedOpening(tx, row.id, userId);
    await seedLedger(tx, row.id, userId, data);
    await seedRevaluation(tx, row.id, userId, data);
    await tx.insert(companyExports).values({ companyId: row.id, requestedByUserId: userId });
    await seedInbox(tx, row.id);
    await seedSources(tx, row.id, userId);
    await seedRecognition(tx, row.id);
    await seedReconciliation(tx, row.id);
    await seedServiceDepartment(tx, row.id, userId);
    // S07's period history: November closed, as the posting function writes a close.
    await writePeriodTransition(tx, {
      companyId: row.id,
      period: '2026-11',
      kind: 'closed',
      reason: 'إقفال مولّد',
      userId,
      checklist: [],
    });
    await seedReportFiles(tx, row.id, userId);
    return tx
      .select({ id: journalEntries.id, hash: journalEntries.hash })
      .from(journalEntries)
      .orderBy(desc(journalEntries.sequence))
      .limit(1);
  });
  // Today's anchor, as the daily anchor job writes it: across companies, as the jobs role.
  await jobs.insert(chainAnchors).values({
    companyId: row.id,
    anchoredOn: sql`(now() at time zone 'Asia/Damascus')::date`,
    entryCount: BigInt(POSTED),
    headEntryId: head?.id as string,
    headHash: head?.hash as string,
    emailOutboxIds: [],
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
          // Each entry's row, and S07's revaluation.posted.
          expect(seen.audit).toHaveLength(data.audit.length + POSTED + 1);
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
  }, 180_000);
});
