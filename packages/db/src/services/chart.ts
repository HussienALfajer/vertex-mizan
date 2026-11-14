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
  type TemplateAccount,
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
    itemKind: row.itemKind,
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

/**
 * Blocks a postable account with a reason (S02 rule 5), the account's row locked by the caller
 * after the ledger head (ADR 0008): new postings to it stop (`ACCOUNT_NOT_POSTABLE` on a header);
 * an account that holds a role stays open (`ACCOUNT_IN_ROLE`). Blocking a blocked account changes
 * nothing. Used by `POST /api/accounts/:id/block` and the scenario book's `block` step.
 */
export async function blockAccount(
  tx: Transaction,
  companyId: string,
  actor: AuditActor,
  row: AccountRow,
  reason: string,
): Promise<void> {
  if (row.kind !== 'postable') {
    throw new DomainError('ACCOUNT_NOT_POSTABLE', 'Only a postable account is blocked');
  }
  if (row.blockedAt) return;
  const [role] = await tx
    .select({ role: accountRoles.role })
    .from(accountRoles)
    .where(and(eq(accountRoles.accountId, row.id), isNull(accountRoles.archivedAt)))
    .limit(1);
  if (role) throw new DomainError('ACCOUNT_IN_ROLE', `The account holds ${role.role}`);
  await tx
    .update(chartAccounts)
    .set({ blockedAt: new Date(), blockedReason: reason })
    .where(eq(chartAccounts.id, row.id));
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'account.blocked',
    entityType: 'account',
    entityId: row.id,
    reason,
    before: { blockedReason: null },
    after: { blockedReason: reason },
  });
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
    itemKind: input.itemKind,
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
          itemKind: input.itemKind,
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
  await applyChart(tx, companyId, chartTemplate(templateId), actor);
}

/** A chart to apply: a template of contracts, or the scenario book's own chart (ADR 0021). */
export interface ChartToApply {
  readonly id: string;
  readonly version: number;
  readonly accounts: readonly TemplateAccount[];
}

/**
 * Applies a chart's accounts to a chart that holds the five roots alone (`CHART_NOT_EMPTY`
 * otherwise), with their required dimensions and roles, audited `chart.template_applied`. The
 * scenario book applies its own chart through it, the service-agency chart its approved cases
 * name, which the product no longer offers (ADR 0021).
 */
export async function applyChart(
  tx: Transaction,
  companyId: string,
  template: ChartToApply,
  actor: AuditActor,
): Promise<void> {
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
      itemKind: account.itemKind,
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

/**
 * S10 ("Data"): the template's `312002` "نتيجة السنة قبل بدء الدفاتر" with the role
 * `pre_opening_result`, added to a company made before the templates' version 2 whose chart holds
 * the header `312` and no `312002`, when no account holds the role yet. Runs at the worker's start
 * after the deploy, since a value appended to the role enum cannot be used in the migration's
 * transaction. Safe to run twice; answers whether it added it.
 */
export async function appendPreOpeningResultAccount(
  tx: Transaction,
  companyId: string,
  actor: AuditActor,
): Promise<boolean> {
  // The header first, `FOR UPDATE`: two runs at once serialise here, and the second, reading after
  // the first's commit, finds the role held.
  const [parent] = await tx
    .select({ id: chartAccounts.id, kind: chartAccounts.kind })
    .from(chartAccounts)
    .where(and(eq(chartAccounts.code, '312'), isNull(chartAccounts.archivedAt)))
    .for('update');
  if (parent === undefined || parent.kind !== 'header') return false;
  const [held] = await tx
    .select({ id: accountRoles.id })
    .from(accountRoles)
    .where(and(eq(accountRoles.role, 'pre_opening_result'), isNull(accountRoles.archivedAt)));
  if (held !== undefined) return false;
  const [taken] = await tx
    .select({ id: chartAccounts.id })
    .from(chartAccounts)
    .where(eq(chartAccounts.code, '312002'));
  if (taken !== undefined) return false;
  const template = chartTemplate('general').accounts.find((account) => account.code === '312002');
  if (template === undefined) throw new Error('The template has no 312002');
  const account = await createAccount(
    tx,
    companyId,
    {
      parentId: parent.id,
      code: template.code,
      kind: template.kind,
      name: template.name,
      nameLatin: template.nameLatin,
      normalBalance: template.normalBalance,
      statementLine: template.statementLine,
      currency: template.currency,
      isControl: template.isControl,
      itemKind: template.itemKind,
      isMonetary: template.isMonetary,
      requiredDimensionTypeIds: [],
    },
    actor,
  );
  const [role] = await tx
    .insert(accountRoles)
    .values({ companyId, role: 'pre_opening_result', accountId: account.id })
    .returning({ id: accountRoles.id });
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'account_role.set',
    entityType: 'account_role',
    entityId: role?.id ?? null,
    before: { role: 'pre_opening_result', accountId: null },
    after: { role: 'pre_opening_result', accountId: account.id },
  });
  return true;
}
