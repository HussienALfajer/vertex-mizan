/**
 * Every table, with the module that owns it, its scope and its kind, which decide the conventions
 * it is held to (ADR 0003, ADR 0005, ADR 0008).
 *
 * Scope:
 * - `company`: a company's data; `company_id`, forced RLS with the one `company_isolation`
 *   policy, and foreign keys to other company tables carry `company_id`.
 * - `platform`: data with no company scope (people, sessions, companies, memberships, API client
 *   keys, the platform audit log); no `company_id` column, reached only through its module.
 *
 * Kind:
 * - `business`: `created_at`, `updated_at`, `archived_at`; archived, never deleted.
 * - `append-only`: `created_at` only; `refuse_change()` triggers, `ENABLE ALWAYS`, refuse
 *   `UPDATE`, `DELETE` and `TRUNCATE` for every role, and the app role has `SELECT, INSERT` only
 *   (entries, lines, line dimensions, open-item movements, posting requests, rates, period events,
 *   the audit log; ADR 0005).
 * - `queue`: `created_at` and `updated_at`; rows change as they are processed (the event inbox,
 *   the outbox), their payloads never.
 * - `draft`: `created_at` and `updated_at`; documents being prepared, which can change until they
 *   are posted (ADR 0005, drafts are not ledger).
 * - `ephemeral`: `created_at` and `updated_at`, no `archived_at`; rows deleted when they expire or
 *   are used (sessions, one-time tokens, two-factor secrets, rate-limit counters; S01). Platform
 *   scope only, the one kind the app role may `DELETE` from, and no table references one by
 *   foreign key: the audit logs keep their ids without one. No company or ledger data is ever
 *   ephemeral.
 *
 * The convention test fails when a table is missing here or does not follow its scope and kind.
 * The migration guard (`scripts/migration-guard.mjs`) loads this file with Node's type stripping to
 * refuse `UPDATE`, `DELETE` and `TRUNCATE` of the append-only tables, so it imports nothing.
 */
export const tableRegistry = {
  // access (S01): Better Auth's tables, memberships and invitations.
  users: { module: 'access', scope: 'platform', kind: 'business' },
  accounts: { module: 'access', scope: 'platform', kind: 'business' },
  sessions: { module: 'access', scope: 'platform', kind: 'ephemeral' },
  verifications: { module: 'access', scope: 'platform', kind: 'ephemeral' },
  two_factors: { module: 'access', scope: 'platform', kind: 'ephemeral' },
  rate_limits: { module: 'access', scope: 'platform', kind: 'ephemeral' },
  memberships: { module: 'access', scope: 'platform', kind: 'business' },
  invitations: { module: 'access', scope: 'platform', kind: 'queue' },
  // companies (S01).
  companies: { module: 'companies', scope: 'platform', kind: 'business' },
  company_settings: { module: 'companies', scope: 'company', kind: 'business' },
  // audit (S01, ADR 0005).
  platform_audit_entries: { module: 'audit', scope: 'platform', kind: 'append-only' },
  audit_entries: { module: 'audit', scope: 'company', kind: 'append-only' },
} as const satisfies Record<string, TableInfo>;

export type TableScope = 'company' | 'platform';

export type TableKind = 'business' | 'append-only' | 'queue' | 'draft' | 'ephemeral';

export type TableInfo = { module: string; scope: TableScope; kind: TableKind };
