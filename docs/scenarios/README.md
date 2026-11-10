# Scenario book

One Markdown file per accounting rule: posting rules for events, revenue recognition, revaluation, settlement, rounding, allocation, period close. **The documented example is the test.** A runner reads every file and executes it against the real posting function and a fresh test database (ADR 0005, ADR 0008). When the rule changes, the scenario changes in the same PR. Changing an expected value needs the owner's approval.

Scenarios are written through `/posting-rule`, before the rule's code.

## Layout

`docs/scenarios/<area>/<rule>.md`, the rule in kebab-case; the runner refuses a file anywhere else. The areas are:
- `receivables`;
- `revenue`;
- `ad-funds`;
- `expenses`;
- `currency`;
- `periods`;
- `opening`;
- `manual`;
- `inbox`.

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
  bulletin_days_off: [5, 6]         # ISO weekdays without a bulletin; default Friday and Saturday
  bulletin_holidays: []             # e.g. [2026-11-08]: dates the accountant marked (S02 rules 16–17)
rates:                              # company rate table rows; source: manual unless stated (hub, import)
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:                              # in order; a Hub event, a manual entry, a reversal, a job or a rate
  - event: <type>                   # Hub event (ADR 0006, 0008), payload as Hub sends it
    accounting_date: 2026-11-03
    payload: { ... }
    outcome: { status: held, reason: UNKNOWN_REFERENCE }
                                    # optional on any step: its answer when received (held | refused,
                                    #   a reason and an optional detail); a held step a later step
                                    #   frees posts then, and its entry is expected where it posts
  - manual: <what it records>       # a manual entry; payload as the manual-entry form sends it (S03):
    accounting_date: 2026-11-03     # { description?, reference?, dealt_rates?, lines: [{ account,
    payload: { ... }                #   dims?, currency, amount, memo?, open_item?, item? }] };
                                    #   dealt_rates: [{ base, quote, rate }], one per currency pair
                                    #   (S03 rule 13); open_item and item: "Writing the YAML"
  - reversal: 1                     # reverses the case's entry 1 (posting order) at its amounts
    accounting_date: 2026-11-04
  - job: month_end_revaluation      # or revenue_release_month (S06), close_period, ...
    period: 2026-11                 #   a job for month m runs on the first day of m+1: the case's
                                    #   clock moves to that day, so a later event step is received
                                    #   after the month's job (S06 rule 5)
  - rate: { date: 2026-11-03, base: USD, quote: SYP, rate: "121.0000", type: bulletin,
            reason: "Mistyped" }    # a row recorded now; a second row of a pair, type and date
                                    # is a correction and needs its reason (S02 rule 15)
  - retry: 1                        # the accountant's actions on a held event (S05 rules 15–17),
                                    #   naming an earlier event step by its number: retry it now
  - move: 1                         # post a PERIOD_CLOSED event in the first open period after it
    reason: "..."                   #   (move, resolve and dismiss each keep a written reason)
  - resolve: { step: 2, entry: 3 }  # resolve a NEEDS_DECISION event by the case's entry 3
    reason: "..."                   #   (posting order), a posted manual entry or its reversal
  - dismiss: 2                      # dismiss a held event: it never posts
    reason: "..."
  - recognise: 1                    # recognise a SERVICE_PERIOD_CLOSED event's closed elapsed
    reason: "..."                   #   months in the first open period after them, each at its
                                    #   own month end's rates (S06 rule 16)
expect:
  entries:                          # the exact set posted, in posting order; every line of every entry
    - source: <event type | job | manual>
      date: 2026-11-03
      lines:                        # minor units; positive debit, negative credit
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
  balances:                         # optional: account balances, as the reports read them
    - { account: "112001", book: 0, parallel: 0 }
  open_items:                       # optional: what remains of each document on its control account
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
  corrections:                      # optional: per correction step, the entries its answer lists
    - { step: 5, used_by: [1] }     # as converted at the superseded row (posting order)
  outcome:                          # optional: the last step's hold or refusal (held | refused),
    status: held                    #   when the step does not state it itself
    reason: PERIOD_CLOSED
    detail: payment_gap_beyond_tolerance  # optional: the hold's detail (S05 rule 9); unstated, not compared
