# A transfer between cash accounts and a currency exchange

Status: Proposed

The expected entries of all eight cases were approved by the owner on 2026-11-14, with "the same exchange" in `syp` and `syp-usd` read as the TRY to USD exchange and the refused cancellation added. They stay `Proposed` until S11's slice brings the `voucher` executor, the box rule and the cash chart `contracting@1`; that PR switches them to `Approved (owner, 2026-11-14)` with no expected value changed.

## Rule

A transfer voucher moves cash from one cash account to another: one credit on the source, one debit on the destination and at most one debit fee line on an expense account in the source's currency, every line a new measurement. In one currency the source's credit equals the destination's debit plus the fee, and nothing is left over. Between two currencies it is a currency exchange: the voucher derives the dealt rate from its amounts, `destination amount / (source credit − fee)` quoted in the company's orientation of the pair, rounded once to 10 decimals, and offers it to a ledger that accepts a dealt rate for that pair (S03 rule 13); every other conversion is at the ledger's policy rate of the day. Whatever each ledger is left out of balance by is a realised exchange difference in that ledger only, to `fx_realised_gain` (`421001`) when a credit and `fx_realised_loss` (`541001`) when a debit. Cancelling the voucher reverses its entry exactly, and is refused when the reversal would take a box below zero.

## Basis

- **IAS 21.21–22:** each line is recorded at the spot rate of the voucher date: the rate actually dealt at for the book ledger, whose policy is `market` and accepts it, otherwise the ledger's policy rate (the Central Bank bulletin for the SYP parallel ledger, S02 rule 16).
- **IAS 21.28:** the difference between the currency given up and the currency received, each at its ledger's rate, is a realised exchange difference recognised in profit or loss in the period.
- **IAS 1.97–98:** a stated fee is an expense of its own (`532002` bank and transfer charges, `is.other_expenses`), never netted into the exchange difference.
- **Company policy:** S11 rules 8, 12 and 14 and its "Accounting treatment" and "Currencies, rates and rounding" (owner, 2026-11-14); the client's currencies, USD book at `market` accepting dealt rates and SYP parallel at the bulletin (S11 "The client's currencies", ADR 0021); ADR 0007 "Exchange residuals"; ADR 0012 and S03 rules 9 and 12–15 (manual entries are new measurements; dealt rates; the accountant's reversal).
- **Syrian rules:** the bulletin for the parallel ledger, UNVERIFIED (Q1), adopted by the owner as the company's policy; a daily TRY/SYP bulletin, UNVERIFIED (Q10), assumed by the owner (S11); Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The company is the contracting client's shape unless a case says otherwise: `usd-syp`, the USD book at `market` accepting dealt rates, the SYP parallel ledger at the bulletin, and TRY as a third currency, with the chart `contracting@1` (S11 "Templates"): the boxes `111001` (SYP), `111002` (USD) and `111005` (TRY), the USD bank account `111004`, the owner's current account `313001`, `532002` bank and transfer charges, `531005` stationery and supplies, realised exchange gains `421001` and losses `541001`. Every rate and amount is synthetic. Tuesday 1, Wednesday 2 and Thursday 3 December 2026 are publication days.

Each case first puts cash into the box it spends from, by a receipt voucher from the owner's current account, since a box never goes below zero (S11 rule 8). A voucher step's payload is the voucher draft as the form sends it: the voucher header and the lines. A transfer states no dealt rate: the system derives it from the amounts (rule 12) and the voucher shows it; a ledger that cannot take it for the pair converts at its policy rate and the voucher is not refused for it, since the accountant typed no rate (S11 "Currencies, rates and rounding" and edge cases 6–7). A rate is quoted in the orientation the company holds the pair in: USD/SYP and USD/TRY with USD as the base, TRY/SYP with TRY as the base.

A difference line carries its amount in one ledger only, in that ledger's currency (ADR 0007): in the USD books a book difference is a USD line with parallel 0, and a parallel difference an SYP line with book 0.

The cases leave out what other scenarios own: a payment and a receipt against items (`cash/receipt-and-payment.md`), the cash count (`cash/cash-count.md`), a closed period (`periods/close-and-reopen.md`) and the month-end revaluation of the boxes (`currency/month-end-revaluation.md`).

### A transfer in one currency, with a fee

The USD box pays 505.00 USD: 500.00 USD reach the bank account and 5.00 USD is the transfer fee. Every line is in USD, so the book takes the amounts as they are and the parallel ledger converts each at one bulletin: nothing is left over in either ledger.

