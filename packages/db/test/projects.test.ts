import { createHash } from 'node:crypto';
import {
  type CompanyLedgers,
  CURRENCY_CODES,
  type CurrencyCode,
  currencies,
  DomainError,
  PROJECT_DOCUMENT_KINDS,
  RETENTION_SIDES,
} from '@vertex-mizan/contracts';
import { firstChainBreak } from '@vertex-mizan/ledger';
import { asc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  advanceApplications,
  archiveMaterial,
  auditEntries,
  chartAccounts,
  createCompanyBooks,
  createDimensionValue,
  createMaterial,
  createSubcontract,
  type DocumentLineSpec,
  dimensionSets,
  dimensionTypes,
  entryDrafts,
  entryNumberCounters,
  journalEntries,
  journalLines,
  ledgerHeads,
  lineQuantities,
  openItemMovements,
  openItems,
  type PersonActor,
  type ProjectDocumentSpec,
  post,
  postingRequests,
  previewProjectDocument,
  projectDocumentKind,
  projectDocumentSequences,
  projectDocuments,
  putProjectTerms,
  readChain,
  readProjectDocument,
  readProjectDocuments,
  readProjectTerms,
  recordRate,
  retentionSide,
  type Transaction,
  updateMaterial,
  users,
  withCompany,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// S12 PR 1 on the migrated database (0070–0071): project purchase invoices and wage sheets posted
// through the posting function with the numbers of `projects/purchase-invoice` and
// `projects/wage-sheet` (quantities, an advance applied at its carrying amounts, the reversal that
// puts it back), the documents' gapless numbers, rule 4 on every manual entry, the master data's
// rules, and the guards against quantities, applications and documents written by hand. All values
// are synthetic.

const { app, owner } = connect();

let personId = '';

const actor = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-projects-test',
  ipAddress: null,
  userAgent: null,
});

const CLIENT: CompanyLedgers = {
  book: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
  parallel: {
    currency: 'SYP',
    ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
  },
};

const TODAY = '2026-12-31';

const inCompany = <T>(companyId: string, work: (tx: Transaction) => Promise<T>) =>
  withCompany(app, companyId, work);

interface Books {
  readonly id: string;
  readonly accounts: Map<string, string>;
  readonly project: string;
  readonly client: string;
  readonly supplier: string;
  readonly workers: readonly [string, string];
  readonly cement: string;
  readonly steel: string;
}

async function newBooks(): Promise<Books> {
  const id = uuidv7();
  return withCompany(app, id, async (tx) => {
    await createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة مقاولات تجريبية',
        nameLatin: null,
        ledgers: CLIENT,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'contracting',
        createdByUserId: personId,
      },
      actor(),
    );
    const rates: [string, CurrencyCode, CurrencyCode, string, 'bulletin' | 'market'][] = [
      ['2026-11-02', 'TRY', 'SYP', '3.4000', 'bulletin'],
      ['2026-11-02', 'USD', 'TRY', '33.0000', 'market'],
      ['2026-11-02', 'USD', 'SYP', '115.0000', 'bulletin'],
      ['2026-12-03', 'TRY', 'SYP', '3.5000', 'bulletin'],
      ['2026-12-03', 'USD', 'TRY', '34.0000', 'market'],
      ['2026-12-15', 'USD', 'SYP', '120.0000', 'bulletin'],
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
    const workers = [await value('worker', 'W1'), await value('worker', 'W2')] as const;
    const material = (code: string, name: string) =>
      createMaterial(tx, id, { code, name, nameLatin: null, unit: 'طن' }, actor());
    const cement = (await material('CEM', 'أسمنت بورتلاندي')).id;
    const steel = (await material('STL', 'حديد تسليح')).id;
    const accounts = new Map(
      (await tx.select({ id: chartAccounts.id, code: chartAccounts.code }).from(chartAccounts)).map(
        (row) => [row.code, row.id],
      ),
    );
    return { id, accounts, project, client, supplier, workers, cement, steel };
  });
}

const account = (books: Books, code: string) => books.accounts.get(code) as string;

