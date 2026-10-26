import { type Database, rateLimits, type Transaction } from '@vertex-mizan/db';
import { and, eq, gt, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

/** A limit: at most `max` counted events while they keep coming less than `windowSeconds` apart. */
export interface Limit {
  windowSeconds: number;
  max: number;
}

/**
 * The limits of S01 rule 8 and the password reset (rule 6), kept in `rate_limits` so they hold
 * across API processes. Better Auth limits its own routes per IP in the same table; these keys
 * start with `mizan:`.
 */
export const LIMITS = {
  /** Failed sign-ins per email: the tenth locks the email for 15 minutes. */
  signInFailures: { windowSeconds: 15 * 60, max: 10 },
  /** Reset requests per address. */
  passwordResets: { windowSeconds: 60 * 60, max: 3 },
  /** Attempts per IP on the other public and code-checking routes, as on sign-in. */
  perIpPerMinute: { windowSeconds: 60, max: 20 },
} as const satisfies Record<string, Limit>;

/**
 * Better Auth deletes rate-limit rows older than the longest window it knows; the reset limit's
 * hour must be one of them, or its rows would be pruned early (`auth.ts` lists it as a rule).
 */
export const LONGEST_LIMIT_WINDOW_SECONDS = LIMITS.passwordResets.windowSeconds;

type Executor = Database | Transaction;

const keyOf = (name: string) => `mizan:${name}`;

/**
 * Counts one event under `name` and answers whether it is within the limit. The count starts
 * again once the window passes without an event. One statement, so concurrent requests cannot all
 * pass a stale read.
 */
export async function consumeLimit(db: Executor, name: string, limit: Limit): Promise<boolean> {
  const now = Date.now();
  const since = now - limit.windowSeconds * 1000;
  const [row] = await db
    .insert(rateLimits)
    .values({ id: uuidv7(), key: keyOf(name), count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.lastRequest} <= ${since} then 1 else ${rateLimits.count} + 1 end`,
        lastRequest: now,
        updatedAt: new Date(now),
      },
    })
    .returning({ count: rateLimits.count });
  return (row?.count ?? 1) <= limit.max;
}

/** Whether `name` reached its limit, without counting: a locked email, before checking a password. */
export async function limitReached(db: Executor, name: string, limit: Limit): Promise<boolean> {
  const since = Date.now() - limit.windowSeconds * 1000;
  const [row] = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(and(eq(rateLimits.key, keyOf(name)), gt(rateLimits.lastRequest, since)));
  return (row?.count ?? 0) >= limit.max;
}

/** Forgets the events of `name`: a successful sign-in clears its email's failures. */
export async function clearLimit(db: Executor, name: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, keyOf(name)));
}
