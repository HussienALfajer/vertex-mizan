# TASKS

## S12 Project costs (`docs/specs/S12-project-costs.md`)

Four PRs, in order. Each PR switches its scenario files to `Approved (owner, 2026-11-16)` with no expected value changed.

### PR 1 — materials, project terms, purchase invoices and wage sheets (branch `feat/s12-project-documents`)

- [x] contracts: `projects.ts` (materials, project terms and budget, subcontracts, the project document header and kinds, the document read); drafts gain `projectDocument` and the lines' `materialId`, `unit`, `quantity`, `unitPrice`, `advanceMinor`; `requiresMaterial` on accounts and on `511001` of `contracting@1`; the seven error codes appended with their Arabic text; audit actions; `lineAmount()` in the money module with its tests
- [x] ledger: `buildProjectDocument()` for `purchase` and `wage_sheet` (rules 4–11), the IFRIC 22 covered amounts of an applied advance (rule 12, cumulative rounding per ledger); property tests (balance in both ledgers, covered amounts sum to the clearing line, no residual from the advance, reversal nets to zero)
- [x] db (`/db-migration`, `0070`–`0071`): enum `project_document_kind`; `materials`, `project_terms`, `project_budgets`, `subcontracts`; `chart_accounts.requires_material` with its check, lock and the `contracting@1` companies set; `line_quantities`, `advance_applications`, `project_documents`, `project_document_sequences` (append-only, RLS, composite keys, registry, guards); the drafts' columns; `post()` numbers documents per kind and fiscal year, writes quantities and applications, enforces rule 4 on every entry and the deferred guard of rule 12; `chainEntryValue()` unchanged for entries without quantities; conventions, invariants, isolation and concurrency tests (gapless numbers)
- [x] scenarios: the `project_document` executor, the `materials` and `subcontracts` setups, the `projectDocuments` and `quantities` readers; `projects/purchase-invoice.md` and `projects/wage-sheet.md` switched to `Approved` and run
- [x] api: `/api/materials`, `/api/projects/:valueId/terms`, `/api/subcontracts`; `requiresMaterial` on the account sheet; drafts, preview and posting of purchases and wage sheets; `GET /api/project-documents` and `/:id`; tests (success, 401, 403, another company, idempotent replay)
- [x] bridge: build, OpenAPI export
- [x] docs: ROADMAP, glossary rows, folder CLAUDE.md files
- [x] checks and reviewers (reviewer and accountant-reviewer: an advance held only on its own side; the material read `FOR SHARE`, migration `0072`; the guards tested against forged writes and the chain checked), PR with auto-merge and Auto-fix

### PR 2 — billings and retention releases (branch `feat/s12-billings`)

- [x] ledger: `buildProjectDocument()` for `progress_billing`, `subcontract_billing` and `retention_release` (rules 14–20: the cumulative chain, deductions, recovery capped at the project's share, the release cleared at the project's share); property tests (deductions sum to the period's value, the net never negative)
- [x] db (`0073`): `project_sequence` per project or subcontract under lock; `PROJECT_TERMS_LOCKED` after the first billing; the cancellation order (rule 22, `PROJECT_DOCUMENT_NOT_LATEST`); concurrency tests (two billings of one project)
- [x] scenarios: `projects/progress-billing.md`, `projects/subcontract-billing.md` and `projects/retention-release.md` switched to `Approved` and run (owner, 2026-11-16, after the reviews: a billing's or release's cancellation is exact, with no S04 rule 13 difference, refused while a later payment or release stands; a billing's items named `مستخلص <fiscal year>/<number>`)
- [x] api: drafts, preview and posting of the three kinds with their warnings; reversal refusals; tests
- [x] docs: ROADMAP, folder CLAUDE.md files
- [x] checks and reviewers (reviewer: the chain keyed by the project, the items' names, the guard's chain branch tested, exact cancellation held by later clearings, differences and a crossing's addition; accountant-reviewer: a subcontract billing cancelled after its release), PR with auto-merge and Auto-fix

### PR 3 — the project report, material quantities, exports and prints (branch `feat/s12-project-report`)

- [x] contracts and db: the project list, the project report and the material quantities reads; `REPORTS` gains `project_report`, `material_quantities`, `project_document`; the `material` filter of `/api/reports/lines`; reconciliation tests against S09's profitability
- [x] scenarios: the `project_report` reader; `reports/project-report.md` switched to `Approved` and run
- [x] api: `GET /api/projects`, `/api/projects/:valueId/report`, `/api/reports/material-quantities`, their xlsx exports (audited); tests
- [x] worker: the PDFs of the five documents (billings A4 with the net in words, purchase A5, wage sheet A4 landscape), the project report and material quantities
- [x] docs: ROADMAP, folder CLAUDE.md files
- [x] checks and reviewers (reviewer: a reversed payment counted as paid, every route tested as another company's member; accountant-reviewer: a payment on account, a subcontractor's revalued retentions shared over its projects, a billing's terms kept as posted, `0075`–`0076`), PR with auto-merge and Auto-fix

### PR 4 — the screens (branch `feat/s12-screens`)

- [x] ui: `QuantityCell`, `MaterialPicker`, `BillingSummary` and `BudgetVarianceBar` in `packages/ui`, tested, both densities, on the design-system page
- [x] i18n: namespaces `projects` and `materials`, the error codes' texts
- [x] web, documents: `/materials`, `/projects/:valueId/terms` with subcontracts, `/projects/documents`, `/projects/documents/new/:kind` and the document draft in `/drafts/:id` (preview with covered parts and warnings), cancel as a reversal, print; "يتطلب مادة" on the account sheet; quantities on manual entries and payment vouchers
- [x] web, reports: `/projects` and `/projects/:valueId` (the report's tabs, drill-down, Excel and PDF), `/reports/material-quantities`; the palette's entries
- [ ] e2e: materials catalogue, a purchase invoice with quantities, a wage sheet, a billing with its print, the projects list and a project report; RTL screenshots light and dark at phone, tablet and desktop, looked at
- [ ] docs: ROADMAP (S12 done), folder CLAUDE.md files
- [ ] checks and reviewer, PR with auto-merge and Auto-fix; `TASKS.md` reset to its stub

## Carried over

- [ ] Follow-up (reviewer, not blocking, ADR 0020 deployment): the migrations still run as `vertexmizan`, which can read the owner URL from the migration's environment during a deploy; a dedicated migration user, or connection logging on `mizan_owner`, closes it
- [ ] Owner: replace the two B2 application keys and the mailbox password shown during the setup (the server still used them at 14:32 UTC on 2026-11-13): new values in `/etc/mizan/backup.env` and the password in `shared/.env`, provisioning run again, then the old keys deleted in B2
