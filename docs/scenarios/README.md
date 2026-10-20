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
- `manual`.

## File format

1. **Title and status:** `Status: Proposed | Approved (owner, YYYY-MM-DD)`.
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
  closed_periods: []                # e.g. [2026-10]
rates:                              # company rate table rows; source: manual unless stated (hub, import)
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:                              # in order; each is a Hub event, a manual entry, or a job
  - event: <type>                   # Hub event (ADR 0006, 0008), payload as Hub sends it
    accounting_date: 2026-11-03
    payload: { ... }
  - manual: <what it records>       # a manual entry; payload as the manual-entry form sends it (S03)
    accounting_date: 2026-11-03
    payload: { ... }
  - job: month_end_revaluation      # or month_end_release, close_period, ...
    period: 2026-11
expect:
  entries:                          # the exact set posted, in posting order; every line of every entry
    - source: <event type | job | manual>
      date: 2026-11-03
      lines:                        # minor units; positive debit, negative credit
        - { account: "1210", dims: { client: C1 }, currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
  balances:                         # optional: account balances, as the reports read them
    - { account: "1210", book: 0, parallel: 0 }
  open_items:                       # optional: what remains of each document on its control account
    - { item: INV-2026-1, account: "1210", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
  outcome:                          # optional: the last step's hold or refusal (held | refused)
    status: held
    reason: PERIOD_CLOSED
```

Writing the YAML:
- **Amounts** are whole minor units; a decimal amount is refused, never rounded. **Account codes and rates are quoted** (`"1210"`, `"120.0000"`), dates are `YYYY-MM-DD` and periods `YYYY-MM`.
- A scenario file has no fence but its cases: each opens with exactly `` ```yaml `` and closes with `` ``` ``, both at the start of a line. Any other fence (no language, `yml`, indented, in a list or a quote, tildes, unclosed) is an error, so no case is hidden. A payload holds no decimal number.
- On a line or an open item, no `dims` means no dimensions. On a balance, `dims` filters: the balance over every dimension set holding the stated pairs, so no `dims` is the whole account; with a `currency`, only that currency's lines, and its `amount` may be stated.
- `parallel` is stated on every line, balance and open item exactly when the company keeps a parallel ledger. In a ledger's own currency, that ledger's amount is the transaction amount (ADR 0007): a SYP line in SYP books has `book` equal to `amount`.
- Each expected entry balances in both ledgers, and has at least two lines; a `third` case names a line or a rate in a third currency.
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
  - the outcomes: every step completes, except the last when the case states an `outcome`, which it must match exactly.
- It runs on a fresh test database through the real posting function, never through a mock. Each case has a company of its own.

## Examples

These two cases show the format only; they are not approved rules. The account codes are placeholders until the service-agency chart-of-accounts template is approved.

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
        - { account: "1210", dims: { client: C1 }, currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
        - { account: "4110", dims: { client: C1, service: S1 }, currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
    - source: payment.recorded
      date: 2026-11-20
      lines:
        # book: 100.00 USD × 123 = 12,300.00 SYP received
        - { account: "1121", currency: USD, amount: 10000, book: 1230000, parallel: 10000 }
        # the receivable is cleared at its carrying amounts: 12,000.00 SYP, 100.00 USD
        - { account: "1210", dims: { client: C1 }, currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
        # realised exchange gain 300.00 SYP in the book ledger only (IAS 21.28); nothing in the parallel ledger
        - { account: "5910", currency: SYP, amount: -30000, book: -30000, parallel: 0 }
  balances:
    - { account: "1210", book: 0, parallel: 0 }
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
        - { account: "1210", dims: { client: C1 }, currency: SYP, amount: 1220000, book: 1220000, parallel: 10000 }
        - { account: "4110", dims: { client: C1, service: S1 }, currency: SYP, amount: -1220000, book: -1220000, parallel: -10000 }
    - source: payment.recorded
      date: 2026-11-20
      lines:
        # parallel: 12,200.00 SYP / 125 = 97.60 USD received
        - { account: "1111", currency: SYP, amount: 1220000, book: 1220000, parallel: 9760 }
        - { account: "1210", dims: { client: C1 }, currency: SYP, amount: -1220000, book: -1220000, parallel: -10000 }
        # realised exchange loss 2.40 USD in the parallel ledger only; nothing in the SYP books
        - { account: "5910", currency: USD, amount: 240, book: 0, parallel: 240 }
  balances:
    - { account: "1210", book: 0, parallel: 0 }
```

Each entry balances in both ledgers:
- **First example:** book 1,230,000 − 1,200,000 − 30,000 = 0; parallel 10,000 − 10,000 + 0 = 0.
- **Second example:** book 1,220,000 − 1,220,000 + 0 = 0; parallel 9,760 − 10,000 + 240 = 0.
