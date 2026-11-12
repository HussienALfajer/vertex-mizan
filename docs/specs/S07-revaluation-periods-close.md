# S07 — Month-end revaluation, periods and close

Status: Approved (owner, 2026-11-11) · Date: 2026-11-11 · Features: `docs/product/phase-1-scope.md` F08, F09 (and §4 "Month-end revaluation") · ADRs: 0003, 0005, 0006, 0007, 0008, 0011, 0012, 0013, 0014, 0015, 0016

## Summary
Vertex Media's books hold USD receivables, contract assets, client ad funds and cash in an SYP book ledger, and SYP cash and receivables in a USD parallel ledger. Until S07 none of them is restated at month end, and no month can be closed: S03 creates every period `open` and refuses only an entry into a `closed` one that nothing can produce.

S07 brings:
- **the month-end revaluation** of each ledger's monetary balances in other currencies at that ledger's policy rate for the last day of the month (IAS 21.23): previewed by the accountant and posted per ledger, reversed on the first day of the next month, with an adjusting revaluation when a back-dated posting, a reopen or a corrected closing rate makes it stale (ADR 0007, ADR 0016);
- **periods** with the states open, closed and reopened, closed in order with a reason, the latest closed month reopened with a reason, both in the audit log and in an append-only period history;
- **the pre-close checklist** of F09 with the items S02–S06 left for it, with no override;
- the period status Hub already reads (`GET /v1/periods/status`) now answering `closed`, and the held events of a reopened month retried.

## In scope / out of scope
- In:
  - the revaluation preview and posting per ledger, its reversal, adjusting revaluations, open-item movements of kind `revaluation` (S04);
  - period states and transitions, `period_events`, close and reopen with their rules and lock order (ADR 0008);
  - the pre-close checklist and its items from S02, S03, S04, S05 and S06;
  - the retries of a reopened month's held events (S05 rule 10, ADR 0014);
  - the scenario book's `revalue`, `close` and `reopen` steps and its `closed_periods` setup, so the `Proposed` cases waiting for S07 run;
  - the screens `/periods`, `/periods/:period` and `/revaluation`;
  - the permissions `periods.read` and `revaluation.post`; `periods.close` exists (S01).
