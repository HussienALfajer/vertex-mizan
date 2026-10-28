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
 * - `ledger-state`: `created_at` and `updated_at`, no `archived_at`; rows that summarise the
 *   append-only ledger and change only as it grows (the ledger head, the entry-number counters, the
 *   periods, the period balances; ADR 0012). The app role has `SELECT, INSERT, UPDATE`, never
 *   `DELETE`; `refuse_delete()` triggers refuse `DELETE` and `TRUNCATE` for every role, and a pinned
 *   guard trigger before `INSERT` and `UPDATE` allows only the change an append makes.
 * - `ephemeral`: `created_at` and `updated_at`, no `archived_at`; rows deleted when they expire or
 *   are used or sent (sessions, one-time tokens, two-factor secrets, rate-limit counters, the email
 *   outbox; S01). Platform
 *   scope only, the one kind the app role may `DELETE` from, and no table references one by
 *   foreign key: the audit logs keep their ids without one. No company or ledger data is ever
 *   ephemeral.
 *
 * The convention test fails when a table is missing here or does not follow its scope and kind.
 * The migration guard (`scripts/migration-guard.mjs`) loads this file with Node's type stripping to
 * refuse `UPDATE`, `DELETE` and `TRUNCATE` of the append-only tables and `DELETE` and `TRUNCATE` of
 * the ledger-state tables, so it imports nothing.
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
  // email (S01): the outbox the worker sends and deletes.
  email_outbox: { module: 'email', scope: 'platform', kind: 'ephemeral' },
  // chart (S02): the chart of accounts, required dimensions and account roles.
  chart_accounts: { module: 'chart', scope: 'company', kind: 'business' },
  account_required_dimensions: { module: 'chart', scope: 'company', kind: 'business' },
  account_roles: { module: 'chart', scope: 'company', kind: 'business' },
  // dimensions (S02).
  dimension_types: { module: 'dimensions', scope: 'company', kind: 'business' },
  dimension_values: { module: 'dimensions', scope: 'company', kind: 'business' },
  // rates (S02, ADR 0007): the rate table is append-only; a correction is a newer row.
  rate_pairs: { module: 'rates', scope: 'company', kind: 'business' },
  exchange_rates: { module: 'rates', scope: 'company', kind: 'append-only' },
  bulletin_holidays: { module: 'rates', scope: 'company', kind: 'business' },
  // ledger (S03, ADR 0005, ADR 0012): the append-only ledger, written by `post()` only, and the
  // ledger state it keeps.
  posting_requests: { module: 'ledger', scope: 'company', kind: 'append-only' },
  journal_entries: { module: 'ledger', scope: 'company', kind: 'append-only' },
  journal_lines: { module: 'ledger', scope: 'company', kind: 'append-only' },
  line_conversions: { module: 'ledger', scope: 'company', kind: 'append-only' },
  dimension_sets: { module: 'ledger', scope: 'company', kind: 'append-only' },
  dimension_set_values: { module: 'ledger', scope: 'company', kind: 'append-only' },
  ledger_heads: { module: 'ledger', scope: 'company', kind: 'ledger-state' },
  entry_number_counters: { module: 'ledger', scope: 'company', kind: 'ledger-state' },
  periods: { module: 'ledger', scope: 'company', kind: 'ledger-state' },
  period_balances: { module: 'ledger', scope: 'company', kind: 'ledger-state' },
} as const satisfies Record<string, TableInfo>;

export type TableScope = 'company' | 'platform';

export type TableKind =
  | 'business'
  | 'append-only'
  | 'ledger-state'
  | 'queue'
  | 'draft'
  | 'ephemeral';

export type TableInfo = { module: string; scope: TableScope; kind: TableKind };
