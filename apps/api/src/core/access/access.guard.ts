import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { effectivePermissions } from '@vertex-mizan/contracts';
import { companies, type Database, memberships, sessions, users } from '@vertex-mizan/db';
import { fromNodeHeaders } from 'better-auth/node';
import { and, eq, isNull } from 'drizzle-orm';
import type { Request } from 'express';
import { AUTH, type Auth } from '../../modules/auth/auth.js';
import type { RequestFacts } from '../audit/audit.js';
import { DATABASE } from '../database/database.module.js';
import { CodedException } from '../errors/coded-exception.js';
import {
  ACCESS_RULES,
  type AccessRule,
  type CompanyAccess,
  type Person,
  REAUTHENTICATED,
  type RequestWithAccess,
  type SessionState,
  WHILE_ARCHIVED,
} from './access.js';
import { freshlyAuthenticated, keepActive } from './session-activity.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The header with the company the page was showing (S01 rule 22): a check, never the source. */
export const COMPANY_HEADER = 'x-mizan-company';

/** The request facts both audit logs record: the request ID, the client address, the agent. */
export function factsOf(request: Request & { id?: unknown }): RequestFacts {
  return {
    requestId: String(request.id ?? 'unknown'),
    ipAddress: request.ip ?? null,
    userAgent: request.get('user-agent') ?? null,
  };
}

/**
 * The global access guard (S01 "Rules of the guard"). It fails closed: a route without exactly one
 * access rule is refused. It reads the session on every request (one indexed read of the session
 * and its person, and of the membership for a company route), ends an idle one, holds a person
 * who has not enrolled to enrolment, checks the active company's membership and permissions, the
 * company header and the archive on writes, and the re-authentication window last.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const rules = (Reflect.getMetadata(ACCESS_RULES, handler) as AccessRule[] | undefined) ?? [];
    const [rule] = rules;
    if (rules.length !== 1 || !rule) {
      throw new CodedException('FORBIDDEN', 'The route declares no single access rule');
    }
    const request = context.switchToHttp().getRequest<Request & RequestWithAccess>();
    const facts = factsOf(request);
    const signedIn = await this.session(request);

    if (rule.kind === 'public') {
      request.access = {
        ...facts,
        person: signedIn?.person ?? null,
        session: signedIn?.session ?? null,
        company: null,
      };
      return true;
    }
    if (!signedIn) throw new CodedException('UNAUTHENTICATED', 'Sign in first');
    const { person, session } = signedIn;
    const enrolmentOnly = rule.kind === 'signed-in' && rule.beforeEnrolment;
    if (!session.twoFactorVerifiedAt && !enrolmentOnly) {
      throw new CodedException('TWO_FACTOR_REQUIRED', 'Enrol two-factor authentication first');
    }

    let company: CompanyAccess | null = null;
    if (rule.kind === 'company') {
      company = await this.company(person.id, session.activeCompanyId);
      if (!company) throw new CodedException('COMPANY_NOT_SELECTED', 'Choose a company first');
      const held = company.permissions;
      if (!rule.permissions.every((permission) => held.includes(permission))) {
        throw new CodedException('FORBIDDEN', 'The role lacks the permission');
      }
      const shown = request.get(COMPANY_HEADER);
      // A write always names the company its page shows (rule 22); a read may, so that a switch
      // in another tab refuses it instead of answering with the other company's data.
      if (shown !== undefined && shown !== company.id) {
        throw new CodedException('COMPANY_SWITCHED', 'The active company changed');
      }
      if (!SAFE_METHODS.has(request.method)) {
        if (shown !== company.id) {
          throw new CodedException('COMPANY_SWITCHED', 'The active company changed');
        }
        const whileArchived = this.reflector.get<boolean | undefined>(WHILE_ARCHIVED, handler);
        if (company.archived && !whileArchived) {
          throw new CodedException('COMPANY_ARCHIVED', 'The company is archived');
        }
      }
    }

    if (
      this.reflector.get<boolean | undefined>(REAUTHENTICATED, handler) &&
      !freshlyAuthenticated(session.reauthenticatedAt)
    ) {
      throw new CodedException('REAUTHENTICATION_REQUIRED', 'Type a fresh code first');
    }
    request.access = { ...facts, person, session, company };
    return true;
  }

  /** The request's live session and its person, or null; an idle session ends here. */
  private async session(
    request: Request,
  ): Promise<{ person: Person; session: SessionState } | null> {
    if (!request.headers.cookie) return null;
    const found = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
      query: { disableRefresh: true, disableCookieCache: true },
    });
    if (!found) return null;
    const [row] = await this.db
      .select({
        person: {
          id: users.id,
          name: users.name,
          email: users.email,
          twoFactorEnabled: users.twoFactorEnabled,
        },
        archivedAt: users.archivedAt,
        session: {
          id: sessions.id,
          activeCompanyId: sessions.activeCompanyId,
          twoFactorVerifiedAt: sessions.twoFactorVerifiedAt,
          reauthenticatedAt: sessions.reauthenticatedAt,
        },
        lastActiveAt: sessions.lastActiveAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, found.session.id));
    if (!row || row.archivedAt) return null;
    if (!(await keepActive(this.db, { id: row.session.id, lastActiveAt: row.lastActiveAt }))) {
      return null;
    }
    return { person: row.person, session: row.session };
  }

  /** The active membership in the session's active company, read on every request (rule 16). */
  private async company(userId: string, companyId: string | null): Promise<CompanyAccess | null> {
    if (!companyId) return null;
    const [row] = await this.db
      .select({
        id: companies.id,
        name: companies.name,
        archivedAt: companies.archivedAt,
        membershipId: memberships.id,
        role: memberships.role,
        canClosePeriods: memberships.canClosePeriods,
      })
      .from(memberships)
      .innerJoin(companies, eq(companies.id, memberships.scopeCompanyId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.scopeCompanyId, companyId),
          isNull(memberships.archivedAt),
        ),
      );
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      archived: row.archivedAt !== null,
      membershipId: row.membershipId,
      role: row.role,
      canClosePeriods: row.canClosePeriods,
      permissions: effectivePermissions(row),
    };
  }
}
