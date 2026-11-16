import {
  type CompanyLedgers,
  type CurrencyCode,
  DomainError,
  type Ledger,
} from '@vertex-mizan/contracts';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  chartAccounts,
  createCompanyBooks,
  createDimensionValue,
  createMaterial,
  createSubcontract,
  type DocumentLineSpec,
  dimensionTypes,
  entryDrafts,
  type PersonActor,
  type ProjectDocumentSpec,
  post,
  putProjectTerms,
  readItemsAt,
  readMaterialQuantities,
  readProfitability,
  readProjectDocumentPrint,
  readProjectList,
  readProjectReport,
  readReportLines,
  recordRate,
  type Transaction,
  users,
  withCompany,
} from '../src/index.js';
import { connect } from './connections.js';

// S12 PR 3 on the migrated database: the project list, the project report and the material
// quantities read what S12's documents posted, and agree with the ledger (S12 "Reconciliation"):
// revenue and direct costs equal S09's profitability by contract, costs by account sum to the
// direct costs, the materials equal the project's `511001` lines, a billing's state and what
// remains of it, the drill-down by material, and isolation. All values are synthetic.

const { app } = connect();

let personId = '';

const actor = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-project-reports-test',
  ipAddress: null,
  userAgent: null,
});

const LEDGERS: CompanyLedgers = {
  book: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
  parallel: {
    currency: 'SYP',
    ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
  },
};

const TODAY = '2026-12-31';
const NOW = new Date('2026-12-31T12:00:00Z');
const DECEMBER = { from: '2026-12-01', to: '2026-12-31' } as const;

interface Books {
  readonly id: string;
  readonly accounts: Map<string, string>;
  readonly project: string;
  readonly client: string;
  readonly supplier: string;
  readonly cement: string;
  readonly steel: string;
}

const inCompany = <T>(companyId: string, work: (tx: Transaction) => Promise<T>) =>
  withCompany(app, companyId, work, { isolationLevel: 'repeatable read' });

async function newBooks(): Promise<Books> {
  const id = uuidv7();
  return withCompany(app, id, async (tx) => {
    await createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة مقاولات تجريبية',
        nameLatin: null,
        ledgers: LEDGERS,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'contracting',
        createdByUserId: personId,
      },
      actor(),
    );
    const rates: [string, CurrencyCode, CurrencyCode, string, 'bulletin' | 'market'][] = [
      ['2026-11-02', 'USD', 'SYP', '115.0000', 'bulletin'],
      ['2026-12-03', 'TRY', 'SYP', '3.5000', 'bulletin'],
      ['2026-12-03', 'USD', 'TRY', '34.0000', 'market'],
      ['2026-12-31', 'USD', 'SYP', '120.0000', 'bulletin'],
    ];
    for (const [effectiveOn, base, quote, rate, type] of rates) {
      await recordRate(tx, id, actor(), { effectiveOn, base, quote, rate, type, source: 'manual' });
    }
    const types = new Map(
      (
        await tx.select({ id: dimensionTypes.id, code: dimensionTypes.code }).from(dimensionTypes)
      ).map((row) => [row.code, row.id]),
    );
    const value = async (type: string, code: string, extra: object = {}) =>
      (
        await createDimensionValue(
          tx,
          id,
          {
            typeId: types.get(type) as string,
            code,
            name: code,
            nameLatin: null,
            contractKind: null,
            parentValueId: null,
            ...extra,
          },
          actor(),
        )
      ).id;
    const client = await value('client', 'C1');
    const project = await value('contract', 'P1', {
      contractKind: 'project',
      parentValueId: client,
    });
    const supplier = await value('supplier', 'S1');
    const material = (code: string) =>
      createMaterial(tx, id, { code, name: code, nameLatin: null, unit: 'طن' }, actor());
    const cement = (await material('CEM')).id;
    const steel = (await material('STL')).id;
    const accounts = new Map(
      (await tx.select({ id: chartAccounts.id, code: chartAccounts.code }).from(chartAccounts)).map(
        (row) => [row.code, row.id],
      ),
    );
    await putProjectTerms(
      tx,
      id,
      project,
      {
        currency: 'USD',
        contractValueMinor: '10000000',
        retentionBp: 1000,
        advanceRecoveryBp: 2000,
        budget: [{ accountId: accounts.get('511001') as string, amountMinor: '4000000' }],
      },
      actor(),
    );
    return { id, accounts, project, client, supplier, cement, steel };
  });
}