async function postManual(
  books: Books,
  on: string,
  lines: [string, string[], CurrencyCode, bigint][],
) {
  return inCompany(books.id, (tx) =>
    post(tx, {
      client: 'manual',
      idempotencyKey: uuidv7(),
      entryDate: on,
      description: 'قيد تجريبي',
      reference: null,
      draftId: null,
      preparedByUserId: personId,
      approvedByUserId: null,
      actor: actor(),
      content: {
        kind: 'manual',
        today: TODAY,
        dealtRates: [],
        lines: lines.map(([code, dimensionValueIds, currency, amountMinor]) => ({
          accountId: account(books, code),
          dimensionValueIds,
          currency,
          amountMinor,
          memo: null,
        })),
      },
    }),
  );
}

/** The scenario's advance: 30,000.00 TRY paid to S1 for P1 on 2 November. */
const advance = (books: Books) =>
  postManual(books, '2026-11-02', [
    ['114002', [books.supplier, books.project], 'TRY', 3000000n],
    ['313001', [], 'TRY', -3000000n],
  ]);

const ton = (materialId: string, quantity: string, unitPrice: string | null) => ({
  materialId,
  unit: 'طن',
  quantity,
  unitPrice,
});

function purchaseOf(books: Books, advanceMinor: bigint | null = null) {
  const document: ProjectDocumentSpec = {
    kind: 'purchase',
    contractValueId: books.project,
    counterpartyValueId: books.supplier,
    currency: 'TRY',
    periodFrom: null,
    periodTo: null,
    advanceMinor,
    supplierReference: 'F-1024',
  };
  const line = (quantity: DocumentLineSpec['quantity']): DocumentLineSpec => ({
    accountId: account(books, '511001'),
    dimensionValueIds: [],
    amountMinor: null,
    memo: null,
    quantity,
    advanceMinor: null,
  });
  return {
    document,
    lines: [
      line(ton(books.cement, '12.500', '3150.0000')),
      line(ton(books.steel, '2.000', '23800.0000')),
    ],
  };
}

/** Saves a project document draft as the drafts service does and posts it, then marks it posted. */
async function postDocument(
  books: Books,
  on: string,
  content: { document: ProjectDocumentSpec; lines: DocumentLineSpec[] },
  tx?: Transaction,
) {
  const work = async (inner: Transaction) => {
    const draftId = uuidv7();
    const { document } = content;
    await inner.insert(entryDrafts).values({
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
      periodFrom: document.periodFrom,
      periodTo: document.periodTo,
      advanceMinor: document.advanceMinor,
      supplierReference: document.supplierReference,
    });
    const entry = await post(inner, {
      client: 'manual',
      idempotencyKey: draftId,
      entryDate: on,
      description: 'مستند مشروع تجريبي',
      reference: null,
      draftId,
      preparedByUserId: personId,
      approvedByUserId: null,
      actor: actor(),
      content: { kind: 'project_document', today: TODAY, ...content },
    });
    await inner
      .update(entryDrafts)
      .set({ state: 'posted', postedEntryId: entry.id })
      .where(eq(entryDrafts.id, draftId));
    return { entry, draftId };
  };
  return tx === undefined ? inCompany(books.id, work) : work(tx);
}

async function linesOfEntry(books: Books, entryId: string) {
  return inCompany(books.id, (tx) =>
    tx
      .select({
        code: chartAccounts.code,
        amount: journalLines.amountMinor,
        book: journalLines.bookMinor,
        parallel: journalLines.parallelMinor,
      })
      .from(journalLines)
      .innerJoin(chartAccounts, eq(chartAccounts.id, journalLines.accountId))
      .where(eq(journalLines.entryId, entryId))
      .orderBy(asc(journalLines.lineNo)),
  );
}

async function codeOf(work: Promise<unknown>): Promise<{ code: string; details: unknown }> {
  try {
    await work;
  } catch (error) {
    if (error instanceof DomainError) return { code: error.code, details: error.details };
    throw error;
  }
  return { code: 'none', details: null };
}

const reverse = (books: Books, entryId: string, on: string) =>
  inCompany(books.id, (tx) =>
    post(tx, {
      client: 'manual',
      idempotencyKey: `reversal:${entryId}`,
      entryDate: on,
      description: 'إلغاء',
      reference: null,
      draftId: null,
      preparedByUserId: personId,
      approvedByUserId: null,
      actor: actor(),
      content: { kind: 'reversal', entryId, today: TODAY },
    }),
  );

