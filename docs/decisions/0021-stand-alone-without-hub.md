# 0021 — A stand-alone accounting system: the Hub integration removed, a contracting client first

Status: Accepted (owner, 2026-11-13) · Date: 2026-11-13 · Supersedes [0006](0006-hub-posting-api-contract.md), [0014](0014-event-inbox-holds-and-order.md), [0015](0015-revenue-recognition-schedules.md) and [0017](0017-daily-reconciliation.md) · Amends [0001](0001-vertex-mizan-product.md) (the integration layer), [0003](0003-tenancy-and-access.md) (API clients), [0019](0019-opening-balances-and-history-replay.md) (Hub's snapshot and the replay) and the phase 1 scope

## Context
Phase 1 was built so that Vertex Media's books are fed by Vertex Hub: the `/v1` posting API, the event inbox, the Hub posting rules, revenue recognition under IFRS 15 for an agency's retainers and milestones, the daily reconciliation with Hub, and the opening from Hub's snapshot.

On 2026-11-13 the owner cancelled the integration with Hub. Mizan's first user is now a contracting client, in three voice notes the owner forwarded:
- the income and the expenses of a construction project, in detail;
- the wages of workers and craftsmen (a carpenter, for example);
- the materials, item by item;
- amounts in US dollars and in Turkish lira;
- several businesses, each kept apart from the others;
- a copy of the data the client keeps on a USB drive.

The owner chose to build this inside Mizan, keep only what the client needs, and build what is missing (owner, 2026-11-13).

## Decision
1. **Mizan is a stand-alone accounting system.** Nothing posts to it from another system. The integration layer of ADR 0001 is dropped.
2. **Removed**, with their code, tables, screens, permissions, jobs, scenarios and specs:
   - the `/v1` API, API clients and their keys, and the document sources (S05);
   - the event inbox, its holds, actions and digest, and the Hub posting rules with their account slots (S05, ADR 0014);
   - revenue recognition: schedules, releases, credits, milestones and the release job (S06, ADR 0015);
   - the daily reconciliation with Hub (S08, ADR 0017);
   - client ad funds, the service-agency chart template, the Hub schema export and its examples;
   - Hub's opening snapshot, its register and the history replay (S10's Hub part, ADR 0019).
3. **Kept:**
   - companies, people, roles, two-factor sign-in and the audit log (S01, without API clients);
   - the chart of accounts with the general template, dimensions, currencies and rates (S02);
   - manual journal entries, approval, reversal, attachments, the integrity chain, the daily anchor and the full export (S03);
   - open items and settlements, for manual items only (S04); they serve suppliers', contractors' and workers' balances;
   - periods, the close and the month-end revaluation (S07);
   - reports, the journal book, Excel and PDF (S09), without the reports that only Hub's events fed;
   - the manual opening balances and the books start (S10, ADR 0019 without Hub);
   - deployment and backups (ADR 0020).
4. **Both ledgers stay as they are** (owner, 2026-11-13): every line keeps its transaction, book and parallel amounts, and ADRs 0005 and 0007 are unchanged. Each company chooses its book currency and may run without a parallel ledger (`admin:create-company --book-currency <ISO> --no-parallel`).
5. **Vertex Media's production company is archived, and its data kept** (owner, 2026-11-13). Ledger data is kept at least 10 years (`AGENTS.md`). Archiving a company is added with the removal if Mizan has no way to do it yet.
6. **How the removal runs:**
   - one PR per layer: the screens, then the API and the worker, then the ledger, the database and the contracts, then the scenario book and the docs;
   - each PR keeps `pnpm verify --e2e-all` green;
   - no ledger invariant, trigger, grant or guard of the remaining tables is weakened;
   - a migration that drops a table refuses to run while the table holds rows;
   - an entry whose source was a Hub event stays readable, so the entry sources keep their values;
   - the error codes, permissions and audit actions of removed features stay in their registries as retired, never reused (ADR 0006's rule on codes outlives it);
   - removed specs and scenarios stay in git history only.
7. **What is built next**, each through its own spec (`/spec`) and, for every posting rule, its scenario approved by the owner (`/posting-rule`):
   - cash boxes: receipts and payments in any currency;
   - expenses by project;
   - the wages of workers and craftsmen;
   - materials with quantities;
   - a contracting chart template.
8. **Out of scope:** an installed desktop version and work without a connection. The client's copy on a USB drive is the full export (S03).

## Consequences
- ADRs 0006, 0014, 0015 and 0017 read "Superseded by 0021". ADRs 0001, 0003 and 0019 read "amended by 0021".
- The phase 1 scope gets a new goal: the contracting client's books in Mizan. Its Hub features (F07, F10, F11, §6 and §7) are withdrawn.
- The roadmap's open Hub items are withdrawn. The removal and the new modules become the phase's tasks.
- The client's business data is never written to this public repository: the scenarios use synthetic data only.

## Open
- The client's book currency and whether they need statutory books in Syrian pounds. This is asked before their first company is created.
