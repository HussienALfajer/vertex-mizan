# TASKS — S10 Opening balances and Hub history replay

Spec: `docs/specs/S10-opening-balances-replay.md` (Approved, owner 2026-11-12) · ADRs 0003, 0005, 0006, 0007, 0008, 0011, 0012–0019 · Scenarios (entries approved by the owner 2026-11-12, `Proposed` until the PR that brings their executors): `opening/opening-entry.md` (PR 1), `reports/opening-presentation.md` (PR 3), `opening/before-books-start.md` (PR 4). Five PRs, each merged before the next starts: `feat/s10-opening-ledger`, `feat/s10-opening-api`, `feat/s10-opening-reports`, `feat/s10-before-books-start`, `feat/s10-screens`.

Plan approved by the owner (2026-11-13, in the session).

## PR 1 — The opening in the ledger (contracts, ledger, db, scenarios) · `feat/s10-opening-ledger`
- [x] contracts: `opening.ts` (Hub's snapshot `openingSnapshotSchema` with rule 6's checks, `openingSnapshotTotals()` and the result, the draft's input `saveOpeningSchema`, `postOpeningSchema`, `OPENING_STATES`, `OPENING_CHECKS`, `OPENING_FIGURE_SLOTS`); `events.ts` shares `invoiceIssuedFieldsV1` and `checkIssuedInvoice()` (no change on the wire); `stated` appended to `LINE_KINDS`, `before_opening` to `REVENUE_MOVEMENT_KINDS`, `pre_opening_result` to `ACCOUNT_ROLES` (equity), `before_books_start` to `HOLD_DETAILS`; `opening.read`, `opening.prepare`, `opening.post` and `opening:write`; the seven error codes with their Arabic text; the audit actions `company.books_start_set` and `opening.*`; unit tests (the company's `booksStart` and the view's wire schema arrive with the API, PR 2)
- [ ] ledger: `opening.ts` — Hub's part from a snapshot (rule 11), the schedules' opening by S06's functions with credits before the eve (rule 13), the measurement of each line (rule 17), the balancing figure per ledger (rules 18–19), the line order (rule 23), the records' agreement and the checks that need no database (rule 21), the fingerprint; `stated` in the line kinds; properties: the schedules equal what S06 leaves after posting the same invoices on their dates, the entry balances in both ledgers, the balancing figure is the only remainder, the opening plus its reversal nets to zero
- [ ] db (`/db-migration`): `companies.books_start` with its check and the lock of rule 2 (`BOOKS_START_LOCKED`); `opening_snapshots` (append-only), `openings` (draft then guarded), `opening_lines`, `opening_record_figures` (draft, writable only while draft); `stated` and its guard (source `opening` only); `recognition_schedules.event_id` nullable with `opening_id` and the one-of check; `before_opening`; `312002` with its role in a new template version and in existing companies holding `312`; months before the books start closed (rule 4); registry, forced RLS, composite keys, pinned `GUARDS`; drift and the migration guard clean
- [ ] db: `services/opening.ts` — store a snapshot (idempotent by key and hash, Hub's values found or created), read the view, save the draft (`version`, `OPENING_CHANGED`), post through `post()` (a new `PostingContent`: items, schedules with two movements, the opening `posted`, audit) and the whole reversal (rule 25, `OPENING_NOT_REVERSIBLE`); `OPENING_NOT_POSTED` in the inbox, manual posting and approval, revaluation, release and close (rule 3); `test/opening.test.ts` (guards as the app role and the owner, the state guard, `stated` refused outside an opening, the lock, a schedule with exactly one of event and opening, races, another company) and S10's rows in the isolation property
- [ ] scenarios: the company's `books_start`, the `opening` and `reverse_opening` executors, registered in `bookHarness`; `opening/opening-entry` `Approved (owner, 2026-11-12)`, no expected value changed, its eight cases run
- [ ] wiring (Contracts, Ledger, Database), docs (`packages/contracts`, `ledger`, `db`, `scenarios`, `i18n` `CLAUDE.md`, `docs/glossary.md`, `docs/scenarios/README.md`, `docs/ROADMAP.md`)
- [ ] checks and reviewers (`reviewer`, `accountant-reviewer`), PR with auto-merge and Auto-fix

## PR 2 — The opening's API, commands and worker (api, worker, contracts tooling, bridge) · `feat/s10-opening-api`
- [ ] contracts: the company's `booksStart` and `openingState`, `booksStart` in `updateCompanyLedgersSchema`, the view `openingViewSchema` (MinorUnits), the example snapshot in `hub-examples.ts`
- [ ] api: `POST /v1/opening/snapshot` (`opening:write`, `Idempotency-Key`, 5 MB, `OPENING_POSTED`, `NO_BOOKS_START`); `GET`/`PUT /api/opening`, `POST /api/opening/post` and `/reverse` (owner, reauthenticated); `booksStart` in `PUT /api/company/ledgers` and the company's `openingState`; `OPENING_NOT_POSTED` (`503`, `Retry-After: 3600`) on `/v1/events` and on `/api` entries, revaluation and close; `admin:create-company --books-start`; tests (every endpoint's success, `401`, `403`, another company, the snapshot's replay and `409`, its validation)
- [ ] worker: the release and revaluation jobs skip a company whose opening is not posted; the daily digest's line "الأرصدة الافتتاحية لم تُرحَّل بعد"; tests
- [ ] contracts tooling: the snapshot's JSON Schema and example in `export:hub-schema`; `post:hub-examples --opening`
- [ ] bridge: OpenAPI regenerated, `pnpm check:openapi` passes
- [ ] wiring (API and worker), docs (`AGENTS.md` commands, `apps/api/CLAUDE.md`, `apps/worker/CLAUDE.md`, `docs/ROADMAP.md`)
- [ ] checks and reviewers (`reviewer`, `accountant-reviewer`), PR with auto-merge and Auto-fix

## PR 3 — The opening in the reports (ledger, db, scenarios, api) · `feat/s10-opening-reports`
- [ ] ledger and db: rules 31–33 in the readers — the year's result with `312002` in the books start's year and inside retained earnings later, the opening column at the books start, a range before the books start read from it, the marks `opening_entry`, `before_books_start` and `pre_opening_result_in_equity`; the journal book from the opening as entry 1; tests
- [ ] scenarios: the readers' marks and `year_result_pre_opening`; `reports/opening-presentation` `Approved (owner, 2026-11-12)`, its two cases run
- [ ] api: the marks in the report answers; OpenAPI regenerated if they change it
- [ ] wiring, docs (`docs/ROADMAP.md`)
- [ ] checks and reviewers (`reviewer`, `accountant-reviewer`), PR with auto-merge and Auto-fix

## PR 4 — Documents before the books start (contracts, ledger, db, scenarios, api, worker) · `feat/s10-before-books-start`
- [ ] contracts and ledger: a manual line's `schedule` (Hub's invoice and line), the residual on retained earnings of a correction on its own (rule 28), the refusals `VALIDATION_FAILED`
- [ ] db: the register of prior documents read from the posted snapshot (an expression or GIN index); the holds `before_books_start` in the inbox for the event types of rule 28; a held opening void freezing its schedules' release and making a credit to their cycles wait; on dismissal or a resolution that leaves a schedule, each missed month released on its own last day, then the waiting events retried; rule 29's reclassification from the books start; tests
- [ ] scenarios: the register, the `schedule` line; `opening/before-books-start` `Approved (owner, 2026-11-12)`, its seven cases run
- [ ] api and worker: the manual line's `schedule`; the release job honouring the freeze; tests of every event type of rule 28
- [ ] bridge: OpenAPI regenerated, `pnpm check:openapi` passes
- [ ] wiring, docs (`docs/ROADMAP.md`)
- [ ] checks and reviewers (`reviewer`, `accountant-reviewer`), PR with auto-merge and Auto-fix

## PR 5 — The screens (ui, web, e2e) · `feat/s10-screens`
- [ ] ui: any component `/opening` needs that `packages/ui` lacks (a step layout, the agreement table), tested, both densities, on the design-system page
- [ ] web: `/opening` in four steps (Hub, the records' grid with computed and stated lines, the agreement, the review with the checks and their links), save, post and reverse dialogs with two-factor, every state of the spec; "تاريخ بدء الدفاتر" in `/settings/company` with its lock; "قيد افتتاحي" on `/entries/:id`; the sidebar and palette entries; Excel of the preview and the agreement; `ar.opening`, `ar.settings.booksStart`, the report marks and the hold detail
- [ ] e2e: `/opening` through its steps, the failing checks, the post dialog, the posted and reversed states, the books start in `/settings/company`; RTL screenshots light and dark at 360, 768 and 1280 px, looked at
- [ ] wiring (Web), docs (`apps/web/CLAUDE.md`, `packages/ui/CLAUDE.md`, `docs/ROADMAP.md`: S10 done)
- [ ] checks and reviewer, PR with auto-merge and Auto-fix; reset this file to its "No task in progress" stub
