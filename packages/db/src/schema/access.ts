import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  inet,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, id, idIsUuidV7, timestamptz, updatedAt } from './columns.js';
import { companies } from './companies.js';

// The access module (S01): Better Auth's tables (ADR 0002), memberships and invitations. Every
// table here is a platform table. Property names of Better Auth's tables are the field names its
// Drizzle adapter expects; Better Auth makes the ids through the API's UUIDv7 generator. A platform
// table that points at a company names the column `scope_company_id` (`company_id` means company
// scope to the convention test).

/** The roles of `ROLES` in `@vertex-mizan/contracts`, never renamed (the migration guard). */
export const membershipRole = pgEnum('membership_role', [
  'owner',
  'accountant',
  'approver',
  'viewer',
  'auditor',
]);

/** A person: one login, many companies. Archived, never deleted; email stored lower-case. */
export const users = pgTable(
  'users',
  {
    id: id(),
    email: text().notNull(),
    name: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    /** Better Auth's profile image: unused, kept empty. */
    image: text(),
    /** Set by the two-factor plugin once the first code is verified. */
    twoFactorEnabled: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('users', t.id),
    uniqueIndex('users_email_key').on(sql`lower(${t.email})`),
    check(
      'users_email_shape',
      sql`${t.email} = lower(${t.email}) and char_length(${t.email}) <= 254`,
    ),
    check('users_name_length', sql`char_length(${t.name}) between 1 and 120`),
    check('users_image_unused', sql`${t.image} is null`),
  ],
);

/**
 * Better Auth's sign-in methods; phase 1 has the `credential` provider only (an Argon2id PHC
 * string in `password`), so the OAuth columns Better Auth knows stay empty.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    providerId: text().notNull(),
    accountId: text().notNull(),
    password: text(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamptz(),
    refreshTokenExpiresAt: timestamptz(),
    scope: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('accounts', t.id),
    uniqueIndex('accounts_provider_account_key').on(t.providerId, t.accountId),
    index('accounts_user_id_idx').on(t.userId),
    check(
      'accounts_credential_only',
      sql`${t.providerId} = 'credential' and ${t.password} is not null
        and ${t.accessToken} is null and ${t.refreshToken} is null and ${t.idToken} is null
        and ${t.accessTokenExpiresAt} is null and ${t.refreshTokenExpiresAt} is null
        and ${t.scope} is null`,
    ),
  ],
);

/**
 * A signed-in browser (ephemeral: deleted when it ends or expires). The active company is chosen
 * at sign-in or with the switcher; the two timestamps record the second sign-in step and the last
 * re-authentication for sensitive actions (S01 rules 1, 20, "Rules of the guard").
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    token: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    expiresAt: timestamptz().notNull(),
    lastActiveAt: timestamptz().notNull().defaultNow(),
    ipAddress: inet(),
    userAgent: text(),
    activeCompanyId: uuid().references((): AnyPgColumn => companies.id),
    twoFactorVerifiedAt: timestamptz(),
    reauthenticatedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('sessions', t.id),
    uniqueIndex('sessions_token_key').on(t.token),
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_active_company_id_idx').on(t.activeCompanyId),
  ],
);

/**
 * One-time tokens (ephemeral): `identifier` is the purpose and the token's SHA-256
 * (`invite:<hash>`, `reset:<hash>`), so the token itself is never stored.
 */
export const verifications = pgTable(
  'verifications',
  {
    id: id(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamptz().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('verifications', t.id),
    uniqueIndex('verifications_identifier_key').on(t.identifier),
  ],
);

/**
 * A person's authenticator secret and backup codes, encrypted by the two-factor plugin with
 * `AUTH_SECRET` (ephemeral: deleted by a two-factor reset). Five wrong codes lock the second step
 * until `locked_until` (S01 rule 8).
 */
export const twoFactors = pgTable(
  'two_factors',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    /** False until the first code proves the authenticator works (enrolment). */
    verified: boolean().notNull().default(false),
    failedVerificationCount: integer().notNull().default(0),
    lockedUntil: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('two_factors', t.id),
    uniqueIndex('two_factors_user_id_key').on(t.userId),
    check('two_factors_failures_not_negative', sql`${t.failedVerificationCount} >= 0`),
  ],
);

