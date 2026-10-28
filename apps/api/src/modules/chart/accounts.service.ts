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
  type SetAccountRole,
  type UpdateAccount,
} from '@vertex-mizan/contracts';
import {
  ACCOUNT_CODE_TAKEN,
  type AccountRow,
  accountRequiredDimensions,
  accountRoles,
  addRequiredDimensions,
  auditedAccountOf,
  chartAccounts,
  checkDimensionTypes,
  createAccount,
  type Database,
  ledgerHeads,
  lockedAccount,
  periodBalances,
  type Transaction,
  withCompany,
} from '@vertex-mizan/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { type AuditActor, changedFields, writeCompanyAudit } from '../../core/audit/audit.js';
import { DATABASE } from '../../core/database/database.module.js';
import { onUniqueViolation } from '../../core/database/unique-violation.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { levelOf, readAccount, readChart } from './chart-shape.js';

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
      const row = await createAccount(tx, companyId, input, actorOf(access));
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
      if (
        row.level === 1 &&
        (structural ||
          next.statementLine !== row.statementLine ||
          next.requiredDimensionTypeIds.length > 0)
      ) {
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
      await checkDimensionTypes(tx, next.requiredDimensionTypeIds);
      const before = auditedAccountOf(row, required);
      // Dropped dimensions go before the account changes and added ones after it: the database
      // allows a required dimension on a postable account only, so a postable account that turns
      // into a header lets its dimensions go first, and a header that turns postable gains them last.
      await this.dropDimensions(tx, id, required, next.requiredDimensionTypeIds);
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
        ACCOUNT_CODE_TAKEN,
      );
      if (!updated) throw new CodedException('NOT_FOUND', 'No such account');
      await addRequiredDimensions(tx, companyId, id, required, next.requiredDimensionTypeIds);
      const diff = changedFields(before, auditedAccountOf(updated, next.requiredDimensionTypeIds));
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
   * (`ACCOUNT_HAS_CHILDREN`), no role (`ACCOUNT_IN_ROLE`), and a zero balance in both ledgers
   * (`ACCOUNT_HAS_BALANCE`, S03; open items join with S04). The ledger head is locked before the
   * account, in the posting function's order (ADR 0008), so no posting lands between the balance
   * read and the archive (S02 abuse case).
   */
  async archive(access: CompanyRouteAccess, id: string, reason: string): Promise<Account> {
    return this.changeState(access, id, async (tx, row, actor) => {
      if (row.level === 1) throw new CodedException('ACCOUNT_LOCKED', 'A root is never archived');
      if (row.archivedAt) return;
      if (await this.hasChildren(tx, id, true)) {
        throw new CodedException('ACCOUNT_HAS_CHILDREN', 'The account has unarchived children');
      }
      await this.refuseInRole(tx, id);
      if (await hasLedgerBalance(tx, id)) {
        throw new CodedException('ACCOUNT_HAS_BALANCE', 'The account has a balance');
      }
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
      // The ledger head before the account, as the posting function locks them (ADR 0008).
      await tx.select({ id: ledgerHeads.id }).from(ledgerHeads).for('update');
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
    return lockedAccount(tx, id, lock);
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

  /** Archives the required types dropped; postings use the set from now. */
  private async dropDimensions(
    tx: Transaction,
    accountId: string,
    before: readonly string[],
    after: readonly string[],
  ): Promise<void> {
    const dropped = before.filter((typeId) => !after.includes(typeId));
    if (dropped.length === 0) return;
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
}

/**
 * Whether an account's book or parallel balance is not zero (S02 rule 6, S03), from the period
 * balances the line trigger keeps (ADR 0012).
 */
async function hasLedgerBalance(tx: Transaction, accountId: string): Promise<boolean> {
  const [row] = await tx
    .select({
      book: sql<string>`coalesce(sum(${periodBalances.bookDebitMinor} - ${periodBalances.bookCreditMinor}), 0)`,
      parallel: sql<string>`coalesce(sum(${periodBalances.parallelDebitMinor} - ${periodBalances.parallelCreditMinor}), 0)`,
    })
    .from(periodBalances)
    .where(eq(periodBalances.accountId, accountId));
  return row !== undefined && (BigInt(row.book) !== 0n || BigInt(row.parallel) !== 0n);
}
