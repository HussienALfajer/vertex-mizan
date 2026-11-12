# A stale revaluation and its adjusting revaluation

Status: Approved (owner, 2026-11-12)

S07 wrote these cases (S07 "Scenarios"); the owner approved their expected entries and outcomes on 2026-11-12. S07's feature slice brought the `revalue` executor (PR 1) and the `close` and `reopen` executors (PR 2), with no expected value changed.

## Rule

A ledger's revaluation of month *m* is current when recomputing it gives a difference of zero for every balance. While *m* is open, a posting dated on or before its last day (a back-dated payment, a posting after a reopen) or a corrected closing rate can make it stale. A stale revaluation is made current by an adjusting revaluation: the same computation, `difference = target − carrying − already revalued`, where *already revalued* is the sum of the balance's amounts in that ledger's revaluation entries dated on *m*'s last day. It posts only the differences, two lines per balance without netting, dated on *m*'s last day, with its own reversal on the first day of *m* + 1. A back-dated posting whose balances still recompute equal leaves the revaluation current and posts nothing. Once *m* is closed, nothing changes it: a corrected closing rate is recorded, and a revaluation of *m* is refused `PERIOD_CLOSED`.

## Basis

- **IAS 21.23(a):** monetary items are translated at the closing rate at the end of each reporting period, so a month's figures must reflect every posting dated in it and the correct closing rate. **IAS 21.28:** the exchange differences are recognised in profit or loss of the period; an adjustment dated on the month end puts them in the month they belong to. **IAS 1.32 and 1.35:** gains and losses are posted gross; S09 may present them net.
- **IAS 21.28 and ADR 0013:** a settlement dated before the month end clears the item's carrying amount, which excludes revaluations, and realises the whole movement from the original measurement; the adjusting revaluation then takes back the part of the month's unrealised difference that the settlement realised, so it is never counted twice.
- **IAS 8.42:** a closed month is never changed by a later rate correction; the accountant decides under IAS 8 whether to reopen it.
- **Company policy:** `phase-1-scope.md` §4 "Month-end revaluation" (each entry reverses on the first day of the next month) and §5 (the checklist: both ledgers' revaluations posted and current); ADR 0007 "Revaluation" (a revaluation goes stale when a posting is later dated on or before the month end while the month is open; the adjusting revaluation for the difference, on that month end, with its own reversal); ADR 0016 (owner, 2026-11-11: current means recomputed equal; a back-dated posting, a reopen's postings or a corrected closing rate while the month is open make it stale; the adjustment posts only the differences); S07 rules 2–3, 8 (`revaluation_current`), 12, 15–16 and edge cases 3, 9 and 10.
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting. No other Syrian rule is relied on; IAS 29 is out of scope.

## Cases

The account codes are the service-agency template's (S02), as in `currency/month-end-revaluation.md`: the SYP and USD bank accounts `111003` and `111004`, trade receivables `112001` (a document control account), capital `311001` and the owner's current account `313001` (non-monetary), service revenue `411001`, realised exchange gains `421001`, unrealised exchange gains `421002` and losses `541002`, software subscriptions `531004` and repairs `531006` (expenses, non-monetary). The `third` case adds a TRY cash account `111007` (monetary, restricted to TRY, statement line `bs.cash`). Every rate and amount is synthetic. Monday 30 November and Thursday 31 December 2026 are publication days.

A `revalue` step for a month already revalued posts the **adjusting revaluation** (S07 rule 15): its entry has the source `revaluation` and the month's last day, like the first one, and its reversal, in the same transaction, the source `reversal` and the next month's first day. A step whose differences are all zero posts nothing and is done (the revaluation is current). The case's clock never moves back: a manual entry dated in November after a revaluation step is posted on the clock of that step (a back-dated posting, S03 rule 6), and a `revalue` of November after December's runs on December's clock.

A `close` step closes a month with a reason (S07 rules 2, 5, 7–9) and a `reopen` step reopens the latest closed month (rule 3); neither posts an entry. A refused close lists its failing checklist items as its detail.

In each case the reversals bring every account and item back to its carrying amount, so `expect.balances` and `expect.open_items` read that state, and `421002` and `541002` net to zero. The arithmetic beside each adjusting line shows the month's net unrealised difference, which equals the difference between the balance's target and its carrying amount.