- Out (later or never):
  - **S08:** the checklist item "the reconciliation is clean" (F11). S07 builds the checklist so S08 adds its item; until S08 ships the checklist has no reconciliation item, and no real month is closed before then (the scope's "Done when" needs both).
  - **S09:** the reports that read revaluations (trial balance, statements, the exchange-difference lines by IFRS 18 category, Q11).
  - **Phase 2:** the year-end close (closing entries to retained earnings, F09); a closed year is closed month by month in phase 1.
  - **Never:** revaluing non-monetary items (contract liabilities, prepayments, equity; IAS 21.23(b)); a translation into a presentation currency is a later report (ADR 0007 "Reporting").

## Access
| Action | Surface | Who (role or permission) |
|---|---|---|
| Read periods, their history and checklist; preview a revaluation | Web `/periods`, `/revaluation` | Owner, accountant, auditor (`periods.read`, new) |
| Post a revaluation (and its adjustments) | Web `/revaluation` | Owner, accountant (`revaluation.post`, new) |
| Close and reopen a period | Web `/periods/:period` | Owner; accountant with the period permission (`periods.close`, S01) |
| Read the period status | API `GET /v1/periods/status` | API client with `periods:read` (S05) |
| Retry a reopened month's held events | Worker | `events.retry` (S05), queued by the reopen's commit |

`periods.read` and `revaluation.post` are appended to the permission map in `packages/contracts`, like `recognition.read` (owner, 2026-11-10; confirmed for S07 2026-11-11): `periods.read` for the owner, the accountant and the auditor; `revaluation.post` for the owner and the accountant (scope §3: the accountant revalues). The approver and the viewer read the effects in S09's reports.

## Data
Every company table has `company_id`, forced RLS with `company_isolation`, composite company foreign keys and its kind in the registry (ADR 0003, 0005, 0008, 0012). Money fields follow ADR 0007.

### New tables (`ledger` module)
| Table | Kind | Fields | Keys and checks |
|---|---|---|---|
| `period_events` | append-only | `id`, `company_id`, `period_id` → periods, `kind` (`closed` · `reopened`), `reason` (text 1–500), `user_id` → users, `checklist` (jsonb, the items and their results at the close; null on a reopen), `head_sequence` (bigint: the ledger head's sequence at the event), `created_at` | index `(company_id, period_id, created_at)` |
| `revaluations` | append-only | `id`, `company_id`, `period_id` → periods, `ledger` (`book` · `parallel`), `entry_id` → journal entries (the revaluation, dated on the month's last day), `reversal_entry_id` → journal entries (dated on the next month's first day), `adjusting` (bool: an earlier revaluation of the same month and ledger stands), `fingerprint` (text: the hash of the preview it posted), `rates` (jsonb: each pair with the rate row id, its type and effective date), `user_id` → users, `created_at` | unique `(company_id, entry_id)`; unique `(company_id, period_id, ledger, fingerprint)`; index `(company_id, period_id, ledger)` |

### Changed
- **`periods.state`** gains `reopened` (check `in ('open', 'closed', 'reopened')`). A guard trigger (`ENABLE ALWAYS`, pinned in `GUARDS`) allows only `open → closed`, `closed → reopened` and `reopened → closed`, each only with a `period_events` row of the same kind for the row in the same transaction (deferred), and refuses every other update. The period guard on entries (S03) refuses `closed` only; `reopened` posts as `open`.
- **`open_item_movements.kind`** gains `revaluation` (S04 reserved it). A revaluation movement carries a transaction amount of zero and an amount in one ledger only.
- **`open_item_balances`** gains `revaluation_book_minor` and `revaluation_parallel_minor` (bigint, not null, default 0; the parallel stays 0 without a parallel ledger, since the rows only their trigger writes cannot be backfilled to null): the sum of an item's `revaluation` movements. `book_minor` and `parallel_minor` keep the **carrying amount**, without revaluations (ADR 0007, ADR 0013), and invariant 9 (zero transaction ⇒ zero carrying) keeps reading them. S04's comparison of items with their control account adds both.
- **Contracts** (`packages/contracts`, appended and kept by the error-code guard): the error codes below, the audit actions, the two permissions, `PERIOD_STATES`, `CHECKLIST_ITEMS`, the revaluation preview and posting schemas. The entry source `revaluation` exists (S03).

## States and rules
### Periods
1. **States:** `open` (made by the first posting dated in it, S03, or by a close of an empty month), `closed`, `reopened`. Hub reads `reopened` as `open` (no `/v1` change).
2. **Close** of month *m* needs, in this order of refusal:
   - the permission `periods.close` and a reason;
   - *m* is not `closed` (`PERIOD_CLOSED`);
   - *m* has ended in Asia/Damascus (`PERIOD_NOT_ENDED`);
   - every month from the company's first period to *m* − 1 is `closed` (`PERIOD_ORDER`, naming the earliest open month) (owner, 2026-11-11), and *m* is not before the first period (`PERIOD_ORDER`, naming the first period): such a month would become the first period for good, and rule 4 closes it already once any month is closed (owner, 2026-11-12);
   - every checklist item passes (`CHECKLIST_FAILED`, with the failing items) (owner, 2026-11-11: no override).

   A month between the first period and *m* that has no row yet gets one at its own close (an empty month still holds balances to revalue). The **first period** is the company's earliest period row (S10's opening entry makes it 2026-10 for Vertex Media).
3. **Reopen** of month *m* needs `periods.close`, a reason, *m* `closed` (`PERIOD_NOT_CLOSED`), and *m* the latest closed month (`PERIOD_ORDER`, naming the latest closed month): an earlier month is reopened by reopening the later ones first (owner, 2026-11-11).
4. **Months before a closed month are closed.** Rules 2 and 3 keep every month from the first period to the latest closed month closed. A posting dated before the first period while any month is closed is refused `PERIOD_CLOSED` (a Hub event held), and `GET /v1/periods/status` answers `closed` for it.
5. **Lock order** (ADR 0008): close and reopen take the ledger head exclusively, then the period row exclusively, and run the checklist inside that transaction; a posting takes the head, then the period with a share lock. A close and a posting, a release, a revaluation or a retry serialise; whichever commits first decides.
6. **After a reopen's commit,** the events held `PERIOD_CLOSED` with an accounting date in *m*, and those held `SERVICE_PERIOD_CLOSED` for an elapsed month *m*, are queued for retry (S05 rule 10, ADR 0014). The release job releases *m* if a release is missing (S06).
7. **Re-closing** a reopened month runs the same rules and checklist.

### Pre-close checklist
8. The checklist of month *m* is computed on read and inside the close (rule 5). Each item answers `passed`, `failed` (with a count and a link) or `not_applicable`:

   | Item | Passes when | From |
   |---|---|---|
   | `bulletins_recorded` | for each ledger whose policy is `bulletin` and each currency other than its own with a line dated in *m* or a revaluable balance at its end, every publication day of *m* has its bulletin | S02, ADR 0011 |
   | `closing_rates_recorded` | for each ledger and each currency of a revaluable balance at the end of *m*, the ledger's policy rate on the last day exists (rule 11) | S02 |
   | `no_drafts` | no draft or submitted draft is dated in *m* | S03 |
   | `open_items_agree` | for every control account, its balance per currency and dimension set at the end of *m* equals its items' movements in every ledger, revaluation movements included | S04 |
   | `no_held_events` | no inbound event dated in *m* is held | S05 |
   | `releases_posted` | every active over-time schedule touching *m* has its `released` movement for *m* | S06 |
   | `revaluation_current` | in each ledger, the revaluation of *m* is current (rule 15) | S07 |

   S08 appends `reconciliation_clean`. A company without a parallel ledger reads the parallel side as `not_applicable`.
9. The close stores the checklist's results in its `period_events` row.

### Revaluation
10. **What is revalued** in ledger *L* (currency *C*), at the end of month *m*, from lines dated on or before it (ADR 0007, ADR 0016):
    - each **open item** on a monetary control account whose currency is not *C* (receivables, contract assets, client ad funds, and any later control account): its carrying amount in *L* against its open transaction amount (owner, 2026-11-11: per item, as ADR 0007 states);
    - each **(account, dimension set, currency)** of a monetary account that is not a control account (cash, bank, wallets, the project-expense clearing account `211002`), with currency other than *C*: its balance in *L* without the lines of `revaluation` entries, against its transaction balance (owner, 2026-11-11);
    - a balance whose transaction amount is zero but whose *L* amount is not is brought to zero;
    - blocked accounts and archived dimension values are revalued (owner, 2026-11-11: a remeasurement of an existing balance, not a new posting); archived accounts hold no balance (S02 rule 6).

    Non-monetary accounts (the monetary flag, S02) are never revalued.
11. **The closing rate** for a currency in *L* is *L*'s policy rate in force on the last day of *m* (ADR 0007, ADR 0011): the bulletin of the day under S02 rule 16 (a day off takes the last publication day's); the market rate is the newest on or before the last day, shown with its effective date (owner, 2026-11-11). A third currency crosses as ADR 0007 states. A missing rate refuses the ledger's posting (`RATE_MISSING`, naming the pair and the date) and fails `closing_rates_recorded`.
12. **The amounts:** for each balance, `target = convert(transaction balance, closing rate)` rounded half away from zero through the money module; `difference = target − carrying − already revalued`, where *already revalued* is the sum of its *L* amounts in `revaluation` entries dated on the last day of *m*. A balance with a difference of zero posts nothing.
13. **The entry** of ledger *L*, dated on the last day of *m*, source `revaluation`: for each balance with a difference *d*, two lines (owner, 2026-11-11):
    - on the balance's account, with its dimension set (and its open item), in the balance's currency, transaction amount 0, *L* amount *d*, the other ledger 0;
    - on `fx_unrealised_gain` (`421002`) when −*d* is a credit, or `fx_unrealised_loss` (`541002`) when it is a debit, in currency *C*, transaction and *L* amount −*d*, the other ledger 0, without dimensions (as realised differences, S04).

    Gains and losses are not netted; S09 may present them net (IAS 1.35). The entry balances exactly in *L* and carries zero in the other ledger, so it needs no rounding line.