```

Writing the YAML:
- **Amounts** are whole minor units; a decimal amount is refused, never rounded. **Account codes and rates are quoted** (`"112001"`, `"120.0000"`), dates are `YYYY-MM-DD` and periods `YYYY-MM`.
- A scenario file has no fence but its cases: each opens with exactly `` ```yaml `` and closes with `` ``` ``, both at the start of a line. Any other fence (no language, `yml`, indented, in a list or a quote, tildes, unclosed) is an error, so no case is hidden. A payload holds no decimal number.
- An added account (`accounts`) is a postable code under a header of the case's template, not already in it, with a statement line of its class; `currency` restricts it, `monetary` marks it monetary (S02). It needs a `template`.
- On a line or an open item, no `dims` means no dimensions. On a balance, `dims` filters: the balance over every dimension set holding the stated pairs, so no `dims` is the whole account; with a `currency`, only that currency's lines, and its `amount` may be stated.
- **Items** (S04): a manual line on a `document` control account opens an item with `open_item: { ref: M-1, due: 2026-12-03 }` (`due` optional) or moves one with `item: M-1` (a manual reference or a Hub document number). It then takes the item's dimensions, so it states no `dims`. A line on a `running` account names the client in `dims` and neither field. An expected line on an item carries the item's dimensions, and a running item is named in `open_items` by the client's code.
- `parallel` is stated on every line, balance and open item exactly when the company keeps a parallel ledger. In a ledger's own currency, that ledger's amount is the transaction amount (ADR 0007): a SYP line in SYP books has `book` equal to `amount`.
- Each expected entry balances in both ledgers, and has at least two lines; a `third` case names a line or a rate in a third currency.
- **Hub events** (S05): the payload's short form names each dimension by its code and each document by its number; the runner makes it into the full payload Hub sends (`packages/contracts` `eventEnvelopeSchema`): each document and value gets a stable synthetic Hub id, a value keeps the case's code (so the event makes the value, S05 rule 23, and the setup leaves it out), an invoice line's `kind` is its `charge_kind`, and a `payment.voided` finds its receipt and invoice from the payment's `payment.recorded` step. After each event, rate and inbox step the runner runs the retries the step frees, as the worker does after its commit (S05 rule 10), with the case's clock at its latest date.
- An action (`retry`, `move`, `resolve`, `dismiss`, `recognise`) names an earlier `event` step, and `resolve` an expected entry. It may state its `outcome` like any step: a retry that leaves the event held, or an action the inbox refuses (`EVENT_NOT_HELD`, `EVENT_ACTION_NOT_ALLOWED`, `ENTRY_ALREADY_LINKED`). The events an action frees are retried as S05 rule 10 says, and their entries are expected where they post.
- An unknown or misspelt key is an error.

## The runner's contract

The runner is `packages/scenarios` (`pnpm test:scenarios`, in CI).

- A `Proposed` scenario is skipped and reported; only `Approved` scenarios count. Every file is still read: one that breaks this format fails the run, whatever its status.
- An `Approved` case whose step has no executor yet fails; it is never skipped.
- The runner checks:
  - the **exact set** of entries and lines posted, with no missing and no extra lines: entries in posting order with their source and date, the lines of each in any order;
  - every amount in both ledgers;
  - one audit row per posting;
  - the stated account and open-item balances: an open item by its document and account, with its dimensions, currency and remaining amounts;
  - the outcomes: every step completes when received, except a step that states its `outcome` and the last when `expect` states one; such a step must match its status and reason exactly, and its detail when stated. A held step that a later step frees (S05 rules 10, 11) has its entry in the expected entries at the place it posts;
  - each stated correction's answer: exactly the entries it lists as converted at the superseded row.
- It runs on a fresh test database through the real posting function, never through a mock. Each case has a company of its own, made with the company, chart, dimension and rate services the API uses: every dimension value the case names (`client: C1` in a manual line, an expected line, a balance or an open item) is made in the setup, by its type's code and its own code (S04).

## Examples

These two cases show the format only; they are not approved rules. Their account codes are the service-agency template's (`service-agency@1`, a draft until the templates are reviewed, Q3): trade receivables `112001`, service revenue `411001`, the USD and SYP bank accounts `111004` and `111003`, realised exchange gains `421001` and losses `541001`.

### A USD invoice paid in USD, in the SYP books at the bulletin

```yaml
case: USD milestone invoice paid in USD; bulletin moves from 120 to 123
company: { shape: syp-usd, book: SYP, parallel: USD, rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-20, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               lines: [{ amount: 10000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-20
    payload: { invoice: INV-2026-1, currency: USD, amount: 10000, syp_per_usd: "125.0000" }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # book: 100.00 USD × 120 (bulletin) = 12,000.00 SYP; parallel: USD as is (Hub's 122 is not needed)
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
    - source: payment.recorded
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

### An SYP invoice paid in SYP, in the USD parallel ledger at Hub's rate

```yaml
case: SYP milestone invoice paid in SYP; Hub's rate moves from 122 to 125
company: { shape: syp-usd, book: SYP, parallel: USD, rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-2, client: C1, currency: SYP, syp_per_usd: "122.0000",
               lines: [{ amount: 1220000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-20
    payload: { invoice: INV-2026-2, currency: SYP, amount: 1220000, syp_per_usd: "125.0000" }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # book: SYP as is; parallel: 12,200.00 SYP / 122 (Hub's rate) = 100.00 USD
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 1220000, book: 1220000, parallel: 10000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -1220000, book: -1220000, parallel: -10000 }
    - source: payment.recorded
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
