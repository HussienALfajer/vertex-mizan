import { type Database, sessions } from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';

/** Session lifetimes and the re-authentication window (S01 rule 5, "Rules of the guard"). */
export const SESSION_LIMITS = {
  /** A session ends after 30 minutes without a request. */
  idleSeconds: 30 * 60,
  /** And 12 hours after sign-in, whatever its activity: Better Auth's `expiresIn`, never renewed. */
  absoluteSeconds: 12 * 60 * 60,
  /** A sensitive action needs an authenticator or backup code typed within the last 5 minutes. */
  reauthenticationSeconds: 5 * 60,
} as const;

/** Activity is written at most once a minute, so a busy page does not write on every request. */
const TOUCH_AFTER_MS = 60_000;

/**
 * Checks a session's idle limit on a request: an idle session is deleted and answers false; an
 * active one has its last activity moved forward and answers true.
 */
export async function keepActive(
  db: Database,
  session: { id: string; lastActiveAt: Date },
  now = new Date(),
): Promise<boolean> {
  const idleFor = now.getTime() - session.lastActiveAt.getTime();
  if (idleFor >= SESSION_LIMITS.idleSeconds * 1000) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    return false;
  }
  if (idleFor >= TOUCH_AFTER_MS) {
    await db.update(sessions).set({ lastActiveAt: now }).where(eq(sessions.id, session.id));
  }
  return true;
}

/** Whether the session's last code was typed within the re-authentication window. */
export function freshlyAuthenticated(reauthenticatedAt: Date | null, now = new Date()): boolean {
  return (
    reauthenticatedAt !== null &&
    now.getTime() - reauthenticatedAt.getTime() < SESSION_LIMITS.reauthenticationSeconds * 1000
  );
}
