# TASKS

## S11 The contracting chart and cash boxes (`docs/specs/S11-contracting-chart-cash.md`)

Four PRs, in order. PR 4 needs only PR 1 and may run beside PRs 2 and 3.

### PR 1 — counterparties, cash kinds and `contracting@1` (branch `feat/s11-counterparties-template`)

- [x] contracts: `contracting@1` in `chart-templates.ts` and `CHART_TEMPLATE_IDS`; `supplier` and `worker` in `BUILTIN_DIMENSION_TYPES`; `COUNTERPARTY_TYPES`, `CASH_KINDS`, `counterpartyType` and `cashKind` on the account schemas and `checkAccountShape` (`canBeCashAccount`); the three S11 error codes appended in the spec's order with their Arabic text; template data tests (statement lines, roles, control accounts with their counterparty type, cash kinds only on eligible accounts, codes, names)
- [x] ledger: rule 4 (`counterpartyOf()`, `OPEN_ITEM_MISMATCH` for a counterparty of another type; a running line may carry a contract) with tests; the cash-kind eligibility is contracts' `canBeCashAccount()`, rule 5's required dimension the services'
- [x] db (`/db-migration`, 0062–0064): enums `counterparty_type` and `cash_kind`, the two columns with their checks and the first-use lock; existing control accounts set to `client`; `supplier` and `worker` built-in types for every company (audit `dimension_type.created`, actor `system`); `open_items.client_value_id` → `counterparty_value_id`, its unique key, the counterparty-type guard pinned in `GUARDS`; template application of `contracting@1`; the posting function and item reads on the renamed column; conventions, invariants and new tests; the running item's movement guard and the rename's exception (owner, 2026-11-14, ADR 0022); the contracts' S04 schemas renamed to counterparty with the db reads
- [x] scenarios: the runner accepts `template: contracting`; the book still passes (100 run, 24 skipped)
- [x] api: the open-items module on the renamed contracts; `PATCH /api/accounts/:id` with `counterpartyType` and `cashKind` (audited before/after); `GET /api/chart/templates` lists `contracting@1`; S04 endpoints renamed (`/api/running-balances`, `/api/counterparties/:valueId/statement`, `counterparty` and `counterpartyType` filters); `admin:create-company --template contracting`; tests with another company and a missing permission
- [ ] bridge: build, OpenAPI export and its check, client types
- [ ] web: the account sheet's counterparty type and cash kind (locked after first use); `/receivables/clients/:valueId` → `/counterparties/:valueId` with a redirect; the receivables screens on the renamed endpoints with the type filter; the template choice in company creation; i18n (`chart`, `dimensions`, `open-items`)
- [ ] e2e: the account sheet and the counterparty statement specs updated; screenshots looked at
- [ ] docs: ROADMAP, glossary rows (counterparty, counterparty type, supplier, worker, subcontractor, retention, progress billing, advance from a client), AGENTS.md command (`--template contracting`), folder CLAUDE.md files
- [ ] checks and reviewers, PR with auto-merge and Auto-fix

### PR 2 — vouchers and the box rule (branch `feat/s11-vouchers`)

- [ ] contracts: `cash.ts` (voucher header, voucher, cash position, statement), drafts gain `voucher`, audit actions (`cash_count.recorded`, `export.cash_statement`, `export.cash_position`, `export.voucher`)
- [ ] ledger: the voucher shapes (rules 10–13), the derived dealt rate (rule 12, 10 decimals, half away from zero), the count's difference lines, the box check's arithmetic (the minimum running balance from a date); property tests (balance in both ledgers, differences in one ledger, reversal nets to zero, the box never negative at any date under any order of back-dated postings and reversals)
- [ ] db (`/db-migration`): enum `voucher_kind`; `voucher_sequences` and `cash_vouchers` (append-only, RLS, composite keys, registry, guards); the drafts' voucher columns; `post()` takes the voucher number (gapless, per kind and fiscal year), writes the voucher, sets the reference, builds a count's lines and refuses a stale one, and takes a per-box lock after the head lock for rule 8 on every entry; the integrity check's voucher comparisons; concurrency tests (gapless numbers, two payments from one box)
- [ ] scenarios: the `voucher` executor (receipt, payment, transfer, count) and the `vouchers` reader; the three `cash/` files switched to `Approved (owner, 2026-11-14)` and run, with no expected value changed
- [ ] api: drafts with the voucher header, preview with the derived rate and a count's expected amount and difference, post and approve; `GET /api/cash/accounts`, `/api/cash/accounts/:id/statement`, `GET /api/vouchers`, `GET /api/vouchers/:id`; tests (success, 401, 403, another company, idempotent replay)
- [ ] bridge: build, OpenAPI export and its check, client types
- [ ] docs: ROADMAP, glossary rows (cash account, box, voucher, receipt, payment, transfer voucher, currency exchange, cash count, cash shortage and overage), folder CLAUDE.md files
- [ ] checks and reviewers (reviewer and accountant-reviewer), PR with auto-merge and Auto-fix

### PR 3 — cash screens, printing and exports (branch `feat/s11-cash-screens`)

- [ ] i18n: `amountInWords(minor, currency)` with its table of tests; the `cash` namespace; the command palette's entries
- [ ] worker: the voucher PDF (A5, Arabic, amount in words, signature lines, "ملغى" with the reversal's number) and the cash statement PDF
- [ ] api: `/api/cash/accounts/:id/statement/export` (xlsx, pdf), the cash position export, `/api/vouchers/:id/pdf`, audited; tests
- [ ] ui: `VoucherHeader` and `CashAccountPicker` in `packages/ui`, tested, both densities, on the design-system page
- [ ] web: `/cash`, `/cash/:accountId`, `/cash/vouchers`, `/cash/vouchers/new/:kind` and the voucher draft in `/drafts/:id`; cancel as a reversal; S09's account statement gains the voucher column
- [ ] e2e: the cash position, a receipt, an exchange, a count, a statement, a printed voucher; RTL screenshots light and dark at phone, tablet and desktop, looked at
- [ ] docs: ROADMAP, folder CLAUDE.md files
- [ ] checks and reviewers, PR with auto-merge and Auto-fix

### PR 4 — the scenario book on `contracting@1` (branch `test/s11-book-on-contracting`)

- [ ] The 13 files naming `template: service-agency` switched to `template: contracting` per the spec's mapping table, each case creating the accounts the template lacks; no expected amount changed
- [ ] `packages/scenarios/src/agency-chart.ts` deleted; the book passes
- [ ] The owner approves the mapping and the moved files (quoted in the PR); docs: ROADMAP, `packages/scenarios/CLAUDE.md`
- [ ] checks and reviewers, PR (auto-merge only after the owner's approval)

## Carried over

- [ ] Follow-up (reviewer, not blocking, ADR 0020 deployment): the migrations still run as `vertexmizan`, which can read the owner URL from the migration's environment during a deploy; a dedicated migration user, or connection logging on `mizan_owner`, closes it
- [ ] Owner: replace the two B2 application keys and the mailbox password shown during the setup (the server still used them at 14:32 UTC on 2026-11-13): new values in `/etc/mizan/backup.env` and the password in `shared/.env`, provisioning run again, then the old keys deleted in B2
