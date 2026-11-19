import { CURRENCY_CODES, type CurrencyCode } from '@vertex-mizan/contracts';
import { fiscalYearOf } from '@vertex-mizan/ledger';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import fc from 'fast-check';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import {
  type AuditActor,
  accountRequiredDimensions,
  accountRoles,
  auditEntries,
  bulletinHolidays,
  chainAnchors,
  chartAccounts,
  companies,
  companyBranding,
  companyExports,
  companySettings,
  dimensionTypes,
  dimensionValues,
  entryAttachments,
  entryDraftLines,
  entryDrafts,
  exchangeRates,
  journalBookPrints,
  journalEntries,
  materials,
  openingLines,
  openings,
  periods,
  post,
  postRevaluation,
  postVoucher,
  previewRevaluation,
  projectBudgets,
  projectDetails,
  projectDocuments,
  projectMovementCancellations,
  projectMovementSequences,
  projectMovements,
  projectTerms,
  ratePairs,
  reportFiles,
  serviceDepartments,
  subcontracts,
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
  'service_departments',
  'report_files',
  'journal_book_prints',
  'openings',
  'opening_lines',
  'voucher_sequences',
  'cash_vouchers',
  'materials',
  'project_terms',
  'project_budgets',
  'subcontracts',
  'project_document_sequences',
  'project_documents',
  'line_quantities',
  'advance_applications',
  'project_movement_sequences',
  'project_movements',
  'project_movement_cancellations',
  'project_details',
  'company_branding',
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
    counterpartyType: 'client',
  });
  // A control account requires its counterparty, so the invoice names a client (S11 rule 5).
  const [clientType] = await tx
    .select({ id: dimensionTypes.id })
    .from(dimensionTypes)
    .where(and(eq(dimensionTypes.companyId, companyId), eq(dimensionTypes.code, 'client')));
  await tx.insert(accountRequiredDimensions).values({
    companyId,
    accountId: receivables,
    dimensionTypeId: clientType?.id as string,
  });
  const [billed] = await tx
    .insert(dimensionValues)
    .values({ companyId, typeId: clientType?.id as string, name: 'عميل مولّد' })
    .returning({ id: dimensionValues.id });
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
          dimensionValueIds: [billed?.id as string],
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

/**
 * The entries `seedOpening`, `seedLedger`, `seedRevaluation`, `seedProjects` and `seedMovements`
 * (S13: a deposit and its reversal) post, each with one audit row.
 */
const POSTED = 11;

