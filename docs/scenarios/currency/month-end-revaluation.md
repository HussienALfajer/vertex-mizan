# The month-end revaluation of each ledger

Status: Approved (owner, 2026-11-11)

S07 wrote these cases (S07 "Scenarios"); the owner approved their expected entries and outcomes on 2026-11-11, with the project-expense clearing account `211002` revalued as Hub posts it, without dimensions, so one balance per currency (S05's posting rule, `expenses/project-expense.md`, is unchanged). S07's feature slice (PR 1) brought the `revalue` and `block` executors; no expected value changed.

## Rule

At the end of each month, each ledger revalues its monetary balances in currencies other than its own at its policy rate in force on the month's last day: every open item of a monetary control account on its own, and every other monetary balance per account, dimension set and currency. For each balance, the target is its transaction balance converted once at the closing rate, rounded half away from zero; the difference from its carrying amount (and from what a revaluation of the same month end already posted) posts as two lines in that ledger only: on the balance, with a transaction amount of zero, and on unrealised exchange gains `421002` or losses `541002`, never netted. The entry is dated on the month's last day and is reversed exactly on the next month's first day, so the carrying amount a later settlement clears never includes a revaluation, and the settlement realises the whole movement from the original measurement. Non-monetary balances are never revalued; a balance with no transaction amount but an amount in the ledger is brought to zero; a blocked account is revalued. A missing closing rate refuses that ledger's revaluation (`RATE_MISSING`); a month whose differences are all zero posts nothing.

## Basis

- **IAS 21.23(a):** at the end of each reporting period, foreign-currency monetary items are translated at the closing rate. **IAS 21.23(b):** non-monetary items measured at historical cost (contract liabilities, prepayments, equity) keep the rate of the transaction date. **IAS 21.16:** monetary items are units of currency held and assets and liabilities to be received or paid in a fixed number of units of currency, so cash, receivables, contract assets (an unconditional right but for the passage of time and the invoice), client ad funds held, payables and the project-expense clearing account are monetary.
- **IAS 21.28:** exchange differences on the translation of monetary items at rates different from those at which they were last translated are recognised in profit or loss of the period. **IAS 21.28 and ADR 0013:** a settlement after the revaluation's reversal realises the difference from the original measurement. **IAS 1.32 and 1.35:** gains and losses are posted gross; S09 may present them net.
- **Company policy:** `phase-1-scope.md` §4 "Month-end revaluation" (each ledger at its own policy rate; each entry reverses on the first day of the next month); ADR 0007 "Revaluation" (per open item for control accounts, per account and currency otherwise; each entry in its own ledger only; the monetary flag decides); ADR 0016 (owner, 2026-11-11: per account, dimension set and currency outside control accounts; a zero transaction balance with a ledger residual brought to zero; the closing rate; blocked accounts and archived dimension values revalued; open-item balances keep the carrying amount and the revaluations apart); S07 rules 10–18 and "Accounting treatment" (owner, 2026-11-11: two lines per balance, without netting; the market rate as the newest on or before the last day).
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting. No other Syrian rule is relied on; IAS 29 is out of scope.

## Cases

The account codes are the service-agency template's (S02): the USD cash on hand `111002`, the SYP and USD bank accounts `111003` and `111004`, the USD e-wallet `111006`, trade receivables `112001` and contract assets `113001` (document control accounts), ad platforms payable `211001` (client required), project expenses awaiting payment source `211002`, other payables `211003`, contract liabilities `212001` (non-monetary), client ad funds held `213001` (a running control account, USD only), capital `311001` and the owner's current account `313001` (non-monetary), service revenue `411001`, realised exchange gains `421001`, unrealised exchange gains `421002` and losses `541002`. A `third` case adds a TRY cash account `111007` (monetary, restricted to TRY, statement line `bs.cash`). Every rate and amount is synthetic. Saturday 31 October 2026 is a day off, whose bulletin is Thursday 29 October's; Monday 30 November and Thursday 31 December 2026 are publication days.

A `revalue` step is the accountant's posting of one ledger's revaluation of a month from the preview (S07 rules 16–18), once the month has ended: the case's clock moves to the first day of the next month, as a `job` step's does. Its entry has the source `revaluation` and the month's last day; its reversal, posted in the same transaction, is read as `reversal` with the next month's first day. A step that finds every difference zero posts nothing and is done (`posted: false`). A `block` step blocks an account with a reason, as the chart's screen does (S02 rule 5).

A revaluation line carries its amount in its own ledger only (ADR 0007): on the balance, in the balance's currency with a transaction amount of zero and the other ledger zero; on `421002` or `541002`, in the ledger's currency, without dimensions. A line on an open item carries the item's dimensions. The difference is `target − carrying − already revalued`; *already revalued* is zero in these cases, since each month is revalued once (`currency/stale-revaluation.md` holds the adjusting revaluations). A balance's carrying amount excludes revaluations (S07 rule 10), so after the reversal every account and item is back at what it carried, and `expect.balances` and `expect.open_items` read that state; `421002` and `541002` net to zero over the two months.

Shapes:
- **`syp-usd`** is Vertex Media: the book ledger revalues USD balances at the bulletin, the parallel ledger SYP balances at the market rate. Most cases are in it.
- **`syp`** has one case: the book ledger alone, at a month end that is a day off.
- **`usd-syp`** has one case: the USD book revalues an SYP balance at the bulletin, the SYP parallel a USD item at the market rate.
- **`third`** has one case: TRY balances in both ledgers, the book through the cross with USD, the parallel at the direct market rate.

The cases leave out what other scenarios own:
- a revaluation made stale by a back-dated posting, a reopen or a corrected closing rate, and its adjusting revaluation (`currency/stale-revaluation.md`);
- the checklist's `revaluation_current` and `closing_rates_recorded`, and a revaluation refused in a closed month (`periods/close-and-reopen.md`);
- an item opened and settled within the month, which holds nothing to revalue (S04 invariant 9; a property test of S07);
- an archived dimension value, revalued like a blocked account (S07 rule 10; an API test, since a case cannot archive a value yet);
- the preview's fingerprint, `REVALUATION_CHANGED` and a double submit (S07 rule 17; API tests);
- the hand reversal of a revaluation entry, refused `ENTRY_NOT_REVERSIBLE` (S03 rule 9; an API test).

### Vertex Media: a USD receivable and an SYP bank balance, then a payment after the reversal

S07's acceptance, steps 2–4 and 8. Invoice M-1 (1,000.00 USD) is measured at the bulletin of 120; the bulletin of 30 November is 125, so the book ledger shows a 5,000.00 SYP unrealised gain. The SYP bank balance (1,250,000.00 SYP) is measured at the market rate of 125; the newest market rate on 30 November is 128 (of the 25th), so the parallel ledger shows a 234.37 USD unrealised loss. Both reverse on 1 December. The payment on 10 December at 126 clears M-1 at its carrying 120,000.00 SYP and realises 6,000.00 SYP: November showed 5,000.00 unrealised, December's reversal takes it back.

```yaml
case: M-1 (1,000.00 USD at 120) revalued at 125, a 5,000.00 SYP gain; 1,250,000.00 SYP at 125 revalued at 128, a 234.37 USD loss; reversed on 1 Dec; M-1 paid on 10 Dec at 126 realises 6,000.00 SYP
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "126.0000", type: bulletin }
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
  - manual: M-1 received in full in USD
    accounting_date: 2026-12-10
    payload: { lines: [{ account: "111004", currency: USD, amount: 100000 },
                       { account: "112001", currency: USD, amount: -100000, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        # book: 1,000.00 USD × 120 = 120,000.00 SYP; parallel: USD as is
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: manual
      date: 2026-11-03
      lines:
        # parallel: 1,250,000.00 SYP / 125 (market of the 2nd) = 10,000.00 USD; book: SYP as is
        - { account: "111003", currency: SYP, amount: 125000000, book: 125000000, parallel: 1000000 }
        - { account: "311001", currency: SYP, amount: -125000000, book: -125000000, parallel: -1000000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # M-1: target 1,000.00 × 125 = 125,000.00 SYP; carrying 120,000.00; difference +5,000.00
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 500000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -500000, book: -500000, parallel: 0 }
        # 111003 is in the book's own currency and 411001, 311001 are non-monetary: nothing else
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: -500000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 500000, book: 500000, parallel: 0 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # 111003: target 1,250,000.00 / 128 (market of the 25th, the newest on or before the 30th)
        #   = 9,765.625 → 9,765.63 USD (half away from zero); carrying 10,000.00; difference −234.37
        - { account: "111003", currency: SYP, amount: 0, book: 0, parallel: -23437 }
        - { account: "541002", currency: USD, amount: 23437, book: 0, parallel: 23437 }
        # M-1 is in the parallel's own currency: nothing
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111003", currency: SYP, amount: 0, book: 0, parallel: 23437 }
        - { account: "541002", currency: USD, amount: -23437, book: 0, parallel: -23437 }
    - source: manual
      date: 2026-12-10
      lines:
        # book: 1,000.00 USD × 126 = 126,000.00 SYP received
        - { account: "111004", currency: USD, amount: 100000, book: 12600000, parallel: 100000 }
        # M-1 cleared at its carrying amount, 120,000.00 SYP: the revaluation is not part of it
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
        # book residual: 12,600,000 − 12,000,000 = 600,000 → realised gain 6,000.00 SYP
        - { account: "421001", currency: SYP, amount: -600000, book: -600000, parallel: 0 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "111003", book: 125000000, parallel: 1000000 }
    - { account: "421001", book: -600000, parallel: 0 }
    - { account: "421002", book: 0, parallel: 0 }
    - { account: "541002", book: 0, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: USD cash spent to zero with a book residual, a blocked e-wallet, and December over the year end

The owner pays 100.00 USD into the cash box and 200.00 USD into the e-wallet at 120. The cash is spent on 25 November at 123, so the cash account holds no USD but a book credit of 300.00 SYP (each line converts at its own date's bulletin; a plain account has no carrying amount to clear). The month end brings it to zero (S07 rule 10); the residual returns on 1 December with the reversal and is brought to zero again at the end of December, while it stands (S07 edge case 2). The e-wallet is blocked on 20 November and is still revalued (owner, 2026-11-11). The owner's current account is equity, non-monetary. December's reversal on 1 January 2027 is numbered in fiscal year 2027 (ADR 0012).

```yaml
case: USD cash at zero with a −300.00 SYP residual brought to zero at each month end; a blocked USD e-wallet revalued at 125 and 126; the December reversal on 1 Jan 2027
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "126.0000", type: bulletin }
steps:
  - manual: the owner pays USD into the cash box and the e-wallet
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "111002", currency: USD, amount: 10000 },
                       { account: "111006", currency: USD, amount: 20000 },
                       { account: "313001", currency: USD, amount: -30000 }] }
  - manual: a software subscription paid from the USD cash
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "531004", currency: USD, amount: 10000 },
                       { account: "111002", currency: USD, amount: -10000 }] }
  - block: "111006"
    reason: "أوقف مزود المحفظة الإلكترونية الحساب وجمّد رصيده"
  - revalue: book
    period: 2026-11
  - revalue: book
    period: 2026-12
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        # 100.00 USD × 120 = 12,000.00 SYP; 200.00 USD × 120 = 24,000.00 SYP
        - { account: "111002", currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
        - { account: "111006", currency: USD, amount: 20000, book: 2400000, parallel: 20000 }
        - { account: "313001", currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: manual
      date: 2026-11-25
      lines:
        # 100.00 USD × 123 = 12,300.00 SYP on both lines
        - { account: "531004", currency: USD, amount: 10000, book: 1230000, parallel: 10000 }
        - { account: "111002", currency: USD, amount: -10000, book: -1230000, parallel: -10000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # 111002: transaction 0, carrying 1,200,000 − 1,230,000 = −30,000; target 0; difference +300.00
        - { account: "111002", currency: USD, amount: 0, book: 30000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -30000, book: -30000, parallel: 0 }
        # 111006 (blocked): target 200.00 × 125 = 25,000.00; carrying 24,000.00; difference +1,000.00
        - { account: "111006", currency: USD, amount: 0, book: 100000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -100000, book: -100000, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111002", currency: USD, amount: 0, book: -30000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 30000, book: 30000, parallel: 0 }
        - { account: "111006", currency: USD, amount: 0, book: -100000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 100000, book: 100000, parallel: 0 }
    - source: revaluation
      date: 2026-12-31
      lines:
        # 111002: the residual stands again after the reversal: −30,000 → 0, difference +300.00
        - { account: "111002", currency: USD, amount: 0, book: 30000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -30000, book: -30000, parallel: 0 }
        # 111006: target 200.00 × 126 = 25,200.00; carrying 24,000.00 (November's revaluation
        #   excluded, reversed); difference +1,200.00
        - { account: "111006", currency: USD, amount: 0, book: 120000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -120000, book: -120000, parallel: 0 }
    - source: reversal
      date: 2027-01-01
      lines:
        - { account: "111002", currency: USD, amount: 0, book: -30000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 30000, book: 30000, parallel: 0 }
        - { account: "111006", currency: USD, amount: 0, book: -120000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 120000, book: 120000, parallel: 0 }
  balances:
    # after the January reversal, the residual stands until the next month end
    - { account: "111002", currency: USD, amount: 0, book: -30000, parallel: 0 }
    - { account: "111006", book: 2400000, parallel: 20000 }
    - { account: "313001", book: -3600000, parallel: -30000 }
    - { account: "421002", book: 0, parallel: 0 }
```

### Vertex Media: a month with nothing to revalue

The bulletin of 30 November equals the one M-1 was measured at, and no market rate was recorded after the one the SYP balance was measured at: every difference is zero, so neither ledger posts (S07 rules 12, 17: `posted: false`). The revaluation is current with no entry (rule 15).

```yaml
case: the bulletin still 120 and the market still 125 on 30 Nov; neither ledger posts
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "125.0000", type: market }
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
    # book: M-1's target 1,000.00 × 120 = 120,000.00 = its carrying amount; parallel: 1,250,000.00
    # / 125 = 10,000.00 USD = the carrying amount; no entry
  balances:
    - { account: "421002", book: 0, parallel: 0 }
    - { account: "541002", book: 0, parallel: 0 }
```

### Vertex Media: a closing bulletin missing

Monday 30 November is a publication day without its bulletin, so the book ledger's revaluation is refused `RATE_MISSING` (S07 rule 11; Thursday's bulletin is not in force on a publication day, S02 rule 16). The parallel ledger posts on its own action (rule 18). Once the bulletin is recorded, the book ledger posts, with the figures of the first case.

```yaml
case: the bulletin of Monday 30 Nov missing; the book revaluation refused RATE_MISSING, the parallel posts; the bulletin recorded, the book posts its 5,000.00 SYP gain
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-26, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
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
    # Monday 30 Nov is a publication day: Thursday's 124 is not in force on it
    outcome: { status: refused, reason: RATE_MISSING }
  - revalue: parallel
    period: 2026-11
  - rate: { date: 2026-11-30, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - revalue: book
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
        # 1,250,000.00 / 128 = 9,765.625 → 9,765.63 USD; difference −234.37
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
        # 1,000.00 × 125 = 125,000.00; carrying 120,000.00; difference +5,000.00
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 500000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -500000, book: -500000, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: -500000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 500000, book: 500000, parallel: 0 }
```

### SYP books only, at a month end that is a day off

Saturday 31 October has no bulletin, so the closing rate is the bulletin of the last publication day, Thursday 29 October (S02 rule 16, S07 rule 11). The conversion ends in half a minor unit, rounded away from zero. The reversal is dated Sunday 1 November and reads no rate.

```yaml
case: SYP books only; M-1 (250.25 USD at 118) revalued on Saturday 31 Oct at Thursday's 119.5 (2,990,487.5 → 2,990,488), a 375.38 SYP gain
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
rates:
  - { date: 2026-10-01, base: USD, quote: SYP, rate: "118.0000", type: bulletin }
  - { date: 2026-10-29, base: USD, quote: SYP, rate: "119.5000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1
    accounting_date: 2026-10-01
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 25025,
                         open_item: { ref: M-1, due: 2026-10-31 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -25025 }] }
  - revalue: book
    period: 2026-10
expect:
  entries:
    - source: manual
      date: 2026-10-01
      lines:
        # 250.25 USD × 118 = 29,529.50 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 25025, book: 2952950 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -25025, book: -2952950 }
    - source: revaluation
      date: 2026-10-31
      lines:
        # target 250.25 × 119.5 = 29,904.875 SYP → 2,990,487.5 minor → 2,990,488; carrying
        #   2,952,950; difference +37,538, a gain of 375.38 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 37538 }
        - { account: "421002", currency: SYP, amount: -37538, book: -37538 }
    - source: reversal
      date: 2026-11-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: -37538 }
        - { account: "421002", currency: SYP, amount: 37538, book: 37538 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 25025, book: 2952950 }
```

### USD books with an SYP parallel ledger

The USD book ledger revalues the SYP bank balance at the bulletin; the SYP parallel ledger revalues the USD invoice M-1 at the market rate (S07 "Currencies, rates and rounding").

```yaml
case: USD books; 24,000.00 SYP at 120 revalued at the bulletin 125, an 8.00 USD book loss; M-1 (100.00 USD at the market 122) revalued at 127, a 500.00 SYP parallel gain
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "122.0000", type: market }
  - { date: 2026-11-26, base: USD, quote: SYP, rate: "127.0000", type: market }
