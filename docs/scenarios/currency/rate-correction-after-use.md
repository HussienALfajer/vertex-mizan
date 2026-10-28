# A rate corrected after an entry used it

Status: Approved (owner, 2026-10-27)

The expected entries were approved by the owner on 2026-10-27. The book runs every case through the posting function since S03 brought the setup, the ledger reader and the step executors, with no expected value changed; `packages/ledger`'s `adr-0007.examples.test.ts` builds them too. A correction dated inside a closed period (S02 rule 18) is added here with S07, which brings period close (owner, 2026-10-27).

## Rule

A wrong rate is corrected by recording a newer row for the same pair, type and date, with a reason; it supersedes the old row for every conversion from then on. A posted entry is never changed by a correction: Mizan lists the entries that converted at the superseded row, and the accountant reverses and reposts those they judge wrong. The reversal carries the original entry's amounts exactly (it is not converted again); the repost converts at the rate now in force.

## Basis

- **IAS 8.41–42:** an error is corrected in the financial statements; an error of the current period is corrected before they are authorised for issue, and a prior-period error retrospectively. Which entries to correct, and how, is the accountant's judgement, so Mizan lists them and corrects nothing on its own.
- **ADR 0005:** posted entries are append-only and corrections are reversals. **ADR 0007:** a correction is a newer rate row, never an update. **ADR 0011** "Rate pairs and corrections" and S02 rule 15 (owner, 2026-10-27).
- **IAS 21.21–22** and S02 rule 16 decide which row is in force: among rows of the same date, the one recorded last.
- **Syrian rules:** as in `bulletin-rate-of-the-day.md` (the bulletin for the statutory books, UNVERIFIED, Q1, adopted as company policy).

## Cases

The account codes are the service-agency template's (S02). A `rate` step records a rate row at that point of the case, as the accountant does on the rates screen; a row for a pair, type and date that already has one is a correction and carries its reason. `expect.corrections` states, for each correction step, the entries (by their number in posting order) the answer lists as having used the superseded row. Calendar: Thursday 5, Friday 6, Saturday 7 and Sunday 8 November 2026; Friday and Saturday are days off.

### The accountant reverses and reposts

```yaml
case: a mistyped bulletin corrected after use; the entry is reversed and reposted
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  # the bulletin of the 8th was 121.5; its digits were transposed when recorded
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "112.5000", type: bulletin }
steps:
  - manual: a software subscription paid from the USD bank account
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531004", currency: USD, amount: 10000 },
                       { account: "111004", currency: USD, amount: -10000 }] }
  - rate: { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin,
            reason: "Digits transposed when recorded: the bulletin of 8 November is 121.5" }
  - manual: bank charges the same day, after the correction
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "532002", currency: USD, amount: 5000 },
                       { account: "111004", currency: USD, amount: -5000 }] }
  - reversal: 1
    accounting_date: 2026-11-08
  - manual: the subscription reposted
    accounting_date: 2026-11-08
    payload: { lines: [{ account: "531004", currency: USD, amount: 10000 },
                       { account: "111004", currency: USD, amount: -10000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        # at the wrong row: 100.00 USD × 112.5 = 11,250.00 SYP; never changed afterwards
        - { account: "531004", currency: USD, amount: 10000, book: 1125000, parallel: 10000 }
        - { account: "111004", currency: USD, amount: -10000, book: -1125000, parallel: -10000 }
    - source: manual
      date: 2026-11-08
      lines:
        # the corrected row is the 8th's last recorded: 50.00 USD × 121.5 = 6,075.00 SYP
        - { account: "532002", currency: USD, amount: 5000, book: 607500, parallel: 5000 }
        - { account: "111004", currency: USD, amount: -5000, book: -607500, parallel: -5000 }
    - source: reversal
      date: 2026-11-08
      lines:
        # entry 1's amounts exactly, signs reversed: not converted again at 121.5
        - { account: "531004", currency: USD, amount: -10000, book: -1125000, parallel: -10000 }
        - { account: "111004", currency: USD, amount: 10000, book: 1125000, parallel: 10000 }
    - source: manual
      date: 2026-11-08
      lines:
        # 100.00 USD × 121.5 = 12,150.00 SYP
        - { account: "531004", currency: USD, amount: 10000, book: 1215000, parallel: 10000 }
        - { account: "111004", currency: USD, amount: -10000, book: -1215000, parallel: -10000 }
  corrections:
    # step 2 lists entry 1 only; entry 2 was posted after it, at the corrected row
    - { step: 2, used_by: [1] }
  balances:
    # 1,125,000 − 1,125,000 + 1,215,000 = 1,215,000
    - { account: "531004", book: 1215000, parallel: 10000 }
    # −1,125,000 − 607,500 + 1,125,000 − 1,215,000 = −1,822,500
    - { account: "111004", book: -1822500, parallel: -15000 }
```