/** The rows each S02, S03 and S04 table holds for a company seeded with `data`. */
const expectedRows = (data: CompanyData): Record<string, number> => ({
  // S07 a monetary account and the unrealised gain and loss accounts.
  // S10 adds two headers and a postable account under assets and under equity for the opening.
  // S11 adds a box under `111` (and `11` when the headers lack it).
  // S12 adds 114 and 114002, 211 and 211001 (and 21 when the headers lack it), 51, 511 and 511001.
  chart_accounts:
    5 +
    data.headers.length +
    3 +
    4 +
    3 +
    3 +
    6 +
    2 +
    (data.headers.includes('11') ? 0 : 1) +
    7 +
    (data.headers.includes('21') ? 0 : 1),
  // S11: the receivable control account requires its client; S12: both supplier accounts theirs.
  account_required_dimensions: 4,
  account_roles: 3,
  dimension_types: 6,
  // The clients, S04's value, S09's service and department, and the invoice's client (S11).
  // S12: a project and a supplier.
  dimension_values: data.clients.length + 1 + 2 + 1 + 2,
  rate_pairs: data.bookCurrency === 'SYP' ? 1 : 2,
  exchange_rates: data.rates.length + 2,
  bulletin_holidays: data.holidays.length,
  posting_requests: POSTED,
  journal_entries: POSTED,
  // S10's opening: two stated lines; S12's advance two lines and its purchase three.
  // S13: the deposit's two lines and its reversal's two.
  journal_lines: 23,
  // The expense's and S07's cash entry's two lines convert into the book currency; the reversal
  // carries its amounts, the invoice is in the book currency and a revaluation converts nothing.
  line_conversions: 4,
  // S12: the supplier and the project, the supplier alone (its items), the project alone.
  dimension_sets: 6,
  dimension_set_values: 6,
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
  // S12: the advance on 114002, the purchase's cost on 511001 and its credit on 211001.
  // S13: the box in November, moved by the deposit (591002's November row was there).
  period_balances: 14,
  // S11's count draft beside S03's, and S12's purchase.
  // S13: the deposit's draft.
  entry_drafts: 4,
  entry_draft_lines: 2,
  entry_attachments: 2,
  chain_anchors: 1,
  company_exports: 1,
  // S12: the supplier's advance and its running item, moved three times.
  open_items: 3,
  open_item_movements: 4,
  open_item_due_dates: 1,
  open_item_balances: 3,
  revaluations: 1,
  period_events: 1,
  service_departments: 1,
  // A draft PDF queued and November's official print, ready with its register row.
  report_files: 2,
  journal_book_prints: 1,
  // S10: the posted opening and its two lines.
  openings: 1,
  opening_lines: 2,
  // S11: a count of the box that matched, recorded with its number and no entry.
  voucher_sequences: 1,
  cash_vouchers: 1,
  // S12: a material, a project's terms with one budget line, a subcontract, and a purchase applying
  // an advance with its number, its line's quantity and its covered part.
  materials: 1,
  project_terms: 1,
  project_budgets: 1,
  subcontracts: 1,
  project_document_sequences: 1,
  project_documents: 1,
  line_quantities: 1,
  advance_applications: 1,
  // S13: two movements, the second a deposit cancelled by its reversal; a project's details and the
  // branding.
  project_movement_sequences: 1,
  project_movements: 2,
  project_movement_cancellations: 1,
  project_details: 1,
  company_branding: 1,
});

/**
 * S12's rows: the master data written directly, then an advance of 10.00 paid to a supplier for a
 * project and a purchase of 1.000 of a material at 7.0000 applying 3.00 of it, posted through the
 * posting function from its draft, all in the book currency.
 */
