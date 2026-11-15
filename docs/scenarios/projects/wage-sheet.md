# A wage sheet

Status: Proposed

The expected entries of the seven cases were approved by the owner on 2026-11-16, with four readings of S12 rule 10: each line of the sheet is converted on its own and the residual is conversion rounding (S03 rule 14), not a credit computed from the converted debits; a sheet dated other than its period's last day is refused, not redated; days with more than one decimal place are refused; and a lump sum needs its description. They stay `Proposed` until S12's slice brings the `project_document` executor and the project documents' and quantities' readers.

## Rule

A wage sheet (كشف أجور) is a numbered project document. It names the project, one currency and a period within one calendar month, and is dated the period's last day. Each line names a worker, with either days × a daily rate or a lump sum with a description (piece work, مقطوعية). Days are a quantity with at most one decimal place, in the unit "يوم". A line's amount is the days times the daily rate, rounded half away from zero to the currency's minor unit (`lineAmount()`); a lump sum's amount is typed. A worker may have several lines. The sheet posts each line as a debit on `511002` carrying the project and the worker, a new measurement. It posts one credit per worker on `211007`, the worker's running item, carrying the project and equal to the sum of that worker's lines. Against a worker's debit balance (an advance paid earlier) the credit first clears the balance at its average carrying amount, then measures the excess new, and each ledger's residual is realised. An entry with no carried line converts each line on its own, and conversion rounding goes to the rounding account. A days line carries its quantity and daily rate; a lump sum carries no quantity. Wages are paid by payment vouchers on `211007`. Cancelling the sheet reverses its entry, quantities included, and the sheet keeps its number.

## Basis

- **IAS 19.11:** short-term employee benefits are recognised as an expense when the service is rendered. The sheet's period lies in one month and the sheet is dated its last day, so the wage is a cost of the month the work was done. **IAS 1.102:** the cost is presented by nature under `is.direct_costs`, carrying its contract.
- **IAS 21.21–22:** each line is recorded at the spot rate of the sheet's date (the ledger's policy rate). **IAS 21.23(a) and 21.28:** a worker's balance is monetary, so clearing a debit balance at its carrying amount, or paying a credit balance after the rate moved, realises an exchange difference.
- **Company policy:** S12 rules 4, 6, 10, 11, 21 and 22, its owner's answers 2 and 11, its "Accounting treatment" and its "Currencies, rates and rounding" (owner, 2026-11-16; ADR 0023): no payroll calculation, no tax and no deductions, a worker's advance netted in the worker's running balance. Also S04 rules 3, 10 and 13 (running items, residuals, reopening by reversal); S03 rules 9 and 14 (the accountant's reversal, the conversion rounding line); S11 rules 8 and 11 (payment vouchers, the box never below zero); ADR 0007 (rounding lines). The client's currencies: a USD book at `market` accepting dealt rates and an SYP parallel ledger at the bulletin (S11, ADR 0021).
- **Syrian rules:** the bulletin for the parallel ledger, UNVERIFIED (Q1), adopted by the owner as the company's policy; a daily TRY/SYP bulletin, UNVERIFIED (Q10), assumed by the owner (S11); Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting. Syrian labour and social-insurance rules are out of S12's scope: the sheet records amounts the accountant types.

## Cases

The company is the contracting client's shape unless a case says otherwise: `usd-syp`, the USD book at `market` accepting dealt rates, the SYP parallel ledger at the bulletin, TRY as a third currency, and the chart `contracting@1` (S11 "Templates"):
- the USD box `111002`;
- workers and craftsmen `211007`, a running control account for workers, monetary, with the worker required;
- the owner's current account `313001`;
- wages of workers and craftsmen `511002`, requiring the contract;
- realised exchange gains `421001` and losses `541001`, and conversion rounding `541003`.

Project P1 belongs to client C1. W1 to W4 are workers. Every rate and amount is synthetic. Monday 7, Tuesday 15, Thursday 17 and Thursday 31 December 2026 are publication days.

A `project_document` step for a wage sheet is the document as the form sends it (S12 "Drafts"):
- `document`: `kind: wage_sheet`, the `contract`, the `currency`, `period_from` and `period_to`;
- `lines`: each with its `worker` and either `days` (a quoted decimal as typed) and `daily_rate` (a quoted decimal with 4 places), or a typed `amount` with its `description`.

The step is saved as a draft and posted from it. Its date is the sheet's date, and its entry has the source `manual`. `project_documents` states the exact set of the company's project documents. For a wage sheet: kind, number in its kind and fiscal year, date, project and its client, the entry it posted and the reversal that cancelled it (posting order), currency, and the period. `quantities` states the exact set of line quantities: a days line has no material, the unit "يوم", its days with 3 places, and its daily rate as the unit price.

