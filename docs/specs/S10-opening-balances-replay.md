# S10 — Opening balances and the books start

Status: Approved (owner, 2026-11-12), amended by ADR 0021 (2026-11-13: Hub's snapshot, the records' agreement with Hub and the history replay removed) · Date: 2026-11-12 · Features: `docs/product/phase-1-scope.md` F12 · ADRs: 0003, 0005, 0007, 0008, 0011, 0012, 0013, 0016, 0018, 0019, 0021

Rule numbers are kept as approved, so code, tests and scenarios that cite them stay right; a rule removed with Hub reads "Withdrawn (ADR 0021)". The Hub parts are in git history at commit `1a0ee40`.

## Summary
A company's books start on the first day of a month. Its earlier records hold the balance sheet. S10 gives each company a books start, lets the accountant prepare the opening from the old records, checks it, and posts one opening entry that opens the balance sheet in both ledgers, with open items on control accounts. Manual entries (S03), revaluation and periods (S07) and the reports (S09) then carry on as if Mizan had always kept the books.

## In scope / out of scope
- In:
  - the company's books start, set by the owner (rule 1), and the refusal of postings and closes until the opening is posted (rules 3–4);
  - the opening draft: the accountant's lines from the old records, the checks and the preview (rules 10–22);
  - posting the opening by the owner, and its whole reversal while it is the only entry (rules 23–26);
  - a correction of an earlier year against retained earnings (rule 28);
  - the template account `312002` with the role `pre_opening_result`, and its place in the reports (rules 31–33);
  - the screens `/opening` and the books start in `/settings/company`.
- Out (later or never):
  - Hub's snapshot, the records' agreement with Hub and the history replay (withdrawn by ADR 0021).
  - An import of the old trial balance from Excel (scope §8, later); the opening is typed.
  - Revenue and expenses before the books start: the opening holds the balance sheet only (owner, 2026-11-12). The fiscal year's result before the books start is one figure on `312002`.
  - Year-end close (phase 2), which will close `312002` with the year's result into retained earnings.

## Access
| Action | Surface | Who (role or permission) |
|---|---|---|
| Set or change the books start | Web `/settings/company` | Owner (`company.settings`, fresh two-factor code), while rule 2 allows |
| Read the opening and its checks | Web `/opening` | Owner, accountant, auditor (`opening.read`) |
| Prepare the opening (its lines) | Web `/opening` | Owner, accountant (`opening.prepare`) |
| Post the opening; reverse it | Web `/opening` | Owner (`opening.post`, fresh two-factor code) |

Viewers and approvers see the opening entry as any entry (`entries.read`), not `/opening`.

## Data
Every company table has `company_id`, forced RLS with `company_isolation`, composite company foreign keys and its kind in the registry (ADR 0003, 0005, 0008, 0012). Money fields follow ADR 0007.

### Tables (`opening` module)
| Table | Kind | Fields | Keys and checks |
|---|---|---|---|
| `openings` | draft, then guarded | `id`, `company_id`, `state` (`draft` · `posted` · `reversed`), `version` (int, from 1, +1 on every save), `entry_id` (null) → entries, `reversal_entry_id` (null) → entries, `prepared_by_user_id`, `posted_by_user_id` (null), `posted_at` (null), `reversed_by_user_id` (null), `reversed_at` (null), `reverse_reason` (text 1–500, null), `created_at`, `updated_at` | unique `(company_id)` where `state <> 'reversed'` (one live opening); guard: `draft → posted` sets `entry_id`, the poster and time together, by the posting function only; `posted → reversed` sets the reversal fields together; no other update, no delete after `draft` |
| `opening_lines` | draft | `id`, `company_id`, `opening_id` → openings, `line_no` (int), `account_id` → accounts, `dimension_value_ids` (uuid[], sorted), `currency`, `amount_minor` (bigint, signed: debit positive), `book_minor` (bigint, null: computed), `parallel_minor` (bigint, null: computed or no parallel ledger), `item_reference` (text 1–100, null), `item_due_on` (date, null), `memo` (text 1–300, null) | unique `(company_id, opening_id, line_no)`; writable only while its opening is `draft` (trigger) |