beforeAll(async () => {
  const [person] = await app
    .insert(users)
    .values({ email: `projects-${uuidv7()}@example.test`, name: 'محاسب تجريبي' })
    .returning({ id: users.id });
  personId = person?.id as string;
});

describe('the lists and the currency table', () => {
  it("keeps the enums equal to contracts' lists", () => {
    expect(projectDocumentKind.enumValues).toEqual([...PROJECT_DOCUMENT_KINDS]);
    expect(retentionSide.enumValues).toEqual([...RETENTION_SIDES]);
  });

  it("keeps currency_exponent() equal to the money module's exponents", async () => {
    for (const code of CURRENCY_CODES) {
      const result = await app.execute<{ exponent: number }>(
        sql`select currency_exponent(${code}) as exponent`,
      );
      expect(result.rows[0]?.exponent, code).toBe(currencies[code].exponent);
    }
  });

  it('marks 511001 of contracting@1 as requiring a material', async () => {
    const books = await newBooks();
    const [row] = await inCompany(books.id, (tx) =>
      tx
        .select({ requiresMaterial: chartAccounts.requiresMaterial })
        .from(chartAccounts)
        .where(eq(chartAccounts.code, '511001')),
    );
    expect(row?.requiresMaterial).toBe(true);
  });
});

describe('a project purchase invoice through the posting function (S12 rules 4–8, 12, 21–22)', () => {
  it("posts the scenario's purchase applying an advance, and its reversal puts the advance back", async () => {
    const books = await newBooks();
    await advance(books);
    const { entry } = await postDocument(books, '2026-12-03', purchaseOf(books, 1500000n));
    expect(await linesOfEntry(books, entry.id)).toEqual([
      { code: '511001', amount: 3937500n, book: 116414n, parallel: 13713343n },
      { code: '511001', amount: 4760000n, book: 140732n, parallel: 16577907n },
      { code: '114002', amount: -1500000n, book: -45455n, parallel: -5100000n },
      { code: '211001', amount: -7197500n, book: -211691n, parallel: -25191250n },
    ]);
    const document = await inCompany(books.id, (tx) =>
      readProjectDocuments(tx, { kind: 'purchase' }),
    );
    expect(document.rows.map((row) => row.document)).toEqual([
      expect.objectContaining({
        kind: 'purchase',
        fiscalYear: 2026,
        number: 1,
        documentDate: '2026-12-03',
        currency: 'TRY',
        totalMinor: 8697500n,
        advanceMinor: 1500000n,
        supplierReference: 'F-1024',
        counterpartyValueId: books.supplier,
      }),
    ]);
    const detail = await inCompany(books.id, (tx) =>
      readProjectDocument(tx, { id: document.rows[0]?.document.id as string }),
    );
    expect(detail?.quantities.map((q) => [q.lineNo, q.quantity, q.unitPrice])).toEqual([
      [1, '12.500', '3150.0000'],
      [2, '2.000', '23800.0000'],
    ]);
    expect(
      detail?.applications.map((a) => [a.lineNo, a.advanceLineNo, a.amountMinor, a.bookMinor]),
    ).toEqual([
      [1, 3, 679074n, 20578n],
      [2, 3, 820926n, 24877n],
    ]);
    const [posted] = await inCompany(books.id, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.entityId, entry.id)),
    );
    expect(posted?.after).toMatchObject({
      reference: 'فاتورة مشتريات 2026/1',
      projectDocument: { kind: 'purchase', fiscalYear: 2026, number: 1 },
    });

    const reversal = await reverse(books, entry.id, '2026-12-10');
    expect(await linesOfEntry(books, reversal.id)).toEqual([
      { code: '511001', amount: -3937500n, book: -116414n, parallel: -13713343n },
      { code: '511001', amount: -4760000n, book: -140732n, parallel: -16577907n },
      { code: '114002', amount: 1500000n, book: 45455n, parallel: 5100000n },
      { code: '211001', amount: 7197500n, book: 211691n, parallel: 25191250n },
    ]);
    const negated = await inCompany(books.id, (tx) =>
      tx.select().from(lineQuantities).where(eq(lineQuantities.entryId, reversal.id)),
    );
    expect(negated.map((q) => q.quantity).sort()).toEqual(['-12.500', '-2.000']);
    const backApplications = await inCompany(books.id, (tx) =>
      tx.select().from(advanceApplications).where(eq(advanceApplications.entryId, reversal.id)),
    );
    expect(backApplications.map((a) => a.amountMinor).sort((a, b) => (a < b ? -1 : 1))).toEqual([
      -820926n,
      -679074n,
    ]);
    const cancelled = await inCompany(books.id, (tx) =>
      readProjectDocuments(tx, { state: 'cancelled' }),
    );
    expect(cancelled.rows.map((row) => row.cancelledBy?.id)).toEqual([reversal.id]);
  });

  it('refuses what the scenario refuses, taking no number', async () => {
    const books = await newBooks();
    await advance(books);
    const base = purchaseOf(books);
    const cases: [string, ReturnType<typeof purchaseOf>][] = [
      [
        'MATERIAL_REQUIRED',
        {
          ...base,
          lines: [{ ...(base.lines[0] as DocumentLineSpec), quantity: null, amountMinor: 100000n }],
        },
      ],
      [
        'VALIDATION_FAILED',
        {
          ...base,
          lines: [
            { ...(base.lines[0] as DocumentLineSpec), quantity: ton(books.cement, '0.000', null) },
          ],
        },
      ],
      [
        'VALIDATION_FAILED',
        {
          ...base,
          lines: [
            {
              ...(base.lines[0] as DocumentLineSpec),
              quantity: ton(books.cement, '0.125', '0.0300'),
            },
          ],
        },
      ],
      ['RELEASE_EXCEEDS_BALANCE', purchaseOf(books, 3500000n)],
      [
        'ADVANCE_CURRENCY_MISMATCH',
        {
          document: { ...base.document, currency: 'USD', advanceMinor: 50000n },
          lines: [
            {
              accountId: account(books, '511006'),
              dimensionValueIds: [],
              amountMinor: 50000n,
              memo: null,
              quantity: null,
              advanceMinor: null,
            },
          ],
        },
      ],
    ];
    for (const [code, content] of cases) {
      expect((await codeOf(postDocument(books, '2026-12-03', content))).code, code).toBe(code);
    }
    const archived = await inCompany(books.id, (tx) =>
      archiveMaterial(tx, books.id, books.steel, actor()),
    );
    expect(archived.archivedAt).not.toBeNull();
    expect((await codeOf(postDocument(books, '2026-12-03', purchaseOf(books)))).code).toBe(
      'MATERIAL_REQUIRED',
    );
    expect(await inCompany(books.id, (tx) => tx.select().from(projectDocuments))).toEqual([]);
  });

  it('previews the lines with their quantities and covered parts, and warns of a second reference', async () => {
    const books = await newBooks();
    await advance(books);
    const content = {
      kind: 'project_document' as const,
      today: TODAY,
      ...purchaseOf(books, 1500000n),
    };
    const preview = await inCompany(books.id, (tx) =>
      previewProjectDocument(tx, { entryDate: '2026-12-03', content }),
    );
    expect(preview).toMatchObject({
      kind: 'purchase',
      totalMinor: 8697500n,
      advanceMinor: 1500000n,
      netMinor: 7197500n,
      warnings: [],
    });
    expect(preview.lines[0]?.quantity?.quantity).toBe('12.500');
    expect(preview.lines[0]?.covered).toEqual({
      amountMinor: 679074n,
      bookMinor: 20578n,
      parallelMinor: 2308852n,
    });
    await postDocument(books, '2026-12-03', purchaseOf(books));
    const second = await inCompany(books.id, (tx) =>
      previewProjectDocument(tx, {
        entryDate: '2026-12-03',
        content: { kind: 'project_document', today: TODAY, ...purchaseOf(books) },
      }),
    );
    expect(second.warnings).toEqual(['duplicate_supplier_reference']);
  });

  it('numbers documents gaplessly per kind when two post at once', async () => {
    const books = await newBooks();
    const sheet = (
      worker: string,
    ): { document: ProjectDocumentSpec; lines: DocumentLineSpec[] } => ({
      document: {
        kind: 'wage_sheet',
        contractValueId: books.project,
        counterpartyValueId: null,
        currency: 'USD',
        periodFrom: '2026-12-01',
        periodTo: '2026-12-15',
        advanceMinor: null,
        supplierReference: null,
      },
      lines: [
        {
          accountId: null,
          dimensionValueIds: [worker],
          amountMinor: null,
          memo: null,
          quantity: { materialId: null, unit: 'يوم', quantity: '6.000', unitPrice: '25.0000' },
          advanceMinor: null,
        },
      ],
    });
    await Promise.all(
      books.workers.map((worker) => postDocument(books, '2026-12-15', sheet(worker))),
    );
    const purchase = await postDocument(books, '2026-12-03', purchaseOf(books));
    const rows = await inCompany(books.id, (tx) =>
      tx
        .select()
        .from(projectDocuments)
        .orderBy(asc(projectDocuments.kind), asc(projectDocuments.number)),
    );
    expect(rows.map((row) => [row.kind, row.number])).toEqual([
      ['purchase', 1],
      ['wage_sheet', 1],
      ['wage_sheet', 2],
    ]);
    expect(await linesOfEntry(books, purchase.entry.id)).toHaveLength(3);
  });
});

