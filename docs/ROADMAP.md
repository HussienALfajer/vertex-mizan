# Roadmap

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done. Phases are defined in `docs/product/vision-and-phases.md`. Only the current phase is broken into tasks; the next one is detailed after the current one is in use.

## Setup
- [x] Repository: public, no licence, merge commits only, auto-merge, branches deleted after merge, `main: require CI` ruleset
- [x] Market research (`docs/research/market-syria.md`)
- [x] Working method with Claude Code (`docs/research/working-method.md`)
- [x] Product decision (ADR 0001), vision and phases, roadmap, phase 1 analysis and scope (`docs/product/phase-1-scope.md`), approved 2026-10-20
- [x] Technical ADRs: stack (0002), tenancy and access (0003), money and currencies (0004, superseded by 0007), ledger invariants (0005), the Hub posting API contract (0006)
- [x] Claude Code setup from the working method: `AGENTS.md`, `CLAUDE.md`, `docs/workflow.md`, `docs/glossary.md`, `docs/open-questions.md`, `.claude/` (settings, subagents `checker`, `reviewer`, `accountant-reviewer`, `explorer`; hooks; skills `spec`, `posting-rule`, `feature-slice`, `db-migration`), spec template, scenario-book format

## Phase 0 — Foundation
- [x] Monorepo scaffold: pnpm, Turborepo, TypeScript, Biome, `packages/config`, CI (lint, typecheck, test, build, gitleaks, dependency advisories, docs-only skip, PostgreSQL 17 service, migration drift); `Typecheck, lint, test, build` and `Secret scan` required by the `main: require CI` ruleset (owner, 2026-10-20)
- [x] `packages/contracts`: the money module (currencies, quoted rates, rate policies per ledger, one conversion half away from zero with cross rates, compatibility with Hub's `convertMinor`, fast-check properties; ADR 0007), the error-code registry, the Biome rule against arithmetic on `*Minor` fields elsewhere; the permission map moves to S01
- [x] `packages/ledger`: lines with transaction, book and parallel amounts and their rates, new measurements per ledger policy (`RATE_MISSING`, the transaction's own rate where accepted, third-currency crosses), carried amounts (cumulative clearing, running-balance average, zero-crossing split, exact reversal), rounding and exchange-difference lines, cumulative allocation, the integrity hash; ADR 0007 worked examples and fast-check properties
- [x] `packages/db`: roles (`mizan_owner`, `mizan_app`, `mizan_jobs`, `mizan_queue`), the runtime-role pools, `withCompany()` and `current_company_id()`, `refuse_change()`, the table registry, the local PostgreSQL 17 (`compose.yaml`) and a test database per run; the convention test (each rule proven against a broken fixture table) and invariant tests run as `mizan_app` on fixture tables: forced RLS, append-only and deferred-invariant triggers (`ENABLE ALWAYS`) (ADR 0003, 0005, 0008). The ledger tables arrive with S03
- [x] The scenario-book runner `packages/scenarios` (`pnpm test:scenarios`, in CI): the README format as a Zod schema, `Proposed` skipped and listed, the exact set of entries and lines in both ledgers, one audit row per posting, balances and outcomes on a fresh test database; the setup, the ledger reader and the step executors plug in with S03 (manual entries), S05 (Hub events) and S07 (jobs), and an `Approved` step with no executor fails (ADR 0008)
- [x] Brand and design system (ADR 0009, ADR 0010): research (`docs/research/design-system-for-accounting.md`); `brand/` with the MIZAN logo (owner approved 2026-10-21); `packages/tokens` with compact and comfortable densities; `packages/ui` from Vertex Hub on the densities, with tabular figures, Amount and Amount input (LTR-isolated, minus sign and negative color, Arabic-Indic digits, exact `=` expressions), account label, ledger switch, period badge and the keyboard map; `packages/i18n`; money text and summaries in the money module; a preview page shown to the owner in light and dark at phone, tablet and desktop widths
- [x] Data grid foundation and command palette (ADR 0010 §4–§5, PR 6b): a pure grid core with property tests (visual arrows in RTL, range selection, Excel's TSV both ways, all-or-nothing paste, fill down and clear, the selection summary per kind of amount and currency through the money module), the `Grid` component (APG grid, editing mode, sticky header, footer and start column) and the `CommandPalette` (Ctrl/⌘+K, combobox pattern, Arabic-aware search)
- [x] App skeletons: api (NestJS 12, nestjs-pino, Standard Schema validation, `/api/health` with 503 when the database is down, the committed OpenAPI document with drift and breaking-change checks), worker (application context, pg-boss as `mizan_queue` in `pgboss`, heartbeat job), both started from their builds in CI (PR 7)
- [x] The test and CI model from Vertex Hub (`docs/testing.md`): `pnpm verify` (each check once, logs in `.verify/`, the changed E2E specs), the `test-guard` hook, `isolate: false` for `packages/db`, agent rules and skills on `pnpm verify`, CI ready for Turborepo's remote cache (off until the owner adds the secrets)
- [x] Web skeleton (PR 8): `apps/web` (Vite, React 19, TanStack Router and Query, Tailwind 4), the RTL shell on the design system (Vertex Green sidebar, a `Sheet` on phones, command palette, theme toggle, system status from `/api/health`), the design-system page moved from `packages/ui`'s preview with Amount and Amount input; Playwright on the production build with RTL screenshots light and dark at 360, 768 and 1280 px, the whole suite on two CI shards behind the gate
- [ ] Deployment skeleton on the Vertex server at `mizan.vertexmedia.pro`
- [x] CI migration check that refuses guard-weakening SQL (ADR 0008), with `UPDATE`, `DELETE`, `TRUNCATE`, `MERGE`, upserts, `DROP TABLE`, renames, dropped columns, type changes, inheritance and partitions on the registry's append-only tables, and `CREATE OR REPLACE TRIGGER`, `CREATE RULE`, `DROP OWNED` and enum value renames anywhere; it fails when `packages/db` has no migration, a nested one or no registry

## Phase 1 — The core and the posting API
Scope: `docs/product/phase-1-scope.md`. One spec per line, each through `/spec` → `/posting-rule` → `/feature-slice`.
- [x] S01 Companies, people and access: F01 (`docs/specs/S01-companies-people-access.md`)
  - [x] PR 1 contracts and database: the permission map, the access schemas and S01's error codes; the identity, membership, company, settings and audit tables with the `ephemeral` kind, forced RLS, append-only audit logs and the settings lock
  - [x] PR 2 API and worker: Better Auth with two-factor, the access guard, the S01 endpoints, the email outbox (owner decision 2026-10-26) and the clean-up job, the server commands
  - [x] PR 3 access screens: sign-in in two steps, forgot and reset password, invitations, enrolment with backup codes, account security with signing out of other sessions (`POST /api/me/sessions/revoke-others`, owner 2026-10-27); `OtpField`, `PasswordInput`, `QrCode`, `SecretCodeList` in `packages/ui`
  - [x] PR 4 company screens: companies, new company, company settings, members and invitations, audit log, the company switcher and guard, the archived banner, `X-Mizan-Company` on company writes (owner, 2026-10-27: the screens split in two PRs); `ChangeList`, `DateRangeField` in `packages/ui`
- [~] S02 Chart of accounts, dimensions and rates: F02 · F03 · F04 (`docs/specs/S02-chart-dimensions-rates.md`; the templates await the accountants' review, Q3)
  - [x] PR 1 contracts, ledger and database: the statement-line catalogue, the code shape, the account, dimension and rate schemas, the two templates (drafts, Q3), the permission keys, error codes and audit actions; `checkLineAgainstChart()` (rule 8); the chart, dimension and rate tables with forced RLS, the tree and lock after first use, the append-only rate table with its corrections, and the five roots and built-in dimension types of every company
  - [x] PR 2 API: the chart, dimension and rate endpoints, the template choice at company creation (`POST /api/companies`, `admin:create-company --template`), the chart export to Excel (PDF with the worker's rendering, owner 2026-10-27)
  - [x] PR 3 chart screens: `/chart` (the tree with filters, the account sheet with the lock notice, block, archive and restore with a reason, the template choice on an empty chart, the Excel export) and `/chart/roles`; the template choice on the new-company form (service agency by default); "new account" in the command palette; `AccountTree` and `AccountPicker` in `packages/ui`
  - [ ] PR 4 dimension and rate screens (with `DimensionPicker`)
  - [x] Posting rules: the scenarios `currency/bulletin-rate-of-the-day` and `currency/rate-correction-after-use` (numbers approved by the owner 2026-10-27, `Proposed` until S03 brings their executors); the scenario format's bulletin calendar, `rate` and `reversal` steps and `corrections`; `rateInForce()` and `policyRate()` on the publication calendar (rule 16) with its properties
- [ ] S03 Journal entries and the posting function: F05 · F14 (period balances, `posted_at`, the daily anchor)
- [ ] S04 Open items and settlements: F06
- [ ] S05 Posting API, event inbox and posting rules: F10
- [ ] S06 Revenue recognition (IFRS 15): F07
- [ ] S07 Month-end revaluation, periods and close: F08 · F09
- [ ] S08 Daily reconciliation: F11
- [ ] S09 Reports: F13
- [ ] S10 Opening balances and Hub history replay: F12 (Q4)
- [ ] Inquiry with the tax authority about program approval (Q8)
- [ ] Hub's side of the integration, in Hub's sessions (ADR 0006, 0008, Q5)
- [ ] Deployment and backup ADR in force: point-in-time recovery, encrypted off-server copies, a restore drill (Q2); no real company data before it
- [ ] Production: Vertex Media's books live; a real month closed (the scope's "Done when")

## Phase 2 — Cash, expenses, suppliers, statements, close
Detailed after phase 1 is in use.

## Phase 3 — Trading modules and the first stand-alone sale
Detailed after phase 2 is in use.

## Phase 4 — The commercial product
Detailed after phase 3 is in use.
