import type {
  Account,
  DimensionValue,
  Draft,
  DraftInput,
  EntryLine,
  EntryPreview,
  Material,
  MaterialQuantities,
  PostedDraft,
  ProjectDocumentSummary,
  ProjectList,
  ProjectReport,
  ProjectTermsView,
  ReportHeader,
  Subcontract,
} from '@vertex-mizan/contracts';
import { chartOf } from './chart-mocks';
import { manualClient, typeOf, valuesPage } from './dimension-mocks';
import { draftOf, entryReads, purchase } from './entry-mocks';

/*
 * Synthetic answers of the project screens (S12) in the company's shape of the other specs (SYP
 * book, USD parallel), on the `contracting@1` chart: project P1 of the manual client with USD terms
 * (100,000.00, retention 10%, recovery 20%) and a budget on materials and wages; a subcontractor
 * and two workers; three materials, one archived; a posted purchase, a wage sheet, a billing and a
 * cancelled billing; the projects list, P1's report and the material quantities.
 */

const created = '2026-10-21T08:00:00.000Z';
const valueId = (n: number) => `01900000-0000-7000-8004-${String(n + 40).padStart(12, '0')}`;
const materialId = (n: number) => `01900000-0000-7000-8010-${String(n).padStart(12, '0')}`;
const documentId = (n: number) => `01900000-0000-7000-8011-${String(n).padStart(12, '0')}`;
const projectEntryId = (n: number) => `01900000-0000-7000-8009-${String(n + 60).padStart(12, '0')}`;

/** The `contracting@1` chart: `511001` requires a material. */
export const contractingChart: Account[] = chartOf('contracting');

export const accountOfContracting = (code: string): Account => {
  const found = contractingChart.find((account) => account.code === code);
  if (!found) throw new Error(`No account ${code} in the contracting chart`);
  return found;
};

const value = (
  n: number,
  fields: Partial<DimensionValue> & Pick<DimensionValue, 'typeId' | 'name'>,
): DimensionValue => ({
  id: valueId(n),
  code: null,
  nameLatin: null,
  contractKind: null,
  parentValueId: null,
  parentName: null,
  externalSource: null,
  externalId: null,
  archivedAt: null,
  createdAt: created,
  ...fields,
});

export const project = value(1, {
  typeId: typeOf('contract').id,
  code: 'P1',
  name: 'مشروع البناء التجريبي',
  contractKind: 'project',
  parentValueId: manualClient.id,
  parentName: manualClient.name,
});
export const subcontractor = value(2, {
  typeId: typeOf('supplier').id,
  code: 'S1',
  name: 'مقاول باطن تجريبي',
});
export const supplier = value(3, {
  typeId: typeOf('supplier').id,
  code: 'S2',
  name: 'مورد مواد تجريبي',
});
export const workerOne = value(4, {
  typeId: typeOf('worker').id,
  code: 'W1',
  name: 'عامل تجريبي أول',
});
export const workerTwo = value(5, { typeId: typeOf('worker').id, code: 'W2', name: 'حرفي تجريبي' });

const projectValues = [project, subcontractor, supplier, workerOne, workerTwo];

/** `GET /api/dimension-values`: the shared values and the project's. */
function projectValuesPage(url: URL) {
  const shared = valuesPage(url);
  const typeId = url.searchParams.get('typeId');
  return {
    values: [...shared.values, ...projectValues.filter((candidate) => candidate.typeId === typeId)],
    nextCursor: null,
  };
}

const material = (
  n: number,
  fields: Partial<Material> & Pick<Material, 'code' | 'name' | 'unit'>,
): Material => ({
  id: materialId(n),
  nameLatin: null,
  used: false,
  archivedAt: null,
  createdAt: created,
  updatedAt: created,
  ...fields,
});

export const cement = material(1, {
  code: 'M-001',
  name: 'أسمنت بورتلاندي',
  unit: 'طن',
  used: true,
});
export const steel = material(2, { code: 'M-002', name: 'حديد تسليح', unit: 'طن' });
export const sand = material(3, {
  code: 'M-003',
  name: 'رمل مؤرشف',
  unit: 'م³',
  archivedAt: '2026-10-30T08:00:00.000Z',
});
export const materials = [cement, steel, sand];

export const terms: ProjectTermsView = {
  contractValueId: project.id,
  code: 'P1',
  name: project.name,
  clientValueId: manualClient.id,
  terms: {
    currency: 'USD',
    contractValueMinor: '10000000',
    retentionBp: 1000,
    advanceRecoveryBp: 2000,
    budget: [
      { accountId: accountOfContracting('511001').id, amountMinor: '4000000' },
      { accountId: accountOfContracting('511002').id, amountMinor: '1500000' },
    ],
    currencyLocked: true,
    updatedAt: '2026-11-02T08:00:00.000Z',
  },
};