describe('quantities on every manual entry (S12 rule 4)', () => {
  it('refuses a manual line on 511001 with no material, and takes one with it', async () => {
    const books = await newBooks();
    expect(
      (
        await codeOf(
          postManual(books, '2026-12-03', [
            ['511001', [books.project], 'TRY', 100000n],
            ['313001', [], 'TRY', -100000n],
          ]),
        )
      ).code,
    ).toBe('MATERIAL_REQUIRED');
    const posted = await inCompany(books.id, (tx) =>
      post(tx, {
        client: 'manual',
        idempotencyKey: uuidv7(),
        entryDate: '2026-12-03',
        description: 'شراء نقدي',
        reference: null,
        draftId: null,
        preparedByUserId: personId,
        approvedByUserId: null,
        actor: actor(),
        content: {
          kind: 'manual',
          today: TODAY,
          dealtRates: [],
          lines: [
            {
              accountId: account(books, '511001'),
              dimensionValueIds: [books.project],
              currency: 'TRY',
              amountMinor: 1575000n,
              memo: null,
              quantity: ton(books.cement, '5.000', '3150.0000'),
            },
            {
              accountId: account(books, '313001'),
              dimensionValueIds: [],
              currency: 'TRY',
              amountMinor: -1575000n,
              memo: null,
            },
          ],
        },
      }),
    );
    expect(
      await inCompany(books.id, (tx) =>
        tx.select().from(lineQuantities).where(eq(lineQuantities.entryId, posted.id)),
      ),
    ).toHaveLength(1);
    expect(
      (
        await codeOf(
          inCompany(books.id, (tx) =>
            updateMaterial(tx, books.id, books.cement, { unit: 'كيس' }, actor()),
          ),
        )
      ).code,
    ).toBe('MATERIAL_LOCKED');
  });
});

