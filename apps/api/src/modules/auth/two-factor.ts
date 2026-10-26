import { randomInt } from 'node:crypto';
import { createOTP } from '@better-auth/utils/otp';
import {
  type Database,
  type Transaction,
  twoFactors,
  users,
  verifications,
} from '@vertex-mizan/db';
import { generateRandomString, symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { and, eq, gt, lte, sql } from 'drizzle-orm';
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

/** The person's verified authenticator, or null before enrolment or after a reset. */
export async function enrolledTwoFactor(
  db: Executor,
  userId: string,
): Promise<TwoFactorRow | null> {
  const [row] = await db
    .select()
    .from(twoFactors)
    .where(and(eq(twoFactors.userId, userId), eq(twoFactors.verified, true)));
  return row ?? null;
}

/** The encrypted secret and backup codes of an authenticator, as `two_factors` holds them. */
export interface StoredAuthenticator {
  secret: string;
  backupCodes: string;
}

/** A new authenticator waits this long for its first code; the old one stays in force meanwhile. */
const WAITING_HOURS = 24;

const waitingKey = (userId: string) => `reenrol:${userId}`;

/**
 * Re-enrolment (S01 rules 3 and 7): a new authenticator and backup codes for a person who has
 * one. They wait, encrypted, in a slot of their own (a newer one replaces an older one); the
 * person's row, and so the old authenticator and codes, stay as they are until the new one's
 * first code. Answers the plain secret and codes, to show once.
 */
export async function newWaitingAuthenticator(
  db: Executor,
  userId: string,
  authSecret: string,
): Promise<{ secret: string; backupCodes: string[] }> {
  const secret = generateRandomString(32);
  const backupCodes = generateBackupCodes();
  const waiting: StoredAuthenticator = {
    secret: await symmetricEncrypt({ key: authSecret, data: secret }),
    backupCodes: await encryptBackupCodes(backupCodes, authSecret),
  };
  const row = {
    identifier: waitingKey(userId),
    value: JSON.stringify(waiting),
    expiresAt: new Date(Date.now() + WAITING_HOURS * 60 * 60 * 1000),
  };
  await db
    .insert(verifications)
    .values(row)
    .onConflictDoUpdate({
      target: verifications.identifier,
      set: { value: row.value, expiresAt: row.expiresAt },
    });
  return { secret, backupCodes };
}

/** The new authenticator waiting for its first code, if any and not expired. */
export async function waitingAuthenticator(
  db: Executor,
  userId: string,
): Promise<StoredAuthenticator | null> {
  const [row] = await db
    .select({ value: verifications.value })
    .from(verifications)
    .where(
      and(
        eq(verifications.identifier, waitingKey(userId)),
        gt(verifications.expiresAt, sql`now()`),
      ),
    );
  return row ? (JSON.parse(row.value) as StoredAuthenticator) : null;
}

/**
 * Locks the person's row for a change of their two-factor: re-enrolment, its promotion, new
 * backup codes and both resets take it first, so they run one after the other. Answers whether
 * the person has two-factor.
 */
export async function lockTwoFactorOf(tx: Transaction, userId: string): Promise<boolean> {
  const [person] = await tx
    .select({ twoFactorEnabled: users.twoFactorEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .for('update');
  return person?.twoFactorEnabled ?? false;
}

/**
 * The waiting authenticator's first code verified: in one transaction, under the person's lock,
 * the slot is consumed and the new secret and backup codes replace the person's verified
 * authenticator. False when the slot is gone or changed meanwhile (a reset, a newer re-enrolment)
 * or the person no longer has a verified authenticator to replace.
 */
export async function promoteWaitingAuthenticator(
  db: Database,
  userId: string,
  checked: StoredAuthenticator,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await lockTwoFactorOf(tx, userId))) return false;
    const [consumed] = await tx
      .delete(verifications)
      .where(
        and(
          eq(verifications.identifier, waitingKey(userId)),
          eq(verifications.value, JSON.stringify(checked)),
        ),
      )
      .returning({ id: verifications.id });
    if (!consumed) return false;
    const replaced = await tx
      .update(twoFactors)
      .set({
        secret: checked.secret,
        backupCodes: checked.backupCodes,
        verified: true,
        failedVerificationCount: 0,
        lockedUntil: null,
      })
      .where(and(eq(twoFactors.userId, userId), eq(twoFactors.verified, true)))
      .returning({ id: twoFactors.id });
    return replaced.length === 1;
  });
}

/**
 * New backup codes while a new authenticator waits (S01 rule 3: the last set shown is the one in
 * force): the waiting authenticator takes them too, so its promotion keeps them.
 */
export async function setWaitingBackupCodes(
  tx: Transaction,
  userId: string,
  encryptedBackupCodes: string,
): Promise<void> {
  const [row] = await tx
    .select({ value: verifications.value })
    .from(verifications)
    .where(eq(verifications.identifier, waitingKey(userId)));
  if (!row) return;
  const waiting = JSON.parse(row.value) as StoredAuthenticator;
  await tx
    .update(verifications)
    .set({ value: JSON.stringify({ ...waiting, backupCodes: encryptedBackupCodes }) })
    .where(eq(verifications.identifier, waitingKey(userId)));
}

/** Drops a waiting authenticator, at every two-factor reset. */
export async function dropWaitingAuthenticator(db: Executor, userId: string): Promise<void> {
  await db.delete(verifications).where(eq(verifications.identifier, waitingKey(userId)));
}

export function isLocked(row: TwoFactorRow, now = new Date()): boolean {
  return row.lockedUntil !== null && row.lockedUntil > now;
}

/** Whether `code` is the authenticator's code for this step or the next or previous one. */
export async function totpMatches(
  row: Pick<TwoFactorRow, 'secret'>,
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
