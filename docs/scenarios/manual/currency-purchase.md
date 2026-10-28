# A currency purchase or sale by manual entry

Status: Proposed

## Rule

A manual entry that exchanges one currency for another measures every line anew in each ledger: as is in a ledger of its own currency, otherwise at that ledger's policy rate in force on the entry date, or at the rate the accountant dealt at when the ledger's policy is `market` and accepts a transaction's rate (for that pair only). Whatever each ledger is left out of balance by, conversion rounding included, posts in that ledger only as a realised exchange difference: to the `fx_realised_loss` account when it is a debit, to the `fx_realised_gain` account when it is a credit. A dealt rate that no ledger of the company can use is refused with `DEALT_RATE_NOT_ACCEPTED`.

## Basis

- **IAS 21.21–22:** each line is recorded at the spot rate of the transaction date (the bulletin of the day for the book ledger, S02 rule 16; the market rate, or the rate actually dealt at, for Vertex Media's parallel ledger).
- **IAS 21.28:** the difference between what was given up and what was received, each at its ledger's rate, is a realised exchange difference recognised in profit or loss in the period.
- **Company policy:** `phase-1-scope.md` §4 (book ledger at the bulletin, the USD parallel ledger at market or the transaction's own rate); ADR 0007 "Exchange residuals"; ADR 0011 (separate gain and loss accounts); ADR 0012 "Manual entries are new measurements" and S03 rules 12–15 (owner, 2026-10-28).
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The account codes are the service-agency template's (S02): the SYP and USD bank accounts `111003` and `111004`, realised exchange gains `421001` and losses `541001`. A `third` case adds a TRY cash account `111007` to the template (monetary, restricted to TRY, statement line `bs.cash`). Every rate is synthetic. Sunday 8 November and Tuesday 10 November 2026 are publication days; Tuesday 1 December 2026 too.

A difference line carries its amount in one ledger only, in that ledger's currency (ADR 0007): in the SYP books a book difference is an SYP line with parallel 0, and a parallel difference a USD line with book 0. A manual entry's `dealt_rates` give, per currency pair, the rate dealt at, quoted in the company's orientation of the pair (S03 rule 13).

The cases below leave out what other scenarios own: rounding in one currency (`manual/conversion-rounding.md`), a rate corrected after use (`currency/rate-correction-after-use.md`), and posting into a closed period, added with S07.

### Vertex Media: USD bought at a dealt rate

```yaml
case: 100.00 USD bought for 12,250.00 SYP dealt at 122.5; a book loss only
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - manual: USD bought from the SYP bank account
    accounting_date: 2026-11-08
    payload: { dealt_rates: [{ base: USD, quote: SYP, rate: "122.5000" }],
               lines: [{ account: "111004", currency: USD, amount: 10000 },
                       { account: "111003", currency: SYP, amount: -1225000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # book: 100.00 USD × 121.5 (bulletin; the book ledger takes no dealt rate) = 12,150.00 SYP
        - { account: "111004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        # parallel: 12,250.00 SYP / 122.5 (dealt) = 100.00 USD
        - { account: "111003", currency: SYP, amount: -1225000, book: -1225000, parallel: -10000 }
        # book residual: 1,215,000 − 1,225,000 = −10,000 → a debit: realised loss 100.00 SYP
        # parallel residual: 10,000 − 10,000 = 0 → no parallel line
        - { account: "541001", currency: SYP, amount: 10000, book: 10000, parallel: 0 }
  balances:
    - { account: "541001", book: 10000, parallel: 0 }
```

### Vertex Media: USD bought without a dealt rate

```yaml
case: 100.00 USD bought for 12,250.00 SYP at the market rate; a loss in both ledgers
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - manual: USD bought from the SYP bank account
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "111004", currency: USD, amount: 10000 },
                       { account: "111003", currency: SYP, amount: -1225000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # book: 100.00 USD × 121.5 = 12,150.00 SYP
        - { account: "111004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        # parallel: 12,250.00 SYP / 122 (market) = 100.4098… → 100.41 USD
        - { account: "111003", currency: SYP, amount: -1225000, book: -1225000, parallel: -10041 }
        # book residual: 1,215,000 − 1,225,000 = −10,000 → realised loss 100.00 SYP
        - { account: "541001", currency: SYP, amount: 10000, book: 10000, parallel: 0 }
        # parallel residual: 10,000 − 10,041 = −41 → realised loss 0.41 USD (rounding included)
        - { account: "541001", currency: USD, amount: 41, book: 0, parallel: 41 }
  balances:
    - { account: "541001", book: 10000, parallel: 41 }
```

### Vertex Media: USD sold at a dealt rate

```yaml
case: 100.00 USD sold for 12,300.00 SYP dealt at 123; a book gain only
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - manual: USD sold into the SYP bank account
    accounting_date: 2026-11-08
    payload: { dealt_rates: [{ base: USD, quote: SYP, rate: "123.0000" }],
               lines: [{ account: "111003", currency: SYP, amount: 1230000 },
                       { account: "111004", currency: USD, amount: -10000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # parallel: 12,300.00 SYP / 123 (dealt) = 100.00 USD
        - { account: "111003", currency: SYP, amount: 1230000, book: 1230000, parallel: 10000 }
        # book: 100.00 USD × 121.5 = 12,150.00 SYP
        - { account: "111004", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
        # book residual: 1,230,000 − 1,215,000 = 15,000 → a credit: realised gain 150.00 SYP
        - { account: "421001", currency: SYP, amount: -15000, book: -15000, parallel: 0 }
  balances:
    - { account: "421001", book: -15000, parallel: 0 }
```

### Vertex Media: a loss in one ledger and a gain in the other

```yaml
case: 100.00 USD bought for 12,180.00 SYP at the market rate; a book loss and a parallel gain
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - manual: USD bought from the SYP bank account below the market rate
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "111004", currency: USD, amount: 10000 },
                       { account: "111003", currency: SYP, amount: -1218000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # book: 100.00 USD × 121.5 = 12,150.00 SYP
        - { account: "111004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        # parallel: 12,180.00 SYP / 122 = 99.8360… → 99.84 USD
        - { account: "111003", currency: SYP, amount: -1218000, book: -1218000, parallel: -9984 }
        # book residual: 1,215,000 − 1,218,000 = −3,000 → realised loss 30.00 SYP
        - { account: "541001", currency: SYP, amount: 3000, book: 3000, parallel: 0 }
        # parallel residual: 10,000 − 9,984 = 16 → a credit: realised gain 0.16 USD
        - { account: "421001", currency: USD, amount: -16, book: 0, parallel: -16 }
```

### Vertex Media: the purchase reversed the next month

```yaml
case: the dealt purchase reversed in December after the bulletin moved; every line negated as posted
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
  # the rates of the reversal's date, which the reversal must not read
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "124.0000", type: market }
steps:
  - manual: USD bought from the SYP bank account
    accounting_date: 2026-11-08
    payload: { dealt_rates: [{ base: USD, quote: SYP, rate: "122.5000" }],
               lines: [{ account: "111004", currency: USD, amount: 10000 },
                       { account: "111003", currency: SYP, amount: -1225000 }] }
  - reversal: 1
    accounting_date: 2026-12-01
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # as in the first case
        - { account: "111004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        - { account: "111003", currency: SYP, amount: -1225000, book: -1225000, parallel: -10000 }
        - { account: "541001", currency: SYP, amount: 10000, book: 10000, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        # entry 1 exactly, signs reversed: not 100.00 USD × 123, and no new difference
        - { account: "111004", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
        - { account: "111003", currency: SYP, amount: 1225000, book: 1225000, parallel: 10000 }
        - { account: "541001", currency: SYP, amount: -10000, book: -10000, parallel: 0 }
  balances:
    - { account: "111004", book: 0, parallel: 0 }
    - { account: "111003", book: 0, parallel: 0 }
    - { account: "541001", book: 0, parallel: 0 }
```

### SYP books only

```yaml
case: SYP books only; 100.00 USD bought for 12,250.00 SYP; a loss in the books
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
steps:
  - manual: USD bought from the SYP bank account
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "111004", currency: USD, amount: 10000 },
                       { account: "111003", currency: SYP, amount: -1225000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # 100.00 USD × 121.5 = 12,150.00 SYP
        - { account: "111004", currency: USD, amount: 10000, book: 1215000 }
        - { account: "111003", currency: SYP, amount: -1225000, book: -1225000 }
        # residual: 1,215,000 − 1,225,000 = −10,000 → realised loss 100.00 SYP
        - { account: "541001", currency: SYP, amount: 10000, book: 10000 }
```

```yaml
case: SYP books only; a dealt rate is refused, since the bulletin ledger cannot take it
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
steps:
  - manual: USD bought from the SYP bank account at a dealt rate
    accounting_date: 2026-11-08
    payload: { dealt_rates: [{ base: USD, quote: SYP, rate: "122.5000" }],
               lines: [{ account: "111004", currency: USD, amount: 10000 },
                       { account: "111003", currency: SYP, amount: -1225000 }] }
expect:
  entries: []
  outcome: { status: refused, reason: DEALT_RATE_NOT_ACCEPTED }
```

### USD books with an SYP parallel ledger

The book ledger converts SYP into USD at the bulletin, dividing by the SYP-per-USD quote; the SYP parallel ledger converts USD at the market rate.

```yaml
case: USD books; 100.00 USD bought for 12,250.00 SYP; a loss in both ledgers
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - manual: USD bought from the SYP bank account
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "111004", currency: USD, amount: 10000 },
                       { account: "111003", currency: SYP, amount: -1225000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # parallel: 100.00 USD × 122 (market) = 12,200.00 SYP
        - { account: "111004", currency: USD, amount: 10000, book: 10000, parallel: 1220000 }
        # book: 12,250.00 SYP / 121.5 (bulletin) = 100.8230… → 100.82 USD
        - { account: "111003", currency: SYP, amount: -1225000, book: -10082, parallel: -1225000 }
        # book residual: 10,000 − 10,082 = −82 → realised loss 0.82 USD (rounding included)
        - { account: "541001", currency: USD, amount: 82, book: 82, parallel: 0 }
        # parallel residual: 1,220,000 − 1,225,000 = −5,000 → realised loss 50.00 SYP
        - { account: "541001", currency: SYP, amount: 5000, book: 0, parallel: 5000 }
  balances:
    - { account: "541001", book: 82, parallel: 5000 }
```

```yaml
case: USD books; a dealt rate is refused when the parallel ledger does not accept one
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - manual: USD bought from the SYP bank account at a dealt rate
    accounting_date: 2026-11-08
    payload: { dealt_rates: [{ base: USD, quote: SYP, rate: "122.5000" }],
               lines: [{ account: "111004", currency: USD, amount: 10000 },
                       { account: "111003", currency: SYP, amount: -1225000 }] }
expect:
  entries: []
  outcome: { status: refused, reason: DEALT_RATE_NOT_ACCEPTED }
```

```yaml
case: USD books; the SYP parallel ledger accepts the dealt rate; a book loss only
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - manual: USD bought from the SYP bank account at a dealt rate
    accounting_date: 2026-11-08
    payload: { dealt_rates: [{ base: USD, quote: SYP, rate: "122.5000" }],
               lines: [{ account: "111004", currency: USD, amount: 10000 },
                       { account: "111003", currency: SYP, amount: -1225000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # parallel: 100.00 USD × 122.5 (dealt) = 12,250.00 SYP
        - { account: "111004", currency: USD, amount: 10000, book: 10000, parallel: 1225000 }
        # book: 12,250.00 SYP / 121.5 (bulletin) = 100.82 USD
        - { account: "111003", currency: SYP, amount: -1225000, book: -10082, parallel: -1225000 }
        # book residual −82 → realised loss 0.82 USD; parallel residual 0 → no parallel line
        - { account: "541001", currency: USD, amount: 82, book: 82, parallel: 0 }
```

### A third currency: TRY sold for USD

Book SYP at the bulletin, crossed through USD (TRY→USD, then USD→SYP); the USD parallel ledger at the market TRY rate, or the dealt rate. Tuesday 10 November 2026.

```yaml
case: 4,150.00 TRY sold for 100.00 USD at the market rate; a loss in both ledgers
company: { shape: third, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "111007", name: "الصندوق — ليرة تركية", name_latin: "Cash on hand — TRY",
                        currency: TRY, monetary: true, statement_line: bs.cash }] }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.2000", type: market }
steps:
  - manual: TRY cash sold for USD into the USD bank account
    accounting_date: 2026-11-10
    payload: { lines: [{ account: "111004", currency: USD, amount: 10000 },
                       { account: "111007", currency: TRY, amount: -415000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-10
      lines:
        # book: 100.00 USD × 122 = 12,200.00 SYP
        - { account: "111004", currency: USD, amount: 10000, book: 1220000, parallel: 10000 }
        # book: 4,150.00 TRY / 41 × 122 (one exact product) = 12,348.7804… → 12,348.78 SYP
        # parallel: 4,150.00 TRY / 41.2 (market) = 100.7281… → 100.73 USD
        - { account: "111007", currency: TRY, amount: -415000, book: -1234878, parallel: -10073 }
        # book residual: 1,220,000 − 1,234,878 = −14,878 → realised loss 148.78 SYP
        - { account: "541001", currency: SYP, amount: 14878, book: 14878, parallel: 0 }
        # parallel residual: 10,000 − 10,073 = −73 → realised loss 0.73 USD
        - { account: "541001", currency: USD, amount: 73, book: 0, parallel: 73 }
```

```yaml
case: 4,150.00 TRY sold for 100.00 USD dealt at 41.5; a book loss only
company: { shape: third, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "111007", name: "الصندوق — ليرة تركية", name_latin: "Cash on hand — TRY",
                        currency: TRY, monetary: true, statement_line: bs.cash }] }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.2000", type: market }
steps:
  - manual: TRY cash sold for USD at a dealt rate
    accounting_date: 2026-11-10
    payload: { dealt_rates: [{ base: USD, quote: TRY, rate: "41.5000" }],
               lines: [{ account: "111004", currency: USD, amount: 10000 },
                       { account: "111007", currency: TRY, amount: -415000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-10
      lines:
        - { account: "111004", currency: USD, amount: 10000, book: 1220000, parallel: 10000 }
        # book: the bulletin cross, as above: 12,348.78 SYP; parallel: 4,150.00 / 41.5 (dealt) = 100.00 USD
        - { account: "111007", currency: TRY, amount: -415000, book: -1234878, parallel: -10000 }
        # book residual −14,878 → realised loss 148.78 SYP; parallel residual 0
        - { account: "541001", currency: SYP, amount: 14878, book: 14878, parallel: 0 }
```