```yaml
case: 500.00 USD moved from the USD box to the USD bank with a 5.00 USD fee; no difference
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin } }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: the owner pays 2,000.00 USD into the USD box
    accounting_date: 2026-12-01
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 200000 },
                       { account: "313001", currency: USD, amount: -200000 }] }
  - voucher: 500.00 USD moved from the box to the bank, with the fee
    accounting_date: 2026-12-01
    payload: { voucher: { kind: transfer, cash_account: "111002", counter_cash_account: "111004" },
               lines: [{ account: "111002", currency: USD, amount: -50500 },
                       { account: "111004", currency: USD, amount: 50000 },
                       { account: "532002", currency: USD, amount: 500 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        # parallel: 2,000.00 USD × 120 = 240,000.00 SYP
        - { account: "111002", currency: USD, amount: 200000, book: 200000, parallel: 24000000 }
        - { account: "313001", currency: USD, amount: -200000, book: -200000, parallel: -24000000 }
    - source: manual
      date: 2026-12-01
      lines:
        # parallel: 505.00 × 120 = 60,600.00; 500.00 × 120 = 60,000.00; 5.00 × 120 = 600.00 SYP
        - { account: "111002", currency: USD, amount: -50500, book: -50500, parallel: -6060000 }
        - { account: "111004", currency: USD, amount: 50000, book: 50000, parallel: 6000000 }
        - { account: "532002", currency: USD, amount: 500, book: 500, parallel: 60000 }
        # book: −50,500 + 50,000 + 500 = 0; parallel: −6,060,000 + 6,000,000 + 60,000 = 0
  balances:
    # 2,000.00 − 505.00 = 1,495.00 USD; parallel 240,000.00 − 60,600.00 = 179,400.00 SYP
    - { account: "111002", currency: USD, amount: 149500, book: 149500, parallel: 17940000 }
    - { account: "111004", currency: USD, amount: 50000, book: 50000, parallel: 6000000 }
    - { account: "532002", book: 500, parallel: 60000 }
```

### USD exchanged for TRY at a money changer, with a fee (S11's example)

The USD box pays 1,010.00 USD: 1,000.00 USD are exchanged for 34,500.00 TRY into the TRY box and 10.00 USD is the changer's fee. The derived rate is 34,500.00 / (1,010.00 − 10.00) = 34.5000000000 TRY per USD. The USD book accepts it for USD/TRY and measures the TRY at it, so the book is left with nothing; the market rate of the day (34.0000) is not used. The SYP parallel ledger takes no dealt rate: the TRY at the TRY/SYP bulletin, the USD at the USD/SYP bulletin, and the residual is a realised gain.

```yaml
case: 1,000.00 USD exchanged for 34,500.00 TRY dealt at 34.5 with a 10.00 USD fee; a parallel gain only
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin } }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-01, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  # the market rate of the day, which the dealt rate takes precedence over
  - { date: 2026-12-01, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - voucher: the owner pays 2,000.00 USD into the USD box
    accounting_date: 2026-12-01
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 200000 },
                       { account: "313001", currency: USD, amount: -200000 }] }
  - voucher: USD exchanged for TRY at a money changer
    accounting_date: 2026-12-01
    payload: { voucher: { kind: transfer, cash_account: "111002", counter_cash_account: "111005",
                          party_name: "صرّاف" },
               lines: [{ account: "111002", currency: USD, amount: -101000 },
                       { account: "111005", currency: TRY, amount: 3450000 },
                       { account: "532002", currency: USD, amount: 1000 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "111002", currency: USD, amount: 200000, book: 200000, parallel: 24000000 }
        - { account: "313001", currency: USD, amount: -200000, book: -200000, parallel: -24000000 }
    - source: manual
      date: 2026-12-01
      lines:
        # book: 34,500.00 TRY / 34.5 (derived, dealt) = 1,000.00 USD
        # parallel: 34,500.00 TRY × 3.5 (TRY/SYP bulletin) = 120,750.00 SYP
        - { account: "111005", currency: TRY, amount: 3450000, book: 100000, parallel: 12075000 }
        # parallel: 10.00 USD × 120 = 1,200.00 SYP
        - { account: "532002", currency: USD, amount: 1000, book: 1000, parallel: 120000 }
        # parallel: 1,010.00 USD × 120 = 121,200.00 SYP
        - { account: "111002", currency: USD, amount: -101000, book: -101000, parallel: -12120000 }
        # book residual: 100,000 + 1,000 − 101,000 = 0 → no book line
        # parallel residual: 12,075,000 + 120,000 − 12,120,000 = 75,000 → a credit: realised gain 750.00 SYP
        - { account: "421001", currency: SYP, amount: -75000, book: 0, parallel: -75000 }
  balances:
    # 2,000.00 − 1,010.00 = 990.00 USD; parallel 240,000.00 − 121,200.00 = 118,800.00 SYP
    - { account: "111002", currency: USD, amount: 99000, book: 99000, parallel: 11880000 }
    - { account: "111005", currency: TRY, amount: 3450000, book: 100000, parallel: 12075000 }
    - { account: "532002", book: 1000, parallel: 120000 }
    - { account: "421001", book: 0, parallel: -75000 }
```