export const subcontract: Subcontract = {
  id: '01900000-0000-7000-8012-000000000001',
  contractValueId: project.id,
  supplierValueId: subcontractor.id,
  currency: 'USD',
  valueMinor: '2000000',
  retentionBp: 500,
  advanceRecoveryBp: 1000,
  currencyLocked: false,
  archivedAt: null,
  createdAt: created,
  updatedAt: created,
};

const entryRef = (n: number) => ({ id: projectEntryId(n), fiscalYear: 2026, number: n });

const summary = (
  n: number,
  fields: Partial<ProjectDocumentSummary> & Pick<ProjectDocumentSummary, 'kind' | 'totalMinor'>,
): ProjectDocumentSummary => ({
  id: documentId(n),
  fiscalYear: 2026,
  number: 1,
  projectSequence: null,
  documentDate: '2026-11-03',
  contractValueId: project.id,
  counterpartyValueId: null,
  side: null,
  currency: 'USD',
  supplierReference: null,
  entry: entryRef(n),
  cancelledBy: null,
  ...fields,
});

export const purchaseDocument = summary(1, {
  kind: 'purchase',
  totalMinor: '255809',
  counterpartyValueId: supplier.id,
  supplierReference: 'INV-77',
});
export const wageSheet = summary(2, {
  kind: 'wage_sheet',
  totalMinor: '55000',
  documentDate: '2026-11-07',
});
export const billing = summary(3, {
  kind: 'progress_billing',
  totalMinor: '3000000',
  projectSequence: 1,
  documentDate: '2026-11-08',
  counterpartyValueId: manualClient.id,
});
export const cancelledBilling = summary(4, {
  kind: 'progress_billing',
  number: 2,
  totalMinor: '500000',
  projectSequence: 2,
  documentDate: '2026-11-08',
  counterpartyValueId: manualClient.id,
  cancelledBy: entryRef(9),
});
export const documents = [cancelledBilling, billing, wageSheet, purchaseDocument];

/** P1's purchase as posted, the entry the register's cancellation reverses. */
export const purchaseEntry = {
  ...purchase,
  id: purchaseDocument.entry.id,
  number: 1,
  projectDocument: {
    id: purchaseDocument.id,
    kind: 'purchase' as const,
    fiscalYear: 2026,
    number: 1,
  },
};

const header: ReportHeader = {
  ledger: 'book',
  currency: 'SYP',
  producedAt: '2026-11-09T06:00:00.000Z',
  latestEntry: { fiscalYear: 2026, number: 45 },
  booksStart: null,
  current: { from: '2026-01-01', to: '2026-11-09', marks: ['period_open'], hasLines: true },
  compare: null,
};

const reportTerms = {
  currency: 'USD' as const,
  contractValueMinor: '10000000',
  retentionBp: 1000,
  advanceRecoveryBp: 2000,
};

export const projectList: ProjectList = {
  header: { ...header, current: { ...header.current, from: null } },
  projects: [
    {
      project: {
        id: project.id,
        typeCode: 'contract',
        code: 'P1',
        name: project.name,
        archived: false,
      },
      client: {
        id: manualClient.id,
        typeCode: 'client',
        code: manualClient.code,
        name: manualClient.name,
        archived: false,
      },
      terms: reportTerms,
      cumulativeMinor: '3000000',
      billed: '30.0',
      revenue: '357000000',
      directCosts: '37645000',
      contribution: '319355000',
      margin: '89.5',
      retentionReceivable: '36000000',
      clientAdvance: '168000000',
      budgetMinor: '5500000',
    },
  ],
};

const reportValue = (candidate: DimensionValue) => ({
  id: candidate.id,
  typeCode: candidate.typeId === typeOf('worker').id ? 'worker' : 'supplier',
  code: candidate.code,
  name: candidate.name,
  archived: false,
});

const reportAccount = (code: string) => {
  const account = accountOfContracting(code);
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    nameLatin: account.nameLatin,
    level: account.level,
    postable: true,
    statementLine: account.statementLine,
    archived: false,
    blocked: false,
  };
};

