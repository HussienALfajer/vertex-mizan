import {
  type Account,
  type AccountLevel,
  type AccountRole,
  accountClassOfCode,
  type ChartTemplateId,
  type CurrencyCode,
  chartTemplate,
} from '@vertex-mizan/contracts';
import {
  accountRequiredDimensions,
  accountRoles,
  chartAccounts,
  dimensionTypes,
  type Transaction,
} from '@vertex-mizan/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { AuditActor } from '../../core/audit/audit.js';
import { writeCompanyAudit } from '../../core/audit/audit.js';
import { CodedException } from '../../core/errors/coded-exception.js';

export type AccountRow = typeof chartAccounts.$inferSelect;

/** An account row with its active required dimension types and roles, as the API answers it. */
export function accountOf(
  row: AccountRow,
  requiredDimensionTypeIds: readonly string[],
  roles: readonly AccountRole[],
): Account {
  return {
    id: row.id,
    code: row.code,
    level: row.level,
    parentId: row.parentId,
    kind: row.kind as Account['kind'],
    class: row.class as Account['class'],
    name: row.name,
    nameLatin: row.nameLatin,
    normalBalance: row.normalBalance as Account['normalBalance'],
    statementLine: row.statementLine,
    currency: row.currency as CurrencyCode | null,
    isControl: row.isControl,
    isMonetary: row.isMonetary,
    requiredDimensionTypeIds: [...requiredDimensionTypeIds],
    roles: [...roles],
    blocked:
      row.blockedAt && row.blockedReason
        ? { at: row.blockedAt.toISOString(), reason: row.blockedReason }
        : null,
    archived:
      row.archivedAt && row.archivedReason
        ? { at: row.archivedAt.toISOString(), reason: row.archivedReason }
        : null,
    firstPostedAt: row.firstPostedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The level of a stored account. */
export function levelOf(row: AccountRow): AccountLevel {
  return row.level as AccountLevel;
}

/** Each account's active required dimension types and roles, in the company context of `tx`. */
async function linksOf(
  tx: Transaction,
  accountIds?: readonly string[],
): Promise<{ dimensions: Map<string, string[]>; roles: Map<string, AccountRole[]> }> {
  const only = (
    column: typeof accountRoles.accountId | typeof accountRequiredDimensions.accountId,
  ) => (accountIds === undefined ? undefined : inArray(column, [...accountIds]));
  const dimensionRows = await tx
    .select({
      accountId: accountRequiredDimensions.accountId,
      typeId: accountRequiredDimensions.dimensionTypeId,
    })
    .from(accountRequiredDimensions)
    .innerJoin(
      dimensionTypes,
      and(
        eq(dimensionTypes.companyId, accountRequiredDimensions.companyId),
        eq(dimensionTypes.id, accountRequiredDimensions.dimensionTypeId),
      ),
    )
    .where(
      and(isNull(accountRequiredDimensions.archivedAt), only(accountRequiredDimensions.accountId)),
    )
    .orderBy(asc(dimensionTypes.position), asc(dimensionTypes.id));
  const roleRows = await tx
    .select({ accountId: accountRoles.accountId, role: accountRoles.role })
    .from(accountRoles)
    .where(and(isNull(accountRoles.archivedAt), only(accountRoles.accountId)))
    .orderBy(asc(accountRoles.role));
  const dimensions = new Map<string, string[]>();
  for (const row of dimensionRows) {
    dimensions.set(row.accountId, [...(dimensions.get(row.accountId) ?? []), row.typeId]);
  }
  const roles = new Map<string, AccountRole[]>();
  for (const row of roleRows) {
    roles.set(row.accountId, [...(roles.get(row.accountId) ?? []), row.role]);
  }
  return { dimensions, roles };
}

/** The whole chart in code order, archived accounts only when asked (`GET /api/accounts`). */
export async function readChart(tx: Transaction, includeArchived: boolean): Promise<Account[]> {
  const rows = await tx
    .select()
    .from(chartAccounts)
    .where(includeArchived ? undefined : isNull(chartAccounts.archivedAt))
    .orderBy(asc(chartAccounts.code));
  const { dimensions, roles } = await linksOf(tx);
  return rows.map((row) => accountOf(row, dimensions.get(row.id) ?? [], roles.get(row.id) ?? []));
}

/** One account of the company's chart; another company's id answers like an unknown one. */
export async function readAccount(tx: Transaction, id: string): Promise<Account> {
  const [row] = await tx.select().from(chartAccounts).where(eq(chartAccounts.id, id));
  if (!row) throw new CodedException('NOT_FOUND', 'No such account');
  const { dimensions, roles } = await linksOf(tx, [id]);
  return accountOf(row, dimensions.get(id) ?? [], roles.get(id) ?? []);
}

/**
 * Applies a chart template over the five roots (S02 rule 1), in the caller's transaction and
 * company context, with one audit row: the accounts in code order (each parent first), their
 * required built-in dimensions and the six roles. Refused unless the chart holds the roots alone
 * (`CHART_NOT_EMPTY`); the roots are locked first, so two applications run one after the other and
 * an account added meanwhile (its trigger reads its parent `FOR SHARE`) waits for the answer.
 */
export async function applyChartTemplate(
  tx: Transaction,
  companyId: string,
  templateId: ChartTemplateId,
  actor: AuditActor,
): Promise<void> {
  const template = chartTemplate(templateId);
  const roots = await tx
    .select({ id: chartAccounts.id, code: chartAccounts.code })
    .from(chartAccounts)
    .where(eq(chartAccounts.level, 1))
    .for('update');
  const all = await tx.select({ id: chartAccounts.id }).from(chartAccounts);
  if (all.length !== roots.length) {
    throw new CodedException('CHART_NOT_EMPTY', 'The chart already has accounts');
  }
  const builtinTypes = await tx
    .select({ id: dimensionTypes.id, code: dimensionTypes.code })
    .from(dimensionTypes)
    .where(eq(dimensionTypes.builtin, true));
  const typeIds = new Map(builtinTypes.map((type) => [type.code, type.id]));
  const ids = new Map(roots.map((root) => [root.code, root.id]));
  const added = template.accounts.filter((account) => account.code.length > 1);
  const rows = added.map((account) => {
    const id = uuidv7();
    ids.set(account.code, id);
    const parentCode = account.code.slice(0, account.code.length === 6 ? 3 : -1);
    const parentId = ids.get(parentCode);
    if (parentId === undefined) throw new Error(`Template account ${account.code} has no parent`);
    return {
      id,
      companyId,
      code: account.code,
      level: account.code.length === 6 ? 4 : account.code.length,
      parentId,
      kind: account.kind,
      class: accountClassOfCode(account.code),
      name: account.name,
      nameLatin: account.nameLatin,
      normalBalance: account.normalBalance,
      statementLine: account.statementLine,
      currency: account.currency,
      isControl: account.isControl,
      isMonetary: account.isMonetary,
    };
  });
  // Parents come before their children, so one insert per level keeps the trigger's parent check.
  for (const level of [2, 3, 4]) {
    const ofLevel = rows.filter((row) => row.level === level);
    if (ofLevel.length > 0) await tx.insert(chartAccounts).values(ofLevel);
  }
  const required = added.flatMap((account) =>
    account.requiredDimensions.map((code) => {
      const dimensionTypeId = typeIds.get(code);
      if (dimensionTypeId === undefined) throw new Error(`No built-in dimension type ${code}`);
      return { companyId, accountId: ids.get(account.code) as string, dimensionTypeId };
    }),
  );
  if (required.length > 0) await tx.insert(accountRequiredDimensions).values(required);
  const roles = added.flatMap((account) =>
    account.role === null
      ? []
      : [{ companyId, role: account.role, accountId: ids.get(account.code) as string }],
  );
  if (roles.length > 0) await tx.insert(accountRoles).values(roles);
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'chart.template_applied',
    entityType: 'chart',
    entityId: null,
    after: {
      templateId: template.id,
      templateVersion: template.version,
      accountCount: added.length,
    },
  });
}