### TRY exchanged for SYP, both foreign to the book

10,000.00 TRY are exchanged for 36,000.00 SYP. The derived rate, 36,000.00 / 10,000.00 = 3.6000000000 SYP per TRY, is shown on the voucher only: the USD book converts TRY and SYP into USD, never TRY/SYP, and the parallel ledger's bulletin takes no dealt rate. So the book measures both lines at the market rates to USD and the parallel ledger the TRY at the TRY/SYP bulletin; each ledger realises its own residual, here a book loss and a parallel gain.

```yaml
case: 10,000.00 TRY exchanged for 36,000.00 SYP; a book loss at market and a parallel gain at the bulletin
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin } }
rates:
  - { date: 2026-12-02, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-02, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-02, base: USD, quote: TRY, rate: "34.0000", type: market }
  - { date: 2026-12-02, base: USD, quote: SYP, rate: "125.0000", type: market }
steps:
  - voucher: the owner pays 15,000.00 TRY into the TRY box
    accounting_date: 2026-12-02
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 1500000 },
                       { account: "313001", currency: TRY, amount: -1500000 }] }
  - voucher: TRY exchanged for SYP at a money changer
    accounting_date: 2026-12-02
    payload: { voucher: { kind: transfer, cash_account: "111005", counter_cash_account: "111001",
                          party_name: "صرّاف" },
               lines: [{ account: "111005", currency: TRY, amount: -1000000 },
                       { account: "111001", currency: SYP, amount: 3600000 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-02
      lines:
        # book: 15,000.00 TRY / 34 (market) = 441.1764… → 441.18 USD
        # parallel: 15,000.00 TRY × 3.5 = 52,500.00 SYP
        - { account: "111005", currency: TRY, amount: 1500000, book: 44118, parallel: 5250000 }
        - { account: "313001", currency: TRY, amount: -1500000, book: -44118, parallel: -5250000 }
    - source: manual
      date: 2026-12-02
      lines:
        # book: 36,000.00 SYP / 125 (market) = 288.00 USD; parallel: SYP as is
        - { account: "111001", currency: SYP, amount: 3600000, book: 28800, parallel: 3600000 }
        # book: 10,000.00 TRY / 34 (market) = 294.1176… → 294.12 USD; parallel: × 3.5 = 35,000.00 SYP
        - { account: "111005", currency: TRY, amount: -1000000, book: -29412, parallel: -3500000 }
        # book residual: 28,800 − 29,412 = −612 → a debit: realised loss 6.12 USD
        - { account: "541001", currency: USD, amount: 612, book: 612, parallel: 0 }
        # parallel residual: 3,600,000 − 3,500,000 = 100,000 → a credit: realised gain 1,000.00 SYP
        - { account: "421001", currency: SYP, amount: -100000, book: 0, parallel: -100000 }
  balances:
    # 15,000.00 − 10,000.00 = 5,000.00 TRY; book 441.18 − 294.12 = 147.06 USD; parallel 52,500 − 35,000 = 17,500.00 SYP
    - { account: "111005", currency: TRY, amount: 500000, book: 14706, parallel: 1750000 }
    - { account: "111001", currency: SYP, amount: 3600000, book: 28800, parallel: 3600000 }
    - { account: "541001", book: 612, parallel: 0 }
    - { account: "421001", book: 0, parallel: -100000 }
```

### TRY exchanged for USD at a derived rate that is not exact