14. **The reversal** of the entry, dated on the first day of *m* + 1, posts in the same transaction through `post()`'s reversal (an exact negation, its open-item movements `revaluation` too). *m* + 1 is open by rules 2–4.
15. **Current and stale:** a ledger's revaluation of *m* is current when rule 12 gives a difference of zero for every balance. It goes stale when, while *m* is open:
    - a posting is dated on or before the last day of *m* (a back-dated payment; an event retried after a reopen);
    - a closing rate of *m* is corrected (S02 rule 15) (owner, 2026-11-11).

    A stale revaluation is made current by an **adjusting revaluation**: the same preview and action, posting only the differences, with its own reversal (ADR 0007). A month with nothing to revalue is current with no entry.
16. **When:** the preview is open at any time for an open month; the posting only once *m* has ended in Asia/Damascus (`PERIOD_NOT_ENDED`) (owner, 2026-11-11), and only while *m* is open or reopened (`PERIOD_CLOSED`).
17. **The posting is exact to its preview:** the request carries the preview's `fingerprint` (the hash of its balances, amounts and rate rows). The service takes the head lock, recomputes, and refuses a different result (`REVALUATION_CHANGED`, with the new preview). The idempotency key is `revaluation:<period>:<ledger>:<fingerprint>`, so a double submit returns the first result. A preview with nothing to post answers `posted: false`.
18. Each ledger posts on its own action; the screen offers both in one click as two postings.