A difference or rounding line carries its amount in one ledger only, in that ledger's currency (ADR 0007).

The cases leave out what other scenarios own:
- a payment to a worker beyond the worker's balance, crossing zero (`cash/receipt-and-payment.md`);
- the month-end revaluation of `211007` (`currency/month-end-revaluation.md`);
- a sheet dated in a closed period, refused as any posting there (`periods/close-and-reopen.md`);
- the project report's wages tab (`reports/project-report.md`).

### S12's example: days and a lump sum, then paid by payment vouchers

The sheet for P1 covers 1–15 December and is dated Tuesday 15 December, at the bulletin 120.0000. Worker W1 is paid 6 days × 25.00 USD = 150.00. Craftsman W2 is paid a lump sum of 400.00 USD for "نجارة قوالب الطابق الأول". Each line is a debit on `511002` with the project and the worker. Each worker's credit is a new running item, and nothing is left over in either ledger.

The same day the owner puts 1,000.00 USD into the USD box, and the box pays W1's 150.00 in full. W1's item clears at what it carries, so no difference arises. On Thursday 17 December, at 121.0000, the box pays W2 300.00 USD on account. The payment clears 300/400 of W2's item at its average carrying amount. Paying 300.00 USD cost 36,300.00 SYP for a debt carried at 36,000.00, so the parallel ledger realises a loss of 300.00 SYP. W2 is still owed 100.00 USD.

```yaml
case: S12's example; W1 6 days × 25.00 and W2 a 400.00 lump sum at 120; W1 paid in full, W2 paid 300.00 at 121
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-15, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-17, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
steps:
  - project_document: the wage sheet of P1 for 1–15 December
    accounting_date: 2026-12-15
    payload: { document: { kind: wage_sheet, contract: P1, currency: USD, period_from: 2026-12-01, period_to: 2026-12-15 },
               lines: [{ worker: W1, days: "6.0", daily_rate: "25.0000" },
                       { worker: W2, amount: 40000, description: "نجارة قوالب الطابق الأول" }] }
  - voucher: the owner pays 1,000.00 USD into the USD box
    accounting_date: 2026-12-15
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 100000 },
                       { account: "313001", currency: USD, amount: -100000 }] }
  - voucher: W1's wages paid in full
    accounting_date: 2026-12-15
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "العامل" },
               lines: [{ account: "211007", dims: { worker: W1 }, currency: USD, amount: 15000 },
                       { account: "111002", currency: USD, amount: -15000 }] }
  - voucher: 300.00 USD paid to W2 on account
    accounting_date: 2026-12-17
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "الحرفي" },
               lines: [{ account: "211007", dims: { worker: W2 }, currency: USD, amount: 30000 },
                       { account: "111002", currency: USD, amount: -30000 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-15
      lines:
        # 6.0 days × 25.0000 = 150.00 USD; parallel: × 120 = 18,000.00 SYP
        - { account: "511002", dims: { contract: P1, worker: W1 }, currency: USD, amount: 15000, book: 15000, parallel: 1800000 }
        # the lump sum typed: 400.00 USD; × 120 = 48,000.00 SYP
        - { account: "511002", dims: { contract: P1, worker: W2 }, currency: USD, amount: 40000, book: 40000, parallel: 4800000 }
        # one credit per worker, a new running item, with the project on the line
        - { account: "211007", dims: { worker: W1, contract: P1 }, currency: USD, amount: -15000, book: -15000, parallel: -1800000 }
        - { account: "211007", dims: { worker: W2, contract: P1 }, currency: USD, amount: -40000, book: -40000, parallel: -4800000 }
    - source: manual
      date: 2026-12-15
      lines:
        # 1,000.00 USD × 120 = 120,000.00 SYP
        - { account: "111002", currency: USD, amount: 100000, book: 100000, parallel: 12000000 }
        - { account: "313001", currency: USD, amount: -100000, book: -100000, parallel: -12000000 }
    - source: manual
      date: 2026-12-15
      lines:
        # W1's whole balance at what it carries; the box at 120: the same 18,000.00 SYP, no difference
        - { account: "211007", dims: { worker: W1 }, currency: USD, amount: 15000, book: 15000, parallel: 1800000 }
        - { account: "111002", currency: USD, amount: -15000, book: -15000, parallel: -1800000 }
    - source: manual
      date: 2026-12-17
      lines:
        # 300 of W2's 400 cleared at the average: parallel 4,800,000 × 300 / 400 = 3,600,000
        - { account: "211007", dims: { worker: W2 }, currency: USD, amount: 30000, book: 30000, parallel: 3600000 }
        # 300.00 USD × 121 = 36,300.00 SYP
        - { account: "111002", currency: USD, amount: -30000, book: -30000, parallel: -3630000 }
        # book residual 0; parallel residual: 3,600,000 − 3,630,000 = −30,000 → a debit: realised loss 300.00 SYP
        - { account: "541001", currency: SYP, amount: 30000, book: 0, parallel: 30000 }
  balances:
    - { account: "511002", dims: { contract: P1 }, book: 55000, parallel: 6600000 }
    # 1,000.00 − 150.00 − 300.00 = 550.00 USD; parallel 12,000,000 − 1,800,000 − 3,630,000 = 6,570,000
    - { account: "111002", currency: USD, amount: 55000, book: 55000, parallel: 6570000 }
    - { account: "211007", book: -10000, parallel: -1200000 }
    - { account: "541001", book: 0, parallel: 30000 }
  open_items:
    - { item: W1, account: "211007", dims: { worker: W1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    # W2 is owed 100.00 USD, the rest of the item at its average: 4,800,000 − 3,600,000 = 1,200,000
    - { item: W2, account: "211007", dims: { worker: W2 }, currency: USD, amount: -10000, book: -10000, parallel: -1200000 }
  vouchers:
    - { kind: receipt, number: 1, date: 2026-12-15, cash_account: "111002", entry: 2 }
    - { kind: payment, number: 1, date: 2026-12-15, cash_account: "111002", entry: 3 }
    - { kind: payment, number: 2, date: 2026-12-17, cash_account: "111002", entry: 4 }
  project_documents:
    - { kind: wage_sheet, number: 1, date: 2026-12-15, contract: P1, client: C1, entry: 1, currency: USD,
        period_from: 2026-12-01, period_to: 2026-12-15 }
  quantities:
    # the days line only: a lump sum carries no quantity (S12 rule 4)
    - { entry: 1, account: "511002", currency: USD, amount: 15000, unit: "يوم", quantity: "6.000", unit_price: "25.0000" }
```

