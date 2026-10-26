import { sql } from 'drizzle-orm';
import { check, index, inet, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { users } from './access.js';
import { companyId, createdAt, id, idIsUuidV7 } from './columns.js';
import { companies } from './companies.js';

// The audit module (S01, ADR 0005 invariant 10): two append-only logs. The platform log holds
// sign-in and account events and the server commands; each company's log holds every change to
// its data, written in the same transaction as the change, and the reads S01 rule 24 names. Ids of
// ephemeral rows (sessions) are kept without a foreign key. `before` and `after` hold the changed
// fields only, never a password, token, secret, backup code or hash. Kept at least 10 years
// (Income Tax Law 24/2003 art. 124, CONFIRMED).

const ACTION_SHAPE = `'^[a-z]+(_[a-z]+)*\\.[a-z]+(_[a-z]+)*$'`;

/** The platform audit log: no company scope; `created_at` is the time of the event. */
export const platformAuditEntries = pgTable(
  'platform_audit_entries',
  {
    id: id(),
    createdAt: createdAt(),
    actorKind: text().notNull(),
    actorUserId: uuid().references(() => users.id),
    subjectCompanyId: uuid().references(() => companies.id),
    action: text().notNull(),
    /** The address typed on a failed sign-in or reset request, lower-case. */
    email: text(),
    sessionId: uuid(),
    requestId: text().notNull(),
    ipAddress: inet(),
    userAgent: text(),
    details: jsonb(),
  },
  (t) => [
    idIsUuidV7('platform_audit_entries', t.id),
    index('platform_audit_entries_actor_idx').on(t.actorUserId, t.createdAt),
    index('platform_audit_entries_subject_company_idx').on(t.subjectCompanyId, t.createdAt),
    index('platform_audit_entries_email_idx').on(t.email, t.createdAt),
    check(
      'platform_audit_entries_actor',
      // A person is unknown on a failed sign-in or a reset request for an unknown email.
      sql`${t.actorKind} = 'person' or (${t.actorKind} = 'system' and ${t.actorUserId} is null)`,
    ),
    check('platform_audit_entries_action_shape', sql`${t.action} ~ ${sql.raw(ACTION_SHAPE)}`),
    check(
      'platform_audit_entries_email_shape',
      sql`${t.email} is null or (${t.email} = lower(${t.email}) and char_length(${t.email}) <= 254)`,
    ),
  ],
);

/**
 * A company's audit log (company scope, forced RLS). `actor_name` is the name as it was;
 * `actor_user_id` and `actor_api_client_id` (S05) are platform ids kept without a foreign key.
 */
export const auditEntries = pgTable(
  'audit_entries',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    createdAt: createdAt(),
    actorKind: text().notNull(),
    actorUserId: uuid(),
    actorApiClientId: uuid(),
    actorName: text().notNull(),
    sessionId: uuid(),
    requestId: text().notNull(),
    ipAddress: inet(),
    userAgent: text(),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    reason: text(),
    before: jsonb(),
    after: jsonb(),
  },
  (t) => [
    idIsUuidV7('audit_entries', t.id),
    index('audit_entries_company_created_idx').on(t.companyId, t.createdAt),
    index('audit_entries_company_entity_idx').on(t.companyId, t.entityType, t.entityId),
    index('audit_entries_company_actor_idx').on(t.companyId, t.actorUserId, t.createdAt),
    check(
      'audit_entries_actor',
      sql`(${t.actorKind} = 'person' and ${t.actorUserId} is not null and ${t.actorApiClientId} is null)
        or (${t.actorKind} = 'api_client' and ${t.actorApiClientId} is not null and ${t.actorUserId} is null)
        or (${t.actorKind} = 'system' and ${t.actorUserId} is null and ${t.actorApiClientId} is null)`,
    ),
    check('audit_entries_action_shape', sql`${t.action} ~ ${sql.raw(ACTION_SHAPE)}`),
    check('audit_entries_actor_name_length', sql`char_length(${t.actorName}) between 1 and 200`),
  ],
);
