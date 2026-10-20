# Roadmap

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done. Phases are defined in `docs/product/vision-and-phases.md`. Only the current phase is broken into tasks; the next one is detailed after the current one is in use.

## Setup
- [x] Repository: public, no licence, merge commits only, auto-merge, branches deleted after merge, `main: require CI` ruleset (required checks added when CI exists)
- [x] Market research (`docs/research/market-syria.md`)
- [x] Working method with Claude Code (`docs/research/working-method.md`)
- [x] Product decision (ADR 0001), vision and phases, roadmap, phase 1 analysis and scope (`docs/product/phase-1-scope.md`), approved 2026-10-20
- [x] Technical ADRs: stack (0002), tenancy and access (0003), money and currencies (0004, superseded by 0007), ledger invariants (0005), the Hub posting API contract (0006)
- [x] Claude Code setup from the working method: `AGENTS.md`, `CLAUDE.md`, `docs/workflow.md`, `docs/glossary.md`, `docs/open-questions.md`, `.claude/` (settings, subagents `checker`, `reviewer`, `accountant-reviewer`, `explorer`; hooks; skills `spec`, `posting-rule`, `feature-slice`, `db-migration`), spec template, scenario-book format

## Phase 0 — Foundation
- [~] Monorepo scaffold: pnpm, Turborepo, TypeScript, Biome, `packages/config`, CI (lint, typecheck, test, build, gitleaks, dependency advisories, docs-only skip) done; migration drift arrives with `packages/db`; CI checks added as required to the `main: require CI` ruleset after the owner's approval
- [ ] `packages/contracts`: the money module (currencies, quoted rates, rate policies, conversion half away from zero, compatibility with Hub's `convertMinor`; ADR 0007), error codes, permission map
- [ ] `packages/ledger`: line building in the book and parallel ledgers, rounding and exchange-difference lines, cumulative allocation, the integrity hash; property tests (fast-check)
- [ ] `packages/db`: roles (`mizan_owner`, `mizan_app`, `mizan_jobs`, `mizan_queue`), company context, forced RLS, append-only and deferred-invariant triggers (`ENABLE ALWAYS`), convention and invariant tests run as `mizan_app` (ADR 0003, 0005, 0008)
- [ ] The scenario-book runner (exact set of entries, both ledgers, `Proposed` skipped; ADR 0008)
- [ ] Brand and design system (ADR 0009): `brand/` with the MIZAN logo (shown to the owner before use), `packages/tokens` and `packages/ui` copied from Vertex Hub, the Amount and Amount input components (LTR-isolated numbers, minus sign and negative color), light and dark RTL screenshots at phone, tablet and desktop widths
- [ ] App skeletons: api (`/api/health`, OpenAPI), worker (pg-boss), web (RTL shell on the design system)
- [ ] Deployment skeleton on the Vertex server at `mizan.vertexmedia.pro`
- [~] CI migration check that refuses guard-weakening SQL (ADR 0008): the guard runs in CI; `UPDATE`, `DELETE` and `TRUNCATE` on append-only tables are refused once `packages/db` registers them

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
