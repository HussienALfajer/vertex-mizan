# The bulletin rate of the day

Status: Proposed

## Rule

A ledger whose policy is the Central Bank bulletin converts a new amount at the bulletin in force on the entry date: the newest bulletin row effective on or before that date, and only if it is effective on or after the latest publication day on or before it. A publication day is any day that is not one of the company's weekly days off (Friday and Saturday by default) and not a holiday the accountant has marked. So a working day needs its own bulletin, a day off or a holiday takes the last published one, and a working day without its bulletin is refused with `RATE_MISSING`, never converted at yesterday's rate. A cross applies the rule to each of its two quotes.

## Basis

- **IAS 21.21–22:** a foreign-currency transaction is recorded at the spot rate at the date of the transaction; a rate that approximates it may be used for practical reasons. On a day the bank publishes no bulletin, the last published bulletin is that rate.
- **Company policy:** `phase-1-scope.md` §4, the book ledger at the Central Bank bulletin rate of the accounting date (ADR 0007). The lookup is ADR 0011 "The bulletin rate of the day" and S02 rules 16–17 (owner, 2026-10-27).
- **Syrian rules:**
  - that the tax authority requires the bulletin for the statutory books: UNVERIFIED (open question Q1), adopted by the owner as the company's policy;
  - Friday and Saturday as the bank's days without a bulletin: UNVERIFIED, so they are a company setting (`bulletin_days_off`), not a rule in code.
- A third currency's bulletin may be published weekly (open question Q10). Until Q10 is decided, every bulletin pair follows the company's one calendar, and the `third` cases below assume daily quotes.

## Cases

Every company keeps the default days off, Friday and Saturday. The account codes are the service-agency template's (S02). Each entry is a manual entry, both lines in one currency, so both lines convert at the same rate and the entry balances with no rounding line. Calendar for November 2026: Thursday 5, Friday 6, Saturday 7, Sunday 8, Monday 9, Tuesday 10.

The `syp-usd` cases are Vertex Media's shape: the USD amount stays as is in the USD parallel ledger, so only the book amount depends on the bulletin.

### A working day takes its own bulletin

```yaml
case: a working day takes its own bulletin, not an older or a later one
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.2500", type: bulletin }
steps:
  - manual: a software subscription paid from the USD bank account
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531004", currency: USD, amount: 10000 },
                       { account: "111004", currency: USD, amount: -10000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # Sunday is a publication day: P = 2026-11-08, its own row 121.5 is in force
        # book: 100.00 USD × 121.5 = 12,150.00 SYP; the row of the 10th is later and not used
        - { account: "531004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        - { account: "111004", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
```

### Friday and Saturday take Thursday's bulletin

```yaml
case: Friday and Saturday take Thursday's bulletin
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
steps:
  - manual: a software subscription paid on a Friday
    accounting_date: 2026-11-06
    payload: { lines: [{ account: "531004", currency: USD, amount: 10000 },
                       { account: "111004", currency: USD, amount: -10000 }] }
  - manual: bank charges on a Saturday
    accounting_date: 2026-11-07
    payload: { lines: [{ account: "532002", currency: USD, amount: 2550 },
                       { account: "111004", currency: USD, amount: -2550 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-06
      lines:
        # Friday is a day off: P = Thursday 2026-11-05, whose row 120 is in force
        # book: 100.00 USD × 120 = 12,000.00 SYP
        - { account: "531004", currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
        - { account: "111004", currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
    - source: manual
      date: 2026-11-07
      lines:
        # Saturday is a day off: P = Thursday 2026-11-05 again
        # book: 25.50 USD × 120 = 3,060.00 SYP
        - { account: "532002", currency: USD, amount: 2550, book: 306000, parallel: 2550 }
        - { account: "111004", currency: USD, amount: -2550, book: -306000, parallel: -2550 }
  balances:
    - { account: "111004", currency: USD, amount: -12550, book: -1506000, parallel: -12550 }
```

### A holiday takes the last published bulletin

```yaml
case: a holiday on a Sunday takes Thursday's bulletin across the weekend
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           bulletin_holidays: [2026-11-08] }
rates:
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.2500", type: bulletin }
steps:
  - manual: a software subscription paid on a holiday
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531004", currency: USD, amount: 10000 },
                       { account: "111004", currency: USD, amount: -10000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # the 8th is a holiday, the 7th and 6th days off: P = Thursday 2026-11-05, row 120
        # without the holiday this entry would be refused RATE_MISSING (no row of the 8th)
        # book: 100.00 USD × 120 = 12,000.00 SYP
        - { account: "531004", currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
        - { account: "111004", currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
```

### A working day without its bulletin is refused

```yaml
case: a working day without its bulletin is refused, never converted at the day before's
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
steps:
  - manual: a software subscription paid on Sunday
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531004", currency: USD, amount: 10000 },
                       { account: "111004", currency: USD, amount: -10000 }] }
  - manual: the same on Monday, whose bulletin was not recorded
    accounting_date: 2026-11-09
    payload: { lines: [{ account: "531004", currency: USD, amount: 10000 },
                       { account: "111004", currency: USD, amount: -10000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # book: 100.00 USD × 121.5 = 12,150.00 SYP
        - { account: "531004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        - { account: "111004", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
  # Monday is a publication day: P = 2026-11-09; the newest row (the 8th) is before P
  outcome: { status: refused, reason: RATE_MISSING }
```