## Accounting treatment
| Operation | Entry | Basis |
|---|---|---|
| Revaluation of month *m*, ledger *L* | Per balance: Dr/Cr the balance (transaction 0, *L* only) · Cr `421002` or Dr `541002` (*L* only); dated the last day of *m* | IAS 21.23(a), 21.28 (unrealised differences in profit or loss); policy scope §4; ADR 0007 |
| Its reversal | The exact negation, dated the first day of *m* + 1 | Scope §4 ("Each entry reverses on the first day of the next month"); ADR 0007 (carrying amounts exclude revaluations) |
| Adjusting revaluation | The differences still to post, same shape, same dates, with its own reversal | ADR 0007 "stale revaluation"; IAS 21.23 |
| Close, reopen | None | ADR 0005 invariant 4 |

- **Settlements after a revaluation** clear the carrying amount, which excludes the revaluation (reversed on day 1), so the realised difference covers the whole movement from the original measurement (IAS 21.28; ADR 0013). Example: a 1,000.00 USD receivable at 120, revalued at 125 on 30 November and reversed on 1 December, paid on 10 December at 126: the book realises 6,000.00 SYP in December, November showed 5,000.00 unrealised, December's reversal takes 5,000.00 back.
- **Contract assets** are monetary and revalued per item (S06); **contract liabilities** are non-monetary and never revalued (IAS 21.16).
- **Client ad funds** (`213001`, running items) are revalued per client item whatever their sign; a negative balance presents as a receivable (ADR 0007, S09).
- **Reversals** of revaluation entries are refused by hand (`ENTRY_NOT_REVERSIBLE`, S03 rule 9); a revaluation is corrected only by an adjusting revaluation.
- No Syrian legal or tax rule is relied on beyond the bulletin policy for the book ledger (UNVERIFIED, Q1, adopted by the owner). IAS 29 is out of scope.

## Currencies, rates and rounding
- Each revaluation line is a difference line (ADR 0007): one ledger only; on the balance in its own currency with a transaction amount of zero; on the gain or loss account in the ledger's currency.
- One conversion per balance (rule 12), half away from zero; the error per balance is at most half a minor unit of *C*, and the gain and loss lines equal their balances' lines, so the entry balances exactly.
- The book ledger uses the book policy (Vertex Media: `bulletin`) and the parallel ledger the parallel policy (`market`); the transaction's own rate does not apply (there is no transaction).
- Shapes:
  - `syp`: the book ledger revalues USD, TRY and EUR balances at the bulletin; no parallel side;
  - `syp-usd` (Vertex Media): the book revalues USD (and third-currency) balances at the bulletin; the parallel revalues SYP (and third-currency) balances at the market rate;
  - `usd-syp`: the USD book revalues SYP balances at its policy, the SYP parallel revalues USD balances at its own;
  - `third`: a TRY balance in each ledger through the direct rate or the cross (ADR 0007).

