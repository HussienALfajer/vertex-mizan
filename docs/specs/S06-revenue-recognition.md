# S06 — Revenue recognition (IFRS 15)

Status: Approved (owner, 2026-11-10) · Date: 2026-11-10 · Features: `docs/product/phase-1-scope.md` F07 (and §6 "Invoices", for the events it posts) · ADRs: 0003, 0005, 0006, 0007, 0008, 0011, 0012, 0013, 0014, 0015

## Summary
Vertex Media bills retainers in advance for each cycle and bills projects by milestone, a first installment at quote acceptance. Today S05 holds every such invoice `NO_MAPPING` (`deferred_revenue`), together with `milestone.done`, `project.completed` and `project.cancelled`, so none of that revenue is in the books.

S06 brings the rules that recognise it as the service is delivered (IFRS 15.31, 15.35, 15.38):
- **over time** for a retainer cycle's charges and a manual line marked deferred: deferred at issue to contract liabilities and released evenly over the days of the service period, one entry per invoice per month, posted by a job on the first day of the next month and dated on the last day of the month;
- **at a point in time** for a milestone, the first installment ("deposit") included: revenue on the milestone's done date, from contract liabilities when it was invoiced before, or as a contract asset when it was not;
- credits, late issue, voids and re-issues, service changes, a completed project and a cancelled project's remainder, each with its dates and its exchange differences;
- the hold `SERVICE_PERIOD_CLOSED` and two inbox actions: recognise in the first open period, and split a cancelled project's remainder;
- the schedules and releases on screen, and the release item of S07's pre-close checklist.

When S06 deploys, the worker's start retries every `NO_MAPPING` event (S05 rule 10), so the invoices held since S05 post in Hub's order.

## In scope / out of scope
- In:
  - the recognition pattern of every invoice line (rule 1) and the posting rules of `invoice.issued` with deferred lines, their `invoice.voided` and `invoice.line_service_changed`, `milestone.done`, the new `milestone.reopened`, `project.completed` and `project.cancelled`;
  - recognition schedules and their movements (ADR 0015), the monthly release job, the release of a month already passed when its invoice posts late;
  - credits on retainer cycles (IFRS 15.87–88), late issue with the elapsed part through contract assets, `SERVICE_PERIOD_CLOSED`;
  - the accountant's actions: recognise in the first open period, split a cancelled project's remainder;
  - three new mapping slots, new hold details and inbox actions, the permission `recognition.read`;
  - the screens `/revenue` and `/revenue/:id`, the decision list, the new actions on `/inbox/:id`;
  - the checklist item "revenue releases posted" for S07.
- Out (later or never):
  - **S07:** the month-end revaluation of contract assets (monetary, per item; ADR 0007) and the close itself; S06 supplies the checklist item.
  - **S09:** the contract-position report and the balance sheet's netting per contract (IFRS 15.105, ADR 0007 "Reporting"), the profitability reports.
  - **S10:** opening schedules for invoices issued before the replay (cycles that straddle 2026-10-01 or 2026-10-19).
  - Tax lines: still held `NO_MAPPING` (`tax_lines`, S05).
  - Variable consideration estimates, significant financing components, contract costs (IFRS 15.50–59, 60–65, 91–104): none arise in Hub's billing today; any later need is a new spec.
  - Refunds to clients: Hub records them outside the system (Hub F13 edge case 11). The refund payable of a cancelled project is cleared by a manual entry.
  - Hub's side (open question Q5): built in Hub's sessions; the additions S06 needs are under "Migration and compatibility".

## Access
| Action | Surface | Who (role or permission) |
|---|---|---|
| Post a recognition event (`invoice.issued`, `milestone.done`, `milestone.reopened`, `project.*`) | API `POST /v1/events` | API client with `events:write` |
| Read schedules, releases and the month summary | Web `/revenue` | Owner, accountant, auditor (`recognition.read`, new) |
| Recognise in the first open period; split a cancelled project's remainder | Web `/inbox/:id` | Owner, accountant (`events.manage`) (owner, 2026-11-10) |
| Retry, resolve by a manual entry | Web `/inbox/:id` | Owner, accountant (`events.manage`, S05) |
| Dismiss | Web `/inbox/:id` | Owner (`events.dismiss`, S05) |
| Post the monthly releases | Worker | The jobs role lists companies; each company posts as `mizan_app` in `withCompany` (S05 "Jobs") |
| Map the three new slots | Web `/settings/posting-rules` | Owner, accountant (`posting_rules.manage`, S05) |

`recognition.read` is appended to the permission map in `packages/contracts` (owner, accountant and auditor; not the approver or the viewer, who read reports in S09) (owner, 2026-11-10).

## Data
Every company table has `company_id`, forced RLS with `company_isolation`, composite company foreign keys and its kind in the registry (ADR 0003, 0005, 0008, 0012). Money fields follow ADR 0007: transaction, book and parallel amounts in minor units with the currency, `bigint`.

