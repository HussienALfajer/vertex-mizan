# The reversal of a manual entry

Status: Proposed

Drafted for the owner's approval of the expected entries. Once approved, the file stays `Proposed` until S03 registers the setup, the ledger reader and the `manual` and `reversal` executors the runner needs; the PR that does so marks it `Approved (owner, <the approval's date>)` without changing an expected value.

## Rule

A posted manual entry is corrected only by its reversal: a new entry that references it and negates every one of its lines exactly, rounding and exchange-difference lines included, at the amounts the original posted in each ledger. It is never converted again, so it reads no rate and adds no rounding or difference line of its own. It is dated on or after the original, in an open period. Only a manual entry that is not itself a reversal is reversed by hand (`ENTRY_NOT_REVERSIBLE`), and only once (`ENTRY_ALREADY_REVERSED`); a date before the original's is refused (`REVERSAL_BEFORE_ORIGINAL`).

## Basis

- **IAS 8.41–42:** an error is corrected in the books, never by altering a recorded entry; a reversal and a new entry keep both visible. **IAS 21.21–22:** the original's lines were measured at the spot rates of its date; undoing that transaction undoes the same measurement, so the reversal carries those amounts and measures nothing.
- **Company policy:** `phase-1-scope.md` §4 F05 ("A posted entry is never changed or deleted. A correction is a reversal that references the original."); ADR 0005 invariant 3 (the exact negation, once); ADR 0007 "Carried amounts" (a line that reverses carries its balance's amounts); ADR 0012 "Manual reversal" and S03 rule 9 (owner, 2026-10-28): manual entries only, a date on or after the original's, a reversal is never reversed (it is copied instead).
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting. The Arabic, chronologically numbered journal (Commercial Code arts. 16–19, REPORTED): the reversal is a new numbered entry, the original keeps its number.

## Cases

The account codes are the service-agency template's (S02): the SYP and USD bank accounts `111003` and `111004`, the expense accounts `5310xx`, realised exchange losses `541001` and the conversion-rounding account `541003`. A `third` case adds a TRY cash account `111007` to the template (monetary, restricted to TRY, statement line `bs.cash`). Every rate is synthetic. Sunday 8 November, Tuesday 10 November, Tuesday 1 December and Tuesday 29 December 2026 are publication days; Sunday 3 January 2027 too.

Each original entry below is one the scenario book already approved (`manual/conversion-rounding.md`, `manual/currency-purchase.md`), or a plain one-currency entry with no rounding. A reversal's lines are the original's with every amount negated: the transaction, book and parallel amounts, line by line, each rounding and difference line in its own ledger.

The cases below leave out what other scenarios or later specs own: the reversals already shown with their rule (`manual/conversion-rounding.md`, a USD entry with a book rounding line; `manual/currency-purchase.md`, a dealt purchase with a book difference line); a reversal into a closed period, added with S07; a reversal of a Hub entry refused with `ENTRY_NOT_REVERSIBLE`, added with S05's `event` executor; and the approval of a reversal, which changes who posts it, not what it posts.

### Vertex Media: an entry to the wrong account, reversed the same day and reposted

```yaml
case: a USD expense posted to the wrong account; reversed on its own date and reposted to the right one
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - manual: a software subscription posted to internet by mistake
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531003", currency: USD, amount: 10000 },
                       { account: "111004", currency: USD, amount: -10000 }] }
  - reversal: 1
    accounting_date: 2026-11-08
  - manual: the software subscription, reposted
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531004", currency: USD, amount: 10000 },
                       { account: "111004", currency: USD, amount: -10000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # book: 100.00 USD × 121.5 = 12,150.00 SYP; parallel: USD as is
        - { account: "531003", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        - { account: "111004", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
    - source: reversal
      date: 2026-11-08
      lines:
        # entry 1, every amount negated; the same date is allowed (on or after the original's)
        - { account: "531003", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
        - { account: "111004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
    - source: manual
      date: 2026-11-08
      lines:
        # a new measurement at the same rates
        - { account: "531004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        - { account: "111004", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
  balances:
    - { account: "531003", book: 0, parallel: 0 }
    - { account: "531004", book: 1215000, parallel: 10000 }
    - { account: "111004", book: -1215000, parallel: -10000 }
```

### Vertex Media: a difference line in each ledger, reversed after both rates moved

```yaml
case: USD bought at the market rate, with a loss in both ledgers; reversed in December, both difference lines negated
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
    payload: { lines: [{ account: "111004", currency: USD, amount: 10000 },
                       { account: "111003", currency: SYP, amount: -1225000 }] }
  - reversal: 1
    accounting_date: 2026-12-01
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # as in manual/currency-purchase.md, "USD bought without a dealt rate"
        # book: 100.00 USD × 121.5 = 12,150.00 SYP
        - { account: "111004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        # parallel: 12,250.00 SYP / 122 = 100.4098… → 100.41 USD
        - { account: "111003", currency: SYP, amount: -1225000, book: -1225000, parallel: -10041 }
        # book residual −10,000 → loss 100.00 SYP; parallel residual −41 → loss 0.41 USD
        - { account: "541001", currency: SYP, amount: 10000, book: 10000, parallel: 0 }
        - { account: "541001", currency: USD, amount: 41, book: 0, parallel: 41 }
    - source: reversal
      date: 2026-12-01
      lines:
        # entry 1 exactly, signs reversed: not 100.00 USD × 123 nor 12,250.00 SYP / 124,
        # and no new difference; the two loss lines stay apart, one per ledger
        - { account: "111004", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
        - { account: "111003", currency: SYP, amount: 1225000, book: 1225000, parallel: 10041 }
        - { account: "541001", currency: SYP, amount: -10000, book: -10000, parallel: 0 }
        - { account: "541001", currency: USD, amount: -41, book: 0, parallel: -41 }
  balances:
    - { account: "111004", book: 0, parallel: 0 }
    - { account: "111003", book: 0, parallel: 0 }
    - { account: "541001", book: 0, parallel: 0 }
```

### Refusals

```yaml
case: a reversal dated before its original is refused
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - manual: a software subscription paid from the USD bank account
    accounting_date: 2026-11-10
    payload: { lines: [{ account: "531004", currency: USD, amount: 10000 },
                       { account: "111004", currency: USD, amount: -10000 }] }
  - reversal: 1
    accounting_date: 2026-11-08
expect:
  entries:
    - source: manual
      date: 2026-11-10
      lines:
        - { account: "531004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        - { account: "111004", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
  outcome: { status: refused, reason: REVERSAL_BEFORE_ORIGINAL }
```

```yaml
case: an entry already reversed is refused a second reversal
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - manual: a software subscription paid from the USD bank account
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531004", currency: USD, amount: 10000 },
                       { account: "111004", currency: USD, amount: -10000 }] }
  - reversal: 1
    accounting_date: 2026-11-08
  - reversal: 1
    accounting_date: 2026-11-08
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        - { account: "531004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        - { account: "111004", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
    - source: reversal
      date: 2026-11-08
      lines:
        - { account: "531004", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
        - { account: "111004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
  balances:
    - { account: "531004", book: 0, parallel: 0 }
    - { account: "111004", book: 0, parallel: 0 }
  outcome: { status: refused, reason: ENTRY_ALREADY_REVERSED }
```

```yaml
case: a reversal is never reversed; the original is copied instead
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - manual: a software subscription paid from the USD bank account
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531004", currency: USD, amount: 10000 },
                       { account: "111004", currency: USD, amount: -10000 }] }
  - reversal: 1
    accounting_date: 2026-11-08
  - reversal: 2
    accounting_date: 2026-11-08
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        - { account: "531004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        - { account: "111004", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
    - source: reversal
      date: 2026-11-08
      lines:
        - { account: "531004", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
        - { account: "111004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
  outcome: { status: refused, reason: ENTRY_NOT_REVERSIBLE }
```

### SYP books only: reversed in the next fiscal year, with no rate entered

```yaml
case: SYP books only; a USD entry with a rounding line reversed in January 2027, whose bulletin is not entered
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
rates:
  # no bulletin for 2027-01-03, a publication day: a reversal that read a rate would be
  # refused with RATE_MISSING
  - { date: 2026-12-29, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
steps:
  - manual: software and internet paid from the USD bank account
    accounting_date: 2026-12-29
    payload: { lines: [{ account: "531004", currency: USD, amount: 7475 },
                       { account: "531003", currency: USD, amount: 2525 },
                       { account: "111004", currency: USD, amount: -10000 }] }
  - reversal: 1
    accounting_date: 2027-01-03
expect:
  entries:
    - source: manual
      date: 2026-12-29
      lines:
        # book: 74.75 USD × 121.5 = 9,082.125 SYP → 908,212.5 minor → 908,213
        - { account: "531004", currency: USD, amount: 7475, book: 908213 }
        # book: 25.25 USD × 121.5 = 3,067.875 SYP → 306,787.5 minor → 306,788
        - { account: "531003", currency: USD, amount: 2525, book: 306788 }
        - { account: "111004", currency: USD, amount: -10000, book: -1215000 }
        # book residual: 908,213 + 306,788 − 1,215,000 = 1 → a rounding credit of 0.01 SYP
        - { account: "541003", currency: SYP, amount: -1, book: -1 }
    - source: reversal
      date: 2027-01-03
      lines:
        # entry 1 negated, its rounding line included; numbered in 2027's sequence
        - { account: "531004", currency: USD, amount: -7475, book: -908213 }
        - { account: "531003", currency: USD, amount: -2525, book: -306788 }
        - { account: "111004", currency: USD, amount: 10000, book: 1215000 }
        - { account: "541003", currency: SYP, amount: 1, book: 1 }
  balances:
    - { account: "531004", book: 0 }
    - { account: "531003", book: 0 }
    - { account: "111004", book: 0 }
    - { account: "541003", book: 0 }
```

### USD books with an SYP parallel ledger

```yaml
case: USD books; an SYP entry with a book rounding line reversed in December after the bulletin moved
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  # the rate of the reversal's date, which the reversal must not read
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - manual: rent and utilities paid from the SYP bank account
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531001", currency: SYP, amount: 150000 },
                       { account: "531002", currency: SYP, amount: 150000 },
                       { account: "111003", currency: SYP, amount: -300000 }] }
  - reversal: 1
    accounting_date: 2026-12-01
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # as in manual/conversion-rounding.md: book 1,500.00 SYP / 121.5 = 12.3456… → 12.35 USD
        - { account: "531001", currency: SYP, amount: 150000, book: 1235, parallel: 150000 }
        - { account: "531002", currency: SYP, amount: 150000, book: 1235, parallel: 150000 }
        # book: 3,000.00 SYP / 121.5 = 24.6913… → 24.69 USD
        - { account: "111003", currency: SYP, amount: -300000, book: -2469, parallel: -300000 }
        # book residual: 1,235 + 1,235 − 2,469 = 1 → a rounding credit of 0.01 USD
        - { account: "541003", currency: USD, amount: -1, book: -1, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        # entry 1 negated: not 1,500.00 SYP / 123 = 12.20 USD
        - { account: "531001", currency: SYP, amount: -150000, book: -1235, parallel: -150000 }
        - { account: "531002", currency: SYP, amount: -150000, book: -1235, parallel: -150000 }
        - { account: "111003", currency: SYP, amount: 300000, book: 2469, parallel: 300000 }
        - { account: "541003", currency: USD, amount: 1, book: 1, parallel: 0 }
  balances:
    - { account: "531001", book: 0, parallel: 0 }
    - { account: "531002", book: 0, parallel: 0 }
    - { account: "111003", book: 0, parallel: 0 }
    - { account: "541003", book: 0, parallel: 0 }
```

### A third currency: a rounding line in each ledger

```yaml
case: TRY expenses with a rounding line in each ledger, reversed in December after every rate moved
company: { shape: third, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "111007", name: "الصندوق — ليرة تركية", name_latin: "Cash on hand — TRY",
                        currency: TRY, monetary: true, statement_line: bs.cash }] }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.2000", type: market }
  # the rates of the reversal's date, which the reversal must not read
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-12-01, base: USD, quote: TRY, rate: "41.5000", type: bulletin }
  - { date: 2026-12-01, base: USD, quote: TRY, rate: "41.8000", type: market }
steps:
  - manual: repairs and supplies paid from the TRY cash
    accounting_date: 2026-11-10
    payload: { lines: [{ account: "531006", currency: TRY, amount: 50000 },
                       { account: "531005", currency: TRY, amount: 150000 },
                       { account: "111007", currency: TRY, amount: -200000 }] }
  - reversal: 1
    accounting_date: 2026-12-01
expect:
  entries:
    - source: manual
      date: 2026-11-10
      lines:
        # as in manual/conversion-rounding.md
        # book: 500.00 TRY / 41 × 122 = 1,487.80 SYP; parallel: 500.00 TRY / 41.2 = 12.14 USD
        - { account: "531006", currency: TRY, amount: 50000, book: 148780, parallel: 1214 }
        # book: 1,500.00 TRY / 41 × 122 = 4,463.41 SYP; parallel: 1,500.00 TRY / 41.2 = 36.41 USD
        - { account: "531005", currency: TRY, amount: 150000, book: 446341, parallel: 3641 }
        # book: 2,000.00 TRY / 41 × 122 = 5,951.22 SYP; parallel: 2,000.00 TRY / 41.2 = 48.54 USD
        - { account: "111007", currency: TRY, amount: -200000, book: -595122, parallel: -4854 }
        # book residual −1 → a rounding debit of 0.01 SYP; parallel residual 1 → a credit of 0.01 USD
        - { account: "541003", currency: SYP, amount: 1, book: 1, parallel: 0 }
        - { account: "541003", currency: USD, amount: -1, book: 0, parallel: -1 }
    - source: reversal
      date: 2026-12-01
      lines:
        # entry 1 negated in both ledgers, each rounding line in its own ledger
        - { account: "531006", currency: TRY, amount: -50000, book: -148780, parallel: -1214 }
        - { account: "531005", currency: TRY, amount: -150000, book: -446341, parallel: -3641 }
        - { account: "111007", currency: TRY, amount: 200000, book: 595122, parallel: 4854 }
        - { account: "541003", currency: SYP, amount: -1, book: -1, parallel: 0 }
        - { account: "541003", currency: USD, amount: 1, book: 0, parallel: 1 }
  balances:
    - { account: "531006", book: 0, parallel: 0 }
    - { account: "531005", book: 0, parallel: 0 }
    - { account: "111007", book: 0, parallel: 0 }
    - { account: "541003", book: 0, parallel: 0 }
```
