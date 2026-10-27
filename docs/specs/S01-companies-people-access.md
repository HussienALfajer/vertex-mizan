# S01 — Companies, people and access

Status: Approved (owner, 2026-10-26) · Date: 2026-10-26 · Features: `docs/product/phase-1-scope.md` F01 (§3 users and roles, §4 book and parallel currency, rate policies, fiscal year) · ADRs: 0002 (Better Auth), 0003, 0005 (audit log, retention), 0007 (ledgers and rate policies), 0008 (owner role never at runtime), 0009, 0010

## Summary
Mizan serves many companies under one login, each fully isolated. This spec delivers the people side of that: sign-in with a password and a required authenticator code, invitations by email, memberships with one role per company, a company switcher, companies with their ledger settings (book and parallel currency, a rate policy per ledger, the fiscal year start and the IAS 21 policy note), archiving, the permission map shared by the API and the web app, and the company audit log that every later feature writes to.

## In scope / out of scope
- In:
  - people (one login per person), sign-in, sign-out, password reset, two-factor authentication for every role, backup codes, re-authentication for sensitive actions;
  - companies: creation, profile, ledger settings, policy note, archive and restore; a server command that creates the first person and company (Vertex Media);
  - memberships, invitations, roles, the per-membership period permission, removal, the owner's reset of a member's two-factor;
  - the active company of a session and the switcher;
  - the permission map in `packages/contracts`, the access guard and its decorators in `apps/api`;
  - the company audit log and the platform audit log, with their screens;
  - the screens listed below, in Arabic RTL.
- Out:
  - **API clients and keys** (F10): S05, with the posting API they serve. This spec's access guard and audit model already provide for a machine actor.
  - **Module switches and document sources** (ADR 0001, ADR 0003): S05, where the posting API checks them (`SOURCE_NOT_ALLOWED`). Every optional module is off in phase 1 and nothing in S01 reads them.
  - Exporting the audit log to Excel or PDF: with the report exports (F13).
  - Public sign-up, a platform super-user, Vertex support access (phase 4, ADR 0003).
  - Changing a person's email, archiving a person, and signing in with another provider: a server command only, if ever needed in phase 1.
  - Branches and branch-scoped permissions (later).

## Access

### Roles (phase 1 scope §3)
One role per membership (owner, 2026-10-26).

| Role | Arabic | Intent (later specs grant their permissions by it) |
|---|---|---|
| `owner` | المالك | Everything in the company: settings, members, periods, posting rules, API clients |
| `accountant` | المحاسب | Accounting work: accounts, entries, rates, the inbox, revaluation; periods only with the period permission |
| `approver` | المعتمِد | Approves manual entries when approval is on (F05) |
| `viewer` | القارئ | Reads reports |
| `auditor` | المدقق | Reads everything, including the audit log and the integrity check; changes nothing |

**Period permission** (`canClosePeriods`): a switch on an accountant's membership that only an owner sets (owner, 2026-10-26). It grants `periods.close` (close and reopen), which S07 uses. It is refused on any other role (the owner has it already).