### A worker's earlier advance netted in the sheet

On Monday 7 December, at the bulletin 118.0000, the owner puts 100.00 USD into the USD box and the box advances it to W1. The advance is a payment on `211007`, a debit item carried at 11,800.00 SYP. The example's sheet on 15 December, at 120.0000, credits W1 150.00 and crosses zero (S04 rule 3). The credit first clears the 100.00 debit at what it carries, then adds the remaining 50.00 as a new measurement (S12 edge case 13). W2's credit is new as before. The 100.00 USD W1 owed was worth 11,800.00 SYP on 7 December and is worth 12,000.00 on 15 December. The parallel ledger therefore realises a gain of 200.00 SYP. The USD book has no residual.

```yaml
case: 100.00 USD advanced to W1 at 118; S12's sheet at 120 clears it and adds 50.00 new; a parallel gain of 200.00 SYP
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-07, base: USD, quote: SYP, rate: "118.0000", type: bulletin }
  - { date: 2026-12-15, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: the owner pays 100.00 USD into the USD box
    accounting_date: 2026-12-07
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 10000 },
                       { account: "313001", currency: USD, amount: -10000 }] }
  - voucher: an advance of 100.00 USD to W1
    accounting_date: 2026-12-07
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "العامل" },
               lines: [{ account: "211007", dims: { worker: W1 }, currency: USD, amount: 10000 },
                       { account: "111002", currency: USD, amount: -10000 }] }
  - project_document: the wage sheet of P1 for 1–15 December
    accounting_date: 2026-12-15
    payload: { document: { kind: wage_sheet, contract: P1, currency: USD, period_from: 2026-12-01, period_to: 2026-12-15 },
               lines: [{ worker: W1, days: "6.0", daily_rate: "25.0000" },
                       { worker: W2, amount: 40000, description: "نجارة قوالب الطابق الأول" }] }
expect:
  entries:
    - source: manual
      date: 2026-12-07
      lines:
        # 100.00 USD × 118 = 11,800.00 SYP
        - { account: "111002", currency: USD, amount: 10000, book: 10000, parallel: 1180000 }
        - { account: "313001", currency: USD, amount: -10000, book: -10000, parallel: -1180000 }
    - source: manual
      date: 2026-12-07
      lines:
        # a new running item for W1 in USD, a debit
        - { account: "211007", dims: { worker: W1 }, currency: USD, amount: 10000, book: 10000, parallel: 1180000 }
        - { account: "111002", currency: USD, amount: -10000, book: -10000, parallel: -1180000 }
    - source: manual
      date: 2026-12-15
      lines:
        - { account: "511002", dims: { contract: P1, worker: W1 }, currency: USD, amount: 15000, book: 15000, parallel: 1800000 }
        - { account: "511002", dims: { contract: P1, worker: W2 }, currency: USD, amount: 40000, book: 40000, parallel: 4800000 }
        # W1's credit split at zero: first the whole 100.00 debit, cleared at what it carries
        - { account: "211007", dims: { worker: W1, contract: P1 }, currency: USD, amount: -10000, book: -10000, parallel: -1180000 }
        # then the 150.00 − 100.00 = 50.00 USD beyond zero, new: × 120 = 6,000.00 SYP
        - { account: "211007", dims: { worker: W1, contract: P1 }, currency: USD, amount: -5000, book: -5000, parallel: -600000 }
        - { account: "211007", dims: { worker: W2, contract: P1 }, currency: USD, amount: -40000, book: -40000, parallel: -4800000 }
        # book residual 0; parallel residual: 1,800,000 + 4,800,000 − 1,180,000 − 600,000 − 4,800,000 = 20,000
        #   → a credit: realised gain 200.00 SYP
        - { account: "421001", currency: SYP, amount: -20000, book: 0, parallel: -20000 }
  balances:
    - { account: "511002", dims: { contract: P1 }, book: 55000, parallel: 6600000 }
    - { account: "111002", currency: USD, amount: 0, book: 0, parallel: 0 }
    # W1 −50.00 and W2 −400.00: book −45,000; parallel −600,000 − 4,800,000 = −5,400,000
    - { account: "211007", book: -45000, parallel: -5400000 }
    - { account: "421001", book: 0, parallel: -20000 }
  open_items:
    - { item: W1, account: "211007", dims: { worker: W1 }, currency: USD, amount: -5000, book: -5000, parallel: -600000 }
    - { item: W2, account: "211007", dims: { worker: W2 }, currency: USD, amount: -40000, book: -40000, parallel: -4800000 }
  vouchers:
    - { kind: receipt, number: 1, date: 2026-12-07, cash_account: "111002", entry: 1 }
    - { kind: payment, number: 1, date: 2026-12-07, cash_account: "111002", entry: 2 }
  project_documents:
    - { kind: wage_sheet, number: 1, date: 2026-12-15, contract: P1, client: C1, entry: 3, currency: USD,
        period_from: 2026-12-01, period_to: 2026-12-15 }
  quantities:
    - { entry: 3, account: "511002", currency: USD, amount: 15000, unit: "يوم", quantity: "6.000", unit_price: "25.0000" }
```