## Periods
- Revaluations are dated on the last day of *m* and reversed on the first day of *m* + 1; both months are open when they post (rules 2–4, 16).
- A December revaluation's reversal is numbered in the next fiscal year (ADR 0012).
- A closed month keeps its revaluation; a reopen and later postings make it stale (rule 15), and the checklist requires the adjustment before the re-close.
- Rates, holidays and their corrections dated in a closed month are accepted and change no posted entry (S02 rule 18).

## API
All under `/api` with `X-Mizan-Company` (S01), schemas in `packages/contracts/src/periods.ts`.

| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/periods?from=YYYY-MM&to=YYYY-MM` | `periods.read` | at most 24 months, default the first period to the current month | per month: state, last event (kind, reason, user, time), whether it has ended, checklist summary (passed or the count failed) for ended open months | `VALIDATION_FAILED` |
| `GET /api/periods/:period` | `periods.read` | — | state, history, the checklist with each item's result, count and link target | `VALIDATION_FAILED` |
| `POST /api/periods/:period/close` | `periods.close` | `{ reason }` | the period | `PERIOD_CLOSED`, `PERIOD_NOT_ENDED`, `PERIOD_ORDER`, `CHECKLIST_FAILED` |
| `POST /api/periods/:period/reopen` | `periods.close` | `{ reason }` | the period, the count of events queued for retry | `PERIOD_NOT_CLOSED`, `PERIOD_ORDER` |
| `GET /api/revaluation/:period?ledger=book\|parallel` | `periods.read` | — | the closing rates used (pair, type, effective date, row id); per balance: account, item or dimension set, currency, transaction balance, carrying, target, already revalued, difference; the gain and loss totals; the posted revaluations with their entries; `state` (`current` · `to_post` · `rate_missing`); `fingerprint` | `PERIOD_CLOSED`, `VALIDATION_FAILED` |
| `POST /api/revaluation/:period` | `revaluation.post` | `{ ledger, fingerprint }` | `{ posted, revaluation, entryId, reversalEntryId }` | `PERIOD_CLOSED`, `PERIOD_NOT_ENDED`, `RATE_MISSING`, `REVALUATION_CHANGED` |
| `GET /v1/periods/status` (S05) | `periods:read` | unchanged | `closed` for closed months and months before the latest closed one; `open` otherwise (`reopened` included) | unchanged |

New error codes, appended: `PERIOD_NOT_ENDED` (409), `PERIOD_ORDER` (409), `PERIOD_NOT_CLOSED` (409), `CHECKLIST_FAILED` (409, details: the failing items), `REVALUATION_CHANGED` (409, details: the new fingerprint). `/v1` is unchanged (ADR 0006).

## Jobs and events
| Job | Queue and trigger | Safe twice because |
|---|---|---|
| `events.retry` (S05) | gains the reopen's trigger (rule 6) | as S05: the events' posting requests are idempotent |
| `revenue.release-month` (S06) | releases a reopened month missing a release | as S06 |

No new job: revaluation is the accountant's action (F08). S05's daily email gains a line "أشهر منتهية غير مقفلة" with each ended open month and its failing items count. Events received or emitted: none new.

## Screens
| Route | Purpose and content | Actions | States | Who |
|---|---|---|---|---|
| Sidebar | "الفترات" and "إعادة التقييم" | — | — | `periods.read` |
| `/periods` | The months from the first period to the current one: state badge (مفتوحة · مقفلة · معاد فتحها), ended or not, checklist summary, last event with its reason and person | Open a month | Empty (no posting yet): "لا فترات بعد"; skeleton; error with retry | `periods.read` |
| `/periods/:period` | The checklist: each item with its status icon and text (not colour alone), its count and a link (inbox filtered to the month's held events, drafts of the month, `/revenue` months, `/rates` missing days, `/revaluation` of the month, the integrity check); the history of closes and reopens | "إقفال الشهر" (enabled when every item passes and rule 2 holds; a dialog with the reason) · "إعادة فتح الشهر" (latest closed month; reason; the dialog says the held events will be retried) | Refusals show the error's Arabic text and the failing items | `periods.read`; actions `periods.close` |
| `/revaluation?period=&ledger=` | A month picker and the ledger switch (الدفتر الأساسي · الدفتر الموازي); the closing rates with their dates; the balances grid (account, item or dimensions, currency, transaction balance, carrying, closing rate, revalued, already revalued, difference) with blocked accounts marked; gain and loss totals; the posted revaluations with their entries and reversals | "ترحيل إعادة التقييم" for the ledger, or "ترحيل قيد تسوية" when one stands; "ترحيل الدفترين" | `current`: "إعادة التقييم حالية"; `rate_missing`: the missing pair and date with a link to `/rates`; `REVALUATION_CHANGED`: the new preview with a notice | `periods.read`; actions `revaluation.post` |
| `/entries/:id` (S03) | A revaluation entry links to its month's `/revaluation` and to its reversal | — | — | per S03 |

`packages/ui` gains a general `Checklist` component (ADR 0010 §7): items with a status icon, text, a count and a link, keyboard reachable, RTL, tested. Amounts through `Amount`; the grid through `DataGrid`.

## Reports
- No report in S07. S09's trial balance and statements read the revaluation entries like any entry: `421002` and `541002` in the income statement, the balances at closing rates in the balance sheet.
- `/revaluation`'s figures reconcile to the ledger: per ledger and month, the gain and loss totals equal the lines on `421002` and `541002` of that month's revaluation entries, and each balance's target equals its carrying amount plus its revaluation lines.

## Printing and legal books
None new. Revaluation entries and reversals print in the journal book (S09) with their Arabic description ("إعادة تقييم آخر الشهر <YYYY-MM> — <الدفتر>") and number. A year's journal book is complete once its last month closes (ADR 0012).

## Volume and performance
- Vertex Media: about 40 receivable items, 20 ad-fund items, a few contract assets and 5–10 other balances per ledger; one or two revaluation entries per ledger a month.
- The preview reads period balances for non-control accounts and `open_item_balances` with the month's movements for items; it answers within 2 s for 5,000 balances. The checklist answers within 2 s; each item reads an index (`inbound_event_states` by state and date, drafts by date, movements by month).

## Migration and compatibility
- New tables, the state `reopened`, the movement kind `revaluation`, the two balance columns (0 for existing rows, since no revaluation exists), the guard on `periods`, permissions, error codes and audit actions. No ledger data changes; every existing period stays `open`.
- The scenario book: the `Proposed` cases that wait for a close (`inbox/post-in-next-open-period.md`, `revenue/recognise-in-open-period.md`, the closed-month cases of `revenue/over-time-release.md`) run once `closed_periods` closes through the close service; their expected values do not change. The "added with S07" notes of `receivables/*`, `ad-funds/running-balance.md`, `expenses/project-expense.md` and `manual/*` point to the new scenarios.
- **Hub** reads the status it already reads (ADR 0006); nothing new is asked of Hub (Q5 unchanged).

## Arabic strings and number formats
- `ar.periods`: الفترات، الفترة، مفتوحة، مقفلة، معاد فتحها، إقفال الشهر، إعادة فتح الشهر، سبب الإقفال، سبب إعادة الفتح، قائمة التحقق قبل الإقفال، the item texts (النشرات مسجلة، أسعار الإقفال مسجلة، لا مسودات، البنود المفتوحة تطابق حساباتها، لا أحداث معلقة، الإيرادات المؤجلة محررة، إعادة التقييم حالية)، أشهر منتهية غير مقفلة.
- `ar.revaluation`: إعادة التقييم، سعر الإقفال، المبلغ الدفتري، القيمة بعد التقييم، المُعاد تقييمه سابقاً، الفرق، أرباح غير محققة، خسائر غير محققة، ترحيل إعادة التقييم، ترحيل قيد تسوية، إعادة التقييم حالية، الدفتر الأساسي، الدفتر الموازي، موقوف.
- The new error codes' Arabic texts. Months `YYYY-MM`, dates `YYYY-MM-DD`, rates as stored, Latin digits; amounts through Amount.

## Audit
- `period.closed` (reason, checklist), `period.reopened` (reason, events queued) in `audit_entries`, beside the `period_events` row, in the same transaction.
- `revaluation.posted` (period, ledger, adjusting, fingerprint, rates), beside `post()`'s `entry.posted` rows for the entry and its reversal.
- Reads are not audited (S01 audits only the reads it lists).

## Abuse and failure cases
- **Double submits:** the revaluation's idempotency key and unique fingerprint (rule 17); a second close or reopen finds the new state (`PERIOD_CLOSED`, `PERIOD_NOT_CLOSED`).
- **Races with a close:** the lock order (rule 5); the checklist runs inside the close transaction, so a held event, a draft posted or a back-dated posting committed first fails it.
- **A preview gone stale before posting:** `REVALUATION_CHANGED` (rule 17).
- **Closing past problems:** no override (rule 2); a held event is fixed, moved or dismissed by the owner (S05) first.
- **A reopen to change history:** only the latest closed month, with a reason, in the audit log and the period history; the integrity chain and the daily anchor show every entry posted after it (ADR 0008).
- **Cross-company access:** periods, events and revaluations under forced RLS; the company from the session; another company's period answers as an empty month of the caller's company, never its data.
- **A stolen API key:** `periods:read` reads states only.
- **Hub down:** nothing in S07 calls Hub; Hub's past-dated changes refused by its own check, or held `PERIOD_CLOSED` when it raced the close.
- **Out-of-order events:** an event dated in a reopened month posts there; one dated in a closed month is held as before.

## Edge cases
1. A month with no posting and a USD balance carried from earlier: it has balances to revalue and is closed in order (rule 2).
2. A USD cash account spent to zero with a book residual: brought to zero at month end (rule 10), the residual returning on day 1 and revalued again the next month end while it stands.
3. An item settled in full on the last day after the revaluation: its difference becomes −(already revalued) and the adjusting revaluation clears it.
4. An item opened and settled within the month: transaction zero, carrying zero (invariant 9): nothing.
5. Client ad funds crossing zero: revalued by the item's signed balance.
6. A blocked account or an archived dimension value with a foreign balance: revalued, marked "موقوف" in the preview.
7. A missing bulletin on a last day that is a publication day: `RATE_MISSING`; on a day off: the last publication day's bulletin.
8. A market rate last recorded weeks before the month end: used, with its date shown.
9. A corrected closing bulletin while the month is open: stale; the adjusting revaluation posts at the corrected rate. After the close: nothing changes.
10. A reopen of November after December's revaluation: back-dated November postings make both November's and December's revaluations stale (both months are open), each adjusted.
11. Two accountants posting the same preview: one posts, the other gets the first result (same key).
12. A company without a parallel ledger: one entry per month; the parallel side `not_applicable`.
13. Shapes `syp`, `syp-usd`, `usd-syp`, `third` (Currencies).
14. A December revaluation: the reversal on 1 January is numbered in the new fiscal year.
15. A closed month and an event dated before the first period: held `PERIOD_CLOSED` (rule 4).
16. The release job racing a close: the share lock; the release posts first or the close's `releases_posted` fails (S06).
17. A retried event that fails again after a reopen: it stays held, and `no_held_events` blocks the re-close.

## Scenarios
Each written and approved through `/posting-rule` before its code:
- **`currency/month-end-revaluation.md`** (new): a USD receivable item in the book ledger (gain) and an SYP bank balance in the parallel ledger (loss) at Vertex Media; the reversal on day 1 and a payment after it with its realised difference from the carrying amount; client ad funds (a liability, and one crossed below zero); a contract asset item; `211002` as Hub posts it, without dimensions, so one balance per currency (owner, 2026-11-11); a non-monetary `212001` untouched; a zero transaction balance with a residual brought to zero; a blocked account; `syp`, `usd-syp` and `third`; `RATE_MISSING`; a month with nothing to revalue.
- **`currency/stale-revaluation.md`** (new): a back-dated payment after the revaluation and the adjusting revaluation with its reversal; a corrected closing bulletin; a back-dated posting that changes no difference (still current); November reopened after December's revaluation, both adjusted.
- **`periods/close-and-reopen.md`** (new): a close refused by each checklist item, by `PERIOD_ORDER` and by `PERIOD_NOT_ENDED`; a close; a manual entry and a Hub event dated in the closed month (refused and held `PERIOD_CLOSED`); a reopen retrying the held event into the month, the stale revaluation adjusted and the month closed again; a reopen of a month that is not the latest refused; a posting dated before the first period after a close.
- **Existing, unchanged values:** `inbox/post-in-next-open-period.md`, `revenue/recognise-in-open-period.md` and the closed-month cases of `revenue/over-time-release.md` switch to `Approved (owner, <their approval date>)` when S07 brings the close executor.

## Open questions
- **Q5 (Hub's side):** unchanged; Hub calls `GET /v1/periods/status` before a past-dated change (ADR 0006), already served.
- **S08** adds the reconciliation item; no real month closes before it.
- None blocks the spec.

## Acceptance
- **The owner's end-to-end check** (a test company with the service-agency template, `syp-usd`, Vertex Media's policies; synthetic data):
  1. In `/rates`, record the USD/SYP bulletin of every publication day of November: 120.0000 from 2026-11-01 to 2026-11-29 and 125.0000 on Monday 2026-11-30; the market rate 125.0000 on 2026-11-02 and 128.0000 on 2026-11-25; the bulletin 126.0000 on 2026-12-10.
  2. Post a manual entry on 2026-11-03: Dr `112001` C1, new item M-1, 1,000.00 USD / Cr `411001`: book 120,000.00 SYP. Post a manual entry on 2026-11-03 receiving 1,250,000.00 SYP into `111003` against `311001`: parallel 10,000.00 USD at 125.
  3. On or after 1 December, open `/revaluation?period=2026-11`: the book shows M-1 carrying 120,000.00, revalued 125,000.00, difference 5,000.00 (gain); the parallel shows `111003` carrying 10,000.00 USD, revalued 9,765.63 (1,250,000.00 / 128 = 9,765.625, half away from zero), difference −234.37 (loss). Post both.
  4. In the journal: the book entry Dr `112001` M-1 (USD 0, 5,000.00 SYP) / Cr `421002` 5,000.00 SYP, and the parallel entry Dr `541002` 234.37 USD / Cr `111003` (SYP 0, 234.37 USD), both dated 2026-11-30; their reversals dated 2026-12-01. `/revaluation` reads "إعادة التقييم حالية".
  5. Post a manual entry dated 2026-11-26 receiving 100.00 USD into `111004` against M-1 (at 120: no realised difference). `/periods/2026-11` shows "إعادة التقييم حالية" failed. The adjusting book revaluation posts, gross: M-1 900.00 × 125 = 112,500.00 against carrying 108,000.00 and 5,000.00 already revalued gives −500.00 (Dr `541002` / Cr `112001` M-1), and `111004` 100.00 × 125 = 12,500.00 against 12,000.00 gives +500.00 (Dr `111004` / Cr `421002`), with its reversal on 2026-12-01.
  6. Try to close November with a draft dated in it: refused, the item linked. Discard the draft; close with a reason: `GET /v1/periods/status?from=2026-11&to=2026-12` answers November `closed`.
  7. With the API client's key, post an `ad_wallet.deposited` of 200.00 USD for C1 dated 2026-11-29: held `PERIOD_CLOSED`. Reopen November with a reason: the deposit posts into November (`213001` C1, a USD liability), the book revaluation is stale again (at 125 against 120: a 1,000.00 SYP loss on the `213001` item and a 1,000.00 SYP gain on the USD account it was received in); post the adjustment and close November again.
  8. On 2026-12-10, record M-1's final payment of 900.00 USD at 126: the book realises 900.00 × (126 − 120) = 5,400.00 SYP, since the November revaluation was reversed.
- **Tests:**
  - API: every endpoint with success, 401, 403 (role and the period permission), another company's data, the refusals of rules 2, 3, 16 and 17, an idempotent double submit;
  - unit and property tests in `packages/ledger`: `revaluationLines()` balances exactly in its ledger and is zero in the other; a revaluation followed by its reversal leaves every balance at its carrying amount; target = carrying + revaluations after any sequence of postings, revaluations and adjustments; the carrying amount of an item never includes a revaluation;
  - the scenario book: the three new scenarios and the waiting cases `Approved` and run;
  - invariant tests: `period_events` and `revaluations` append-only under forced RLS; the period transitions only with their event; a posting into a closed period refused while a close commits concurrently; invariant 9 ignoring revaluation movements;
  - E2E with RTL screenshots: `/periods`, `/periods/:period` (failing and passing checklist, the close and reopen dialogs), `/revaluation` (both ledgers, current, to post, rate missing) at 360, 768 and 1280 px in light and dark.
