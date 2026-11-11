# TASKS — S06 Revenue recognition (IFRS 15)

Spec: `docs/specs/S06-revenue-recognition.md` (Approved, owner, 2026-11-10) · ADR 0015 · Branch per PR: `feat/s06-<slice>`.
Owner approvals (2026-11-11): the PR split; the new outcome of `revenue/revenue-at-issue.md` "an invoice with a retainer line"; a closed month's release, in an invoice posted after the close, posts on the first open day at its carried amounts, and the numbers of its case in `revenue/recognise-in-open-period.md`.
The ledger functions already exist in `packages/ledger/src/recognition.ts` (merged with the scenarios); each PR wires them through the database, the inbox and the worker, and switches its scenarios to `Approved (owner, <date>)`.

## PR 1 — Foundation and over-time recognition (`feat/s06-over-time`)
- [x] Owner approval (2026-11-11): the new outcome of `revenue/revenue-at-issue.md` "an invoice with a retainer line" (posts through S06 instead of `NO_MAPPING`)
- [x] contracts: `milestone.reopened` v1 (the optional `service` on `milestone.done` moves to PR 2: oasdiff pairs a changed `oneOf` variant of `/v1/events` only when no variant is added in the same diff, so each `/v1` change goes in its own PR; Hub's `number` is already on the milestone's reference), the new hold details, the actions `recognise`/`split_remainder`, the slots `contract_liability`, `contract_asset`, `released_revenue`, `cancelled_project_refund`, `SERVICE_PERIOD_CLOSED` in `HOLD_CHECK_ORDER`, the permission `recognition.read`, the audit actions; i18n of each
- [x] ledger: `recognitionPatternOf()` (rule 1) and the over-time posting lines of `invoice.issued` (rules 2, 3, 7) on top of `hub.ts`; S05's `deferred_revenue` tests changed
- [x] db (`/db-migration`): `recognition_schedules`, `recognition_movements` (append-only, forced RLS, registry, remaining-never-below-zero trigger, unique `released` per month), the four slots (their defaults for existing companies at the worker's start), `open_items_hub_document_key` with the reference (one item per reference: a late line's contract assets, then one per done); invariant and isolation tests
- [x] db: the recognition service in the posting transaction: deferral at issue, elapsed months as contract-asset items, the release of ended months in a late invoice's transaction, the service change of a deferred line, `recognition_pattern_unclear`, `SERVICE_PERIOD_CLOSED` and the `recognise` action (the integrity check's new proof moves to PR 3, with the read API; `order_keys` to PR 2, with the milestones that use it)
- [x] scenario book: `revenue/over-time-release.md` (all cases but the closed-month one, which waits for S07's close) and `revenue/revenue-at-issue.md` run `Approved`
- [x] api: `POST /api/inbox/:id/recognise-in-open-period`; tests with another company and a missing permission
- [x] worker: `revenue.release-month` (daily at 01:00 Asia/Damascus and at start, every ended month missing its release; the template's slots mapped at start and in the sweep), the `revenue:run-release --month` command, the retry of every `NO_MAPPING` event at start; run-twice and race-with-close tests
- [x] bridge: OpenAPI regenerated, breaking-change check
- [x] checks and reviewers, PR with auto-merge and Auto-fix

## PR 2 — Milestones and projects (branch `claude/sleepy-brahmagupta-yzu2hv`, the cloud session's)
- [x] contracts: the optional `service` on `milestone.done` (S06 rule 11), alone among `/v1`'s changes in this PR; `orderKeysOf()` (rule 17); `splitRemainderSchema`
- [x] ledger: `invoiceIssuedPlan()` with deposit and milestone lines (rules 1, 2, 12, 15), `milestone.done` (rule 11), `milestone.reopened` (rule 13), `project.completed` (rule 14), `project.cancelled` and its split (rule 15), the void of a split invoice held `schedule_split_at_cancellation` (rule 8; the other voids of scheduled invoices stay held for PR 3); carried lines in a Hub entry; a held reopen never blocks (rule 17)
- [x] db (`/db-migration`): `inbound_events.order_keys` with its GIN index (rule 17, `btree_gin`); point-in-time schedules and their movements; the order check and the retries over the order keys (rules 17, 19); the split action; tests
- [x] scenario book: `revenue/milestones.md`, `revenue/cancelled-project.md` run `Approved`
- [x] api: `POST /v1/events` with `milestone.reopened` (idempotent replay), `POST /api/inbox/:id/split-remainder`; tests
- [x] bridge: OpenAPI regenerated, breaking-change check
- [x] checks and reviewers, PR with auto-merge and Auto-fix

## PR 3 — Credits, voids and re-issues; the read API (branch `claude/zealous-brahmagupta-fois39`, the cloud session's)
- [x] db: the integrity check's proof that each contract's `contract_liability` lines equal its schedules' movements
- [x] ledger/db: credits to a cycle (rule 6), voids of deferred invoices and of credits (rule 8), re-issues (rule 9), their holds and the retry of a credit when its cycle posts (`recognition_movements.credit_minor`, migration 0036)
- [x] scenario book: `revenue/retainer-credit.md`, `revenue/void-and-reissue.md` run `Approved` (one expected balance of `retainer-credit.md` corrected: needs the owner's approval)
- [x] api: `GET /api/revenue/schedules`, `/schedules/:id`, `/months`, `/preview` with `recognition.read`; tests
- [ ] property tests across a project's events in any order of arrival (spec "Acceptance")
- [x] bridge: OpenAPI regenerated, breaking-change check
- [ ] checks and reviewers, PR with auto-merge and Auto-fix

## PR 4 — Screens (`feat/s06-screens`)
- [ ] web: sidebar entry, `/revenue` (schedules and months tabs, decisions banner), `/revenue/:id`, the two actions on `/inbox/:id`, the contract asset item on `/open-items/:id`; i18n `ar.revenue`
- [ ] e2e: the flows and RTL screenshots, light and dark, at 360, 768 and 1280 px
- [ ] docs: ROADMAP, glossary, the commands table
- [ ] checks and reviewers, PR with auto-merge and Auto-fix; reset this file to its stub