### The same advance in SYP books with a USD parallel ledger

The previous case in a company with SYP books at the bulletin and a USD parallel ledger at the market. The USD parallel ledger takes every USD amount as it is, so it has no residual. The SYP book now realises the 200.00 SYP gain on W1's advance.

```yaml
case: syp-usd; 100.00 USD advanced to W1 at 118; S12's sheet at 120 nets it; a book gain of 200.00 SYP
company: { shape: syp-usd, book: SYP, parallel: USD, template: contracting,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-07, base: USD, quote: SYP, rate: "118.0000", type: bulletin }
  - { date: 2026-12-15, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: the owner pays 100.00 USD into the USD box
    accounting_date: 2026-12-07
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 10000 },
                       { account: "313001", currency: USD, amount: -10000 }] }
  - voucher: an advance of 100.00 USD to W1
    accounting_date: 2026-12-07
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "العامل" },
               lines: [{ account: "211007", dims: { worker: W1 }, currency: USD, amount: 10000 },
                       { account: "111002", currency: USD, amount: -10000 }] }
  - project_document: the wage sheet of P1 for 1–15 December
    accounting_date: 2026-12-15
    payload: { document: { kind: wage_sheet, contract: P1, currency: USD, period_from: 2026-12-01, period_to: 2026-12-15 },
               lines: [{ worker: W1, days: "6.0", daily_rate: "25.0000" },
                       { worker: W2, amount: 40000, description: "نجارة قوالب الطابق الأول" }] }
expect:
  entries:
    - source: manual
      date: 2026-12-07
      lines:
        # book: 100.00 USD × 118 = 11,800.00 SYP; parallel: USD as is
        - { account: "111002", currency: USD, amount: 10000, book: 1180000, parallel: 10000 }
        - { account: "313001", currency: USD, amount: -10000, book: -1180000, parallel: -10000 }
    - source: manual
      date: 2026-12-07
      lines:
        - { account: "211007", dims: { worker: W1 }, currency: USD, amount: 10000, book: 1180000, parallel: 10000 }
        - { account: "111002", currency: USD, amount: -10000, book: -1180000, parallel: -10000 }
    - source: manual
      date: 2026-12-15
      lines:
        # book: × 120
        - { account: "511002", dims: { contract: P1, worker: W1 }, currency: USD, amount: 15000, book: 1800000, parallel: 15000 }
        - { account: "511002", dims: { contract: P1, worker: W2 }, currency: USD, amount: 40000, book: 4800000, parallel: 40000 }
        # the 100.00 debit cleared at what it carries, then 50.00 new at 120
        - { account: "211007", dims: { worker: W1, contract: P1 }, currency: USD, amount: -10000, book: -1180000, parallel: -10000 }
        - { account: "211007", dims: { worker: W1, contract: P1 }, currency: USD, amount: -5000, book: -600000, parallel: -5000 }
        - { account: "211007", dims: { worker: W2, contract: P1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
        # book residual: 1,800,000 + 4,800,000 − 1,180,000 − 600,000 − 4,800,000 = 20,000 → a credit:
        #   realised gain 200.00 SYP; parallel residual 0
        - { account: "421001", currency: SYP, amount: -20000, book: -20000, parallel: 0 }
  balances:
    - { account: "511002", dims: { contract: P1 }, book: 6600000, parallel: 55000 }
    - { account: "211007", book: -5400000, parallel: -45000 }
    - { account: "421001", book: -20000, parallel: 0 }
  open_items:
    - { item: W1, account: "211007", dims: { worker: W1 }, currency: USD, amount: -5000, book: -600000, parallel: -5000 }
    - { item: W2, account: "211007", dims: { worker: W2 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
  project_documents:
    - { kind: wage_sheet, number: 1, date: 2026-12-15, contract: P1, client: C1, entry: 3, currency: USD,
        period_from: 2026-12-01, period_to: 2026-12-15 }
  quantities:
    - { entry: 3, account: "511002", currency: USD, amount: 15000, unit: "يوم", quantity: "6.000", unit_price: "25.0000" }
```

