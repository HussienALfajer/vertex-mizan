import { createOTP } from '@better-auth/utils/otp';
import { Inject, Injectable } from '@nestjs/common';
import type { BackupCodes, TwoFactorSetup } from '@vertex-mizan/contracts';
import {
  accounts,
  type Database,
  sessions,
  twoFactors,
  users,
  verifications,
} from '@vertex-mizan/db';
import { and, eq, gt, sql } from 'drizzle-orm';
import { actorOf, type RequestAccess, type SignedInAccess } from '../../core/access/access.js';
import { freshlyAuthenticated } from '../../core/access/session-activity.js';
import { writePlatformAudit } from '../../core/audit/audit.js';
import type { Config } from '../../core/config/config.js';
import { CONFIG } from '../../core/config/config.module.js';
import { DATABASE } from '../../core/database/database.module.js';
import { queueEmail } from '../../core/email/outbox.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { linkWithToken, newLinkToken, tokenIdentifier } from '../../core/http/link-tokens.js';
import { consumeLimit, LIMITS } from '../../core/limits/limits.js';
import { TOTP_ISSUER } from './auth.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  claimCode,
  encryptBackupCodes,
  enrolledTwoFactor,
  generateBackupCodes,
  isLocked,
  lockTwoFactorOf,
  newWaitingAuthenticator,
  recordCodeFailure,
  releaseCode,
  resetCodeFailures,
  setWaitingBackupCodes,
  totpMatches,
  useBackupCode,
} from './two-factor.js';

/** A reset link is valid for one hour and used once (S01 rule 6). */
const RESET_LINK_SECONDS = 60 * 60;

/**
 * The account routes S01 adds beside Better Auth's: re-authentication for sensitive actions, new
 * backup codes, and the password reset by email (our own, so the token is stored only as
 * `reset:<sha256>` and the email leaves through the outbox in the same transaction).
 */