const account = (books: Books, code: string) => books.accounts.get(code) as string;

const request = (
  on: string,
  content: Parameters<typeof post>[1]['content'],
  draftId: string | null = null,
) => ({
  client: 'manual' as const,
  idempotencyKey: uuidv7(),
  entryDate: on,
  description: 'قيد تجريبي',
  reference: null,
  draftId,
  preparedByUserId: personId,
  approvedByUserId: null,
  actor: actor(),
  content,
});

async function postDocument(
  books: Books,
  on: string,
  document: ProjectDocumentSpec,
  lines: DocumentLineSpec[],
) {
  return inCompany(books.id, async (tx) => {
    const draftId = uuidv7();
    await tx.insert(entryDrafts).values({
      id: draftId,
      companyId: books.id,
      state: 'draft',
      entryDate: on,
      description: 'مستند مشروع تجريبي',
      preparedByUserId: personId,
      projectDocumentKind: document.kind,
      contractValueId: document.contractValueId,
      counterpartyValueId: document.counterpartyValueId,
      documentCurrency: document.currency,
      side: document.side,
      periodFrom: document.periodFrom,
      periodTo: document.periodTo,
      cumulativeMinor: document.cumulativeMinor,
      retentionMinor: document.retentionMinor,
      advanceMinor: document.advanceMinor,
      supplierReference: document.supplierReference,
    });
    const entry = await post(tx, {
      ...request(on, { kind: 'project_document', today: TODAY, document, lines }, draftId),
      idempotencyKey: draftId,
    });
    await tx
      .update(entryDrafts)
      .set({ state: 'posted', postedEntryId: entry.id })
      .where(sql`${entryDrafts.id} = ${draftId}`);
    return entry;
  });
}

const header = (books: Books, kind: ProjectDocumentSpec['kind']): ProjectDocumentSpec => ({
  kind,
  contractValueId: books.project,
  counterpartyValueId: kind === 'purchase' ? books.supplier : null,
  currency: kind === 'purchase' ? 'TRY' : null,
  side: null,
  periodFrom: null,
  periodTo: null,
  cumulativeMinor: null,
  retentionMinor: null,
  advanceMinor: null,
  supplierReference: kind === 'purchase' ? 'F-1024' : null,
});

const ton = (books: Books, materialId: string, quantity: string, unitPrice: string) =>
  ({
    accountId: account(books, '511001'),
    dimensionValueIds: [],
    amountMinor: null,
    memo: null,
    quantity: { materialId, unit: 'طن', quantity, unitPrice },
    advanceMinor: null,
  }) satisfies DocumentLineSpec;

/**
 * `reports/project-report.md`'s December in short: C1's advance on 2 November, S1's TRY invoice on
 * 3 December, billing 1 (cumulative 30,000.00) on the 31st.
 */
async function december(): Promise<{ books: Books; billing: string }> {
  const books = await newBooks();
  await inCompany(books.id, (tx) =>
    post(
      tx,
      request('2026-11-02', {
        kind: 'manual',
        today: TODAY,
        dealtRates: [],
        lines: [
          {
            accountId: account(books, '111004'),
            dimensionValueIds: [],
            currency: 'USD',
            amountMinor: 2000000n,
            memo: null,
          },
          {
            accountId: account(books, '212002'),
            dimensionValueIds: [books.client, books.project],
            currency: 'USD',
            amountMinor: -2000000n,
            memo: null,
          },
        ],
      }),
    ),
  );
  await postDocument(books, '2026-12-03', header(books, 'purchase'), [
    ton(books, books.cement, '12.500', '3150.0000'),
    ton(books, books.steel, '2.000', '23800.0000'),
  ]);
  const billing = await postDocument(
    books,
    '2026-12-31',
    { ...header(books, 'progress_billing'), cumulativeMinor: 3000000n },
    [],
  );
  return { books, billing: billing.id };
}

const reportOf = (books: Books, ledger: Ledger, projectId = books.project) =>
  inCompany(books.id, (tx) => readProjectReport(tx, projectId, { ...DECEMBER, ledger }, NOW));

beforeAll(async () => {
  const [person] = await app
    .insert(users)
    .values({ email: `project-reports-${uuidv7()}@example.test`, name: 'محاسب تجريبي' })
    .returning({ id: users.id });
  personId = person?.id as string;
});

