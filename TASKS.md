# TASKS — S06 Revenue recognition (IFRS 15)

Spec: `docs/specs/S06-revenue-recognition.md` (Approved, owner, 2026-11-10) · ADR 0015 · Branch per PR: `feat/s06-<slice>`.
Owner approvals: the PR split and the new outcome of `revenue/revenue-at-issue.md` "an invoice with a retainer line" (2026-11-11).
The ledger functions already exist in `packages/ledger/src/recognition.ts` (merged with the scenarios); each PR wires them through the database, the inbox and the worker, and switches its scenarios to `Approved (owner, <date>)`.

## PR 1 — Foundation and over-time recognition (`feat/s06-over-time`)
- [x] Owner approval (2026-11-11): the new outcome of `revenue/revenue-at-issue.md` "an invoice with a retainer line" (posts through S06 instead of `NO_MAPPING`)
- [x] contracts: `milestone.reopened` v1, optional `service`/`number` on `milestone.done`, the new hold details, the actions `recognise`/`split_remainder`, the slots `contract_liability`, `contract_asset`, `released_revenue`, `cancelled_project_refund`, `SERVICE_PERIOD_CLOSED` in `HOLD_CHECK_ORDER`, the permission `recognition.read`, the audit actions; i18n of each
- [x] ledger: `recognitionPatternOf()` (rule 1) and the over-time posting lines of `invoice.issued` (rules 2, 3, 7) on top of `hub.ts`; S05's `deferred_revenue` tests changed
- [ ] db (`/db-migration`): `recognition_schedules`, `recognition_movements` (append-only, forced RLS, registry, remaining-never-below-zero trigger, unique `released` per month), `inbound_events.order_keys` with its GIN index, the slot defaults, `open_items_hub_document_key` expanded for one item per done; invariant and isolation tests
- [ ] db: the recognition service in the posting transaction: deferral at issue, elapsed months as contract-asset items, the release of ended months in a late invoice's transaction, the service change of a deferred line, `recognition_pattern_unclear`, `SERVICE_PERIOD_CLOSED` and the `recognise` action; the integrity check's new proof
- [ ] scenario book: `revenue/over-time-release.md` (all cases but the closed-month one, which waits for S07's close) and `revenue/revenue-at-issue.md` run `Approved`
- [ ] api: `POST /api/inbox/:id/recognise-in-open-period`; tests with another company and a missing permission
- [ ] worker: `revenue.release-month` (01:00 Asia/Damascus on day 1, at start and in the 04:00 sweep), the `revenue:run-release --month` command, the retry of every `NO_MAPPING` event at start; run-twice and race-with-close tests
- [ ] bridge: OpenAPI regenerated, breaking-change check
- [ ] checks and reviewers, PR with auto-merge and Auto-fix

## PR 2 — Milestones and projects (`feat/s06-milestones`)
- [ ] ledger/db: deposit and milestone lines at issue (rules 1, 2, 12), `milestone.done` (rule 11), `milestone.reopened` (rule 13), `project.completed` (rule 14), `project.cancelled` and its split (rule 15), the order keys `milestone:<id>` and `project:<id>` (rule 17), the retries of rule 19
- [ ] scenario book: `revenue/milestones.md`, `revenue/cancelled-project.md` run `Approved`
- [ ] api: `POST /v1/events` with `milestone.reopened` (idempotent replay), `POST /api/inbox/:id/split-remainder`; tests
- [ ] bridge: OpenAPI regenerated, breaking-change check
- [ ] checks and reviewers, PR with auto-merge and Auto-fix

## PR 3 — Credits, voids and re-issues; the read API (`feat/s06-credits-voids`)
- [ ] ledger/db: credits to a cycle (rule 6), voids of deferred invoices and of credits (rule 8), re-issues (rule 9), their holds and the retry of a credit when its cycle posts
- [ ] scenario book: `revenue/retainer-credit.md`, `revenue/void-and-reissue.md` run `Approved`
- [ ] api: `GET /api/revenue/schedules`, `/schedules/:id`, `/months`, `/preview` with `recognition.read`; tests
- [ ] property tests across a project's events in any order of arrival (spec "Acceptance")
- [ ] bridge: OpenAPI regenerated, breaking-change check
- [ ] checks and reviewers, PR with auto-merge and Auto-fix

## PR 4 — Screens (`feat/s06-screens`)
- [ ] web: sidebar entry, `/revenue` (schedules and months tabs, decisions banner), `/revenue/:id`, the two actions on `/inbox/:id`, the contract asset item on `/open-items/:id`; i18n `ar.revenue`
- [ ] e2e: the flows and RTL screenshots, light and dark, at 360, 768 and 1280 px
- [ ] docs: ROADMAP, glossary, the commands table
- [ ] checks and reviewers, PR with auto-merge and Auto-fix; reset this file to its stub