describe('project terms and subcontracts (S12 rules 1–2)', () => {
  it('sets terms and a budget on direct costs, and pairs a project with a supplier', async () => {
    const books = await newBooks();
    const terms = {
      currency: 'USD' as const,
      contractValueMinor: '10000000',
      retentionBp: 1000,
      advanceRecoveryBp: 2000,
      budget: [{ accountId: account(books, '511001'), amountMinor: '4000000' }],
    };
    const view = await inCompany(books.id, (tx) =>
      putProjectTerms(tx, books.id, books.project, terms, actor()),
    );
    expect(view.terms).toMatchObject({ currency: 'USD', retentionBp: 1000, currencyLocked: false });
    const changed = await inCompany(books.id, (tx) =>
      putProjectTerms(
        tx,
        books.id,
        books.project,
        { ...terms, budget: [{ accountId: account(books, '511002'), amountMinor: '1500000' }] },
        actor(),
      ),
    );
    expect(changed.terms?.budget).toEqual([
      { accountId: account(books, '511002'), amountMinor: '1500000' },
    ]);
    expect(
      (
        await codeOf(
          inCompany(books.id, (tx) =>
            putProjectTerms(
              tx,
              books.id,
              books.project,
              { ...terms, budget: [{ accountId: account(books, '531001'), amountMinor: '1' }] },
              actor(),
            ),
          ),
        )
      ).code,
    ).toBe('VALIDATION_FAILED');
    expect(
      (await codeOf(inCompany(books.id, (tx) => readProjectTerms(tx, books.client)))).code,
    ).toBe('NOT_FOUND');
    const subcontract = await inCompany(books.id, (tx) =>
      createSubcontract(
        tx,
        books.id,
        {
          contractValueId: books.project,
          supplierValueId: books.supplier,
          currency: 'TRY',
          valueMinor: null,
          retentionBp: 500,
          advanceRecoveryBp: 0,
        },
        actor(),
      ),
    );
    expect(subcontract).toMatchObject({ currency: 'TRY', currencyLocked: false });
    expect(
      (
        await codeOf(
          inCompany(books.id, (tx) =>
            createSubcontract(
              tx,
              books.id,
              {
                contractValueId: books.project,
                supplierValueId: books.workers[0],
                currency: 'TRY',
                valueMinor: null,
                retentionBp: 0,
                advanceRecoveryBp: 0,
              },
              actor(),
            ),
          ),
        )
      ).code,
    ).toBe('VALIDATION_FAILED');
  });
});

