# A receipt and a payment through a cash account

Status: Proposed

The expected entries of all eleven cases were approved by the owner on 2026-11-14, with the TRY receipt at a dealt rate as two cases: at the rate agreed with the client, which leaves no book difference, and with no dealt rate, which leaves a difference in both ledgers. They stay `Proposed` until S11's slice brings the `voucher` executor, the box rule and the cash chart `contracting@1`; that PR switches them to `Approved (owner, 2026-11-14)` with no expected value changed.

## Rule

A receipt voucher has exactly one debit on its cash account and a payment voucher exactly one credit; their counter lines are ordinary manual lines in any currency (S11 rules 10, 11 and 15). The cash line is a new measurement, at the dealt rate in a ledger that accepts it for the pair, otherwise at the ledger's policy rate of the day. A counter line on a control account names its counterparty: on a document account it clears the item at its carrying amount in proportion to what remains, on a running account it clears at the average carrying amount and splits at zero, the excess a new measurement; any other counter line is a new measurement. Each ledger's residual is a realised exchange difference in that ledger only, to `fx_realised_gain` (`421001`) when a credit and `fx_realised_loss` (`541001`) when a debit. An advance from a client (`212002`) is non-monetary and the month-end revaluation never touches it. A payment after which a box would be below zero at its date or any later date is refused whole (`CASH_BOX_NEGATIVE`). Cancelling a voucher reverses its entry exactly and reopens what it cleared at its earlier carrying amount.

## Basis

- **IAS 21.21–22:** each new line is recorded at the spot rate of the voucher date: the rate dealt at for the book ledger, whose policy is `market` and accepts it, otherwise the ledger's policy rate (the Central Bank bulletin for the SYP parallel ledger, S02 rule 16).
- **IAS 21.28:** the difference between what a monetary item was carried at and what settles it is a realised exchange difference recognised in profit or loss in the period.
- **IAS 21.16 and 21.23(b), IFRIC 22.8, IFRS 15.106:** an advance from a client is a contract liability settled by work, not by currency, so it is non-monetary, fixed at the receipt's rate and not revalued; the boxes are monetary and are (IAS 21.23(a)).
- **IAS 1.102:** a site cost is an expense by nature under `is.direct_costs`, carrying its contract (S11 rule 3).
- **Company policy:** S11 rules 8, 10, 11, 14 and 15 and its "Accounting treatment" (owner, 2026-11-14); the client's currencies, a USD book at `market` accepting dealt rates and an SYP parallel ledger at the bulletin (S11 "The client's currencies", ADR 0021); ADR 0007 (running balances, exchange residuals); ADR 0013 and S04 rules 3 and 10–13 (document and running items, clearing at carrying amounts, the split at zero, reopening by reversal); S03 rules 9 and 12–15 (new measurements, dealt rates, residuals, the accountant's reversal); S07 (revaluation of monetary items only).
- **Syrian rules:** the bulletin for the parallel ledger, UNVERIFIED (Q1), adopted by the owner as the company's policy; a daily TRY/SYP bulletin, UNVERIFIED (Q10), assumed by the owner (S11); Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The company is the contracting client's shape unless a case says otherwise: `usd-syp`, the USD book at `market` accepting dealt rates, the SYP parallel ledger at the bulletin, and TRY as a third currency, with the chart `contracting@1` (S11 "Templates"): the boxes `111002` (USD) and `111005` (TRY), trade receivables `112001` (a document control account for clients, client and contract required), suppliers `211001` (a running control account for suppliers), workers and craftsmen `211007` (a running control account for workers), advances from clients `212002` (a running control account for clients, non-monetary, client and contract required), the owner's current account `313001`, contract revenue `411001` (client and contract required), materials `511001`, wages `511002`, machinery hire `511004` and site transport and fuel `511005` (each requiring the contract), realised exchange gains `421001` and losses `541001`, unrealised gains `421002`. Client C1's contract is P1. Every rate and amount is synthetic. Tuesday 24 and Monday 30 November, and Tuesday 1, Wednesday 2 and Thursday 3 December 2026 are publication days.

