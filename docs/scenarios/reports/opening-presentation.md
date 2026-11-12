# Presenting the opening in the reports

Status: Proposed

S10 wrote these cases (S10 "Scenarios", rules 31–33). They extend `reports/statement-presentation.md` to a company with a books start, in a file of their own because the status is the file's (`docs/scenarios/README.md`, "File format"): the presentation file's cases run, and these need the `opening` step, which has no executor until S10's feature slice. They post with the `opening`, `manual` and `revalue` steps and read the reports as `reports/statement-presentation.md` does.

## Rule

In the fiscal year of the books start, the balance sheet's year's result adds the balance of the year's result before the books start (`312002`, role `pre_opening_result`) and says so; in later fiscal years, until a year-end close, that balance is presented in retained earnings, beside the unclosed years' result. A trial balance whose range starts on the books start shows the opening entry's lines as its opening balance, with the period's columns starting after it, and is marked so; a report whose range starts before the books start is read from the books start and marked so, and an income statement of the books start's fiscal year says that the result before the books start is in equity. Nothing is posted, converted or rounded by a report.

## Basis

- **IAS 1.54(r), 1.106(d):** equity shows the year's result. The result of the books start's fiscal year is the whole year's: what the old records earned before the books start, carried by the opening entry on `312002`, plus what Mizan's income and expense accounts hold since (S10 rule 31; S09 rule 16). With no year-end close in phase 1, an earlier fiscal year's result stays in retained earnings with S09's note.
- **IAS 1.38:** the comparative of a balance sheet at a date of the year after the books start is the end of the books start's fiscal year, which presents that year's result with the result before the books start (S09 rule 5).
- **IAS 1.97, 1.85:** the income statement presents only what the ledger holds by nature from the books start; the result earned before it was never posted to income and expenses (S10 "Accounting treatment": no revenue or expense line on the opening), so the statement says it is in equity rather than show a partial year as the year's (S10 rule 33).
- **IAS 21.23(b):** `312002` is a stated line in the parallel ledger, at the records' historical amount, never remeasured (S10 rule 17).
- **Company policy:** `phase-1-scope.md` F12 and F13; S10 rules 14, 17, 19, 31–33 and S09 rules 4, 5, 9, 16, 26–27 (owner, 2026-11-12); ADR 0018, ADR 0019.
- **Syrian rules:** the journal book of the Commercial Code, arts. 16–19, REPORTED (S09 rule 26): the opening entry is entry 1 of the books start's fiscal year and is printed like any entry (S10 rule 32). The calendar fiscal year (Income Tax Law 24/2003, CONFIRMED). No other Syrian rule is relied on.

## Cases

The account codes are the service-agency template's (S02), with `312002` "نتيجة السنة قبل بدء الدفاتر" (role `pre_opening_result`, statement line `bs.retained_earnings`) that S10 adds to it: the SYP and USD bank accounts `111003` and `111004`, trade receivables `112001`, capital `311001`, retained earnings `312001` (the balancing figure, S10 rule 19), service revenue `411001`, salaries `521001` and rent `531001`. Every rate and amount is synthetic.

How the expectations read: as in `reports/statement-presentation.md` and `docs/scenarios/README.md`, "Reports", with what S10 adds:
- three marks (S10 rules 32, 33): `opening_entry` ("الرصيد الافتتاحي من قيد الافتتاح") on a trial balance whose range starts on or before the books start; `before_books_start` ("تبدأ الدفاتر في 2026-10-01") on a report whose range starts before it; `pre_opening_result_in_equity` ("نتيجة ما قبل بدء الدفاتر ضمن حقوق الملكية") on an income statement of the books start's fiscal year;
- a balance sheet's `year_result_pre_opening`: the balance of `312002` that its year's result includes, with the note "تشمل نتيجة ما قبل بدء الدفاتر" when it is not zero, and zero at a date of a later fiscal year; and `compare_year_result_pre_opening` for the comparative;
- in a later fiscal year, `312002` is a part of `bs.retained_earnings` by its account, as `312001` is, and `unclosed_years` remains the net of classes 4–5 of the earlier fiscal years (S09 rule 16), so the opening's line is never counted twice.

Shapes: `syp` for the presentation through two fiscal years, with the trial balance's opening column, the income statement and the journal book; `syp-usd` for the stated `312002` in the parallel ledger. The rule reads the ledger it is given and converts nothing, so `usd-syp` and `third` add no case: they differ only in how the opening's lines are measured, which `opening/opening-entry.md` tests.

### The books start's year and the next, read from the books start (`syp`)

