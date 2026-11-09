import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ApiClientScope, Permission, Role } from '@vertex-mizan/contracts';
import type { AuditActor, PersonActor } from '@vertex-mizan/db';
import type { RequestFacts } from '../audit/audit.js';
import { CodedException } from '../errors/coded-exception.js';

/**
 * The access rule of a route (S01 "Rules of the guard"). Every route declares exactly one:
 * `@Public()`, `@SignedIn()`, `@CompanyRoute(...permissions)` or (S05) `@ApiClientRoute(...scopes)`.
 */
export type AccessRule =
  | { kind: 'public' }
  | { kind: 'signed-in'; beforeEnrolment: boolean }
  | { kind: 'company'; permissions: readonly Permission[] }
  | { kind: 'api-client'; scopes: readonly ApiClientScope[] };

export const ACCESS_RULES = Symbol('ACCESS_RULES');
export const REAUTHENTICATED = Symbol('REAUTHENTICATED');
export const WHILE_ARCHIVED = Symbol('WHILE_ARCHIVED');

/**
 * Each access decorator adds its rule to the route's list; the guard refuses a route whose list
 * does not hold exactly one, and the architecture test fails on it (`test/architecture.test.ts`).
 */
function accessRule(rule: AccessRule): MethodDecorator {
  return (_target, _key, descriptor) => {
    const handler = descriptor.value as object;
    const rules = (Reflect.getMetadata(ACCESS_RULES, handler) as AccessRule[] | undefined) ?? [];
    Reflect.defineMetadata(ACCESS_RULES, [...rules, rule], handler);
    return descriptor;
  };
}

/** Anyone; a session is read if there is one (accepting an invitation as an existing person). */
export const Public = () => accessRule({ kind: 'public' });

/**
 * A signed-in person with no company: enrolled in two-factor, unless `beforeEnrolment` lets a
 * person who has not enrolled yet reach it (S01 rule 2: enrolment and their own profile only).
 */
export const SignedIn = (options: { beforeEnrolment?: boolean } = {}) =>
  accessRule({ kind: 'signed-in', beforeEnrolment: options.beforeEnrolment ?? false });

/**
 * A person in their session's active company, with an active membership holding every
 * permission. The company comes from the session only, never from the request; a write also
 * carries `X-Mizan-Company`, which must equal it (rule 22), and is refused while the company is
 * archived (rule 12).
 */
export const CompanyRoute = (...permissions: Permission[]) =>
  accessRule({ kind: 'company', permissions });

/**
 * A route of Hub's API under `/v1` (S05 "Access"): `Authorization: Bearer <key>` of an active key
 * whose client holds every scope, from an address its allow-list admits; the key's company is the
 * request's company, and a person's session is never read. An archived company is refused on every
 * call (`COMPANY_ARCHIVED`). A key is never accepted on any other route.
 */
export const ApiClientRoute = (...scopes: ApiClientScope[]) =>
  accessRule({ kind: 'api-client', scopes });

/** A sensitive action: a code typed within the last 5 minutes (`REAUTHENTICATION_REQUIRED`). */
export const Reauthenticated = () => SetMetadata(REAUTHENTICATED, true);

/** A company write allowed while the company is archived: restoring it. */
export const WhileArchived = () => SetMetadata(WHILE_ARCHIVED, true);

export interface Person {
  id: string;
  name: string;
  email: string;
  twoFactorEnabled: boolean;
}

export interface SessionState {
  id: string;
  activeCompanyId: string | null;
  twoFactorVerifiedAt: Date | null;
  reauthenticatedAt: Date | null;
}

/** The active company of a company route, as the guard found it on this request. */
export interface CompanyAccess {
  id: string;
  name: string;
  archived: boolean;
  membershipId: string;
  role: Role;
  canClosePeriods: boolean;
  permissions: readonly Permission[];
}

/** The API client of a `/v1` route, from its key (S05 "Access"). */
export interface ApiClientAccess {
  id: string;
  name: string;
  keyId: string;
  /** The key's company: the transaction's company (`withCompany`), never the request's. */
  companyId: string;
  scopes: readonly ApiClientScope[];
}

/** What the guard attaches to the request: who asks, from where, and in which company. */
export interface RequestAccess extends RequestFacts {
  person: Person | null;
  session: SessionState | null;
  company: CompanyAccess | null;
  client: ApiClientAccess | null;
}

export interface ApiClientRouteAccess extends RequestAccess {
  person: null;
  session: null;
  client: ApiClientAccess;
}

export interface SignedInAccess extends RequestAccess {
  person: Person;
  session: SessionState;
}

export interface CompanyRouteAccess extends SignedInAccess {
  company: CompanyAccess;
}

export interface RequestWithAccess {
  access?: RequestAccess;
}

/** The request's access, as the guard resolved it. */
export const Access = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestAccess => {
    const access = context.switchToHttp().getRequest<RequestWithAccess>().access;
    if (!access) throw new Error('The access guard did not run');
    return access;
  },
);

/** The signed-in person's access; refused without a session. */
export function signedIn(access: RequestAccess): SignedInAccess {
  if (!access.person || !access.session) {
    throw new CodedException('UNAUTHENTICATED', 'Sign in first');
  }
  return access as SignedInAccess;
}

/** The access of a company route. */
export function inCompany(access: RequestAccess): CompanyRouteAccess {
  const signed = signedIn(access);
  if (!signed.company) throw new CodedException('COMPANY_NOT_SELECTED', 'Choose a company first');
  return signed as CompanyRouteAccess;
}

/** The access of a `/v1` route. */
export function viaApiClient(access: RequestAccess): ApiClientRouteAccess {
  if (!access.client) throw new CodedException('UNAUTHENTICATED', 'Send an API key');
  return access as ApiClientRouteAccess;
}

/** The API client as the audit logs and the inbox record it. */
export function clientActorOf(access: ApiClientRouteAccess): AuditActor {
  return {
    kind: 'api_client',
    clientId: access.client.id,
    name: access.client.name,
    requestId: access.requestId,
    ipAddress: access.ipAddress,
    userAgent: access.userAgent,
  };
}

/** The person as the audit logs record them. */
export function actorOf(access: SignedInAccess): PersonActor {
  return {
    kind: 'person',
    userId: access.person.id,
    name: access.person.name,
    sessionId: access.session.id,
    requestId: access.requestId,
    ipAddress: access.ipAddress,
    userAgent: access.userAgent,
  };
}
