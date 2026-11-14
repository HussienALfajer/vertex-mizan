# A cash count

Status: Proposed

The expected entries and vouchers of all five cases were approved by the owner on 2026-11-14. They stay `Proposed` until S11's slice brings the `voucher` executor with counts, the voucher reader and the cash chart `contracting@1`; that PR switches them to `Approved (owner, 2026-11-14)` with no expected value changed.

## Rule

A cash count (محضر جرد) compares the cash the accountant counted in a box with the box's expected balance, its balance in its currency at the end of the count's date. The expected balance is computed again at posting, under the box lock, and must equal the one the preview showed, or the count is refused (`CASH_COUNT_STALE`, with the new expected amount) and nothing is recorded. A shortage posts Dr `532007` cash shortages / Cr the box, an overage Dr the box / Cr `422002` cash overages, both lines in the box's currency for the difference and both new measurements at each ledger's policy rate of the count's date; a count that matches records the voucher with no entry. Every recorded count takes the next count number; a refused one takes none. Cancelling a count's voucher reverses its entry exactly.

## Basis

- **IAS 1.88 and 1.97–98:** a shortage is an expense and an overage an income of the period it is found in, each presented on its own line (`is.other_expenses`, `is.other_income`), never netted into the box.
- **IAS 21.21–22:** both lines are recorded at the spot rate of the count's date: the market rate for the USD book (no rate is dealt at a count), the Central Bank bulletin for the SYP parallel ledger. The box's carrying amount is not used: what it differs from the spot rate by is the box's, remeasured at month end (IAS 21.23(a), S07).
- **Company policy:** S11 rules 8, 13 and 14, its "Accounting treatment" and "Currencies, rates and rounding" (owner, 2026-11-14: `532007` and `422002`, new measurements, a count in one currency leaves no residual); the client's currencies, USD book at `market` accepting dealt rates and SYP parallel at the bulletin (S11 "The client's currencies", ADR 0021); S03 rules 9 and 12 (new measurements, the accountant's reversal).
- **Syrian rules:** the bulletin for the parallel ledger, UNVERIFIED (Q1), adopted by the owner as the company's policy; a daily TRY/SYP bulletin, UNVERIFIED (Q10), assumed by the owner (S11); Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The company is the contracting client's shape: `usd-syp`, the USD book at `market` accepting dealt rates, the SYP parallel ledger at the bulletin, and TRY as a third currency, with the chart `contracting@1` (S11 "Templates"): the boxes `111002` (USD) and `111005` (TRY), the owner's current account `313001`, `532002` bank and transfer charges, `531005` stationery and supplies, `532007` cash shortages, `422002` cash overages, realised exchange gains `421001`. Every rate and amount is synthetic. Tuesday 1, Wednesday 2 and Thursday 3 December 2026 are publication days.

Each case first puts cash into the box it counts, by a receipt voucher from the owner's current account; the TRY box receives its TRY by S11's example exchange (`cash/transfer-and-exchange.md`), as the owner's acceptance check does (S11 "Acceptance", steps 4 and 6).

A count's payload is the voucher draft as the form sends it: the reason as its `description`, and the header `{ kind: count, cash_account, counted, expected }` with no lines, since the posting function builds them from the difference (rule 13). `counted` is the cash counted, in minor units of the box's currency; `expected` is the expected balance the accountant's preview showed, which the post carries and the function compares with its own. A case's `vouchers` are the exact set of vouchers the company holds after the steps: each with its kind, its number in its kind and fiscal year, its date, its cash account, a transfer's destination (`counter_cash_account`), the entry it posted (posting order, or `null` for a count that matched), a count's expected and counted amounts, and `cancelled_by`, the reversal that cancelled it.

The cases leave out what other scenarios own: a count dated in a closed period, refused as any posting there (`periods/close-and-reopen.md`); the month-end revaluation of the boxes (`currency/month-end-revaluation.md`). A count's entry is in the box's currency and its two lines are equal, so it is the same in every currency shape and leaves no residual: the shapes are not repeated here. A count with no entry has nothing to reverse and cannot be cancelled (rule 14): a case cannot state it, since a `reversal` names an entry.

### A shortage in the TRY box

The TRY box holds 34,500.00 TRY after S11's example exchange; on 3 December the accountant counts 34,450.00 TRY. The 50.00 TRY shortage is measured at the rates of the day: 50.00 / 34 (market) in the book, × 3.5 (bulletin) in the parallel ledger. Both lines are equal, so no difference is left.

