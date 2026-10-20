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
- [ ] The scenario-book runner (exact set of entries, both ledgers, `Proposed` skipped; ADR 0008)
- [ ] Brand and design system (ADR 0009): `brand/` with the MIZAN logo (shown to the owner before use), `packages/tokens` and `packages/ui` copied from Vertex Hub, the Amount and Amount input components (LTR-isolated numbers, minus sign and negative color), light and dark RTL screenshots at phone, tablet and desktop widths
- [ ] App skeletons: api (`/api/health`, OpenAPI), worker (pg-boss), web (RTL shell on the design system)
- [ ] Deployment skeleton on the Vertex server at `mizan.vertexmedia.pro`
- [x] CI migration check that refuses guard-weakening SQL (ADR 0008), with `UPDATE`, `DELETE`, `TRUNCATE`, `MERGE`, upserts, `DROP TABLE`, renames, dropped columns, type changes, inheritance and partitions on the registry's append-only tables, and `CREATE OR REPLACE TRIGGER`, `CREATE RULE` and `DROP OWNED` anywhere; it fails when `packages/db` has no migration, a nested one or no registry

## Phase 1 — The core and the posting API
Scope: `docs/product/phase-1-scope.md`. One spec per line, each through `/spec` → `/posting-rule` → `/feature-slice`.
- [ ] S01 Companies, people and access: F01
- [ ] S02 Chart of accounts, dimensions and rates: F02 · F03 · F04 (the service-agency template, Q3)
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