A billing, a supplier's invoice and a worker's wages are manual entries (S04; the invoice and the wages are S12's to automate). Each case that pays from a box first puts cash into it by a receipt voucher from the owner's current account, since a box never goes below zero (S11 rule 8). A voucher step's payload is the voucher draft as the form sends it: the voucher header, the lines and, on a receipt or a payment, the dealt rates the accountant typed (S03 rule 13). A line on a document control account names its item (`open_item`, `item`) and takes the item's dimensions; a line on a running control account names its counterparty in `dims`, and its item is named in `open_items` by the counterparty's code.

A difference line carries its amount in one ledger only, in that ledger's currency (ADR 0007): in the USD books a book difference is a USD line with parallel 0, and a parallel difference an SYP line with book 0.

The cases leave out what other scenarios own: transfers and exchanges between boxes, and the cancellation refused once the cash is spent (`cash/transfer-and-exchange.md`); the cash count (`cash/cash-count.md`); a voucher dated in a closed period, refused as any posting there (`periods/close-and-reopen.md`); the revaluation of receivables and payables (`currency/month-end-revaluation.md`); a receipt settling several items at once (`receivables/manual-settlement.md`). The measurement of manual lines in the other currency shapes is `receivables/manual-settlement.md`'s; one case here repeats the supplier's payment in SYP books with a USD parallel ledger, to show the differences change ledgers with the book currency.

### A USD billing settled by two USD receipts

Billing B-1 of 1,500.00 USD to client C1 for contract P1 is carried at the bulletin of its day in the parallel ledger. The USD book takes every USD amount as it is, so it is left with nothing. Each receipt measures its cash at the bulletin of its own day; the first clears 600.00 of the 1,500.00 open at 600/1,500 of what the item carries, the second clears all that remains at what is left. The parallel ledger realises a gain on each.

```yaml
case: B-1 (1,500.00 USD at 120) settled by 600.00 USD at 121 and 900.00 USD at 122; parallel gains only
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-02, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - manual: progress billing B-1 to client C1 for contract P1
    accounting_date: 2026-12-01
    payload: { lines: [{ account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 150000,
                         open_item: { ref: B-1, due: 2026-12-31 } },
                       { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -150000 }] }
  - voucher: the client pays 600.00 USD of B-1 into the USD box
    accounting_date: 2026-12-02
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "العميل" },
               lines: [{ account: "111002", currency: USD, amount: 60000 },
                       { account: "112001", currency: USD, amount: -60000, item: B-1 }] }
  - voucher: the client pays the remaining 900.00 USD of B-1
    accounting_date: 2026-12-03
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "العميل" },
               lines: [{ account: "111002", currency: USD, amount: 90000 },
                       { account: "112001", currency: USD, amount: -90000, item: B-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        # parallel: 1,500.00 USD × 120 = 180,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 150000, book: 150000, parallel: 18000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -150000, book: -150000, parallel: -18000000 }
    - source: manual
      date: 2026-12-02
      lines:
        # parallel: 600.00 USD × 121 = 72,600.00 SYP
        - { account: "111002", currency: USD, amount: 60000, book: 60000, parallel: 7260000 }
        # 600 of 1,500 open: 18,000,000 × 600 / 1,500 = 7,200,000
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: -60000, book: -60000, parallel: -7200000 }
        # book residual 0; parallel residual: 7,260,000 − 7,200,000 = 60,000 → a credit: realised gain 600.00 SYP
        - { account: "421001", currency: SYP, amount: -60000, book: 0, parallel: -60000 }
    - source: manual
      date: 2026-12-03
      lines:
        # parallel: 900.00 USD × 122 = 109,800.00 SYP
        - { account: "111002", currency: USD, amount: 90000, book: 90000, parallel: 10980000 }
        # all that is open, at what is left: 18,000,000 − 7,200,000 = 10,800,000
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: -90000, book: -90000, parallel: -10800000 }
        # parallel residual: 10,980,000 − 10,800,000 = 180,000 → a credit: realised gain 1,800.00 SYP
        - { account: "421001", currency: SYP, amount: -180000, book: 0, parallel: -180000 }
  balances:
    # 72,600.00 + 109,800.00 = 182,400.00 SYP
    - { account: "111002", currency: USD, amount: 150000, book: 150000, parallel: 18240000 }
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "421001", book: 0, parallel: -240000 }
  open_items:
    - { item: B-1, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### A USD billing settled in TRY at a rate dealt with the client

The client settles B-1 of 1,000.00 USD by paying 34,200.00 TRY into the TRY box, at 34.2000 TRY per USD agreed with the client. The accountant types that rate for USD/TRY. The USD book accepts it and measures the TRY at it, 1,000.00 USD, exactly what the item carries: no book difference. The SYP parallel ledger takes no dealt rate: the TRY at the TRY/SYP bulletin, against the item's carrying amount, and a realised loss.

```yaml
case: B-1 (1,000.00 USD at 120) settled by 34,200.00 TRY dealt at 34.2; a parallel loss only
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  # the market rate of the day, which the dealt rate takes precedence over
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - manual: progress billing B-1 to client C1 for contract P1
    accounting_date: 2026-12-01
    payload: { lines: [{ account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 100000,
                         open_item: { ref: B-1, due: 2026-12-31 } },
                       { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -100000 }] }
  - voucher: the client settles B-1 in TRY at the rate agreed with the client
    accounting_date: 2026-12-03
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "العميل" },
               dealt_rates: [{ base: USD, quote: TRY, rate: "34.2000" }],
               lines: [{ account: "111005", currency: TRY, amount: 3420000 },
                       { account: "112001", currency: USD, amount: -100000, item: B-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 100000, book: 100000, parallel: 12000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -100000, book: -100000, parallel: -12000000 }
    - source: manual
      date: 2026-12-03
      lines:
        # book: 34,200.00 TRY / 34.2 (dealt) = 1,000.00 USD; the market's 34.0 is not read
        # parallel: 34,200.00 TRY × 3.5 (TRY/SYP bulletin) = 119,700.00 SYP
        - { account: "111005", currency: TRY, amount: 3420000, book: 100000, parallel: 11970000 }
        # all that is open, at what the item carries; no rate is read for it
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: -100000, book: -100000, parallel: -12000000 }
        # book residual: 100,000 − 100,000 = 0 → no book line
        # parallel residual: 11,970,000 − 12,000,000 = −30,000 → a debit: realised loss 300.00 SYP
        - { account: "541001", currency: SYP, amount: 30000, book: 0, parallel: 30000 }
  balances:
    - { account: "111005", currency: TRY, amount: 3420000, book: 100000, parallel: 11970000 }
    - { account: "541001", book: 0, parallel: 30000 }
  open_items:
    - { item: B-1, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### The same TRY receipt with no dealt rate

The same receipt when the accountant types no rate. The USD book then measures the TRY at the market rate of the day, 34.0000, and realises a gain against the item; the parallel ledger is as before. Differences arise in both ledgers.

```yaml
case: B-1 (1,000.00 USD at 120) settled by 34,200.00 TRY with no dealt rate; a book gain at market and a parallel loss
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - manual: progress billing B-1 to client C1 for contract P1
    accounting_date: 2026-12-01
    payload: { lines: [{ account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 100000,
                         open_item: { ref: B-1, due: 2026-12-31 } },
                       { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -100000 }] }
  - voucher: the client settles B-1 in TRY
    accounting_date: 2026-12-03
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "العميل" },
               lines: [{ account: "111005", currency: TRY, amount: 3420000 },
                       { account: "112001", currency: USD, amount: -100000, item: B-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 100000, book: 100000, parallel: 12000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -100000, book: -100000, parallel: -12000000 }
    - source: manual
      date: 2026-12-03
      lines:
        # book: 34,200.00 TRY / 34 (market) = 1,005.8823… → 1,005.88 USD; parallel: × 3.5 = 119,700.00 SYP
        - { account: "111005", currency: TRY, amount: 3420000, book: 100588, parallel: 11970000 }
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: -100000, book: -100000, parallel: -12000000 }
        # book residual: 100,588 − 100,000 = 588 → a credit: realised gain 5.88 USD
        - { account: "421001", currency: USD, amount: -588, book: -588, parallel: 0 }
        # parallel residual: 11,970,000 − 12,000,000 = −30,000 → a debit: realised loss 300.00 SYP
        - { account: "541001", currency: SYP, amount: 30000, book: 0, parallel: 30000 }
  balances:
    - { account: "111005", currency: TRY, amount: 3420000, book: 100588, parallel: 11970000 }
    - { account: "421001", book: -588, parallel: 0 }
    - { account: "541001", book: 0, parallel: 30000 }
  open_items:
    - { item: B-1, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### An advance from a client, untouched by the month-end revaluation

Client C1 pays a 2,000.00 USD advance on contract P1 into the USD box. The advance is a running item for C1 in USD on `212002`, measured anew at the receipt's rates. At the end of November the USD book has no foreign-currency balance to revalue and posts nothing. The SYP parallel ledger revalues the USD box, monetary, at the closing bulletin; the advance is non-monetary and keeps the receipt's 240,000.00 SYP, so the revaluation has no line on it (IAS 21.23(b)). The revaluation's reversal on 1 December restores the box.

```yaml
case: a 2,000.00 USD advance at 120; the November revaluation at 122 moves the box, not the advance
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-11-24, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - voucher: client C1 pays an advance on contract P1 into the USD box
    accounting_date: 2026-11-24
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "العميل" },
               lines: [{ account: "111002", currency: USD, amount: 200000 },
                       { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -200000 }] }
  - revalue: book
    period: 2026-11
  - revalue: parallel
    period: 2026-11
