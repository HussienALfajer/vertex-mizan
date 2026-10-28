import { Inject, Injectable } from '@nestjs/common';
import {
  effectivePermissions,
  type Me,
  type MyMembership,
  type SignInPage,
} from '@vertex-mizan/contracts';
import {
  accounts,
  companies,
  type Database,
  memberships,
  platformAuditEntries,
  sessions,
  withCompany,
} from '@vertex-mizan/db';
import { and, asc, desc, eq, isNull, ne, or } from 'drizzle-orm';
import { actorOf, type SignedInAccess } from '../../core/access/access.js';
import { writeCompanyAudit, writePlatformAudit } from '../../core/audit/audit.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { afterCursor, decodeCursor, pageOf } from '../../core/http/cursor.js';
import { consumeLimit, LIMITS } from '../../core/limits/limits.js';
import { hashPassword, verifyPassword } from '../auth/password.js';

const SIGN_IN_PAGE = 100;

/** The signed-in person: who they are, their companies, their sign-ins and password. */
@Injectable()
export class MeService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `GET /api/me`: the person, their active memberships, the active company and permissions. */
  async me(access: SignedInAccess): Promise<Me> {
    const rows = await this.db
      .select({
        membershipId: memberships.id,
        companyId: companies.id,
        name: companies.name,
        nameLatin: companies.nameLatin,
        archivedAt: companies.archivedAt,
        role: memberships.role,
        canClosePeriods: memberships.canClosePeriods,
      })
      .from(memberships)
      .innerJoin(companies, eq(companies.id, memberships.scopeCompanyId))
      .where(and(eq(memberships.userId, access.person.id), isNull(memberships.archivedAt)))
      .orderBy(asc(companies.name), asc(companies.id));
    const list: MyMembership[] = rows.map((row) => ({
      membershipId: row.membershipId,
      company: {
        id: row.companyId,
        name: row.name,
        nameLatin: row.nameLatin,
        archived: row.archivedAt !== null,
      },
      role: row.role,
      canClosePeriods: row.canClosePeriods,
    }));
    // A removed member's session keeps a company they no longer belong to: none is active then.
    const active = list.find((entry) => entry.company.id === access.session.activeCompanyId);
    return {
      person: access.person,
      memberships: list,
      activeCompanyId: active?.company.id ?? null,
      permissions: active ? [...effectivePermissions(active)] : [],
    };
  }

  /**
   * `POST /api/session/company`: a company where the person holds an active membership becomes
   * the session's active company (S01 rules 19–20); an archived one is entered read-only. The
   * switch is written to that company's audit log.
   */
  async enterCompany(access: SignedInAccess, companyId: string): Promise<Me> {
    const [membership] = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, access.person.id),
          eq(memberships.scopeCompanyId, companyId),
          isNull(memberships.archivedAt),
        ),
      );
    if (!membership) throw new CodedException('NOT_FOUND', 'No such company');
    // The switch and its audit row in one transaction (ADR 0005): neither is kept without the other.
    await withCompany(this.db, companyId, async (tx) => {
      await tx
        .update(sessions)
        .set({ activeCompanyId: companyId })
        .where(eq(sessions.id, access.session.id));
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: 'session.company_entered',
        entityType: 'session',
        entityId: access.session.id,
        after: { activeCompanyId: companyId },
      });
    });
    return this.me({ ...access, session: { ...access.session, activeCompanyId: companyId } });
  }

  /**
   * `GET /api/me/sign-ins`: the person's own platform audit entries, newest first, with the
   * failed password steps typed with their address (rule 26), whose actor is unknown.
   */
  async signIns(access: SignedInAccess, cursor: string | undefined): Promise<SignInPage> {
    const after = cursor ? decodeCursor(cursor) : null;
    const rows = await this.db
      .select({
        id: platformAuditEntries.id,
        createdAt: platformAuditEntries.createdAt,
        action: platformAuditEntries.action,
        ipAddress: platformAuditEntries.ipAddress,
        userAgent: platformAuditEntries.userAgent,
      })
      .from(platformAuditEntries)
      .where(
        and(
          or(
            eq(platformAuditEntries.actorUserId, access.person.id),
            and(
              isNull(platformAuditEntries.actorUserId),
              eq(platformAuditEntries.action, 'user.sign_in_failed'),
              eq(platformAuditEntries.email, access.person.email.toLowerCase()),
            ),
          ),
          after
            ? afterCursor(platformAuditEntries.createdAt, platformAuditEntries.id, after)
            : undefined,
        ),
      )
      .orderBy(desc(platformAuditEntries.createdAt), desc(platformAuditEntries.id))
      .limit(SIGN_IN_PAGE + 1);
    return pageOf(rows, SIGN_IN_PAGE, (row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      action: row.action as SignInPage['entries'][number]['action'],
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
    }));
  }

  /**
   * `POST /api/me/password`: the current password, then the new one; every session of the
   * person ends, this one included (S01 rule 5).
   */
  async changePassword(
    access: SignedInAccess,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const { person } = access;
    if (!(await consumeLimit(this.db, `change-password:${person.id}`, LIMITS.perIpPerMinute))) {
      throw new CodedException('RATE_LIMITED', 'Too many attempts');
    }
    const [account] = await this.db
      .select({ id: accounts.id, password: accounts.password })
      .from(accounts)
      .where(and(eq(accounts.userId, person.id), eq(accounts.providerId, 'credential')));
    if (
      !account?.password ||
      !(await verifyPassword({ hash: account.password, password: currentPassword }))
    ) {
      throw new CodedException('INVALID_CREDENTIALS', 'Wrong password');
    }
    if (newPassword.toLowerCase() === person.email) {
      throw new CodedException('VALIDATION_FAILED', 'The password equals the email', [
        { path: ['newPassword'], message: 'The password must not be the email' },
      ]);
    }
    const hash = await hashPassword(newPassword);
    await this.db.transaction(async (tx) => {
      await tx.update(accounts).set({ password: hash }).where(eq(accounts.id, account.id));
      await tx.delete(sessions).where(eq(sessions.userId, person.id));
      await writePlatformAudit(tx, { action: 'user.password_changed', actor: actorOf(access) });
    });
  }

  /**
   * `POST /api/me/sessions/revoke-others`: every other session of the person ends, this one stays
   * (S01, `/account/security`). Audited with the number ended, in the same transaction.
   */
  async revokeOtherSessions(access: SignedInAccess): Promise<void> {
    await this.db.transaction(async (tx) => {
      const ended = await tx
        .delete(sessions)
        .where(and(eq(sessions.userId, access.person.id), ne(sessions.id, access.session.id)))
        .returning({ id: sessions.id });
      await writePlatformAudit(tx, {
        action: 'user.other_sessions_revoked',
        actor: actorOf(access),
        details: { sessionsEnded: ended.length },
      });
    });
  }
}
