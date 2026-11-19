import type {
  Dashboard,
  DayRates,
  Material,
  MaterialCosts,
  Me,
  Movement,
  Party,
  Permission,
  Project,
} from '@vertex-mizan/contracts';
import { signedIn } from './test';

/** Synthetic S13 data for the screens' mocks: no real company, client or figure. */

const permissions: Permission[] = [
  'company.read',
  'company.settings',
  'reports.read',
  'dimensions.read',
  'dimensions.manage',
  'rates.read',
  'rates.manage',
  'entries.read',
  'drafts.manage',
  'entries.post',
];

/** The company's one person, its owner (S13 "Access"). */
export const owner: Me = { ...signedIn, permissions };

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const ids = {
  project: id(101),
  otherProject: id(102),
  client: id(201),
  supplier: id(301),
  material: id(401),
  movement: id(501),
  entry: id(601),
};

export const project: Project = {
  id: ids.project,
  name: 'مشروع البناء التجريبي',
  client: { id: ids.client, name: 'عميل تجريبي' },
  startDate: '2026-10-01',
  state: 'active',
  contractValue: { amountMinor: '5000000', currency: 'USD' },
  figures: {
    bookCurrency: 'USD',
    revenueMinor: '1500000',
    costsMinor: '620050',
    profitMinor: '879950',
    receivedMinor: '1000000',
    expensesMinor: '420050',
    wagesMinor: '200000',
    netCashMinor: '379950',
    owedByUs: [{ currency: 'USD', amountMinor: '150000', bookMinor: '150000' }],
    owedToUs: [
      { currency: 'USD', amountMinor: '400000', bookMinor: '400000' },
      { currency: 'SYP', amountMinor: '1100000', bookMinor: '10000' },
    ],
    movementCount: 3,
  },
};

export const otherProject: Project = {
  ...project,
  id: ids.otherProject,
  name: 'مشروع الترميم التجريبي',
  state: 'finished',
  contractValue: null,
  figures: {
    ...project.figures,
    profitMinor: '-25000',
    netCashMinor: '-25000',
    owedByUs: [],
    owedToUs: [],
    movementCount: 1,
  },
};

export const expense: Movement = {
  id: ids.movement,
  kind: 'expense',
  fiscalYear: 2026,
  number: 7,
  date: '2026-11-10',
  project: { id: ids.project, name: project.name },
  party: null,
  currency: 'USD',
  amountMinor: '420050',
  bookMinor: '420050',
  description: 'إسمنت للأساسات',
  material: {
    id: ids.material,
    name: 'إسمنت',
    unit: 'كيس',
    quantity: '100.000',
    unitPrice: '42.0050',
  },
  entryId: ids.entry,
  cancellation: null,
  createdAt: '2026-11-10T08:00:00.000Z',
};

export const received: Movement = {
  ...expense,
  id: id(502),
  kind: 'received',
  number: 6,
  date: '2026-11-05',
  party: { id: ids.client, name: project.client.name },
  currency: 'SYP',
  amountMinor: '11000000',
  bookMinor: '100000',
  description: 'دفعة من العميل',
  material: null,
  entryId: id(602),
  cancellation: { reason: 'سُجلت مرتين', on: '2026-11-06', reversalEntryId: id(603) },
};

export const supplier: Party = {
  id: ids.supplier,
  type: 'supplier',
  name: 'مورد تجريبي',
  projectCount: 1,
  owedToUs: [],
  owedByUs: [{ currency: 'USD', amountMinor: '150000', bookMinor: '150000' }],
};

export const client: Party = {
  id: ids.client,
  type: 'client',
  name: project.client.name,
  projectCount: 2,
  owedToUs: project.figures.owedToUs,
  owedByUs: [],
};

export const material: Material = {
  id: ids.material,
  code: 'M-001',
  name: 'إسمنت',
  nameLatin: null,
  unit: 'كيس',
  used: true,
  archivedAt: null,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

export const materialCosts: MaterialCosts = {
  bookCurrency: 'USD',
  materials: [
    {
      material: { id: ids.material, name: 'إسمنت', unit: 'كيس' },
      quantity: '100.000',
      bookMinor: '420050',
      byCurrency: [{ currency: 'USD', amountMinor: '420050', bookMinor: '420050' }],
      byProject: [
        {
          project: { id: ids.project, name: project.name },
          quantity: '100.000',
          bookMinor: '420050',
        },
      ],
    },
  ],
  totalBookMinor: '420050',
};

export const ratesMissing: DayRates = {
  date: '2026-11-19',
  missing: true,
  rates: [
    { base: 'USD', quote: 'SYP', rate: '110.0000', effectiveOn: '2026-11-18' },
    { base: 'USD', quote: 'TRY', rate: null, effectiveOn: null },
  ],
};

export const ratesToday: DayRates = {
  date: '2026-11-19',
  missing: false,
  rates: [
    { base: 'USD', quote: 'SYP', rate: '110.0000', effectiveOn: '2026-11-19' },
    { base: 'USD', quote: 'TRY', rate: '34.2500', effectiveOn: '2026-11-19' },
  ],
};

export const dashboard: Dashboard = {
  bookCurrency: 'USD',
  projects: { active: 1, finished: 1 },
  figures: { ...project.figures, movementCount: 4 },
  exchangeDifferencesMinor: '-1250',
  boxes: [
    { currency: 'USD', amountMinor: '354950', bookMinor: '354950' },
    { currency: 'SYP', amountMinor: '2200000', bookMinor: '20000' },
  ],
  rates: ratesToday,
  topProjects: [
    {
      project: { id: ids.project, name: project.name },
      profitMinor: '879950',
      netCashMinor: '379950',
    },
    {
      project: { id: ids.otherProject, name: otherProject.name },
      profitMinor: '-25000',
      netCashMinor: '-25000',
    },
  ],
  latestMovements: [expense, received],
  topMaterials: [
    {
      material: { id: ids.material, name: 'إسمنت' },
      unit: 'كيس',
      quantity: '100.000',
      bookMinor: '420050',
    },
  ],
};

/** A movement page, newest first. */
export const movementPage = { movements: [expense, received], nextCursor: null };
