# TASKS — S03 Journal entries and the posting function

Spec: `docs/specs/S03-journal-entries-posting.md` (Approved, owner 2026-10-28) · ADRs 0003, 0005, 0007, 0008, 0011, 0012 · Scenarios: `docs/scenarios/manual/` (conversion-rounding, currency-purchase, reversal) and `docs/scenarios/currency/` (bulletin-rate-of-the-day, rate-correction-after-use). Five PRs, each merged before the next starts; each PR's branch is the session's own `claude/…` branch or `feat/s03-<slice>`.

## PR 1 — The ledger and the posting function (contracts, ledger, db, scenarios)
- [ ] contracts: the error codes the posting function and manual posting raise (`PERIOD_CLOSED`, `IDEMPOTENCY_CONFLICT`, `ENTRY_DATE_OUT_OF_RANGE`, `REVERSAL_BEFORE_ORIGINAL` if not yet there, `ACCOUNT_IS_CONTROL`), appended with their Arabic text in `packages/i18n`; the `entry.posted` audit action
- [ ] ledger: the entry's hash input (header, lines with their conversions and dimension keys) built from typed fields and pinned by a test; any pure piece `post()` needs that the package lacks
- [ ] db (`/db-migration`): the `ledger-state` kind (registry, convention test, migration guard); the `ledger` module tables (posting requests, entries, lines, line conversions, dimension sets and values, ledger heads, entry-number counters, periods, period balances) with forced RLS, composite company keys, the ADR 0005, 0008 and 0012 guards pinned in `GUARDS`; a ledger head per existing company and one with each new company
- [ ] db: `post()` (idempotency, lock order head → settings → period, chart checks, measurement, realised differences, `balanceEntry()`, numbering by fiscal year of the entry date, the chain, the audit row, `first_posted_at`, `books_started_at`) and `rebuildPeriodBalances()`; the manual posting path (rule 6 dates, control accounts refused, dealt rates) and the manual reversal path
- [ ] db: tests — invariants as `mizan_app` on every new table (update, delete, truncate, unbalanced commit, second reversal, a reversal that does not negate, a skipped number, a broken link, direct writes to period balances, the head, a counter); concurrency (gapless numbers and an unbroken chain from many connections; a posting racing a period marked closed); properties (balanced in every shape, entry plus reversal nets to zero, period balances equal the lines, the chain verifies and fails on any altered field, replays post nothing); the isolation property over the new tables
- [ ] db: the company creation, chart template and rate recording the scenario setup shares with the API, as transaction functions the API services call (no behaviour change)
- [ ] scenarios: `bookHarness` setup, ledger reader, `manual`, `reversal` and `rate` executors through the shared services and `post()`; the README's manual payload; the `currency/` scenarios `Approved (owner, 2026-10-27)` and the `manual/` ones `Approved (owner, 2026-10-28)`, no expected value changed, all counted as run
- [ ] wiring (Contracts, Ledger, Database), docs (`packages/db/CLAUDE.md`, `packages/scenarios/CLAUDE.md`, `packages/ledger/CLAUDE.md`, `docs/ROADMAP.md`)
- [ ] checks and reviewers (`reviewer`, `accountant-reviewer`), PR with auto-merge and Auto-fix

## PR 2 — Manual entries: drafts, approval, reversal (contracts, db, api)
- [ ] contracts: `entries.ts` (drafts, lines, dealt rates, entries, the preview, an account's lines, a rate row's entries), the permission keys (`entries.read`, `drafts.read`, `drafts.manage`, `entries.post`, `entries.approve`, `entries.attach`), the drafts, approval and attachment error codes and audit actions, `manualEntryApproval` in the company settings
- [ ] db (`/db-migration`): the `drafts` module (`entry_drafts`, `entry_draft_lines`, `entry_attachments` and their triggers), `company_settings.manual_entry_approval`; tests
- [ ] api: the `entries` and `drafts` modules (the spec's routes except integrity and exports), the file store under `MIZAN_FILES_DIR` (type from magic bytes, size and count limits, downloads with `nosniff`), the approval switch, `ACCOUNT_HAS_BALANCE` with the ledger balances (archiving locks the ledger head first); per endpoint: success, 401, 403, another company, idempotent replay; stale writes; self-approval
- [ ] bridge: OpenAPI regenerated, breaking-change check
- [ ] wiring (Contracts, Database, API), docs (`apps/api/CLAUDE.md`, `.env.example`, the `AGENTS.md` commands table if a command changes, `docs/ROADMAP.md`)
- [ ] checks and reviewers (`reviewer`, `accountant-reviewer`), PR with auto-merge and Auto-fix

## PR 3 — Trust and the full export (contracts, ledger, db, api, worker)
- [ ] contracts: the integrity report, anchor and export schemas, `integrity.read`, `company.export`, `EXPORT_IN_PROGRESS`, the audit actions, the email kinds (daily anchor, export ready)
- [ ] ledger: the integrity check's pure parts (chain, numbers, balance, period balances against the lines, anchors)
- [ ] db (`/db-migration`): the `trust` module (`chain_anchors` append-only, `company_exports` queue); the jobs role's first policies and grants for the daily anchor
- [ ] api: `POST /api/integrity/check`, the export routes (`@Reauthenticated` request, list, download, `LINK_INVALID` once expired)
- [ ] worker: `ledger.daily-anchor`, `company.export`, `company.export-expire`, each safe to run twice
- [ ] bridge: OpenAPI regenerated, breaking-change check
- [ ] wiring, docs (`apps/worker/CLAUDE.md`, `packages/db/CLAUDE.md`, `docs/ROADMAP.md`)
- [ ] checks and reviewers (`reviewer`, `accountant-reviewer`), PR with auto-merge and Auto-fix

## PR 4 — The entry screens (ui, web, e2e)
- [ ] ui: the general components the screens lack, built in `packages/ui` first (ADR 0010 §7), tested, both densities, on the design-system page
- [ ] web: `/entries`, `/entries/new` and `/drafts/:id` (the keyboard entry screen, live totals, dealt rates, the preview, attachments), `/drafts` (tabs and the approval queue), `/entries/:id`, `/accounts/:id/lines`, the rate row's entries in `/rates`, the approval switch in `/settings/company`, the command palette items; `ar.entries`, `ar.drafts`, glossary terms
- [ ] e2e: the entry screen by keyboard only, the preview, approval, reversal, the entry page; RTL screenshots light and dark at 360, 768 and 1280 px, looked at
- [ ] wiring (Web), docs (`apps/web/CLAUDE.md`, `docs/glossary.md`, `docs/ROADMAP.md`)
- [ ] checks and reviewer, PR with auto-merge and Auto-fix

## PR 5 — The integrity and export screens (web, e2e)
- [ ] web: `/integrity` (run, anchors, a pasted anchor), `/settings/export` (request with reauthentication, states, download), "run integrity check" in the command palette; `ar.integrity`, `ar.export`
- [ ] e2e: the integrity page and the export page; RTL screenshots light and dark at 360, 768 and 1280 px, looked at
- [ ] wiring, docs (`docs/ROADMAP.md`: S03 done)
- [ ] checks and reviewer, PR with auto-merge and Auto-fix; reset this file to its "No task in progress" stub
