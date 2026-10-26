import { Inject, Injectable } from '@nestjs/common';
import type { Member, UpdateMember } from '@vertex-mizan/contracts';
import {
  type Database,
  memberships,
  sessions,
  type Transaction,
  twoFactors,
  users,
  withCompany,
} from '@vertex-mizan/db';
import { and, asc, count, eq, isNull, ne } from 'drizzle-orm';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { freshlyAuthenticated } from '../../core/access/session-activity.js';
import { changedFields, writeCompanyAudit } from '../../core/audit/audit.js';
import { DATABASE } from '../../core/database/database.module.js';
import { queueEmail } from '../../core/email/outbox.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { dropWaitingAuthenticator } from '../auth/two-factor.js';

type MembershipRow = typeof memberships.$inferSelect;

/** Memberships of the active company (S01 rules 14–18, 21). */
@Injectable()
export class MembersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `GET /api/members`: the active members with their role and two-factor state. */
  async list(access: CompanyRouteAccess): Promise<Member[]> {
    const rows = await this.db
      .select({
        id: memberships.id,
        userId: users.id,
        name: users.name,
        email: users.email,
        role: memberships.role,
        canClosePeriods: memberships.canClosePeriods,
        twoFactorEnabled: users.twoFactorEnabled,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.scopeCompanyId, access.company.id), isNull(memberships.archivedAt)))
      .orderBy(asc(users.name), asc(memberships.id));
    return rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() }));
  }

  /**
   * `PATCH /api/members/:id`: a new role or period permission, read by the guard on the member's
   * next request (rule 16). Demoting the last owner is refused (`LAST_OWNER`, rule 18).
   */
  async update(access: CompanyRouteAccess, id: string, change: UpdateMember): Promise<Member> {
    const companyId = access.company.id;
    await withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId, 'exclusive');
      const target = await this.activeMembership(tx, companyId, id);
      if (target.role === 'owner' && change.role !== 'owner') {
        await this.refuseLastOwner(tx, companyId, target.id);
      }
      const diff = changedFields(
        { role: target.role, canClosePeriods: target.canClosePeriods },
        { role: change.role, canClosePeriods: change.canClosePeriods },
      );
      if (!diff) return;
      await tx
        .update(memberships)
        .set({ role: change.role, canClosePeriods: change.canClosePeriods })
        .where(eq(memberships.id, target.id));
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: 'membership.updated',
        entityType: 'membership',
        entityId: target.id,
        ...diff,
      });
    });
    const member = (await this.list(access)).find((entry) => entry.id === id);
    if (!member) throw new CodedException('NOT_FOUND', 'No such member');
    return member;
  }

  /**
   * `POST /api/members/:id/remove`: an owner removes a member (`members.manage` and a fresh code),
   * or a member leaves. The membership is archived with the reason, and the person's sessions in
   * this company lose it as their active company (rule 17). The last owner cannot go (rule 18).
   */
  async remove(access: CompanyRouteAccess, id: string, reason: string): Promise<void> {
    const companyId = access.company.id;
    await withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId, 'exclusive');
      const target = await this.activeMembership(tx, companyId, id);
      const leaving = target.userId === access.person.id;
      if (!leaving) {
        if (!access.company.permissions.includes('members.manage')) {
          throw new CodedException('FORBIDDEN', 'The role lacks the permission');
        }
        if (!freshlyAuthenticated(access.session.reauthenticatedAt)) {
          throw new CodedException('REAUTHENTICATION_REQUIRED', 'Type a fresh code first');
        }
      }
      if (target.role === 'owner') await this.refuseLastOwner(tx, companyId, target.id);
      await tx
        .update(memberships)
        .set({ archivedAt: new Date(), archivedReason: reason })
        .where(eq(memberships.id, target.id));
      await tx
        .update(sessions)
        .set({ activeCompanyId: null })
        .where(and(eq(sessions.userId, target.userId), eq(sessions.activeCompanyId, companyId)));
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: leaving ? 'membership.left' : 'membership.removed',
        entityType: 'membership',
        entityId: target.id,
        reason,
        before: { archivedReason: null },
        after: { archivedReason: reason },
      });
    });
  }

  /**
   * `POST /api/members/:id/reset-two-factor` (rule 21): removes the member's authenticator and
   * backup codes and ends their sessions, only when every active membership of that person is in
   * a company the resetting owner also owns; otherwise Vertex resets it with the server command.
   */
  async resetTwoFactor(access: CompanyRouteAccess, id: string, reason: string): Promise<void> {
    const companyId = access.company.id;
    await withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const target = await this.activeMembership(tx, companyId, id);
      if (target.userId === access.person.id) {
        throw new CodedException('RESET_NOT_ALLOWED', 'Use your backup codes or ask Vertex');
      }
      // Rule 21 holds until commit: the person's row is locked, so a membership added meanwhile
      // (its foreign key takes `FOR KEY SHARE` on it) waits, and the resetting owner's owner
      // memberships are locked against a demotion.
      const [person] = await tx
        .select({ email: users.email, twoFactorEnabled: users.twoFactorEnabled })
        .from(users)
        .where(eq(users.id, target.userId))
        .for('update');
      if (!person) throw new CodedException('NOT_FOUND', 'No such member');
      const theirs = await tx
        .select({ companyId: memberships.scopeCompanyId })
        .from(memberships)
        .where(and(eq(memberships.userId, target.userId), isNull(memberships.archivedAt)));
      const owned = new Set(
        (
          await tx
            .select({ companyId: memberships.scopeCompanyId })
            .from(memberships)
            .where(
              and(
                eq(memberships.userId, access.person.id),
                eq(memberships.role, 'owner'),
                isNull(memberships.archivedAt),
              ),
            )
            .for('share')
        ).map((row) => row.companyId),
      );
      if (!theirs.every((row) => owned.has(row.companyId))) {
        throw new CodedException('RESET_NOT_ALLOWED', 'The person belongs to another company');
      }
      await tx.delete(twoFactors).where(eq(twoFactors.userId, target.userId));
      await dropWaitingAuthenticator(tx, target.userId);
      await tx.update(users).set({ twoFactorEnabled: false }).where(eq(users.id, target.userId));
      await tx.delete(sessions).where(eq(sessions.userId, target.userId));
      await queueEmail(tx, 'two_factor_reset', person.email, { companyName: access.company.name });
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: 'membership.two_factor_reset',
        entityType: 'user',
        entityId: target.userId,
        reason,
        before: { twoFactorEnabled: person.twoFactorEnabled },
        after: { twoFactorEnabled: false },
      });
    });
  }

  /** An active membership of the company; another company's id answers like an unknown one. */
  private async activeMembership(
    tx: Transaction,
    companyId: string,
    id: string,
  ): Promise<MembershipRow> {
    const [row] = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.id, id),
          eq(memberships.scopeCompanyId, companyId),
          isNull(memberships.archivedAt),
        ),
      );
    if (!row) throw new CodedException('NOT_FOUND', 'No such member');
    return row;
  }

  /** Refuses a change that would leave no other active owner; a pending invitation is not one. */
  private async refuseLastOwner(
    tx: Transaction,
    companyId: string,
    leaving: string,
  ): Promise<void> {
    const [others] = await tx
      .select({ owners: count() })
      .from(memberships)
      .where(
        and(
          eq(memberships.scopeCompanyId, companyId),
          eq(memberships.role, 'owner'),
          isNull(memberships.archivedAt),
          ne(memberships.id, leaving),
        ),
      );
    if (!others || others.owners === 0) {
      throw new CodedException('LAST_OWNER', 'The company needs an owner');
    }
  }
}