describe('the guards on documents, quantities and applications (0071)', () => {
  it('never changes or deletes a document, a quantity or an application, for any role', async () => {
    const books = await newBooks();
    await advance(books);
    await postDocument(books, '2026-12-03', purchaseOf(books, 1500000n));
    for (const database of [app, owner]) {
      for (const statement of [
        sql`update project_documents set supplier_reference = 'x'`,
        sql`delete from project_documents`,
        sql`update line_quantities set quantity = 1`,
        sql`delete from advance_applications`,
      ]) {
        expect(
          await refusal(withCompany(database, books.id, (tx) => tx.execute(statement))),
        ).toMatch(/append-only|permission denied|refuse/i);
      }
    }
  });

  it('refuses a quantity whose amount is not the product, and a material lock bypassed by hand', async () => {
    const books = await newBooks();
    const { entry } = await postDocument(books, '2026-12-03', purchaseOf(books));
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          tx.execute(sql`update materials set unit = 'كيس' where id = ${books.cement}`),
        ),
      ),
    ).toMatch(/locked since its first use/);
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          tx.execute(
            sql`update chart_accounts set requires_material = false where code = '511001'`,
          ),
        ),
      ),
    ).toMatch(/locked since its first use/);
    const [line] = await inCompany(books.id, (tx) =>
      tx.select().from(journalLines).where(eq(journalLines.entryId, entry.id)).limit(1),
    );
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          tx.insert(lineQuantities).values({
            companyId: books.id,
            entryId: entry.id,
            lineId: line?.id as string,
            materialId: books.cement,
            unit: 'طن',
            quantity: '1.000',
            unitPrice: '1.0000',
          }),
        ),
      ),
    ).toMatch(/entry being posted|duplicate key/);
  });

  it("never shows one company another's documents", async () => {
    const books = await newBooks();
    const other = await newBooks();
    await postDocument(books, '2026-12-03', purchaseOf(books));
    expect(await inCompany(other.id, (tx) => tx.select().from(projectDocuments))).toEqual([]);
    expect(await inCompany(other.id, (tx) => tx.select().from(lineQuantities))).toEqual([]);
  });
});

/** A line written by hand, with the movement it claims on an item. */
interface ForgedLine {
  readonly code: string;
  readonly setKey: string;
  readonly amount: bigint;
  readonly book: bigint;
  readonly parallel: bigint;
  readonly movement?: { readonly itemId: string; readonly kind: string };
  /** `measured` by default; a clearing is `carried`. */
  readonly kind?: string;
}

type Extra = (tx: Transaction, entryId: string, lineIds: readonly string[]) => Promise<void>;

/**
 * A TRY entry written by hand as the app role, as `post()` writes one, with `extra` writing the
 * rows S12 adds while the entry is the one being posted (before the head moves past it); the
 * guards must refuse each departure, at the statement or at commit.
 */