```yaml
case: the TRY box counted at 34,450.00 against 34,500.00; a 50.00 TRY shortage to 532007 at 34 and 3.5
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin } }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-01, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
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
  - voucher: the TRY box counted
    accounting_date: 2026-12-03
    payload: { description: "جرد نهاية اليوم",
               voucher: { kind: count, cash_account: "111005", counted: 3445000, expected: 3450000 } }
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
        # as in S11's example (cash/transfer-and-exchange.md)
        - { account: "111005", currency: TRY, amount: 3450000, book: 100000, parallel: 12075000 }
        - { account: "532002", currency: USD, amount: 1000, book: 1000, parallel: 120000 }
        - { account: "111002", currency: USD, amount: -101000, book: -101000, parallel: -12120000 }
        - { account: "421001", currency: SYP, amount: -75000, book: 0, parallel: -75000 }
    - source: manual
      date: 2026-12-03
      lines:
        # shortage: 34,500.00 − 34,450.00 = 50.00 TRY
        # book: 50.00 TRY / 34 (market) = 1.470588… → 1.47 USD; parallel: 50.00 × 3.5 = 175.00 SYP
        - { account: "532007", currency: TRY, amount: 5000, book: 147, parallel: 17500 }
        - { account: "111005", currency: TRY, amount: -5000, book: -147, parallel: -17500 }
  balances:
    # 34,450.00 TRY; book 1,000.00 − 1.47 = 998.53 USD; parallel 120,750.00 − 175.00 = 120,575.00 SYP
    - { account: "111005", currency: TRY, amount: 3445000, book: 99853, parallel: 12057500 }
    - { account: "532007", book: 147, parallel: 17500 }
  vouchers:
    - { kind: receipt, number: 1, date: 2026-12-01, cash_account: "111002", entry: 1 }
    - { kind: transfer, number: 1, date: 2026-12-01, cash_account: "111002",
        counter_cash_account: "111005", entry: 2 }
    - { kind: count, number: 1, date: 2026-12-03, cash_account: "111005", entry: 3,
        expected: 3450000, counted: 3445000 }
```

### An overage in the USD box

The USD box holds 2,000.00 USD, received on 1 December at the bulletin of 120; on 2 December the accountant counts 2,003.00 USD. The 3.00 USD overage is in the book currency, so its book amount is the amount; the parallel ledger measures it at the bulletin of the count's date, 121, not at the 120 the box was carried at.

```yaml
case: the USD box counted at 2,003.00 against 2,000.00; a 3.00 USD overage to 422002 at the 121 bulletin
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin } }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-02, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
steps:
  - voucher: the owner pays 2,000.00 USD into the USD box
    accounting_date: 2026-12-01
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 200000 },
                       { account: "313001", currency: USD, amount: -200000 }] }
  - voucher: the USD box counted
    accounting_date: 2026-12-02
    payload: { description: "جرد نهاية اليوم",
               voucher: { kind: count, cash_account: "111002", counted: 200300, expected: 200000 } }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        # parallel: 2,000.00 USD × 120 = 240,000.00 SYP
        - { account: "111002", currency: USD, amount: 200000, book: 200000, parallel: 24000000 }
        - { account: "313001", currency: USD, amount: -200000, book: -200000, parallel: -24000000 }
    - source: manual
      date: 2026-12-02
      lines:
        # overage: 2,003.00 − 2,000.00 = 3.00 USD; parallel: 3.00 × 121 = 363.00 SYP
        - { account: "111002", currency: USD, amount: 300, book: 300, parallel: 36300 }
        - { account: "422002", currency: USD, amount: -300, book: -300, parallel: -36300 }
  balances:
    # 2,003.00 USD; parallel 240,000.00 + 363.00 = 240,363.00 SYP
    - { account: "111002", currency: USD, amount: 200300, book: 200300, parallel: 24036300 }
    - { account: "422002", book: -300, parallel: -36300 }
  vouchers:
    - { kind: receipt, number: 1, date: 2026-12-01, cash_account: "111002", entry: 1 }
    - { kind: count, number: 1, date: 2026-12-02, cash_account: "111002", entry: 2,
        expected: 200000, counted: 200300 }
```

### A count that matches

The USD box holds 2,000.00 USD and the accountant counts 2,000.00 USD. The count is recorded with its number and no entry; no rate of the count's date is read.

```yaml
case: the USD box counted at 2,000.00 against 2,000.00; the count recorded with no entry
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
  - voucher: the USD box counted
    accounting_date: 2026-12-02
    payload: { description: "جرد نهاية اليوم",
               voucher: { kind: count, cash_account: "111002", counted: 200000, expected: 200000 } }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "111002", currency: USD, amount: 200000, book: 200000, parallel: 24000000 }
        - { account: "313001", currency: USD, amount: -200000, book: -200000, parallel: -24000000 }
  balances:
    - { account: "111002", currency: USD, amount: 200000, book: 200000, parallel: 24000000 }
  vouchers:
    - { kind: receipt, number: 1, date: 2026-12-01, cash_account: "111002", entry: 1 }
    - { kind: count, number: 1, date: 2026-12-02, cash_account: "111002", entry: null,
        expected: 200000, counted: 200000 }
```

### A stale count refused, then counted again