### New tables (`recognition` module, ADR 0015)
| Table | Kind | Fields | Keys and checks |
|---|---|---|---|
| `recognition_schedules` | append-only | `id`, `company_id`, `event_id` → inbound_events (the `invoice.issued` that created it), `invoice_document_id` (uuid: Hub's invoice), `invoice_number` (text), `line_id` (uuid: Hub's line), `pattern` (`over_time` · `point_in_time`), `line_source` (Hub's line source), `charge_kind` (null, retainer charges), `service_from`, `service_to` (date, null for `point_in_time`), `milestone_id` (uuid, null for `over_time`), `cycle_key` (text, null: `<retainer external id>:<cycle_start>` for a retainer cycle's charges, rule 6), `reissue_of_schedule_id` (null) → schedules (rule 9), `client_value_id`, `contract_value_id` (null), `service_value_id` (at issue; later changes are movements), `liability_account_id` → accounts (the `contract_liability` account it was deferred to; releases debit this one, rule 14), `currency`, `created_at` | unique `(company_id, event_id, line_id)`; index `(company_id, cycle_key)`; index `(company_id, milestone_id)`; index `(company_id, contract_value_id)`; check `service_to >= service_from`; check the pattern's fields |
| `recognition_movements` | append-only | `id`, `company_id`, `schedule_id` → schedules, `kind` (`deferred` · `elapsed` · `released` · `credited` · `reclassified` · `reversed` · `remainder_released` · `remainder_refunded`), `month` (date, the first day; null when not a month's part), `entry_id` → journal entries, `transaction_minor`, `book_minor`, `parallel_minor` (signed: positive adds to what is still to recognise, negative takes from it), `service_value_id` (null; set on `reclassified`), `created_at` | unique `(company_id, schedule_id, month)` where `kind = 'released'` (a month releases once); index `(company_id, schedule_id, created_at)`; index `(company_id, entry_id)` |

- A schedule's **remaining** (what is still in contract liabilities for it) is the sum of its movements, in each ledger. Its **state** is derived: `active` while the remaining transaction amount is not zero and no `reversed` movement stands after its `deferred`; `completed` when it reaches zero by releases; `voided` after a void. The transaction remaining never goes below zero (a trigger: `RELEASE_EXCEEDS_BALANCE`, S04's code).
- Both tables are written only in the posting transaction, by the recognition service through `post()` (invariant 11: `post()` stays the only writer of the ledger; these rows describe its entries). The integrity check (S03) proves for each contract, in each ledger, that the `contract_liability` lines posted by S06's rules equal the schedules' movements.
- **Contract assets** are S04 `document` items on the `contract_asset` slot (`113001`, monetary): one per milestone done before its invoice (`hub_document` = the milestone, reference = Hub's milestone number), and one per invoice line for a late issue's elapsed part (rule 7; `hub_document` = the invoice, reference = `<invoice number>/<line position>`). They are revalued per item by S07 (ADR 0007).

### Changed
- **`inbound_events`** gains `order_keys` (text[], default empty): further item keys an event takes part in (rule 17), with a GIN index `(company_id, order_keys)`. Existing rows keep an empty array.
- **Mapping slots** (`posting_slot`, appended, never renamed; service-agency defaults):

  | Slot | Template account | Must be |
  |---|---|---|
  | `contract_liability` | `212001` | liability, postable, not monetary (IAS 21.16; ADR 0007) |
  | `contract_asset` | `113001` | a `document` control account, asset, monetary |
  | `released_revenue` | `411001` | revenue, postable |
  | `cancelled_project_refund` | `211003` | liability, postable, monetary |

  Like S05's, the migration fills the defaults for existing companies whose chart holds the codes; the general template's companies start unmapped and hold `NO_MAPPING` (`slot_unmapped:<slot>`).
- **Contracts** (`packages/contracts`, additive, ADR 0006): the event type `milestone.reopened` v1; an optional `service` and `number` on `milestone.done`; the hold details, inbox actions and slots below, appended to their lists and kept by the error-code guard. `SERVICE_PERIOD_CLOSED` already exists in `HOLD_REASONS`; it joins `HOLD_CHECK_ORDER` after `PERIOD_CLOSED`. The entry source `revenue_release` already exists (S03).

## States and rules
### Patterns
1. **The pattern of an invoice line** (`recognitionPatternOf(line)` in `packages/ledger`):

   | Line | Pattern | Facts it needs |
   |---|---|---|
   | `extra_work`; `manual` not deferred; `retainer_charge` `termination_fee` | at issue (S05) | — |
   | `retainer_charge` `monthly` or `addition` | over time, on `cycle_start`–`cycle_end` | both dates, the invoice's `contract` a retainer |
   | `manual` with `deferred: true` | over time, on `cycle_start`–`cycle_end` (its service period) | both dates |
   | `retainer_charge` `credit` | a credit to a cycle (rule 6) | `cycle_start`, the invoice's `contract` a retainer |
   | `deposit`, `milestone` | at a point in time: the milestone's done date | `milestone_id`, the invoice's `contract` a project |

   A line without the facts its pattern needs, or with `cycle_end` before `cycle_start`, holds the invoice `NEEDS_DECISION` (`recognition_pattern_unclear:<line position>`): Hub's payload is already valid (S05 rule 1), so it is held for the accountant rather than refused (phase 1 scope F07, "lines whose pattern is unclear"). A deposit is its milestone's installment invoiced in advance and follows its milestone (owner, 2026-11-10); `installment_total` is no longer read.
2. **An invoice is posted as one entry** on its accounting date (`issued_on`): Dr `receivable`, one document item for the invoice's total (S05); and per line, by its pattern, Cr `revenue_at_issue`/`termination_fee_revenue` (at issue), Cr `contract_liability` (over time, the part not elapsed, rule 7; point in time when the milestone is not done), Cr the milestone's contract asset item (point in time when done, rule 11), the credit's lines (rule 6), and the realised exchange difference of any residual (ADR 0013). One invoice is never split (IFRS 15.31 applied to the contract once).

### Over time
3. **Daily straight line** (scope Q3a): a line's amount is spread over the days of its service period, both ends included, actual days (a leap day counts). The part of month *m* is cut with cumulative rounding by days (ADR 0007 "Allocation"): `round(A × days up to the end of m ÷ total days) − round(A × days up to the end of m−1 ÷ total days)`, separately in the transaction amount and in each ledger's amount still to recognise, so the parts sum exactly and the last part clears what remains.
4. **The monthly release** (owner, 2026-11-10): for each invoice with an active over-time schedule that touches month *m*, one entry dated on the last day of *m*, source `revenue_release`, posting request key `release:<invoice event id>:<YYYY-MM>`: per schedule Dr the schedule's `liability_account_id` / Cr `released_revenue`, with the client, the contract and the schedule's current service, at the schedule's part of *m* in every ledger. The amounts are carried (ADR 0007): no rate is read and the entry balances in every ledger by construction. Description: "تحرير إيراد <invoice number> عن <YYYY-MM>".
5. **When releases post** (owner, 2026-11-10): the job `revenue.release-month` posts month *m* at 01:00 Asia/Damascus on the first day of *m*+1, and again at the worker's start and in the daily 04:00 sweep for any past month still open whose release is missing. An invoice that posts after its month's job has run (an event received late, or held and retried) posts in the same transaction the release of every month that has ended since its issue, each dated on that month's last day. The current month is never released before it ends; `/revenue` shows its preview.
6. **A credit** (`retainer_charge` `credit`, negative; scope §6 "Credit lines"; IFRS 15.87–88): it reduces the cycle it names, found by `cycle_key` (the invoice's retainer and the line's `cycle_start`) among the active over-time schedules of that cycle's `monthly` and `addition` lines, in proportion to each schedule's transaction amount net of earlier credits, with cumulative rounding in the order the schedules were created (owner, 2026-11-10: the amount still to recognise in liabilities is zero on a fully released cycle). On each schedule, on the credit invoice's date:
   - the share already recognised (its releases and elapsed parts ÷ its amount net of earlier credits, `round(part × (N − R) ÷ N)`) reduces revenue: Dr `released_revenue` with the schedule's service, a new measurement at the credit invoice's rates (cumulative catch-up, IFRS 15.88);
   - the rest reduces what is still to recognise: Dr the schedule's liability account at the schedule's carried amounts for that transaction amount, in proportion to what remains in each ledger (a `credited` movement); the months not yet released then cut the smaller remainder by their days in every ledger (prospective);
   - the residual of the invoice's entry in each ledger is a realised exchange difference (ADR 0013 "Residuals of entries with carried lines");
   - an invoice whose total the credit brings to zero (Hub F05B rules C5, C7) has no receivable line and opens no item (owner, 2026-11-10).

   `packages/ledger`'s `creditParts()` and `remainingReleaseParts()` compute it (`revenue/retainer-credit.md`).

   No schedule for the cycle: `UNKNOWN_REFERENCE` (`credit_cycle`), retried when the cycle's invoice posts. The cycle's schedules voided: `NEEDS_DECISION` (`credit_cycle_voided`). A credit larger than the cycle's amount net of earlier credits: `NEEDS_DECISION` (`credit_exceeds_cycle`). Parts already released are never rewritten (scope §6).
7. **Late issue** (scope §6; A5): the months of a line's service period that ended before the month of `issued_on` are its elapsed months. For each, one entry dated on that month's last day, source `hub_event`, key `<event id>:elapsed:<YYYY-MM>`: Dr the line's contract asset item (`contract_asset`) / Cr `released_revenue`, the month's part (rule 3) as a new measurement at each ledger's policy rate of that last day (the document's `syp_per_usd` is of another date and is not read; IAS 21.21–22). The invoice's entry then credits that item for the elapsed transaction amount at its carried amounts and `contract_liability` for the rest as a new measurement; the residual is a realised exchange difference. Days of the issue month are released with the month (rule 4). An elapsed month that is closed holds the invoice `SERVICE_PERIOD_CLOSED` (rule 15). A line whose period ended before the issue month entirely is all elapsed, and its schedule completes at issue.
8. **A void** (`invoice.voided`; scope §6; owner, 2026-11-10): the exact reversal of every entry still standing for the invoice, latest first, dated on the void date (S05 rule 14): its releases, its elapsed entries, its issue entry (which also reverses its credits to other cycles: their `credited` movements are reversed, so those cycles' remainders grow back from the void on). Each schedule takes a `reversed` movement and becomes `voided`. Revenue recognised in earlier months is taken back in the void's month (IFRS 15.88 cumulative catch-up); closed months keep their figures. A void whose invoice's schedule has been reduced by a credit from another invoice still standing is held `NEEDS_DECISION` (`schedule_credited`). A void with standing payments is held `OPEN_ITEM_HAS_SETTLEMENTS` (S05).
9. **A re-issue** (owner, 2026-11-10): an over-time line of the same `cycle_key` and charge kind, or a point-in-time line of the same milestone, as a voided schedule is its re-issue (`reissue_of_schedule_id`). What the void took back (the months released and elapsed before it, in transaction amount and days) is recognised on the re-issue's own date, as revenue at issue on `released_revenue`, a new measurement; the months after the void follow rules 3–7. So the void's month and the re-issue's month together show the cycle's revenue once, and an earlier month is never recognised twice. For a milestone done before the void, the re-issue's line is revenue at issue.
10. **A service change** (`invoice.line_service_changed` on a deferred line; scope §6): Dr `released_revenue` with the old service / Cr with the new, for what the line has released so far and its elapsed part, at their carried amounts in both ledgers, dated on the change date; a `reclassified` movement carries the new service, which later releases use (prospective). A point-in-time line not yet done changes only its schedule's service.

### At a point in time (milestones)
11. **`milestone.done`** (owner, 2026-11-10; IFRS 15.38, 15.B15 output method by milestones), dated on `done_on`, with the milestone's service (Hub's `service`, rule 18):
    - **invoiced before** (a standing point-in-time schedule for the milestone): Dr its liability account / Cr `released_revenue` at the schedule's carried amounts (a `released` movement; source `hub_event`). The milestone's amount must equal the schedule's transaction amount (Hub locks an invoiced milestone's installment, Hub F13 rule 25); otherwise `NEEDS_DECISION` (`milestone_amount_differs`);
    - **not invoiced**: Dr a new contract asset item for the milestone (`contract_asset`, the client and the project) / Cr `released_revenue`, the installment as a new measurement at each ledger's policy rate of `done_on` (`milestone.done` carries no rate of Hub's);
    - a second `milestone.done` while the first stands: `NEEDS_DECISION` (`milestone_already_done`), nothing posted.
