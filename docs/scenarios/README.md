# Scenario book

One Markdown file per accounting rule: posting rules for events, revenue recognition, revaluation, settlement, rounding, allocation, period close. **The documented example is the test.** A runner reads every file and executes it against the real posting function and a fresh test database (ADR 0005). When the rule changes, the scenario changes in the same PR; changing an expected value needs the owner's approval.

Scenarios are written through `/posting-rule`, before the rule's code.

## Layout

`docs/scenarios/<area>/<rule>.md`. The areas are:
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

## YAML schema

```yaml
case: <short name>
company:
  functional: USD
  second: SYP
  template: service-agency          # chart-of-accounts template
  closed_periods: []                # e.g. [2026-10]
rates:                              # company rate table rows used by manual entries and revaluation
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "126.0000", type: market }
steps:                              # in order; each is a Hub event, a manual entry, or a job
  - event: <type>                   # Hub event (ADR 0006), payload as Hub sends it
    accounting_date: 2026-11-03
    payload: { ... }
  - job: month_end_revaluation      # or month_end_release, close_period, ...
    period: 2026-11
expect:
  entries:                          # in posting order; every line of every entry
    - source: <event type | job | manual>
      date: 2026-11-03
      lines:                        # amounts in minor units; positive debit, negative credit
        - { account: "1210", dims: { client: C1 }, currency: SYP, amount: 1220000, functional: 10000, second: 1220000 }
  balances:                         # optional: account balances or report figures after all steps
    - { account: "1210", functional: 0, second: 0 }
  outcome:                          # optional: for refusals and holds
    status: held
    reason: PERIOD_CLOSED
```

## Example (illustrative format only, not an approved rule)

*An SYP invoice for a completed milestone, paid in SYP at a different rate, in a company whose functional currency is USD.*

```yaml
case: SYP milestone invoice paid at a higher SYP/USD rate
company: { functional: USD, second: SYP, template: service-agency }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: SYP, syp_per_usd: "122.0000",
               lines: [{ amount: 1220000, source: milestone, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-20
    payload: { invoice: INV-2026-1, currency: SYP, amount: 1220000, syp_per_usd: "125.0000" }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # 12,200.00 SYP / 122 = 100.00 USD
        - { account: "1210", dims: { client: C1 }, currency: SYP, amount: 1220000, functional: 10000, second: 1220000 }
        - { account: "4110", dims: { client: C1, service: S1 }, currency: SYP, amount: -1220000, functional: -10000, second: -1220000 }
    - source: payment.recorded
      date: 2026-11-20
      lines:
        # 12,200.00 SYP / 125 = 97.60 USD received
        - { account: "1112", currency: SYP, amount: 1220000, functional: 9760, second: 1220000 }
        # the receivable is cleared at its carrying amount, 100.00 USD
        - { account: "1210", dims: { client: C1 }, currency: SYP, amount: -1220000, functional: -10000, second: -1220000 }
        # realised exchange loss 2.40 USD (IAS 21.28); no SYP effect, the SYP view is historical
        - { account: "5910", currency: USD, amount: 240, functional: 240, second: 0 }
  balances:
    - { account: "1210", functional: 0, second: 0 }
```

The account codes above are placeholders until the service-agency chart-of-accounts template is approved.