10,000.00 TRY are exchanged for 293.00 USD. The derived rate is 10,000.00 / 293.00 = 34.12969283276450… TRY per USD, rounded once, half away from zero, to 34.1296928328 (S11 rule 12), and stored so. The book measures the TRY at it: 10,000.00 / 34.1296928328 = 292.9999999997 USD, which rounds to 293.00. The 10-decimal rate can move the book amount by far less than half a cent at any realistic amount, so the book is left with nothing; were it ever left with a cent, that cent would be a realised difference, never a rounding line, since the entry has two currencies (S11 "Currencies, rates and rounding"). The SYP parallel ledger converts both lines at the bulletins and realises its residual.

The TRY box's receipt was measured at the market rate (34.0000) and its payment out at the dealt rate, both new measurements (S11 "Accounting treatment"): the box holds no TRY afterwards but 1.12 USD in the book, which the month-end revaluation takes to zero as an exchange difference (S11 edge case 20; `currency/month-end-revaluation.md`).

```yaml
case: 10,000.00 TRY exchanged for 293.00 USD; the derived rate rounded to 10 decimals; a parallel gain only
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin } }
rates:
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - voucher: the owner pays 10,000.00 TRY into the TRY box
    accounting_date: 2026-12-03
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 1000000 },
                       { account: "313001", currency: TRY, amount: -1000000 }] }
  - voucher: TRY exchanged for USD at a money changer
    accounting_date: 2026-12-03
    payload: { voucher: { kind: transfer, cash_account: "111005", counter_cash_account: "111002",
                          party_name: "صرّاف" },
               lines: [{ account: "111005", currency: TRY, amount: -1000000 },
                       { account: "111002", currency: USD, amount: 29300 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-03
      lines:
        # book: 10,000.00 TRY / 34 (market) = 294.1176… → 294.12 USD; parallel: × 3.5 = 35,000.00 SYP
        - { account: "111005", currency: TRY, amount: 1000000, book: 29412, parallel: 3500000 }
        - { account: "313001", currency: TRY, amount: -1000000, book: -29412, parallel: -3500000 }
    - source: manual
      date: 2026-12-03
      lines:
        # parallel: 293.00 USD × 120 = 35,160.00 SYP
        - { account: "111002", currency: USD, amount: 29300, book: 29300, parallel: 3516000 }
        # book: 10,000.00 TRY / 34.1296928328 (derived) = 292.99999999970 → 293.00 USD
        # parallel: 10,000.00 TRY × 3.5 = 35,000.00 SYP
        - { account: "111005", currency: TRY, amount: -1000000, book: -29300, parallel: -3500000 }
        # book residual: 29,300 − 29,300 = 0 → no book line
        # parallel residual: 3,516,000 − 3,500,000 = 16,000 → a credit: realised gain 160.00 SYP
        - { account: "421001", currency: SYP, amount: -16000, book: 0, parallel: -16000 }
  balances:
    # no TRY left; book 294.12 − 293.00 = 1.12 USD until the month-end revaluation; parallel 0
    - { account: "111005", currency: TRY, amount: 0, book: 112, parallel: 0 }
    - { account: "111002", currency: USD, amount: 29300, book: 29300, parallel: 3516000 }
    - { account: "421001", book: 0, parallel: -16000 }
```

### The same exchange in SYP books only

The same 10,000.00 TRY for 293.00 USD in a company with SYP books at the bulletin and no parallel ledger. The bulletin takes no dealt rate, so the derived rate is shown on the voucher only; both lines convert at the bulletins and the one residual is in the book.

```yaml
case: SYP books only; 10,000.00 TRY exchanged for 293.00 USD; a book gain at the bulletin
company: { shape: syp, book: SYP, template: contracting, rate_policy: { book: bulletin } }
rates:
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
steps:
  - voucher: the owner pays 10,000.00 TRY into the TRY box
    accounting_date: 2026-12-03
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 1000000 },
                       { account: "313001", currency: TRY, amount: -1000000 }] }
  - voucher: TRY exchanged for USD at a money changer
    accounting_date: 2026-12-03
    payload: { voucher: { kind: transfer, cash_account: "111005", counter_cash_account: "111002",
                          party_name: "صرّاف" },
               lines: [{ account: "111005", currency: TRY, amount: -1000000 },
                       { account: "111002", currency: USD, amount: 29300 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-03
      lines:
        # 10,000.00 TRY × 3.5 = 35,000.00 SYP
        - { account: "111005", currency: TRY, amount: 1000000, book: 3500000 }
        - { account: "313001", currency: TRY, amount: -1000000, book: -3500000 }
    - source: manual
      date: 2026-12-03
      lines:
        # 293.00 USD × 120 = 35,160.00 SYP
        - { account: "111002", currency: USD, amount: 29300, book: 3516000 }
        - { account: "111005", currency: TRY, amount: -1000000, book: -3500000 }
        # residual: 3,516,000 − 3,500,000 = 16,000 → a credit: realised gain 160.00 SYP
        - { account: "421001", currency: SYP, amount: -16000, book: -16000 }
  balances:
    - { account: "111005", currency: TRY, amount: 0, book: 0 }
    - { account: "111002", currency: USD, amount: 29300, book: 3516000 }
    - { account: "421001", book: -16000 }
```