export const projectReport: ProjectReport = {
  header,
  project: projectList.projects[0]?.project as ProjectReport['project'],
  client: projectList.projects[0]?.client ?? null,
  terms: reportTerms,
  summary: {
    cumulativeMinor: '3000000',
    billed: '30.0',
    revenue: '357000000',
    directCosts: '37645000',
    contribution: '319355000',
    margin: '89.5',
    retentionReceivable: '36000000',
    clientAdvance: '168000000',
    subcontractRetention: '0',
    subcontractAdvance: '0',
  },
  costs: {
    rows: [
      {
        account: reportAccount('511001'),
        inRange: '30697000',
        toDate: '30697000',
        budgetMinor: '4000000',
        variance: null,
        used: null,
      },
      {
        account: reportAccount('511002'),
        inRange: '6948000',
        toDate: '6948000',
        budgetMinor: '1500000',
        variance: null,
        used: null,
      },
    ],
    totals: {
      inRange: '37645000',
      toDate: '37645000',
      budgetMinor: '5500000',
      variance: null,
      used: null,
    },
  },
  materials: [
    {
      material: {
        id: cement.id,
        code: cement.code,
        name: cement.name,
        unit: 'طن',
        archived: false,
      },
      currency: 'USD',
      quantity: '12.500',
      amountMinor: '115809',
      ledgerAmount: '13897080',
      average: '92.6472',
    },
    {
      material: { id: steel.id, code: steel.code, name: steel.name, unit: 'طن', archived: false },
      currency: 'USD',
      quantity: '2.000',
      amountMinor: '140000',
      ledgerAmount: '16800000',
      average: '700.0000',
    },
  ],
  wages: [
    {
      worker: reportValue(workerOne),
      days: '6.000',
      lumpSum: '0',
      amount: '1800000',
      balance: '0',
    },
    {
      worker: reportValue(workerTwo),
      days: '0.000',
      lumpSum: '4800000',
      amount: '4800000',
      balance: '4800000',
    },
  ],
  subcontracts: [
    {
      subcontractId: subcontract.id,
      supplier: reportValue(subcontractor),
      currency: 'USD',
      valueMinor: '2000000',
      cumulativeMinor: '0',
      retention: '0',
      advance: '0',
      paid: '0',
    },
  ],
  billings: [
    {
      documentId: billing.id,
      entryId: billing.entry.id,
      projectSequence: 1,
      fiscalYear: 2026,
      number: 1,
      documentDate: '2026-11-08',
      cumulativeMinor: '3000000',
      previousMinor: '0',
      periodMinor: '3000000',
      retentionMinor: '300000',
      advanceMinor: '600000',
      netMinor: '2100000',
      state: 'posted',
      outstandingMinor: '2100000',
    },
  ],
};

export const materialQuantities: MaterialQuantities = {
  header: { ...header, current: { ...header.current, from: '2026-11-01' } },
  rows: [
    {
      project: projectList.projects[0]?.project ?? null,
      material: projectReport.materials[0]
        ?.material as ProjectReport['materials'][number]['material'],
      currency: 'USD',
      quantityIn: '14.500',
      quantityOut: '-2.000',
      quantity: '12.500',
      amountMinor: '115809',
      average: '92.6472',
      ledgerAmount: '13897080',
    },
  ],
  ledgerTotal: '13897080',
};

/** A project document draft as the API returns it, from typed input. */
export function documentDraftOf(input: DraftInput, id: string): Draft {
  const header = input.projectDocument;
  const draft = draftOf(input, { id });
  return {
    ...draft,
    lines: draft.lines.map((line, index) => {
      const typed = input.lines[index];
      return {
        ...line,
        materialId: typed?.materialId ?? null,
        unit: typed?.unit ?? null,
        quantity: typed?.quantity ?? null,
        unitPrice: typed?.unitPrice ?? null,
        advanceMinor: typed?.advanceMinor ?? null,
      };
    }),
    projectDocument: header
      ? {
          kind: header.kind,
          contractValueId: header.contractValueId,
          counterpartyValueId: header.counterpartyValueId ?? null,
          currency: header.currency ?? null,
          side: header.side ?? null,
          periodFrom: header.periodFrom ?? null,
          periodTo: header.periodTo ?? null,
          cumulativeMinor: header.cumulativeMinor ?? null,
          retentionMinor: header.retentionMinor ?? null,
          advanceMinor: header.advanceMinor ?? null,
          supplierReference: header.supplierReference ?? null,
          retentionItems: header.retentionItems ?? null,
        }
      : null,
  };
}

const line = (
  lineNo: number,
  code: string,
  fields: Partial<EntryLine> & Pick<EntryLine, 'amountMinor' | 'bookMinor' | 'parallelMinor'>,
): EntryLine => {
  const account = accountOfContracting(code);
  return {
    lineNo,
    accountId: account.id,
    accountCode: account.code,
    accountName: account.name,
    dimensionValueIds: [project.id],
    kind: 'measured',
    ledger: null,
    currency: 'USD',
    memo: null,
    conversions: [],
    item: null,
    quantity: null,
    covered: null,
    ...fields,
  };
};