Shapes:
- **`syp-usd`** is Vertex Media: the back-dated partial payment of S07's acceptance (step 5), corrected closing rates in both ledgers, back-dated postings that leave the revaluation current, and November reopened after December's revaluation.
- **`syp`** has the item settled in full on the last day after the revaluation (S07 edge case 3).
- **`usd-syp`** has a back-dated SYP payment revalued in the USD books, rounded half away from zero.
- **`third`** has a back-dated TRY payment, adjusted in both ledgers.

The cases leave out what other scenarios own:
- the first revaluation of a month and its shapes (`currency/month-end-revaluation.md`);
- the other checklist items, a close refused by `PERIOD_ORDER` or `PERIOD_NOT_ENDED`, and a Hub event held `PERIOD_CLOSED` and retried after a reopen (`periods/close-and-reopen.md`);
- a preview gone stale before posting (`REVALUATION_CHANGED`, S07 rule 17; an API test);
- a back-dated reversal, which is a back-dated posting like any other: the same recomputation.

### Vertex Media: a back-dated partial payment, adjusted in the book ledger; the parallel stays current

S07's acceptance, steps 2–5. November is revalued as in `currency/month-end-revaluation.md` (M-1 at 125, a 5,000.00 SYP gain; the SYP bank at 128, a 234.37 USD loss). Then a payment of 100.00 USD received on 26 November is posted: it clears 100.00 USD of M-1 at its carrying 12,000.00 SYP (the bulletin of the 26th is still 120, so no realised difference) and brings 100.00 USD into the USD bank. Recomputed at 125, M-1 holds 500.00 SYP too much revaluation and the USD bank 500.00 SYP too little: the adjusting book revaluation posts both, gross. The parallel ledger has nothing new in SYP, so it stays current and posts nothing.

```yaml
case: M-1 revalued at 125, then 100.00 USD of it paid on 26 Nov at 120; the adjusting book revaluation posts −500.00 on M-1 and +500.00 on the USD bank, gross; the parallel stays current
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-26, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "125.0000", type: market }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "128.0000", type: market }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: capital paid into the SYP bank account
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "111003", currency: SYP, amount: 125000000 },
                       { account: "311001", currency: SYP, amount: -125000000 }] }
  - revalue: book
    period: 2026-11
  - revalue: parallel
    period: 2026-11
  - manual: 100.00 USD of M-1 received on 26 Nov, posted after the revaluation
    accounting_date: 2026-11-26
    payload: { lines: [{ account: "111004", currency: USD, amount: 10000 },
                       { account: "112001", currency: USD, amount: -10000, item: M-1 }] }
  - revalue: book
    period: 2026-11
  - revalue: parallel
    period: 2026-11
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: manual
      date: 2026-11-03
      lines:
        # parallel: 1,250,000.00 SYP / 125 (market of the 2nd) = 10,000.00 USD
        - { account: "111003", currency: SYP, amount: 125000000, book: 125000000, parallel: 1000000 }
        - { account: "311001", currency: SYP, amount: -125000000, book: -125000000, parallel: -1000000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # M-1: 1,000.00 × 125 = 125,000.00; carrying 120,000.00; difference +5,000.00
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 500000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -500000, book: -500000, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: -500000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 500000, book: 500000, parallel: 0 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # 111003: 1,250,000.00 / 128 = 9,765.625 → 9,765.63 USD; carrying 10,000.00; difference −234.37
        - { account: "111003", currency: SYP, amount: 0, book: 0, parallel: -23437 }
        - { account: "541002", currency: USD, amount: 23437, book: 0, parallel: 23437 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111003", currency: SYP, amount: 0, book: 0, parallel: 23437 }
        - { account: "541002", currency: USD, amount: -23437, book: 0, parallel: -23437 }
    - source: manual
      date: 2026-11-26
      lines:
        # book: 100.00 USD × 120 (bulletin of the 26th) = 12,000.00 SYP received
        - { account: "111004", currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
        # M-1 cleared at its carrying amount: 120,000.00 × 100 / 1,000 = 12,000.00 SYP; no
        #   realised difference (12,000.00 − 12,000.00)
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # M-1: target 900.00 × 125 = 112,500.00; carrying 120,000.00 − 12,000.00 = 108,000.00;
        #   already revalued +5,000.00; difference 112,500.00 − 108,000.00 − 5,000.00 = −500.00
        #   (November's net on M-1: +4,500.00 = 112,500.00 − 108,000.00)
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: -50000, parallel: 0 }
        - { account: "541002", currency: SYP, amount: 50000, book: 50000, parallel: 0 }
        # 111004: target 100.00 × 125 = 12,500.00; carrying 12,000.00; already 0; difference +500.00
        - { account: "111004", currency: USD, amount: 0, book: 50000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -50000, book: -50000, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 50000, parallel: 0 }
        - { account: "541002", currency: SYP, amount: -50000, book: -50000, parallel: 0 }
        - { account: "111004", currency: USD, amount: 0, book: -50000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 50000, book: 50000, parallel: 0 }
    # the second parallel revaluation: 111003 recomputes 976,563 − 1,000,000 − (−23,437) = 0, and
    #   the payment is in the parallel's own currency: current, no entry
  balances:
    - { account: "111004", book: 1200000, parallel: 10000 }
    - { account: "111003", book: 125000000, parallel: 1000000 }
    - { account: "421002", book: 0, parallel: 0 }
    - { account: "541002", book: 0, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 90000, book: 10800000, parallel: 90000 }
```