The books start is 1 October 2026. The old records at 30 September: 800,000.00 SYP in the bank, capital 500,000.00 and a profit of 120,000.00 for January to September (`312002`); the balancing figure on `312001` is 180,000.00 (800,000.00 − 500,000.00 − 120,000.00). October's rent of 100,000.00 is paid on 1 October, the books start's date, so the trial balance from 1 October shows it in the period's debits and credits and the opening entry alone in the opening column. C1 is invoiced 300,000.00 in October (M-1) and 200,000.00 in January (M-2); salaries of 60,000.00 in December and rent of 100,000.00 in January. Mizan's result for October to December is 300,000.00 − 100,000.00 − 60,000.00 = 140,000.00, and 2026's result is 140,000.00 + 120,000.00 = 260,000.00.

At 31 December 2026, the comparative of the balance sheet at 31 January 2027 (the default, IAS 1.38), the year's result is 260,000.00 with the note, and retained earnings are `312001` alone. At 31 January 2027, 2026 is an unclosed year: `312001` 180,000.00 and `312002` 120,000.00 are in retained earnings by their accounts, with Mizan's 140,000.00 as the unclosed years' result and S09's note, 440,000.00 in all; January's 100,000.00 is the year's result.

```yaml
case: books start 2026-10-01; the opening column from the opening entry, a report from before the books start, 2026's result with 312002 and 2027's retained earnings; the journal book from entry 1
company: { shape: syp, book: SYP, template: service-agency, books_start: 2026-10-01,
           rate_policy: { book: bulletin } }
steps:
  - opening: the records' balances at 30 September 2026
    records:
      lines:
        - { account: "111003", currency: SYP, amount: 80000000 }
        - { account: "311001", currency: SYP, amount: -50000000 }
        # January to September 2026 earned 120,000.00 (a credit)
        - { account: "312002", currency: SYP, amount: -12000000 }
  - manual: October rent, paid on the books start
    accounting_date: 2026-10-01
    payload: { lines: [{ account: "531001", currency: SYP, amount: 10000000 },
                       { account: "111003", currency: SYP, amount: -10000000 }] }
  - manual: invoice M-1 to C1
    accounting_date: 2026-10-10
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: SYP, amount: 30000000,
                         open_item: { ref: M-1 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -30000000 }] }
  # nothing in a foreign currency: nothing to revalue; each month end is current
  - revalue: book
    period: 2026-10
  - revalue: book
    period: 2026-11
  - manual: December salaries
    accounting_date: 2026-12-15
    payload: { lines: [{ account: "521001", dims: { department: design }, currency: SYP, amount: 6000000 },
                       { account: "111003", currency: SYP, amount: -6000000 }] }
  - revalue: book
    period: 2026-12
  - manual: invoice M-2 to C1
    accounting_date: 2027-01-10
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: SYP, amount: 20000000,
                         open_item: { ref: M-2 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -20000000 }] }
  - manual: January rent
    accounting_date: 2027-01-20
    payload: { lines: [{ account: "531001", currency: SYP, amount: 10000000 },
                       { account: "111003", currency: SYP, amount: -10000000 }] }
  - revalue: book
    period: 2027-01
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        - { account: "111003", currency: SYP, amount: 80000000, book: 80000000 }
        - { account: "311001", currency: SYP, amount: -50000000, book: -50000000 }
        - { account: "312002", currency: SYP, amount: -12000000, book: -12000000 }
        # balancing: −(80,000,000 − 50,000,000 − 12,000,000) = −18,000,000
        - { account: "312001", currency: SYP, amount: -18000000, book: -18000000 }
    - source: manual
      date: 2026-10-01
      lines:
        - { account: "531001", currency: SYP, amount: 10000000, book: 10000000 }
        - { account: "111003", currency: SYP, amount: -10000000, book: -10000000 }
    - source: manual
      date: 2026-10-10
      lines:
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 30000000, book: 30000000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -30000000, book: -30000000 }
    - source: manual
      date: 2026-12-15
      lines:
        - { account: "521001", dims: { department: design }, currency: SYP, amount: 6000000, book: 6000000 }
        - { account: "111003", currency: SYP, amount: -6000000, book: -6000000 }
    - source: manual
      date: 2027-01-10
      lines:
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 20000000, book: 20000000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -20000000, book: -20000000 }
    - source: manual
      date: 2027-01-20
      lines:
        - { account: "531001", currency: SYP, amount: 10000000, book: 10000000 }
        - { account: "111003", currency: SYP, amount: -10000000, book: -10000000 }
  reports:
    # from the books start: the opening entry is the opening column; the rent of the same date is in the period
    - report: trial_balance
      params: { from: 2026-10-01, to: 2026-10-31, ledger: book, level: 4, non_zero: true }
      marks: [period_open, opening_entry]
      rows:
        - { account: "111003", opening: 80000000, debits: 0, credits: 10000000, closing: 70000000 }
        - { account: "112001", opening: 0, debits: 30000000, credits: 0, closing: 30000000 }
        - { account: "311001", opening: -50000000, debits: 0, credits: 0, closing: -50000000 }
        - { account: "312001", opening: -18000000, debits: 0, credits: 0, closing: -18000000 }
        - { account: "312002", opening: -12000000, debits: 0, credits: 0, closing: -12000000 }
        - { account: "411001", opening: 0, debits: 0, credits: 30000000, closing: -30000000 }
        - { account: "531001", opening: 0, debits: 10000000, credits: 0, closing: 10000000 }
      # opening: 80,000,000 = 50,000,000 + 18,000,000 + 12,000,000
      # period: 30,000,000 + 10,000,000 = 40,000,000 = 10,000,000 + 30,000,000
      # closing: 70,000,000 + 30,000,000 + 10,000,000 = 110,000,000 = 50,000,000 + 18,000,000 + 12,000,000 + 30,000,000
      totals: { opening_debit: 80000000, opening_credit: 80000000, debits: 40000000, credits: 40000000,
                closing_debit: 110000000, closing_credit: 110000000 }
    # from before the books start: read from 1 October, the same figures, both marks (S10 rule 33)
    - report: trial_balance
      params: { from: 2026-09-01, to: 2026-10-31, ledger: book, level: 4, non_zero: true }
      marks: [period_open, before_books_start, opening_entry]
      rows:
        - { account: "111003", opening: 80000000, debits: 0, credits: 10000000, closing: 70000000 }
        - { account: "112001", opening: 0, debits: 30000000, credits: 0, closing: 30000000 }
        - { account: "311001", opening: -50000000, debits: 0, credits: 0, closing: -50000000 }
        - { account: "312001", opening: -18000000, debits: 0, credits: 0, closing: -18000000 }
        - { account: "312002", opening: -12000000, debits: 0, credits: 0, closing: -12000000 }
        - { account: "411001", opening: 0, debits: 0, credits: 30000000, closing: -30000000 }
        - { account: "531001", opening: 0, debits: 10000000, credits: 0, closing: 10000000 }
      totals: { opening_debit: 80000000, opening_credit: 80000000, debits: 40000000, credits: 40000000,
                closing_debit: 110000000, closing_credit: 110000000 }
    # the next year from 1 January: 312002 opens as it stands, classes 4–5 with October to December (S09 rule 9)
    - report: trial_balance
      params: { from: 2027-01-01, to: 2027-01-31, ledger: book, level: 4, non_zero: true }
      marks: [period_open]
      rows:
        # 800,000.00 − 100,000.00 − 60,000.00 = 640,000.00 at 31 December
        - { account: "111003", opening: 64000000, debits: 0, credits: 10000000, closing: 54000000 }
        - { account: "112001", opening: 30000000, debits: 20000000, credits: 0, closing: 50000000 }
        - { account: "311001", opening: -50000000, debits: 0, credits: 0, closing: -50000000 }
        - { account: "312001", opening: -18000000, debits: 0, credits: 0, closing: -18000000 }
        - { account: "312002", opening: -12000000, debits: 0, credits: 0, closing: -12000000 }
        - { account: "411001", opening: -30000000, debits: 0, credits: 20000000, closing: -50000000 }
        - { account: "521001", opening: 6000000, debits: 0, credits: 0, closing: 6000000 }
        - { account: "531001", opening: 10000000, debits: 10000000, credits: 0, closing: 20000000 }
      # opening: 64,000,000 + 30,000,000 + 6,000,000 + 10,000,000 = 110,000,000 = 50,000,000 + 18,000,000 + 12,000,000 + 30,000,000
      # closing: 54,000,000 + 50,000,000 + 6,000,000 + 20,000,000 = 130,000,000 = 50,000,000 + 18,000,000 + 12,000,000 + 50,000,000
      totals: { opening_debit: 110000000, opening_credit: 110000000, debits: 30000000, credits: 30000000,
                closing_debit: 130000000, closing_credit: 130000000 }
    # 2026 asked from 1 January: read from 1 October, and the result before the books start is in equity
    - report: income_statement
      params: { from: 2026-01-01, to: 2026-12-31, ledger: book }
      marks: [period_open, before_books_start, pre_opening_result_in_equity]
      lines:
        - { line: is.revenue, amount: 30000000 }
        - { line: is.employee_benefits, amount: -6000000 }
        - { line: is.other_expenses, amount: -10000000 }
      # 300,000.00 − 60,000.00 − 100,000.00 = 140,000.00, Mizan's part of 2026's 260,000.00
      subtotals: { operating_profit: 14000000, profit_before_tax: 14000000, profit: 14000000 }
    - report: balance_sheet
      params: { as_of: 2027-01-31, ledger: book, compare_as_of: 2026-12-31 }
      marks: [period_open]
      compare_marks: [period_open]
      lines:
        - { line: bs.cash, amount: 54000000, compare: 64000000,
            parts: [{ account: "111003", amount: 54000000 }] }
        - { line: bs.trade_receivables, amount: 50000000, compare: 30000000,
            parts: [{ account: "112001", dims: { client: C1 }, amount: 50000000 }] }
        - { line: bs.share_capital, amount: 50000000, compare: 50000000,
            parts: [{ account: "311001", amount: 50000000 }] }
        # at 31 January: 180,000.00 + 120,000.00 by their accounts, and 2026's 140,000.00 unclosed, with
        # "تشمل نتائج سنوات غير مقفلة": 440,000.00; at 31 December, 312001 alone (312002 is in the year's result)
        - { line: bs.retained_earnings, amount: 44000000, compare: 18000000,
            unclosed_years: 14000000, compare_unclosed_years: 0,
            parts: [{ account: "312001", amount: 18000000 }, { account: "312002", amount: 12000000 }] }
      # January: 200,000.00 − 100,000.00; nothing before the books start in 2027
      year_result: 10000000
      year_result_pre_opening: 0
      # 2026: 140,000.00 + 120,000.00, with "تشمل نتيجة ما قبل بدء الدفاتر"
      compare_year_result: 26000000
      compare_year_result_pre_opening: 12000000
      # 54,000,000 + 50,000,000 = 104,000,000 = 50,000,000 + 44,000,000 + 10,000,000
      totals: { assets: 104000000, liabilities: 0, equity: 104000000, liabilities_and_equity: 104000000 }
      # 64,000,000 + 30,000,000 = 94,000,000 = 50,000,000 + 18,000,000 + 26,000,000
      compare_totals: { assets: 94000000, liabilities: 0, equity: 94000000, liabilities_and_equity: 94000000 }
    # the opening entry is entry 1 of 2026 and is printed like any entry: 1 header row + 4 lines = 5 rows,
    # each other entry 3; October's 11 rows are page 1, November has no entry, December starts page 2
    - report: journal_book
      params: { fiscal_year: 2026, from: 2026-10, to: 2026-12, official: false }
      marks: [period_open]
      pages:
        # 800,000.00 + 100,000.00 + 300,000.00 = 1,200,000.00
        - { page: 1, entries: [1, 2, 3], debits: 120000000, credits: 120000000,
            brought_forward: { debits: 0, credits: 0 }, cumulative: { debits: 120000000, credits: 120000000 } }
        - { page: 2, entries: [4], debits: 6000000, credits: 6000000,
            brought_forward: { debits: 120000000, credits: 120000000 }, cumulative: { debits: 126000000, credits: 126000000 } }
```

