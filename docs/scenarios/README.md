# Scenario book

One Markdown file per accounting rule: manual entries and their reversals, settlement, revaluation, rounding, allocation, period close, the opening and the reports. **The documented example is the test.** A runner reads every file and executes it against the real posting function and a fresh test database (ADR 0005, ADR 0008). When the rule changes, the scenario changes in the same PR. Changing an expected value needs the owner's approval.

Scenarios are written through `/posting-rule`, before the rule's code.

## Layout

`docs/scenarios/<area>/<rule>.md`, the rule in kebab-case; the runner refuses a file anywhere else. The areas are:
- `receivables`;
- `currency`;
- `periods`;
- `opening`;
- `manual`;
- `reports` (S09: what the reports present, read after the steps).

Hub's areas (`revenue`, `ad-funds`, `expenses`, `inbox`, `receivables/hub-payment.md`, `opening/before-books-start.md`) and the cases of other files that ran Hub's events left with the integration (ADR 0021); they stay in git history. Most cases keep `template: service-agency`: the book holds that chart as its own (`packages/scenarios/src/agency-chart.ts`), frozen, since their approved entries name its accounts; the product no longer offers it.

## File format

1. **Title and status:** `Status: Proposed | Approved (owner, YYYY-MM-DD)`. A case runs once it is `Approved`, so it becomes `Approved` only when the executors its steps need exist (the runner fails an `Approved` case it cannot run). Until then a case whose numbers the owner has approved stays `Proposed`, and its PR and `docs/ROADMAP.md` record the approval and its date. The PR that brings its executors switches it to `Approved (owner, <that date>)`, and the book must then count it as run.
2. **Rule:** one or two sentences.
3. **Basis:**
   - the standard paragraph (for example IAS 21.28);
   - the company policy (`phase-1-scope.md` §4 or §6);
   - any Syrian rule with its label (CONFIRMED, REPORTED, UNVERIFIED).
4. **Cases:** one YAML block per case, with the arithmetic for non-obvious amounts as YAML comments.

## Currency shapes

Every rule is tested in each shape it can occur in (ADR 0007, ADR 0008):

| Shape | Book | Parallel | Who |
|---|---|---|---|
| `syp` | SYP | — | The default company |
| `syp-usd` | SYP | USD | Vertex Media |
| `usd-syp` | USD | SYP | A company whose statutory books are in USD, if the law allows it |
| `third` | SYP | USD | A transaction in a third currency (TRY or EUR) |

## YAML schema