12. **The milestone's invoice** (scope §6 "Milestone invoice issued"), when the milestone is done and not invoiced: Cr its contract asset item at the item's carried amounts for the line's amount, up to the item's open amount. A line amount different from the item's open amount in the invoice's currency (a change in the transaction price, IFRS 15.87–88): the invoice is held `NEEDS_DECISION` (`milestone_amount_differs`). A residual in a ledger once the item is cleared is a realised exchange difference (IAS 21.28).
13. **`milestone.reopened`** (new event, owner, 2026-11-10), dated on `reopened_on`: the exact reversal of the milestone's done entry. Invoiced before, the schedule's remaining grows back; not invoiced, its contract asset item closes. Hub refuses to reopen an invoiced milestone that was done before its invoice (Hub F13 rule 25), so an item with other movements than its opening holds the event `OPEN_ITEM_HAS_SETTLEMENTS`. A reopen with no done standing is `UNKNOWN_REFERENCE`.
14. **`project.completed`** (scope §6, "Completed project"), dated on `on`: what remains of the project's point-in-time schedules (a milestone invoiced and never reported done) is released to `released_revenue` at its carried amounts, one entry. Nothing remaining: `recorded` (no entry). Contract assets stay until their invoices. A schedule's liability account stays the one it was deferred to, even if the slot is remapped (Data).
15. **`project.cancelled`** (scope §6; owner, 2026-11-10), dated on `on`: nothing remaining: `recorded`. Otherwise held `NEEDS_DECISION` (`cancelled_project_remainder`), with the remaining amount per schedule shown. The accountant **splits the remainder** (rule 16): a transaction amount to revenue (0 to the remaining) and the rest to the client as a refund payable (IFRS 15.B21, 15.106 by analogy: consideration to be refunded is a liability). One entry dated on `on`: Dr each schedule's liability account at its carried amounts; Cr `released_revenue` for the revenue part at the carried share (cumulative rounding by transaction amount); Cr `cancelled_project_refund` for the rest, a new measurement at each ledger's policy rate of `on` (a monetary liability, IAS 21.23(a)); the residual is a realised exchange difference (ADR 0013). A manual entry could not do this, because it remeasures the non-monetary liability at the day's rate (ADR 0012).