describe('the project report (S12 "Reports")', () => {
  it("reads December's figures and agrees with profitability by contract in both ledgers", async () => {
    const { books } = await december();
    for (const ledger of ['book', 'parallel'] as const) {
      const report = await reportOf(books, ledger);
      const profit = await inCompany(books.id, (tx) =>
        readProfitability(tx, { by: 'contract', ...DECEMBER, ledger, compare: false }, NOW),
      );
      const row = profit.rows.find((candidate) => candidate.value?.id === books.project);
      expect(row?.current).toEqual({
        revenue: report.summary.revenue,
        directCosts: report.summary.directCosts,
        contribution: report.summary.contribution,
        margin: report.summary.margin,
      });
      // The costs by account sum to the direct costs; the materials to the 511001 lines.
      expect(report.costs.totals.inRange).toBe(report.summary.directCosts);
      const materials = report.materials.reduce((sum, item) => sum + BigInt(item.ledgerAmount), 0n);
      const lines = await inCompany(books.id, (tx) =>
        readReportLines(
          tx,
          {
            ledger,
            ...DECEMBER,
            account: account(books, '511001'),
            contract: books.project,
            dims: [],
            openingEntry: false,
          },
          NOW,
        ),
      );
      expect(materials).toBe(BigInt(lines.sum));
    }
    const book = await reportOf(books, 'book');
    expect(book.summary).toEqual({
      cumulativeMinor: '3000000',
      billed: '30.0',
      revenue: '3000000',
      directCosts: '255809',
      contribution: '2744191',
      margin: '91.5',
      retentionReceivable: '300000',
      clientAdvance: '1400000',
      subcontractRetention: '0',
      subcontractAdvance: '0',
    });
    // 2,558.09 of a 40,000.00 budget: the variance in the book in the terms' USD.
    expect(book.costs.rows.map((row) => [row.account.code, row.variance, row.used])).toEqual([
      ['511001', '3744191', '6.4'],
    ]);
    expect(book.materials.map((row) => [row.material.code, row.quantity, row.average])).toEqual([
      ['CEM', '12.500', '3150.0000'],
      ['STL', '2.000', '23800.0000'],
    ]);
    expect(book.billings).toMatchObject([
      { projectSequence: 1, periodMinor: '3000000', netMinor: '2100000', state: 'posted' },
    ]);
    expect(book.billings[0]?.outstandingMinor).toBe('2100000');
    const parallel = await reportOf(books, 'parallel');
    // The parallel revenue keeps the covered part at the advance's 115 (IFRIC 22.8).
    expect(parallel.summary.revenue).toBe('357000000');
    expect(parallel.costs.totals).toMatchObject({
      variance: null,
      used: null,
      budgetMinor: '4000000',
    });
  });

  it('drills from a material to its lines', async () => {
    const { books } = await december();
    const report = await reportOf(books, 'book');
    for (const row of report.materials) {
      const lines = await inCompany(books.id, (tx) =>
        readReportLines(
          tx,
          {
            ledger: 'book',
            ...DECEMBER,
            statementLine: 'is.direct_costs',
            contract: books.project,
            material: row.material.id,
            dims: [],
            openingEntry: false,
          },
          NOW,
        ),
      );
      expect(lines.sum).toBe(row.ledgerAmount);
      expect(lines.count).toBe(1);
    }
  });

  it('shows a cancelled billing as cancelled, with nothing billed or outstanding', async () => {
    const { books, billing } = await december();
    await inCompany(books.id, (tx) =>
      post(tx, request('2026-12-31', { kind: 'reversal', entryId: billing, today: TODAY })),
    );
    const report = await reportOf(books, 'book');
    expect(report.billings).toMatchObject([{ state: 'cancelled', outstandingMinor: '0' }]);
    expect(report.summary).toMatchObject({
      cumulativeMinor: '0',
      billed: '0.0',
      revenue: '0',
      clientAdvance: '2000000',
      retentionReceivable: '0',
    });
  });

  it('prints a billing with the terms it was posted under, after the terms change (0075)', async () => {
    const { books, billing } = await december();
    await inCompany(books.id, (tx) =>
      putProjectTerms(
        tx,
        books.id,
        books.project,
        {
          currency: 'USD',
          contractValueMinor: '12000000',
          retentionBp: 500,
          advanceRecoveryBp: 1250,
          budget: [],
        },
        actor(),
      ),
    );
    const [document] = (
      await inCompany(books.id, (tx) =>
        tx.execute<{ id: string; contract_value_minor: string; retention_bp: number }>(sql`
          select id, contract_value_minor::text, retention_bp from project_documents
          where entry_id = ${billing}::uuid`),
      )
    ).rows;
    expect(document).toMatchObject({ contract_value_minor: '10000000', retention_bp: 1000 });
    const print = await inCompany(books.id, (tx) =>
      readProjectDocumentPrint(tx, document?.id as string),
    );
    expect(print).toMatchObject({
      kind: 'progress_billing',
      projectSequence: 1,
      contractValueMinor: '10000000',
      retentionRate: '10',
      advanceRecoveryRate: '20',
      totalMinor: '3000000',
      netMinor: '2100000',
      client: { code: 'C1' },
      lines: [],
    });
    // The purchase prints its lines with their quantities, and no terms.
    const [purchase] = (
      await inCompany(books.id, (tx) =>
        tx.execute<{ id: string }>(sql`select id from project_documents where kind = 'purchase'`),
      )
    ).rows;
    const invoice = await inCompany(books.id, (tx) =>
      readProjectDocumentPrint(tx, purchase?.id as string),
    );
    expect(invoice).toMatchObject({ retentionRate: null, contractValueMinor: null });
    expect(
      invoice.lines.map((line) => [line.account.code, line.quantity, line.material?.code]),
    ).toEqual([
      ['511001', '12.500', 'CEM'],
      ['511001', '2.000', 'STL'],
    ]);
  });

  it('lists the projects with their life-to-date figures, equal to the report from the start', async () => {
    const { books } = await december();
    const list = await inCompany(books.id, (tx) =>
      readProjectList(tx, { ledger: 'book', archived: false }, TODAY, NOW),
    );
    expect(list.projects).toHaveLength(1);
    expect(list.projects[0]).toMatchObject({
      project: { id: books.project, code: 'P1' },
      client: { id: books.client },
      terms: { currency: 'USD', contractValueMinor: '10000000' },
      cumulativeMinor: '3000000',
      billed: '30.0',
      revenue: '3000000',
      directCosts: '255809',
      retentionReceivable: '300000',
      clientAdvance: '1400000',
      budgetMinor: '4000000',
    });
  });

  it("totals the material quantities as the requires-material accounts' lines", async () => {
    const { books } = await december();
    const quantities = await inCompany(books.id, (tx) =>
      readMaterialQuantities(tx, { ...DECEMBER, ledger: 'parallel' }, NOW),
    );
    expect(
      quantities.rows.map((row) => [row.material.code, row.quantityIn, row.quantityOut]),
    ).toEqual([
      ['CEM', '12.500', '0.000'],
      ['STL', '2.000', '0.000'],
    ]);
    const rows = quantities.rows.reduce((sum, row) => sum + BigInt(row.ledgerAmount), 0n);
    expect(BigInt(quantities.ledgerTotal)).toBe(rows);
    expect(quantities.ledgerTotal).toBe('30441250');
    const steel = await inCompany(books.id, (tx) =>
      readMaterialQuantities(tx, { ...DECEMBER, ledger: 'book', material: books.steel }, NOW),
    );
    expect(steel.rows.map((row) => row.ledgerAmount)).toEqual(['140000']);
  });

  it("counts a subcontractor's payments, one on account too: a reversed one nets out, a billing is none", async () => {
    const books = await newBooks();
    await inCompany(books.id, (tx) =>
      createSubcontract(
        tx,
        books.id,
        {
          contractValueId: books.project,
          supplierValueId: books.supplier,
          currency: 'USD',
          valueMinor: '1000000',
          retentionBp: 1000,
          advanceRecoveryBp: 0,
        },
        actor(),
      ),
    );
    const pay = (paid: bigint) =>
      inCompany(books.id, (tx) =>
        post(
          tx,
          request('2026-12-31', {
            kind: 'manual',
            today: TODAY,
            dealtRates: [],
            lines: [
              {
                accountId: account(books, '211002'),
                dimensionValueIds: [books.supplier],
                currency: 'USD',
                amountMinor: paid,
                memo: null,
              },
              {
                accountId: account(books, '111004'),
                dimensionValueIds: [],
                currency: 'USD',
                amountMinor: -paid,
                memo: null,
              },
            ],
          }),
        ),
      );
    // An overpayment of 200.00 leaves S1 a debit, which the billing's net then clears.
    await pay(20000n);
    await postDocument(
      books,
      '2026-12-31',
      {
        ...header(books, 'subcontract_billing'),
        counterpartyValueId: books.supplier,
        cumulativeMinor: 300000n,
      },
      [],
    );
    await pay(100000n);
    const cancelled = await pay(50000n);
    await inCompany(books.id, (tx) =>
      post(tx, request('2026-12-31', { kind: 'reversal', entryId: cancelled.id, today: TODAY })),
    );
    const report = await reportOf(books, 'book');
    expect(report.subcontracts).toMatchObject([
      { cumulativeMinor: '300000', retention: '30000', paid: '120000' },
    ]);
    // 200.00 on account and 1,000.00, at 120; the 500.00 reversed nets out.
    expect((await reportOf(books, 'parallel')).subcontracts[0]?.paid).toBe('14400000');
  });

  it("refuses anything but a project, and never reads another company's", async () => {
    const { books } = await december();
    const other = await newBooks();
    const codeOf = async (work: Promise<unknown>) =>
      work.then(
        () => 'none',
        (error: unknown) => (error instanceof DomainError ? error.code : 'thrown'),
      );
    expect(await codeOf(reportOf(books, 'book', books.client))).toBe('NOT_FOUND');
    expect(await codeOf(reportOf(other, 'book', books.project))).toBe('NOT_FOUND');
    const [document] = (
      await inCompany(books.id, (tx) =>
        tx.execute<{ id: string }>(sql`select id from project_documents limit 1`),
      )
    ).rows;
    expect(
      await codeOf(
        inCompany(other.id, (tx) => readProjectDocumentPrint(tx, document?.id as string)),
      ),
    ).toBe('NOT_FOUND');
    expect(
      (
        await inCompany(other.id, (tx) =>
          readMaterialQuantities(tx, { ...DECEMBER, ledger: 'book', contract: books.project }, NOW),
        )
      ).rows,
    ).toEqual([]);
    const list = await inCompany(other.id, (tx) =>
      readProjectList(tx, { ledger: 'book', archived: false }, TODAY, NOW),
    );
    expect(list.projects.map((row) => row.project.id)).toEqual([other.project]);
    expect(list.projects[0]?.revenue).toBe('0');
  });
});

