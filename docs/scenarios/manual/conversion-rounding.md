# Conversion rounding in a manual entry in one currency

Status: Approved (owner, 2026-10-28)

The expected entries were approved by the owner on 2026-10-28, the case "USD books; USD expenses paid from the USD bank", added after review, the same day. The book runs every case through the posting function since S03 brought the setup, the ledger reader and the step executors, with no expected value changed; `packages/ledger`'s `adr-0007.examples.test.ts` builds them too.

## Rule

A manual entry whose lines are all in one transaction currency must balance in that currency. Each ledger converts every line on its own, rounded half away from zero, and whatever that leaves the ledger out of balance by is conversion rounding: one rounding line per ledger, in that ledger only, to the `conversion_rounding` role account (the debit or the credit as the residual needs), never an exchange gain or loss. Lines in one currency that do not balance in it are refused (`ENTRY_UNBALANCED`).

## Basis

- **IAS 21.21–22:** each line is recorded at the spot rate of the transaction date (the bulletin of the day for the book ledger, S02 rule 16; the market rate for Vertex Media's parallel ledger). A one-currency entry exchanges nothing, so it has no exchange difference under IAS 21.28: its residual is the rounding of the conversions alone, at most half a minor unit per converted line.
- **IAS 1.32 and IAS 21.52(a):** the rounding account has its own code and role and is presented with the exchange differences on `is.fx_differences`, never offset inside another line of the entry.
- **Company policy:** `phase-1-scope.md` §4 ("A conversion rounding difference goes to the rounding account"); ADR 0007 "Rounding lines" (one line per ledger, in that ledger only, bounded by half a minor unit per converted line); ADR 0011 (the `conversion_rounding` role, account `541003` in the service-agency template); ADR 0012 and S03 rules 12 and 14 (owner, 2026-10-28).
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The account codes are the service-agency template's (S02): the SYP and USD bank accounts `111003` and `111004`, the USD e-wallet `111006`, the expense accounts `5310xx` and `532002`, and the conversion-rounding account `541003`. A `third` case adds a TRY cash account `111007` to the template (monetary, restricted to TRY, statement line `bs.cash`). Every rate is synthetic. Sunday 8 November and Tuesday 10 November 2026 are publication days; Tuesday 1 December 2026 too.

A rounding line carries its amount in one ledger only, in that ledger's currency (ADR 0007): in the SYP books a book rounding line is an SYP line with parallel 0, and a parallel rounding line a USD line with book 0. A half minor unit rounds away from zero: 306,787.5 → 306,788 and −306,787.5 → −306,788.

The cases below leave out what other scenarios own: an entry in more than one currency, whose rounding is part of the realised difference (`manual/currency-purchase.md`), the reversal rules in general (`manual/reversal.md`), and posting into a closed period, added with S07.

### Vertex Media: a USD entry rounded in the book ledger

```yaml
case: USD expenses paid from the USD bank; the book conversions leave 0.01 SYP, a credit
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - manual: software and internet paid from the USD bank account
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531004", currency: USD, amount: 7475 },
                       { account: "531003", currency: USD, amount: 2525 },
                       { account: "111004", currency: USD, amount: -10000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # book: 74.75 USD × 121.5 = 9,082.125 SYP → 908,212.5 minor → 908,213 (half away from zero)
        - { account: "531004", currency: USD, amount: 7475, book: 908213, parallel: 7475 }
        # book: 25.25 USD × 121.5 = 3,067.875 SYP → 306,787.5 minor → 306,788
        - { account: "531003", currency: USD, amount: 2525, book: 306788, parallel: 2525 }
        # book: 100.00 USD × 121.5 = 12,150.00 SYP exactly
        - { account: "111004", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
        # book residual: 908,213 + 306,788 − 1,215,000 = 1 → a credit of 0.01 SYP, within
        # 3 converted lines × 0.5 = 1.5 minor units; parallel: USD as is, no residual
        - { account: "541003", currency: SYP, amount: -1, book: -1, parallel: 0 }
  balances:
    - { account: "541003", book: -1, parallel: 0 }
```

```yaml
case: a USD expense paid from two USD accounts; the book conversions leave 0.01 SYP, a debit
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - manual: a software subscription paid from the USD bank account and the USD e-wallet
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531004", currency: USD, amount: 10000 },
                       { account: "111004", currency: USD, amount: -2525 },
                       { account: "111006", currency: USD, amount: -7475 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        - { account: "531004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        # book: −306,787.5 → −306,788 and −908,212.5 → −908,213 (away from zero)
        - { account: "111004", currency: USD, amount: -2525, book: -306788, parallel: -2525 }
        - { account: "111006", currency: USD, amount: -7475, book: -908213, parallel: -7475 }
        # book residual: 1,215,000 − 306,788 − 908,213 = −1 → a debit of 0.01 SYP
        - { account: "541003", currency: SYP, amount: 1, book: 1, parallel: 0 }
  balances:
    - { account: "541003", book: 1, parallel: 0 }
```

```yaml
case: four USD lines each rounded up by half a minor unit; one rounding line of 0.02 SYP
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - manual: four USD charges paid from the USD bank account
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531004", currency: USD, amount: 2525 },
                       { account: "531003", currency: USD, amount: 2525 },
                       { account: "532002", currency: USD, amount: 2525 },
                       { account: "531005", currency: USD, amount: 2425 },
                       { account: "111004", currency: USD, amount: -10000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # book: 2,525 × 121.5 = 306,787.5 → 306,788, three times
        - { account: "531004", currency: USD, amount: 2525, book: 306788, parallel: 2525 }
        - { account: "531003", currency: USD, amount: 2525, book: 306788, parallel: 2525 }
        - { account: "532002", currency: USD, amount: 2525, book: 306788, parallel: 2525 }
        # book: 2,425 × 121.5 = 294,637.5 → 294,638
        - { account: "531005", currency: USD, amount: 2425, book: 294638, parallel: 2425 }
        - { account: "111004", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
        # book residual: 3 × 306,788 + 294,638 − 1,215,000 = 2 → one credit line of 0.02 SYP,
        # within 5 converted lines × 0.5 = 2.5 minor units
        - { account: "541003", currency: SYP, amount: -2, book: -2, parallel: 0 }
  balances:
    - { account: "541003", book: -2, parallel: 0 }
```

### Vertex Media: an SYP entry rounded in the parallel ledger

```yaml
case: SYP expenses paid from the SYP bank; the parallel conversions leave 0.01 USD, a credit
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - manual: utilities and telecom paid from the SYP bank account
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531002", currency: SYP, amount: 100000 },
                       { account: "531003", currency: SYP, amount: 100000 },
                       { account: "111003", currency: SYP, amount: -200000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # book: SYP as is; parallel: 1,000.00 SYP / 122 (market) = 8.1967… → 8.20 USD, twice
        - { account: "531002", currency: SYP, amount: 100000, book: 100000, parallel: 820 }
        - { account: "531003", currency: SYP, amount: 100000, book: 100000, parallel: 820 }
        # parallel: 2,000.00 SYP / 122 = 16.3934… → 16.39 USD
        - { account: "111003", currency: SYP, amount: -200000, book: -200000, parallel: -1639 }
        # parallel residual: 820 + 820 − 1,639 = 1 → a credit of 0.01 USD in the parallel ledger only
        - { account: "541003", currency: USD, amount: -1, book: 0, parallel: -1 }
  balances:
    - { account: "541003", book: 0, parallel: -1 }
```

### Vertex Media: the USD entry reversed the next month

```yaml
case: the first USD entry reversed in December after the bulletin moved; the rounding line negated as posted
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
  # the rates of the reversal's date, which the reversal must not read
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "124.0000", type: market }
steps:
  - manual: software and internet paid from the USD bank account
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531004", currency: USD, amount: 7475 },
                       { account: "531003", currency: USD, amount: 2525 },
                       { account: "111004", currency: USD, amount: -10000 }] }
  - reversal: 1
    accounting_date: 2026-12-01
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # as in the first case
        - { account: "531004", currency: USD, amount: 7475, book: 908213, parallel: 7475 }
        - { account: "531003", currency: USD, amount: 2525, book: 306788, parallel: 2525 }
        - { account: "111004", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
        - { account: "541003", currency: SYP, amount: -1, book: -1, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        # entry 1 exactly, signs reversed: not converted at 123, and no new rounding of its own
        - { account: "531004", currency: USD, amount: -7475, book: -908213, parallel: -7475 }
        - { account: "531003", currency: USD, amount: -2525, book: -306788, parallel: -2525 }
        - { account: "111004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        - { account: "541003", currency: SYP, amount: 1, book: 1, parallel: 0 }
  balances:
    - { account: "531004", book: 0, parallel: 0 }
    - { account: "531003", book: 0, parallel: 0 }
    - { account: "111004", book: 0, parallel: 0 }
    - { account: "541003", book: 0, parallel: 0 }
```

### Vertex Media: unbalanced in its one currency

```yaml
case: a USD entry 0.01 USD short is refused, never balanced by a rounding or a difference line
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - manual: a software subscription with a mistyped credit
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531004", currency: USD, amount: 10000 },
                       { account: "111004", currency: USD, amount: -9999 }] }
expect:
  # 100.00 − 99.99 = 0.01 USD: an error in the transaction currency, not conversion rounding
  entries: []
  outcome: { status: refused, reason: ENTRY_UNBALANCED }
```

### SYP books only

```yaml
case: SYP books only; a USD entry rounded in the books by 0.01 SYP
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
steps:
  - manual: software and internet paid from the USD bank account
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531004", currency: USD, amount: 7475 },
                       { account: "531003", currency: USD, amount: 2525 },
                       { account: "111004", currency: USD, amount: -10000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # as in the first case, with no parallel ledger
        - { account: "531004", currency: USD, amount: 7475, book: 908213 }
        - { account: "531003", currency: USD, amount: 2525, book: 306788 }
        - { account: "111004", currency: USD, amount: -10000, book: -1215000 }
        - { account: "541003", currency: SYP, amount: -1, book: -1 }
```

```yaml
case: SYP books only; an SYP entry is never converted and needs no rounding line
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
steps:
  - manual: utilities and telecom paid from the SYP bank account
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531002", currency: SYP, amount: 100000 },
                       { account: "531003", currency: SYP, amount: 100000 },
                       { account: "111003", currency: SYP, amount: -200000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # SYP as is: no rate is read, no residual
        - { account: "531002", currency: SYP, amount: 100000, book: 100000 }
        - { account: "531003", currency: SYP, amount: 100000, book: 100000 }
        - { account: "111003", currency: SYP, amount: -200000, book: -200000 }
```

### USD books with an SYP parallel ledger

The book ledger converts SYP into USD at the bulletin, dividing by the SYP-per-USD quote, and keeps USD as is; the SYP parallel ledger keeps SYP as is and converts USD at the market rate.

```yaml
case: USD books; SYP expenses paid from the SYP bank; the book conversions leave 0.01 USD, a credit
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
steps:
  - manual: rent and utilities paid from the SYP bank account
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531001", currency: SYP, amount: 150000 },
                       { account: "531002", currency: SYP, amount: 150000 },
                       { account: "111003", currency: SYP, amount: -300000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # book: 1,500.00 SYP / 121.5 = 12.3456… → 12.35 USD, twice; parallel: SYP as is
        - { account: "531001", currency: SYP, amount: 150000, book: 1235, parallel: 150000 }
        - { account: "531002", currency: SYP, amount: 150000, book: 1235, parallel: 150000 }
        # book: 3,000.00 SYP / 121.5 = 24.6913… → 24.69 USD
        - { account: "111003", currency: SYP, amount: -300000, book: -2469, parallel: -300000 }
        # book residual: 1,235 + 1,235 − 2,469 = 1 → a credit of 0.01 USD in the book ledger only
        - { account: "541003", currency: USD, amount: -1, book: -1, parallel: 0 }
  balances:
    - { account: "541003", book: -1, parallel: 0 }
```

```yaml
case: USD books; USD expenses paid from the USD bank; the parallel conversions leave 0.01 SYP, a credit
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.5000", type: market }
steps:
  - manual: software and internet paid from the USD bank account
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531004", currency: USD, amount: 7475 },
                       { account: "531003", currency: USD, amount: 2525 },
                       { account: "111004", currency: USD, amount: -10000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # book: USD as is; parallel: 74.75 USD × 122.5 = 9,156.875 SYP → 915,687.5 minor → 915,688
        - { account: "531004", currency: USD, amount: 7475, book: 7475, parallel: 915688 }
        # parallel: 25.25 USD × 122.5 = 3,093.125 SYP → 309,312.5 minor → 309,313
        - { account: "531003", currency: USD, amount: 2525, book: 2525, parallel: 309313 }
        # parallel: 100.00 USD × 122.5 = 12,250.00 SYP exactly
        - { account: "111004", currency: USD, amount: -10000, book: -10000, parallel: -1225000 }
        # parallel residual: 915,688 + 309,313 − 1,225,000 = 1 → a credit of 0.01 SYP in the parallel ledger only
        - { account: "541003", currency: SYP, amount: -1, book: 0, parallel: -1 }
  balances:
    - { account: "541003", book: 0, parallel: -1 }
```

### A third currency: TRY rounded in both ledgers

Book SYP at the bulletin, crossed through USD (TRY→USD, then USD→SYP, one exact product); the USD parallel ledger at the market TRY rate. Tuesday 10 November 2026. The two ledgers round in opposite directions, so each gets its own line.

```yaml
case: TRY expenses paid from TRY cash; a 0.01 SYP debit in the book and a 0.01 USD credit in the parallel
company: { shape: third, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "111007", name: "الصندوق — ليرة تركية", name_latin: "Cash on hand — TRY",
                        currency: TRY, monetary: true, statement_line: bs.cash }] }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.2000", type: market }
steps:
  - manual: repairs and supplies paid from the TRY cash
    accounting_date: 2026-11-10
    payload: { lines: [{ account: "531006", currency: TRY, amount: 50000 },
                       { account: "531005", currency: TRY, amount: 150000 },
                       { account: "111007", currency: TRY, amount: -200000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-10
      lines:
        # book: 500.00 TRY / 41 × 122 = 1,487.8048… → 1,487.80 SYP
        # parallel: 500.00 TRY / 41.2 = 12.1359… → 12.14 USD
        - { account: "531006", currency: TRY, amount: 50000, book: 148780, parallel: 1214 }
        # book: 1,500.00 TRY / 41 × 122 = 4,463.4146… → 4,463.41 SYP
        # parallel: 1,500.00 TRY / 41.2 = 36.4077… → 36.41 USD
        - { account: "531005", currency: TRY, amount: 150000, book: 446341, parallel: 3641 }
        # book: 2,000.00 TRY / 41 × 122 = 5,951.2195… → 5,951.22 SYP
        # parallel: 2,000.00 TRY / 41.2 = 48.5436… → 48.54 USD
        - { account: "111007", currency: TRY, amount: -200000, book: -595122, parallel: -4854 }
        # book residual: 148,780 + 446,341 − 595,122 = −1 → a debit of 0.01 SYP
        - { account: "541003", currency: SYP, amount: 1, book: 1, parallel: 0 }
        # parallel residual: 1,214 + 3,641 − 4,854 = 1 → a credit of 0.01 USD
        - { account: "541003", currency: USD, amount: -1, book: 0, parallel: -1 }
  balances:
    - { account: "541003", book: 1, parallel: -1 }
```