async function forge(
  books: Books,
  lines: readonly ForgedLine[],
  extra: Extra = async () => {},
): Promise<string> {
  return inCompany(books.id, async (tx) => {
    const [head] = await tx.select().from(ledgerHeads).for('update');
    if (!head) throw new Error('no head');
    const on = '2026-12-03';
    const [counter] = await tx
      .insert(entryNumberCounters)
      .values({ companyId: books.id, fiscalYear: 2026, lastNumber: 1 })
      .onConflictDoUpdate({
        target: [entryNumberCounters.companyId, entryNumberCounters.fiscalYear],
        set: { lastNumber: sql`${entryNumberCounters.lastNumber} + 1` },
      })
      .returning();
    const [request] = await tx
      .insert(postingRequests)
      .values({
        companyId: books.id,
        client: 'manual',
        idempotencyKey: uuidv7(),
        payloadHash: '0'.repeat(64),
      })
      .returning();
    const sets = new Map(
      (await tx.select({ id: dimensionSets.id, key: dimensionSets.key }).from(dimensionSets)).map(
        (row) => [row.key, row.id],
      ),
    );
    const at = await tx.execute<{ at: string }>(
      sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at`,
    );
    const id = uuidv7();
    const hash = createHash('sha256').update(id).digest('hex');
    const sequence = head.entryCount + 1n;
    await tx.insert(journalEntries).values({
      id,
      companyId: books.id,
      requestId: request?.id as string,
      sequence,
      fiscalYear: 2026,
      number: counter?.lastNumber as number,
      entryDate: on,
      postedAt: new Date(at.rows[0]?.at as string),
      source: 'manual',
      description: 'قيد مزوّر',
      postedByUserId: personId,
      lineCount: lines.length,
      previousHash: head.lastHash,
      hash,
    });
    const stored = await tx
      .insert(journalLines)
      .values(
        lines.map((line, index) => ({
          companyId: books.id,
          entryId: id,
          lineNo: index + 1,
          accountId: account(books, line.code),
          dimensionSetId: sets.get(line.setKey) as string,
          kind: line.kind ?? 'measured',
          ledger: null,
          currency: 'TRY',
          amountMinor: line.amount,
          bookMinor: line.book,
          parallelMinor: line.parallel,
        })),
      )
      .returning({ id: journalLines.id });
    for (const [index, line] of lines.entries()) {
      if (line.movement === undefined) continue;
      await tx.insert(openItemMovements).values({
        companyId: books.id,
        itemId: line.movement.itemId,
        lineId: stored[index]?.id as string,
        entryId: id,
        entryDate: on,
        kind: line.movement.kind,
        adjusted: false,
        amountMinor: line.amount,
        bookMinor: line.book,
        parallelMinor: line.parallel,
      });
    }
    await extra(
      tx,
      id,
      stored.map((row) => row.id),
    );
    await tx
      .update(ledgerHeads)
      .set({ entryCount: sequence, lastEntryId: id, lastHash: hash })
      .where(eq(ledgerHeads.id, head.id));
    return id;
  });
}

describe('the S12 guards against writes the posting function never makes (0071–0072)', () => {
  /** Books with the advance and a posted purchase, so the forgeries' dimension sets exist. */
  async function forgeable() {
    const books = await newBooks();
    await advance(books);
    const posted = await postDocument(books, '2026-12-03', purchaseOf(books, 1500000n));
    const keys = await inCompany(books.id, (tx) =>
      tx.select({ key: dimensionSets.key }).from(dimensionSets),
    );
    const keyOf = (...values: string[]) =>
      keys.find(
        (row) =>
          values.every((value) => row.key.includes(value)) &&
          row.key.split(',').length === values.length,
      )?.key as string;
    const [item] = await inCompany(books.id, (tx) =>
      tx
        .select({ id: openItems.id })
        .from(openItems)
        .where(eq(openItems.accountId, account(books, '114002'))),
    );
    return {
      books,
      posted,
      project: keyOf(books.project),
      advanceKey: keyOf(books.supplier, books.project),
      advanceItem: item?.id as string,
    };
  }

  const cost = (setKey: string, book = 9265n, parallel = 1102500n): ForgedLine => ({
    code: '511001',
    setKey,
    amount: 315000n,
    book,
    parallel,
  });
  const owner313 = (amount = -315000n, book = -9265n, parallel = -1102500n): ForgedLine => ({
    code: '313001',
    setKey: '',
    amount,
    book,
    parallel,
  });
  const quantityOf =
    (books: Books, unitPrice: string): Extra =>
    async (tx, entryId, lineIds) => {
      await tx.insert(lineQuantities).values({
        companyId: books.id,
        entryId,
        lineId: lineIds[0] as string,
        materialId: books.cement,
        unit: 'طن',
        quantity: '1.000',
        unitPrice,
      });
    };

  it('lets a forged line with its quantity through, so each refusal below is its own', async () => {
    const { books, project } = await forgeable();
    await forge(books, [cost(project), owner313()], quantityOf(books, '3150.0000'));
  });

  it('refuses a materials line without its quantity, or one whose amount is not the product', async () => {
    const { books, project } = await forgeable();
    expect(await refusal(forge(books, [cost(project), owner313()]))).toMatch(
      /names one and its quantity/,
    );
    expect(
      await refusal(forge(books, [cost(project), owner313()], quantityOf(books, '3000.0000'))),
    ).toMatch(/quantity times its unit price/);
  });

  it('refuses covered parts that do not equal their clearing line, at commit', async () => {
    const { books, project, advanceKey, advanceItem } = await forgeable();
    const lines: ForgedLine[] = [
      cost(project, 9532n, 1072500n),
      {
        code: '114002',
        setKey: advanceKey,
        amount: -300000n,
        book: -9091n,
        parallel: -1020000n,
        kind: 'carried',
        movement: { itemId: advanceItem, kind: 'clear' },
      },
      owner313(-15000n, -441n, -52500n),
    ];
    const covering =
      (book: bigint): Extra =>
      async (tx, entryId, lineIds) => {
        await quantityOf(books, '3150.0000')(tx, entryId, lineIds);
        await tx.insert(advanceApplications).values({
          companyId: books.id,
          entryId,
          advanceLineId: lineIds[1] as string,
          lineId: lineIds[0] as string,
          amountMinor: 300000n,
          bookMinor: book,
          parallelMinor: 1020000n,
        });
      };
    expect(await refusal(forge(books, lines, covering(9000n)))).toMatch(/do not equal it/);
    await forge(books, lines, covering(9091n));
  });

  it('refuses an application, a document or a number added outside the posting', async () => {
    const { books, posted } = await forgeable();
    const rows = await inCompany(books.id, (tx) =>
      tx.select().from(journalLines).where(eq(journalLines.entryId, posted.entry.id)),
    );
    const line = (code: string) =>
      rows.find((row) => row.accountId === account(books, code))?.id as string;
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          tx.insert(advanceApplications).values({
            companyId: books.id,
            entryId: posted.entry.id,
            advanceLineId: line('114002'),
            lineId: line('211001'),
            amountMinor: -1n,
            bookMinor: 0n,
            parallelMinor: 0n,
          }),
        ),
      ),
    ).toMatch(/entry being posted/);
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          tx.insert(projectDocuments).values({
            companyId: books.id,
            kind: 'wage_sheet',
            fiscalYear: 2026,
            number: 1,
            documentDate: '2026-12-03',
            entryId: uuidv7(),
            draftId: posted.draftId,
            contractValueId: books.project,
            currency: 'USD',
            periodFrom: '2026-12-01',
            periodTo: '2026-12-03',
            totalMinor: 1n,
          }),
        ),
      ),
    ).toMatch(/as prepared/);
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          tx
            .insert(projectDocumentSequences)
            .values({ companyId: books.id, kind: 'wage_sheet', fiscalYear: 2026, lastNumber: 1 }),
        ),
      ),
    ).toMatch(/was given but no document took it/);
  });

  it('keeps the chain intact over a purchase applying an advance and its reversal', async () => {
    const { books, posted } = await forgeable();
    await reverse(books, posted.entry.id, '2026-12-10');
    const links = await inCompany(books.id, readChain);
    expect(firstChainBreak(links)).toBeNull();
    expect(links.some((link) => link.entry.lines.some((line) => line.covered != null))).toBe(true);
    expect(
      links.some((link) =>
        link.entry.lines.some((line) => line.quantity?.quantity.startsWith('-') === true),
      ),
    ).toBe(true);
  });
});