describe("the open items' contract filter (S12 rule 19's release screen)", () => {
  it("finds a client's retentions of one project, not those of the client's other project", async () => {
    const { books } = await december();
    // A second project of the same client, billed with its own retention.
    const second = await inCompany(books.id, async (tx) => {
      const [contract] = await tx
        .select({ id: dimensionTypes.id })
        .from(dimensionTypes)
        .where(sql`${dimensionTypes.code} = 'contract'`);
      const value = await createDimensionValue(
        tx,
        books.id,
        {
          typeId: contract?.id as string,
          code: 'P2',
          name: 'P2',
          nameLatin: null,
          contractKind: 'project',
          parentValueId: books.client,
        },
        actor(),
      );
      await putProjectTerms(
        tx,
        books.id,
        value.id,
        {
          currency: 'USD',
          contractValueMinor: '5000000',
          retentionBp: 1000,
          advanceRecoveryBp: 0,
          budget: [],
        },
        actor(),
      );
      return value.id;
    });
    await postDocument(
      books,
      '2026-12-31',
      { ...header(books, 'progress_billing'), contractValueId: second, cumulativeMinor: 1000000n },
      [],
    );
    const retentions = (contractValueId?: string) =>
      inCompany(books.id, (tx) =>
        readItemsAt(tx, {
          asOf: TODAY,
          accountIds: [account(books, '113002')],
          counterpartyValueId: books.client,
          state: 'open',
          ...(contractValueId && { contractValueId }),
        }),
      );
    const all = await retentions();
    const first = await retentions(books.project);
    const other = await retentions(second);
    expect(all).toHaveLength(2);
    expect(first.map((item) => item.openMinor)).toEqual([300000n]);
    expect(other.map((item) => item.openMinor)).toEqual([100000n]);
    expect(new Set([...first, ...other].map((item) => item.id))).toEqual(
      new Set(all.map((item) => item.id)),
    );
  });
});
