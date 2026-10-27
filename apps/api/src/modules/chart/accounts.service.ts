import { Inject, Injectable } from '@nestjs/common';
import {
  ACCOUNT_ROLES,
  type Account,
  type AccountRole,
  type AccountRoleAssignment,
  accountClassOfCode,
  accountRoleFits,
  type CreateAccount,
  type CurrencyCode,
  checkAccountCode,
  checkAccountShape,
  defaultNormalBalance,
  type SetAccountRole,
  type UpdateAccount,
} from '@vertex-mizan/contracts';
import {
  accountRequiredDimensions,
  accountRoles,
  chartAccounts,
  type Database,
  dimensionTypes,
  type Transaction,
  withCompany,
} from '@vertex-mizan/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { type AuditActor, changedFields, writeCompanyAudit } from '../../core/audit/audit.js';
import { DATABASE } from '../../core/database/database.module.js';
import { onUniqueViolation } from '../../core/database/unique-violation.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { type AccountRow, levelOf, readAccount, readChart } from './chart-shape.js';

/** The unique key of an account's code (S02 edge case 1: two accountants, one code). */
const CODE_TAKEN = { chart_accounts_company_id_code_key: 'ACCOUNT_CODE_TAKEN' } as const;

/** The fields of an account the audit log records before and after. */
function auditedOf(row: AccountRow, requiredDimensionTypeIds: readonly string[]) {
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

/** The chart of accounts and its roles (S02 rules 1–7). */
@Injectable()
export class AccountsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `GET /api/accounts`: the whole tree in code order. */
  async list(access: CompanyRouteAccess, includeArchived: boolean): Promise<Account[]> {
    return withCompany(this.db, access.company.id, (tx) => readChart(tx, includeArchived));
  }

  /**
   * `POST /api/accounts` (rule 2): a header or postable account under a header, its code fitting
   * the parent (`ACCOUNT_CODE_INVALID`, `ACCOUNT_NOT_HEADER`), its class from the code and its
   * normal balance by class unless given.
   */
  async create(access: CompanyRouteAccess, input: CreateAccount): Promise<Account> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const parent = await this.accountRow(tx, input.parentId, 'share');
      if (parent.archivedAt) throw new CodedException('ACCOUNT_ARCHIVED', 'The parent is archived');
      const level = checkAccountCode(input.code, {
        code: parent.code,
        level: levelOf(parent),
        kind: parent.kind as Account['kind'],
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
      await this.checkDimensionTypes(tx, input.requiredDimensionTypeIds);
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
        CODE_TAKEN,
      );
      if (!row) throw new Error('The account was not created');
      await this.requireDimensions(tx, companyId, row.id, [], input.requiredDimensionTypeIds);
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: 'account.created',
        entityType: 'account',
        entityId: row.id,
        after: auditedOf(row, input.requiredDimensionTypeIds),
      });
      return readAccount(tx, row.id);
    });
  }

  /**
   * `PATCH /api/accounts/:id` (rules 3–4): before first use every field, the code only with a valid
   * parent (moving an unused leaf); after first use, and on a header with children, the names, the
   * statement line and the required dimensions only (`ACCOUNT_LOCKED`). A root is only renamed. A
   * header with children never becomes postable (`ACCOUNT_HAS_CHILDREN`).
   */
  async update(access: CompanyRouteAccess, id: string, change: UpdateAccount): Promise<Account> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const row = await this.accountRow(tx, id, 'update');
      const required = await this.requiredOf(tx, id);
      const hasChildren = await this.hasChildren(tx, id, false);
      const next = {
        code: change.code ?? row.code,
        parentId: change.parentId ?? row.parentId,
        kind: change.kind ?? (row.kind as Account['kind']),
        normalBalance: change.normalBalance ?? row.normalBalance,
        currency: change.currency === undefined ? row.currency : change.currency,
        isControl: change.isControl ?? row.isControl,
        isMonetary: change.isMonetary ?? row.isMonetary,
        name: change.name ?? row.name,
        nameLatin: change.nameLatin === undefined ? row.nameLatin : change.nameLatin,
        statementLine:
          change.statementLine === undefined ? row.statementLine : change.statementLine,
        requiredDimensionTypeIds: change.requiredDimensionTypeIds ?? required,
      };
      const structural =
        next.code !== row.code ||
        next.parentId !== row.parentId ||
        next.kind !== row.kind ||
        next.normalBalance !== row.normalBalance ||
        next.currency !== row.currency ||
        next.isControl !== row.isControl ||
        next.isMonetary !== row.isMonetary;
      if (row.level === 1 && (structural || next.statementLine !== row.statementLine)) {
        throw new CodedException('ACCOUNT_LOCKED', 'A root account is only renamed');
      }
      if (row.kind === 'header' && next.kind === 'postable' && hasChildren) {
        throw new CodedException('ACCOUNT_HAS_CHILDREN', 'The header has children');
      }
      if (structural && (row.firstPostedAt !== null || hasChildren)) {
        throw new CodedException('ACCOUNT_LOCKED', 'The account is locked since its first use');
      }
      let level = levelOf(row);
      if (row.level > 1 && (next.code !== row.code || next.parentId !== row.parentId)) {
        if (next.parentId === null || next.parentId === row.id) {
          throw new CodedException('ACCOUNT_CODE_INVALID', 'An account is not its own parent');
        }
        const parent = await this.accountRow(tx, next.parentId, 'share');
        if (parent.archivedAt) {
          throw new CodedException('ACCOUNT_ARCHIVED', 'The parent is archived');
        }
        level = checkAccountCode(next.code, {
          code: parent.code,
          level: levelOf(parent),
          kind: parent.kind as Account['kind'],
        });
      }
      const accountClass = accountClassOfCode(next.code);
      if (row.level > 1) {
        checkAccountShape({
          level,
          kind: next.kind,
          class: accountClass,
          statementLine: next.statementLine,
          currency: next.currency as CurrencyCode | null,
          isControl: next.isControl,
          isMonetary: next.isMonetary,
          requiredDimensionCount: next.requiredDimensionTypeIds.length,
        });
      }
      await this.checkRolesStillFit(tx, id, next.kind, accountClass);
      await this.checkDimensionTypes(tx, next.requiredDimensionTypeIds);
      const before = auditedOf(row, required);
      const [updated] = await onUniqueViolation(
        () =>
          tx
            .update(chartAccounts)
            .set({
              code: next.code,
              parentId: next.parentId,
              level,
              kind: next.kind,
              class: accountClass,
              name: next.name,
              nameLatin: next.nameLatin,
              normalBalance: next.normalBalance,
              statementLine: next.statementLine,
              currency: next.currency,
              isControl: next.isControl,
              isMonetary: next.isMonetary,
            })
            .where(eq(chartAccounts.id, id))
            .returning(),
        CODE_TAKEN,
      );
      if (!updated) throw new CodedException('NOT_FOUND', 'No such account');
      await this.requireDimensions(tx, companyId, id, required, next.requiredDimensionTypeIds);
      const diff = changedFields(before, auditedOf(updated, next.requiredDimensionTypeIds));
      if (diff) {
        await writeCompanyAudit(tx, companyId, actorOf(access), {
          action: 'account.updated',
          entityType: 'account',
          entityId: id,
          ...diff,
        });
      }
      return readAccount(tx, id);
    });
  }

  /**
   * `POST /api/accounts/:id/block` (rule 5): new postings to a postable account stop
   * (`ACCOUNT_NOT_POSTABLE` on a header); an account that holds a role stays open
   * (`ACCOUNT_IN_ROLE`). Blocking a blocked account changes nothing.
   */
  async block(access: CompanyRouteAccess, id: string, reason: string): Promise<Account> {
    return this.changeState(access, id, async (tx, row, actor) => {
      if (row.kind !== 'postable') {
        throw new CodedException('ACCOUNT_NOT_POSTABLE', 'Only a postable account is blocked');
      }
      if (row.blockedAt) return;
      await this.refuseInRole(tx, id);
      await tx
        .update(chartAccounts)
        .set({ blockedAt: new Date(), blockedReason: reason })
        .where(eq(chartAccounts.id, id));
      await writeCompanyAudit(tx, access.company.id, actor, {
        action: 'account.blocked',
        entityType: 'account',
        entityId: id,
        reason,
        before: { blockedReason: null },
        after: { blockedReason: reason },
      });
    });
  }

  /** `POST /api/accounts/:id/unblock` (rule 5): no reason needed. */
  async unblock(access: CompanyRouteAccess, id: string): Promise<Account> {
    return this.changeState(access, id, async (tx, row, actor) => {
      if (!row.blockedAt) return;
      await tx
        .update(chartAccounts)
        .set({ blockedAt: null, blockedReason: null })
        .where(eq(chartAccounts.id, id));
      await writeCompanyAudit(tx, access.company.id, actor, {
        action: 'account.unblocked',
        entityType: 'account',
        entityId: id,
        before: { blockedReason: row.blockedReason },
        after: { blockedReason: null },
      });
    });
  }

  /**
   * `POST /api/accounts/:id/archive` (rule 6): not a root (`ACCOUNT_LOCKED`), no unarchived child
   * (`ACCOUNT_HAS_CHILDREN`), no role (`ACCOUNT_IN_ROLE`). The zero-balance check
   * (`ACCOUNT_HAS_BALANCE`) joins with S03's period balances and open items: S02 has none.
   */
  async archive(access: CompanyRouteAccess, id: string, reason: string): Promise<Account> {
    return this.changeState(access, id, async (tx, row, actor) => {
      if (row.level === 1) throw new CodedException('ACCOUNT_LOCKED', 'A root is never archived');
      if (row.archivedAt) return;
      if (await this.hasChildren(tx, id, true)) {
        throw new CodedException('ACCOUNT_HAS_CHILDREN', 'The account has unarchived children');
      }
      await this.refuseInRole(tx, id);
      await tx
        .update(chartAccounts)
        .set({ archivedAt: new Date(), archivedReason: reason })
        .where(eq(chartAccounts.id, id));
      await writeCompanyAudit(tx, access.company.id, actor, {
        action: 'account.archived',
        entityType: 'account',
        entityId: id,
        reason,
        before: { archivedReason: null },
        after: { archivedReason: reason },
      });
    });
  }

  /** `POST /api/accounts/:id/restore` (rule 6): with a reason, under an unarchived parent. */
  async restore(access: CompanyRouteAccess, id: string, reason: string): Promise<Account> {
    return this.changeState(access, id, async (tx, row, actor) => {
      if (!row.archivedAt) return;
      if (row.parentId !== null) {
        const parent = await this.accountRow(tx, row.parentId, 'share');
        if (parent.archivedAt) {
          throw new CodedException('ACCOUNT_ARCHIVED', 'Restore the parent first');
        }
      }
      await tx
        .update(chartAccounts)
        .set({ archivedAt: null, archivedReason: null })
        .where(eq(chartAccounts.id, id));
      await writeCompanyAudit(tx, access.company.id, actor, {
        action: 'account.restored',
        entityType: 'account',
        entityId: id,
        reason,
        before: { archivedReason: row.archivedReason },
        after: { archivedReason: null },
      });
    });
  }

  /** `GET /api/account-roles`: the six roles, each with its account or null. */
  async roles(access: CompanyRouteAccess): Promise<AccountRoleAssignment[]> {
    return withCompany(this.db, access.company.id, (tx) => this.readRoles(tx));
  }

  /**
   * `PUT /api/account-roles` (rule 7): a role to a postable, unblocked, unarchived account that
   * fits it (`ACCOUNT_ROLE_INVALID`). Role changes run one after the other per company.
   */
  async setRole(
    access: CompanyRouteAccess,
    input: SetAccountRole,
  ): Promise<AccountRoleAssignment[]> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId, 'exclusive');
      const account = await this.accountRow(tx, input.accountId, 'share');
      if (
        account.blockedAt ||
        account.archivedAt ||
        !accountRoleFits(input.role, {
          kind: account.kind as Account['kind'],
          class: account.class as Account['class'],
        })
      ) {
        throw new CodedException('ACCOUNT_ROLE_INVALID', `The account does not fit ${input.role}`);
      }
      const [current] = await tx
        .select()
        .from(accountRoles)
        .where(and(eq(accountRoles.role, input.role), isNull(accountRoles.archivedAt)))
        .for('update');
      if (current?.accountId === input.accountId) return this.readRoles(tx);
      if (current) {
        await tx
          .update(accountRoles)
          .set({ archivedAt: new Date() })
          .where(eq(accountRoles.id, current.id));
      }
      const [inserted] = await tx
        .insert(accountRoles)
        .values({ companyId, role: input.role, accountId: input.accountId })
        .returning({ id: accountRoles.id });
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: 'account_role.set',
        entityType: 'account_role',
        entityId: inserted?.id ?? null,
        before: { role: input.role, accountId: current?.accountId ?? null },
        after: { role: input.role, accountId: input.accountId },
      });
      return this.readRoles(tx);
    });
  }

  private async readRoles(tx: Transaction): Promise<AccountRoleAssignment[]> {
    const rows = await tx
      .select({ role: accountRoles.role, accountId: accountRoles.accountId })
      .from(accountRoles)
      .where(isNull(accountRoles.archivedAt));
    const byRole = new Map<AccountRole, string>(rows.map((row) => [row.role, row.accountId]));
    return ACCOUNT_ROLES.map((role) => ({ role, accountId: byRole.get(role) ?? null }));
  }

  /** A state change of one account in its own transaction, answered with the account. */
  private async changeState(
    access: CompanyRouteAccess,
    id: string,
    work: (tx: Transaction, row: AccountRow, actor: AuditActor) => Promise<void>,
  ): Promise<Account> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const row = await this.accountRow(tx, id, 'update');
      await work(tx, row, actorOf(access));
      return readAccount(tx, id);
    });
  }

  /** An account of the company, locked; another company's id answers like an unknown one. */
  private async accountRow(
    tx: Transaction,
    id: string,
    lock: 'share' | 'update',
  ): Promise<AccountRow> {
    const [row] = await tx
      .select()
      .from(chartAccounts)
      .where(eq(chartAccounts.id, id))
      .for(lock === 'share' ? 'share' : 'no key update');
    if (!row) throw new CodedException('NOT_FOUND', 'No such account');
    return row;
  }

  private async hasChildren(tx: Transaction, id: string, unarchivedOnly: boolean) {
    const [child] = await tx
      .select({ id: chartAccounts.id })
      .from(chartAccounts)
      .where(
        and(
          eq(chartAccounts.parentId, id),
          unarchivedOnly ? isNull(chartAccounts.archivedAt) : undefined,
        ),
      )
      .limit(1);
    return child !== undefined;
  }

  private async refuseInRole(tx: Transaction, id: string): Promise<void> {
    const [role] = await tx
      .select({ role: accountRoles.role })
      .from(accountRoles)
      .where(and(eq(accountRoles.accountId, id), isNull(accountRoles.archivedAt)))
      .limit(1);
    if (role) throw new CodedException('ACCOUNT_IN_ROLE', `The account holds ${role.role}`);
  }

  /** An account's roles must still fit it after a change of kind or class (rule 7). */
  private async checkRolesStillFit(
    tx: Transaction,
    id: string,
    kind: Account['kind'],
    accountClass: Account['class'],
  ): Promise<void> {
    const held = await tx
      .select({ role: accountRoles.role })
      .from(accountRoles)
      .where(and(eq(accountRoles.accountId, id), isNull(accountRoles.archivedAt)));
    for (const { role } of held) {
      if (!accountRoleFits(role, { kind, class: accountClass })) {
        throw new CodedException('ACCOUNT_ROLE_INVALID', `The account would no longer fit ${role}`);
      }
    }
  }

  /** Every required dimension type exists in the company and is not archived. */
  private async checkDimensionTypes(tx: Transaction, typeIds: readonly string[]): Promise<void> {
    if (typeIds.length === 0) return;
    const found = await tx
      .select({ id: dimensionTypes.id })
      .from(dimensionTypes)
      .where(and(inArray(dimensionTypes.id, [...typeIds]), isNull(dimensionTypes.archivedAt)));
    if (found.length !== typeIds.length) {
      throw new CodedException('NOT_FOUND', 'No such dimension type');
    }
  }

  private async requiredOf(tx: Transaction, accountId: string): Promise<string[]> {
    const rows = await tx
      .select({ typeId: accountRequiredDimensions.dimensionTypeId })
      .from(accountRequiredDimensions)
      .where(
        and(
          eq(accountRequiredDimensions.accountId, accountId),
          isNull(accountRequiredDimensions.archivedAt),
        ),
      );
    return rows.map((row) => row.typeId);
  }

  /** Archives the required types dropped and adds the new ones; postings use the set from now. */
  private async requireDimensions(
    tx: Transaction,
    companyId: string,
    accountId: string,
    before: readonly string[],
    after: readonly string[],
  ): Promise<void> {
    const dropped = before.filter((typeId) => !after.includes(typeId));
    const added = after.filter((typeId) => !before.includes(typeId));
    if (dropped.length > 0) {
      await tx
        .update(accountRequiredDimensions)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(accountRequiredDimensions.accountId, accountId),
            inArray(accountRequiredDimensions.dimensionTypeId, dropped),
            isNull(accountRequiredDimensions.archivedAt),
          ),
        );
    }
    if (added.length > 0) {
      await tx
        .insert(accountRequiredDimensions)
        .values(added.map((dimensionTypeId) => ({ companyId, accountId, dimensionTypeId })));
    }
  }
}