### The same exchange in SYP books with a USD parallel ledger

The same exchange in Vertex Media's ledgers: SYP books at the bulletin, a USD parallel ledger at `market` accepting dealt rates (shape `third`, since TRY is a third currency). The derived rate now serves the parallel ledger, which converts TRY into USD, so the parallel ledger is left with nothing and the book realises the bulletin's residual: the difference moves to the other ledger with the book currency.

```yaml
case: SYP books and a USD parallel ledger; 10,000.00 TRY exchanged for 293.00 USD; a book gain only
company: { shape: third, book: SYP, parallel: USD, template: contracting,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - voucher: the owner pays 10,000.00 TRY into the TRY box
    accounting_date: 2026-12-03
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 1000000 },
                       { account: "313001", currency: TRY, amount: -1000000 }] }
  - voucher: TRY exchanged for USD at a money changer
    accounting_date: 2026-12-03
    payload: { voucher: { kind: transfer, cash_account: "111005", counter_cash_account: "111002",
                          party_name: "صرّاف" },
               lines: [{ account: "111005", currency: TRY, amount: -1000000 },
                       { account: "111002", currency: USD, amount: 29300 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-03
      lines:
        # book: 10,000.00 TRY × 3.5 = 35,000.00 SYP; parallel: / 34 (market) = 294.12 USD
        - { account: "111005", currency: TRY, amount: 1000000, book: 3500000, parallel: 29412 }
        - { account: "313001", currency: TRY, amount: -1000000, book: -3500000, parallel: -29412 }
    - source: manual
      date: 2026-12-03
      lines:
        # book: 293.00 USD × 120 = 35,160.00 SYP; parallel: USD as is
        - { account: "111002", currency: USD, amount: 29300, book: 3516000, parallel: 29300 }
        # book: × 3.5 = 35,000.00 SYP; parallel: 10,000.00 / 34.1296928328 (derived, dealt) → 293.00 USD
        - { account: "111005", currency: TRY, amount: -1000000, book: -3500000, parallel: -29300 }
        # book residual: 3,516,000 − 3,500,000 = 16,000 → a credit: realised gain 160.00 SYP
        # parallel residual: 29,300 − 29,300 = 0 → no parallel line
        - { account: "421001", currency: SYP, amount: -16000, book: -16000, parallel: 0 }
  balances:
    - { account: "111005", currency: TRY, amount: 0, book: 0, parallel: 112 }
    - { account: "111002", currency: USD, amount: 29300, book: 3516000, parallel: 29300 }
    - { account: "421001", book: -16000, parallel: 0 }
```

### The exchange cancelled

S11's example exchange, cancelled two days later after the rates moved. The cancellation is the exact reversal of the voucher's entry (S03 rule 9, S11 rule 14): every line negated as posted, the realised gain included, and no rate of the reversal's date read. It takes the TRY box exactly to zero, which is allowed.