### Vertex Media: corrected closing rates in both ledgers

After November is revalued, the bulletin of 30 November is corrected from 125 to 124 and the market rate of the 25th (November's newest) from 128 to 127, each with its reason (S02 rule 15). No posted entry converted at either row, so no entry changes; both revaluations are stale (S07 rule 15, owner 2026-11-11). Each adjusting revaluation posts the difference at the corrected rate, gross: the book gain already posted stays and a loss is added, and the parallel loss already posted stays and a gain is added.

```yaml
case: the closing bulletin corrected from 125 to 124 and the market of the 25th from 128 to 127 after the revaluation; the book adjusts M-1 by −1,000.00 SYP, the parallel the SYP bank by +76.89 USD
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "125.0000", type: market }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "128.0000", type: market }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: capital paid into the SYP bank account
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "111003", currency: SYP, amount: 125000000 },
                       { account: "311001", currency: SYP, amount: -125000000 }] }
  - revalue: book
    period: 2026-11
  - revalue: parallel
    period: 2026-11
  - rate: { date: 2026-11-30, base: USD, quote: SYP, rate: "124.0000", type: bulletin,
            reason: "أُدخلت نشرة 30 تشرين الثاني خطأً: السعر المنشور 124" }
  - rate: { date: 2026-11-25, base: USD, quote: SYP, rate: "127.0000", type: market,
            reason: "أُدخل سعر السوق ليوم 25 تشرين الثاني خطأً: السعر الصحيح 127" }
  - revalue: book
    period: 2026-11
  - revalue: parallel
    period: 2026-11
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "111003", currency: SYP, amount: 125000000, book: 125000000, parallel: 1000000 }
        - { account: "311001", currency: SYP, amount: -125000000, book: -125000000, parallel: -1000000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 500000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -500000, book: -500000, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: -500000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 500000, book: 500000, parallel: 0 }
    - source: revaluation
      date: 2026-11-30
      lines:
        - { account: "111003", currency: SYP, amount: 0, book: 0, parallel: -23437 }
        - { account: "541002", currency: USD, amount: 23437, book: 0, parallel: 23437 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111003", currency: SYP, amount: 0, book: 0, parallel: 23437 }
        - { account: "541002", currency: USD, amount: -23437, book: 0, parallel: -23437 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # M-1 at the corrected 124: target 124,000.00; carrying 120,000.00; already +5,000.00;
        #   difference −1,000.00, a loss (November's net: +4,000.00 = 1,000.00 × (124 − 120))
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: -100000, parallel: 0 }
        - { account: "541002", currency: SYP, amount: 100000, book: 100000, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 100000, parallel: 0 }
        - { account: "541002", currency: SYP, amount: -100000, book: -100000, parallel: 0 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # 111003 at the corrected 127: target 1,250,000.00 / 127 = 9,842.5196… → 9,842.52 USD;
        #   carrying 10,000.00; already −234.37; difference 9,842.52 − 10,000.00 + 234.37 = +76.89,
        #   a gain (November's net: −157.48 = 9,842.52 − 10,000.00)
        - { account: "111003", currency: SYP, amount: 0, book: 0, parallel: 7689 }
        - { account: "421002", currency: USD, amount: -7689, book: 0, parallel: -7689 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111003", currency: SYP, amount: 0, book: 0, parallel: -7689 }
        - { account: "421002", currency: USD, amount: 7689, book: 0, parallel: 7689 }
  balances:
    - { account: "111003", book: 125000000, parallel: 1000000 }
    - { account: "421002", book: 0, parallel: 0 }
    - { account: "541002", book: 0, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
```

### Vertex Media: back-dated postings that change no difference

After November is revalued, three postings dated in November arrive: a USD expense paid by the owner on 16 November (both accounts non-monetary), 200.00 USD paid by the owner into the USD bank on 30 November at that day's bulletin of 125, and 128,000.00 SYP paid into the SYP bank on 30 November at the market rate in force, 128 (of the 25th). Recomputed, every difference is zero: the USD bank's carrying amount is already its target in the book, and in the parallel the new SYP converts at the closing rate, so the SYP bank's target, rounded once on the whole balance, still equals its carrying amount less the loss already posted. Neither ledger posts: the revaluation is current (ADR 0016: current means recomputed equal).

```yaml
case: a non-monetary USD expense on 16 Nov, 200.00 USD into the bank on 30 Nov at 125 and 128,000.00 SYP into the bank on 30 Nov at the market 128, all after the revaluation; both ledgers recompute to zero and post nothing
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-16, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "125.0000", type: market }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "128.0000", type: market }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - manual: capital paid into the SYP bank account
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "111003", currency: SYP, amount: 125000000 },
                       { account: "311001", currency: SYP, amount: -125000000 }] }
  - revalue: book
    period: 2026-11
  - revalue: parallel
    period: 2026-11
  - manual: a software subscription paid by the owner on 16 Nov
    accounting_date: 2026-11-16
    payload: { lines: [{ account: "531004", currency: USD, amount: 5000 },
                       { account: "313001", currency: USD, amount: -5000 }] }
  - manual: the owner pays USD into the bank on 30 Nov
    accounting_date: 2026-11-30
    payload: { lines: [{ account: "111004", currency: USD, amount: 20000 },
                       { account: "313001", currency: USD, amount: -20000 }] }
  - manual: the owner pays SYP into the bank on 30 Nov
    accounting_date: 2026-11-30
    payload: { lines: [{ account: "111003", currency: SYP, amount: 12800000 },
                       { account: "313001", currency: SYP, amount: -12800000 }] }
  - revalue: book
    period: 2026-11
  - revalue: parallel
    period: 2026-11
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "111003", currency: SYP, amount: 125000000, book: 125000000, parallel: 1000000 }
        - { account: "311001", currency: SYP, amount: -125000000, book: -125000000, parallel: -1000000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 500000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -500000, book: -500000, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: -500000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 500000, book: 500000, parallel: 0 }
    - source: revaluation
      date: 2026-11-30
      lines:
        - { account: "111003", currency: SYP, amount: 0, book: 0, parallel: -23437 }
        - { account: "541002", currency: USD, amount: 23437, book: 0, parallel: 23437 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111003", currency: SYP, amount: 0, book: 0, parallel: 23437 }
        - { account: "541002", currency: USD, amount: -23437, book: 0, parallel: -23437 }
    - source: manual
      date: 2026-11-16
      lines:
        # 50.00 USD × 121 = 6,050.00 SYP; 531004 and 313001 are non-monetary
        - { account: "531004", currency: USD, amount: 5000, book: 605000, parallel: 5000 }
        - { account: "313001", currency: USD, amount: -5000, book: -605000, parallel: -5000 }
    - source: manual
      date: 2026-11-30
      lines:
        # 200.00 USD × 125 = 25,000.00 SYP, already the book's target for this balance
        - { account: "111004", currency: USD, amount: 20000, book: 2500000, parallel: 20000 }
        - { account: "313001", currency: USD, amount: -20000, book: -2500000, parallel: -20000 }
    - source: manual
      date: 2026-11-30
      lines:
        # parallel: 128,000.00 SYP / 128 (market in force, of the 25th) = 1,000.00 USD
        - { account: "111003", currency: SYP, amount: 12800000, book: 12800000, parallel: 100000 }
        - { account: "313001", currency: SYP, amount: -12800000, book: -12800000, parallel: -100000 }
    # book: M-1 125,000.00 − 120,000.00 − 5,000.00 = 0; 111004 25,000.00 − 25,000.00 − 0 = 0
    # parallel: 111003 target 1,378,000.00 / 128 = 10,765.625 → 10,765.63 USD; carrying
    #   10,000.00 + 1,000.00 = 11,000.00; already −234.37; 10,765.63 − 11,000.00 + 234.37 = 0
    # every difference is zero: no adjusting entry in either ledger
  balances:
    - { account: "111003", book: 137800000, parallel: 1100000 }
    - { account: "111004", book: 2500000, parallel: 20000 }
    - { account: "421002", book: 0, parallel: 0 }
    - { account: "541002", book: 0, parallel: 0 }
```

### SYP books only: an item settled in full on the last day after the revaluation

S07 edge case 3. M-1 (1,000.00 USD at 120) is revalued at 125. Then its full payment, received on 30 November at that day's bulletin of 125, is posted: it clears M-1 at its carrying 120,000.00 SYP and realises 5,000.00 SYP (IAS 21.28). M-1 now holds no transaction amount and no carrying amount, but the revaluation still holds 5,000.00 on it: its difference is −(already revalued), and the adjusting revaluation takes it back, so November shows the 5,000.00 SYP movement once, as realised. The USD bank received at 125 is already at its target.

```yaml
case: SYP books only; M-1 revalued at 125 (+5,000.00), then paid in full on 30 Nov at 125 (realised +5,000.00); the adjusting revaluation takes the 5,000.00 unrealised back
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - revalue: book
    period: 2026-11
  - manual: M-1 received in full on 30 Nov, posted after the revaluation
    accounting_date: 2026-11-30
    payload: { lines: [{ account: "111004", currency: USD, amount: 100000 },
                       { account: "112001", currency: USD, amount: -100000, item: M-1 }] }
  - revalue: book
    period: 2026-11
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # 1,000.00 × 125 = 125,000.00; carrying 120,000.00; difference +5,000.00
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 500000 }
        - { account: "421002", currency: SYP, amount: -500000, book: -500000 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: -500000 }
        - { account: "421002", currency: SYP, amount: 500000, book: 500000 }
    - source: manual
      date: 2026-11-30
      lines:
        # 1,000.00 USD × 125 = 125,000.00 SYP received
        - { account: "111004", currency: USD, amount: 100000, book: 12500000 }
        # M-1 cleared at its carrying amount, 120,000.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000 }
        # realised gain 12,500,000 − 12,000,000 = 500,000 → 5,000.00 SYP
        - { account: "421001", currency: SYP, amount: -500000, book: -500000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # M-1: target 0; carrying 0; already +5,000.00; difference −5,000.00 (November: realised
        #   +5,000.00, unrealised +5,000.00 − 5,000.00 = 0)
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: -500000 }
        - { account: "541002", currency: SYP, amount: 500000, book: 500000 }
        # 111004: target 1,000.00 × 125 = 125,000.00 = its carrying amount: nothing
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 500000 }
        - { account: "541002", currency: SYP, amount: -500000, book: -500000 }
  balances:
    - { account: "112001", book: 0 }
    - { account: "111004", book: 12500000 }
    - { account: "421001", book: -500000 }
    - { account: "421002", book: 0 }
    - { account: "541002", book: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0 }
```

### USD books with an SYP parallel ledger: a back-dated SYP payment, rounded half away from zero

The USD book ledger revalues the SYP bank balance (24,000.00 SYP at 120) at the bulletin of 125, an 8.00 USD loss. Then an SYP expense of 6,000.00 paid from the bank on 26 November is posted at that day's bulletin of 122 (49.1803… → 49.18 USD). Recomputed, the remaining 18,000.00 SYP is worth 144.00 USD against a carrying 150.82 USD, less the 8.00 already posted: the adjustment is a 1.18 USD gain. The SYP parallel ledger holds no USD balance, so it has nothing to revalue.

```yaml
case: USD books; 24,000.00 SYP revalued at 125 (−8.00 USD), then 6,000.00 SYP paid out on 26 Nov at 122 (49.18 USD); the adjusting book revaluation posts +1.18 USD
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-26, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - manual: capital paid into the SYP bank account
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "111003", currency: SYP, amount: 2400000 },
                       { account: "311001", currency: SYP, amount: -2400000 }] }
  - revalue: book
    period: 2026-11
  - manual: a software subscription paid from the SYP bank on 26 Nov, posted after the revaluation
    accounting_date: 2026-11-26
    payload: { lines: [{ account: "531004", currency: SYP, amount: 600000 },
                       { account: "111003", currency: SYP, amount: -600000 }] }
  - revalue: book
    period: 2026-11
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        # book: 24,000.00 SYP / 120 = 200.00 USD
        - { account: "111003", currency: SYP, amount: 2400000, book: 20000, parallel: 2400000 }
        - { account: "311001", currency: SYP, amount: -2400000, book: -20000, parallel: -2400000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # 24,000.00 / 125 = 192.00 USD; carrying 200.00; difference −8.00
        - { account: "111003", currency: SYP, amount: 0, book: -800, parallel: 0 }
        - { account: "541002", currency: USD, amount: 800, book: 800, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111003", currency: SYP, amount: 0, book: 800, parallel: 0 }
        - { account: "541002", currency: USD, amount: -800, book: -800, parallel: 0 }
    - source: manual
      date: 2026-11-26
      lines:
        # book: 6,000.00 SYP / 122 = 49.1803… → 49.18 USD
        - { account: "531004", currency: SYP, amount: 600000, book: 4918, parallel: 600000 }
        - { account: "111003", currency: SYP, amount: -600000, book: -4918, parallel: -600000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # 111003: target 18,000.00 / 125 = 144.00 USD; carrying 200.00 − 49.18 = 150.82; already
        #   −8.00; difference 144.00 − 150.82 + 8.00 = +1.18, a gain (November's net: −6.82 =
        #   144.00 − 150.82)
        - { account: "111003", currency: SYP, amount: 0, book: 118, parallel: 0 }
        - { account: "421002", currency: USD, amount: -118, book: -118, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111003", currency: SYP, amount: 0, book: -118, parallel: 0 }
        - { account: "421002", currency: USD, amount: 118, book: 118, parallel: 0 }
  balances:
    - { account: "111003", book: 15082, parallel: 1800000 }
    - { account: "421002", book: 0, parallel: 0 }
    - { account: "541002", book: 0, parallel: 0 }
```

### A third currency: a back-dated TRY payment, adjusted in both ledgers

The TRY cash (2,000.00 TRY) is revalued as in `currency/month-end-revaluation.md`: in the SYP book through the cross 125 / 42 (+1.16 SYP), in the USD parallel at the market 42.5 of the 27th (−1.48 USD). Then a repair of 500.00 TRY paid from the cash on 26 November is posted: in the book through that day's cross 123 / 41.5, in the parallel at the market in force on the 26th, 41.2 (of the 10th; the 27th's is later). Each ledger recomputes the remaining 1,500.00 TRY and adjusts.