```yaml
case: <short name>
company:
  shape: syp-usd                    # see "Currency shapes"
  book: SYP
  parallel: USD                     # omit for no parallel ledger
  rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true }
                                    # book_accepts_transaction_rate: false unless stated; only market accepts
  template: service-agency          # chart-of-accounts template (optional)
  accounts:                         # postable accounts added to the template (optional)
    - { code: "111007", name: "الصندوق — ليرة تركية", name_latin: "Cash on hand — TRY",
        currency: TRY, monetary: true, statement_line: bs.cash }
  closed_periods: []                # e.g. [2026-10]
  contracts:                        # contract values the case's manual lines name (optional; S09):
    - { code: P1, kind: project, client: C1 }  # a contract needs its kind and client
  bulletin_days_off: [5, 6]         # ISO weekdays without a bulletin; default Friday and Saturday
  bulletin_holidays: []             # e.g. [2026-11-08]: dates the accountant marked (S02 rules 16–17)
  books_start: 2026-10-01           # optional (S10 rule 1), the first day of a month, only in a case
                                    #   with an `opening` step: the months before it are closed, and
                                    #   nothing posts until the opening posts (OPENING_NOT_POSTED, rule 3)
rates:                              # company rate table rows, recorded by hand (source: manual)
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:                              # in order; a manual entry, a reversal, a rate, a revaluation …
  - manual: <what it records>       # a manual entry; payload as the manual-entry form sends it (S03):
    accounting_date: 2026-11-03     # { description?, reference?, dealt_rates?, lines: [{ account,
    payload: { ... }                #   dims?, currency, amount, memo?, open_item?, item? }] };
    outcome: { status: refused, reason: PERIOD_CLOSED }
                                    # optional on any step: its answer when received (refused, a
                                    #   reason and an optional detail)
                                    #   dealt_rates: [{ base, quote, rate }], one per currency pair
                                    #   (S03 rule 13); open_item and item: "Writing the YAML"
  - reversal: 1                     # reverses the case's entry 1 (posting order) at its amounts
    accounting_date: 2026-11-04
  - revalue: book                   # the accountant's month-end revaluation of one ledger (book or
    period: 2026-11                 #   parallel, S07 rules 10–18), posted from its preview once
                                    #   the month has ended: the clock moves to the first day of
                                    #   m+1; its entry has the source revaluation and
                                    #   m's last day, its reversal (same transaction) the source
                                    #   reversal and m+1's first day; all differences zero: no entry
  - block: "111006"                 # block an account with a reason (S02 rule 5): later lines on
    reason: "..."                   #   it are refused; a revaluation still remeasures it (S07)
  - close: 2026-11                  # close a month with a reason on the case's clock (S07 rules 2,
    reason: "..."                   #   5, 7–9); refused with the first failing rule, a failed
                                    #   checklist as CHECKLIST_FAILED with the failing items as its
                                    #   detail, comma-separated in the checklist's order
  - reopen: 2026-11                 # reopen the latest closed month with a reason (S07 rules 3, 6):
    reason: "..."                   #   it posts as open
  - draft: <what it records>        # a manual entry saved as a draft, not posted (S03 rule 4);
    accounting_date: 2026-11-25     #   payload as for manual; S07's no_drafts reads it
    payload: { ... }
  - discard: 4                      # discard the draft of step 4 with a reason (S03 rule 11)
    reason: "..."
  - rate: { date: 2026-11-03, base: USD, quote: SYP, rate: "121.0000", type: bulletin,
            reason: "Mistyped" }    # a row recorded now; a second row of a pair, type and date
                                    # is a correction and needs its reason (S02 rule 15)
  - service_department: { service: S3, department: design, effective_from: 2026-12-01 }
    reason: "..."                   # the accountant's dated department of a manual service (S09
                                    #   rule 34); refused PERIOD_CLOSED in a closed month
  - opening: <what it records>      # the opening saved and posted by the owner from its preview
                                    #   (S10 rules 14–23), dated on the books start
    records:
      lines:                        # the accountant's lines: account, dims?, currency, amount (debit
        - { account: "311001", currency: SYP, amount: -100000000, parallel: -1000000 }
                                    #   positive), open_item? and memo? as a manual line; a stated
                                    #   line (non-monetary or equity) also gives book and parallel,
                                    #   except the one in its ledger's own currency (S10 rule 17)
  - reverse_opening: "<reason>"     # the owner's whole reversal of the opening (S10 rule 25)
expect:
  entries:                          # the exact set posted, in posting order; every line of every entry
    - source: <manual | opening | revaluation | reversal>
      date: 2026-11-03
      lines:                        # minor units; positive debit, negative credit
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
  balances:                         # optional: account balances, as the reports read them
    - { account: "112001", book: 0, parallel: 0 }
  open_items:                       # optional: what remains of each document on its control account
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
  corrections:                      # optional: per correction step, the entries its answer lists
    - { step: 5, used_by: [1] }     # as converted at the superseded row (posting order)
  outcome:                          # optional: the last step's refusal, when the step does not
    status: refused                 #   state it itself
    reason: CHECKLIST_FAILED
    detail: "no_drafts"             # optional: the refusal's detail; unstated, not compared;
                                    #   a code with an optional value ("period:2026-10", the month a
                                    #   PERIOD_ORDER names), or several codes comma-separated and quoted
                                    #   (a failed checklist's items in its order)
  reports:                          # optional (S09): report figures read after the steps; see "Reports"
    - report: balance_sheet         # an id of S09 rule 37 (REPORTS)
      params: { as_of: 2026-12-31, ledger: book }
      marks: [period_open]          # S09 rule 4, the exact set: period_open, before_revaluation
      lines:
        - { line: bs.contract_liabilities, amount: 70000000,
            parts: [{ account: "212001", dims: { client: C1, contract: P1 }, amount: 120000000 },
                    { account: "113001", dims: { client: C1, contract: P1 }, amount: -50000000 }] }
      year_result: 140000000
      totals: { assets: 227000000, liabilities: 87000000, equity: 140000000, liabilities_and_equity: 227000000 }
```