### The stated result before the books start in the parallel ledger (`syp-usd`)

Books in SYP with a USD parallel ledger and no Hub client (S10 rule 10). The records at 30 September: 5,000.00 USD in the bank, measured at the bulletin of 115 into the book (575,000.00 SYP); capital 400,000.00 SYP stated at 3,500.00 USD; a profit for January to September of 100,000.00 SYP stated at 900.00 USD, the records' historical amount, not 100,000.00 ÷ 115 (IAS 21.23(b)). The balancing figure is 75,000.00 SYP and 600.00 USD. C1 is invoiced 1,000.00 USD on 10 October at the bulletin of 116.

Read on 10 October, a date other than a month end, so every report carries "قبل إعادة التقييم" (S09 rule 4). In each ledger the year's result is Mizan's October revenue plus `312002` at its own amount: 116,000.00 + 100,000.00 = 216,000.00 SYP in the book, 1,000.00 + 900.00 = 1,900.00 USD in the parallel ledger.

```yaml
case: syp-usd, books start 2026-10-01; 312002 stated in the parallel ledger, in the year's result of each ledger at its own amount; the parallel trial balance's opening column
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency, books_start: 2026-10-01,
           rate_policy: { book: bulletin, parallel: market } }
rates:
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "118.0000", type: market }
  - { date: 2026-10-10, base: USD, quote: SYP, rate: "116.0000", type: bulletin }
steps:
  - opening: the records' balances at 30 September 2026
    records:
      lines:
        # monetary: measured at the eve's bulletin, nothing typed
        - { account: "111004", currency: USD, amount: 500000 }
        # stated: the SYP amount is the book's, the USD amount typed from the records
        - { account: "311001", currency: SYP, amount: -40000000, parallel: -350000 }
        - { account: "312002", currency: SYP, amount: -10000000, parallel: -90000 }
  - manual: invoice M-1 to C1
    accounting_date: 2026-10-10
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        # 5,000.00 USD × 115 = 575,000.00 SYP
        - { account: "111004", currency: USD, amount: 500000, book: 57500000, parallel: 500000 }
        - { account: "311001", currency: SYP, amount: -40000000, book: -40000000, parallel: -350000 }
        - { account: "312002", currency: SYP, amount: -10000000, book: -10000000, parallel: -90000 }
        # book: −(57,500,000 − 40,000,000 − 10,000,000) = −7,500,000; parallel: −(500,000 − 350,000 − 90,000) = −60,000
        - { account: "312001", currency: SYP, amount: -7500000, book: -7500000, parallel: -60000 }
    - source: manual
      date: 2026-10-10
      lines:
        # 1,000.00 USD × 116 = 116,000.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 11600000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -11600000, parallel: -100000 }
  reports:
    - report: trial_balance
      params: { from: 2026-10-01, to: 2026-10-10, ledger: parallel, level: 4, non_zero: true }
      marks: [period_open, before_revaluation, opening_entry]
      rows:
        - { account: "111004", opening: 500000, debits: 0, credits: 0, closing: 500000 }
        - { account: "112001", opening: 0, debits: 100000, credits: 0, closing: 100000 }
        - { account: "311001", opening: -350000, debits: 0, credits: 0, closing: -350000 }
        - { account: "312001", opening: -60000, debits: 0, credits: 0, closing: -60000 }
        - { account: "312002", opening: -90000, debits: 0, credits: 0, closing: -90000 }
        - { account: "411001", opening: 0, debits: 0, credits: 100000, closing: -100000 }
      # opening: 500,000 = 350,000 + 60,000 + 90,000; closing: 600,000 = 350,000 + 60,000 + 90,000 + 100,000
      totals: { opening_debit: 500000, opening_credit: 500000, debits: 100000, credits: 100000,
                closing_debit: 600000, closing_credit: 600000 }
    - report: balance_sheet
      params: { as_of: 2026-10-10, ledger: book }
      marks: [period_open, before_revaluation]
      lines:
        - { line: bs.cash, amount: 57500000, parts: [{ account: "111004", amount: 57500000 }] }
        - { line: bs.trade_receivables, amount: 11600000,
            parts: [{ account: "112001", dims: { client: C1 }, amount: 11600000 }] }
        - { line: bs.share_capital, amount: 40000000, parts: [{ account: "311001", amount: 40000000 }] }
        - { line: bs.retained_earnings, amount: 7500000, parts: [{ account: "312001", amount: 7500000 }] }
      # 116,000.00 + 100,000.00
      year_result: 21600000
      year_result_pre_opening: 10000000
      # 57,500,000 + 11,600,000 = 69,100,000 = 40,000,000 + 7,500,000 + 21,600,000
      totals: { assets: 69100000, liabilities: 0, equity: 69100000, liabilities_and_equity: 69100000 }
    - report: balance_sheet
      params: { as_of: 2026-10-10, ledger: parallel }
      marks: [period_open, before_revaluation]
      lines:
        - { line: bs.cash, amount: 500000, parts: [{ account: "111004", amount: 500000 }] }
        - { line: bs.trade_receivables, amount: 100000,
            parts: [{ account: "112001", dims: { client: C1 }, amount: 100000 }] }
        - { line: bs.share_capital, amount: 350000, parts: [{ account: "311001", amount: 350000 }] }
        - { line: bs.retained_earnings, amount: 60000, parts: [{ account: "312001", amount: 60000 }] }
      # 1,000.00 + 900.00 USD, the stated amount
      year_result: 190000
      year_result_pre_opening: 90000
      # 500,000 + 100,000 = 600,000 = 350,000 + 60,000 + 190,000
      totals: { assets: 600000, liabilities: 0, equity: 600000, liabilities_and_equity: 600000 }
```