### A TRY sheet: half days, several lines per worker, a conversion rounding line

The December sheet of P1 is in TRY and dated Thursday 31 December, at the market 34.0000 TRY per USD and the bulletin 3.5000 SYP per TRY (S12 edge case 14). Its lines:
- W3: 12.5 days × 860.0000 TRY = 10,750.00;
- W3: a lump sum of 1,500.00 TRY for "تمديدات كهربائية للطابق الأول";
- W4: 1.5 days × 933.3300 TRY = 1,399.995, which rounds half away from zero to 1,400.00.

W3's credit is one line for the sum of W3's two lines, 12,250.00 TRY. The book converts every line on its own at 34. W3's two debits round up to 316.18 and 44.12 USD, while the credit of 12,250.00 / 34 = 360.294… rounds to 360.29. That leaves the book 0.01 USD out of balance: conversion rounding, one credit line to `541003` in the book only (S03 rule 14). It is not an exchange difference, since the entry carries no earlier amount. The parallel ledger converts exactly at 3.5.

```yaml
case: a TRY sheet at 34 and 3.5; W3 12.5 days × 860.0000 and a 1,500.00 lump sum; W4 1.5 days × 933.3300; a book rounding line of 0.01 USD
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-31, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - project_document: the TRY wage sheet of P1 for December
    accounting_date: 2026-12-31
    payload: { document: { kind: wage_sheet, contract: P1, currency: TRY, period_from: 2026-12-01, period_to: 2026-12-31 },
               lines: [{ worker: W3, days: "12.5", daily_rate: "860.0000" },
                       { worker: W3, amount: 150000, description: "تمديدات كهربائية للطابق الأول" },
                       { worker: W4, days: "1.5", daily_rate: "933.3300" }] }
expect:
  entries:
    - source: manual
      date: 2026-12-31
      lines:
        # 12.5 × 860.0000 = 10,750.00 TRY; book: / 34 = 316.1764… → 316.18 USD; parallel: × 3.5 = 37,625.00 SYP
        - { account: "511002", dims: { contract: P1, worker: W3 }, currency: TRY, amount: 1075000, book: 31618, parallel: 3762500 }
        # 1,500.00 TRY; book: / 34 = 44.1176… → 44.12 USD; parallel: × 3.5 = 5,250.00 SYP
        - { account: "511002", dims: { contract: P1, worker: W3 }, currency: TRY, amount: 150000, book: 4412, parallel: 525000 }
        # 1.5 × 933.3300 = 1,399.995 → 1,400.00 TRY; book: / 34 = 41.1764… → 41.18 USD; parallel: × 3.5 = 4,900.00 SYP
        - { account: "511002", dims: { contract: P1, worker: W4 }, currency: TRY, amount: 140000, book: 4118, parallel: 490000 }
        # W3: 10,750.00 + 1,500.00 = 12,250.00 TRY; book: / 34 = 360.2941… → 360.29 USD; parallel: × 3.5 = 42,875.00 SYP
        - { account: "211007", dims: { worker: W3, contract: P1 }, currency: TRY, amount: -1225000, book: -36029, parallel: -4287500 }
        # W4: 1,400.00 TRY; 41.18 USD; 4,900.00 SYP
        - { account: "211007", dims: { worker: W4, contract: P1 }, currency: TRY, amount: -140000, book: -4118, parallel: -490000 }
        # book residual: 31,618 + 4,412 + 4,118 − 36,029 − 4,118 = 1 → a credit of 0.01 USD, within
        #   5 converted lines × 0.5 = 2.5 minor units; parallel residual 0
        - { account: "541003", currency: USD, amount: -1, book: -1, parallel: 0 }
  balances:
    # 316.18 + 44.12 + 41.18 = 401.48 USD; 37,625.00 + 5,250.00 + 4,900.00 = 47,775.00 SYP
    - { account: "511002", dims: { contract: P1 }, book: 40148, parallel: 4777500 }
    - { account: "541003", book: -1, parallel: 0 }
  open_items:
    - { item: W3, account: "211007", dims: { worker: W3 }, currency: TRY, amount: -1225000, book: -36029, parallel: -4287500 }
    - { item: W4, account: "211007", dims: { worker: W4 }, currency: TRY, amount: -140000, book: -4118, parallel: -490000 }
  project_documents:
    - { kind: wage_sheet, number: 1, date: 2026-12-31, contract: P1, client: C1, entry: 1, currency: TRY,
        period_from: 2026-12-01, period_to: 2026-12-31 }
  quantities:
    - { entry: 1, account: "511002", currency: TRY, amount: 1075000, unit: "يوم", quantity: "12.500", unit_price: "860.0000" }
    - { entry: 1, account: "511002", currency: TRY, amount: 140000, unit: "يوم", quantity: "1.500", unit_price: "933.3300" }
```