### Holds and actions
16. **New inbox actions** (`events.manage`; owner, 2026-11-10), each with a written reason, an `inbound_event_actions` row and an audit row:
    - **Recognise in the first open period**, for `SERVICE_PERIOD_CLOSED` only: the elapsed parts of the closed months post as one entry dated on the first day of the first open period after them, each part measured at the policy rates of its own month's last day (as S05 rule 15 measures a moved event; IAS 21.21–22). The parts of open elapsed months post on their own dates (rule 7). The late part is recognised in the current period; where the accountant judges the omission material, IAS 8.42 requires a restatement instead, which phase 1 does by reopening the month (S07), not by this action.
    - **Split the remainder**, for `NEEDS_DECISION` `cancelled_project_remainder` only: `{ revenueAmount, reason }`, rule 15.

    S05's actions remain: retry, resolve by a manual entry (for `NEEDS_DECISION`), dismiss by the owner, and reopening the closed month in S07.
17. **Order** (S05 rule 11, extended): an `invoice.issued` with a deposit or milestone line also takes part in the order key `milestone:<id>` of each, and in `project:<id>` of its project; `milestone.done` and `milestone.reopened` also in `project:<id>`. So a `milestone.done` received after a held invoice of its milestone waits behind it (`WAITING_FOR_EARLIER_EVENT`), and a project's completion or cancellation after held events of its project. Any order of arrival then posts what Hub's order posts. S05's two exceptions stay: an event held `UNKNOWN_REFERENCE` (a credit waiting for its cycle, a reopen before its done) never blocks.
18. **Holds in order** (S05 rule 8, `HOLD_CHECK_ORDER`): `WAITING_FOR_EARLIER_EVENT`, `UNKNOWN_REFERENCE`, `NO_MAPPING`, `PERIOD_CLOSED` (the accounting date), `SERVICE_PERIOD_CLOSED` (an elapsed month), `RATE_MISSING` (the issue date, an elapsed month's last day, `done_on`, a cancellation's `on`), `OPEN_ITEM_HAS_SETTLEMENTS`, `NEEDS_DECISION`. New details: `recognition_pattern_unclear`, `credit_cycle`, `credit_cycle_voided`, `credit_exceeds_cycle`, `schedule_credited`, `milestone_amount_differs`, `milestone_already_done`, `milestone_service_missing` (a `milestone.done` without `service`, rule 11), `cancelled_project_remainder`.
19. **Automatic retries** (S05 rule 10, extended): a period reopened retries its `SERVICE_PERIOD_CLOSED` events; a cycle's invoice posted retries the credits waiting for it; a milestone's done posted retries its reopen. The worker's start after S06's deploy retries every `NO_MAPPING` event, so the invoices held `deferred_revenue` since S05 post.

