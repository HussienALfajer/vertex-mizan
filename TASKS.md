# TASKS — S09 Reports

Spec: `docs/specs/S09-reports.md` (Approved, owner 2026-11-12) · ADRs 0003, 0005, 0006, 0007, 0008, 0009, 0010, 0011, 0015, 0016, 0018 · Scenario: `reports/statement-presentation.md` (numbers approved by the owner 2026-11-12, `Proposed` until PR 1 brings its readers). Three PRs, each merged before the next starts: `feat/s09-report-readers`, `feat/s09-exports`, `feat/s09-screens`.

Plan note (for the owner's approval): the scenario book runs through `packages/db` and `packages/contracts`, never `apps/*`, so the journal book's pagination and canonical rows (rules 27, 31) are one pure function in `packages/ledger`, called by the scenario runner in PR 1 and by the worker's render in PR 2 — one function, as rule 31 asks, outside `apps/worker`.

## PR 1 — The report readers (contracts, ledger, db, scenarios, api, bridge)
- [ ] contracts: `reports.ts` (every report's query and rows, the marks, `REPORTS`, `JOURNAL_BOOK_ROWS_PER_PAGE` and the column widths, the canonical row shape, the lines drill-down, the service-department schemas); `reports.read` appended to `PERMISSIONS` for every role; error codes `REPORT_TOO_LARGE` (422) and `DIMENSION_FROM_HUB` (409) appended with their Arabic text; audit actions `service_department.set` and the `export.*` actions of S09; the optional `department` on Hub's service reference (`/v1`, additive), its JSON Schema and examples; unit tests
- [ ] ledger: pure presentation — trial-balance levels and totals (rule 9), statement lines and subtotals (rules 13–14), the year's result and unclosed years (rule 16), netting per contract (rule 17), counterparties on their own side with notes (rule 18), profitability and the margin (rules 20–23), the comparative defaults (rule 5), the marks (rule 4), the journal book's paginator and canonical rows (rules 26, 27, 31); unit and property tests (rule 8's agreements over random books in every currency shape; a month alone paginates as within the year; page totals carry forward; nothing overflows)
- [ ] db (`/db-migration`): `service_departments` append-only (forced RLS, composite keys, type trigger, source check, closed-period guard, registry, grants, guards pinned in `GUARDS`); the posting transaction adds a department row from Hub (rule 33); the manual row (rule 34); the migration generated and reviewed
- [ ] db: the report service — readers in one `REPEATABLE READ` snapshot from `period_balances` and partial-month lines: trial balance, general ledger, account statement, journal, income statement, balance sheet, profitability, contract position, revenue schedule, the lines behind a figure; tests (agreements of rule 8, drill-down sums, isolation, `service_departments` invariants)
- [ ] scenarios: the `reports` expectation reader, `contracts`, the service's department and the `service_department` step; `reports/statement-presentation` `Approved (owner, 2026-11-12)`, no expected value changed, counted as run
- [ ] api: `reports` module (`GET /api/reports/*` of the spec's API table but exports and files, `reports.read`), `GET`/`POST /api/dimensions/values/:id/departments`; tests (success, 401, 403, another company's ids `NOT_FOUND`, `DIMENSION_FROM_HUB`, `PERIOD_CLOSED`)
- [ ] bridge: OpenAPI regenerated, breaking-change check
- [ ] wiring (Contracts, Ledger, Database, API), docs (`packages/*/CLAUDE.md`, `apps/api/CLAUDE.md`, `docs/glossary.md`, `docs/open-questions.md` Q5, `docs/ROADMAP.md`)
- [ ] checks and reviewers (`reviewer`, `accountant-reviewer`), PR with auto-merge and Auto-fix

## PR 2 — Exports and the journal book (contracts, db, ui print, api, worker, bridge)
- [ ] db (`/db-migration`): `report_files` (queue, state updates only by the jobs role in the company context) and `journal_book_prints` append-only; registry, grants, guards
- [ ] api: Excel export of every report (rule 35, `REPORT_TOO_LARGE`, audited); `POST`/`GET /api/reports/files`, download (`report_file.downloaded`), `GET /api/reports/journal-book/prints` with `superseded`; the official print's `PERIOD_NOT_CLOSED`; three queued files per user (`RATE_LIMITED`); PDF for the ageing, the client statement and the chart; tests
- [ ] ui: `print/` layout (A4, company header, "صفحة n من m", the journal book's footer), rendered to static HTML; tested
- [ ] worker: `reports.render` (one snapshot, Chromium, the official print's refusal and register row with `journal_book.printed` in one transaction, safe twice), `reports.files-expire`; tests
- [ ] bridge: OpenAPI regenerated, breaking-change check
- [ ] wiring, docs (`AGENTS.md` commands if any, `apps/worker/CLAUDE.md`, `docs/ROADMAP.md`)
- [ ] checks and reviewers (`reviewer`, `accountant-reviewer`), PR with auto-merge and Auto-fix

## PR 3 — The screens (ui, web, e2e)
- [ ] ui: `ReportTable`, `ReportMarks`, `ExportMenu`, tested, both densities, on the design-system page
- [ ] web: "التقارير" in the sidebar and the command palette; `/reports` and every report route of the spec's screens table; `/reports/lines`; the print register; the service's department history on `/dimensions`; PDF in `/receivables` and `/chart`; `ar.reports`
- [ ] e2e: the trial balance with drill-down, the balance sheet with a reclassification note, profitability, the official print and the register, an export; RTL screenshots light and dark at 360, 768 and 1280 px, looked at
- [ ] wiring (Web), docs (`apps/web/CLAUDE.md`, `packages/ui/CLAUDE.md`, `docs/ROADMAP.md`: S09 done)
- [ ] checks and reviewer, PR with auto-merge and Auto-fix; reset this file to its "No task in progress" stub