/** The preview of a billing: 30,000.00 certified, 3,000.00 retained, 6,000.00 recovered. */
export const billingPreview: EntryPreview = {
  entryDate: '2026-11-08',
  bookCurrency: 'SYP',
  parallelCurrency: 'USD',
  lines: [
    line(1, '112001', { amountMinor: '2100000', bookMinor: '252000000', parallelMinor: '2100000' }),
    line(2, '113002', { amountMinor: '300000', bookMinor: '36000000', parallelMinor: '300000' }),
    line(3, '212002', { amountMinor: '600000', bookMinor: '69000000', parallelMinor: '600000' }),
    line(4, '411001', {
      amountMinor: '-3000000',
      bookMinor: '-357000000',
      parallelMinor: '-3000000',
      covered: { amountMinor: '600000', bookMinor: '69000000', parallelMinor: '600000' },
    }),
  ],
  items: [],
  voucher: null,
  projectDocument: {
    kind: 'progress_billing',
    currency: 'USD',
    totalMinor: '3000000',
    previousMinor: '0',
    periodValueMinor: '3000000',
    retentionMinor: '300000',
    advanceMinor: '600000',
    netMinor: '2100000',
    warnings: [],
  },
  refusals: [],
};

/** The preview of a purchase with quantities, warned of a supplier's reference seen before. */
export const purchaseDocumentPreview: EntryPreview = {
  ...billingPreview,
  entryDate: '2026-11-03',
  lines: [
    line(1, '511001', {
      amountMinor: '115809',
      bookMinor: '13897080',
      parallelMinor: '115809',
      quantity: { materialId: cement.id, unit: 'طن', quantity: '12.500', unitPrice: '92.6472' },
    }),
    line(2, '211001', {
      amountMinor: '-115809',
      bookMinor: '-13897080',
      parallelMinor: '-115809',
      dimensionValueIds: [supplier.id, project.id],
    }),
  ],
  projectDocument: {
    kind: 'purchase',
    currency: 'USD',
    totalMinor: '115809',
    previousMinor: null,
    periodValueMinor: null,
    retentionMinor: null,
    advanceMinor: null,
    netMinor: null,
    warnings: ['duplicate_supplier_reference'],
  },
};

/** A posted document draft's answer: its entry and its number. */
export function postedDocument(input: DraftInput, id: string, number: number): PostedDraft {
  const kind = input.projectDocument?.kind ?? 'purchase';
  return {
    draft: { ...documentDraftOf(input, id), state: 'posted' },
    entry: {
      ...purchase,
      id: projectEntryId(30),
      number: 30,
      projectDocument: { id: documentId(30), kind, fiscalYear: 2026, number },
    },
    voucher: null,
    projectDocument: { id: documentId(30), kind, fiscalYear: 2026, number },
  };
}

/** Every read of the project screens, answered. */
export const projectReads = {
  ...entryReads,
  'GET /api/accounts': { status: 200, json: contractingChart },
  'GET /api/dimension-values': (request: { url(): string }) => ({
    status: 200,
    json: projectValuesPage(new URL(request.url())),
  }),
  'GET /api/materials': (request: { url(): string }) => {
    const params = new URL(request.url()).searchParams;
    const q = params.get('q');
    const listed = materials.filter(
      (candidate) =>
        (params.get('archived') === 'true' || candidate.archivedAt === null) &&
        (!q || candidate.name.includes(q) || candidate.code.includes(q)),
    );
    return { status: 200, json: { materials: listed, nextCursor: null } };
  },
  [`GET /api/projects/${project.id}/terms`]: { status: 200, json: terms },
  'GET /api/subcontracts': { status: 200, json: { subcontracts: [subcontract] } },
  'GET /api/project-documents': (request: { url(): string }) => {
    const params = new URL(request.url()).searchParams;
    const listed = documents.filter(
      (candidate) =>
        (!params.get('kind') || candidate.kind === params.get('kind')) &&
        (!params.get('state') ||
          (params.get('state') === 'cancelled') === (candidate.cancelledBy !== null)),
    );
    return { status: 200, json: { documents: listed, nextCursor: null } };
  },
  'GET /api/projects': { status: 200, json: projectList },
  [`GET /api/projects/${project.id}/report`]: { status: 200, json: projectReport },
  'GET /api/reports/material-quantities': { status: 200, json: materialQuantities },
};