## Accounting treatment
The accounts are the mapped slots (Data); dimensions as S05 rule 2 (revenue with client, service and the contract; receivable with client and contract; contract asset and contract liability with client and contract). Every rule is a scenario, approved before its code (Scenarios).

| Operation | Entry | Basis |
|---|---|---|
| Retainer charge or deferred manual line at issue | Dr `receivable` / Cr `contract_liability` (and the elapsed part, rule 7) | IFRS 15.106 (consideration due before the service is transferred) |
| Monthly release | Dr `contract_liability` / Cr `released_revenue`, carried | IFRS 15.35(a), 15.39–41 (over time, output by time elapsed); ADR 0007 |
| Elapsed month of a late issue | Dr `contract_asset` item / Cr `released_revenue`, new at the month end; cleared at issue | IFRS 15.107; A5 |
| Credit to a cycle | Dr `released_revenue` (released share, new) and Dr `contract_liability` (rest, carried); residual realised | IFRS 15.87–88; ADR 0013 |
| Milestone invoiced before done | Dr `receivable` / Cr `contract_liability`; at done Dr `contract_liability` / Cr `released_revenue`, carried | IFRS 15.106, 15.38 (owner, 2026-11-10) |
| Milestone done before its invoice | Dr `contract_asset` item / Cr `released_revenue`, new at `done_on`; the invoice Dr `receivable` / Cr the item, carried, residual realised | IFRS 15.107; IAS 21.16, 21.28 |
| Void | the exact reversals, latest first, on the void date | ADR 0005, 0012; IFRS 15.88 (owner, 2026-11-10) |
| Re-issue | what the void took back as revenue on the re-issue date; the rest as rules 3–7 | IFRS 15.88 (owner, 2026-11-10) |
| Service change | Dr revenue old service / Cr new service, carried | scope §6 |
| Reopened milestone | the exact reversal of the done entry | owner, 2026-11-10 |
| Completed project | Dr `contract_liability` / Cr `released_revenue`, carried, for what remains | scope §6 |
| Cancelled project | Dr `contract_liability` carried / Cr `released_revenue` (carried share) and `cancelled_project_refund` (new); residual realised | IFRS 15.B21, 15.106; IAS 21.23 (owner, 2026-11-10) |

Contract liabilities are non-monetary and never revalued; contract assets are monetary and revalued per item at month end by S07 (ADR 0007; IAS 21.16, 21.23). No Syrian legal or tax rule is relied on beyond the bulletin policy (UNVERIFIED, open question Q1, adopted by the owner).

**Examples** (Vertex Media, `syp-usd`, USD invoices so the parallel ledger takes the amount as is; synthetic rates):

| Event | Date | Account | USD | Book (SYP) |
|---|---|---|---|---|
| Retainer cycle 15 Nov–14 Dec (30 days), INV-2026-0020, bulletin 121.0000 | 11-15 | Dr `112001` / Cr `212001` | 900.00 | 108,900.00 |
| Release November (16 days) | 11-30 | Dr `212001` / Cr `411001` | 480.00 | 58,080.00 |
| Release December (14 days) | 12-31 | Dr `212001` / Cr `411001` | 420.00 | 50,820.00 |
| Late issue: cycle 20 Oct–19 Nov (31 days), 620.00 USD, elapsed October (12 days) at the bulletin in force on 31 Oct, 119.0000 | 10-31 | Dr `113001` item / Cr `411001` | 240.00 | 28,560.00 |
| Its invoice INV-2026-0021, bulletin 120.5000 | 11-05 | Dr `112001` | 620.00 | 74,710.00 |
| | | Cr `113001` item (carried) | −240.00 | −28,560.00 |
| | | Cr `212001` | −380.00 | −45,790.00 |
| | | Cr `421001` realised gain | 0.00 | −360.00 |
| Deposit: milestone M1 300.00 USD invoiced, bulletin 120.0000 | 11-03 | Dr `112001` / Cr `212001` | 300.00 | 36,000.00 |
| M1 done | 11-20 | Dr `212001` / Cr `411001` (carried) | 300.00 | 36,000.00 |
| M2 400.00 USD done, not invoiced, bulletin 122.0000 | 12-01 | Dr `113001` item M2 / Cr `411001` | 400.00 | 48,800.00 |
| M2's invoice, bulletin 123.0000 | 12-03 | Dr `112001` | 400.00 | 49,200.00 |
| | | Cr `113001` item M2 (carried) | −400.00 | −48,800.00 |
| | | Cr `421001` realised gain | 0.00 | −400.00 |
| Another project cancelled with its deposit M1 (300.00 USD at 120.0000) invoiced and not done; split 100.00 to revenue, 200.00 to refund; bulletin 124.0000 | 12-10 | Dr `212001` (carried) | 300.00 | 36,000.00 |
| | | Cr `411001` (carried share) | −100.00 | −12,000.00 |
| | | Cr `211003` (new, × 124) | −200.00 | −24,800.00 |
| | | Dr `541001` realised loss | 0.00 | 800.00 |