steps:
  - manual: capital paid into the SYP bank account
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "111003", currency: SYP, amount: 2400000 },
                       { account: "311001", currency: SYP, amount: -2400000 }] }
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 10000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -10000 }] }
  - revalue: book
    period: 2026-11
  - revalue: parallel
    period: 2026-11
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        # book: 24,000.00 SYP / 120 = 200.00 USD; parallel: SYP as is
        - { account: "111003", currency: SYP, amount: 2400000, book: 20000, parallel: 2400000 }
        - { account: "311001", currency: SYP, amount: -2400000, book: -20000, parallel: -2400000 }
    - source: manual
      date: 2026-11-03
      lines:
        # book: USD as is; parallel: 100.00 USD × 122 (market) = 12,200.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 10000, parallel: 1220000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -10000, book: -10000, parallel: -1220000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # 111003: target 24,000.00 / 125 = 192.00 USD; carrying 200.00; difference −8.00, a loss
        - { account: "111003", currency: SYP, amount: 0, book: -800, parallel: 0 }
        - { account: "541002", currency: USD, amount: 800, book: 800, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111003", currency: SYP, amount: 0, book: 800, parallel: 0 }
        - { account: "541002", currency: USD, amount: -800, book: -800, parallel: 0 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # M-1: target 100.00 × 127 = 12,700.00 SYP; carrying 12,200.00; difference +500.00, a gain
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 50000 }
        - { account: "421002", currency: SYP, amount: -50000, book: 0, parallel: -50000 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: -50000 }
        - { account: "421002", currency: SYP, amount: 50000, book: 0, parallel: 50000 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 10000, parallel: 1220000 }
```

### A third currency: TRY cash and a TRY payable in both ledgers

The book ledger has no direct TRY–SYP bulletin, so it crosses through USD (TRY→USD at the USD/TRY bulletin, then USD→SYP at the USD/SYP bulletin, one exact product rounded once; ADR 0007). The USD parallel ledger takes the direct USD/TRY market rate, the newest on or before the 30th (of the 27th). Each TRY balance is revalued in each ledger, with its own lines.

```yaml
case: TRY cash (2,000.00) and a TRY payable (4,100.00) revalued in the SYP book through the cross 125 / 42 and in the USD parallel at the market 42.5
company: { shape: third, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "111007", name: "الصندوق — ليرة تركية", name_latin: "Cash on hand — TRY",
                        currency: TRY, monetary: true, statement_line: bs.cash }] }