### The TRY sheet in SYP books with a USD parallel ledger

The previous sheet in a company with SYP books at the bulletin and a USD parallel ledger at the market, TRY being the third currency. The SYP book converts exactly at 3.5. The USD parallel ledger now carries the 0.01 USD rounding line.

```yaml
case: third; the TRY sheet in SYP books with a USD parallel; a parallel rounding line of 0.01 USD
company: { shape: third, book: SYP, parallel: USD, template: contracting,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-31, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - project_document: the TRY wage sheet of P1 for December
    accounting_date: 2026-12-31
    payload: { document: { kind: wage_sheet, contract: P1, currency: TRY, period_from: 2026-12-01, period_to: 2026-12-31 },
               lines: [{ worker: W3, days: "12.5", daily_rate: "860.0000" },
                       { worker: W3, amount: 150000, description: "تمديدات كهربائية للطابق الأول" },
                       { worker: W4, days: "1.5", daily_rate: "933.3300" }] }
expect:
  entries:
    - source: manual
      date: 2026-12-31
      lines:
        # book × 3.5; parallel / 34, as the previous case with the ledgers swapped
        - { account: "511002", dims: { contract: P1, worker: W3 }, currency: TRY, amount: 1075000, book: 3762500, parallel: 31618 }
        - { account: "511002", dims: { contract: P1, worker: W3 }, currency: TRY, amount: 150000, book: 525000, parallel: 4412 }
        - { account: "511002", dims: { contract: P1, worker: W4 }, currency: TRY, amount: 140000, book: 490000, parallel: 4118 }
        - { account: "211007", dims: { worker: W3, contract: P1 }, currency: TRY, amount: -1225000, book: -4287500, parallel: -36029 }
        - { account: "211007", dims: { worker: W4, contract: P1 }, currency: TRY, amount: -140000, book: -490000, parallel: -4118 }
        # parallel residual: 31,618 + 4,412 + 4,118 − 36,029 − 4,118 = 1 → a credit of 0.01 USD in the parallel ledger only
        - { account: "541003", currency: USD, amount: -1, book: 0, parallel: -1 }
  balances:
    - { account: "511002", dims: { contract: P1 }, book: 4777500, parallel: 40148 }
    - { account: "541003", book: 0, parallel: -1 }
  open_items:
    - { item: W3, account: "211007", dims: { worker: W3 }, currency: TRY, amount: -1225000, book: -4287500, parallel: -36029 }
    - { item: W4, account: "211007", dims: { worker: W4 }, currency: TRY, amount: -140000, book: -490000, parallel: -4118 }
  project_documents:
    - { kind: wage_sheet, number: 1, date: 2026-12-31, contract: P1, client: C1, entry: 1, currency: TRY,
        period_from: 2026-12-01, period_to: 2026-12-31 }
  quantities:
    - { entry: 1, account: "511002", currency: TRY, amount: 1075000, unit: "يوم", quantity: "12.500", unit_price: "860.0000" }
    - { entry: 1, account: "511002", currency: TRY, amount: 140000, unit: "يوم", quantity: "1.500", unit_price: "933.3300" }
```

