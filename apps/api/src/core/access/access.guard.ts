import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type ApiClientScope, apiKeySchema, effectivePermissions } from '@vertex-mizan/contracts';
import {
  apiClientKeys,
  apiClients,
  companies,
  type Database,
  memberships,
  sessions,
  users,
} from '@vertex-mizan/db';
import { fromNodeHeaders } from 'better-auth/node';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { AUTH, type Auth } from '../../modules/auth/auth.js';
import type { RequestFacts } from '../audit/audit.js';
import { DATABASE } from '../database/database.module.js';
import { CodedException } from '../errors/coded-exception.js';
import { consumeLimit, LIMITS } from '../limits/limits.js';
import {
  ACCESS_RULES,
  type AccessRule,
  type ApiClientAccess,
  type CompanyAccess,
  type Person,
  REAUTHENTICATED,
  type RequestWithAccess,
  type SessionState,
  WHILE_ARCHIVED,
} from './access.js';
import { clientAddress, secretHashOf } from './api-keys.js';
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
  private readonly logger = new Logger('AccessGuard');

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
    // Hub's API reads its key and never a session; every other route never takes a key (S05).
    const authorization = request.get('authorization');
    if (rule.kind === 'api-client') {
      const client = await this.apiClient(authorization, facts.ipAddress, rule.scopes);
      request.access = { ...facts, person: null, session: null, company: null, client };
      return true;
    }
    if (authorization !== undefined) {
      throw new CodedException('UNAUTHENTICATED', 'API keys are accepted on /v1 only');
    }
    const signedIn = await this.session(request);

    if (rule.kind === 'public') {
      request.access = {
        ...facts,
        person: signedIn?.person ?? null,
        session: signedIn?.session ?? null,
        company: null,
        client: null,
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
    request.access = { ...facts, person, session, company, client: null };
    return true;
  }

  /**
   * The API client of a `/v1` request (S05 "Access", rules 19–22): an active key of a client that
   * is not archived (`401` otherwise, at once after a revocation), of a company that is not
   * archived (`COMPANY_ARCHIVED`), from an address of its allow-list (`403`, logged without the
   * key), within 600 requests a minute per client (`RATE_LIMITED`), holding every scope of the
   * route (`403`). The key's last use is written at most once a minute.
   */
  private async apiClient(
    authorization: string | undefined,
    ipAddress: string | null,
    scopes: readonly ApiClientScope[],
  ): Promise<ApiClientAccess> {
    const key = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
    if (!key || !apiKeySchema.safeParse(key).success) {
      throw new CodedException('UNAUTHENTICATED', 'Send a valid API key');
    }
    const address = clientAddress(ipAddress);
    const [row] = await this.db
      .select({
        keyId: apiClientKeys.id,
        revokedAt: apiClientKeys.revokedAt,
        clientId: apiClients.id,
        name: apiClients.name,
        scopes: apiClients.scopes,
        clientArchivedAt: apiClients.archivedAt,
        companyId: companies.id,
        companyArchivedAt: companies.archivedAt,
        admitted: sql<boolean>`cardinality(${apiClients.ipAllowList}) = 0
          or coalesce(${address}::inet <<= any(${apiClients.ipAllowList}), false)`,
      })
      .from(apiClientKeys)
      .innerJoin(
        apiClients,
        and(
          eq(apiClients.scopeCompanyId, apiClientKeys.scopeCompanyId),
          eq(apiClients.id, apiClientKeys.apiClientId),
        ),
      )
      .innerJoin(companies, eq(companies.id, apiClients.scopeCompanyId))
      .where(eq(apiClientKeys.secretHash, secretHashOf(key)));
    if (!row || row.revokedAt || row.clientArchivedAt) {
      throw new CodedException('UNAUTHENTICATED', 'Send a valid API key');
    }
    if (row.companyArchivedAt) {
      throw new CodedException('COMPANY_ARCHIVED', 'The company is archived');
    }
    if (!row.admitted) {
      this.logger.warn(`API client ${row.clientId} refused from ${address ?? 'no address'}`);
      throw new CodedException('FORBIDDEN', 'The address is not on the client’s allow-list');
    }
    const minute = Math.floor(Date.now() / 60_000);
    if (
      !(await consumeLimit(
        this.db,
        `api-client:${row.clientId}:${minute}`,
        LIMITS.apiClientPerMinute,
      ))
    ) {
      throw new CodedException('RATE_LIMITED', 'Too many requests from this client');
    }
    const held = row.scopes as ApiClientScope[];
    if (!scopes.every((scope) => held.includes(scope))) {
      throw new CodedException('FORBIDDEN', 'The client lacks the scope');
    }
    await this.db
      .update(apiClientKeys)
      .set({ lastUsedAt: sql`now()`, lastUsedIp: address })
      .where(
        and(
          eq(apiClientKeys.id, row.keyId),
          isNull(apiClientKeys.revokedAt),
          sql`(${apiClientKeys.lastUsedAt} is null
            or ${apiClientKeys.lastUsedAt} < now() - interval '1 minute')`,
        ),
      );
    return {
      id: row.clientId,
      name: row.name,
      keyId: row.keyId,
      companyId: row.companyId,
      scopes: held,
    };
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
