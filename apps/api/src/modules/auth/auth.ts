import {
  accounts,
  type Database,
  memberships,
  rateLimits,
  sessions,
  twoFactors,
  users,
  verifications,
  withCompany,
} from '@vertex-mizan/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { and, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  freshlyAuthenticated,
  keepActive,
  SESSION_LIMITS,
} from '../../core/access/session-activity.js';
import {
  type AuditActor,
  type RequestFacts,
  writeCompanyAudit,
  writePlatformAudit,
} from '../../core/audit/audit.js';
import type { Config } from '../../core/config/config.js';
import {
  clearLimit,
  consumeLimit,
  LIMITS,
  LONGEST_LIMIT_WINDOW_SECONDS,
  limitReached,
} from '../../core/limits/limits.js';
import { hashPassword, verifyDecoy, verifyPassword } from './password.js';
import { claimCode, generateBackupCodes, releaseCode, TWO_FACTOR_LOCKOUT } from './two-factor.js';

/** Injection token for the Better Auth instance. */
export const AUTH = Symbol('AUTH');

export const AUTH_BASE_PATH = '/api/auth';

/**
 * The session cookie is `__Host-mizan.session_token`: `Secure`, `HttpOnly`, `SameSite=Strict`,
 * path `/` and no domain, so no other host and no other site can send or set it (S01 "Abuse").
 */
export const COOKIE_PREFIX = '__Host-mizan';

/** The second sign-in step, whose new session counts as two-factor verified and fresh. */
const SECOND_STEP = ['/two-factor/verify-totp', '/two-factor/verify-backup-code'];

/** Better Auth routes that act on an existing session: the idle limit applies to them. */
const WITH_SESSION = ['/sign-out', '/two-factor/enable', ...SECOND_STEP];

const invalidCredentials = () =>
  new APIError('UNAUTHORIZED', {
    code: 'INVALID_CREDENTIALS',
    message: 'Wrong email or password',
  });

const failuresKey = (email: string) => `sign-in-failures:${email}`;

/** 20 attempts per IP per minute on the sign-in steps (S01 rule 8), in Better Auth's terms. */
const perIp = { window: LIMITS.perIpPerMinute.windowSeconds, max: LIMITS.perIpPerMinute.max };

/** The request facts our controller passes in the headers of the request it hands over. */
function factsOf(headers: Headers | undefined): RequestFacts {
  return {
    requestId: headers?.get('x-request-id') ?? 'unknown',
    ipAddress: headers?.get('x-forwarded-for') || null,
    userAgent: headers?.get('user-agent') || null,
  };
}

interface SecondStep {
  userId: string;
  code: string;
  /** No session yet: the second step of a sign-in, not the enrolment of a signed-in person. */
  signIn: boolean;
  /** A signed-in person verifying a new authenticator: enrolment or re-enrolment. */
  enrolling: boolean;
}

/**
 * Better Auth (ADR 0002) for the sign-in steps only: email and password, then an authenticator or
 * backup code (S01 rules 1–8). Our controller (`auth.controller.ts`) passes it the few routes the
 * spec uses, with their bodies checked; everything else answers `NOT_FOUND` there. Sessions live
 * 12 hours from sign-in and are never renewed; the idle limit is checked here and in the access
 * guard. Changes made inside Better Auth are audited in its after hook.
 */
