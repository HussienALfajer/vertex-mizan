import {
  type CompanyExport,
  type IntegrityReport,
  type Me,
  rolePermissions,
} from '@vertex-mizan/contracts';
import { accountOf } from './chart-mocks';
import { companyReads, owner } from './company-mocks';
import { ownerRef, purchase } from './entry-mocks';

/** Synthetic answers of the integrity check and the full export (S03 rules 19, 21). */

const hash = (digit: string) => digit.repeat(64);

/** The test company's head after its two entries: the purchase and its reversal. */
export const headHash = hash('b');

/** A clean check: two entries, every stored anchor verified. */
export const cleanReport: IntegrityReport = {
  checkedAt: '2026-11-10T07:30:00.000Z',
  ok: true,
  entryCount: 2,
  lineCount: 7,
  firstBreak: null,
  head: { entryCount: 2, hash: headHash, matchesChain: true },
  numbering: [],
  unbalanced: [],
  periodBalances: [],
  anchors: [
    { anchoredOn: '2026-11-08', entryCount: 1, headHash: hash('a'), result: 'verified' },
    { anchoredOn: '2026-11-09', entryCount: 2, headHash, result: 'verified' },
  ],
  pasted: null,
};

/** The anchor of 2026-11-09 as the daily email lists it (`ar.email.dailyAnchor.anchor`). */
export const emailedAnchor = `شركة تجريبية\nالتاريخ: 2026-11-09\nعدد القيود: 2\nالبصمة: ${headHash}`;

/** The same check with the emailed anchor pasted: verified, and the same as the stored one. */
export const verifiedReport: IntegrityReport = {
  ...cleanReport,
  pasted: {
    anchor: { date: '2026-11-09', count: 2, hash: headHash },
    result: 'verified',
    stored: 'same',
  },
};

/** Books someone altered under the guards: every kind of problem the report names. */
export const brokenReport: IntegrityReport = {
  ...cleanReport,
  ok: false,
  firstBreak: { sequence: 1, entryId: purchase.id, number: purchase, reason: 'hash' },
  head: { entryCount: 2, hash: headHash, matchesChain: false },
  numbering: [{ fiscalYear: 2026, number: 3, problem: 'missing' }],
  unbalanced: [
    {
      entryId: purchase.id,
      number: purchase,
      ledger: 'book',
      residualMinor: '-10000',
      incompleteLines: 0,
    },
  ],
  periodBalances: [
    {
      period: '2026-11',
      accountId: accountOf('111004').id,
      dimensionSetId: null,
      currency: 'USD',
      problem: 'different',
    },
  ],
  anchors: [
    { anchoredOn: '2026-11-08', entryCount: 1, headHash: hash('a'), result: 'mismatch' },
    { anchoredOn: '2026-11-09', entryCount: 2, headHash, result: 'verified' },
  ],
};

const exportId = (n: number) => `01900000-0000-7000-800b-${String(n).padStart(12, '0')}`;

/** A ready export, downloadable until the next day. */
export const readyExport: CompanyExport = {
  id: exportId(1),
  state: 'ready',
  requestedBy: ownerRef,
  sizeBytes: 524_288,
  sha256: hash('c'),
  expiresAt: '2026-11-11T07:00:00.000Z',
  createdAt: '2026-11-10T06:58:00.000Z',
  updatedAt: '2026-11-10T07:00:00.000Z',
};

/** Older exports: one that failed and one whose file was deleted. */
export const pastExports: CompanyExport[] = [
  {
    ...readyExport,
    id: exportId(2),
    state: 'failed',
    sizeBytes: null,
    sha256: null,
    expiresAt: null,
    createdAt: '2026-11-05T06:58:00.000Z',
    updatedAt: '2026-11-05T07:00:00.000Z',
  },
  {
    ...readyExport,
    id: exportId(3),
    state: 'expired',
    expiresAt: '2026-11-02T07:00:00.000Z',
    createdAt: '2026-11-01T06:58:00.000Z',
    updatedAt: '2026-11-02T07:00:00.000Z',
  },
];

/** A new request, waiting for the worker. */
export const queuedExport: CompanyExport = {
  ...readyExport,
  id: exportId(4),
  state: 'queued',
  sizeBytes: null,
  sha256: null,
  expiresAt: null,
  createdAt: '2026-11-10T07:30:00.000Z',
  updatedAt: '2026-11-10T07:30:00.000Z',
};

/** The reads of the integrity and export pages. */
export const trustReads = {
  ...companyReads,
  'GET /api/accounts': { status: 200, json: [accountOf('111004')] },
  'GET /api/company/exports': { status: 200, json: [readyExport, ...pastExports] },
};

/** The test company's auditor: runs the integrity check, never exports. */
export const auditor: Me = {
  ...owner,
  memberships: owner.memberships.map((membership, index) =>
    index === 0 ? { ...membership, role: 'auditor' } : membership,
  ),
  permissions: [...rolePermissions.auditor],
};