```yaml
case: the USD to TRY exchange cancelled on 3 December; every line negated as posted
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin } }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-01, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  # the rates of the cancellation's date, which the reversal must not read
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.4500", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "33.8000", type: market }
steps:
  - voucher: the owner pays 2,000.00 USD into the USD box
    accounting_date: 2026-12-01
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 200000 },
                       { account: "313001", currency: USD, amount: -200000 }] }
  - voucher: USD exchanged for TRY at a money changer
    accounting_date: 2026-12-01
    payload: { voucher: { kind: transfer, cash_account: "111002", counter_cash_account: "111005",
                          party_name: "صرّاف" },
               lines: [{ account: "111002", currency: USD, amount: -101000 },
                       { account: "111005", currency: TRY, amount: 3450000 },
                       { account: "532002", currency: USD, amount: 1000 }] }
  - reversal: 2
    accounting_date: 2026-12-03
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "111002", currency: USD, amount: 200000, book: 200000, parallel: 24000000 }
        - { account: "313001", currency: USD, amount: -200000, book: -200000, parallel: -24000000 }
    - source: manual
      date: 2026-12-01
      lines:
        # as in S11's example above
        - { account: "111005", currency: TRY, amount: 3450000, book: 100000, parallel: 12075000 }
        - { account: "532002", currency: USD, amount: 1000, book: 1000, parallel: 120000 }
        - { account: "111002", currency: USD, amount: -101000, book: -101000, parallel: -12120000 }
        - { account: "421001", currency: SYP, amount: -75000, book: 0, parallel: -75000 }
    - source: reversal
      date: 2026-12-03
      lines:
        # entry 2 exactly, signs reversed: not 34,500.00 TRY at 33.8 or × 3.45, and no new difference
        - { account: "111005", currency: TRY, amount: -3450000, book: -100000, parallel: -12075000 }
        - { account: "532002", currency: USD, amount: -1000, book: -1000, parallel: -120000 }
        - { account: "111002", currency: USD, amount: 101000, book: 101000, parallel: 12120000 }
        - { account: "421001", currency: SYP, amount: 75000, book: 0, parallel: 75000 }
  balances:
    # the box back at the receipt's 2,000.00 USD; the TRY box at zero in every amount
    - { account: "111002", currency: USD, amount: 200000, book: 200000, parallel: 24000000 }
    - { account: "111005", currency: TRY, amount: 0, book: 0, parallel: 0 }
    - { account: "532002", book: 0, parallel: 0 }
    - { account: "421001", book: 0, parallel: 0 }
```

### The cancellation refused after the TRY was spent

The same exchange, then 500.00 TRY paid from the TRY box for stationery the next day. Cancelling the exchange would credit the TRY box 34,500.00 TRY when it holds 34,000.00, so the reversal is refused (S11 rule 8 and edge case 4): the payment is cancelled first. Nothing posts.

```yaml
case: the USD to TRY exchange cannot be cancelled once part of the TRY is spent
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin } }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-01, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-02, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-02, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-02, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - voucher: the owner pays 2,000.00 USD into the USD box
    accounting_date: 2026-12-01
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 200000 },
                       { account: "313001", currency: USD, amount: -200000 }] }
  - voucher: USD exchanged for TRY at a money changer
    accounting_date: 2026-12-01
    payload: { voucher: { kind: transfer, cash_account: "111002", counter_cash_account: "111005",
                          party_name: "صرّاف" },
               lines: [{ account: "111002", currency: USD, amount: -101000 },
                       { account: "111005", currency: TRY, amount: 3450000 },
                       { account: "532002", currency: USD, amount: 1000 }] }
  - voucher: stationery paid from the TRY box
    accounting_date: 2026-12-02
    payload: { voucher: { kind: payment, cash_account: "111005", party_name: "مكتبة" },
               lines: [{ account: "531005", currency: TRY, amount: 50000 },
                       { account: "111005", currency: TRY, amount: -50000 }] }
  - reversal: 2
    accounting_date: 2026-12-03
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "111002", currency: USD, amount: 200000, book: 200000, parallel: 24000000 }
        - { account: "313001", currency: USD, amount: -200000, book: -200000, parallel: -24000000 }
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "111005", currency: TRY, amount: 3450000, book: 100000, parallel: 12075000 }
        - { account: "532002", currency: USD, amount: 1000, book: 1000, parallel: 120000 }
        - { account: "111002", currency: USD, amount: -101000, book: -101000, parallel: -12120000 }
        - { account: "421001", currency: SYP, amount: -75000, book: 0, parallel: -75000 }
    - source: manual
      date: 2026-12-02
      lines:
        # book: 500.00 TRY / 34 (market) = 14.7058… → 14.71 USD; parallel: × 3.5 = 1,750.00 SYP
        - { account: "531005", currency: TRY, amount: 50000, book: 1471, parallel: 175000 }
        - { account: "111005", currency: TRY, amount: -50000, book: -1471, parallel: -175000 }
  balances:
    # 34,500.00 − 500.00 = 34,000.00 TRY left; the reversal would need 34,500.00
    - { account: "111005", currency: TRY, amount: 3400000, book: 98529, parallel: 11900000 }
  outcome: { status: refused, reason: CASH_BOX_NEGATIVE }
```