## Currencies, rates and rounding
- Hub sends SYP and USD only (S05); the `third` shape cannot occur. The scenarios cover `syp`, `syp-usd` and `usd-syp`.
- **Carried** (no rate read): releases, a credit's unreleased part, the clearing of a contract asset item, reversals, service reclassifications, a completed project's remainder, a cancelled project's revenue part (ADR 0007 "New measurements versus carried amounts"; IAS 21.23(b), IFRIC 22).
- **New measurements:** the issue's receivable and its contract-liability and at-issue lines (S05: the book ledger at the bulletin of `issued_on`, the parallel at `market` or Hub's `syp_per_usd` where accepted); a credit's released share (the credit invoice's rates); an elapsed month's contract asset and revenue (each ledger's policy rate of the month's last day, never Hub's rate of another date); a milestone done before invoice (the policy rates of `done_on`); a re-issue's catch-up (the re-issue's rates); a cancelled project's refund payable (the policy rates of `on`).
- **Allocation:** days across months, a credit across a cycle's schedules and a cancelled remainder's revenue share use cumulative rounding, each ledger separately (ADR 0007 "Allocation"); the last part takes what remains, so a schedule whose transaction remaining reaches zero is zero in both ledgers.
- **Residuals:** an entry with a carried line posts each ledger's residual as a realised difference to the gain or loss role account by its sign (ADR 0013). An entry of new measurements in one currency posts its rounding to `conversion_rounding` (S05).
- **A missing policy rate** for a date a rule reads holds the event `RATE_MISSING` (ADR 0007). A release never needs a rate, so a missing bulletin never delays a release.

## Periods
- A release is dated on the last day of its month; the job runs only for months that have ended and are open. An invoice posted late releases the ended months at once (rule 5).
- An elapsed month that is closed holds the invoice `SERVICE_PERIOD_CLOSED`; it posts after a reopen (S07) or by the action of rule 16.
- Voids, credits, service changes, reopens and project events are dated on their own date; closed months keep their figures.
- **S07's pre-close checklist** gains: "revenue releases posted" for the month: every active over-time schedule touching the month has its `released` movement for it. (S05's item, no held event dated in the month, covers `SERVICE_PERIOD_CLOSED` and the recognition holds.) A close that races the release job: `post()` takes the period with a share lock (ADR 0008), so the release either posts before the close or the close refuses on the checklist.

