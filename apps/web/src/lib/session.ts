import { queryOptions } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { type Me, type MyMembership, meSchema, type Permission } from '@vertex-mizan/contracts';
import type { RouterContext } from '../routes/__root';
import { ApiError, api } from './api';

/** `GET /api/me`: the signed-in person, or `null` without a session (or before the second step). */
export const meQuery = queryOptions({
  queryKey: ['auth', 'me'],
  queryFn: async (): Promise<Me | null> => {
    try {
      return await api('GET', '/me', { schema: meSchema });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  staleTime: 30_000,
});

/**
 * A path inside this app to return to after signing in, or `undefined`: never another origin
 * (`//host`, `https://…`), so a crafted link cannot send a person elsewhere.
 */
export function safeRedirect(target: unknown): string | undefined {
  if (typeof target !== 'string' || !target.startsWith('/')) return undefined;
  // Resolve it as the browser would (which drops tabs and line breaks, so `/\t/host` is `//host`)
  // and keep only a path on this origin.
  let url: URL;
  try {
    url = new URL(target, window.location.origin);
  } catch {
    return undefined;
  }
  // `/.//host` resolves on this origin to the path `//host`, which would mean another site.
  if (url.origin !== window.location.origin || url.pathname.startsWith('//')) return undefined;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The `redirect` search parameter of the sign-in and enrolment pages: where to go afterwards. */
export interface ReturnTo {
  redirect?: string | undefined;
}

/**
 * The key is always set, `undefined` when refused: the router merges the raw search parameters
 * under what `validateSearch` returns, so a key left out would let the raw value through.
 */
export function returnTo(search: Record<string, unknown>): ReturnTo {
  return { redirect: safeRedirect(search.redirect) };
}

interface GuardArgs {
  context: RouterContext;
  location: { href: string };
}

/** The person, or a redirect to sign-in that brings them back here. */
export async function requireSession({ context, location }: GuardArgs): Promise<Me> {
  const me = await context.queryClient.ensureQueryData(meQuery);
  if (!me) throw redirect({ to: '/sign-in', search: { redirect: location.href } });
  return me;
}

/** Whether the person may use the app: two-factor enrolled, or exempt (S01 rule 2). */
export function isEnrolled(me: Me): boolean {
  return me.person.twoFactorEnabled || me.person.twoFactorExempt;
}

/**
 * A person with two-factor enrolled, or exempt (S01 rule 2, owner 2026-11-16). S13 has no
 * enrolment screens (ADR 0024), so anyone else goes back to sign-in, which says what to do.
 */
export async function requireEnrolled(args: GuardArgs): Promise<Me> {
  const me = await requireSession(args);
  if (!isEnrolled(me)) {
    throw redirect({ to: '/sign-in', search: { redirect: args.location.href } });
  }
  return me;
}

/** The membership of the session's active company, or `undefined` without one. */
export function activeMembership(me: Me): MyMembership | undefined {
  return me.memberships.find((membership) => membership.company.id === me.activeCompanyId);
}

/** Whether the person holds a permission in the active company: to hide what they cannot do. */
export function can(me: Me, permission: Permission): boolean {
  return me.permissions.includes(permission);
}

/** The company a page works in: the session's active company when the page loaded. */
export interface CompanyContext {
  companyId: string;
  membership: MyMembership;
}

/**
 * A page of the active company (S01 rule 20). S13 keeps one company per person and has no
 * companies screen (ADR 0024): without an active company, `/no-company` says so and offers to sign
 * out. The id is kept for the page's life and sent with its writes (rule 22).
 */
export function requireCompany(me: Me): CompanyContext {
  const membership = activeMembership(me);
  if (!membership) throw redirect({ to: '/no-company' });
  return { companyId: membership.company.id, membership };
}

/** A page that needs a permission: anyone else goes to the company's first page. */
export function requirePermission(me: Me, permission: Permission): void {
  if (!can(me, permission)) throw redirect({ to: '/' });
}