async function seedProjects(tx: Transaction, companyId: string, userId: string, data: CompanyData) {
  const typeOf = async (code: string) => {
    const [type] = await tx
      .select({ id: dimensionTypes.id })
      .from(dimensionTypes)
      .where(and(eq(dimensionTypes.companyId, companyId), eq(dimensionTypes.code, code)));
    return type?.id as string;
  };
  const supplierType = await typeOf('supplier');
  const [project] = await tx
    .insert(dimensionValues)
    .values({
      companyId,
      typeId: await typeOf('contract'),
      code: 'P1',
      name: 'مشروع مولّد',
      contractKind: 'project',
    })
    .returning({ id: dimensionValues.id });
  const [supplier] = await tx
    .insert(dimensionValues)
    .values({ companyId, typeId: supplierType, code: 'S1', name: 'مورّد مولّد' })
    .returning({ id: dimensionValues.id });
  const projectId = project?.id as string;
  const supplierId = supplier?.id as string;
  await addAccount(tx, companyId, '11', { code: '114' });
  const advances = await addAccount(tx, companyId, '114', {
    code: '114002',
    kind: 'postable',
    statementLine: 'bs.other_current_assets',
    isControl: true,
    itemKind: 'running',
    counterpartyType: 'supplier',
  });
  if (!data.headers.includes('21')) await addAccount(tx, companyId, '2', { code: '21' });
  await addAccount(tx, companyId, '21', { code: '211' });
  const suppliers = await addAccount(tx, companyId, '211', {
    code: '211001',
    kind: 'postable',
    statementLine: 'bs.trade_payables',
    isControl: true,
    itemKind: 'running',
    counterpartyType: 'supplier',
    isMonetary: true,
  });
  for (const accountId of [advances, suppliers]) {
    await tx
      .insert(accountRequiredDimensions)
      .values({ companyId, accountId, dimensionTypeId: supplierType });
  }
  await addAccount(tx, companyId, '5', { code: '51' });
  await addAccount(tx, companyId, '51', { code: '511' });
  const materialsAccount = await addAccount(tx, companyId, '511', {
    code: '511001',
    kind: 'postable',
    statementLine: 'is.direct_costs',
    requiresMaterial: true,
  });
  const [material] = await tx
    .insert(materials)
    .values({ companyId, code: 'M1', name: 'مادة مولّدة', unit: 'طن' })
    .returning({ id: materials.id });
  await tx.insert(projectTerms).values({
    companyId,
    contractValueId: projectId,
    currency: data.bookCurrency,
    contractValueMinor: 100_000n,
    retentionBp: 1000,
    advanceRecoveryBp: 2000,
  });
  await tx.insert(projectBudgets).values({
    companyId,
    contractValueId: projectId,
    accountId: materialsAccount,
    amountMinor: 50_000n,
  });
  await tx.insert(subcontracts).values({
    companyId,
    contractValueId: projectId,
    supplierValueId: supplierId,
    currency: data.bookCurrency,
    retentionBp: 500,
    advanceRecoveryBp: 0,
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
    preparedByUserId: userId,
    approvedByUserId: null,
    actor,
  };
  const [credit] = await tx
    .select({ id: chartAccounts.id })
    .from(chartAccounts)
    .where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.code, '591002')));
  await post(tx, {
    ...common,
    idempotencyKey: `generated-advance-${companyId}`,
    entryDate: '2026-11-10',
    draftId: null,
    content: {
      kind: 'manual',
      today: '2026-11-30',
      dealtRates: [],
      lines: [
        {
          accountId: advances,
          dimensionValueIds: [supplierId, projectId],
          currency: data.bookCurrency,
          amountMinor: 1_000n,
          memo: null,
        },
        {
          accountId: credit?.id as string,
          dimensionValueIds: [],
          currency: data.bookCurrency,
          amountMinor: -1_000n,
          memo: null,
        },
      ],
    },
  });
  const draftId = uuidv7();
  const document = {
    kind: 'purchase' as const,
    contractValueId: projectId,
    counterpartyValueId: supplierId,
    currency: data.bookCurrency,
    side: null,
    periodFrom: null,
    periodTo: null,
    cumulativeMinor: null,
    retentionMinor: null,
    advanceMinor: 300n,
    supplierReference: 'F-1',
  };
  await tx.insert(entryDrafts).values({
    id: draftId,
    companyId,
    state: 'draft',
    entryDate: '2026-11-11',
    description: 'فاتورة مولّدة',
    preparedByUserId: userId,
    projectDocumentKind: 'purchase',
    contractValueId: projectId,
    counterpartyValueId: supplierId,
    documentCurrency: data.bookCurrency,
    advanceMinor: 300n,
    supplierReference: 'F-1',
  });
  const entry = await post(tx, {
    ...common,
    idempotencyKey: draftId,
    entryDate: '2026-11-11',
    draftId,
    content: {
      kind: 'project_document',
      today: '2026-11-30',
      document,
      lines: [
        {
          accountId: materialsAccount,
          dimensionValueIds: [],
          amountMinor: null,
          memo: null,
          quantity: {
            materialId: material?.id as string,
            unit: 'طن',
            quantity: '1.000',
            unitPrice: '7.0000',
          },
          advanceMinor: null,
        },
      ],
    },
  });
  await tx
    .update(entryDrafts)
    .set({ state: 'posted', postedEntryId: entry.id })
    .where(eq(entryDrafts.id, draftId));
}

/**
 * S13's rows: a project's details, the company's branding, movement 1 recording S12's purchase as a
 * debt owed by us, and movement 2 a deposit into the box from its own draft, posted, then cancelled
 * by its reversal with its cancellation row.
 */