### A day off that took the corrected row

```yaml
case: Thursday's bulletin corrected after Friday used it; Friday's entry stays, Saturday's uses the correction
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  # Thursday's bulletin was 120; recorded as 102
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "102.0000", type: bulletin }
steps:
  - manual: a software subscription paid on Friday
    accounting_date: 2026-11-06
    payload: { lines: [{ account: "531004", currency: USD, amount: 10000 },
                       { account: "111004", currency: USD, amount: -10000 }] }
  - rate: { date: 2026-11-05, base: USD, quote: SYP, rate: "120.0000", type: bulletin,
            reason: "Wrong figure entered for the bulletin of 5 November" }
  - manual: the same subscription for a second seat, paid on Saturday
    accounting_date: 2026-11-07
    payload: { lines: [{ account: "531004", currency: USD, amount: 10000 },
                       { account: "111004", currency: USD, amount: -10000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-06
      lines:
        # Friday: P = Thursday, the row then in force 102: 100.00 USD × 102 = 10,200.00 SYP
        - { account: "531004", currency: USD, amount: 10000, book: 1020000, parallel: 10000 }
        - { account: "111004", currency: USD, amount: -10000, book: -1020000, parallel: -10000 }
    - source: manual
      date: 2026-11-07
      lines:
        # Saturday: P = Thursday, its last recorded row 120: 100.00 USD × 120 = 12,000.00 SYP
        - { account: "531004", currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
        - { account: "111004", currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
  corrections:
    # Friday's entry used Thursday's superseded row, though dated a day later
    - { step: 2, used_by: [1] }
  balances:
    # 1,020,000 + 1,200,000: the accountant has not yet reversed Friday's entry
    - { account: "531004", book: 2220000, parallel: 20000 }
```

### USD books: the reversal carries the original amount

```yaml
case: USD books; a mistyped bulletin corrected; the reversal carries 98.04, the repost 83.33
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market } }
rates:
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "102.0000", type: bulletin }
steps:
  - manual: rent paid in SYP
    accounting_date: 2026-11-05
    payload: { lines: [{ account: "531001", currency: SYP, amount: 1000000 },
                       { account: "111003", currency: SYP, amount: -1000000 }] }
  - rate: { date: 2026-11-05, base: USD, quote: SYP, rate: "120.0000", type: bulletin,
            reason: "Wrong figure entered for the bulletin of 5 November" }
  - reversal: 1
    accounting_date: 2026-11-05
  - manual: the rent reposted
    accounting_date: 2026-11-05
    payload: { lines: [{ account: "531001", currency: SYP, amount: 1000000 },
                       { account: "111003", currency: SYP, amount: -1000000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-05
      lines:
        # 10,000.00 SYP / 102 = 98.0392… → 98.04 USD
        - { account: "531001", currency: SYP, amount: 1000000, book: 9804, parallel: 1000000 }
        - { account: "111003", currency: SYP, amount: -1000000, book: -9804, parallel: -1000000 }
    - source: reversal
      date: 2026-11-05
      lines:
        # entry 1 exactly, signs reversed: 98.04 USD, not 10,000.00 SYP / 120 = 83.33
        - { account: "531001", currency: SYP, amount: -1000000, book: -9804, parallel: -1000000 }
        - { account: "111003", currency: SYP, amount: 1000000, book: 9804, parallel: 1000000 }
    - source: manual
      date: 2026-11-05
      lines:
        # 10,000.00 SYP / 120 = 83.3333… → 83.33 USD
        - { account: "531001", currency: SYP, amount: 1000000, book: 8333, parallel: 1000000 }
        - { account: "111003", currency: SYP, amount: -1000000, book: -8333, parallel: -1000000 }
  corrections:
    - { step: 2, used_by: [1] }
  balances:
    - { account: "531001", book: 8333, parallel: 1000000 }
    - { account: "111003", book: -8333, parallel: -1000000 }
```