/** Better Auth's database rate-limit store (ephemeral), so the limits hold across processes. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    id: id(),
    key: text().notNull(),
    count: integer().notNull(),
    /** Milliseconds since the epoch, as Better Auth writes it. */
    lastRequest: bigint({ mode: 'number' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [idIsUuidV7('rate_limits', t.id), uniqueIndex('rate_limits_key_key').on(t.key)],
);

/**
 * A person's role in a company: one active membership per person and company. Removing or leaving
 * archives it with a reason; a later invitation adds a new row (S01 rules 14–18).
 */
export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    scopeCompanyId: uuid()
      .notNull()
      .references((): AnyPgColumn => companies.id),
    role: membershipRole().notNull(),
    canClosePeriods: boolean().notNull().default(false),
    /** Null for the first owner, invited by the server command. */
    invitedByUserId: uuid().references(() => users.id),
    archivedReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('memberships', t.id),
    uniqueIndex('memberships_active_key')
      .on(t.userId, t.scopeCompanyId)
      .where(sql`${t.archivedAt} is null`),
    index('memberships_user_id_idx').on(t.userId),
    index('memberships_scope_company_id_idx').on(t.scopeCompanyId),
    index('memberships_invited_by_user_id_idx').on(t.invitedByUserId),
    check(
      'memberships_period_permission_accountant_only',
      sql`not ${t.canClosePeriods} or ${t.role} = 'accountant'`,
    ),
    check(
      'memberships_archived_with_reason',
      sql`(${t.archivedAt} is null) = (${t.archivedReason} is null)
        and (${t.archivedReason} is null or char_length(${t.archivedReason}) between 1 and 1000)`,
    ),
  ],
);

/**
 * An emailed invitation to a company (a queue: pending, then accepted or revoked; expired ones
 * are marked by the daily clean-up). The token travels in the link's fragment; only its hash is
 * kept, as `verification_identifier` (S01 rule 15).
 */
export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    scopeCompanyId: uuid()
      .notNull()
      .references((): AnyPgColumn => companies.id),
    email: text().notNull(),
    role: membershipRole().notNull(),
    canClosePeriods: boolean().notNull().default(false),
    invitedByUserId: uuid()
      .notNull()
      .references(() => users.id),
    verificationIdentifier: text().notNull(),
    expiresAt: timestamptz().notNull(),
    acceptedAt: timestamptz(),
    acceptedByUserId: uuid().references(() => users.id),
    revokedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('invitations', t.id),
    uniqueIndex('invitations_pending_key')
      .on(t.scopeCompanyId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
    uniqueIndex('invitations_verification_identifier_key').on(t.verificationIdentifier),
    index('invitations_scope_company_id_idx').on(t.scopeCompanyId),
    index('invitations_invited_by_user_id_idx').on(t.invitedByUserId),
    index('invitations_accepted_by_user_id_idx').on(t.acceptedByUserId),
    check(
      'invitations_email_shape',
      sql`${t.email} = lower(${t.email}) and char_length(${t.email}) <= 254`,
    ),
    check(
      'invitations_period_permission_accountant_only',
      sql`not ${t.canClosePeriods} or ${t.role} = 'accountant'`,
    ),
    check(
      'invitations_accepted_by_someone',
      sql`(${t.acceptedAt} is null) = (${t.acceptedByUserId} is null)`,
    ),
    check(
      'invitations_accepted_or_revoked',
      sql`${t.acceptedAt} is null or ${t.revokedAt} is null`,
    ),
  ],
);