### An SYP sheet in SYP books only

A company with SYP books and no parallel ledger pays its workers in SYP. W1 is paid 6 days × 3,000.00 SYP = 18,000.00 and W2 a lump sum of 48,000.00 SYP, for 1–15 December. Nothing is converted, so the sheet reads no rate.

```yaml
case: syp; an SYP sheet of 6 days × 3,000.00 and a 48,000.00 lump sum; no rate read
company: { shape: syp, book: SYP, template: contracting, rate_policy: { book: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }] }
steps:
  - project_document: the SYP wage sheet of P1 for 1–15 December
    accounting_date: 2026-12-15
    payload: { document: { kind: wage_sheet, contract: P1, currency: SYP, period_from: 2026-12-01, period_to: 2026-12-15 },
               lines: [{ worker: W1, days: "6.0", daily_rate: "3000.0000" },
                       { worker: W2, amount: 4800000, description: "نجارة قوالب الطابق الأول" }] }
expect:
  entries:
    - source: manual
      date: 2026-12-15
      lines:
        # 6.0 × 3,000.0000 = 18,000.00 SYP
        - { account: "511002", dims: { contract: P1, worker: W1 }, currency: SYP, amount: 1800000, book: 1800000 }
        - { account: "511002", dims: { contract: P1, worker: W2 }, currency: SYP, amount: 4800000, book: 4800000 }
        - { account: "211007", dims: { worker: W1, contract: P1 }, currency: SYP, amount: -1800000, book: -1800000 }
        - { account: "211007", dims: { worker: W2, contract: P1 }, currency: SYP, amount: -4800000, book: -4800000 }
  balances:
    - { account: "511002", dims: { contract: P1 }, book: 6600000 }
  open_items:
    - { item: W1, account: "211007", dims: { worker: W1 }, currency: SYP, amount: -1800000, book: -1800000 }
    - { item: W2, account: "211007", dims: { worker: W2 }, currency: SYP, amount: -4800000, book: -4800000 }
  project_documents:
    - { kind: wage_sheet, number: 1, date: 2026-12-15, contract: P1, client: C1, entry: 1, currency: SYP,
        period_from: 2026-12-01, period_to: 2026-12-15 }
  quantities:
    - { entry: 1, account: "511002", currency: SYP, amount: 1800000, unit: "يوم", quantity: "6.000", unit_price: "3000.0000" }
```

### Refused sheets, the cancellation, and the sheet posted again

The accountant's sheets for P1 are refused whole, one by one (`VALIDATION_FAILED`), and none takes a number:
- a sheet for 1–15 December dated 14 December, not the period's last day (S12 rule 10);
- 2.25 days, more than one decimal place (rule 10);
- a lump sum with no description (rule 10).

The example's sheet then posts as wage sheet 1. Later that day the accountant finds that W1 worked 5.5 days, not 6, and cancels the sheet by reversing its entry (S12 rule 22). The reversal negates every line as posted, reads no rate, and carries the negated quantity (S12 rule 4). Both workers' balances are back to zero with no difference entry (S04 rule 13). The corrected sheet posts as wage sheet 2, and the cancelled sheet keeps number 1. Last, a sheet from 25 December to 5 January is refused: its period is not within one calendar month (S12 edge case 12).