async function seedMovements(tx: Transaction, companyId: string, userId: string) {
  const codeOf = async (code: string) => {
    const [account] = await tx
      .select({ id: chartAccounts.id })
      .from(chartAccounts)
      .where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.code, code)));
    return account?.id as string;
  };
  const dimensionValueOf = async (code: string) => {
    const [value] = await tx
      .select({ id: dimensionValues.id })
      .from(dimensionValues)
      .where(and(eq(dimensionValues.companyId, companyId), eq(dimensionValues.code, code)));
    return value?.id as string;
  };
  const [settings] = await tx
    .select({ currency: companySettings.bookCurrency })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId));
  const currency = settings?.currency as CurrencyCode;
  const projectId = await dimensionValueOf('P1');
  const [purchase] = await tx
    .select({
      entryId: projectDocuments.entryId,
      draftId: projectDocuments.draftId,
      fiscalYear: projectDocuments.fiscalYear,
    })
    .from(projectDocuments)
    .where(eq(projectDocuments.companyId, companyId));
  await tx.insert(projectDetails).values({
    companyId,
    contractValueId: projectId,
    startDate: '2026-11-01',
    state: 'active',
  });
  await tx.insert(companyBranding).values({ companyId, displayName: 'شركة مولّدة' });
  const fiscalYear = purchase?.fiscalYear as number;
  await tx.insert(projectMovementSequences).values({ companyId, fiscalYear, lastNumber: 1 });
  await tx.insert(projectMovements).values({
    companyId,
    kind: 'owed_by_us',
    fiscalYear,
    number: 1,
    movementDate: '2026-11-11',
    contractValueId: projectId,
    counterpartyValueId: await dimensionValueOf('S1'),
    currency,
    amountMinor: 700n,
    description: 'فاتورة مولّدة',
    entryId: purchase?.entryId as string,
    draftId: purchase?.draftId as string,
    requestKey: `generated-movement-1-${companyId}`,
    requestHash: '0'.repeat(64),
    createdByUserId: userId,
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
    description: 'إيداع مولّد',
    reference: null,
    preparedByUserId: userId,
    approvedByUserId: null,
    actor,
  };
  const draftId = uuidv7();
  await tx.insert(entryDrafts).values({
    id: draftId,
    companyId,
    state: 'draft',
    entryDate: '2026-11-21',
    description: 'إيداع مولّد',
    preparedByUserId: userId,
  });
  const deposit = await post(tx, {
    ...common,
    idempotencyKey: draftId,
    entryDate: '2026-11-21',
    draftId,
    content: {
      kind: 'manual',
      today: '2026-11-30',
      dealtRates: [],
      lines: [
        {
          accountId: await codeOf('111001'),
          dimensionValueIds: [],
          currency,
          amountMinor: 500n,
          memo: null,
        },
        {
          accountId: await codeOf('591002'),
          dimensionValueIds: [],
          currency,
          amountMinor: -500n,
          memo: null,
        },
      ],
    },
  });
  await tx
    .update(entryDrafts)
    .set({ state: 'posted', postedEntryId: deposit.id })
    .where(eq(entryDrafts.id, draftId));
  await tx
    .update(projectMovementSequences)
    .set({ lastNumber: 2 })
    .where(eq(projectMovementSequences.companyId, companyId));
  const [movement] = await tx
    .insert(projectMovements)
    .values({
      companyId,
      kind: 'deposit',
      fiscalYear,
      number: 2,
      movementDate: '2026-11-21',
      currency,
      amountMinor: 500n,
      description: 'إيداع مولّد',
      entryId: deposit.id,
      draftId,
      requestKey: `generated-movement-2-${companyId}`,
      requestHash: '1'.repeat(64),
      createdByUserId: userId,
    })
    .returning({ id: projectMovements.id });
  const reversal = await post(tx, {
    ...common,
    idempotencyKey: `reversal:${deposit.id}`,
    entryDate: '2026-11-22',
    draftId: null,
    content: { kind: 'reversal', entryId: deposit.id, today: '2026-11-30' },
  });
  await tx.insert(projectMovementCancellations).values({
    companyId,
    movementId: movement?.id as string,
    reversalEntryId: reversal.id,
    reason: 'إلغاء مولّد',
    createdByUserId: userId,
  });
}