## API
| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /v1/events` | `events:write` | gains `milestone.reopened` v1 `{ milestone, client, project, reopened_on }`; `milestone.done` gains optional `service` | as S05 | as S05 |
| `GET /api/revenue/schedules?state=&client=&contract=&month=&cursor=` | `recognition.read` | filters | page of schedules: invoice number, line, client, contract, service, pattern, period or milestone, amount, released, remaining (both ledgers), state | `VALIDATION_FAILED` |
| `GET /api/revenue/schedules/:id` | `recognition.read` | — | the schedule, its movements with entries, the planned part of each month | `NOT_FOUND` |
| `GET /api/revenue/months?from=YYYY-MM&to=YYYY-MM` | `recognition.read` | at most 24 months | per month: released in both ledgers, entries count, schedules missing their release, the decision count | `VALIDATION_FAILED` |
| `GET /api/revenue/preview?month=YYYY-MM` | `recognition.read` | the current or a past open month | the releases the job would post | `VALIDATION_FAILED` |
| `POST /api/inbox/:id/recognise-in-open-period` | `events.manage` | `{ reason }` | the event | `EVENT_NOT_HELD`, `EVENT_ACTION_NOT_ALLOWED` |
| `POST /api/inbox/:id/split-remainder` | `events.manage` | `{ revenueAmount: MinorUnits, reason }` | the event | `EVENT_NOT_HELD`, `EVENT_ACTION_NOT_ALLOWED`, `VALIDATION_FAILED` (outside 0 to the remaining) |

No new error code. `/v1` stays additive (ADR 0006): a new event type and an optional field; `installment_total` stays accepted and unread. Clients accept the new details and actions they do not know.

## Jobs and events
| Job | Queue and trigger | Safe twice because |
|---|---|---|
| `revenue.release-month` | pg-boss cron 01:00 Asia/Damascus on day 1 for the month that ended; at worker start and in the 04:00 sweep for any ended open month missing a release | each invoice's month posts under `release:<invoice event id>:<YYYY-MM>` and the unique `released` movement; a posted month does nothing |
| `events.retry` (S05) | gains the triggers of rule 19 | as S05 |

A release that cannot post (its revenue slot unmapped or the account blocked) leaves the month's release missing: `/revenue` shows the schedule with the reason, the checklist blocks the close, and S05's daily email lists it under "تحرير الإيراد".

Events received: `milestone.reopened` v1 (new), the S06 events of the catalogue. Events emitted: none.

## Screens
| Route | Purpose and content | Actions | States | Who |
|---|---|---|---|---|
| Sidebar | "الاعتراف بالإيراد" | — | — | `recognition.read` |
| `/revenue` | Tabs "الجداول" and "الأشهر". Schedules: invoice number, client, contract, service, pattern (موزع على المدة · عند إنجاز المرحلة), period or milestone, amount, released, remaining in the selected ledger (book · parallel), state; filters by client, contract, state, month. Months: per month released in both ledgers, the release entries, schedules missing a release with the reason, "معاينة الشهر الجاري". A banner with the count of recognition decisions linking to `/inbox` filtered to them | Open a schedule; open the entries; open the decisions | Empty: "لا جداول اعتراف بعد"; loading skeleton; error with retry | `recognition.read` |
| `/revenue/:id` | The schedule: the invoice and its event, the line, the pattern, the service history; each month's planned part and its posted release (Amount in both ledgers); credits, elapsed parts, voids and re-issues with their entries | Open the event, the invoice item, the entries | Not found | `recognition.read` |
| `/inbox/:id` (S05) | For `SERVICE_PERIOD_CLOSED`: the elapsed parts per closed month and the first open period's date. For `cancelled_project_remainder`: the remainder per schedule in both ledgers, an Amount input for the revenue part and the refund it leaves, and the entry it will post | "اعتراف في أول فترة مفتوحة"; "تقسيم المتبقي" | Read-only for the auditor | `events.read`; actions `events.manage` |
| `/open-items/:id` (S04) | A contract asset item shows its milestone or its invoice line | — | — | per S04 |

No new `packages/ui` component: the screens use `DataGrid`, `Amount`, `AmountInput`, `EventStateBadge` and the ledger switch.

## Reports
- No report in S06. S09's income statement reads `411001`'s lines; its contract-position report nets `113001` and `212001` per contract (IFRS 15.105).
- `/revenue`'s figures reconcile to the ledger: for each contract and ledger, the remaining of the schedules equals the `contract_liability` lines of S06's rules (the integrity check), and a month's released total equals its release entries.

## Printing and legal books
None new. Release entries print in the journal book (S09) with their description in Arabic and their number, like any entry.

## Volume and performance
- Vertex Media: about 20 retainers and 5–10 projects, 30–60 active schedules, 20–40 release entries a month, a few contract asset items.
- The job posts a company's month in under a minute; `/revenue` answers within 1 s for 5,000 schedules (indexes above, cursor pages). The order check reads `order_keys` with the GIN index.

## Migration and compatibility
- New tables, the `order_keys` column (empty for existing rows), four slots with their defaults for existing companies, the new details, actions and the event type, the permission. No ledger data changes.
- `revenue/revenue-at-issue.md`'s case "an invoice with a retainer line held `NO_MAPPING` `deferred_revenue`" no longer holds: its expected outcome changes through `/posting-rule` with the owner's approval. S05's `ledger` tests of `deferred_revenue` change the same way.
- **Hub must send** (open question Q5, added): on `milestone.done`, the milestone's service and number; the new `milestone.reopened` when a done milestone is reopened; on a credit line, its `cycle_start` with the invoice naming its retainer; on a deposit line, its `milestone_id`; on a manual line marked deferred, its service period in `cycle_start` and `cycle_end`; `project.completed` and `project.cancelled` with their dates.

## Arabic strings and number formats
- `ar.revenue`: الاعتراف بالإيراد، جدول الاعتراف، موزع على المدة، عند إنجاز المرحلة، المحرَّر، المتبقي، تحرير الشهر، معاينة الشهر الجاري، الجزء المنقضي، إشعار دائن، إعادة إصدار، المتبقي في مشروع ملغى، مستحق الرد للعميل؛ the states (نشط، مكتمل، ملغى).
- `ar.inbox` gains the reason "فترة خدمة مغلقة" (exists), the details above in Arabic, the event type "إعادة فتح مرحلة", and the actions "اعتراف في أول فترة مفتوحة" and "تقسيم المتبقي".
- Months as `YYYY-MM`, dates `YYYY-MM-DD`, Latin digits, amounts through Amount.

## Audit
Each posted entry has its audit row from `post()` (releases with the jobs role as actor). `event.recognised_in_open_period` and `event.remainder_split` (with the reason and, for the split, the amounts) in `audit_entries` and as `inbound_event_actions` rows. `posting_rule.mapped` for the new slots (S05).

## Abuse and failure cases
- **Replays and double runs:** the release key per invoice and month, the unique `released` movement, the event keys `<event id>:elapsed:<YYYY-MM>` (invariant 5).
- **A release racing a close:** the share lock on the period (ADR 0008) and the checklist item.
- **Out-of-order events:** the order keys of rule 17; a credit before its cycle and a reopen before its done are `UNKNOWN_REFERENCE`.
- **A double done** (Hub reopened without the event): `milestone_already_done`, nothing posts twice.
- **Cross-company access:** schedules and movements under forced RLS; a schedule's events, items and entries share its company by composite keys.
- **Silent divergence from Hub:** a resolved or dismissed recognition event marks its document (S05 rule 16); S08 compares Hub's invoices with the inbox.
- **A slot remapped mid-schedule:** releases debit the account the schedule was deferred to (Data), so the liability always clears.

## Edge cases
1. A cycle crossing a month: 15 Nov–14 Dec releases 16/30 and 14/30.
2. A leap day: a cycle 15 Feb–14 Mar 2028 has 29 February in its 29 days.
3. A cycle inside one month: one release at that month's end.
4. An addition issued mid-cycle: spread over the whole cycle (scope Q3a); the months already ended are elapsed (rule 7).
5. An invoice issued in advance of its cycle (`issued_on` before `cycle_start`): no elapsed part; months before `cycle_start` release nothing.
6. An invoice received after its month's job ran: its ended months release in its own transaction (rule 5).
7. A credit to a cycle fully released: all of it reduces revenue on the credit's date.
8. A credit to a cycle not released at all: all of it reduces the schedule; no revenue line.
9. A credit and a monthly charge on one invoice: one entry, the credit's lines and the new cycle's deferral.
10. A void after two releases, then a re-issue the next month: the void takes both months back on its date; the re-issue recognises them on its date and defers the rest.
11. A milestone invoiced in advance and voided before done, then done: the done finds no standing schedule and opens a contract asset.
12. A milestone done, its invoice amount differs from the installment: `milestone_amount_differs`; resolved by a manual entry or after Hub corrects the invoice.
13. A deposit as the project's only milestone: released at its done; `project.completed` finds nothing left (`recorded`).
14. A project cancelled with nothing invoiced in advance: `recorded`; done milestones' contract assets stay for their invoices.
15. A split of zero revenue (all refunded) and of the whole remainder (all revenue): both allowed; the residual line only where a refund part exists.
16. A service change on a fully released line: the whole released revenue moves to the new service.
17. Shapes: `syp` (one ledger, no parallel, no residual from a parallel), `syp-usd` (Vertex Media), `usd-syp` (the book ledger in USD: an SYP invoice's lines convert at the book policy; elapsed months at each ledger's policy of the month end).
18. A missing bulletin on an elapsed month's last day that is a day off: the last published one applies (ADR 0011); on a publication day without one: `RATE_MISSING`.
19. A cycle that straddles the replay's start (2026-10-19): its invoice predates the replay and has no event; S10's opening schedule carries it.
20. An invoice dated 31 December whose cycle runs into January: the January release is numbered in the new fiscal year (ADR 0012).

## Scenarios
Each written and approved through `/posting-rule` before its code:
- **`revenue/over-time-release.md`** (new): a cycle across two months; a cycle in one month; a leap day; cumulative rounding with an amount that does not divide by the days; an addition mid-cycle; a late issue with an open elapsed month (the contract asset and its realised difference); a late issue into a closed month held `SERVICE_PERIOD_CLOSED`, then recognised in the first open period; an invoice posted after its month's job; a deferred manual line; a line with an unclear pattern held; a service change; in `syp-usd`, `syp` and `usd-syp`.
- **`revenue/retainer-credit.md`** (new): a credit split between the released share and the remaining, with its realised difference; a credit to a fully released cycle; a credit before its cycle's invoice (`UNKNOWN_REFERENCE`, then posted); a credit to a voided cycle and one exceeding the cycle (held); the void of the credit invoice; the void of a credited cycle held `schedule_credited`.
- **`revenue/milestones.md`** (new): a deposit invoiced and released at its milestone's done; a milestone done before its invoice (the contract asset and the realised difference at invoice); an invoice differing from the installment (held); a reopen of a done milestone and its new done; a second done held; a done received behind its held invoice (`WAITING_FOR_EARLIER_EVENT`); `project.completed` with a remainder and without; in `syp-usd`, `syp` and `usd-syp`.
- **`revenue/void-and-reissue.md`** (new): a void after releases and an elapsed part, the exact reversals latest first; a re-issue the next month recognising what the void took back on its date; a milestone's invoice voided after done and re-issued.
- **`revenue/cancelled-project.md`** (new): a cancellation with nothing remaining (`recorded`); a remainder held, split between revenue and the refund payable with its realised difference; all to revenue; all refunded.
- **`revenue/revenue-at-issue.md`** (changed): the case of the invoice with a retainer line now posts through S06's rules instead of holding `NO_MAPPING`; the owner approves the new outcome.

## Open questions
- **Q5 (Hub's side):** stays open; S06 adds what Hub must send (Migration). Hub's code read on 2026-11-10 (`packages/db/src/schema/{retainers,projects,invoices}.ts`, `docs/specs/F04`, `F05`, `F13`): a deposit is the first milestone's installment, billed at acceptance (F13 rule 2); a done milestone can be reopened while not invoiced (F05 rule 8, F13 rule 25) and no event exists for it yet; credits relate to an issued cycle and are taken off a later cycle's draft (F05B C5).
- None blocks the spec.

## Acceptance
- **The owner's end-to-end check** (a test company with the service-agency template, `syp-usd`, Hub's examples posted with the API client's key):
  1. Record the bulletins in `/rates`: 29 October 119.0000, 3 November 120.0000, 15 November 121.0000, 1 December 122.0000, 3 December 123.0000, 10 December 124.0000. Releases read no rate.
  2. Post an `invoice.issued` for a retainer cycle 2026-11-15 to 2026-12-14, 900.00 USD: `201 posted`; the entry shows Dr `112001` 108,900.00 SYP / 900.00 USD, Cr `212001`; `/revenue` shows the schedule with 900.00 remaining and November's preview 480.00 / 58,080.00.
  3. Run the release job for November (`pnpm --filter @vertex-mizan/worker revenue:run-release --month 2026-11`, added with the slice): one entry dated 2026-11-30, Dr `212001` / Cr `411001` 480.00 USD / 58,080.00 SYP; running it again posts nothing.
  4. Post a `milestone.done` for a 400.00 USD milestone not invoiced, dated 2026-12-01 at 122.0000: Dr `113001` item / Cr `411001` 48,800.00; then its invoice on 2026-12-03 at 123.0000: the item clears and `421001` shows 400.00 SYP gain.
  5. Post a `project.cancelled` for a project whose deposit (300.00 USD) is invoiced and not done: held `NEEDS_DECISION` "المتبقي في مشروع ملغى"; split 100.00 to revenue: the entry of the example appears.
  6. Close October, then post an invoice whose cycle started on 20 October: held "فترة خدمة مغلقة"; "اعتراف في أول فترة مفتوحة" posts the October part on 1 November.
- **Tests:**
  - API: every new endpoint with success, 401, 403 (role), another company's ids, the actions' wrong reasons; `/v1` with `milestone.reopened` and an idempotent replay;
  - unit and property tests in `packages/ledger`: the day split sums exactly for any period and amount and never changes a posted part; every rule's lines balance in both ledgers; a schedule whose remaining transaction amount reaches zero is zero in every ledger through any sequence of releases, credits, voids and re-issues; any order of arrival of a project's events posts what Hub's order posts;
  - the scenario book: the six scenarios above `Approved` and run;
  - invariant tests: the two tables append-only under forced RLS, the remaining never below zero, a month released once, the integrity check's new proof;
  - the job: run twice, run after a late invoice, run racing a close;
  - E2E with RTL screenshots: `/revenue` (both tabs), `/revenue/:id`, `/inbox/:id` with each new action, at 360, 768 and 1280 px in light and dark.