### Across the year end

```yaml
case: Friday 1 January takes the bulletin of Thursday 31 December
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - manual: a software subscription paid on New Year's Day
    accounting_date: 2027-01-01
    payload: { lines: [{ account: "531004", currency: USD, amount: 7500 },
                       { account: "111004", currency: USD, amount: -7500 }] }
expect:
  entries:
    - source: manual
      date: 2027-01-01
      lines:
        # Friday is a day off: P = Thursday 2026-12-31, the last bulletin of the previous year
        # book: 75.00 USD × 123 = 9,225.00 SYP
        - { account: "531004", currency: USD, amount: 7500, book: 922500, parallel: 7500 }
        - { account: "111004", currency: USD, amount: -7500, book: -922500, parallel: -7500 }
```

### USD books: a day off and a working day

A company whose book currency is USD converts an SYP amount into its USD book at the bulletin, dividing by the rate quoted in SYP per USD; its SYP parallel ledger keeps the SYP amount as is.

```yaml
case: USD books; Saturday takes Thursday's bulletin, Sunday its own
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market } }
rates:
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
steps:
  - manual: rent paid in SYP on a Saturday
    accounting_date: 2026-11-07
    payload: { lines: [{ account: "531001", currency: SYP, amount: 1000000 },
                       { account: "111003", currency: SYP, amount: -1000000 }] }
  - manual: rent paid in SYP on Sunday
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531001", currency: SYP, amount: 1000000 },
                       { account: "111003", currency: SYP, amount: -1000000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-07
      lines:
        # P = Thursday 2026-11-05: 10,000.00 SYP / 120 = 83.3333… → 83.33 USD
        - { account: "531001", currency: SYP, amount: 1000000, book: 8333, parallel: 1000000 }
        - { account: "111003", currency: SYP, amount: -1000000, book: -8333, parallel: -1000000 }
    - source: manual
      date: 2026-11-08
      lines:
        # P = Sunday 2026-11-08: 10,000.00 SYP / 121.5 = 82.3045… → 82.30 USD
        - { account: "531001", currency: SYP, amount: 1000000, book: 8230, parallel: 1000000 }
        - { account: "111003", currency: SYP, amount: -1000000, book: -8230, parallel: -1000000 }
  balances:
    - { account: "531001", book: 16563, parallel: 2000000 }
```

```yaml
case: USD books; a working day without its bulletin is refused
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market } }
rates:
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - manual: rent paid in SYP on a Saturday
    accounting_date: 2026-11-07
    payload: { lines: [{ account: "531001", currency: SYP, amount: 1000000 },
                       { account: "111003", currency: SYP, amount: -1000000 }] }
  - manual: rent paid in SYP on Sunday, whose bulletin was not recorded
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531001", currency: SYP, amount: 1000000 },
                       { account: "111003", currency: SYP, amount: -1000000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-07
      lines:
        # 10,000.00 SYP / 120 = 83.3333… → 83.33 USD
        - { account: "531001", currency: SYP, amount: 1000000, book: 8333, parallel: 1000000 }
        - { account: "111003", currency: SYP, amount: -1000000, book: -8333, parallel: -1000000 }
  # Sunday: P = 2026-11-08; the newest row (the 5th) is before P
  outcome: { status: refused, reason: RATE_MISSING }
```

### A third currency through a cross

A TRY amount in the SYP books converts at the direct TRY–SYP bulletin, or at a cross through USD (TRY→USD, then USD→SYP), whichever is in force and more recent (ADR 0007). Each quote of the cross must itself be in force under the rule. All rates are synthetic.

```yaml
case: a TRY expense converts through a cross whose two quotes are of the day
company: { shape: third, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-05, base: TRY, quote: SYP, rate: "2.9000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.2000", type: market }
steps:
  - manual: a repair invoiced in TRY on Tuesday, not yet paid
    accounting_date: 2026-11-10
    payload: { lines: [{ account: "531006", currency: TRY, amount: 410000 },
                       { account: "211003", currency: TRY, amount: -410000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-10
      lines:
        # book: the direct TRY–SYP row of the 5th is before P = 2026-11-10, so not in force;
        #   the cross's two quotes are of the 10th: 4,100.00 TRY / 41 × 122 = 12,200.00 SYP
        # parallel (market): 4,100.00 TRY / 41.2 = 99.5145… → 99.51 USD
        - { account: "531006", currency: TRY, amount: 410000, book: 1220000, parallel: 9951 }
        - { account: "211003", currency: TRY, amount: -410000, book: -1220000, parallel: -9951 }
```

```yaml
case: a TRY expense is refused when one quote of the cross is not of the day
company: { shape: third, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-08, base: TRY, quote: SYP, rate: "2.9500", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.0000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.2000", type: market }
steps:
  - manual: a repair invoiced in TRY on Tuesday
    accounting_date: 2026-11-10
    payload: { lines: [{ account: "531006", currency: TRY, amount: 410000 },
                       { account: "211003", currency: TRY, amount: -410000 }] }
expect:
  # book: P = 2026-11-10; the direct TRY–SYP row and the USD–SYP quote are of the 8th, so neither
  # the direct rate nor the cross is in force (the old lookup would have used 2.95: 12,095.00 SYP)
  entries: []
  outcome: { status: refused, reason: RATE_MISSING }
```