export function createAuth(db: Database, config: Config) {
  /** What the before hook learned about a second step, for the after hook of the same request. */
  const secondSteps = new WeakMap<Request, SecondStep>();
  /** Sign-ins the before hook refused and audited itself, so the after hook does not count them. */
  const refusedEarly = new WeakSet<Request>();

  async function personActor(
    userId: string,
    sessionId: string | null,
    facts: RequestFacts,
  ): Promise<AuditActor> {
    const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    return { kind: 'person', userId, name: user?.name ?? '', sessionId, ...facts };
  }

  /** At sign-in, the person's only company becomes the active one (S01 rule 20). */
  async function enterOnlyCompany(actor: AuditActor & { kind: 'person' }): Promise<void> {
    const active = await db
      .select({ companyId: memberships.scopeCompanyId })
      .from(memberships)
      .where(and(eq(memberships.userId, actor.userId), isNull(memberships.archivedAt)));
    const [only] = active;
    if (active.length !== 1 || !only || !actor.sessionId) return;
    await db
      .update(sessions)
      .set({ activeCompanyId: only.companyId })
      .where(eq(sessions.id, actor.sessionId));
    await withCompany(db, only.companyId, (tx) =>
      writeCompanyAudit(tx, only.companyId, actor, {
        action: 'session.company_entered',
        entityType: 'session',
        entityId: actor.sessionId,
        after: { activeCompanyId: only.companyId },
      }),
    );
  }

  /** The person of a second step: the session's, or the pending sign-in's from its cookie. */
  async function secondStepUserId(
    ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
  ): Promise<{ userId: string; signIn: boolean } | null> {
    const session = await getSessionFromCtx(ctx);
    if (session) return { userId: session.user.id, signIn: false };
    const cookie = ctx.context.createAuthCookie('two_factor');
    const signed = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
    if (!signed) return null;
    const pending = await ctx.context.internalAdapter.findVerificationValue(signed);
    return pending ? { userId: pending.value, signIn: true } : null;
  }

  return betterAuth({
    appName: 'Vertex Mizan',
    baseURL: config.appUrl,
    basePath: AUTH_BASE_PATH,
    secret: config.authSecret,
    trustedOrigins: [config.appUrl],
    telemetry: { enabled: false },
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        account: accounts,
        session: sessions,
        verification: verifications,
        twoFactor: twoFactors,
        rateLimit: rateLimits,
      },
    }),
    // People are created by invitations only (S01 rule 9); passwords are Argon2id (rule 4).
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    session: {
      expiresIn: SESSION_LIMITS.absoluteSeconds,
      disableSessionRefresh: true,
      additionalFields: {
        lastActiveAt: {
          type: 'date',
          required: false,
          input: false,
          defaultValue: () => new Date(),
        },
        activeCompanyId: { type: 'string', required: false, input: false },
        twoFactorVerifiedAt: { type: 'date', required: false, input: false },
        reauthenticatedAt: { type: 'date', required: false, input: false },
      },
    },
    // Stored as hashes, like our own `invite:` and `reset:` tokens.
    verification: { storeIdentifier: 'hashed' },
    // S01 rule 8, in the database so the limits hold across processes.
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': perIp,
        '/two-factor/verify-totp': perIp,
        '/two-factor/verify-backup-code': perIp,
        '/two-factor/enable': perIp,
        // Served by our own controller; listed so Better Auth keeps rate-limit rows for an hour
        // (`LONGEST_LIMIT_WINDOW_SECONDS`) instead of pruning our reset counters early.
        '/request-password-reset': { window: LONGEST_LIMIT_WINDOW_SECONDS, max: 3 },
      },
    },
    plugins: [
      twoFactor({
        issuer: 'Vertex Mizan',
        skipVerificationOnEnable: false,
        backupCodeOptions: {
          customBackupCodesGenerate: () => generateBackupCodes(),
          storeBackupCodes: 'encrypted',
        },
        accountLockout: {
          enabled: true,
          maxFailedAttempts: TWO_FACTOR_LOCKOUT.maxFailedAttempts,
          durationSeconds: TWO_FACTOR_LOCKOUT.durationSeconds,
        },
      }),
    ],
    databaseHooks: {
      session: {
        create: {
          // Every way to a session, the second step included.
          before: async (session, context) => {
            const [user] = await db
              .select({ archivedAt: users.archivedAt })
              .from(users)
              .where(eq(users.id, session.userId));
            if (!user || user.archivedAt) throw invalidCredentials();
            const now = new Date();
            const verified = SECOND_STEP.includes(context?.path ?? '');
            return {
              data: {
                ...session,
                // Better Auth writes "" for an unknown address or agent; the columns are inet/null.
                ipAddress: session.ipAddress || null,
                userAgent: session.userAgent || null,
                lastActiveAt: now,
                ...(verified && { twoFactorVerifiedAt: now, reauthenticatedAt: now }),
              },
            };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (WITH_SESSION.includes(ctx.path)) {
          const found = await getSessionFromCtx(ctx);
          if (found) {
            const session = found.session as typeof found.session & { lastActiveAt: Date };
            if (
              !(await keepActive(db, {
                id: session.id,
                lastActiveAt: new Date(session.lastActiveAt),
              }))
            ) {
              throw new APIError('UNAUTHORIZED', {
                code: 'UNAUTHENTICATED',
                message: 'The session ended',
              });
            }
          }
        }
        const facts = factsOf(ctx.headers);

        if (ctx.path === '/sign-in/email') {
          const { email, password } = ctx.body as { email: string; password: string };
          const [user] = await db
            .select({ archivedAt: users.archivedAt })
            .from(users)
            .where(eq(users.email, email));
          // A locked or archived account answers like a wrong password, after the same work.
          if (
            (await limitReached(db, failuresKey(email), LIMITS.signInFailures)) ||
            user?.archivedAt
          ) {
            await verifyDecoy(password);
            await writePlatformAudit(db, {
              action: 'user.sign_in_failed',
              actor: { kind: 'system', ...facts },
              email,
              details: { step: 'password' },
            });
            if (ctx.request) refusedEarly.add(ctx.request);
            throw invalidCredentials();
          }
          return;
        }

        if (ctx.path === '/two-factor/enable') {
          // Re-enrolment (S01 rule 7) replaces the authenticator of a person who has one: it
          // needs a fresh code, keyed on the person and not on the row, so an abandoned
          // re-enrolment never opens it without one. The password is checked here, before the
          // old authenticator is set aside for Better Auth to replace.
          const found = await getSessionFromCtx(ctx);
          if (!found) return;
          const [person] = await db
            .select({ twoFactorEnabled: users.twoFactorEnabled })
            .from(users)
            .where(eq(users.id, found.user.id));
          if (!person?.twoFactorEnabled) return;
          const session = found.session as typeof found.session & {
            reauthenticatedAt: Date | null;
          };
          if (
            !freshlyAuthenticated(
              session.reauthenticatedAt ? new Date(session.reauthenticatedAt) : null,
            )
          ) {
            throw new APIError('FORBIDDEN', {
              code: 'REAUTHENTICATION_REQUIRED',
              message: 'Type a fresh code first',
            });
          }
          const [account] = await db
            .select({ password: accounts.password })
            .from(accounts)
            .where(and(eq(accounts.userId, found.user.id), eq(accounts.providerId, 'credential')));
          const { password } = ctx.body as { password: string };
          if (!account?.password || !(await verifyPassword({ hash: account.password, password }))) {
            throw invalidCredentials();
          }
          await db
            .update(twoFactors)
            .set({ verified: false })
            .where(eq(twoFactors.userId, found.user.id));
          return;
        }

        if (
          ctx.path === '/two-factor/verify-totp' ||
          ctx.path === '/two-factor/verify-backup-code'
        ) {
          const person = await secondStepUserId(ctx);
          if (!person || !ctx.request) return;
          const { code } = ctx.body as { code: string };
          // An authenticator code is accepted once (S01 "Code replay").
          if (
            ctx.path === '/two-factor/verify-totp' &&
            !(await claimCode(db, person.userId, code))
          ) {
            throw new APIError('UNAUTHORIZED', {
              code: 'INVALID_TWO_FACTOR_CODE',
              message: 'The code was used already',
            });
          }
          const [current] = await db
            .select({ verified: twoFactors.verified })
            .from(twoFactors)
            .where(eq(twoFactors.userId, person.userId));
          const enrolling = !person.signIn && current?.verified === false;
          secondSteps.set(ctx.request, { ...person, code, enrolling });
          return;
        }

        if (ctx.path === '/sign-out') {
          const found = await getSessionFromCtx(ctx);
          if (found) {
            await writePlatformAudit(db, {
              action: 'user.signed_out',
              actor: await personActor(found.user.id, found.session.id, facts),
            });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const failed = ctx.context.returned instanceof APIError;
        const facts = factsOf(ctx.headers);

        if (ctx.path === '/sign-in/email') {
          const { email } = ctx.body as { email: string };
          if (failed) {
            if (ctx.request && refusedEarly.has(ctx.request)) return;
            if ((ctx.context.returned as APIError).statusCode === 401) {
              await consumeLimit(db, failuresKey(email), LIMITS.signInFailures);
              await writePlatformAudit(db, {
                action: 'user.sign_in_failed',
                actor: { kind: 'system', ...facts },
                email,
                details: { step: 'password' },
              });
            }
            return;
          }
          await clearLimit(db, failuresKey(email));
          // A person not yet enrolled gets a session that reaches only enrolment (S01 rule 1).
          const created = ctx.context.newSession;
          if (created) {
            await writePlatformAudit(db, {
              action: 'user.signed_in',
              actor: await personActor(created.user.id, created.session.id, facts),
              details: { twoFactor: 'not_enrolled' },
            });
          }
          return;
        }

        if (!SECOND_STEP.includes(ctx.path) || !ctx.request) return;
        const step = secondSteps.get(ctx.request);
        if (!step) return;
        const method = ctx.path === '/two-factor/verify-totp' ? 'totp' : 'backup_code';
        if (failed) {
          if (method === 'totp') await releaseCode(db, step.userId, step.code);
          if (step.signIn) {
            await writePlatformAudit(db, {
              action: 'user.sign_in_failed',
              actor: await personActor(step.userId, null, facts),
              details: { step: 'two_factor', method },
            });
          }
          return;
        }
        const sessionId = ctx.context.newSession?.session.id ?? null;
        const actor = await personActor(step.userId, sessionId, facts);
        if (method === 'backup_code') {
          await writePlatformAudit(db, { action: 'user.backup_code_used', actor });
        }
        if (step.signIn) {
          await writePlatformAudit(db, { action: 'user.signed_in', actor, details: { method } });
          if (actor.kind === 'person') await enterOnlyCompany(actor);
        } else if (step.enrolling) {
          // The first code of a new authenticator: enrolment (or re-enrolment) took effect.
          await writePlatformAudit(db, { action: 'user.two_factor_enrolled', actor });
        }
      }),
    },
    advanced: {
      database: { generateId: () => uuidv7() },
      // Our controller passes the client address Express resolved (`trust proxy`) in this header.
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
      cookiePrefix: COOKIE_PREFIX,
      // `__Host-` requires Secure and no domain; the `__Secure-` prefix Better Auth adds is off.
      useSecureCookies: false,
      defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: 'strict', path: '/' },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