rates:
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "41.2000", type: market }
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: TRY, rate: "42.0000", type: bulletin }
  - { date: 2026-11-27, base: USD, quote: TRY, rate: "42.5000", type: market }
steps:
  - manual: the owner pays TRY into the cash box
    accounting_date: 2026-11-10
    payload: { lines: [{ account: "111007", currency: TRY, amount: 200000 },
                       { account: "313001", currency: TRY, amount: -200000 }] }
  - manual: a repair invoiced in TRY, not yet paid
    accounting_date: 2026-11-10
    payload: { lines: [{ account: "531006", currency: TRY, amount: 410000 },
                       { account: "211003", currency: TRY, amount: -410000 }] }
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
    - source: manual
      date: 2026-11-10
      lines:
        # book: 4,100.00 TRY / 41 × 122 = 12,200.00 SYP; parallel: 4,100.00 / 41.2 = 99.5145… → 99.51 USD
        - { account: "531006", currency: TRY, amount: 410000, book: 1220000, parallel: 9951 }
        - { account: "211003", currency: TRY, amount: -410000, book: -1220000, parallel: -9951 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # 111007: target 2,000.00 / 42 × 125 = 5,952.3809… → 5,952.38 SYP; carrying 5,951.22;
        #   difference +1.16, a gain
        - { account: "111007", currency: TRY, amount: 0, book: 116, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -116, book: -116, parallel: 0 }
        # 211003: target −4,100.00 / 42 × 125 = −12,202.3809… → −12,202.38 SYP; carrying
        #   −12,200.00; difference −2.38, a loss
        - { account: "211003", currency: TRY, amount: 0, book: -238, parallel: 0 }
        - { account: "541002", currency: SYP, amount: 238, book: 238, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111007", currency: TRY, amount: 0, book: -116, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 116, book: 116, parallel: 0 }
        - { account: "211003", currency: TRY, amount: 0, book: 238, parallel: 0 }
        - { account: "541002", currency: SYP, amount: -238, book: -238, parallel: 0 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # 111007: target 2,000.00 / 42.5 = 47.0588… → 47.06 USD; carrying 48.54; difference −1.48, a loss
        - { account: "111007", currency: TRY, amount: 0, book: 0, parallel: -148 }
        - { account: "541002", currency: USD, amount: 148, book: 0, parallel: 148 }
        # 211003: target −4,100.00 / 42.5 = −96.4705… → −96.47 USD; carrying −99.51; difference
        #   +3.04, a gain
        - { account: "211003", currency: TRY, amount: 0, book: 0, parallel: 304 }
        - { account: "421002", currency: USD, amount: -304, book: 0, parallel: -304 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111007", currency: TRY, amount: 0, book: 0, parallel: 148 }
        - { account: "541002", currency: USD, amount: -148, book: 0, parallel: -148 }
        - { account: "211003", currency: TRY, amount: 0, book: 0, parallel: -304 }
        - { account: "421002", currency: USD, amount: 304, book: 0, parallel: 304 }
  balances:
    - { account: "111007", book: 595122, parallel: 4854 }
    - { account: "211003", book: -1220000, parallel: -9951 }
```
