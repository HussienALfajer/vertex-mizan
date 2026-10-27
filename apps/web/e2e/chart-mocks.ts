import {
  ACCOUNT_ROLES,
  type Account,
  type AccountRoleAssignment,
  accountClassOfCode,
  accountCodeLevel,
  BUILTIN_DIMENSION_TYPES,
  CHART_TEMPLATES,
  type ChartTemplateSummary,
  type DimensionType,
  defaultNormalBalance,
  parentAccountCode,
  ROOT_ACCOUNTS,
} from '@vertex-mizan/contracts';
import { companyReads, owner } from './company-mocks';

/** Synthetic answers of the chart API (S02) shared by the screen and flow specs. */

/** A synthetic UUIDv7-shaped id per account code, stable across specs. */
const idOf = (code: string) => `01900000-0000-7000-8002-${code.padStart(12, '0')}`;

export const dimensionTypes: DimensionType[] = BUILTIN_DIMENSION_TYPES.map((type, index) => ({
  id: `01900000-0000-7000-8003-00000000000${index + 1}`,
  code: type.code,
  builtin: true,
  parentTypeId: null,
  name: type.name,
  nameLatin: type.nameLatin,
  position: type.position,
  archivedAt: null,
  createdAt: '2026-10-20T08:00:00.000Z',
}));
const typeId = (code: string) => dimensionTypes.find((type) => type.code === code)?.id ?? '';

const created = '2026-10-20T08:00:00.000Z';

/** The five roots, as every company has them. */
export const roots: Account[] = ROOT_ACCOUNTS.map((root) => ({
  id: idOf(root.code),
  code: root.code,
  level: 1,
  parentId: null,
  kind: 'header',
  class: root.class,
  name: root.name,
  nameLatin: root.nameLatin,
  normalBalance: defaultNormalBalance(root.class),
  statementLine: null,
  currency: null,
  isControl: false,
  isMonetary: false,
  requiredDimensionTypeIds: [],
  roles: [],
  blocked: null,
  archived: null,
  firstPostedAt: null,
  createdAt: created,
}));

const template = CHART_TEMPLATES.find((candidate) => candidate.id === 'service-agency');

/** The roots with the service-agency template applied, as `GET /api/accounts` answers. */
export const chart: Account[] = [
  ...roots,
  // The template lists the roots too; the company has them already.
  ...(template?.accounts ?? [])
    .filter((account) => account.code.length > 1)
    .map(
      (account): Account => ({
        id: idOf(account.code),
        code: account.code,
        level: accountCodeLevel(account.code) ?? 1,
        parentId: idOf(parentAccountCode(account.code) ?? ''),
        kind: account.kind,
        class: accountClassOfCode(account.code),
        name: account.name,
        nameLatin: account.nameLatin,
        normalBalance: account.normalBalance,
        statementLine: account.statementLine,
        currency: account.currency,
        isControl: account.isControl,
        isMonetary: account.isMonetary,
        requiredDimensionTypeIds: account.requiredDimensions.map(typeId),
        roles: account.role ? [account.role] : [],
        blocked: null,
        archived: null,
        firstPostedAt: null,
        createdAt: created,
      }),
    ),
];

export const accountOf = (code: string): Account => {
  const found = chart.find((account) => account.code === code);
  if (!found) throw new Error(`No account ${code} in the mock chart`);
  return found;
};

/** One account used by a posting already (S03): its locked fields stay. */
export const usedChart: Account[] = chart.map((account) =>
  account.code === '111001' ? { ...account, firstPostedAt: '2026-10-25T09:00:00.000Z' } : account,
);

export const roles: AccountRoleAssignment[] = ACCOUNT_ROLES.map((role) => ({
  role,
  accountId: chart.find((account) => account.roles.includes(role))?.id ?? null,
}));

export const templates: ChartTemplateSummary[] = CHART_TEMPLATES.map((candidate) => ({
  id: candidate.id,
  version: candidate.version,
  name: candidate.name,
  nameLatin: candidate.nameLatin,
  accountCount: candidate.accounts.length,
}));

/** Every read of the chart pages, answered (with the S01 company reads). */
export const chartReads = {
  ...companyReads,
  'GET /api/accounts': { status: 200, json: chart },
  'GET /api/account-roles': { status: 200, json: roles },
  'GET /api/chart/templates': { status: 200, json: templates },
  'GET /api/dimension-types': { status: 200, json: dimensionTypes },
};

export { owner };
