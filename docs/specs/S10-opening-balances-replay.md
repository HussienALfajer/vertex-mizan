# S10 — Opening balances and Hub history replay

Status: Approved (owner, 2026-11-12) · Date: 2026-11-12 · Features: `docs/product/phase-1-scope.md` F12, F10 ("History replay") · ADRs: 0003, 0005, 0006, 0007, 0008, 0011, 0012, 0013, 0014, 0015, 0016, 0017, 0018, 0019

## Summary
Vertex Media's books start on 2026-10-01. Its earlier records hold the balance sheet, and Hub holds the open invoices, wallet balances and unfinished retainer cycles and milestones, some of them entered with dates before Hub went live on 2026-10-19. S10 gives each company a books start, receives Hub's snapshot of its open documents as of the eve, lets the accountant prepare the opening from the old records and the snapshot, checks the records against Hub per client, and posts one opening entry that turns Hub's documents into open items and recognition schedules. Hub then replays every event dated from the books start, and S05–S09 carry on as if Mizan had always kept the books.

## In scope / out of scope
- In:
  - the company's books start, set by the owner (rule 1), and the refusal of postings and closes until the opening is posted (rules 3–4);
  - Hub's opening snapshot through `/v1` (rules 5–9), with the scope `opening:write`;
  - the opening draft: Hub's part computed from the snapshot, the accountant's part from the old records, the records' figures per client and currency, the checks and the preview (rules 10–22);
  - posting the opening by the owner, and its whole reversal while it is the only entry (rules 23–26);
  - events that reverse or change a document dated before the books start (rule 28) and the reclassification of an opening schedule's service (rule 29);
  - the template account `312002` with the role `pre_opening_result`, and its place in the reports (rules 31–33);
  - the screens `/opening` and the books start in `/settings/company`.
- Out (later or never):
  - **Hub's side** (Q5, Hub's sessions): the snapshot, the replay from the books start in Hub's order, the retry on `OPENING_NOT_POSTED`, the reconciliation reports from the books start.
  - **The 1–18 October manual entries:** ordinary S03 entries for what Hub does not hold (expenses, salaries, cash movements outside Hub), made after the opening posts. Nothing new is built for them; `/opening` reminds the accountant that Hub's documents dated from 1 October arrive through the replay.
  - An import of the old trial balance from Excel (scope §8, later); the opening is typed.
  - Opening balances for a company without Hub: the same draft without a snapshot works (rule 10), but no other import exists.
  - Revenue and expenses before the books start: the opening holds the balance sheet only (owner, 2026-11-12). The fiscal year's result before the books start is one figure on `312002`.
  - Year-end close (phase 2), which will close `312002` with the year's result into retained earnings.

