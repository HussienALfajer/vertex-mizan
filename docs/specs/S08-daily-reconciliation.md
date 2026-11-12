# S08 — Daily reconciliation

Status: Draft · Date: 2026-11-12 · Features: `docs/product/phase-1-scope.md` F11 (and F09's checklist item "the reconciliation is clean") · ADRs: 0003, 0005, 0006, 0008, 0013, 0014, 0016, 0017

## Summary
Hub posts every financial event to Mizan through its outbox (S05). An event can still go missing: Hub's outbox stalls, an event is refused at receipt and never corrected, or a bug in either system sends the wrong date or amount. Until S08 nothing shows it, and S07's close cannot prove that a month holds every Hub event dated in it, so no real month is closed (S07 "Out").

S08 brings:
- **the daily report** Hub sends for each accounting date: every event it created for that date with its type and amount, and the counts and totals per type and currency (ADR 0006, refined by ADR 0017);
- **the comparison** of each date's latest report with the events Mizan received for that date, down to the event: what is missing on either side, what differs, and what Mizan holds or handled by the accountant's decision;
- **`GET /v1/events?date=`**, so Hub finds what Mizan has;
- **the checklist item `reconciliation_clean`**, which S07's close requires, with no override;
- the reconciliation screens and a section of the daily 08:00 email.

S08 posts nothing.

## In scope / out of scope
- In:
  - `POST /v1/reconciliation/daily` and `GET /v1/events?date=` under the scope `reconciliation:write` (defined by S05);
  - the reports kept append-only, a date's latest report superseding the earlier ones;
  - the comparison per client and date, computed on read;
  - each client's reconciliation start date (`reconcile_from`) on `/settings/api-clients`;
  - the checklist item `reconciliation_clean` (appended to S07's `CHECKLIST_ITEMS`);
  - the screens `/reconciliation` and `/reconciliation/:date`, the checklist's link, the sidebar entry;
  - the reconciliation section of `events.held-digest`;
  - the report's JSON Schema and example in `export:hub-schema` and `post:hub-examples`.
- Out (later or never):
  - **Balances** (owner, 2026-11-12): S08 compares events, not Hub's open invoices or wallet balances. The entries' correctness is the scenario book's; Mizan and Hub differ on an item only through a flagged manual movement (ADR 0013), which the comparison lists. Comparing opening balances with Hub is S10's (F12).
  - **Accepting a difference** (owner, 2026-11-12): no one marks a day reconciled. A difference clears only through data: Hub sends the event, or a corrected report for the date.
  - **Exports** of the reconciliation (F13 lists the reports that export; this is a working screen).
  - **Hub's side** (Q5): the outbox's report, built in Hub's sessions against this contract.

## Access
| Action | Surface | Who (role or permission) |
|---|---|---|
| Send a date's report | API `POST /v1/reconciliation/daily` | API client with `reconciliation:write` |
| List the events Mizan received for a date | API `GET /v1/events?date=` | API client with `reconciliation:write` |
| Read the reconciliation (days, a day's comparison, the reports) | Web `/reconciliation` | Owner, accountant, auditor (`reconciliation.read`) |
| Set or change a client's reconciliation start date | Web `/settings/api-clients` | Owner with a fresh two-factor code (`api_clients.manage`, S05) |
| Read the checklist item | Web `/periods/:period` | `periods.read` (S07) |

`reconciliation.read` is appended to the permission map: owner, accountant and auditor; approver and viewer do not hold it. A client reads and reports only its own events: the company and the client come from the key (ADR 0003, 0006).

## Data
Company tables have `company_id`, forced RLS with `company_isolation`, composite company foreign keys and their kind in the registry (ADR 0003, 0005, 0008). Money fields follow ADR 0007.

### New tables (`reconciliation` module)
| Table | Kind | Fields | Keys and checks |
|---|---|---|---|
| `reconciliation_reports` | append-only | `id`, `company_id`, `api_client_id` (uuid, no FK: a platform id, as `inbound_events`), `report_id` (uuid: Hub's report id and the idempotency key), `report_date` (date: the accounting date reported), `generated_at` (timestamptz: when Hub built it), `payload` (jsonb, as received), `payload_hash` (SHA-256 hex of its canonical form, RFC 8785), `event_count` (int ≥ 0), `received_at`, `request_id`, `status_at_receipt` (`matched` · `differences`), `gaps_at_receipt` (int ≥ 0) | unique `(company_id, api_client_id, report_id)`; index `(company_id, api_client_id, report_date, generated_at desc, received_at desc)` |
| `reconciliation_report_events` | append-only | `id`, `company_id`, `report_id` → reconciliation_reports, `event_id` (uuid: Hub's event id), `type` (event type), `currency` (`SYP` · `USD`, null), `amount_minor` (bigint, null), `delivery` (`pending` · `delivered` · `refused`), `refusal_code` (text, null) | unique `(report_id, event_id)`; index `(company_id, event_id)`; `currency` and `amount_minor` both null or both set; `refusal_code` set only when `delivery = refused` |

The `*_at_receipt` fields keep the answer Hub got; the screens compute the comparison again on read (rule 10), since an event arriving after the report changes it.

### Changed
- **`api_clients`** gains `reconcile_from` (date, null): the first accounting date the client's reports must cover. It is required when the client holds `events:write` or `reconciliation:write` (a check), and never cleared once set (a trigger): removing a scope does not remove the client from the reconciliation (rule 13). The migration sets it, for existing clients holding either scope, to the date of `created_at` in Asia/Damascus.
- **`CHECKLIST_ITEMS`** (`packages/contracts` `periods.ts`) appends `reconciliation_clean`; `PERMISSIONS` appends `reconciliation.read`; `email.ts`'s `held_digest` gains `reconciliation` (rule 16).

## States and rules
### The report
1. `POST /v1/reconciliation/daily` takes one report: `{ id, date, generated_at, events, totals }`, with `Idempotency-Key` equal to `id` (else `VALIDATION_FAILED`):
   - `date`: the accounting date reported (`YYYY-MM-DD`) (owner, 2026-11-12: by accounting date, as the entry is dated);
   - `generated_at`: when Hub built the report;
   - `events`: every event Hub created whose `accounting_date` is `date`, each `{ id, type, amount?, delivery, refusal_code? }` (owner, 2026-11-12: the list of events with the totals), at most 5 000;
   - `totals`: per type and currency, `{ type, currency, count, amount }`, `currency` and `amount` null for a type without an amount.
2. **The amount of an event** (`reconciliationAmountOf()` in `packages/contracts`, one definition for both sides), `{ currency, amount }` in minor units:

   | Type | Amount |
   |---|---|
   | `invoice.issued` | the invoice's currency; the sum of its lines' amounts (a retainer credit negative) and their tax amounts |
   | `payment.recorded` | the payment's currency and `amount` |
   | `milestone.done` | its currency and `amount` |
   | `project_expense.recorded`, `.changed` | its currency and `amount` |
   | `ad_wallet.deposited`, `.refunded` | its currency and `amount` |
   | `ad_spend.recorded`, `.changed` | `USD` and `usd_spend` |
   | every other type | none (counted only) |

   A type appended to the catalogue later appends its row here (ADR 0006: additive).
3. **`delivery`** is Hub's state of the event: `pending` (not yet delivered), `delivered` (answered `201` or `202`, or `409 PERIOD_CLOSED`), `refused` (answered `4xx` otherwise, with the code in `refusal_code`). It is shown, never trusted: Mizan compares by what it holds.
4. **Refusals store nothing** (`422 VALIDATION_FAILED` with field errors): a schema error; a date after the last day of the current month in Asia/Damascus (the latest accounting date an event may carry, S05 rule 3); an event id twice; an amount present for a type without one, or missing for a type with one; `totals` that do not equal the sums of `events` per type and currency (a report inconsistent with itself, for example cut short). The same key with another payload is `409 IDEMPOTENCY_CONFLICT`; the same key with the same payload stores nothing and answers the comparison now (`200`, `replayed: true`).
5. **The latest report counts:** for a client and a date, the report with the latest `generated_at` (then the latest `received_at`) is the date's report. An older report that arrives late is stored and answered with `superseded: true`; it changes nothing.
6. **When Hub sends** (Hub's side, Q5): after each day ends in Asia/Damascus, a report for that day, with no events if it had none; and a report for every earlier date on or after `reconcile_from` whose events changed since its last report (an event created with a past accounting date, a refused event replaced). It may send more often. The history replay (S10) sends the reports of every date since `reconcile_from`.

### The comparison
7. **Mizan's side** of client *c* and date *d*: the events in `inbound_events` with `api_client_id` *c* and `accounting_date` *d*, each with its type, its amount by rule 2 from its stored payload, and its state (S05).
8. **Each event is one of** (owner, 2026-11-12: arrival and agreement only):

   | Kind | When | A gap |
   |---|---|---|
   | `matched` | in both, same type, same amount | no |
   | `missing_in_mizan` | in Hub's report, not received by Mizan (Hub's `delivery` and `refusal_code` shown) | yes |
   | `missing_in_hub` | received by Mizan, in no report of *c* | yes |
   | `date_differs` | in *d*'s report, received by Mizan with another accounting date (or the reverse); shown on both dates | yes |
   | `type_differs` | in both, another type | yes |
   | `amount_differs` | in both, another currency or amount | yes |

   An event in Mizan's side that is in another date's latest report is `date_differs`, not `missing_in_hub`.
9. **Annotations, never gaps** (owner, 2026-11-12), on the `matched` events and listed apart:
   - **held**, with its reason: it fails the checklist's `no_held_events` (S05), not `reconciliation_clean`, so it is not counted twice;
   - **resolved by a manual entry** or **dismissed** (ADR 0014): Mizan no longer follows Hub for the document, by the accountant's or the owner's decision;
   - **adjusted in Mizan** (ADR 0013, S04 rule 8): a manual movement dated *d* on an item of a Hub document of *c*, listed under *d* with its entry.
10. **A day's state** for client *c*, computed on read:
    - `not_required`: *d* is before `reconcile_from`, or after the day the client was archived;
    - `pending`: no report for *d*, and it is before 08:00 Asia/Damascus on *d* + 1;
    - `missing`: no report for *d* from then on;
    - `differences`: the latest report leaves a gap (rule 8);
    - `matched`: the latest report leaves none.

    A company's day is the worst of its clients' (`missing`, then `differences`, then `pending`, then `matched`, then `not_required`).
11. **Totals:** the day shows, per type and currency, Hub's count and total from its report beside Mizan's received count and total and its posted, recorded, held, resolved and dismissed counts. Rule 4 makes Hub's totals equal its list, so a totals difference is always explained by the gaps of rule 8.

### The checklist
12. **`reconciliation_clean`** of month *m* passes when every day of *m* is `matched` or `not_required` for every client of the company (owner, 2026-11-12: every day from the start date, a day without events needing its report with no events). It fails with the count of the days that are not, and the link `/reconciliation?month=<m>`. It is `not_applicable` when every day of *m* is `not_required` (a company with no Hub client, a month before the start). There is no override (owner, 2026-11-12; ADR 0016). It is computed inside the close's transaction like the other items (S07 rule 5).
13. **The start date** is set by the owner (fresh two-factor code) when a client is given `events:write` or `reconciliation:write`; for Vertex Media, 2026-10-19, the first day of Hub's replay (scope §4). It may move later only while no month containing a day between the old and the new date is closed (`RECONCILIATION_START_LOCKED`); it may always move earlier. Each change is audited with before and after. A client archived (S05) is not required after its archive date; its earlier days stay required.

### `GET /v1/events?date=`
14. Answers the events Mizan received from the calling client with that accounting date: `{ id, type, version, received_at, state, hold_reason, amount }` (the amount by rule 2), in received order, in pages of 500 with a cursor. Another client's events are never listed.

### After the close
15. A report may arrive for a date in a closed month: it is stored and compared like any other. A gap it shows is marked "بعد الإقفال" on the screens and in the email; correcting it needs a reopen (S07), since an event for the month is held `PERIOD_CLOSED`.

### The email
16. `events.held-digest` (S05, daily 08:00 Asia/Damascus) gains a section per company (owner, 2026-11-12): the days on or after `reconcile_from` that are `missing` or `differences`, each with its gaps count, up to the 31 latest, with the link to `/reconciliation`. The email is sent when any of its sections has content (held events, S07's ended months not closed, or this one).

## Accounting treatment
None. S08 posts no entry and changes no open item, schedule or revaluation.

## Currencies, rates and rounding
The amounts compared are transaction amounts in the event's currency (rule 2), compared exactly in minor units; no rate is read and nothing is converted or rounded. Totals are kept per currency and never added across currencies.

## Periods
- Days are accounting dates; a month's days are its calendar days in Asia/Damascus.
- `reconciliation_clean` joins the checklist (rule 12) after `revaluation_current`, last in `CHECKLIST_ITEMS`.
- A report never changes a period; a report for a closed month is shown (rule 15).

## API
| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /v1/reconciliation/daily` | API client `reconciliation:write` | `reconciliationReportSchema`, header `Idempotency-Key` | `201` (`200` on a replay): `reconciliationResultSchema` `{ report_id, date, status, superseded, replayed, gaps, differences[], totals[] }` | `VALIDATION_FAILED`, `IDEMPOTENCY_CONFLICT`, `COMPANY_ARCHIVED`, `401`, `403` |
| `GET /v1/events?date=&cursor=` | API client `reconciliation:write` | `receivedEventsQuerySchema` | `receivedEventsPageSchema` | `VALIDATION_FAILED`, `401`, `403` |
| `GET /api/reconciliation/days?month=&client=` | `reconciliation.read` | `reconciliationMonthQuerySchema` | `reconciliationMonthSchema`: each day's state, counts and gaps per client; the matched days in a row up to yesterday | `VALIDATION_FAILED` |
| `GET /api/reconciliation/days/:date?client=` | `reconciliation.read` | — | `reconciliationDaySchema`: the totals (rule 11), the differences (rule 8), the annotations (rule 9) with their inbox ids and entries, the date's reports | `VALIDATION_FAILED`, `NOT_FOUND` |
| `POST /api/api-clients` and `PUT /api/api-clients/:id` (S05) | `api_clients.manage` + reauthentication | gain `reconcileFrom` (required with `events:write` or `reconciliation:write`) | the client, with `reconcileFrom` | `RECONCILIATION_START_LOCKED` (new, `409`), `VALIDATION_FAILED`, `REAUTHENTICATION_REQUIRED` |

`/v1` changes are additive: a new endpoint, a new answer, a field on S05's client. Each `differences[]` row carries `kind`, `event_id`, and the `hub` and `mizan` sides (type, accounting date, amount, Hub's delivery, Mizan's state and inbox id), either null. Hub treats an unknown `kind` by showing it (ADR 0006). Both endpoints are rate-limited per client like `/v1/events`.

## Jobs and events
| Job | Queue and trigger | Safe twice because |
|---|---|---|
| `events.held-digest` (S05) | daily 08:00 Asia/Damascus | unchanged: one email per company and day, keyed in the outbox; it gains the reconciliation section (rule 16) |

No new job: the comparison is computed on read and inside the close. Events received: none new; the report is not an event.

## Screens
| Route | Purpose and content | Actions | States | Who |
|---|---|---|---|---|
| Sidebar | "المطابقة اليومية", with the count of ended days `missing` or `differences` in open months | — | the count hides at zero | `reconciliation.read` |
| `/reconciliation?month=&client=` | The month's days: each day's state in words and icon, Hub's count, Mizan's received and posted counts, the gaps, the annotations count, "بعد الإقفال" when the month is closed; the matched days in a row up to yesterday (the scope's "Done when" asks for seven); the client filter when there are several; month navigation | Open a day | Empty: "لا عميل API يرسل تقارير المطابقة" with the link to `/settings/api-clients`; a month before the start "لا مطابقة مطلوبة"; loading skeleton; error with retry | `reconciliation.read` |
| `/reconciliation/:date?client=` | The day: its state; the totals per type and currency, Hub beside Mizan (`Amount`); the differences, each with its kind in Arabic, Hub's event id (copyable), type, both amounts, Hub's delivery and refusal code, Mizan's state with the link to `/inbox/:id`; the annotations (held with reason, resolved with its entry, dismissed with its reason, adjusted with its entry and item); the date's reports with generated and received times, the latest marked, the superseded ones | Open an event, an entry, an item | No report: "لم يصل تقرير هذا اليوم" (`pending` or `missing`); matched with nothing: "اليوم مطابق" | `reconciliation.read` |
| `/periods/:period` (S07) | The checklist shows `reconciliation_clean` with its failing days and the link | — | — | `periods.read` |
| `/settings/api-clients` (S05) | A client's "تاريخ بدء المطابقة" | Set or change it (fresh code), the refusal of rule 13 explained | Required when giving `events:write` or `reconciliation:write` | Owner; auditor reads |

Amounts only through `Amount`; event types through the inbox's Arabic names (S05); the day states through a status badge of `packages/ui` (`EventStateBadge`'s pattern; a `ReconciliationDayBadge` if the existing badge does not fit, built in `packages/ui` first, ADR 0010 §7). RTL, Latin digits, 360 px and up.

## Reports
None in F13. The reconciliation's figures come from the inbox and the reports: Mizan's counts and totals for a date equal the received events of that date by rule 2, and its posted count equals those whose state is `posted`.

## Printing and legal books
None.

## Volume and performance
Vertex Media: about 50 events and one or two reports a day, so about 1 500 report rows and 60 reports a month; the largest company served in phase 1 is the same order. A day's comparison reads one date's events (index `(company_id, accounting_date)`) and its latest report (the reports' index); a month reads 31 dates in two queries. `/reconciliation` and the checklist item answer in under 1 s.

## Migration and compatibility
- New tables, `api_clients.reconcile_from` with its check and trigger, and the registry's kinds (`/db-migration`). Additive.
- `CHECKLIST_ITEMS`, `PERMISSIONS`, `held_digest` and the error codes are appended (ADR 0006).
- **Existing closes:** months closed before S08 keep their stored checklist (S07 rule 9). A re-close after a reopen runs the new item.
- **The scenario book:** its companies have no API client, so `reconciliation_clean` is `not_applicable` and no case's expected outcome changes. Test fixtures that close a month of a company with a Hub client send its reports.
- **Hub** (Q5, in Hub's sessions): the report of rule 1 per accounting date, with every event of the date and its delivery state, sent as rule 6 says, including dates with no events; replayed with the history (S10). The JSON Schema and an example come with `export:hub-schema`.

## Arabic strings and number formats
`ar.reconciliation`: the day states (مطابق، فيه فروق، لم يصل التقرير، بانتظار التقرير، غير مطلوب), the kinds (ناقص في ميزان، ناقص في Hub، اختلاف التاريخ، اختلاف النوع، اختلاف المبلغ), the annotations (معلّق، حُلّ بقيد يدوي، مُسقط، معدّل في ميزان), Hub's delivery (لم يُرسل بعد، أُرسل، رُفض), "بعد الإقفال", the checklist item "المطابقة اليومية نظيفة", the email section "أيام المطابقة غير النظيفة", the start date and `RECONCILIATION_START_LOCKED`'s text. Dates `YYYY-MM-DD` and amounts with Latin digits.

## Audit
- A change of a client's `reconcile_from`: `api_client.updated` with before and after (S05).
- Reports and their receipt are kept in their append-only tables, not in the audit log (as `inbound_events`). Reading the screens is not logged (S01 rule 24).

## Abuse and failure cases
- **Replays and double submits:** the report id is the key (rule 4); a different payload under it is `409`.
- **A report out of order:** the latest `generated_at` counts (rule 5).
- **A truncated report:** totals that disagree with the list are refused (rule 4).
- **Passing the close by hiding days:** the start date moves later only while the affected months are open (rule 13); a scope removal does not clear it; no one accepts a difference.
- **Races with a close:** the item is computed inside the close's transaction; a report committed after the close shows "بعد الإقفال" (rule 15).
- **Cross-company access:** the company comes from the key; RLS on both tables; a client sees only its own events and reports.
- **A stolen key:** a forged report cannot change the ledger; at worst it hides a gap until the next real report or shows a false one. The key's scopes, IP allow-list, last use and revocation (S05) apply.
- **Hub down:** days turn `missing` from 08:00 the next day, the email says so, and the close waits.
- **Mizan down:** Hub retries the report like an event; a replay is safe.

## Edge cases
1. A day with no events: Hub sends a report with empty `events` and `totals`; matched.
2. An event created in Hub with an accounting date three days back: until Hub's next report for that date it is `missing_in_hub` there; the new report clears it.
3. An event held `PERIOD_CLOSED` or `NO_MAPPING`: matched and annotated held; the close fails on `no_held_events` only.
4. An event refused `422` and replaced by a corrected event with a new id: Hub's next report lists the new one and drops the refused one (owner, 2026-11-12); until then the refused one is `missing_in_mizan` with its refusal code.
5. An event moved by the accountant to the next open period (S05 rule 15): its accounting date stays *d*; matched on *d*.
6. A `.changed` event (ad spend, project expense): an event of its own, with the new state's amount, on its own accounting date.
7. A retainer credit invoice with a negative total: its amount is negative and compared as such.
8. An invoice with tax lines (held `NO_MAPPING` `tax_lines`): its amount includes the tax; matched and annotated held.
9. Two clients posting for one company: each reconciles its own events from its own start date; a day is the worst of the two.
10. A client archived mid-month: its days after the archive date are `not_required`.
11. Events with an accounting date before `reconcile_from` (the replay's start, S10's opening entries): not required; listed if a report is sent.
12. A report for a date of the current month not yet reached (a future-dated event): accepted (rule 4); the day stays `pending` until it ends and its latest report counts.
13. The same event id in the latest reports of two dates: `date_differs` on the date that Mizan's accounting date does not match.
14. A currency shape other than `syp-usd`: nothing changes; amounts are compared in the event's currency.
15. Leap day 2028-02-29: a day like any other; the month has 29 days to reconcile.
16. A reopen, then a re-close: the item runs again on the current reports.

## Scenarios
None: S08 introduces or changes no posting, recognition, revaluation or settlement rule. The comparison and the checklist item are covered by unit tests of `reconciliationAmountOf()` and the comparison, and by API and close tests (Acceptance).

## Open questions
None blocking. Q5 gains S08's part for Hub (Migration and compatibility).

## Acceptance
- **The owner's end-to-end check, step by step** (a test company with the service-agency chart and an API client "Vertex Hub" holding `events:write` and `reconciliation:write`, `reconcile_from` 2026-11-01):
  1. Post the Hub examples dated 2026-11-03 (`post:hub-examples`), then a report for 2026-11-03 listing them: `/reconciliation?month=2026-11` shows 3 November "مطابق", Hub's and Mizan's counts and totals equal.
  2. Send a report for 2026-11-04 listing one invoice that Mizan never received: 4 November shows "فيه فروق", the row "ناقص في ميزان" with Hub's event id and amount; post that event and open the day again: "مطابق".
  3. Post an event dated 2026-11-05 with no report for the 5th: until 08:00 on the 6th "بانتظار التقرير", then "لم يصل التقرير", and the 08:00 email lists the day.
  4. Send a report for 2026-11-04 with a lower amount for the invoice: "اختلاف المبلغ" with both amounts.
  5. With the other checklist items passing, try to close November: refused `CHECKLIST_FAILED` with "المطابقة اليومية نظيفة" failing and its days counted; send the missing reports and close: the close passes.
  6. Try to move `reconcile_from` to 2026-11-10 after the close: refused `RECONCILIATION_START_LOCKED`.
- **Tests:**
  - API: each endpoint's success, `401`, `403` (a key without `reconciliation:write`; a person's session on `/v1`), another company's client seeing nothing of this one, an idempotent replay and a `409` conflict; `/api/reconciliation` per role;
  - unit and property tests: `reconciliationAmountOf()` per type; the comparison's kinds for every pairing of the two sides; a property that a report built from Mizan's own events of a date is always `matched`, and that removing or changing any one event yields exactly one gap of the right kind;
  - the checklist: `reconciliation_clean` passing, failing per day state, `not_applicable`, inside the close's transaction against a concurrent report;
  - invariant tests for the new tables (append-only, RLS, composite keys) and `reconcile_from`'s check and trigger;
  - E2E with RTL screenshots of `/reconciliation`, `/reconciliation/:date` and the client's start date, light and dark, at 360, 768 and 1280 px.