### Changed
- **`companies`** gains `books_start` (date, null): the first day of a month, on or after 2026-01-01 (check). Null for a company that starts without an opening (test companies). A trigger refuses a change once rule 2 locks it (`BOOKS_START_LOCKED`).
- **`journal_lines.kind`** gains `stated` (ADR 0019): book and parallel amounts given, no `line_conversions` row. The line guard allows it only on an entry whose source is `opening` (pinned in `GUARDS`). `LINE_KINDS` in `packages/contracts` and `packages/ledger` append it.
- **`open_items`:** source `opening` and the due-date setter `opening` already exist (S04).
- **Account role** `pre_opening_result` (appended): one postable equity account. The general template has `312002` "نتيجة السنة قبل بدء الدفاتر" / "Result of the year before the books start", under `312`, statement line `bs.retained_earnings`, with that role.
- **Audit actions** `company.books_start_set`, `opening.saved`, `opening.posted`, `opening.reversed`.

## States and rules

### The books start
1. The owner sets a company's books start, the first day of a month, at creation (`admin:create-company --books-start <YYYY-MM-DD>`) or in `/settings/company` with the ledger settings (S01's `PUT /api/company/ledgers`, a fresh two-factor code). It is a different thing from S01's `booksStarted` (the settings lock after the first posted entry).
2. The books start can change only while the company has no posted entry and no opening draft (`BOOKS_START_LOCKED`). It is never cleared once set.
3. **Before the opening is posted**, in a company with a books start (owner, 2026-11-12), a manual post, an approval, a revaluation and a close are refused `OPENING_NOT_POSTED`. So the opening is entry 1 of the books start's fiscal year, and the journal book starts with it.
4. **Months before the books start are closed**, for postings and the reads, from the moment the books start is set (S07's "before the first period" becomes "before the books start" when one is set).

### Hub's snapshot
5. Withdrawn (ADR 0021).
6. Withdrawn (ADR 0021).
7. Withdrawn (ADR 0021).
8. Withdrawn (ADR 0021).
9. Withdrawn (ADR 0021).

### The draft
10. One live opening per company (`openings`), created by the first save in `/opening`, prepared from the old records.
11. Withdrawn (ADR 0021).
12. **Items:** the accountant opens items on any control account with a reference and an optional due date (source `opening`), as S04 rule 6, monetary and measured as rule 17 says (owner, 2026-11-12).
13. Withdrawn (ADR 0021).
14. **The accountant's lines:** a line per balance from the old records: account, dimension values, currency, amount (debit positive) and, as rule 17 requires, the book and parallel amounts. Lines on the account with the `retained_earnings` role are refused: it takes the balancing figure (rule 19). The result of the fiscal year from its start to the eve of the books start is a line on the `pre_opening_result` account (owner, 2026-11-12), zero allowed.
15. Withdrawn (ADR 0021).
16. **Saving** replaces the accountant's lines as one write with the draft's `version` (`OPENING_CHANGED` when another save came first), writes `opening.saved` with the count of lines, and increments `version`. Saving after posting is refused `OPENING_POSTED`.

### Measurement
17. **Each line's book and parallel amounts** (owner, 2026-11-12; IAS 21.23):
    - **Monetary** (the account is monetary, or the item is on a monetary control account: cash, receivables, payables): measured at each ledger's policy rate in force on the eve of the books start, the bulletin in a bulletin ledger and the market rate in a market ledger (S02 rule 16), with its `line_conversions`; an amount in the ledger's own currency is itself. Not typed.
    - **Non-monetary and equity lines:** `stated`, the book and parallel amounts typed from the records (historical rates, IAS 21.23(b)); in the ledger's own currency the amount is itself and only the other ledger is typed. A stated line missing an amount fails check `lines`.
18. **Rounding:** every conversion rounds half away from zero through the money module (ADR 0007); no rounding line is posted: the balancing figure absorbs each ledger's remainder (rule 19).
19. **The balancing figure** (owner, 2026-11-12): one `stated` line on the `retained_earnings` account (`312001`) in the book currency, its book amount minus the sum of the other lines' book amounts and its parallel amount minus the sum of their parallel amounts, so each ledger balances on its own. A zero balancing figure in both ledgers posts no line.

### Checks and posting
20. **The preview** (`GET /api/opening`) shows the entry the draft would post now: every line with its amounts and rates, the balancing figure and the checks, with a `fingerprint` of the draft version and the rates used.
21. **Checks**, all of which must pass to post (`OPENING_CHECKS_FAILED`, listing the failing ones):
    - `rates`: each ledger's policy rate for every currency on the eve is recorded (S02 rule 16), each missing pair and date named;
    - `mappings`: the roles `retained_earnings` and `pre_opening_result` point to usable accounts;
    - `lines`: every line valid against the chart (S03 invariant 8: postable, currency restriction, required dimensions), stated lines complete, references unique on their account.
22. A check is computed on read; nothing is stored about it, so a rate recorded changes it at once.
23. **Posting** (`POST /api/opening/post`, owner, fresh two-factor code, owner's decision 2026-11-12) sends the preview's `fingerprint`; a different current fingerprint is `OPENING_CHANGED` with the new preview. In one transaction through `post()` (invariant 11), under the head lock:
    - one entry, source `opening`, dated on the books start, description "قيد الأرصدة الافتتاحية", posting request key `opening:<opening id>`;
    - its lines in the order: the accountant's lines, the balancing line;
    - the open items with their `open` movements and due dates;
    - the opening `posted`, and `opening.posted` in the audit log with the entry and the totals per ledger.

    A second post answers `OPENING_POSTED`. From the commit, rule 3's refusals stop.
24. **Revaluation carries on:** S07 revalues the opening's monetary items at the end of the books start's month from their opening carrying amounts.

### Correction
25. **The whole reversal** (owner, 2026-11-12): while the opening entry is the company's only posted entry, the owner may reverse it with a reason and a fresh two-factor code (`POST /api/opening/reverse`). Its reversal entry negates every line on the books start (S03 invariant 3); every item it opened moves back to zero; the opening becomes `reversed` and rule 3 applies again. A new draft starts from a copy of the reversed one's lines. After any other entry, the reversal is refused `OPENING_NOT_REVERSIBLE`.
26. **After that,** corrections are manual entries (S03), dated on or after the books start, with a line memo on an opening item (S04 rule 8: `adjusted`, marked "معدّل في ميزان"). The opening entry is never reversed by hand (`ENTRY_NOT_REVERSIBLE`, S03 rule 9).

### Corrections of the time before the books start
27. Withdrawn (ADR 0021).
28. **A correction against retained earnings** (owner, 2026-11-12; IAS 8.42): a material prior-period error found after the books start is corrected by a manual entry against retained earnings, on the items concerned with a memo; a change in estimate goes to the current period (IAS 8.36). In an entry with a line on the account with the `retained_earnings` role whose residual is a realised difference (a line carried, or lines in more than one currency; an entry of new measurements in one currency, such as a dividend, keeps S03's rounding and is not refused; owner, 2026-11-13), each ledger's residual (S04 rule 10) posts to that account instead of `fx_realised_gain` or `fx_realised_loss`, so the correction takes exactly what the items it clears carried and leaves the current year's profit untouched. Only a correction on its own: such an entry whose other lines are not all carried (an item's line) is refused `VALIDATION_FAILED`, since a real exchange difference of another line would reach equity (IAS 21.28); the accountant posts the correction as an entry of its own (owner, 2026-11-12).
29. Withdrawn (ADR 0021).
30. Withdrawn (ADR 0021).

### Reports
31. **The year's result:** in the fiscal year of the books start, S09 rule 16's computed line "ربح (خسارة) السنة الحالية" adds the balance of the `pre_opening_result` account and says so ("تشمل نتيجة ما قبل بدء الدفاتر"); in later fiscal years, until a year-end close (phase 2), that balance is part of `bs.retained_earnings` with S09's unclosed-years note, presented by its account as `312001` is, so the unclosed years' result stays the net of classes 4–5 of the earlier years and the opening's line is never counted twice (owner, 2026-11-12).
32. **The opening column:** a trial balance, general ledger or account statement whose range starts on the books start shows the opening entry's lines as the opening balance, and its period columns start after it (an entry of the same date included); the report marks it ("الرصيد الافتتاحي من قيد الافتتاح"), as it does a range from before the books start, which is read from it (rule 33; owner, 2026-11-12). The journal book prints the opening entry as entry 1, like any entry.
33. **Before the books start:** a report whose range starts before the books start is read from the books start and marked `before_books_start` ("تبدأ الدفاتر في <date>"); every income statement of the books start's fiscal year, whatever its range, says the result before it is in equity ("نتيجة ما قبل بدء الدفاتر ضمن حقوق الملكية"; owner, 2026-11-12).

## Accounting treatment
- **The opening entry** (source `opening`, dated on the books start; basis: the old records; IAS 1.54 for the balance sheet):
  - Dr or Cr each balance of the records: cash and bank, receivables and payables as open items, other assets and liabilities, capital (`311001`), the owner's current account (`313001`), the year's result before the books start (`312002`);
  - Cr or Dr retained earnings (`312001`), the balancing figure in each ledger.

  No revenue or expense line (owner, 2026-11-12). The result before the books start is in equity, inside `312002` (this year) or `312001` (earlier years).
- **Its reversal:** the exact negation, rule 25, only while it is the only entry.
- **Open items:** the opening's items carry `open` movements (document) or `add` (running), as new items (S04).
- **Revaluation:** the opening's monetary balances are revalued at the books start's month end (S07); stated lines are not.

### Worked example (`syp-usd`)
Rates: bulletin 115.0000 and market 118.0000 on 2026-09-30, the eve of a books start on 2026-10-01.

The records: SYP cash on hand 2,000,000.00 SYP; a USD receivable OLD-1 of 300.00 USD; capital 1,000,000.00 SYP stated at 10,000.00 USD; the year's result before the books start 300,000.00 SYP stated at 2,600.00 USD.

| Line | Account | Currency amount | Book (SYP) | Parallel (USD) | Basis |
|---|---|---|---|---|---|
| 1 | `112001` item OLD-1 | Dr 300.00 USD | Dr 34,500.00 | Dr 300.00 | monetary, bulletin 115 of 30 Sep |
| 2 | `111001` | Dr 2,000,000.00 SYP | Dr 2,000,000.00 | Dr 16,949.15 | monetary, market 118 (16,949.152… rounded) |
| 3 | `311001` (stated) | Cr 1,000,000.00 SYP | Cr 1,000,000.00 | Cr 10,000.00 | records |
| 4 | `312002` (stated) | Cr 300,000.00 SYP | Cr 300,000.00 | Cr 2,600.00 | records |
| 5 | `312001` (stated, balancing) | Cr 734,500.00 SYP | Cr 734,500.00 | Cr 4,649.15 | 2,034,500.00 − 1,300,000.00; 17,249.15 − 12,600.00 |

Afterwards: OLD-1 received on 2026-10-20 in USD cash `111002` at a bulletin of 118 posts Dr `111002` 35,400.00 / Cr the item 34,500.00 / Cr `421001` realised gain 900.00 in the book ledger (S04 rule 10).

## Currencies, rates and rounding
- **Transaction amounts:** the records', in the account's currency.
- **Book and parallel ledgers:** each ledger's policy rate of the eve for monetary items; stated for the records' non-monetary lines and equity.
- **`third`:** a third-currency balance of the records is measured through S02's cross rates on the eve when monetary.
- **`usd-syp`** (a USD book): the roles swap as in S02; the worked example's logic holds with the book ledger in USD.
- **`syp`** (no parallel ledger): parallel amounts are null; stated lines carry the book amount only.
- **Rounding:** half away from zero per conversion; the balancing line absorbs the remainder per ledger; no rounding line (rule 18).
- **Rate corrections:** a bulletin of the eve corrected after posting lists the opening's conversions (S02 rule 15) like any entry; the opening is not re-measured, and the accountant corrects by a manual entry.

## Periods
- The opening entry creates the books start's period (`open`), the company's first period (S07 rule 2).
- Every month before the books start is closed from the moment it is set (rule 4); no entry posts into it.
- No posting, revaluation or close before the opening is posted (rule 3). The close of the books start's month runs S07's checklist unchanged.
- The whole reversal is possible only before any other entry, so no month has closed by then.

## API
| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/opening` | `opening.read` | — | `openingViewSchema`: state, books start, the accountant's lines, the entry it would post with the balancing figure, the checks, the fingerprint, the posted entry and its reversal | `NO_BOOKS_START` |
| `PUT /api/opening` | `opening.prepare` | `{ version, lines[] }` | the view | `VALIDATION_FAILED`, `OPENING_CHANGED`, `OPENING_POSTED`, `NO_BOOKS_START` |
| `POST /api/opening/post` | `opening.post`, reauthenticated | `{ fingerprint }` | the posted entry's id, fiscal year and number | `OPENING_CHANGED`, `OPENING_CHECKS_FAILED`, `OPENING_POSTED`, `REAUTHENTICATION_REQUIRED` |
| `POST /api/opening/reverse` | `opening.post`, reauthenticated | `{ reason }` | the reversal entry's id and number | `OPENING_NOT_REVERSIBLE`, `VALIDATION_FAILED`, `REAUTHENTICATION_REQUIRED` |
| `GET /api/opening/export?part=preview` | `opening.read` | — | the preview as an Excel workbook | `NO_BOOKS_START` |
| `PUT /api/company/ledgers` | `company.settings`, reauthenticated | S01's body with `booksStart` (date or null) | `companySchema` with `booksStart` and `openingState` | S01's (`COMPANY_SETTINGS_LOCKED` once books started), `BOOKS_START_LOCKED`, `VALIDATION_FAILED` |
| `POST /api/entries/*`, `/api/revaluation/*`, `/api/periods/:p/close` | as S03, S07 | as before | as before | add `OPENING_NOT_POSTED` |

Error codes, in the registry in order with their status (`pnpm check:error-codes`): `OPENING_NOT_POSTED` 503, `OPENING_POSTED` 409, `OPENING_CHANGED` 409, `OPENING_CHECKS_FAILED` 409, `OPENING_NOT_REVERSIBLE` 409, `NO_BOOKS_START` 409, `BOOKS_START_LOCKED` 409.

## Jobs and events
- No job.

## Screens
| Route | Purpose and content | Actions | Drill-down | Export | States | Roles |
|---|---|---|---|---|---|---|
| `/opening` | The opening of the company, in two steps on one page: **1. Records** (the accountant's lines in a ledger-entry grid: account, dimensions, currency, amount, book and parallel, the computed ones read-only with their rate and date, "منقول" stated ones typed; the year's result before the books start); **2. Review** (the entry's preview, the balancing figure per ledger, the checks with their failing items and links: missing rates to `/rates`, roles to the chart) | Save; post (owner, two-factor dialog); after posting, reverse (owner, reason, two-factor, while allowed) | The posted entry opens `/entries/:id` | Excel of the preview | Loading skeleton; no books start ("حدّد تاريخ بدء الدفاتر في إعدادات الشركة"); checks failing (the post button disabled with the reasons); `OPENING_CHANGED` read again with a notice; posted (read-only, the entry); reversed (the history and a new draft) | Owner and accountant edit; auditor reads; owner posts and reverses |
| `/settings/company` | Gains "تاريخ بدء الدفاتر", the first day of a month, with the lock of rule 2 explained | Set (owner, two-factor) | — | — | Locked state names why | Owner sets; others read |
| `/entries/:id` | The opening entry shows "قيد افتتاحي", its source and the opening's link | — | — | as S03 | — | as S03 |
| Sidebar and palette | "الأرصدة الافتتاحية" under settings while the opening is not posted; afterwards in the palette only | — | — | — | — | `opening.read` |

The grid uses `packages/ui`'s components (`DataTable`, `Amount`, the entry grid of S03); amounts only through `Amount`. A component the step needs and the design system lacks is built in `packages/ui` first (ADR 0010 §7).

## Reports
- Rules 31–33 change S09's year's result, its opening column at the books start and the before-the-books-start mark.
- The integrity check (S03) holds: the opening's items' movements equal its control lines.

## Printing and legal books
- The journal book (S09) prints the opening entry as entry 1 of the books start's fiscal year, with its lines in rule 23's order, its Arabic description, and SYP labelled "الليرة السورية الجديدة". Nothing else is printed.

## Volume and performance
- Largest company served: 1,000 opening lines (`OPENING_LINE_LIMIT`).
- `GET /api/opening` computes the preview from the lines and the rates in under 2 s; the post in under 10 s.

## Migration and compatibility
- **Existing companies** without a books start: rule 3 does not apply to them; nothing changes for them.
- ADR 0021 dropped Hub's snapshot table, the records' figures and the opening's schedules (migrations `0058`–`0061`).

## Arabic strings and number formats
- `ar.opening`: the page and its steps ("الأرصدة الافتتاحية"، "أرصدة السجلات"، "المراجعة والترحيل"), the line sources ("من السجلات"، "محسوب"، "منقول"), the checks, the states, the dialogs, the errors.
- `ar.settings.booksStart` ("تاريخ بدء الدفاتر"), `ar.reports` marks of rules 32–33.
- Glossary terms: books start, opening entry, balancing figure, stated amount, result of the year before the books start.
- Latin digits; dates `YYYY-MM-DD`; amounts through `Amount`.

## Audit
- `company.books_start_set` with before and after.
- `opening.saved` per save with the count of lines and the version.
- `opening.posted` with the entry, fingerprint and totals per ledger; `opening.reversed` with the reason and the reversal entry.
- Reads of `/opening` are not audited (S01 audits only its listed reads).

## Abuse and failure cases
- **Replays:** the opening's posting request `opening:<id>` (invariant 5) and the state guard: a second post answers `OPENING_POSTED`.
- **Double submits:** the fingerprint and the draft version (`OPENING_CHANGED`).
- **Races with a close:** no close before the opening (rule 3).
- **Cross-company access:** every table under RLS; the company from the session (ADR 0003).
- **A wrong opening found later:** the whole reversal before any other entry; manual corrections after.

## Edge cases
1.–13. Withdrawn (ADR 0021).
14. Withdrawn (ADR 0021).
15. Withdrawn (ADR 0021).
16. A blocked or archived account on a role: check `mappings` fails.
17. A missing rate on the eve: check `rates` names it; the accountant records it in `/rates` (S02).
18. The eve is a day without a bulletin: S02 rule 16's rate in force on that date (the last publication), as for any date.
19. A zero balancing figure in one ledger only: the line posts with zero in that ledger.
20. The year's result before the books start is a loss: a debit on `312002`.
21. A `syp` company: the lines (its receivables as items on `112001` with their references and due dates, monetary, rule 12) and the balancing figure only.
22. A `usd-syp` company: monetary SYP items measured at the bulletin into the USD book, the market rate in the SYP parallel ledger.
23. A `third` balance (TRY cash) in the records: measured through the cross on the eve.
24. The opening reversed and posted again: entries 1 (opening), 2 (its reversal), 3 (the new opening) in the journal book; items of the first are closed and new ones opened.
25. A reversal requested after another entry posted: refused `OPENING_NOT_REVERSIBLE`.
26. Two owners post at once: one posts; the other gets `OPENING_POSTED`.
27. Withdrawn (ADR 0021).
28. A books start change after an opening draft: refused `BOOKS_START_LOCKED`.
29. Withdrawn (ADR 0021).

## Scenarios
- **`docs/scenarios/opening/opening-entry.md`:** the opening's cases in `syp-usd`, `syp`, `usd-syp` and `third`, the balancing figure per ledger, the revaluation of the opening items, a payment on an opening item, the whole reversal and the new opening. Its move to the contracting template is N5's (ADR 0021).
- **`docs/scenarios/reports/opening-presentation.md`:** the year's result with `312002` in the books start's year and in the next, the trial balance's opening column at the books start, a report from before the books start (rules 31–33), and `312002` stated in the parallel ledger.

Each is written and approved through `/posting-rule` before its code.

## Open questions
None.

## Acceptance
- **The owner's end-to-end check, step by step** (a test company with the general chart, `syp-usd`, books start 2026-10-01):
  1. Try a manual entry: refused `OPENING_NOT_POSTED`.
  2. Open `/opening`: the review fails `rates`.
  3. Record the bulletin and the market rate of 2026-09-30; type the cash, the receivable OLD-1, capital and the year's result before the books start.
  4. The review shows the worked example's five lines and passes every check; post with the two-factor code: entry 1 of 2026 dated 2026-10-01.
  5. Post the receipt of OLD-1: it clears the item with a 900.00 SYP gain.
  6. Read the trial balance for October: the opening column holds the opening entry; the balance sheet's year's result includes 300,000.00 SYP before the books start.
  7. Try to reverse the opening: refused `OPENING_NOT_REVERSIBLE`.
- **Tests:**
  - API: each endpoint's success, `401`, `403` (a person without `opening.post`, without a fresh code), another company's user seeing nothing; `OPENING_NOT_POSTED` on `/api` before posting;
  - unit and property tests: the entry balances in both ledgers for any lines; the balancing figure is the only remainder; the opening plus its reversal nets to zero on every account and item;
  - the scenario book's `opening` cases and the presentation case;
  - invariant tests: the tables' kinds, RLS and composite keys; `stated` refused outside an opening entry; the opening's state guard; `books_start`'s lock;
  - E2E with RTL screenshots: `/opening` through its steps, the failing checks, the post dialog, the posted and reversed states, at 360, 768 and 1280 px in light and dark; the books start in `/settings/company`.
