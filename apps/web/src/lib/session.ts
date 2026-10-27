import { queryOptions } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { type Me, meSchema } from '@vertex-mizan/contracts';
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

/** A person with two-factor enrolled (S01 rule 2): anyone else reaches only enrolment. */
export async function requireEnrolled(args: GuardArgs): Promise<Me> {
  const me = await requireSession(args);
  if (!me.person.twoFactorEnabled) {
    throw redirect({ to: '/two-factor/enrol', search: { redirect: args.location.href } });
  }
  return me;
}