## Access
| Action | Surface | Who (role or permission) |
|---|---|---|
| Set or change the books start | Web `/settings/company` | Owner (`company.settings`, fresh two-factor code), while rule 2 allows |
| Send Hub's snapshot | API `POST /v1/opening/snapshot` | API client with `opening:write` |
| Read the opening, its snapshot and its checks | Web `/opening` | Owner, accountant, auditor (`opening.read`) |
| Prepare the opening (its lines and the records' figures) | Web `/opening` | Owner, accountant (`opening.prepare`) |
| Post the opening; reverse it | Web `/opening` | Owner (`opening.post`, fresh two-factor code) |

`opening.read`, `opening.prepare` and `opening.post` are appended to `PERMISSIONS`; `opening:write` to `API_CLIENT_SCOPES`. Viewers and approvers see the opening entry as any entry (`entries.read`), not `/opening`.

## Data
Every company table has `company_id`, forced RLS with `company_isolation`, composite company foreign keys and its kind in the registry (ADR 0003, 0005, 0008, 0012). Money fields follow ADR 0007.

### New tables (`opening` module)
| Table | Kind | Fields | Keys and checks |
|---|---|---|---|
| `opening_snapshots` | append-only | `id`, `company_id`, `api_client_id` → API clients, `snapshot_key` (text 1–100: Hub's id, the `Idempotency-Key`), `as_of` (date), `generated_at` (timestamptz, Hub's), `payload` (jsonb, the validated body), `payload_hash` (SHA-256 hex), `invoice_count`, `wallet_count`, `milestone_count`, `prior_document_count` (int), `received_at` | unique `(company_id, api_client_id, snapshot_key)`; index `(company_id, received_at)`; check `as_of` = the books start − 1 day at insert (trigger) |
| `openings` | draft, then guarded | `id`, `company_id`, `state` (`draft` · `posted` · `reversed`), `version` (int, from 1, +1 on every save), `snapshot_id` (null) → snapshots (the one posted), `entry_id` (null) → entries, `reversal_entry_id` (null) → entries, `prepared_by_user_id`, `posted_by_user_id` (null), `posted_at` (null), `reversed_by_user_id` (null), `reversed_at` (null), `reverse_reason` (text 1–500, null), `created_at`, `updated_at` | unique `(company_id)` where `state <> 'reversed'` (one live opening); guard: `draft → posted` sets `snapshot_id` (when the company has a snapshot), `entry_id`, the poster and time together, by the posting function only; `posted → reversed` sets the reversal fields together; no other update, no delete after `draft` |
| `opening_lines` | draft | `id`, `company_id`, `opening_id` → openings, `line_no` (int), `account_id` → accounts, `dimension_value_ids` (uuid[], sorted), `currency`, `amount_minor` (bigint, signed: debit positive), `book_minor` (bigint, null: computed), `parallel_minor` (bigint, null: computed or no parallel ledger), `item_reference` (text 1–100, null), `item_due_on` (date, null), `memo` (text 1–300, null) | unique `(company_id, opening_id, line_no)`; writable only while its opening is `draft` (trigger) |
| `opening_record_figures` | draft | `id`, `company_id`, `opening_id` → openings, `slot` (`receivable` · `ad_funds`), `client_value_id` → dimension values, `currency`, `amount_minor` (bigint, signed as the account's natural balance: a receivable debit positive, client funds credit positive) | unique `(company_id, opening_id, slot, client_value_id, currency)`; writable only while its opening is `draft` |

### Changed
- **`companies`** gains `books_start` (date, null): the first day of a month, on or after 2026-01-01 (check). Null for a company that starts without an opening (test companies, existing ones). A trigger refuses a change once rule 2 locks it (`BOOKS_START_LOCKED`).
- **`journal_lines.kind`** gains `stated` (ADR 0019): book and parallel amounts given, no `line_conversions` row. The line guard allows it only on an entry whose source is `opening` (pinned in `GUARDS`). `LINE_KINDS` in `packages/contracts` and `packages/ledger` append it.
- **`recognition_schedules`:** `event_id` becomes nullable, with `opening_id` (null) → openings and a check that exactly one is set (an expand change). A schedule from the opening carries Hub's invoice, line, pattern, service period or milestone and dimensions as one from `invoice.issued` does, and `cycle_key` for a retainer cycle, so later credits find it (S06 rule 6).
- **`recognition_movements.kind`** gains `before_opening` (appended): the share S06's rules would have released through the eve, negative, on the opening entry.
- **`open_items`:** source `opening` and the due-date setter `opening` already exist (S04). An opening item of Hub's carries `hub_document` (an invoice, or a milestone for a contract asset); its reference is Hub's number, as an event's item.
- **Account role** `pre_opening_result` (appended): one postable equity account. The service-agency and general templates gain `312002` "نتيجة السنة قبل بدء الدفاتر" / "Result of the year before the books start", under `312`, statement line `bs.retained_earnings`, with that role, in a new template version. The migration adds it to existing companies whose chart holds `312` and not `312002` (synthetic data only), with the role.
- **Hold detail** `before_books_start` (appended to `HOLD_DETAILS`).
- **Audit actions** `company.books_start_set`, `opening.snapshot_received`, `opening.saved`, `opening.posted`, `opening.reversed`.

## States and rules

### The books start
1. The owner sets a company's books start, the first day of a month, at creation (`admin:create-company --books-start <YYYY-MM-DD>`) or in `/settings/company` with the ledger settings (S01's `PUT /api/company/ledgers`, a fresh two-factor code). Vertex Media's is 2026-10-01. It is a different thing from S01's `booksStarted` (the settings lock after the first posted entry).
2. The books start can change only while the company has no posted entry, no snapshot and no opening draft (`BOOKS_START_LOCKED`). It is never cleared once set.
3. **Before the opening is posted**, in a company with a books start (owner, 2026-11-12):
   - `POST /v1/events` refuses every event with `503 OPENING_NOT_POSTED` and `Retry-After: 3600`, storing nothing, so Hub's retry is safe;
   - a manual post, an approval, a revaluation, a release run and a close are refused `OPENING_NOT_POSTED`;
   - `POST /v1/reconciliation/daily` and `GET /v1/periods/status` work as usual.

   So the opening is entry 1 of the books start's fiscal year, and the journal book starts with it.
4. **Months before the books start are closed**, for postings, `GET /v1/periods/status` and the reads, from the moment the books start is set (S07's "before the first period" becomes "before the books start" when one is set). So Hub refuses a change dated before it (Hub's period check, ADR 0006), and an event dated before it is held `PERIOD_CLOSED` (S05), which the accountant may post in the first open period (S05 rule 15).

### Hub's snapshot
5. `POST /v1/opening/snapshot` (`opening:write`) takes Hub's snapshot as of the eve of the books start (`as_of` = books start − 1 day, else `VALIDATION_FAILED`):
   - **`invoices`:** every invoice issued on or before `as_of`, not voided on or before it, that has an outstanding amount at `as_of` or a line whose recognition is unfinished at `as_of` (a retainer cycle ending after it, a deposit or milestone line whose milestone is not done on or before it, a deferred manual line whose service period ends after it). Each with its Hub id, number, client, contract (project or retainer), currency, `issued_on`, `due_on` in force at `as_of`, `syp_per_usd`, total and outstanding at `as_of` (payments dated on or before it and not voided on or before it), and every line with the fields of `invoice.issued`'s lines (source, charge kind, cycle start and end, milestone, service with its department, amount, deferral);
   - **`credits`:** retainer credit lines issued on or before `as_of` on invoices not in `invoices`, that relate to a cycle of a line in `invoices`, with their invoice's id, number, date and rate;
   - **`milestones`:** every milestone of a project whose invoices are in `invoices`, with its id, number, installment, currency, service and `done_on` if done on or before `as_of`; and every milestone done on or before `as_of` and not invoiced by then (a contract asset), with its project and client;
   - **`wallets`:** each client's ad wallet balance in USD at `as_of` (deposits and refunds by `entered_on`, spend by its `period_to`), non-zero only; negative allowed (ADR 0007);
   - **`prior_documents`:** the register of every Hub document dated on or before `as_of`, by type and id: invoices, payments, wallet entries, spend updates, project expenses and milestone dones, with their dates. Rule 28 reads it;
   - `clients`, `contracts`, `services` and `departments` as Hub value references (S05's `hubValueRefSchema`).
6. **Validation** (`422 VALIDATION_FAILED` with field errors, nothing stored): the schema; currencies `SYP` or `USD`; amounts in minor units, outstanding between zero and the total; each invoice's lines summing to its total; ids unique within their list; every reference resolvable within the snapshot; body at most 5 MB.
7. **Storage:** the same key and hash answers the first result (`200`, `replayed: true`); the same key with another body `409 IDEMPOTENCY_CONFLICT`. A new key is stored as a new snapshot; the latest by `received_at` is the one the draft shows. Hub's values are found or created as S05 does for an event's values, when the snapshot is stored (S02 rule 11, links included).
8. **After posting**, a snapshot is refused `409 OPENING_POSTED`; a company without a books start refuses it `409 NO_BOOKS_START`.
9. The answer (`201`): `{ snapshot_id, as_of, received_at, replayed, counts, totals }`, totals per list and currency, so Hub can log what Mizan read.

### The draft
10. One live opening per company (`openings`), created by the first save in `/opening`. A company with a books start and no Hub client prepares it without a snapshot; one with a Hub client (an API client holding `events:write` or `opening:write`) needs one (check `snapshot`, rule 21; owner, 2026-11-12).
11. **Hub's part** is computed on read from the latest snapshot, never typed or stored before posting:
    - **Receivables:** one `document` item per invoice with an outstanding amount, on the `receivable` slot, with the client and contract dimensions an `invoice.issued` would give it, its Hub document, its number as reference and its `due_on` (setter `opening`).
    - **Contract liabilities:** one schedule per line whose recognition is unfinished at `as_of` (rule 13), on the `contract_liability` slot with its dimensions.
    - **Contract assets:** one `document` item per milestone done and not invoiced, on the `contract_asset` slot, its installment in the project's currency, with the milestone as Hub document and its number as reference.
    - **Client ad funds:** one `running` item per wallet on the `ad_funds` slot, in USD, its balance credit (a negative wallet a debit, ADR 0007).
12. **Hub's slots** (`receivable`, `ad_funds`, `contract_asset`) take no line from the accountant (`VALIDATION_FAILED`) in a company with a Hub client (an API client holding `events:write` or `opening:write`): Hub's snapshot is their only source, so a replayed payment finds its item by Hub's document and no document is counted twice. In a company without one, they take the accountant's lines as any control account does, monetary and measured as rule 17 says (owner, 2026-11-12). The accountant may open items on other control accounts, and on Hub's slots in a company without a Hub client, with a reference and an optional due date (source `opening`, no Hub document), as S04 rule 6.
13. **A schedule's opening** is what S06's rules would leave at the end of `as_of` had each snapshot invoice posted on its `issued_on` at its rates, each credit on its date and each milestone done on its `done_on`, computed by S06's pure functions in `packages/ledger` (owner, 2026-11-12):
    - `over_time`: the line's amount less its cumulative share of the cycle's days through `as_of`, cumulative rounding in each ledger, credits applied as S06 rule 6;
    - `point_in_time`: the whole line while its milestone is not done on or before `as_of`; nothing once done;
    - a line S06 would hold (`recognition_pattern_unclear`, `credit_exceeds_cycle`, `milestone_amount_differs`, …) fails check `schedules` with the line and the detail.

    The schedule gets two movements on the opening entry: `deferred`, the line's amount at its rates of issue, and `before_opening`, minus the share through `as_of`. The opening line on the `contract_liability` slot is their sum.
14. **The accountant's part:** a line per balance from the old records: account, dimension values, currency, amount (debit positive) and, as rule 17 requires, the book and parallel amounts. Lines on the account with the `retained_earnings` role are refused: it takes the balancing figure (rule 19). The result of the fiscal year from its start to `as_of` is a line on the `pre_opening_result` account (owner, 2026-11-12), zero allowed.
15. **The records' figures** (owner, 2026-11-12): for each client and currency, the old records' receivable balance and client ad funds balance in the transaction currency. The draft lists every client with a Hub item on those slots and lets the accountant add a client the records hold and Hub does not. A figure not entered is a difference.
16. **Saving** replaces the accountant's lines and figures as one write with the draft's `version` (`OPENING_CHANGED` when another save came first), writes `opening.saved` with the counts, and increments `version`. Saving after posting is refused `OPENING_POSTED`.

### Measurement
17. **Each line's book and parallel amounts** (owner, 2026-11-12; IAS 21.23):
    - **Monetary** (the account is monetary, or the item is on a monetary control account: cash, receivables, contract assets, ad funds, payables): measured at each ledger's policy rate in force on `as_of`, the bulletin in the book ledger and the market rate in the parallel ledger (S02 rule 16), with its `line_conversions`; an amount in the ledger's own currency is itself. Not typed.
    - **Contract liabilities from the snapshot:** at the invoice's rates of issue: the bulletin of `issued_on` in the book ledger and Hub's `syp_per_usd` in the parallel ledger (S03 rule 13), as S06 measures a deferral; the `before_opening` share by cumulative rounding of those amounts (S06).
    - **Non-monetary and equity lines of the accountant:** `stated`, the book and parallel amounts typed from the records (historical rates, IAS 21.23(b)); in the ledger's own currency the amount is itself and only the other ledger is typed. A stated line missing an amount fails check `lines`.
18. **Rounding:** every conversion rounds half away from zero through the money module (ADR 0007); no rounding line is posted: the balancing figure absorbs each ledger's remainder (rule 19).
19. **The balancing figure** (owner, 2026-11-12): one `stated` line on the `retained_earnings` account (`312001`) in the book currency, its book amount minus the sum of the other lines' book amounts and its parallel amount minus the sum of their parallel amounts, so each ledger balances on its own. A zero balancing figure in both ledgers posts no line.

### Checks and posting
20. **The preview** (`GET /api/opening`) shows the entry the draft would post now: every line with its amounts, rates and source (Hub or the records), the balancing figure, the records' comparison and the checks, with a `fingerprint` of the snapshot id, the draft version and the rates used.
21. **Checks**, all of which must pass to post (`OPENING_CHECKS_FAILED`, listing the failing ones):
    - `snapshot`: a snapshot exists when the company has a Hub client (rule 10);
    - `records_agree`: for each client and currency, the records' figure equals Hub's items on that slot in the transaction currency (owner, 2026-11-12: no acceptance of a difference); every difference is listed with both figures;
    - `rates`: each ledger's policy rate for every currency on `as_of`, and the bulletin of every `issued_on` of a schedule, are recorded (S02 rule 16), each missing pair and date named;
    - `mappings`: the slots `receivable`, `ad_funds`, `contract_asset`, `contract_liability` and the roles `retained_earnings` and `pre_opening_result` point to usable accounts, and every Hub value is linked and not archived;
    - `schedules`: no line S06 would hold (rule 13);
    - `lines`: every line of the accountant valid against the chart (S03 invariant 8: postable, currency restriction, required dimensions), stated lines complete, references unique on their account.
22. A check is computed on read; nothing is stored about it, so a rate recorded or a snapshot received changes it at once.
23. **Posting** (`POST /api/opening/post`, owner, fresh two-factor code, owner's decision 2026-11-12) sends the preview's `fingerprint`; a different current fingerprint is `OPENING_CHANGED` with the new preview. In one transaction through `post()` (invariant 11), under the head lock:
    - one entry, source `opening`, dated on the books start, description "قيد الأرصدة الافتتاحية", posting request key `opening:<opening id>`;
    - its lines in the order: Hub's items by slot and number, the schedules' contract liability lines, the accountant's lines, the balancing line;
    - the open items with their `open` movements and due dates, the schedules with their two movements;
    - the opening `posted` with the snapshot id, and `opening.posted` in the audit log with the entry, the snapshot and the totals per ledger.

    A second post answers `OPENING_POSTED`. From the commit, rule 3's refusals stop and Hub's retries post.
24. **Revaluation and recognition carry on:** S07 revalues the opening's monetary items at the end of the books start's month from their opening carrying amounts; S06's release of that month releases each opening schedule's share of the month, cumulative from the cycle's start, the opening's schedules in the order of their lines on the opening entry.

### Correction
25. **The whole reversal** (owner, 2026-11-12): while the opening entry is the company's only posted entry, the owner may reverse it with a reason and a fresh two-factor code (`POST /api/opening/reverse`). Its reversal entry negates every line on the books start (S03 invariant 3); every item it opened moves back to zero, every schedule gets a `reversed` movement; the opening becomes `reversed` and rule 3 applies again. A new draft starts from a copy of the reversed one's lines and figures. After any other entry, the reversal is refused `OPENING_NOT_REVERSIBLE`.
26. **After that,** corrections are manual entries (S03), dated on or after the books start, with a line memo on an opening item (S04 rule 8: `adjusted`, marked "معدّل في ميزان"). The opening entry is never reversed by hand (`ENTRY_NOT_REVERSIBLE`, S03 rule 9).

### The replay and documents before the books start
27. **The replay** (owner, 2026-11-12; ADR 0019): Hub sends every event whose accounting date is on or after the books start, in its order, through `POST /v1/events`, as ordinary events (S05). Documents dated before the books start come only through the snapshot. Events dated from 2026-10-01 that the scope's old wording placed in the 1–18 October summaries come through the replay instead.
28. **Before the books start** (owner, 2026-11-12, for voids; extended to every reversal and change): an event is held `NEEDS_DECISION` with the detail `before_books_start` when it voids, changes, archives or reopens a document listed in the snapshot's `prior_documents` (an invoice, payment, wallet entry, spend update, expense or milestone done), since Mizan holds no posting of it to reverse:
    - `invoice.voided` of an invoice the opening carries;
    - `payment.voided` of a payment dated before the books start;
    - `ad_wallet.entry_voided`, `ad_spend.changed` and `ad_spend.archived` of such an entry or update;
    - `project_expense.changed` and `project_expense.archived` of such an expense;
    - `milestone.reopened` of a done dated before the books start.

    The accountant resolves it by a manual entry (S05 rule 15): a reduction of the current period's revenue when it is a change in estimate (IAS 8.36), or of retained earnings when it corrects a material prior-period error (IAS 8.42), on the items concerned with a memo. Later events on that document follow S05 rule 16.

    **An opening schedule** (owner, 2026-11-12): a manual line on the `contract_liability` account may name an opening schedule of the voided invoice (`schedule`, by Hub's invoice and line), as a line names its item (S04 rule 7): it takes the schedule's dimensions, clears what the schedule still carries at its carried amounts (no rate read; IAS 21.23(b)), and the schedule takes a `reversed` movement and stops. A line naming a schedule for another amount is refused (`VALIDATION_FAILED`). While an `invoice.voided` of an invoice the opening carries is held, S06's release posts nothing of that invoice's schedules; once it is resolved or dismissed, they release what they still carry. `docs/scenarios/opening/before-books-start.md` holds the cases.
29. **A service changed on an opening schedule's line** (`invoice.line_service_changed`): S06 reclassifies the revenue Mizan released for the line, from the books start; what was recognised before it is in equity and is not reclassified. The remaining follows the new service (S06).
30. Every other event about an opening document posts as for any document: a payment clears its receivable item at its carrying amount (S04 rule 4); a due-date change records on its item; a credit finds its cycle's opening schedule; a done releases a deposit's opening schedule; a milestone invoice clears its opening contract asset; a spend or refund clears the client's ad funds at its average.

### Reports
31. **The year's result:** in the fiscal year of the books start, S09 rule 16's computed line "ربح (خسارة) السنة الحالية" adds the balance of the `pre_opening_result` account and says so ("تشمل نتيجة ما قبل بدء الدفاتر"); in later fiscal years, until a year-end close (phase 2), that balance is part of `bs.retained_earnings` with S09's unclosed-years note.
32. **The opening column:** a trial balance, general ledger or account statement whose range starts on the books start shows the opening entry's lines as the opening balance, and its period columns start after it; the report marks it ("الرصيد الافتتاحي من قيد الافتتاح"). The journal book prints the opening entry as entry 1, like any entry.
33. **Before the books start:** a report whose range starts before the books start is read from the books start and marked `before_books_start` ("تبدأ الدفاتر في <date>"); an income statement of the books start's fiscal year says the result before it is in equity.

## Accounting treatment
- **The opening entry** (source `opening`, dated on the books start; basis: the old records, Hub's snapshot and S06's rules; IAS 1.54 for the balance sheet):
  - Dr each receivable item (`112001`, client and contract) / Cr nothing paired: each item's outstanding, measured at the eve's rates;
  - Dr each contract asset item (`113001`, client and contract);
  - Cr each opening schedule's remaining (`212001`, client and contract, as S06's deferral);
  - Cr each client's ad funds (`213001`, client; Dr for a negative wallet);
  - Dr or Cr each balance of the records: cash and bank (`111001`–`111006`), other assets and liabilities, capital (`311001`), the owner's current account (`313001`), the year's result before the books start (`312002`);
  - Cr or Dr retained earnings (`312001`), the balancing figure in each ledger.

  No revenue or expense line (owner, 2026-11-12). The revenue recognised before the books start is in equity, inside `312002` (this year) or `312001` (earlier years).
- **Its reversal:** the exact negation, rule 25, only while it is the only entry.
- **Open items:** the opening's items carry `open` movements (document) or `add` (running), as new items (S04).
- **Schedules:** `deferred` and `before_opening` movements on the opening entry; S06 continues them (rule 24).
- **Revaluation:** the opening's monetary balances are revalued at the books start's month end (S07); contract liabilities and stated lines are not.
- **Events on documents before the books start:** held for the accountant (rule 28); no automatic entry.

### Worked example (`syp-usd`, Vertex Media)
Rates: bulletin 114.0000 on 2026-09-10 and 115.0000 on 2026-09-30; market 118.0000 on 2026-09-30. Hub's snapshot as of 2026-09-30:
- invoice INV-2026-7 to client A, issued 2026-09-10 at Hub's rate 117.0000, one monthly retainer line of 300.00 USD for the cycle 2026-09-16 to 2026-10-15 (30 days), unpaid;
- client A's wallet: 500.00 USD.

The records: SYP cash on hand 2,000,000.00 SYP (parallel at the market rate); capital 1,000,000.00 SYP stated at 10,000.00 USD; the year's result before the books start 300,000.00 SYP stated at 2,600.00 USD; the records' figures for client A: receivables 300.00 USD, ad funds 500.00 USD, which agree with Hub.

| Line | Account | Currency amount | Book (SYP) | Parallel (USD) | Basis |
|---|---|---|---|---|---|
| 1 | `112001` item INV-2026-7, client A | Dr 300.00 USD | Dr 34,500.00 | Dr 300.00 | monetary, bulletin 115 of 30 Sep |
| 2 | `212001` schedule INV-2026-7/1, client A | Cr 150.00 USD | Cr 17,100.00 | Cr 150.00 | 300.00 at issue (114) = 34,200.00, less 15 of 30 days |
| 3 | `213001` client A | Cr 500.00 USD | Cr 57,500.00 | Cr 500.00 | monetary, bulletin 115 |
| 4 | `111001` | Dr 2,000,000.00 SYP | Dr 2,000,000.00 | Dr 16,949.15 | monetary, market 118 (16,949.152… rounded) |
| 5 | `311001` (stated) | Cr 1,000,000.00 SYP | Cr 1,000,000.00 | Cr 10,000.00 | records |
| 6 | `312002` (stated) | Cr 300,000.00 SYP | Cr 300,000.00 | Cr 2,600.00 | records |
| 7 | `312001` (stated, balancing) | Cr 659,900.00 SYP | Cr 659,900.00 | Cr 3,999.15 | 2,034,500.00 − 1,374,600.00; 17,249.15 − 13,250.00 |

Afterwards: S06's October release posts Dr `212001` / Cr `411001` 150.00 USD, 17,100.00 SYP, 150.00 USD (days 1–15 October). A replayed `payment.recorded` of 300.00 USD on 2026-10-20 into `111004` at a bulletin of 118 posts Dr `111004` 35,400.00 / Cr the item 34,500.00 / Cr `421001` realised gain 900.00 in the book ledger (S04 rule 10).

## Currencies, rates and rounding
- **Transaction amounts:** Hub's, in SYP or USD; the records' in the account's currency.
- **Book ledger:** the bulletin of `as_of` for monetary items, of `issued_on` for contract liabilities; stated for the records' non-monetary lines and equity.
- **Parallel ledger:** the market rate of `as_of` for monetary items; Hub's `syp_per_usd` of the invoice for contract liabilities (S03 rule 13, a dealt rate the market ledger accepts); stated otherwise.
- **`third`:** a third-currency balance of the records is measured through S02's cross rates on `as_of` when monetary; Hub sends only SYP and USD.
- **`usd-syp`** (a USD book): the roles swap as in S02; the worked example's logic holds with the book ledger in USD.
- **`syp`** (no parallel ledger): parallel amounts are null; stated lines carry the book amount only.
- **Rounding:** half away from zero per conversion; cumulative rounding of the `before_opening` share (S06); the balancing line absorbs the remainder per ledger; no rounding line (rule 18).
- **Rate corrections:** a bulletin of `as_of` corrected after posting lists the opening's conversions (S02 rule 15) like any entry; the opening is not re-measured, and the accountant corrects by a manual entry.

## Periods
- The opening entry creates the books start's period (`open`), the company's first period (S07 rule 2).
- Every month before the books start is closed from the moment it is set (rule 4); no event or entry posts into it; Hub's events dated there are held `PERIOD_CLOSED` and may be posted in the first open period (S05 rule 15).
- No posting, revaluation, release or close before the opening is posted (rule 3). The close of the books start's month runs S07's checklist unchanged; its `reconciliation_clean` reads every day from the client's `reconcile_from`, which for Vertex Media becomes the books start (S08 rule 13, amended by ADR 0019).
- The whole reversal is possible only before any other entry, so no month has closed by then.

## API
| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /v1/opening/snapshot` | API client `opening:write` | `openingSnapshotSchema`, header `Idempotency-Key` = `snapshot_key` | `201` (`200` on a replay): `openingSnapshotResultSchema` | `VALIDATION_FAILED`, `IDEMPOTENCY_CONFLICT`, `OPENING_POSTED`, `NO_BOOKS_START`, `RATE_LIMITED` |
| `POST /v1/events` | API client `events:write` | as S05 | as S05 | S05's, and `OPENING_NOT_POSTED` (`503`, `Retry-After`) before the opening posts |
| `GET /api/opening` | `opening.read` | — | `openingViewSchema`: state, books start, the latest snapshot's summary, Hub's lines, the accountant's lines, the records' comparison, the balancing figure, the checks, the fingerprint, the posted entry and its reversal | `NO_BOOKS_START` |
| `PUT /api/opening` | `opening.prepare` | `{ version, lines[], recordFigures[] }` | the view | `VALIDATION_FAILED`, `OPENING_CHANGED`, `OPENING_POSTED`, `NO_BOOKS_START` |
| `POST /api/opening/post` | `opening.post`, reauthenticated | `{ fingerprint }` | the posted entry's id, fiscal year and number | `OPENING_CHANGED`, `OPENING_CHECKS_FAILED`, `OPENING_POSTED`, `REAUTHENTICATION_REQUIRED` |
| `POST /api/opening/reverse` | `opening.post`, reauthenticated | `{ reason }` | the reversal entry's id and number | `OPENING_NOT_REVERSIBLE`, `VALIDATION_FAILED`, `REAUTHENTICATION_REQUIRED` |
| `PUT /api/company/ledgers` | `company.settings`, reauthenticated | S01's body with `booksStart` (date or null) | `companySchema` with `booksStart` and `openingState` | S01's (`COMPANY_SETTINGS_LOCKED` once books started), `BOOKS_START_LOCKED`, `VALIDATION_FAILED` |
| `POST /api/entries/*`, `/api/revaluation/*`, `/api/periods/:p/close` | as S03, S07 | as before | as before | add `OPENING_NOT_POSTED` |

New error codes, appended in order with their status (ADR 0006, `pnpm check:error-codes`): `OPENING_NOT_POSTED` 503, `OPENING_POSTED` 409, `OPENING_CHANGED` 409, `OPENING_CHECKS_FAILED` 409, `OPENING_NOT_REVERSIBLE` 409, `NO_BOOKS_START` 409, `BOOKS_START_LOCKED` 409. `/v1` changes are additive: a new endpoint, a new scope, a new error code on `/v1/events` and a new hold detail, which clients accept unknown (S05). The snapshot's JSON Schema and an example join `export:hub-schema`, and `post:hub-examples` gains `--opening` to post the example snapshot.

## Jobs and events
- No new job. The posting of the opening commits before Hub's next retry; S05's automatic retries are unchanged.
- **Hub's side** (Q5): the snapshot (rule 5) before the replay, then the events from the books start in Hub's order, each retried on `503 OPENING_NOT_POSTED` until the opening is posted; the daily reconciliation reports from the books start (S08 rule 6).
- **`opening.snapshot_received`** is written per snapshot; the daily digest (S05) lists a company with a books start whose opening is not posted, from the day a snapshot arrives ("الأرصدة الافتتاحية لم تُرحَّل بعد").

## Screens
| Route | Purpose and content | Actions | Drill-down | Export | States | Roles |
|---|---|---|---|---|---|---|
| `/opening` | The opening of the company, in four steps on one page: **1. Hub** (the latest snapshot's date, counts and totals per currency, or "لم تصل لقطة Hub بعد"); **2. Records** (the accountant's lines in a ledger-entry grid: account, dimensions, currency, amount, book and parallel, the computed ones read-only with their rate and date, "منقول" stated ones typed; the year's result before the books start); **3. Agreement** (per client and currency: the records' figure, Hub's, the difference, on receivables and client funds); **4. Review** (the entry's preview with Hub's lines grouped by slot and expandable to each item or schedule, the balancing figure per ledger, the checks with their failing items and links: missing rates to `/rates`, mappings to `/settings/posting-rules`, values to `/dimensions`) | Save; post (owner, two-factor dialog); after posting, reverse (owner, reason, two-factor, while allowed) | Each Hub line opens the invoice, wallet or milestone in the snapshot; the posted entry opens `/entries/:id` | Excel of the preview and of the agreement | Loading skeleton; no books start ("حدّد تاريخ بدء الدفاتر في إعدادات الشركة"); no snapshot yet; checks failing (the post button disabled with the reasons); `OPENING_CHANGED` read again with a notice; posted (read-only, the entry, the snapshot it used); reversed (the history and a new draft) | Owner and accountant edit; auditor reads; owner posts and reverses |
| `/settings/company` | Gains "تاريخ بدء الدفاتر", the first day of a month, with the lock of rule 2 explained | Set (owner, two-factor) | — | — | Locked state names why | Owner sets; others read |
| `/entries/:id` | The opening entry shows "قيد افتتاحي", its source, the snapshot and the opening's link | — | — | as S03 | — | as S03 |
| Sidebar and palette | "الأرصدة الافتتاحية" under settings while the opening is not posted; afterwards in the palette only | — | — | — | — | `opening.read` |

The grid and the agreement table use `packages/ui`'s components (`DataTable`, `Amount`, the entry grid of S03); amounts only through `Amount`. A component the step needs and the design system lacks is built in `packages/ui` first (ADR 0010 §7).

## Reports
- Rules 31–33 change S09's year's result, its opening column at the books start and the before-the-books-start mark.
- **The opening's agreement with Hub** (scope "Done when" 3) is `/opening`'s step 3, frozen at posting: Hub's items equal the records' figures per client and currency, and the entry's lines equal Hub's items (a test).
- The integrity check (S03, S06) holds: the opening's contract liability lines equal its schedules' movements; its items' movements equal its control lines.

## Printing and legal books
- The journal book (S09) prints the opening entry as entry 1 of the books start's fiscal year, with its lines in rule 23's order, its Arabic description, and SYP labelled "الليرة السورية الجديدة". Nothing else is printed.

## Volume and performance
- Vertex Media: under 300 open invoices, under 100 wallets and under 1,000 prior documents; the snapshot under 1 MB; the opening entry under 800 lines.
- Largest company served: 5,000 open invoices; the snapshot's 5 MB limit allows it.
- `GET /api/opening` computes the preview from the snapshot and the rates in under 2 s for Vertex Media (the schedules' computation is pure); the post in under 10 s.
- Indexes: the snapshot's `(company_id, received_at)`; `prior_documents` read from the latest posted snapshot's jsonb by an expression index on `(company_id)` plus a GIN on the register, or a lookup table built at posting if a test shows the GIN too slow.

## Migration and compatibility
- Expand migrations (`/db-migration`): `companies.books_start`; the four tables; `stated` in the line kinds with its guard; `recognition_schedules.event_id` nullable with `opening_id` and the check; `before_opening`; `312002` with its role in existing companies holding `312`; the new template version.
- **Existing companies** have no books start, so rule 3 does not apply to them; nothing changes for them.
- **Vertex Media's production company** is created with `--books-start 2026-10-01`, and its Hub client's `reconcile_from` is 2026-10-01.
- **`/v1`:** additive (API section). Existing clients are untouched.
- **Documents amended** with this spec: phase 1 scope §4 ("Start of the books"), F10 ("History replay") and §7.8; ADR 0006 and 0017 by ADR 0019; S08 rule 13's start date for Vertex Media; S05 edge case 19 and S06 edge case 19, whose invoices before the replay now come through the snapshot.
- **Hub's side** (Q5, added to its list): the snapshot of rule 5 with its as-of computation (voids and payments by their dates), the register of prior documents, the replay from the books start in Hub's order, the retry on `503 OPENING_NOT_POSTED`, and the reconciliation reports from the books start.

## Arabic strings and number formats
- `ar.opening`: the page and its steps ("الأرصدة الافتتاحية"، "لقطة Hub"، "أرصدة السجلات"، "المطابقة مع Hub"، "المراجعة والترحيل"), the line sources ("من Hub"، "من السجلات"، "محسوب"، "منقول"), the checks, the states, the dialogs, the errors.
- `ar.settings.booksStart` ("تاريخ بدء الدفاتر"), `ar.reports` marks of rules 32–33, the hold detail `before_books_start` ("وثيقة سابقة لبدء الدفاتر يحملها قيد الافتتاح").
- Glossary terms: books start, opening entry, opening snapshot, balancing figure, stated amount, prior documents, result of the year before the books start.
- Latin digits; dates `YYYY-MM-DD`; amounts through `Amount`.

## Audit
- `company.books_start_set` with before and after.
- `opening.snapshot_received` per stored snapshot (not on a replay), with its counts and totals.
- `opening.saved` per save with the counts of lines and figures and the version.
- `opening.posted` with the entry, snapshot, fingerprint and totals per ledger; `opening.reversed` with the reason and the reversal entry.
- Reads of `/opening` are not audited (S01 audits only its listed reads).

## Abuse and failure cases
- **Replays:** the snapshot key and hash (rule 7); the opening's posting request `opening:<id>` (invariant 5) and the state guard: a second post answers `OPENING_POSTED`.
- **Double submits:** the fingerprint and the draft version (`OPENING_CHANGED`).
- **Races with Hub:** a snapshot arriving during a post changes the fingerprint, so the post refuses; Hub's events before the post are refused `503` and retried after.
- **Races with a close:** no close before the opening (rule 3).
- **Cross-company access:** the snapshot's company from the API key (ADR 0003); every table under RLS; a value reference resolves only in the key's company.
- **A stolen API key with `opening:write`:** it can send a snapshot until the opening posts, which the agreement check (records per client) and the owner's review stop from reaching the books; the owner revokes the key (S05).
- **Hub down:** the opening waits for the snapshot; nothing else depends on it.
- **Out-of-order events:** the replay keeps S05's order per item; an event about a document before the books start is held (rule 28), never posted against nothing.
- **A backdated document in Hub after the snapshot:** refused by Hub's period check (rule 4), or held `PERIOD_CLOSED` if it arrives.
- **A wrong opening found later:** the whole reversal before any other entry; manual corrections after.

## Edge cases
1. An invoice paid in full by `as_of` whose cycle continues: a schedule, no receivable item.
2. An invoice with an outstanding amount and its service complete: an item, no schedule.
3. A partly paid invoice whose payment is in the other currency: the item is the outstanding in the invoice's currency, at the eve's rates; the past payments' differences are in the records.
4. A negative wallet (spend beyond deposits): a debit running item on `213001` (ADR 0007), compared with the records' negative figure.
5. A deposit invoiced before `as_of` whose milestone is done in the replay: the opening schedule is released on the done date (S06 rule 11).
6. A milestone done before `as_of` and invoiced in the replay: the invoice clears the opening contract asset (S06), and a difference in its currency is held `NEEDS_DECISION` as S06 says.
7. A credit issued in the replay for a cycle of an opening invoice: S06 rule 6 against the opening schedule; the recognised part includes the days before the books start, reducing revenue on the credit's date (IFRS 15.88).
8. A credit issued before `as_of` for a cycle of an opening invoice: applied in the opening's computation (rule 13).
9. A cycle that started before the books start and is invoiced late in the replay: S06's late issue holds `SERVICE_PERIOD_CLOSED` for the elapsed days in the closed months before the books start; the accountant recognises them in the first open period or decides (S06 rule 16).
10. A cycle that crosses the books start and a month end (2026-09-16 to 2026-10-15): the opening holds 15 of 30 days, October releases the other 15.
11. A leap day in a cycle: S06's day count holds.
12. An invoice voided in the replay that the opening carries: held `before_books_start` (rule 28); its later payments' voids likewise.
13. A payment dated before the books start voided in the replay: held `before_books_start`; the accountant reopens the receivable by a manual entry with a memo.
14. A client the records hold and Hub does not: a records' figure with no Hub item, a difference that blocks the post until Hub or the records are corrected.
15. A client archived in Mizan whose Hub value the snapshot names: check `mappings` fails until restored (S02 rule 13).
16. A blocked or archived account on a Hub slot: check `mappings` fails.
17. A missing bulletin for an old `issued_on`: check `rates` names it; the accountant records it in `/rates` (S02).
18. `as_of` is a day without a bulletin: S02 rule 16's rate in force on that date (the last publication), as for any date.
19. A zero balancing figure in one ledger only: the line posts with zero in that ledger.
20. The year's result before the books start is a loss: a debit on `312002`.
21. A `syp` company with a books start and no Hub client: no snapshot, no records' figures; the lines (its receivables as items on `112001` with their references and due dates, monetary, rule 12) and the balancing figure only.
22. A `usd-syp` company: monetary SYP items measured at the bulletin into the USD book, Hub's rate in the SYP parallel ledger.
23. A `third` balance (TRY cash) in the records: measured through the cross on `as_of`; Hub's part has none.
24. The opening reversed and posted again: entries 1 (opening), 2 (its reversal), 3 (the new opening) in the journal book; items and schedules of the first are closed and new ones opened.
25. A reversal requested after a Hub event posted: refused `OPENING_NOT_REVERSIBLE`.
26. Two owners post at once: one posts; the other gets `OPENING_POSTED`.
27. A snapshot whose `as_of` is not the eve: refused `VALIDATION_FAILED`.
28. A books start change after a snapshot: refused `BOOKS_START_LOCKED`.
29. A service changed in the replay on an opening schedule's line: rule 29.

## Scenarios
- **`docs/scenarios/opening/opening-entry.md`** (new area `opening`): the worked example in `syp-usd` (Vertex Media), extended with a deposit line, a contract asset, a negative wallet, a credit before `as_of`, an SYP invoice in the USD parallel ledger, a stated non-monetary asset and a loss before the books start; the balancing figure per ledger; the October release of an opening schedule and the October revaluation of the opening items; a replayed payment on an opening item; the whole reversal and the new opening; `syp` (no Hub, a balancing figure only), `usd-syp` and `third` (a TRY cash balance) cases. The format gains an `opening` step (a snapshot and the records) and a `reverse_opening` step.
- **`docs/scenarios/opening/before-books-start.md`:** the holds of rule 28 (an invoice void, a payment void, a wallet void, a spend change, an expense archive, a milestone reopen) with their resolution by a manual entry; a backdated event held `PERIOD_CLOSED` and posted in the first open period; the service reclassification of rule 29.
- **`docs/scenarios/reports/statement-presentation.md`** gains a case: the year's result with `312002` in the books start's year and in the next, and the trial balance's opening column at the books start (rules 31–32).

Each is written and approved through `/posting-rule` before its code.

## Open questions
None. Q4 is answered (one account per Hub payment method and currency, the template's six; owner, 2026-11-12). Hub's side is added to Q5.

## Acceptance
- **The owner's end-to-end check, step by step** (a test company with the service-agency chart, `syp-usd`, books start 2026-10-01, an API client "Vertex Hub" with `events:write`, `opening:write` and `reconciliation:write`, `reconcile_from` 2026-10-01):
  1. Post Hub's example snapshot (`post:hub-examples --opening`), then the example events: the events are refused `503 OPENING_NOT_POSTED`; a manual entry is refused too.
  2. Open `/opening`: Hub's step shows the snapshot; the review fails `rates` and `records_agree`.
  3. Record the bulletins of 2026-09-10 and 2026-09-30 and the market rate of 2026-09-30; type the cash, capital and the year's result before the books start; type the records' figures for client A.
  4. The review shows the worked example's seven lines and passes every check; post with the two-factor code: entry 1 of 2026 dated 2026-10-01.
  5. Post the example events again: they post; the payment clears INV-2026-7 with a 900.00 SYP gain; October's release moves 150.00 USD out of `212001`.
  6. Read the trial balance for October: the opening column holds the opening entry; the balance sheet's year's result includes 300,000.00 SYP before the books start.
  7. Post `invoice.voided` for an invoice the opening carries: held `NEEDS_DECISION`, `before_books_start`.
  8. Try to reverse the opening: refused `OPENING_NOT_REVERSIBLE`.
- **Tests:**
  - API: each endpoint's success, `401`, `403` (a key without `opening:write`, a person without `opening.post`, without a fresh code), another company's client seeing nothing, an idempotent snapshot replay and a `409` conflict; `OPENING_NOT_POSTED` on `/v1/events` and `/api` before posting; the snapshot's validation;
  - unit and property tests: the opening's schedules equal what S06's functions leave after posting the same invoices on their dates, for any cycles, credits and as-of dates; the entry balances in both ledgers for any snapshot and lines; the balancing figure is the only remainder; the opening plus its reversal nets to zero on every account, item and schedule;
  - the scenario book's `opening` cases and the new presentation case;
  - invariant tests: the new tables' kinds, RLS and composite keys; `stated` refused outside an opening entry; the opening's state guard; `books_start`'s lock; schedules with exactly one of event and opening;
  - E2E with RTL screenshots: `/opening` through its steps, the failing checks, the post dialog, the posted and reversed states, at 360, 768 and 1280 px in light and dark; the books start in `/settings/company`.
