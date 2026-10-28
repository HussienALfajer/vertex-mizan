import {
  type AuditPage,
  type Company,
  type Invitation,
  type Me,
  type Member,
  PERMISSIONS,
} from '@vertex-mizan/contracts';
import { signedIn } from './test';

/** Synthetic answers of the company API (S01) shared by the screen and flow specs. */

export const companyId = signedIn.memberships[0]?.company.id ?? '';
export const secondCompanyId = '01900000-0000-7000-8000-000000000013';

/** The owner of the test company, with every permission there, and a member of a second one. */
export const owner: Me = {
  ...signedIn,
  memberships: [
    ...signedIn.memberships,
    {
      membershipId: '01900000-0000-7000-8000-000000000012',
      company: { id: secondCompanyId, name: 'شركة ثانية', nameLatin: null, archived: false },
      role: 'auditor',
      canClosePeriods: false,
    },
  ],
  permissions: [...PERMISSIONS],
};

/** The same person after switching to the second company, as its auditor. */
export const inSecondCompany: Me = {
  ...owner,
  activeCompanyId: secondCompanyId,
  permissions: ['company.read', 'members.read', 'audit.read'],
};

/** A viewer: reads the company, sees no members or audit pages. */
export const viewer: Me = {
  ...signedIn,
  memberships: signedIn.memberships.map((membership) => ({
    ...membership,
    role: 'viewer',
    canClosePeriods: false,
  })),
  permissions: ['company.read'],
};

/** No active company: the person chooses on `/companies`. */
export const noCompany: Me = { ...owner, activeCompanyId: null, permissions: [] };

export const company: Company = {
  id: companyId,
  name: 'شركة اختبار',
  nameLatin: 'Test Company',
  ledgers: {
    book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
    parallel: {
      currency: 'USD',
      ratePolicy: { rateType: 'market', acceptsTransactionRate: true },
    },
  },
  fiscalYearStartMonth: 1,
  policyNote: 'العملة الوظيفية هي الليرة السورية: عملة البيئة الاقتصادية الرئيسية للشركة (مثال).',
  booksStarted: false,
  manualEntryApproval: false,
  archived: null,
  createdAt: '2026-10-20T08:00:00.000Z',
};

export const archivedCompany: Company = {
  ...company,
  archived: { at: '2026-10-26T10:00:00.000Z', reason: 'توقف النشاط (مثال)' },
};

export const archivedOwner: Me = {
  ...owner,
  memberships: owner.memberships.map((membership) =>
    membership.company.id === companyId
      ? { ...membership, company: { ...membership.company, archived: true } }
      : membership,
  ),
};

export const members: Member[] = [
  {
    id: owner.memberships[0]?.membershipId ?? '',
    userId: owner.person.id,
    name: owner.person.name,
    email: owner.person.email,
    role: 'owner',
    canClosePeriods: false,
    twoFactorEnabled: true,
    joinedAt: '2026-10-20T08:00:00.000Z',
  },
  {
    id: '01900000-0000-7000-8000-000000000022',
    userId: '01900000-0000-7000-8000-000000000021',
    name: 'محاسب تجريبي',
    email: 'accountant@example.test',
    role: 'accountant',
    canClosePeriods: true,
    twoFactorEnabled: true,
    joinedAt: '2026-10-22T09:30:00.000Z',
  },
  {
    id: '01900000-0000-7000-8000-000000000032',
    userId: '01900000-0000-7000-8000-000000000031',
    name: 'مدقق تجريبي',
    email: 'auditor@example.test',
    role: 'auditor',
    canClosePeriods: false,
    twoFactorEnabled: false,
    joinedAt: '2026-10-24T11:00:00.000Z',
  },
];

export const invitations: Invitation[] = [
  {
    id: '01900000-0000-7000-8000-000000000041',
    email: 'viewer@example.test',
    role: 'viewer',
    canClosePeriods: false,
    invitedBy: { id: owner.person.id, name: owner.person.name },
    expiresAt: '2026-11-03T08:00:00.000Z',
    createdAt: '2026-10-27T08:00:00.000Z',
  },
];

const entry = {
  actorKind: 'person',
  actorUserId: owner.person.id,
  actorName: owner.person.name,
  ipAddress: '203.0.113.24',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0',
  requestId: 'req-0001',
} as const;

export const auditPage: AuditPage = {
  entries: [
    {
      ...entry,
      id: '01900000-0000-7000-8000-000000000051',
      createdAt: '2026-10-27T09:00:00.000Z',
      action: 'company.ledgers_updated',
      entityType: 'company_settings',
      entityId: '01900000-0000-7000-8000-000000000052',
      reason: null,
      before: { parallelRateType: 'market', parallelAcceptsTransactionRate: true },
      after: { parallelRateType: 'bulletin', parallelAcceptsTransactionRate: false },
    },
    {
      ...entry,
      id: '01900000-0000-7000-8000-000000000053',
      createdAt: '2026-10-26T15:20:00.000Z',
      action: 'membership.updated',
      entityType: 'membership',
      entityId: members[1]?.id ?? null,
      reason: null,
      before: { role: 'viewer', canClosePeriods: false },
      after: { role: 'accountant', canClosePeriods: true },
    },
    {
      ...entry,
      id: '01900000-0000-7000-8000-000000000054',
      createdAt: '2026-10-26T12:00:00.000Z',
      action: 'membership.removed',
      entityType: 'membership',
      entityId: '01900000-0000-7000-8000-000000000055',
      reason: 'انتهى التعاقد (مثال)',
      before: { archivedReason: null },
      after: { archivedReason: 'انتهى التعاقد (مثال)' },
    },
    {
      ...entry,
      id: '01900000-0000-7000-8000-000000000056',
      createdAt: '2026-10-26T08:00:00.000Z',
      action: 'session.company_entered',
      entityType: 'session',
      entityId: null,
      reason: null,
      before: null,
      after: { activeCompanyId: companyId },
    },
  ],
  nextCursor: null,
};

/** Every read of a company page, answered. */
export const companyReads = {
  'GET /api/company': { status: 200, json: company },
  'GET /api/members': { status: 200, json: members },
  'GET /api/invitations': { status: 200, json: invitations },
  'GET /api/audit': { status: 200, json: auditPage },
};