```yaml
case: TRY cash revalued in both ledgers, then 500.00 TRY paid out on 26 Nov; the book adjusts by −6.16 SYP through the cross, the parallel by +0.37 USD at the market
company: { shape: third, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "111007", name: "الصندوق — ليرة تركية", name_latin: "Cash on hand — TRY",
                        currency: TRY, monetary: true, statement_line: bs.cash }] }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.2000", type: market }
  - { date: 2026-11-26, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-26, base: USD, quote: TRY, rate: "41.5000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: TRY, rate: "42.0000", type: bulletin }
  - { date: 2026-11-27, base: USD, quote: TRY, rate: "42.5000", type: market }
steps:
  - manual: the owner pays TRY into the cash box
    accounting_date: 2026-11-10
    payload: { lines: [{ account: "111007", currency: TRY, amount: 200000 },
                       { account: "313001", currency: TRY, amount: -200000 }] }
  - revalue: book
    period: 2026-11
  - revalue: parallel
    period: 2026-11
  - manual: a repair paid in TRY on 26 Nov, posted after the revaluation
    accounting_date: 2026-11-26
    payload: { lines: [{ account: "531006", currency: TRY, amount: 50000 },
                       { account: "111007", currency: TRY, amount: -50000 }] }
  - revalue: book
    period: 2026-11
  - revalue: parallel
    period: 2026-11
expect:
  entries:
    - source: manual
      date: 2026-11-10
      lines:
        # book: 2,000.00 TRY / 41 × 122 = 5,951.2195… → 5,951.22 SYP
        # parallel: 2,000.00 TRY / 41.2 = 48.5436… → 48.54 USD
        - { account: "111007", currency: TRY, amount: 200000, book: 595122, parallel: 4854 }
        - { account: "313001", currency: TRY, amount: -200000, book: -595122, parallel: -4854 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # 2,000.00 / 42 × 125 = 5,952.3809… → 5,952.38 SYP; carrying 5,951.22; difference +1.16
        - { account: "111007", currency: TRY, amount: 0, book: 116, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -116, book: -116, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111007", currency: TRY, amount: 0, book: -116, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 116, book: 116, parallel: 0 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # 2,000.00 / 42.5 = 47.0588… → 47.06 USD; carrying 48.54; difference −1.48
        - { account: "111007", currency: TRY, amount: 0, book: 0, parallel: -148 }
        - { account: "541002", currency: USD, amount: 148, book: 0, parallel: 148 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111007", currency: TRY, amount: 0, book: 0, parallel: 148 }
        - { account: "541002", currency: USD, amount: -148, book: 0, parallel: -148 }
    - source: manual
      date: 2026-11-26
      lines:
        # book: 500.00 TRY / 41.5 × 123 = 1,481.9277… → 1,481.93 SYP
        # parallel: 500.00 TRY / 41.2 = 12.1359… → 12.14 USD
        - { account: "531006", currency: TRY, amount: 50000, book: 148193, parallel: 1214 }
        - { account: "111007", currency: TRY, amount: -50000, book: -148193, parallel: -1214 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # 111007: target 1,500.00 / 42 × 125 = 4,464.2857… → 4,464.29 SYP; carrying 5,951.22 −
        #   1,481.93 = 4,469.29; already +1.16; difference 4,464.29 − 4,469.29 − 1.16 = −6.16, a
        #   loss (November's net: −5.00 = 4,464.29 − 4,469.29)
        - { account: "111007", currency: TRY, amount: 0, book: -616, parallel: 0 }
        - { account: "541002", currency: SYP, amount: 616, book: 616, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111007", currency: TRY, amount: 0, book: 616, parallel: 0 }
        - { account: "541002", currency: SYP, amount: -616, book: -616, parallel: 0 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # 111007: target 1,500.00 / 42.5 = 35.2941… → 35.29 USD; carrying 48.54 − 12.14 = 36.40;
        #   already −1.48; difference 35.29 − 36.40 + 1.48 = +0.37, a gain (November's net: −1.11
        #   = 35.29 − 36.40)
        - { account: "111007", currency: TRY, amount: 0, book: 0, parallel: 37 }
        - { account: "421002", currency: USD, amount: -37, book: 0, parallel: -37 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111007", currency: TRY, amount: 0, book: 0, parallel: -37 }
        - { account: "421002", currency: USD, amount: 37, book: 0, parallel: 37 }
  balances:
    - { account: "111007", book: 446929, parallel: 3640 }
    - { account: "421002", book: 0, parallel: 0 }
    - { account: "541002", book: 0, parallel: 0 }
```