### The permission map
`packages/contracts/src/access.ts`: the permission keys, the roles, `rolePermissions` (role → keys) and `effectivePermissions(membership)` (the role's keys, plus `periods.close` for an accountant with the switch). The API guard and the web app read the same map; the web uses it only to hide what the person cannot do. Each later spec adds its keys to the map in its own PR, with the roles that hold them per the intents above. S01 adds:

| Action | Surface | Who (permission) |
|---|---|---|
| Sign in, sign out, reset own password, manage own two-factor and backup codes, read own sign-ins | Web | Any person |
| Create a company (becomes its owner) | Web | Any signed-in person with two-factor enrolled |
| Switch the active company | Web | A member of the target company |
| Read the company profile and ledger settings | Web | Every role (`company.read`) |
| Change the profile, the ledger settings, the policy note | Web | Owner (`company.settings`) |
| Archive or restore the company | Web | Owner (`company.archive`) |
| Read members and invitations | Web | Owner, auditor (`members.read`) |
| Invite, change a role or the period permission, remove a member, revoke an invitation, reset a member's two-factor | Web | Owner (`members.manage`) |
| Read the company audit log | Web | Owner, auditor (`audit.read`) |
| Close and reopen periods (used by S07) | Web | Owner; accountant with the period permission (`periods.close`) |
| Create the first person and company | Server command | Vertex, on the server |

### Rules of the guard
- A global guard in `apps/api` fails closed: every route declares exactly one access decorator — `@Public()`, `@SignedIn()` (a person, no company), or `@CompanyRoute(...permissions)` (a person in their active company). S05 adds `@ApiClientRoute(...scopes)`. An architecture test fails on a route without one.
- `@CompanyRoute` resolves the session's active company, checks the membership is active and holds every permission, and runs the handler inside `withCompany(db, activeCompanyId, …)`. The company never comes from the request.
- Sensitive actions also declare `@Reauthenticated()`: a fresh authenticator or backup code within the last 5 minutes (`REAUTHENTICATION_REQUIRED` otherwise). They are: changing ledger settings, archiving or restoring, inviting, changing a role or the period permission, removing a member, resetting a member's two-factor, regenerating one's own backup codes, changing one's password.

## Data

Better Auth (ADR 0002) owns the identity tables through its Drizzle adapter, renamed to the plural snake_case names below, with UUIDv7 ids (`advanced.database.generateId`). All its tables are platform tables. Column helpers from `packages/db/src/schema/columns.ts`; every table is registered in `registry.ts`.

### A new table kind: `ephemeral`
Sessions, one-time tokens, two-factor secrets and rate-limit counters must be deleted when they expire or are used, and Better Auth deletes them. `packages/db` forbids `DELETE` to the app role everywhere ("archive instead"). This spec adds a fifth kind, **`ephemeral`**: platform scope only, `created_at` and `updated_at`, the app role holds `SELECT, INSERT, UPDATE, DELETE`, no other table references it by foreign key, and the audit logs record its ids without a foreign key. The convention test enforces each rule; `packages/db/CLAUDE.md` and the registry's comment are updated. No company or ledger data is ever ephemeral.

### Platform tables (no `company_id`; ADR 0003)
A platform table that points at a company names the column `scope_company_id` (the audit log: `subject_company_id`), because the convention test reads `company_id` as company scope. These foreign keys are plain, since platform tables have no RLS.

| Table | Kind | Fields (all `not null` unless marked) | Keys and indexes |
|---|---|---|---|
| `users` | business | `id`, `email` (text, stored lower-case, ≤ 254), `name` (text, 1–120), `email_verified` (bool), `two_factor_enabled` (bool), `created_at`, `updated_at`, `archived_at` (null) | unique `lower(email)` |
| `accounts` | business | Better Auth's credential row: `id`, `user_id` → users, `provider_id` (`credential` only), `account_id`, `password` (Argon2id PHC string), `created_at`, `updated_at`, `archived_at` (null) | unique `(provider_id, account_id)`; index `user_id` |
| `sessions` | ephemeral | `id`, `token` (Better Auth stores the token; see Abuse), `user_id` → users, `expires_at`, `last_active_at`, `ip_address` (inet, null), `user_agent` (text, null), `active_company_id` → companies (null), `two_factor_verified_at` (null), `reauthenticated_at` (null), `created_at`, `updated_at` | unique `token`; index `user_id`; index `active_company_id` |
| `verifications` | ephemeral | `id`, `identifier` (purpose + SHA-256 of the token: `invite:<hash>`, `reset:<hash>`), `value`, `expires_at`, `created_at`, `updated_at` | unique `identifier` |
| `two_factors` | ephemeral | `id`, `user_id` → users, `secret` and `backup_codes` (encrypted by the plugin with `AUTH_SECRET`), `failed_verification_count` (int), `locked_until` (null), `created_at`, `updated_at` | unique `user_id` |
| `rate_limits` | ephemeral | Better Auth's database rate-limit store: `id`, `key`, `count`, `last_request` (bigint ms), `created_at`, `updated_at` | unique `key` |
| `companies` | business | `id`, `name` (Arabic, 1–200), `name_latin` (null, 1–200), `data_location` (text, `pool` in phase 1; the silo option of ADR 0003), `created_by_user_id` → users (null when the server command created it), `archived_reason` (null), `created_at`, `updated_at`, `archived_at` (null) | check: `archived_reason` set iff `archived_at` set |
| `memberships` | business | `id`, `user_id` → users, `scope_company_id` → companies, `role` (enum `membership_role`), `can_close_periods` (bool, default false), `invited_by_user_id` → users (null for the bootstrap owner), `archived_reason` (null), `created_at`, `updated_at`, `archived_at` (null) | unique `(user_id, scope_company_id)` where `archived_at is null`; index `scope_company_id`; check `not can_close_periods or role = 'accountant'` |
| `invitations` | queue | `id`, `scope_company_id` → companies, `email` (lower-case), `role`, `can_close_periods`, `invited_by_user_id` → users (null for the first owner's invitation, sent by the server command), `verification_identifier` (text; the token's hash key), `expires_at` (created + 7 days), `accepted_at` (null), `accepted_by_user_id` → users (null), `revoked_at` (null), `created_at`, `updated_at` | unique `(scope_company_id, email)` where pending (`accepted_at` and `revoked_at` null); index `invited_by_user_id`, `accepted_by_user_id` |
| `platform_audit_entries` | append-only | `id`, `created_at` (the time of the event), `actor_kind` (`person` · `system`), `actor_user_id` (null), `subject_company_id` (null), `action` (text, `<entity>.<verb>`), `email` (null; the address typed on a failed sign-in or reset request, lower-case), `session_id` (uuid, null, no FK), `request_id`, `ip_address` (inet, null), `user_agent` (null), `details` (jsonb, null; never a secret) | index `(actor_user_id, created_at)`, `(subject_company_id, created_at)`, `(email, created_at)` |

`membership_role` is the enum `owner`, `accountant`, `approver`, `viewer`, `auditor`. Values are never renamed (`ALTER TYPE … RENAME VALUE` is refused by the migration guard).

### Company tables (`company_id`, forced RLS, `company_isolation`)

| Table | Kind | Fields | Keys and indexes |
|---|---|---|---|
| `company_settings` | business | `id`, `company_id` (also → `companies.id`), `book_currency` (text, a currency code), `book_rate_type` (`market` · `bulletin`), `book_accepts_transaction_rate` (bool), `parallel_currency` (null), `parallel_rate_type` (null), `parallel_accepts_transaction_rate` (null), `fiscal_year_start_month` (smallint 1–12, default 1), `policy_note` (text, 1–4,000), `books_started_at` (timestamptz, null), `created_at`, `updated_at`, `archived_at` (null) | unique `company_id`; unique `(company_id, id)`; checks below |
| `audit_entries` | append-only | `id`, `company_id`, `created_at` (the time of the change, same transaction), `actor_kind` (`person` · `api_client` · `system`), `actor_user_id` (uuid, null, no FK: a platform id), `actor_api_client_id` (uuid, null, no FK; S05), `actor_name` (text; a snapshot), `session_id` (uuid, null, no FK), `request_id`, `ip_address` (inet, null), `user_agent` (null), `action` (`<entity>.<verb>`), `entity_type`, `entity_id` (uuid, null), `reason` (null), `before` (jsonb, null), `after` (jsonb, null) | index `(company_id, created_at)`, `(company_id, entity_type, entity_id)`, `(company_id, actor_user_id, created_at)` |

`company_settings` checks:
1. The currencies are codes of the money module's currency table (a check against the list, extended with the table).
2. The three parallel columns are all null or all set; `parallel_currency <> book_currency`.
3. `*_accepts_transaction_rate` only with rate type `market` (as `ratePolicySchema`).
4. **The settings lock:** a row trigger `BEFORE UPDATE` (`ENABLE ALWAYS`, pinned in `GUARDS`) refuses any change to the currency, rate-policy and fiscal-year columns, and any change of `books_started_at` once set, when the old `books_started_at` is not null. `books_started_at` is set by the posting function at the company's first posted entry (S03); S01's tests set it directly. The policy note and the timestamps stay editable. Rows are never deleted: `BEFORE DELETE` and `BEFORE TRUNCATE` triggers (`refuse_delete()`, `ENABLE ALWAYS`, pinned) refuse it for every role, so the lock cannot be undone by deleting the row and inserting it again (accountant-reviewer, PR 1).

The company's ledgers are read as `companyLedgersSchema` (ADR 0007) from these columns; the web and the API never send rates or ledgers in another shape.

The `audit_entries` table follows ADR 0005 invariant 10: the app role has `SELECT, INSERT`; `refuse_change()` refuses update, delete and truncate for every role. `before` and `after` hold the changed fields only, never a password, token, secret, backup code or hash. Retention: kept at least 10 years with the company's ledger (Income Tax Law 24/2003 art. 124, CONFIRMED); companies are archived, never deleted.

## States and rules

### People and sign-in
1. Sign-in is email and password, then a six-digit authenticator code (TOTP, RFC 6238, 30-second steps, ±1 step) or one backup code. For an enrolled person a session exists only after both steps; until then nothing but the second step answers. A person not yet enrolled gets a session that reaches only enrolment (rule 2).
2. **Two-factor is required for every role** (owner, 2026-10-26, extending scope F01 which named owner, accountant and approver). A person who has not enrolled reaches only the enrolment screen. There is no "trust this device" and no way for a person to switch two-factor off.
3. Enrolment shows a QR code and the secret as text, requires a valid code before it takes effect, then shows 10 single-use backup codes once (copy and print). Regenerating them voids the old set.
4. Passwords: 12 to 128 characters, no composition rules, not equal to the email; hashed with Argon2id (`node:crypto`, m = 19456 KiB, t = 2, p = 1, OWASP minimum) through Better Auth's custom hash.
5. **Sessions** end after 30 minutes without activity or 12 hours after sign-in, whichever comes first (owner, 2026-10-26). Sign-out ends the session; changing the password or a two-factor reset ends every session of the person.
6. **Password reset** (owner, 2026-10-26): a link emailed to the address, valid 1 hour, single use; the answer is the same whether the email exists or not; at most 3 requests per address per hour. The reset does not bypass two-factor.
7. **Lost authenticator:** a backup code signs in; the person then re-enrols. Without one, an owner of a company where the person is a member resets their two-factor (rule 21).
8. Sign-in limits, stored in the database (`rate_limits`) so they hold across processes: 20 attempts per IP per minute; 10 failures per email in 15 minutes lock that email for 15 minutes; 5 wrong authenticator codes lock the second step for 15 minutes (`locked_until`). A locked or archived account answers exactly like a wrong password, with the same hashing cost.

### Companies
9. **Creation** (owner, 2026-10-26): there is no public sign-up. The server command `pnpm --filter @vertex-mizan/api admin:create-company` creates a company and invites its first owner by email (Vertex Media and the first person). After that, any signed-in person with two-factor enrolled creates a company in the web app and becomes its owner.
10. A new company needs a name, its book currency (default SYP) with its rate policy, the optional parallel currency with its policy, the fiscal year start month (default January: Income Tax Law 24/2003, calendar year, CONFIRMED) and the policy note (the IAS 21.9–12 basis of the book currency; ADR 0007). The form pre-fills Vertex Media's shape: book SYP at `bulletin`; parallel USD at `market`, accepting the transaction's rate.
11. **The settings lock** (owner, 2026-10-26): the owner edits the currencies, rate policies and fiscal year start freely until the company's first posted entry; from then on they never change (`COMPANY_SETTINGS_LOCKED`). Basis: a change of functional currency applies prospectively under its own procedure (IAS 21.35–37), and a parallel ledger cannot be filled backwards because posted entries never change (ADR 0005). The policy note stays editable, with before and after in the audit log.
12. **Archive** (owner, 2026-10-26): an owner archives with a written reason. An archived company is read-only: every write is refused (`COMPANY_ARCHIVED`), pending invitations are revoked, and (from S05) its API keys are revoked. Members keep reading and exporting. An owner restores it with a reason; revoked keys and invitations stay revoked.
13. Companies are never deleted (ADR 0005 retention).

### Memberships and invitations
14. One person, many companies; one active membership per person and company, with one role.
15. **Invitation** (owner, 2026-10-26): an owner invites an email with a role (and the period permission for an accountant). Mizan emails a single-use link valid 7 days; the token travels in the URL fragment and only its SHA-256 is stored. Accepting:
    - a new person sets their name and password, verifies the email by the link itself, and enrols two-factor;
    - an existing person signs in (both steps) and the membership is added.

    The accepting person's email must equal the invited email. A second pending invitation for the same email and company is refused (`INVITATION_EXISTS`); an invitation for a current member is refused (`MEMBERSHIP_EXISTS`). An owner revokes a pending invitation.
16. An owner changes a member's role or period permission; a change takes effect on that member's next request.
17. An owner removes a member with a reason: the membership is archived (never deleted), and every session of that person whose active company is this one loses its active company.
18. **A company always has at least one active owner.** Removing or demoting the last owner, or the last owner leaving, is refused (`LAST_OWNER`). Any member may leave a company (archive their own membership), within this rule.
19. A person sees and switches only between companies where they hold an active membership; archived companies appear marked as archived.
20. **The active company** is stored on the session, chosen at sign-in (the only company, or the person's choice) or with the switcher. Every company request runs in it. The switch is written to the company audit log (`session.company_entered`).
21. **Two-factor reset by an owner** (owner, 2026-10-26): it removes the member's two-factor and backup codes, ends their sessions, emails them a notice, and is written to the company audit log with a reason. It is allowed only when **every** active membership of that person is in a company where the resetting owner is also an owner, so an owner of one company cannot weaken the sign-in protecting another company's books. Otherwise it is done by Vertex with the server command `admin:reset-two-factor`, written to the platform audit log.

### Writes across tabs
22. Every company write from the web carries the header `X-Mizan-Company` with the company the page was showing. The API compares it with the session's active company and refuses a mismatch (`COMPANY_SWITCHED`) without changing anything. The header is never the source of the company context, only a check, so a switch in one tab never sends another tab's form into a different company's books.

### Audit (owner, 2026-10-26)
23. Every change to company data writes one `audit_entries` row in the same transaction, with before and after values of the changed fields: company profile, settings and policy note, archive and restore, invitations, memberships, roles, the period permission, two-factor resets, and (later specs) every business change.
24. Reads written to the audit logs: successful and failed sign-ins, sign-outs, password resets, two-factor enrolment, backup-code use (platform log); entering a company (`session.company_entered`), opening the company audit log, running the integrity check (F14), every export to Excel or PDF and the full company export (company log). Reading reports and screens is not logged.
25. Each audit row records who (person, API client or system, with the name as it was), when, from where (IP address and user agent), the request ID and the session.
26. A person reads their own platform entries (their sign-ins) on their security page. The company audit log is read by owners and auditors.

## Accounting treatment
None. S01 posts nothing. Its ledger settings decide how S03 and later specs measure every line (ADR 0007): the book and parallel currencies, and each ledger's rate type and whether it accepts a transaction's own rate.

## Currencies, rates and rounding
No amounts. The settings hold the currency codes and rate policies only, validated with `currencyCodeSchema`, `ratePolicySchema` and `companyLedgersSchema` from the money module. A currency outside the money module's table is refused. Rates themselves are S02.

## Periods
No periods yet (S07). The settings lock starts at the first posted entry, whatever its period. `fiscal_year_start_month` is read by S03 (entry numbering per fiscal year) and S07 (periods); it is locked with the rest.

## API
Internal web API under `/api` (not `/v1`, which is the integration contract of ADR 0006; it is still in `openapi.json` and checked by `pnpm check:openapi`). Better Auth's routes are mounted at `/api/auth/*`, with every route the spec does not use switched off (Hub's pattern). Every request has a request ID; every answer of an error carries an error code.

| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /api/auth/sign-in/email` | Public | `signInSchema` (email, password) | `{ twoFactorRequired: true }` | `INVALID_CREDENTIALS`, `RATE_LIMITED`, `VALIDATION_FAILED` |
| `POST /api/auth/two-factor/verify-totp` · `…/verify-backup-code` | The pending sign-in | `{ code }` | the session (cookie) | `INVALID_TWO_FACTOR_CODE`, `RATE_LIMITED` |
| `POST /api/auth/two-factor/enable` · `…/generate-backup-codes` | `@SignedIn` (enrolment) | `{ password }` / `{ code }` | QR URI and secret / backup codes once | `INVALID_CREDENTIALS`, `INVALID_TWO_FACTOR_CODE`, `REAUTHENTICATION_REQUIRED` |
| `POST /api/auth/sign-out` | `@SignedIn` | — | `204` | `UNAUTHENTICATED` |
| `POST /api/auth/request-password-reset` · `…/reset-password` | Public | `{ email }` / `{ token, password }` | `204` (always) / `204` | `LINK_INVALID` (expired or used token), `RATE_LIMITED`, `VALIDATION_FAILED` |
| `POST /api/auth/reauthenticate` | `@SignedIn` | `{ code }` | `204` | `INVALID_TWO_FACTOR_CODE`, `RATE_LIMITED` |
| `GET /api/me` | `@SignedIn` | — | `meSchema`: person, two-factor state, memberships (company, role, archived), active company, effective permissions there | `UNAUTHENTICATED` |
| `GET /api/me/sign-ins` | `@SignedIn` | cursor | own platform audit entries | `UNAUTHENTICATED` |
| `POST /api/me/password` | `@SignedIn` `@Reauthenticated` | `{ currentPassword, newPassword }` | `204` | `INVALID_CREDENTIALS`, `REAUTHENTICATION_REQUIRED`, `VALIDATION_FAILED` |
| `POST /api/me/sessions/revoke-others` | `@SignedIn` `@Reauthenticated` | — | `204`: every other session of the person ends, this one stays (owner, 2026-10-27) | `REAUTHENTICATION_REQUIRED` |
| `POST /api/session/company` | `@SignedIn` | `{ companyId }` | `meSchema` | `NOT_FOUND` (not a member), `TWO_FACTOR_REQUIRED` |
| `POST /api/companies` | `@SignedIn` | `createCompanySchema` | the company | `TWO_FACTOR_REQUIRED`, `VALIDATION_FAILED` |
| `GET /api/company` | `company.read` | — | `companySchema` (profile, `companyLedgersSchema`, fiscal year start, policy note, `booksStarted`, archived) | `COMPANY_NOT_SELECTED` |
| `PATCH /api/company` | `company.settings` | `updateCompanyProfileSchema` (names, policy note) | `companySchema` | `COMPANY_ARCHIVED`, `COMPANY_SWITCHED`, `VALIDATION_FAILED` |
| `PUT /api/company/ledgers` | `company.settings` `@Reauthenticated` | `{ ledgers: companyLedgersSchema, fiscalYearStartMonth }` | `companySchema` | `COMPANY_SETTINGS_LOCKED`, `COMPANY_ARCHIVED`, `COMPANY_SWITCHED`, `REAUTHENTICATION_REQUIRED`, `VALIDATION_FAILED` |
| `POST /api/company/archive` · `…/restore` | `company.archive` `@Reauthenticated` | `{ reason }` | `companySchema` | `COMPANY_SWITCHED`, `REAUTHENTICATION_REQUIRED`, `VALIDATION_FAILED` |
| `GET /api/members` | `members.read` | — | members with role, period permission, two-factor enrolled, joined date | `COMPANY_NOT_SELECTED` |
| `PATCH /api/members/:id` | `members.manage` `@Reauthenticated` | `{ role, canClosePeriods }` | the member | `NOT_FOUND`, `LAST_OWNER`, `COMPANY_ARCHIVED`, `COMPANY_SWITCHED`, `VALIDATION_FAILED` |
| `POST /api/members/:id/remove` | `members.manage` `@Reauthenticated`; or the member themself (leave) | `{ reason }` | `204` | `NOT_FOUND`, `LAST_OWNER`, `COMPANY_SWITCHED` |
| `POST /api/members/:id/reset-two-factor` | `members.manage` `@Reauthenticated` | `{ reason }` | `204` | `NOT_FOUND`, `RESET_NOT_ALLOWED`, `COMPANY_SWITCHED` |
| `GET /api/invitations` | `members.read` | — | pending invitations | — |
| `POST /api/invitations` | `members.manage` `@Reauthenticated` | `{ email, role, canClosePeriods }` | the invitation | `INVITATION_EXISTS`, `MEMBERSHIP_EXISTS`, `COMPANY_ARCHIVED`, `COMPANY_SWITCHED`, `VALIDATION_FAILED` |
| `POST /api/invitations/:id/revoke` | `members.manage` | — | `204` | `NOT_FOUND`, `COMPANY_SWITCHED` |
| `POST /api/invitations/lookup` · `POST /api/invitations/accept` | Public (with the token) | `{ token }` in the body, never the URL / `{ token, name?, password? }` | the company name and role / the membership | `LINK_INVALID`, `INVITATION_EMAIL_MISMATCH`, `VALIDATION_FAILED` |
| `GET /api/audit` | `audit.read` | filters: date range, actor, action, entity; cursor | audit entries | `COMPANY_NOT_SELECTED` |

Another company's member, invitation or entity id answers `NOT_FOUND`, exactly like an unknown id. Writes in S01 are protected against double submits by their own rules (unique keys and state checks) rather than an idempotency key, which is the posting API's mechanism (ADR 0006).

New error codes, appended to `errorStatus` in this order, each with its Arabic text:

| Code | Status | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 422 | The request does not match its schema (ADR 0008: validation answers 422) |
| `UNAUTHENTICATED` | 401 | No valid session |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password, or a locked or archived account (one answer for all) |
| `INVALID_TWO_FACTOR_CODE` | 401 | Wrong, reused or expired authenticator or backup code |
| `TWO_FACTOR_REQUIRED` | 403 | The person must enrol two-factor first |
| `REAUTHENTICATION_REQUIRED` | 403 | A sensitive action without a fresh code |
| `FORBIDDEN` | 403 | The role lacks the permission |
| `NOT_FOUND` | 404 | Unknown, or belongs to another company |
| `COMPANY_NOT_SELECTED` | 409 | No active company on the session |
| `COMPANY_SWITCHED` | 409 | `X-Mizan-Company` differs from the active company |
| `COMPANY_ARCHIVED` | 409 | A write to an archived company |
| `COMPANY_SETTINGS_LOCKED` | 409 | Ledger settings after the first posted entry |
| `LAST_OWNER` | 409 | The change would leave no active owner |
| `MEMBERSHIP_EXISTS` | 409 | The email already belongs to a member |
| `INVITATION_EXISTS` | 409 | A pending invitation exists for the email |
| `LINK_INVALID` | 410 | The link is expired, used or revoked |
| `INVITATION_EMAIL_MISMATCH` | 403 | The signed-in person is not the invited email |
| `RESET_NOT_ALLOWED` | 403 | The person belongs to a company the resetting owner does not own |
| `RATE_LIMITED` | 429 | Too many attempts |

## Jobs and events
- **Email** (worker, pg-boss queue `email.send`): invitation, password reset, two-factor reset notice. The API enqueues it in the change's transaction; the worker sends through the server's SMTP account (ADR 0008). A retry may send the same email twice, which is harmless; the link inside is the same token. The job payload holds the token only until sent, and pg-boss removes completed jobs (retention set to one day).
- **Clean-up** (worker, daily): deletes expired sessions, verifications and rate-limit rows (the `ephemeral` tables) and marks expired invitations; running it twice deletes nothing more.
- No events are received or emitted.

## Screens
All Arabic RTL, design-system components only, responsive from 360 px, texts in `ar.auth`, `ar.company`, `ar.members`, `ar.audit`.

| Route | Purpose and content | Actions | States | Who |
|---|---|---|---|---|
| `/sign-in` | Email and password | Sign in; "forgot password" | Error per code; locked notice | Anyone |
| `/sign-in/two-factor` | Six-digit code, or a backup code | Verify | Wrong code; locked | Pending sign-in |
| `/forgot-password` · `/reset-password` | Email · new password (token in the fragment) | Send link · set password | Sent (same message always) · expired link | Anyone |
| `/invitation` | Company and role invited to; name and password for a new person, or sign-in for an existing one | Accept | Expired, used, email mismatch | Holder of the link |
| `/two-factor/enrol` | QR code, secret as text, code field; then the 10 backup codes with copy and print | Verify; confirm codes saved | Wrong code | Person without two-factor |
| `/companies` | The person's companies (name, role, archived badge) | Open one; create a company | Empty: "create your first company" | Signed in |
| `/companies/new` | Name, Latin name, book currency and policy, parallel currency and policy (optional), fiscal year start, policy note; Vertex Media's shape pre-filled | Create | Validation per field | Signed in with two-factor |
| Top bar | The company switcher (company name, role) | Switch | — | Signed in |
| `/settings/company` | Profile; ledgers with policies; fiscal year start; policy note; a lock notice after the first posted entry; archive and restore with a reason | Save; archive; restore | Locked fields read-only with the reason; archived banner on every page | Owner edits; others read |
| `/settings/members` | Members (name, email, role, period permission, two-factor enrolled, joined); pending invitations (email, role, invited by, expires) | Invite; change role or permission; remove; reset two-factor; revoke invitation; leave | Empty invitations; last-owner refusal explained | Owner edits; auditor reads |
| `/settings/audit` | The company audit log in the grid: time, person, action, entity, reason; a side panel with before and after per field and IP and user agent | Filter by date, person, action, entity | Loading, empty, error | Owner, auditor |
| `/account/security` | Change password; regenerate backup codes; own recent sign-ins (time, IP, device, result); sign out of other sessions | As listed | — | Every person |

A re-authentication dialog (six-digit code) appears before every sensitive action. Every page handles loading, empty and error states; the archived-company banner shows on every page of an archived company.

## Reports
None. The audit log screen is not a financial report.

## Printing and legal books
None. Backup codes are printed from the browser as a plain list.

## Volume and performance
Tens of people and companies in phase 1; an accounting office later holds dozens of companies per person. Audit entries: a few thousand per company per month once posting starts. `/api/me` and the access guard run on every request: one indexed read of the session, the user and the membership (≤ 20 ms). The audit screen pages by cursor on `(company_id, created_at)`, 100 rows a page, ≤ 500 ms.

## Migration and compatibility
- The first real tables: `packages/db` gets the `access`, `companies` and `audit` schema modules, their registry entries, the `ephemeral` kind with its convention rules, the `company_settings` lock trigger in `GUARDS`, and a custom migration with RLS, grants and triggers.
- No existing data or API clients. `openapi.json` gains the `/api` routes above (additive).
- `packages/contracts` gains `access.ts` (the permission map) and the error codes, appended.

## Arabic strings and number formats
- New i18n namespaces: `ar.auth`, `ar.company`, `ar.members`, `ar.audit`, `ar.roles`, `ar.permissions`, and the Arabic text of every new error code in `ar.errors`.
- Terms (glossary): الشركة، العضوية، الدعوة، الدور، الصلاحية، المالك، المحاسب، المعتمِد، القارئ، المدقق، المصادقة الثنائية، رمز احتياطي، الجلسة، الشركة النشطة، سجل التدقيق، إعدادات الدفاتر، مذكرة السياسة، صلاحية الفترات، أرشفة.
- Dates and times in Damascus time with Latin digits (`apps/web/src/lib/format.ts`); currency codes with their Arabic names from the money module.

## Audit
Rules 23–26. Platform actions: `user.signed_in`, `user.sign_in_failed`, `user.signed_out`, `user.password_reset_requested`, `user.password_changed`, `user.two_factor_enrolled`, `user.backup_code_used`, `user.backup_codes_regenerated`, `company.created`, `user.two_factor_reset` (server command), `user.other_sessions_revoked`. Company actions: `company.updated`, `company.ledgers_updated`, `company.policy_note_updated`, `company.archived`, `company.restored`, `invitation.created`, `invitation.revoked`, `invitation.accepted`, `membership.created`, `membership.updated`, `membership.removed`, `membership.left`, `membership.two_factor_reset`, `session.company_entered`, `audit.viewed`; later specs add `export.*` and `integrity.checked`.

## Abuse and failure cases
- **Cross-company access:** the company comes only from the session's active company, checked against an active membership on every request; company data only inside `withCompany`; every endpoint tested as a member of another company (expects `NOT_FOUND` or nothing); the isolation property test (ADR 0003) covers `company_settings` and `audit_entries`.
- **Stolen password:** useless without the authenticator code (every role). **Stolen session cookie:** `__Host-` cookie, `HttpOnly`, `Secure`, `SameSite=Strict`; 30-minute idle and 12-hour limits; sensitive actions need a fresh code.
- **CSRF:** the cookie's `SameSite=Strict` and a same-origin check on every non-safe method (`Origin` and `Sec-Fetch-Site`; Hub's `same-origin.ts`).
- **Password guessing and enumeration:** the database-backed limits of rule 8; one answer for unknown, wrong, locked and archived; the same Argon2id cost on every path (a decoy hash).
- **Code replay:** an authenticator code is accepted once per step; backup codes are single use.
- **Invitation link leaked:** single use, 7 days, bound to the invited email, revocable; the token lives in the URL fragment (not in server logs) and is stored only as a hash.
- **Malicious owner of another company:** rule 21 limits a two-factor reset to people whose every company the owner also owns.
- **Locked out of a company:** the last-owner rule (18); the server command recovers a person who lost both authenticator and backup codes.
- **A switch in another tab:** rule 22 (`COMPANY_SWITCHED`).
- **Double submits:** an invitation twice → `INVITATION_EXISTS`; accepting twice → `LINK_INVALID`; archive twice → no change, one audit row.
- **Secrets in logs or audit:** pino redacts `authorization`, `cookie`, `set-cookie`; the audit writer takes an allow-list of fields per entity, never the secret columns; `AUTH_SECRET` (≥ 32 bytes) is refused at startup when missing or equal to the example value.
- **Session tokens at rest:** Better Auth keeps the token in `sessions`; implementation checks whether it can store a hash instead (Better Auth's `session` hooks) and, if not, records why under Found. A database reader already reaches the books, so this is defence in depth, not a gap in isolation.
- **Email down:** invitations and resets wait in the queue and retry; the screens say the email may take a few minutes.

## Edge cases
1. Two owners demote each other at the same time: both take a lock on the company's owner memberships (`SELECT … FOR UPDATE` on the company row) so one of them gets `LAST_OWNER`.
2. The last owner leaves or is removed while another owner's invitation is pending: refused; a pending invitation is not an owner.
3. An owner changes the ledger settings while the first entry posts (S03): the posting function and the settings update both lock the `company_settings` row, so either the change happens before `books_started_at` is set or it is refused after.
4. A person invited to a company they already left: allowed; a new membership row (the archived one stays).
5. An invitation accepted after the company was archived: refused (`LINK_INVALID`; archiving revoked it).
6. A person whose only company is archived signs in: they see it marked archived, read-only.
7. A removed member with an open session: their next company request finds no active company (`COMPANY_NOT_SELECTED`) and the web returns them to `/companies`.
8. The parallel currency set to the book currency: refused (`VALIDATION_FAILED`, `companyLedgersSchema`). `acceptsTransactionRate` with `bulletin`: refused.
9. Every currency shape is creatable: `syp`, `syp-usd`, `usd-syp`, and companies that will deal in a third currency (the third currency is a rate concern, S02).
10. An email typed with capitals or spaces: trimmed and lower-cased for matching; shown as typed in invitations.
11. A role change of a member who is in the middle of a sensitive action: the guard reads the membership on every request, so the next request uses the new role.
12. Clock skew on the authenticator: ±1 step of 30 seconds.
13. Fiscal year start month other than January: allowed (the field exists for companies elsewhere), defaulting to January; locked like the rest.

## Scenarios
None: S01 introduces no posting, recognition, revaluation or settlement rule. The scenario book's setup (S03) reads company ledgers in the `companyLedgersSchema` shape this spec stores.

## Open questions
None blocking. For later specs (`docs/open-questions.md`):
- **Q9, posting-rule mapping permission (S05):** phase 1 scope §3 gives posting rules to the owner, while F10 says the accountant maintains the account mapping. S05 asks the owner which role holds `posting-rules.manage`. Recommendation: owner and accountant, every change audited with before and after.

## Acceptance
- **The owner's end-to-end check, step by step:**
  1. On the server, run `admin:create-company` for a synthetic company "شركة اختبار" with book SYP at bulletin and parallel USD at market accepting the transaction's rate; receive the invitation email.
  2. Accept it, set a password, enrol the authenticator, save the backup codes; land in the company.
  3. Open `/settings/company`: see SYP/bulletin, USD/market, January, the policy note; change the parallel policy and back; see both changes with before and after in `/settings/audit`.
  4. Invite a second email as accountant with the period permission; accept it in another browser; that person enrols two-factor and sees no members or audit pages.
  5. Try to demote yourself while you are the only owner: refused with the Arabic message.
  6. Create a second company from `/companies/new`; switch between them; check each shows only its own members and audit log.
  7. Sign out, sign in with a backup code; see the sign-in in `/account/security`.
  8. Archive the second company with a reason; see the read-only banner; restore it.
- **Tests:**
  - API: for every endpoint, success, `401`, `403` (a role without the permission), another company's member (`NOT_FOUND`, nothing changed), `COMPANY_SWITCHED`, and the documented error codes; sign-in limits and lockout; re-authentication windows; invitation expiry and email binding; the last-owner rule under concurrency; the two-factor reset rule.
  - Unit and property tests: `effectivePermissions` for every role and the period switch; a property that no role gains a permission outside its row and `periods.close` appears only for owners and switched accountants.
  - The guard: an architecture test that every route declares exactly one access decorator.
  - Database: the convention test with the `ephemeral` kind (each rule proven by a mutation); invariant tests for `audit_entries` (append-only for every role) and the settings lock (refused for the app role and the owner role once `books_started_at` is set; allowed before); isolation of `company_settings` and `audit_entries` between two companies.
  - E2E with RTL screenshots (light and dark, 360, 768, 1280 px) for every screen above, the API mocked per page.
