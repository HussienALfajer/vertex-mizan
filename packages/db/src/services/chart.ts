import {
  type AccountLevel,
  accountClassOfCode,
  type ChartTemplateId,
  type CreateAccount,
  chartTemplate,
  checkAccountCode,
  checkAccountShape,
  DomainError,
  defaultNormalBalance,
} from '@vertex-mizan/contracts';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { type AuditActor, writeCompanyAudit } from '../audit.js';
import type { Transaction } from '../client.js';
import { accountRequiredDimensions, accountRoles, chartAccounts } from '../schema/chart.js';
import { dimensionTypes } from '../schema/dimensions.js';
import { onUniqueViolation } from '../unique-violation.js';

// The chart's writes that company creation, the API and the scenario book's setup share (S02
// rules 1–2), in the caller's transaction and company context.

export type AccountRow = typeof chartAccounts.$inferSelect;

/** The level of a stored account. */
export function levelOf(row: AccountRow): AccountLevel {
  return row.level as AccountLevel;
}

/** The fields of an account the audit log records before and after. */
export function auditedAccountOf(row: AccountRow, requiredDimensionTypeIds: readonly string[]) {
  return {
    code: row.code,
    parentId: row.parentId,
    level: row.level,
    kind: row.kind,
    class: row.class,
    name: row.name,
    nameLatin: row.nameLatin,
    normalBalance: row.normalBalance,
    statementLine: row.statementLine,
    currency: row.currency,
    isControl: row.isControl,
    isMonetary: row.isMonetary,
    requiredDimensionTypeIds: [...requiredDimensionTypeIds],
  };
}

/** The unique key of an account's code (S02 edge case 1: two accountants, one code). */
export const ACCOUNT_CODE_TAKEN = {
  chart_accounts_company_id_code_key: 'ACCOUNT_CODE_TAKEN',
} as const;

/** An account of the company, locked; another company's id answers like an unknown one. */
export async function lockedAccount(
  tx: Transaction,
  id: string,
  lock: 'share' | 'update',
): Promise<AccountRow> {
  const [row] = await tx
    .select()
    .from(chartAccounts)
    .where(eq(chartAccounts.id, id))
    .for(lock === 'share' ? 'share' : 'no key update');
  if (!row) throw new DomainError('NOT_FOUND', 'No such account');
  return row;
}

/** Every required dimension type exists in the company and is not archived (`NOT_FOUND`). */
export async function checkDimensionTypes(
  tx: Transaction,
  typeIds: readonly string[],
): Promise<void> {
  if (typeIds.length === 0) return;
  // Read FOR SHARE, as the database's own check does, so an archive at the same time waits and
  // this check answers instead of the trigger.
  const found = await tx
    .select({ id: dimensionTypes.id })
    .from(dimensionTypes)
    .where(and(inArray(dimensionTypes.id, [...typeIds]), isNull(dimensionTypes.archivedAt)))
    .for('share');
  if (found.length !== typeIds.length) {
    throw new DomainError('NOT_FOUND', 'No such dimension type');
  }
}

/** Adds the required types new to the account. */
export async function addRequiredDimensions(
  tx: Transaction,
  companyId: string,
  accountId: string,
  before: readonly string[],
  after: readonly string[],
): Promise<void> {
  const added = after.filter((typeId) => !before.includes(typeId));
  if (added.length === 0) return;
  await tx
    .insert(accountRequiredDimensions)
    .values(added.map((dimensionTypeId) => ({ companyId, accountId, dimensionTypeId })));
}

/**
 * A new account (S02 rule 2): a header or postable account under a header, its code fitting the
 * parent (`ACCOUNT_CODE_INVALID`, `ACCOUNT_NOT_HEADER`), its class from the code and its normal
 * balance by class unless given, with its required dimension types and its audit row.
 */
export async function createAccount(
  tx: Transaction,
  companyId: string,
  input: CreateAccount,
  actor: AuditActor,
): Promise<AccountRow> {
  const parent = await lockedAccount(tx, input.parentId, 'share');
  if (parent.archivedAt) throw new DomainError('ACCOUNT_ARCHIVED', 'The parent is archived');
  const level = checkAccountCode(input.code, {
    code: parent.code,
    level: levelOf(parent),
    kind: parent.kind as 'header' | 'postable',
  });
  const accountClass = accountClassOfCode(input.code);
  checkAccountShape({
    level,
    kind: input.kind,
    class: accountClass,
    statementLine: input.statementLine,
    currency: input.currency,
    isControl: input.isControl,
    isMonetary: input.isMonetary,
    requiredDimensionCount: input.requiredDimensionTypeIds.length,
  });
  await checkDimensionTypes(tx, input.requiredDimensionTypeIds);
  const [row] = await onUniqueViolation(
    () =>
      tx
        .insert(chartAccounts)
        .values({
          companyId,
          code: input.code,
          level,
          parentId: parent.id,
          kind: input.kind,
          class: accountClass,
          name: input.name,
          nameLatin: input.nameLatin,
          normalBalance: input.normalBalance ?? defaultNormalBalance(accountClass),
          statementLine: input.statementLine,
          currency: input.currency,
          isControl: input.isControl,
          isMonetary: input.isMonetary,
        })
        .returning(),
    ACCOUNT_CODE_TAKEN,
  );
  if (!row) throw new Error('The account was not created');
  await addRequiredDimensions(tx, companyId, row.id, [], input.requiredDimensionTypeIds);
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'account.created',
    entityType: 'account',
    entityId: row.id,
    after: auditedAccountOf(row, input.requiredDimensionTypeIds),
  });
  return row;
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
    throw new DomainError('CHART_NOT_EMPTY', 'The chart already has accounts');
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