### Vertex Media: November reopened after December's revaluation, both months adjusted

S07 edge cases 9 and 10. November is revalued (M-1 at 125) and closed; December is revalued (M-1 at 127). A payment of 400.00 USD received on 26 November arrives late: November is reopened with a reason (it is the latest closed month) and the payment posts into it. Both months are open and their revaluations are stale, since the payment is dated on or before each month end: the re-close is refused `CHECKLIST_FAILED` on `revaluation_current` (S07 rule 8; every other item passes: the bulletin of each November publication day is recorded). November's adjustment uses 125 and December's 127, each from the carrying amounts, which exclude every revaluation: December's carrying amount does not include November's adjustment, reversed on 1 December. November is closed again. Then the bulletin of 30 November is corrected: the row is recorded (S02 rule 18), November's revaluation is refused `PERIOD_CLOSED` (rule 16), and December, whose balances no line converts at that row, stays current.

```yaml
case: November revalued and closed, December revalued; November reopened for 400.00 USD of M-1 received on 26 Nov; the re-close refused until November is adjusted at 125 (±2,000.00) and December at 127 (±2,800.00); a later correction of 30 Nov's bulletin changes nothing
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  # the bulletin of every November publication day (Fridays and Saturdays are days off)
  - { date: 2026-11-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-04, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-09, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-11, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-12, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-16, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-17, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-18, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-22, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-23, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-24, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-26, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-29, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "127.0000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - revalue: book
    period: 2026-11
  - close: 2026-11
    reason: "إقفال تشرين الثاني بعد إعادة التقييم"
  - revalue: book
    period: 2026-12
  - reopen: 2026-11
    reason: "دفعة من العميل C1 مؤرخة في 26 تشرين الثاني وصل إشعارها بعد الإقفال"
  - manual: 400.00 USD of M-1 received on 26 Nov
    accounting_date: 2026-11-26
    payload: { lines: [{ account: "111004", currency: USD, amount: 40000 },
                       { account: "112001", currency: USD, amount: -40000, item: M-1 }] }
  - close: 2026-11
    reason: "إعادة إقفال تشرين الثاني"
    outcome: { status: refused, reason: CHECKLIST_FAILED, detail: revaluation_current }
  - revalue: book
    period: 2026-11
  - revalue: book
    period: 2026-12
  - close: 2026-11
    reason: "إعادة إقفال تشرين الثاني بعد قيد التسوية"
  - rate: { date: 2026-11-30, base: USD, quote: SYP, rate: "124.0000", type: bulletin,
            reason: "صُحّحت نشرة 30 تشرين الثاني بعد الإقفال" }
  - revalue: book
    period: 2026-11
    outcome: { status: refused, reason: PERIOD_CLOSED }
  - revalue: book
    period: 2026-12
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # 1,000.00 × 125 = 125,000.00; carrying 120,000.00; difference +5,000.00
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 500000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -500000, book: -500000, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: -500000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 500000, book: 500000, parallel: 0 }
    - source: revaluation
      date: 2026-12-31
      lines:
        # 1,000.00 × 127 = 127,000.00; carrying 120,000.00 (November's revaluation reversed);
        #   already revalued on 31 Dec: 0; difference +7,000.00
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 700000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -700000, book: -700000, parallel: 0 }
    - source: reversal
      date: 2027-01-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: -700000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 700000, book: 700000, parallel: 0 }
    - source: manual
      date: 2026-11-26
      lines:
        # 400.00 USD × 120 = 48,000.00 SYP received; M-1 cleared at 120,000.00 × 400 / 1,000 =
        #   48,000.00; no realised difference
        - { account: "111004", currency: USD, amount: 40000, book: 4800000, parallel: 40000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # M-1: target 600.00 × 125 = 75,000.00; carrying 72,000.00; already +5,000.00; difference
        #   −2,000.00 (November's net on M-1: +3,000.00)
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: -200000, parallel: 0 }
        - { account: "541002", currency: SYP, amount: 200000, book: 200000, parallel: 0 }
        # 111004: target 400.00 × 125 = 50,000.00; carrying 48,000.00; already 0; difference +2,000.00
        - { account: "111004", currency: USD, amount: 0, book: 200000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -200000, book: -200000, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 200000, parallel: 0 }
        - { account: "541002", currency: SYP, amount: -200000, book: -200000, parallel: 0 }
        - { account: "111004", currency: USD, amount: 0, book: -200000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 200000, book: 200000, parallel: 0 }
    - source: revaluation
      date: 2026-12-31
      lines:
        # M-1: target 600.00 × 127 = 76,200.00; carrying 72,000.00 (November's revaluations
        #   reversed); already revalued on 31 Dec +7,000.00; difference −2,800.00
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: -280000, parallel: 0 }
        - { account: "541002", currency: SYP, amount: 280000, book: 280000, parallel: 0 }
        # 111004: target 400.00 × 127 = 50,800.00; carrying 48,000.00; already 0; difference +2,800.00
        - { account: "111004", currency: USD, amount: 0, book: 280000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -280000, book: -280000, parallel: 0 }
    - source: reversal
      date: 2027-01-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 280000, parallel: 0 }
        - { account: "541002", currency: SYP, amount: -280000, book: -280000, parallel: 0 }
        - { account: "111004", currency: USD, amount: 0, book: -280000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 280000, book: 280000, parallel: 0 }
    # after the correction: November is closed and keeps its revaluation; December recomputes
    #   M-1 76,200.00 − 72,000.00 − 4,200.00 = 0 and 111004 50,800.00 − 48,000.00 − 2,800.00 = 0
    #   (no line converts at 30 Nov's row): current, no entry
  balances:
    - { account: "111004", book: 4800000, parallel: 40000 }
    - { account: "421002", book: 0, parallel: 0 }
    - { account: "541002", book: 0, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 60000, book: 7200000, parallel: 60000 }
```