The accountant previews a count of the USD box on 2 December while it holds 2,000.00 USD, and counts 1,948.00 USD. Before the count is posted, a payment of 50.00 USD for stationery from the same box posts. At posting the expected balance is 1,950.00, not the 2,000.00 the preview showed, so the count is refused with the new expected amount: posted as previewed, it would have booked a 52.00 USD shortage for cash that was paid out. Nothing is recorded and no number is taken. The accountant counts again against 1,950.00: a 2.00 USD shortage, count number 1.

```yaml
case: a count previewed at 2,000.00 refused after a 50.00 USD payment; counted again, a 2.00 USD shortage
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin } }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-02, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: the owner pays 2,000.00 USD into the USD box
    accounting_date: 2026-12-01
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 200000 },
                       { account: "313001", currency: USD, amount: -200000 }] }
  - voucher: stationery paid from the USD box after the count's preview
    accounting_date: 2026-12-02
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "مكتبة" },
               lines: [{ account: "531005", currency: USD, amount: 5000 },
                       { account: "111002", currency: USD, amount: -5000 }] }
  - voucher: the USD box counted, posted with the preview's expected 2,000.00
    accounting_date: 2026-12-02
    payload: { description: "جرد نهاية اليوم",
               voucher: { kind: count, cash_account: "111002", counted: 194800, expected: 200000 } }
    # the expected balance at posting: 2,000.00 − 50.00 = 1,950.00 USD
    outcome: { status: refused, reason: CASH_COUNT_STALE, detail: "expected:195000" }
  - voucher: the USD box counted again
    accounting_date: 2026-12-02
    payload: { description: "جرد نهاية اليوم",
               voucher: { kind: count, cash_account: "111002", counted: 194800, expected: 195000 } }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "111002", currency: USD, amount: 200000, book: 200000, parallel: 24000000 }
        - { account: "313001", currency: USD, amount: -200000, book: -200000, parallel: -24000000 }
    - source: manual
      date: 2026-12-02
      lines:
        # parallel: 50.00 × 120 = 6,000.00 SYP
        - { account: "531005", currency: USD, amount: 5000, book: 5000, parallel: 600000 }
        - { account: "111002", currency: USD, amount: -5000, book: -5000, parallel: -600000 }
    - source: manual
      date: 2026-12-02
      lines:
        # shortage: 1,950.00 − 1,948.00 = 2.00 USD; parallel: 2.00 × 120 = 240.00 SYP
        - { account: "532007", currency: USD, amount: 200, book: 200, parallel: 24000 }
        - { account: "111002", currency: USD, amount: -200, book: -200, parallel: -24000 }
  balances:
    # 1,948.00 USD; parallel 240,000.00 − 6,000.00 − 240.00 = 233,760.00 SYP
    - { account: "111002", currency: USD, amount: 194800, book: 194800, parallel: 23376000 }
    - { account: "532007", book: 200, parallel: 24000 }
  vouchers:
    # the refused count took no number: the recorded one is count 1
    - { kind: receipt, number: 1, date: 2026-12-01, cash_account: "111002", entry: 1 }
    - { kind: payment, number: 1, date: 2026-12-02, cash_account: "111002", entry: 2 }
    - { kind: count, number: 1, date: 2026-12-02, cash_account: "111002", entry: 3,
        expected: 195000, counted: 194800 }
```

### A count's voucher cancelled

The TRY box's shortage of the first case, cancelled the same day: the cancellation is the exact reversal of the count's entry (S03 rule 9, S11 rule 14), and the box is back at 34,500.00 TRY in every amount. The count keeps its number and shows the reversal that cancelled it.

```yaml
case: the 50.00 TRY shortage cancelled; the box back at 34,500.00 TRY and the count kept as cancelled
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin } }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-01, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
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
  - voucher: the TRY box counted
    accounting_date: 2026-12-03
    payload: { description: "جرد نهاية اليوم",
               voucher: { kind: count, cash_account: "111005", counted: 3445000, expected: 3450000 } }
  - reversal: 3
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
      date: 2026-12-03
      lines:
        # as in the first case
        - { account: "532007", currency: TRY, amount: 5000, book: 147, parallel: 17500 }
        - { account: "111005", currency: TRY, amount: -5000, book: -147, parallel: -17500 }
    - source: reversal
      date: 2026-12-03
      lines:
        # entry 3 exactly, signs reversed
        - { account: "532007", currency: TRY, amount: -5000, book: -147, parallel: -17500 }
        - { account: "111005", currency: TRY, amount: 5000, book: 147, parallel: 17500 }
  balances:
    - { account: "111005", currency: TRY, amount: 3450000, book: 100000, parallel: 12075000 }
    - { account: "532007", book: 0, parallel: 0 }
  vouchers:
    - { kind: receipt, number: 1, date: 2026-12-01, cash_account: "111002", entry: 1 }
    - { kind: transfer, number: 1, date: 2026-12-01, cash_account: "111002",
        counter_cash_account: "111005", entry: 2 }
    - { kind: count, number: 1, date: 2026-12-03, cash_account: "111005", entry: 3,
        expected: 3450000, counted: 3445000, cancelled_by: 4 }
```