@Injectable()
export class AccountService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /**
   * A fresh authenticator or backup code opens the 5-minute window for sensitive actions. Wrong
   * codes count toward the lock of the second step, like at sign-in (S01 rule 8).
   */
  async reauthenticate(access: SignedInAccess, code: string): Promise<void> {
    const { person } = access;
    if (!(await consumeLimit(this.db, `reauthenticate:${person.id}`, LIMITS.perIpPerMinute))) {
      throw new CodedException('RATE_LIMITED', 'Too many attempts');
    }
    const row = await enrolledTwoFactor(this.db, person.id);
    if (!row)
      throw new CodedException('TWO_FACTOR_REQUIRED', 'Enrol two-factor authentication first');
    if (isLocked(row)) throw new CodedException('RATE_LIMITED', 'Too many wrong codes');

    const actor = actorOf(access);
    let accepted: boolean;
    if (/^\d{6}$/.test(code)) {
      // Only a claim this request made is given back: releasing a refused claim would erase the
      // mark of an earlier use and let the same code through on the next try (S01 "Code replay").
      const claimed = await claimCode(this.db, person.id, code);
      accepted = claimed && (await totpMatches(row, code, this.config.authSecret));
      if (claimed && !accepted) await releaseCode(this.db, person.id, code);
    } else {
      accepted = await this.db.transaction(async (tx) => {
        // The person's lock first, as every two-factor change takes it: the audit insert below
        // takes `FOR KEY SHARE` on the same row, so the other order could deadlock.
        await lockTwoFactorOf(tx, person.id);
        const used = await useBackupCode(tx, person.id, code, this.config.authSecret);
        if (used) await writePlatformAudit(tx, { action: 'user.backup_code_used', actor });
        return used;
      });
    }
    if (!accepted) {
      await recordCodeFailure(this.db, row);
      throw new CodedException('INVALID_TWO_FACTOR_CODE', 'Wrong or used code');
    }
    await resetCodeFailures(this.db, row);
    await this.db
      .update(sessions)
      .set({ reauthenticatedAt: new Date() })
      .where(eq(sessions.id, access.session.id));
  }

  /**
   * `POST /api/auth/two-factor/enable` for a person who has an authenticator (S01 rule 7): a
   * fresh code and the password, then a new authenticator that waits for its first code (checked
   * at `verify-totp`); the old one and its backup codes stay in force until then.
   */
  async startReenrolment(access: SignedInAccess, password: string): Promise<TwoFactorSetup> {
    const { person } = access;
    if (!freshlyAuthenticated(access.session.reauthenticatedAt)) {
      throw new CodedException('REAUTHENTICATION_REQUIRED', 'Type a fresh code first');
    }
    if (!(await consumeLimit(this.db, `reenrol:${person.id}`, LIMITS.perIpPerMinute))) {
      throw new CodedException('RATE_LIMITED', 'Too many attempts');
    }
    const [account] = await this.db
      .select({ password: accounts.password })
      .from(accounts)
      .where(and(eq(accounts.userId, person.id), eq(accounts.providerId, 'credential')));
    if (!account?.password || !(await verifyPassword({ hash: account.password, password }))) {
      throw new CodedException('INVALID_CREDENTIALS', 'Wrong password');
    }
    // Under the person's lock, re-checked: a reset that ran meanwhile wins, and no authenticator
    // waits for a person without one (S01 rule 21).
    const fresh = await this.db.transaction(async (tx) => {
      const enrolled = await lockTwoFactorOf(tx, person.id);
      const [session] = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.id, access.session.id));
      if (!enrolled || !session || !(await enrolledTwoFactor(tx, person.id))) {
        throw new CodedException('TWO_FACTOR_REQUIRED', 'Enrol two-factor authentication first');
      }
      return newWaitingAuthenticator(tx, person.id, this.config.authSecret);
    });
    return {
      totpURI: createOTP(fresh.secret, { digits: 6, period: 30 }).url(TOTP_ISSUER, person.email),
      backupCodes: fresh.backupCodes,
    };
  }

  /** Ten new backup codes, shown once; the old set is void (S01 rule 3). */
  async regenerateBackupCodes(access: SignedInAccess): Promise<BackupCodes> {
    const backupCodes = generateBackupCodes();
    const encrypted = await encryptBackupCodes(backupCodes, this.config.authSecret);
    await this.db.transaction(async (tx) => {
      await lockTwoFactorOf(tx, access.person.id);
      await setWaitingBackupCodes(tx, access.person.id, encrypted);
      const updated = await tx
        .update(twoFactors)
        .set({ backupCodes: encrypted })
        .where(and(eq(twoFactors.userId, access.person.id), eq(twoFactors.verified, true)))
        .returning({ id: twoFactors.id });
      if (updated.length === 0) {
        throw new CodedException('TWO_FACTOR_REQUIRED', 'Enrol two-factor authentication first');
      }
      await writePlatformAudit(tx, {
        action: 'user.backup_codes_regenerated',
        actor: actorOf(access),
      });
    });
    return { backupCodes };
  }

  /**
   * Emails a reset link to a known, active address; the answer is the same either way (S01 rule
   * 6). At most 3 requests per address per hour, and the per-IP limit of the public routes.
   */
  async requestPasswordReset(access: RequestAccess, email: string): Promise<void> {
    await this.limitPerIp(access, 'password-reset');
    if (!(await consumeLimit(this.db, `password-reset:${email}`, LIMITS.passwordResets))) {
      throw new CodedException('RATE_LIMITED', 'Too many reset requests');
    }
    const [user] = await this.db
      .select({ id: users.id, name: users.name, archivedAt: users.archivedAt })
      .from(users)
      .where(eq(users.email, email));
    const facts = {
      requestId: access.requestId,
      ipAddress: access.ipAddress,
      userAgent: access.userAgent,
    };
    await this.db.transaction(async (tx) => {
      if (!user || user.archivedAt) {
        await writePlatformAudit(tx, {
          action: 'user.password_reset_requested',
          actor: { kind: 'system', ...facts },
          email,
          details: { known: false },
        });
        return;
      }
      const token = newLinkToken();
      const expiresAt = new Date(Date.now() + RESET_LINK_SECONDS * 1000);
      await tx.insert(verifications).values({
        identifier: tokenIdentifier('reset', token),
        value: user.id,
        expiresAt,
      });
      await queueEmail(tx, 'password_reset', email, {
        link: linkWithToken(this.config.appUrl, '/reset-password', token),
        expiresAt: expiresAt.toISOString(),
      });
      await writePlatformAudit(tx, {
        action: 'user.password_reset_requested',
        actor: { kind: 'person', userId: user.id, name: user.name, sessionId: null, ...facts },
        email,
      });
    });
  }

  /**
   * Sets a new password from a reset link: the token is used once (deleted), and every session
   * of the person ends. Two-factor is not bypassed: the next sign-in asks for a code (rule 6).
   */
  async resetPassword(access: RequestAccess, token: string, password: string): Promise<void> {
    await this.limitPerIp(access, 'reset-password');
    const hash = await hashPassword(password);
    await this.db.transaction(async (tx) => {
      const [used] = await tx
        .delete(verifications)
        .where(
          and(
            eq(verifications.identifier, tokenIdentifier('reset', token)),
            gt(verifications.expiresAt, sql`now()`),
          ),
        )
        .returning({ userId: verifications.value });
      const [user] = used
        ? await tx
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              archivedAt: users.archivedAt,
            })
            .from(users)
            .where(eq(users.id, used.userId))
        : [];
      if (!user || user.archivedAt)
        throw new CodedException('LINK_INVALID', 'The link is expired or used');
      if (password.toLowerCase() === user.email) {
        throw new CodedException('VALIDATION_FAILED', 'The password equals the email', [
          { path: ['password'], message: 'The password must not be the email' },
        ]);
      }
      await tx
        .update(accounts)
        .set({ password: hash })
        .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, 'credential')));
      await tx.delete(sessions).where(eq(sessions.userId, user.id));
      await writePlatformAudit(tx, {
        action: 'user.password_changed',
        actor: {
          kind: 'person',
          userId: user.id,
          name: user.name,
          sessionId: null,
          requestId: access.requestId,
          ipAddress: access.ipAddress,
          userAgent: access.userAgent,
        },
        details: { via: 'reset_link' },
      });
    });
  }

  private async limitPerIp(access: RequestAccess, route: string): Promise<void> {
    const key = `${route}:${access.ipAddress ?? 'unknown'}`;
    if (!(await consumeLimit(this.db, key, LIMITS.perIpPerMinute))) {
      throw new CodedException('RATE_LIMITED', 'Too many attempts');
    }
  }
}
