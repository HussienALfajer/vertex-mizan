import { randomInt } from 'node:crypto';
import { createOTP } from '@better-auth/utils/otp';
import {
  type Database,
  type Transaction,
  twoFactors,
  users,
  verifications,
} from '@vertex-mizan/db';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { and, eq, lte, sql } from 'drizzle-orm';
import { tokenIdentifier } from '../../core/http/link-tokens.js';

/** Five wrong codes lock the second step for 15 minutes (S01 rule 8). */
export const TWO_FACTOR_LOCKOUT = { maxFailedAttempts: 5, durationSeconds: 15 * 60 } as const;

/** A used authenticator code is refused while it could still be valid: its step ±1 (90 s). */
const CODE_REUSE_WINDOW_MS = 90_000;

/**
 * Backup codes are written down by hand: lowercase letters and digits without look-alikes
 * (i, l, o, 0, 1), `xxxxx-xxxxx`, about 49 bits each, behind the sign-in limits. Hub's format.
 */
const BACKUP_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateBackupCodes(amount = 10): string[] {
  const part = () =>
    Array.from(
      { length: 5 },
      () => BACKUP_CODE_ALPHABET[randomInt(BACKUP_CODE_ALPHABET.length)],
    ).join('');
  return Array.from({ length: amount }, () => `${part()}-${part()}`);
}

/** Backup codes as the two-factor plugin stores them: a JSON list encrypted with the secret. */
export async function encryptBackupCodes(codes: string[], secret: string): Promise<string> {
  return symmetricEncrypt({ key: secret, data: JSON.stringify(codes) });
}

type Executor = Database | Transaction;

export type TwoFactorRow = typeof twoFactors.$inferSelect;

/**
 * The authenticator of a person who has enrolled, or null before enrolment or after a reset. A
 * re-enrolment in progress counts: its new authenticator and backup codes are the person's now.
 */
export async function enrolledTwoFactor(
  db: Executor,
  userId: string,
): Promise<TwoFactorRow | null> {
  const [row] = await db
    .select({ twoFactor: twoFactors })
    .from(twoFactors)
    .innerJoin(users, eq(users.id, twoFactors.userId))
    .where(and(eq(twoFactors.userId, userId), eq(users.twoFactorEnabled, true)));
  return row?.twoFactor ?? null;
}

export function isLocked(row: TwoFactorRow, now = new Date()): boolean {
  return row.lockedUntil !== null && row.lockedUntil > now;
}

/** Whether `code` is the authenticator's code for this step or the next or previous one. */
export async function totpMatches(
  row: TwoFactorRow,
  code: string,
  secret: string,
): Promise<boolean> {
  const plain = await symmetricDecrypt({ key: secret, data: row.secret });
  return createOTP(plain, { digits: 6, period: 30 }).verify(code);
}

/**
 * Uses a backup code: the row is locked and the code removed from the stored list in `tx`, so two
 * requests with the same code cannot both pass (S01 "Code replay").
 */
export async function useBackupCode(
  tx: Transaction,
  userId: string,
  code: string,
  secret: string,
): Promise<boolean> {
  const [row] = await tx
    .select()
    .from(twoFactors)
    .where(eq(twoFactors.userId, userId))
    .for('update');
  if (!row) return false;
  const codes = JSON.parse(
    await symmetricDecrypt({ key: secret, data: row.backupCodes }),
  ) as string[];
  if (!codes.includes(code)) return false;
  await tx
    .update(twoFactors)
    .set({
      backupCodes: await encryptBackupCodes(
        codes.filter((kept) => kept !== code),
        secret,
      ),
    })
    .where(eq(twoFactors.id, row.id));
  return true;
}

/**
 * Claims an authenticator code for a person, so it is accepted once (S01 "Code replay"): the
 * claim is a one-time row keyed by the hash of the person and the code, refused while an earlier
 * claim of the same code lives. Answers false for a code already used.
 */
export async function claimCode(db: Executor, userId: string, code: string): Promise<boolean> {
  const identifier = tokenIdentifier('totp-used', `${userId}:${code}`);
  await db
    .delete(verifications)
    .where(and(eq(verifications.identifier, identifier), lte(verifications.expiresAt, sql`now()`)));
  const claimed = await db
    .insert(verifications)
    .values({
      identifier,
      value: userId,
      expiresAt: new Date(Date.now() + CODE_REUSE_WINDOW_MS),
    })
    .onConflictDoNothing({ target: verifications.identifier })
    .returning({ id: verifications.id });
  return claimed.length === 1;
}

/** Gives a claimed code back when its check failed for another reason, so it can be typed again. */
export async function releaseCode(db: Executor, userId: string, code: string): Promise<void> {
  await db
    .delete(verifications)
    .where(eq(verifications.identifier, tokenIdentifier('totp-used', `${userId}:${code}`)));
}

/** Counts a wrong code; the fifth locks the second step (`locked_until`). */
export async function recordCodeFailure(db: Executor, row: TwoFactorRow): Promise<void> {
  await db
    .update(twoFactors)
    .set({
      failedVerificationCount: sql`${twoFactors.failedVerificationCount} + 1`,
      lockedUntil: sql`case when ${twoFactors.failedVerificationCount} + 1 >= ${TWO_FACTOR_LOCKOUT.maxFailedAttempts}
        then now() + make_interval(secs => ${TWO_FACTOR_LOCKOUT.durationSeconds}) else ${twoFactors.lockedUntil} end`,
    })
    .where(eq(twoFactors.id, row.id));
}

export async function resetCodeFailures(db: Executor, row: TwoFactorRow): Promise<void> {
  await db
    .update(twoFactors)
    .set({ failedVerificationCount: 0, lockedUntil: null })
    .where(eq(twoFactors.id, row.id));
}