Writing the YAML:
- **Amounts** are whole minor units; a decimal amount is refused, never rounded. **Account codes and rates are quoted** (`"112001"`, `"120.0000"`), dates are `YYYY-MM-DD` and periods `YYYY-MM`.
- A scenario file has no fence but its cases: each opens with exactly `` ```yaml `` and closes with `` ``` ``, both at the start of a line. Any other fence (no language, `yml`, indented, in a list or a quote, tildes, unclosed) is an error, so no case is hidden. A payload holds no decimal number.
- An added account (`accounts`) is a postable code under a header of the case's template, not already in it, with a statement line of its class; `currency` restricts it, `monetary` marks it monetary (S02). It needs a `template`.
- On a line or an open item, no `dims` means no dimensions. On a balance, `dims` filters: the balance over every dimension set holding the stated pairs, so no `dims` is the whole account; with a `currency`, only that currency's lines, and its `amount` may be stated.
- **Items** (S04): a manual line on a `document` control account opens an item with `open_item: { ref: M-1, due: 2026-12-03 }` (`due` optional) or moves one with `item: M-1` (its reference). It then takes the item's dimensions, so it states no `dims`. A line on a `running` account names the client in `dims` and neither field. An expected line on an item carries the item's dimensions, and a running item is named in `open_items` by the client's code.
- `parallel` is stated on every line, balance and open item exactly when the company keeps a parallel ledger. In a ledger's own currency, that ledger's amount is the transaction amount (ADR 0007): a SYP line in SYP books has `book` equal to `amount`.
- Each expected entry balances in both ledgers, and has at least two lines; a `third` case names a line or a rate in a third currency.
- An **`opening`** step (S10) needs a company with a `books_start`; it saves the draft with the step's lines, reads its preview and posts it with the preview's fingerprint, the case's clock on the books start or its latest date if later. A refused post states its `outcome` (`OPENING_CHECKS_FAILED`, the failing checks as its detail, comma-separated in S10 rule 21's order) and leaves the draft saved, so a later `opening` step replaces its lines. Its entry has the source `opening`. A `reverse_opening` posts the reversal, read as `reversal` on the books start, or states its refusal (`OPENING_NOT_REVERSIBLE`).
- A `discard` names an earlier `draft` step. A `close` refused `PERIOD_ORDER` names the earliest open month as its detail (`period:2026-10`), a `reopen` refused `PERIOD_ORDER` the latest closed month.
- A `revalue: parallel` step needs a company with a parallel ledger. A `revalue` step for a month already revalued posts the adjusting revaluation: only the differences still to post, with its own reversal (S07 rule 15). A `revalue` step that finds every difference zero is done and posts nothing; a missing closing rate is its `refused` outcome `RATE_MISSING`.
- An unknown or misspelt key is an error.

## Reports