```yaml
case: three refused sheets; S12's sheet posted, cancelled and posted again with 5.5 days as sheet 2; a sheet across two months refused
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-14, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-15, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - project_document: a sheet for 1–15 December dated the 14th
    accounting_date: 2026-12-14
    payload: { document: { kind: wage_sheet, contract: P1, currency: USD, period_from: 2026-12-01, period_to: 2026-12-15 },
               lines: [{ worker: W1, days: "6.0", daily_rate: "25.0000" }] }
    outcome: { status: refused, reason: VALIDATION_FAILED }
  - project_document: a sheet with 2.25 days
    accounting_date: 2026-12-15
    payload: { document: { kind: wage_sheet, contract: P1, currency: USD, period_from: 2026-12-01, period_to: 2026-12-15 },
               lines: [{ worker: W1, days: "2.25", daily_rate: "25.0000" }] }
    outcome: { status: refused, reason: VALIDATION_FAILED }
  - project_document: a sheet with a lump sum and no description
    accounting_date: 2026-12-15
    payload: { document: { kind: wage_sheet, contract: P1, currency: USD, period_from: 2026-12-01, period_to: 2026-12-15 },
               lines: [{ worker: W2, amount: 40000 }] }
    outcome: { status: refused, reason: VALIDATION_FAILED }
  - project_document: the wage sheet of P1 for 1–15 December
    accounting_date: 2026-12-15
    payload: { document: { kind: wage_sheet, contract: P1, currency: USD, period_from: 2026-12-01, period_to: 2026-12-15 },
               lines: [{ worker: W1, days: "6.0", daily_rate: "25.0000" },
                       { worker: W2, amount: 40000, description: "نجارة قوالب الطابق الأول" }] }
  - reversal: 1
    accounting_date: 2026-12-15
  - project_document: the corrected wage sheet of P1 for 1–15 December
    accounting_date: 2026-12-15
    payload: { document: { kind: wage_sheet, contract: P1, currency: USD, period_from: 2026-12-01, period_to: 2026-12-15 },
               lines: [{ worker: W1, days: "5.5", daily_rate: "25.0000" },
                       { worker: W2, amount: 40000, description: "نجارة قوالب الطابق الأول" }] }
  - project_document: a sheet from 25 December to 5 January
    accounting_date: 2027-01-05
    payload: { document: { kind: wage_sheet, contract: P1, currency: USD, period_from: 2026-12-25, period_to: 2027-01-05 },
               lines: [{ worker: W1, days: "6.0", daily_rate: "25.0000" }] }
    outcome: { status: refused, reason: VALIDATION_FAILED }
expect:
  entries:
    - source: manual
      date: 2026-12-15
      lines:
        # as the first case
        - { account: "511002", dims: { contract: P1, worker: W1 }, currency: USD, amount: 15000, book: 15000, parallel: 1800000 }
        - { account: "511002", dims: { contract: P1, worker: W2 }, currency: USD, amount: 40000, book: 40000, parallel: 4800000 }
        - { account: "211007", dims: { worker: W1, contract: P1 }, currency: USD, amount: -15000, book: -15000, parallel: -1800000 }
        - { account: "211007", dims: { worker: W2, contract: P1 }, currency: USD, amount: -40000, book: -40000, parallel: -4800000 }
    - source: reversal
      date: 2026-12-15
      lines:
        # the exact negation, at the amounts posted
        - { account: "511002", dims: { contract: P1, worker: W1 }, currency: USD, amount: -15000, book: -15000, parallel: -1800000 }
        - { account: "511002", dims: { contract: P1, worker: W2 }, currency: USD, amount: -40000, book: -40000, parallel: -4800000 }
        # each worker's whole balance at what it carries: no difference entry (S04 rule 13)
        - { account: "211007", dims: { worker: W1, contract: P1 }, currency: USD, amount: 15000, book: 15000, parallel: 1800000 }
        - { account: "211007", dims: { worker: W2, contract: P1 }, currency: USD, amount: 40000, book: 40000, parallel: 4800000 }
    - source: manual
      date: 2026-12-15
      lines:
        # 5.5 × 25.0000 = 137.50 USD; × 120 = 16,500.00 SYP
        - { account: "511002", dims: { contract: P1, worker: W1 }, currency: USD, amount: 13750, book: 13750, parallel: 1650000 }
        - { account: "511002", dims: { contract: P1, worker: W2 }, currency: USD, amount: 40000, book: 40000, parallel: 4800000 }
        - { account: "211007", dims: { worker: W1, contract: P1 }, currency: USD, amount: -13750, book: -13750, parallel: -1650000 }
        - { account: "211007", dims: { worker: W2, contract: P1 }, currency: USD, amount: -40000, book: -40000, parallel: -4800000 }
  balances:
    - { account: "511002", dims: { contract: P1 }, book: 53750, parallel: 6450000 }
  open_items:
    - { item: W1, account: "211007", dims: { worker: W1 }, currency: USD, amount: -13750, book: -13750, parallel: -1650000 }
    - { item: W2, account: "211007", dims: { worker: W2 }, currency: USD, amount: -40000, book: -40000, parallel: -4800000 }
  project_documents:
    # the refusals took no number; the cancelled sheet keeps its own
    - { kind: wage_sheet, number: 1, date: 2026-12-15, contract: P1, client: C1, entry: 1, currency: USD,
        period_from: 2026-12-01, period_to: 2026-12-15, cancelled_by: 2 }
    - { kind: wage_sheet, number: 2, date: 2026-12-15, contract: P1, client: C1, entry: 3, currency: USD,
        period_from: 2026-12-01, period_to: 2026-12-15 }
  quantities:
    - { entry: 1, account: "511002", currency: USD, amount: 15000, unit: "يوم", quantity: "6.000", unit_price: "25.0000" }
    # the reversal's line carries the negated quantity (S12 rule 4)
    - { entry: 2, account: "511002", currency: USD, amount: -15000, unit: "يوم", quantity: "-6.000", unit_price: "25.0000" }
    - { entry: 3, account: "511002", currency: USD, amount: 13750, unit: "يوم", quantity: "5.500", unit_price: "25.0000" }
```
