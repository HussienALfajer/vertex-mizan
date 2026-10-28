import { z } from 'zod';

/**
 * The actions of the platform audit log (`platform_audit_entries`): sign-in and account events,
 * and the server commands. `<entity>.<verb>`; a value is never renamed once written.
 */
export const PLATFORM_AUDIT_ACTIONS = [
  'user.signed_in',
  'user.sign_in_failed',
  'user.signed_out',
  'user.password_reset_requested',
  'user.password_changed',
  'user.two_factor_enrolled',
  'user.backup_code_used',
  'user.backup_codes_regenerated',
  'company.created',
  'user.two_factor_reset',
  'user.other_sessions_revoked',
] as const;

export const platformAuditActionSchema = z
  .enum(PLATFORM_AUDIT_ACTIONS)
  .meta({ id: 'PlatformAuditAction' });

export type PlatformAuditAction = z.infer<typeof platformAuditActionSchema>;

/**
 * The actions of a company's audit log (`audit_entries`, ADR 0005). Later specs append theirs
 * (`export.*`, `integrity.checked`, every business change).
 */
export const COMPANY_AUDIT_ACTIONS = [
  'company.updated',
  'company.ledgers_updated',
  'company.policy_note_updated',
  'company.archived',
  'company.restored',
  'invitation.created',
  'invitation.revoked',
  'invitation.accepted',
  'membership.created',
  'membership.updated',
  'membership.removed',
  'membership.left',
  'membership.two_factor_reset',
  'session.company_entered',
  'audit.viewed',
  // S02: the chart of accounts, dimensions and rates.
  'account.created',
  'account.updated',
  'account.blocked',
  'account.unblocked',
  'account.archived',
  'account.restored',
  'chart.template_applied',
  'account_role.set',
  'dimension_type.created',
  'dimension_type.updated',
  'dimension_type.archived',
  'dimension_type.restored',
  'dimension_value.created',
  'dimension_value.updated',
  'dimension_value.linked',
  'dimension_value.archived',
  'dimension_value.restored',
  'rate_pair.created',
  'rate.recorded',
  'rate.corrected',
  'rate_calendar.updated',
  'bulletin_holiday.added',
  'bulletin_holiday.removed',
  'export.chart',
  // S03: journal entries; a reversal is its own `entry.posted`, with `reverses` in its details.
  'entry.posted',
] as const;

export const companyAuditActionSchema = z
  .enum(COMPANY_AUDIT_ACTIONS)
  .meta({ id: 'CompanyAuditAction' });

export type CompanyAuditAction = z.infer<typeof companyAuditActionSchema>;

/** Who did it: a person, an API client (S05) or the system. */
export const ACTOR_KINDS = ['person', 'api_client', 'system'] as const;

export const actorKindSchema = z.enum(ACTOR_KINDS).meta({ id: 'ActorKind' });

export type ActorKind = z.infer<typeof actorKindSchema>;

/** The changed fields of an entity, before or after; never a secret. */
const changedFieldsSchema = z.record(z.string(), z.unknown()).nullable();

/** One row of the company audit log (`GET /api/audit`). */
export const auditEntrySchema = z
  .object({
    id: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
    actorKind: actorKindSchema,
    actorUserId: z.uuid().nullable(),
    actorName: z.string(),
    action: companyAuditActionSchema,
    entityType: z.string(),
    entityId: z.uuid().nullable(),
    reason: z.string().nullable(),
    before: changedFieldsSchema,
    after: changedFieldsSchema,
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    requestId: z.string(),
  })
  .meta({ id: 'AuditEntry' });

export type AuditEntry = z.infer<typeof auditEntrySchema>;

/** An opaque position in a page of entries, returned as `nextCursor`. */
export const cursorSchema = z.string().min(1).max(200).meta({ id: 'Cursor' });

/** A page request with only a cursor (`GET /api/me/sign-ins`). */
export const pageQuerySchema = z
  .object({ cursor: cursorSchema.optional() })
  .meta({ id: 'PageQuery' });

export type PageQuery = z.infer<typeof pageQuerySchema>;

/** `GET /api/audit` filters; pages of 100 by `(created_at, id)`, newest first. */
export const auditQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    actorUserId: z.uuid().optional(),
    action: companyAuditActionSchema.optional(),
    entityType: z.string().min(1).max(100).optional(),
    entityId: z.uuid().optional(),
    cursor: cursorSchema.optional(),
  })
  .meta({ id: 'AuditQuery' });

export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const auditPageSchema = z
  .object({ entries: z.array(auditEntrySchema), nextCursor: cursorSchema.nullable() })
  .meta({ id: 'AuditPage' });

export type AuditPage = z.infer<typeof auditPageSchema>;

/** One of the person's own sign-in events (`GET /api/me/sign-ins`). */
export const signInEventSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
    action: platformAuditActionSchema,
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
  })
  .meta({ id: 'SignInEvent' });

export type SignInEvent = z.infer<typeof signInEventSchema>;

export const signInPageSchema = z
  .object({ entries: z.array(signInEventSchema), nextCursor: cursorSchema.nullable() })
  .meta({ id: 'SignInPage' });

export type SignInPage = z.infer<typeof signInPageSchema>;