expect:
  entries:
    - source: manual
      date: 2026-11-24
      lines:
        # parallel: 2,000.00 USD × 120 = 240,000.00 SYP
        - { account: "111002", currency: USD, amount: 200000, book: 200000, parallel: 24000000 }
        # a new running item for C1 in USD, a new measurement at the same rate
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -200000, book: -200000, parallel: -24000000 }
    # the book revaluation: every balance is in USD, the book's own currency → no entry
    - source: revaluation
      date: 2026-11-30
      lines:
        # 111002: target 2,000.00 × 122 = 244,000.00 SYP; carrying 240,000.00; difference +4,000.00, a gain
        # 212002 is non-monetary: no line, whatever the rate
        - { account: "111002", currency: USD, amount: 0, book: 0, parallel: 400000 }
        - { account: "421002", currency: SYP, amount: -400000, book: 0, parallel: -400000 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111002", currency: USD, amount: 0, book: 0, parallel: -400000 }
        - { account: "421002", currency: SYP, amount: 400000, book: 0, parallel: 400000 }
  balances:
    # the advance as received, in both ledgers
    - { account: "212002", book: -200000, parallel: -24000000 }
    - { account: "111002", currency: USD, amount: 200000, book: 200000, parallel: 24000000 }
    - { account: "421002", book: 0, parallel: 0 }
  open_items:
    # a running item is named by the counterparty's code
    - { item: C1, account: "212002", dims: { client: C1 }, currency: USD, amount: -200000, book: -200000, parallel: -24000000 }
```

### A site cost paid in TRY

The TRY box pays 5,100.00 TRY of site fuel for contract P1. The cost line carries the contract (S11 rule 3) and, as the cash line, is a new measurement at each ledger's rate of the day: one currency, one rate per ledger, nothing left over.

```yaml
case: 5,100.00 TRY of site fuel on 511005 for contract P1, paid from the TRY box; no difference
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-02, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-02, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-02, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - voucher: the owner pays 10,000.00 TRY into the TRY box
    accounting_date: 2026-12-02
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 1000000 },
                       { account: "313001", currency: TRY, amount: -1000000 }] }
  - voucher: site fuel for contract P1 paid from the TRY box
    accounting_date: 2026-12-02
    payload: { voucher: { kind: payment, cash_account: "111005", party_name: "محطة وقود" },
               lines: [{ account: "511005", dims: { contract: P1 }, currency: TRY, amount: 510000 },
                       { account: "111005", currency: TRY, amount: -510000 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-02
      lines:
        # book: 10,000.00 TRY / 34 (market) = 294.1176… → 294.12 USD; parallel: × 3.5 = 35,000.00 SYP
        - { account: "111005", currency: TRY, amount: 1000000, book: 29412, parallel: 3500000 }
        - { account: "313001", currency: TRY, amount: -1000000, book: -29412, parallel: -3500000 }
    - source: manual
      date: 2026-12-02
      lines:
        # book: 5,100.00 TRY / 34 = 150.00 USD; parallel: × 3.5 = 17,850.00 SYP
        - { account: "511005", dims: { contract: P1 }, currency: TRY, amount: 510000, book: 15000, parallel: 1785000 }
        - { account: "111005", currency: TRY, amount: -510000, book: -15000, parallel: -1785000 }
  balances:
    # 10,000.00 − 5,100.00 = 4,900.00 TRY; book 294.12 − 150.00 = 144.12 USD; parallel 35,000 − 17,850 = 17,150.00 SYP
    - { account: "111005", currency: TRY, amount: 490000, book: 14412, parallel: 1715000 }
    - { account: "511005", dims: { contract: P1 }, book: 15000, parallel: 1785000 }
```

### A TRY payment to supplier S1 (S11's example)

Supplier S1 invoiced 10,200.00 TRY of materials on 24 November, when the market was 32.0000 TRY per USD and the bulletin 3.4000 SYP per TRY: a credit running item for S1 in TRY carried at 318.75 USD and 34,680.00 SYP. On 3 December the TRY box pays S1 6,800.00 TRY. The payment clears two thirds of the balance at its average carrying amount; the cash is measured at the rates of the day; each ledger realises its own difference. The payment takes the box exactly to zero, which is allowed (S11 edge case 2).

```yaml
case: 6,800.00 TRY paid to S1 against a 10,200.00 TRY balance at 32 and 3.4; a book gain and a parallel loss
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-11-24, base: TRY, quote: SYP, rate: "3.4000", type: bulletin }
  - { date: 2026-11-24, base: USD, quote: TRY, rate: "32.0000", type: market }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - manual: supplier S1's invoice for materials on contract P1
    accounting_date: 2026-11-24
    payload: { lines: [{ account: "511001", dims: { contract: P1 }, currency: TRY, amount: 1020000 },
                       { account: "211001", dims: { supplier: S1 }, currency: TRY, amount: -1020000 }] }
  - voucher: the owner pays 6,800.00 TRY into the TRY box
    accounting_date: 2026-12-03
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 680000 },
                       { account: "313001", currency: TRY, amount: -680000 }] }
  - voucher: 6,800.00 TRY paid to supplier S1
    accounting_date: 2026-12-03
    payload: { voucher: { kind: payment, cash_account: "111005", party_name: "المورّد" },
               lines: [{ account: "211001", dims: { supplier: S1 }, currency: TRY, amount: 680000 },
                       { account: "111005", currency: TRY, amount: -680000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-24
      lines:
        # book: 10,200.00 TRY / 32 (market) = 318.75 USD; parallel: × 3.4 = 34,680.00 SYP
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 1020000, book: 31875, parallel: 3468000 }
        # a new running item for S1 in TRY
        - { account: "211001", dims: { supplier: S1 }, currency: TRY, amount: -1020000, book: -31875, parallel: -3468000 }
    - source: manual
      date: 2026-12-03
      lines:
        # book: 6,800.00 TRY / 34 = 200.00 USD; parallel: × 3.5 = 23,800.00 SYP
        - { account: "111005", currency: TRY, amount: 680000, book: 20000, parallel: 2380000 }
        - { account: "313001", currency: TRY, amount: -680000, book: -20000, parallel: -2380000 }
    - source: manual
      date: 2026-12-03
      lines:
        # 6,800 of 10,200 at the average: book 31,875 × 6,800 / 10,200 = 21,250; parallel 3,468,000 × 2/3 = 2,312,000
        - { account: "211001", dims: { supplier: S1 }, currency: TRY, amount: 680000, book: 21250, parallel: 2312000 }
        # book: 6,800.00 TRY / 34 (market) = 200.00 USD; parallel: × 3.5 = 23,800.00 SYP
        - { account: "111005", currency: TRY, amount: -680000, book: -20000, parallel: -2380000 }
        # book residual: 21,250 − 20,000 = 1,250 → a credit: realised gain 12.50 USD
        - { account: "421001", currency: USD, amount: -1250, book: -1250, parallel: 0 }
        # parallel residual: 2,312,000 − 2,380,000 = −68,000 → a debit: realised loss 680.00 SYP
        - { account: "541001", currency: SYP, amount: 68000, book: 0, parallel: 68000 }
  balances:
    # the box exactly at zero in every amount
    - { account: "111005", currency: TRY, amount: 0, book: 0, parallel: 0 }
    - { account: "421001", book: -1250, parallel: 0 }
    - { account: "541001", book: 0, parallel: 68000 }
  open_items:
    # 10,200 − 6,800 = 3,400.00 TRY left; book 31,875 − 21,250 = 10,625; parallel 3,468,000 − 2,312,000 = 1,156,000
    - { item: S1, account: "211001", dims: { supplier: S1 }, currency: TRY, amount: -340000, book: -10625, parallel: -1156000 }
```

### The same payment in SYP books with a USD parallel ledger

The same invoice and payment in Vertex Media's ledgers: SYP books at the bulletin and a USD parallel ledger at `market` (shape `third`, since TRY is a third currency). The two ledgers trade places: the SYP book realises the loss, the USD parallel ledger the gain, with the same figures.

```yaml
case: SYP books and a USD parallel ledger; 6,800.00 TRY paid to S1; a book loss and a parallel gain
company: { shape: third, book: SYP, parallel: USD, template: contracting,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-11-24, base: TRY, quote: SYP, rate: "3.4000", type: bulletin }
  - { date: 2026-11-24, base: USD, quote: TRY, rate: "32.0000", type: market }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - manual: supplier S1's invoice for materials on contract P1
    accounting_date: 2026-11-24
    payload: { lines: [{ account: "511001", dims: { contract: P1 }, currency: TRY, amount: 1020000 },
                       { account: "211001", dims: { supplier: S1 }, currency: TRY, amount: -1020000 }] }
  - voucher: the owner pays 6,800.00 TRY into the TRY box
    accounting_date: 2026-12-03
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 680000 },
                       { account: "313001", currency: TRY, amount: -680000 }] }
  - voucher: 6,800.00 TRY paid to supplier S1
    accounting_date: 2026-12-03
    payload: { voucher: { kind: payment, cash_account: "111005", party_name: "المورّد" },
               lines: [{ account: "211001", dims: { supplier: S1 }, currency: TRY, amount: 680000 },
                       { account: "111005", currency: TRY, amount: -680000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-24
      lines:
        # book: 10,200.00 TRY × 3.4 (bulletin) = 34,680.00 SYP; parallel: / 32 (market) = 318.75 USD
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 1020000, book: 3468000, parallel: 31875 }
        - { account: "211001", dims: { supplier: S1 }, currency: TRY, amount: -1020000, book: -3468000, parallel: -31875 }
    - source: manual
      date: 2026-12-03
      lines:
        # book: 6,800.00 TRY × 3.5 = 23,800.00 SYP; parallel: / 34 = 200.00 USD
        - { account: "111005", currency: TRY, amount: 680000, book: 2380000, parallel: 20000 }
        - { account: "313001", currency: TRY, amount: -680000, book: -2380000, parallel: -20000 }
    - source: manual
      date: 2026-12-03
      lines:
        # two thirds at the average: book 3,468,000 × 2/3 = 2,312,000; parallel 31,875 × 2/3 = 21,250
        - { account: "211001", dims: { supplier: S1 }, currency: TRY, amount: 680000, book: 2312000, parallel: 21250 }
        - { account: "111005", currency: TRY, amount: -680000, book: -2380000, parallel: -20000 }
        # book residual: 2,312,000 − 2,380,000 = −68,000 → a debit: realised loss 680.00 SYP
        - { account: "541001", currency: SYP, amount: 68000, book: 68000, parallel: 0 }
        # parallel residual: 21,250 − 20,000 = 1,250 → a credit: realised gain 12.50 USD
        - { account: "421001", currency: USD, amount: -1250, book: 0, parallel: -1250 }
  balances:
    - { account: "111005", currency: TRY, amount: 0, book: 0, parallel: 0 }
    - { account: "541001", book: 68000, parallel: 0 }
    - { account: "421001", book: 0, parallel: -1250 }
  open_items:
    - { item: S1, account: "211001", dims: { supplier: S1 }, currency: TRY, amount: -340000, book: -1156000, parallel: -10625 }
```

### A payment to a worker beyond the worker's balance

Worker W1 earned 300.00 USD of wages on contract P1 on 1 December. On 3 December the USD box pays W1 400.00 USD. The debit on `211007` clears the whole 300.00 credit at its carrying amount, and the 100.00 beyond zero is split off as a new measurement at the day's bulletin: an advance to the worker in the same account (S04 rule 3, S11 edge case 11). The parallel ledger realises a loss on the 300.00 settled.

```yaml
case: 400.00 USD paid to W1 against 300.00 USD of wages at 120; the balance crosses zero to a 100.00 debit at 122
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - voucher: the owner pays 1,000.00 USD into the USD box
    accounting_date: 2026-12-01
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 100000 },
                       { account: "313001", currency: USD, amount: -100000 }] }
  - manual: worker W1's wages on contract P1
    accounting_date: 2026-12-01
    payload: { lines: [{ account: "511002", dims: { contract: P1 }, currency: USD, amount: 30000 },
                       { account: "211007", dims: { worker: W1 }, currency: USD, amount: -30000 }] }
  - voucher: 400.00 USD paid to worker W1
    accounting_date: 2026-12-03
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "العامل" },
               lines: [{ account: "211007", dims: { worker: W1 }, currency: USD, amount: 40000 },
                       { account: "111002", currency: USD, amount: -40000 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        # parallel: 1,000.00 USD × 120 = 120,000.00 SYP
        - { account: "111002", currency: USD, amount: 100000, book: 100000, parallel: 12000000 }
        - { account: "313001", currency: USD, amount: -100000, book: -100000, parallel: -12000000 }
    - source: manual
      date: 2026-12-01
      lines:
        # a new running item for W1 in USD: 300.00 USD × 120 = 36,000.00 SYP
        - { account: "511002", dims: { contract: P1 }, currency: USD, amount: 30000, book: 30000, parallel: 3600000 }
        - { account: "211007", dims: { worker: W1 }, currency: USD, amount: -30000, book: -30000, parallel: -3600000 }
    - source: manual
      date: 2026-12-03
      lines:
        # the split at zero: first the whole 300.00 balance, cleared at what it carries
        - { account: "211007", dims: { worker: W1 }, currency: USD, amount: 30000, book: 30000, parallel: 3600000 }
        # then the 100.00 beyond zero, a new measurement: 100.00 USD × 122 = 12,200.00 SYP
        - { account: "211007", dims: { worker: W1 }, currency: USD, amount: 10000, book: 10000, parallel: 1220000 }
        # parallel: 400.00 USD × 122 = 48,800.00 SYP
        - { account: "111002", currency: USD, amount: -40000, book: -40000, parallel: -4880000 }
        # book residual 0; parallel residual: 3,600,000 + 1,220,000 − 4,880,000 = −60,000 → a debit: realised loss 600.00 SYP
        - { account: "541001", currency: SYP, amount: 60000, book: 0, parallel: 60000 }
  balances:
    # 1,000.00 − 400.00 = 600.00 USD; parallel 120,000.00 − 48,800.00 = 71,200.00 SYP
    - { account: "111002", currency: USD, amount: 60000, book: 60000, parallel: 7120000 }
    - { account: "211007", book: 10000, parallel: 1220000 }
    - { account: "541001", book: 0, parallel: 60000 }
  open_items:
    # a debit: 100.00 USD advanced to the worker, at the payment day's rate
    - { item: W1, account: "211007", dims: { worker: W1 }, currency: USD, amount: 10000, book: 10000, parallel: 1220000 }
```

### A payment refused: the box would go below zero

The USD box holds 1,000.00 USD; a payment of 1,200.00 USD of machinery hire is refused whole (S11 rule 8): it would leave the box 200.00 USD short at the end of its date. Nothing posts and no voucher number is taken.

```yaml
case: 1,200.00 USD paid from a box holding 1,000.00 USD; refused
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-02, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: the owner pays 1,000.00 USD into the USD box
    accounting_date: 2026-12-01
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 100000 },
                       { account: "313001", currency: USD, amount: -100000 }] }
  - voucher: 1,200.00 USD of machinery hire for contract P1
    accounting_date: 2026-12-02
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "مؤجر الآليات" },
               lines: [{ account: "511004", dims: { contract: P1 }, currency: USD, amount: 120000 },
                       { account: "111002", currency: USD, amount: -120000 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "111002", currency: USD, amount: 100000, book: 100000, parallel: 12000000 }
        - { account: "313001", currency: USD, amount: -100000, book: -100000, parallel: -12000000 }
  balances:
    - { account: "111002", currency: USD, amount: 100000, book: 100000, parallel: 12000000 }
    - { account: "511004", book: 0, parallel: 0 }
  outcome: { status: refused, reason: CASH_BOX_NEGATIVE }
```

### A back-dated payment refused: a later date would go below zero

The USD box receives 1,000.00 USD on 1 December and pays 800.00 USD on 3 December, leaving 200.00. A payment of 300.00 USD then dated 2 December would leave 700.00 at the end of its own date, but 100.00 short at the end of 3 December, after the payment already posted. It is refused, naming 3 December (S11 rule 8, edge case 3).

```yaml
case: a 300.00 USD payment back-dated to 2 December, before an 800.00 USD payment of 3 December; refused
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-02, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: the owner pays 1,000.00 USD into the USD box
    accounting_date: 2026-12-01
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 100000 },
                       { account: "313001", currency: USD, amount: -100000 }] }
  - voucher: 800.00 USD of machinery hire for contract P1
    accounting_date: 2026-12-03
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "مؤجر الآليات" },
               lines: [{ account: "511004", dims: { contract: P1 }, currency: USD, amount: 80000 },
                       { account: "111002", currency: USD, amount: -80000 }] }
  - voucher: 300.00 USD of machinery hire, back-dated to 2 December
    accounting_date: 2026-12-02
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "مؤجر الآليات" },
               lines: [{ account: "511004", dims: { contract: P1 }, currency: USD, amount: 30000 },
                       { account: "111002", currency: USD, amount: -30000 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "111002", currency: USD, amount: 100000, book: 100000, parallel: 12000000 }
        - { account: "313001", currency: USD, amount: -100000, book: -100000, parallel: -12000000 }
    - source: manual
      date: 2026-12-03
      lines:
        # parallel: 800.00 USD × 120 = 96,000.00 SYP
        - { account: "511004", dims: { contract: P1 }, currency: USD, amount: 80000, book: 80000, parallel: 9600000 }
        - { account: "111002", currency: USD, amount: -80000, book: -80000, parallel: -9600000 }
  balances:
    # the box at the end of 3 December: 1,000.00 − 800.00 = 200.00 USD; the refused 300.00 would make it −100.00
    - { account: "111002", currency: USD, amount: 20000, book: 20000, parallel: 2400000 }
  outcome: { status: refused, reason: CASH_BOX_NEGATIVE }
```

### A receipt cancelled, reopening its billing

B-1 of 1,000.00 USD is settled in full on 2 December at a bulletin of 121, then the receipt is cancelled on 3 December, when the bulletin is 122. The cancellation is the exact reversal of the receipt's entry (S03 rule 9, S11 rule 14): every line negated as posted, the realised gain included, and no rate of the cancellation's date read. B-1 reopens at what it carried before the receipt, and the box returns exactly to zero, which is allowed.

```yaml
case: a full USD receipt on B-1 cancelled the next day; B-1 reopens at 1,000.00 USD and 120,000.00 SYP
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-02, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  # the rate of the cancellation's date, which the reversal must not read
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - manual: progress billing B-1 to client C1 for contract P1
    accounting_date: 2026-12-01
    payload: { lines: [{ account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 100000,
                         open_item: { ref: B-1, due: 2026-12-31 } },
                       { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -100000 }] }
  - voucher: the client pays B-1 into the USD box
    accounting_date: 2026-12-02
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "العميل" },
               lines: [{ account: "111002", currency: USD, amount: 100000 },
                       { account: "112001", currency: USD, amount: -100000, item: B-1 }] }
  - reversal: 2
    accounting_date: 2026-12-03
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 100000, book: 100000, parallel: 12000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -100000, book: -100000, parallel: -12000000 }
    - source: manual
      date: 2026-12-02
      lines:
        # parallel: 1,000.00 USD × 121 = 121,000.00 SYP
        - { account: "111002", currency: USD, amount: 100000, book: 100000, parallel: 12100000 }
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: -100000, book: -100000, parallel: -12000000 }
        # parallel residual: 12,100,000 − 12,000,000 = 100,000 → a credit: realised gain 1,000.00 SYP
        - { account: "421001", currency: SYP, amount: -100000, book: 0, parallel: -100000 }
    - source: reversal
      date: 2026-12-03
      lines:
        # entry 2 exactly, signs reversed: not 1,000.00 USD × 122, and no new difference
        - { account: "111002", currency: USD, amount: -100000, book: -100000, parallel: -12100000 }
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 100000, book: 100000, parallel: 12000000 }
        - { account: "421001", currency: SYP, amount: 100000, book: 0, parallel: 100000 }
  balances:
    - { account: "111002", currency: USD, amount: 0, book: 0, parallel: 0 }
    - { account: "421001", book: 0, parallel: 0 }
  open_items:
    # open again at what it carried before the receipt
    - { item: B-1, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 100000, book: 100000, parallel: 12000000 }
```