A case's `reports` are read after its steps, through the reports' readers in the case's company, with the case's clock as the time of reading (S09). Each names its `report` (S09 rule 37) and its `params`, the report's query in snake case (`from`, `to`, `as_of`, `ledger`, `level`, `non_zero`, `by`, `account`, `fiscal_year`, `official`; months as `YYYY-MM` for the journal book). A comparative is read only when `params` names it (`compare_from` and `compare_to`, or `compare_as_of`), and its figures are then stated with a `compare` prefix (`compare`, `compare_marks`, `compare_subtotals`, `compare_totals`, `compare_year_result`). Amounts are minor units of the report's ledger currency. What each report states:
- **`trial_balance`:** `rows`, the exact set with `non_zero` on, each `{ account, opening, debits, credits, closing }` with the opening and closing balances signed (positive debit, negative credit) and the period's debits and credits as magnitudes; `totals` `{ opening_debit, opening_credit, debits, credits, closing_debit, closing_credit }`, each pair equal.
- **`account_statement`:** `opening`, `lines` `{ entry, date, amount, balance, currency, transaction_amount, transaction_balance }` in report order (`entry` is the case's entry in posting order, `balance` and `transaction_balance` running), `closing`, and `currencies` `{ currency, opening, closing }` in transaction amounts.
- **`income_statement`:** `lines` `{ line, amount }`, income positive and expenses negative; a line not listed is zero or hidden. `subtotals` `{ operating_profit, profit_before_financing_and_income_taxes, profit_before_tax, profit }`: a subtotal not listed is not shown.
- **`balance_sheet`:** `lines` `{ line, amount, parts, unclosed_years? }`, each amount as presented (positive on its own side); `parts` are the balances the line is made of, per account and, where rules 17 and 18 read them, per contract or client, signed as they add to the line, with `reclassified: true` on a balance rule 18 moved there; `unclosed_years` is the result of earlier unclosed fiscal years in `bs.retained_earnings` (rule 16). A line not listed is zero or hidden. `year_result` and `totals` `{ assets, liabilities, equity, liabilities_and_equity }`, equity including the year's result. In a company with a books start, `year_result_pre_opening` (and `compare_year_result_pre_opening`) is the balance of the `pre_opening_result` account (`312002`) that the year's result includes, with the note "تشمل نتيجة ما قبل بدء الدفاتر" when it is not zero, and zero at a date of a later fiscal year, where that account is a part of `bs.retained_earnings` and `unclosed_years` stays the net of classes 4–5 (S10 rule 31; owner, 2026-11-12).
- **`profitability`:** `rows` `{ value, revenue, direct_costs, contribution, margin }`, the exact set, `value` a dimension value's code or `unassigned` ("غير موزع"), revenue and direct costs signed and net of reversals (revenue positive as income, direct costs positive as a cost, either negative in a month a void reverses more than it adds), `margin` a string with one decimal or `null` ("—"); `totals` the same without `value`.
- **`journal_book`:** `pages` `{ page, entries, debits, credits, brought_forward: { debits, credits }, cumulative: { debits, credits } }`, the exact set, `entries` the case's entries on the page in `(entry_date, number)` order (ADR 0008), so a back-dated entry appears at its date; an entry split across pages is the last of one page and the first of the next.

Every report states its `marks`, the exact set (and `compare_marks` with a comparative): S09 rule 4's `period_open` ("غير نهائية: الفترة مفتوحة") and `before_revaluation` ("قبل إعادة التقييم"), and, only in a company with a books start (S10 rules 32, 33; owner, 2026-11-12), `opening_entry` ("الرصيد الافتتاحي من قيد الافتتاح") on a trial balance, general ledger or account statement whose range starts on or before the books start, `before_books_start` ("تبدأ الدفاتر في <date>") on a report whose range starts before it, read from the books start, and `pre_opening_result_in_equity` ("نتيجة ما قبل بدء الدفاتر ضمن حقوق الملكية") on every income statement of the books start's fiscal year.

The runner compares every stated figure exactly; a report or field the case does not state is not compared.

## The runner's contract

The runner is `packages/scenarios` (`pnpm test:scenarios`, in CI).

- A `Proposed` scenario is skipped and reported; only `Approved` scenarios count. Every file is still read: one that breaks this format fails the run, whatever its status.
- An `Approved` case whose step has no executor yet fails; it is never skipped.
- The runner checks:
  - the **exact set** of entries and lines posted, with no missing and no extra lines: entries in posting order with their source and date, the lines of each in any order;
  - every amount in both ledgers;
  - one audit row per posting;
  - the stated account and open-item balances: an open item by its document and account, with its dimensions, currency and remaining amounts;
  - the outcomes: every step completes when received, except a step that states its `outcome` and the last when `expect` states one; such a step must match its status and reason exactly, and its detail when stated;
  - each stated correction's answer: exactly the entries it lists as converted at the superseded row.
  - each stated report's figures (S09; "Reports").
- It runs on a fresh test database through the real posting function, never through a mock. Each case has a company of its own, made with the company, chart, dimension and rate services the API uses: every dimension value the case names (`client: C1` in a manual line, an expected line, a balance or an open item) is made in the setup, by its type's code and its own code (S04).

## Examples

These two cases show the format only; they are not approved rules. Their account codes are the general template's: trade receivables `112001`, revenue `411001`, the USD and SYP bank accounts `111004` and `111003`, realised exchange gains `421001` and losses `541001`.

### A USD invoice received in USD, in the SYP books at the bulletin

```yaml
case: a USD invoice by hand received in USD; bulletin moves from 120 to 123
company: { shape: syp-usd, book: SYP, parallel: USD, template: general,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-20, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - manual: the invoice
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 10000,
                         open_item: { ref: INV-2026-1 } },
                       { account: "411001", dims: { client: C1 }, currency: USD, amount: -10000 }] }
  - manual: the receipt
    accounting_date: 2026-11-20
    payload: { lines: [{ account: "111004", currency: USD, amount: 10000 },
                       { account: "112001", currency: USD, amount: -10000, item: INV-2026-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        # book: 100.00 USD × 120 (bulletin) = 12,000.00 SYP; parallel: USD as is
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
        - { account: "411001", dims: { client: C1 }, currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
    - source: manual
      date: 2026-11-20
      lines:
        # book: 100.00 USD × 123 = 12,300.00 SYP received
        - { account: "111004", currency: USD, amount: 10000, book: 1230000, parallel: 10000 }
        # the receivable is cleared at its carrying amounts: 12,000.00 SYP, 100.00 USD
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
        # realised exchange gain 300.00 SYP in the book ledger only (IAS 21.28); nothing in the parallel ledger
        - { account: "421001", currency: SYP, amount: -30000, book: -30000, parallel: 0 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
```

### An SYP invoice received in SYP, in the USD parallel ledger at the dealt rate

```yaml
case: an SYP invoice by hand received in SYP; the dealt rate moves from 122 to 125
company: { shape: syp-usd, book: SYP, parallel: USD, template: general,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
steps:
  - manual: the invoice
    accounting_date: 2026-11-03
    payload: { dealt_rates: [{ base: USD, quote: SYP, rate: "122.0000" }],
               lines: [{ account: "112001", dims: { client: C1 }, currency: SYP, amount: 1220000,
                         open_item: { ref: INV-2026-2 } },
                       { account: "411001", dims: { client: C1 }, currency: SYP, amount: -1220000 }] }
  - manual: the receipt
    accounting_date: 2026-11-20
    payload: { dealt_rates: [{ base: USD, quote: SYP, rate: "125.0000" }],
               lines: [{ account: "111003", currency: SYP, amount: 1220000 },
                       { account: "112001", currency: SYP, amount: -1220000, item: INV-2026-2 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        # book: SYP as is; parallel: 12,200.00 SYP / 122 (the dealt rate) = 100.00 USD
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 1220000, book: 1220000, parallel: 10000 }
        - { account: "411001", dims: { client: C1 }, currency: SYP, amount: -1220000, book: -1220000, parallel: -10000 }
    - source: manual
      date: 2026-11-20
      lines:
        # parallel: 12,200.00 SYP / 125 = 97.60 USD received
        - { account: "111003", currency: SYP, amount: 1220000, book: 1220000, parallel: 9760 }
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: -1220000, book: -1220000, parallel: -10000 }
        # realised exchange loss 2.40 USD in the parallel ledger only; nothing in the SYP books
        - { account: "541001", currency: USD, amount: 240, book: 0, parallel: 240 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
```

Each entry balances in both ledgers:
- **First example:** book 1,230,000 − 1,200,000 − 30,000 = 0; parallel 10,000 − 10,000 + 0 = 0.
- **Second example:** book 1,220,000 − 1,220,000 + 0 = 0; parallel 9,760 − 10,000 + 240 = 0.