/**
 * S11's rows: a box in the book currency, and a count of it that matched (rule 13), posted through
 * the posting function from its voucher draft with no entry, the draft then marked posted.
 */
async function seedVoucher(tx: Transaction, companyId: string, userId: string, data: CompanyData) {
  if (!data.headers.includes('11')) await addAccount(tx, companyId, '1', { code: '11' });
  await addAccount(tx, companyId, '11', { code: '111' });
  const box = await addAccount(tx, companyId, '111', {
    code: '111001',
    kind: 'postable',
    statementLine: 'bs.cash',
    currency: data.bookCurrency,
    isMonetary: true,
    cashKind: 'box',
  });
  const draftId = uuidv7();
  await tx.insert(entryDrafts).values({
    id: draftId,
    companyId,
    state: 'draft',
    entryDate: '2026-11-20',
    description: 'جرد مولّد',
    preparedByUserId: userId,
    voucherKind: 'count',
    cashAccountId: box,
    countedMinor: 0n,
  });
  await postVoucher(tx, {
    client: 'manual',
    idempotencyKey: draftId,
    entryDate: '2026-11-20',
    description: 'جرد مولّد',
    reference: null,
    draftId,
    preparedByUserId: userId,
    approvedByUserId: null,
    actor: {
      kind: 'person',
      userId,
      name: 'شخص مولّد',
      sessionId: null,
      requestId: 'request-generated',
      ipAddress: null,
      userAgent: null,
    },
    voucher: {
      kind: 'count',
      cashAccountId: box,
      counterCashAccountId: null,
      partyName: null,
      countedMinor: 0n,
      expectedMinor: 0n,
    },
    lines: [],
    dealtRates: [],
    today: '2026-11-30',
  });
  await tx.update(entryDrafts).set({ state: 'posted' }).where(eq(entryDrafts.id, draftId));
}

/**
 * S10's rows: the company's books start on 1 November, the opening's draft at version 1 with two
 * lines, and its entry posted through the posting function as the company's first entry: a stated
 * asset and a stated capital, in the book currency.
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
  const [opening] = await tx
    .insert(openings)
    .values({ companyId, preparedByUserId: userId })
    .returning();
  if (!opening) throw new Error('no opening seeded');
  const settings = await tx.select().from(companySettings);
  const currency = settings[0]?.bookCurrency as 'SYP';
  await tx.insert(openingLines).values([
    {
      companyId,
      openingId: opening.id,
      version: 1,
      lineNo: 1,
      accountId: asset,
      currency,
      amountMinor: 1000n,
    },
    {
      companyId,
      openingId: opening.id,
      version: 1,
      lineNo: 2,
      accountId: capital,
      currency,
      amountMinor: -1000n,
    },
  ]);
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
        {
          accountId: asset,
          dimensionValueIds: [],
          currency,
          amountMinor: 1000n,
          memo: null,
          stated: { bookMinor: 1000n, parallelMinor: null },
        },
        {
          accountId: capital,
          dimensionValueIds: [],
          currency,
          amountMinor: -1000n,
          memo: null,
          stated: { bookMinor: -1000n, parallelMinor: null },
        },
      ],
    },
  });
  await tx
    .update(openings)
    .set({
      state: 'posted',
      entryId: entry.id,
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
    await seedServiceDepartment(tx, row.id, userId);
    await seedVoucher(tx, row.id, userId, data);
    await seedProjects(tx, row.id, userId, data);
    await seedMovements(tx, row.id, userId);
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
          // Each entry's row, S07's revaluation.posted and S11's cash_count.recorded.
          expect(seen.audit).toHaveLength(data.audit.length + POSTED + 2);
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
