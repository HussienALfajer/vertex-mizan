# Presenting the ledger in the reports

Status: Proposed

S09 wrote these cases (S09 "Scenarios"). They post with the executors the book already has, and add what the reports read: a `reports` expectation, a company's `contracts`, a service's department on Hub's service reference and a `service_department` step (`docs/scenarios/README.md`). The cases stay `Proposed` until S09's feature slice brings the report readers and the department step.

## Rule

Reports post nothing: every figure is the exact sum of stored ledger amounts, in the report's ledger (book or parallel), with nothing converted and nothing rounded except the margin percentage. The trial balance's three pairs of totals balance. The income statement presents revenue and expenses by nature, income positive and expenses negative, with operating profit, profit before tax and profit for the period. The balance sheet presents the year's result as a computed line in equity, and earlier fiscal years not yet closed in retained earnings. It nets contract assets and contract liabilities per contract, and presents a client's balance on a control account on its own side, never offset against another client's. Profitability gives each client, contract, department or service its revenue and direct costs, with the department of revenue taken from the service's department on the line's accounting date, and what has none under "غير موزع". The journal book is paginated by Mizan through the fiscal year, each month on a new page, with page totals carried forward.

## Basis

- **IAS 1.32:** assets and liabilities are not offset, so a client's debit on client ad funds is a receivable, never netted against other clients' funds (S09 rule 18; ADR 0018, extending ADR 0007's rule for client ad funds to every control account).
- **IFRS 15.105:** a contract is presented as a contract asset or a contract liability by its net position, per contract (S09 rule 17; ADR 0007). The ledger accounts stay gross.
- **IAS 1.54(r), 1.106(d):** equity shows the period's result; with no year-end close in phase 1, the current year's result is a computed line and earlier unclosed years are presented in retained earnings (S09 rule 16; ADR 0018).
- **IAS 1.81A–85, 1.102; IFRS 18.69:** expenses by nature, and the subtotals ordered by the catalogue's IFRS 18 categories (S09 rule 14). **IAS 21.52(a):** exchange differences on one net line, `is.fx_differences`, until Q11.
- **IAS 21.23:** a report ending on a date other than a month end, or on a month end whose revaluation is not current, carries "قبل إعادة التقييم" (S09 rule 4).
- **Management reporting, outside IFRS:** profitability is a direct contribution margin, with no allocation of overheads (S09 rules 20–23; owner, 2026-11-12). A service's department is dated (rules 32–34).
- **Company policy:** `phase-1-scope.md` F13 and §4 (client ad funds are a liability and never reach the income statement); S09 rules 1–31 (owner, 2026-11-12); ADR 0013 (a document item never crosses zero, and an advance from a client is a liability).
- **Syrian rules:** the journal book of the Commercial Code, arts. 16–19, REPORTED (S09 rule 26): Arabic, chronological, its pages numbered; the numbering and certification by the competent authority are done on the printed book outside Mizan. The calendar fiscal year (Income Tax Law 24/2003, CONFIRMED). The bulletin for the statutory books, UNVERIFIED (Q1), adopted by the owner as the company's policy. No other Syrian rule is relied on.

## Cases

The account codes are the service-agency template's (S02): the SYP and USD bank accounts `111003` and `111004`, trade receivables `112001` and contract assets `113001` (document control accounts, `bs.trade_receivables` and `bs.contract_assets`), project expenses awaiting payment `211002` and other payables `211003` (`bs.trade_payables`), contract liabilities `212001` (`bs.contract_liabilities`, not a control account), client ad funds held `213001` (a running control account, USD only, `bs.client_money`), income tax payable `214001`, capital `311001`, retained earnings `312001`, service revenue `411001` (`is.revenue`), realised exchange gains `421001` (`is.fx_differences`), other income `422001` (`is.other_income`), direct project costs `511001` (`is.direct_costs`), salaries `521001` (`is.employee_benefits`), rent `531001`, software subscriptions `531004` and repairs `531006` (`is.other_expenses`), and income tax expense `551001` (`is.income_tax`). The `usd-syp` case adds finance costs `532005` (`is.finance_costs`; the template has no account on that line), and the `third` case a TRY cash account `111007`. Every rate and amount is synthetic. December 2026 runs from Tuesday 1 to Thursday 31.

How the expectations read (`docs/scenarios/README.md`, "Reports"):
- amounts are minor units of the report's ledger currency; a trial balance's opening and closing balances are signed (positive debit, negative credit) and its debits and credits are magnitudes;
- a statement line's amount is as presented: assets, liabilities and equity positive on their own side, income positive and expenses negative; each balance-sheet line lists its parts, the balances it is made of, with those moved to it by rule 18 marked `reclassified`;
- a statement line not listed is zero or hidden (rule 13); the trial balance's rows, with `non_zero` on, are the exact set;
- the marks are the exact set of rule 4's: `period_open` ("غير نهائية: الفترة مفتوحة") and `before_revaluation` ("قبل إعادة التقييم").

The cases leave out what S09's tests own: hiding and level sums (rule 9), the drill-down sums (rule 6), the export formats (rules 35–36), the journal book's continuation rows and an entry split across pages (rule 27, unit tests on the paginator), the official print's register, hashes and supersession (rules 28–31, worker and API tests), and the permission `reports.read`.

A client's advance is posted to `211003`, never as a credit on `112001`: a document item never crosses zero (ADR 0013, invariant 9; owner, 2026-11-12, replacing the first draft of S09's worked example, which had client C2 in credit on receivables). So rule 18 is shown on the running account `213001`, the only control account of the template whose client balance can change side.

Shapes:
- **`syp-usd`** is Vertex Media: S09's worked example (rules 17, 18) in both ledgers, with the trial balance's gross balances; and profitability by department and by service with a service's department changed mid-month by Hub, a manual service's department set by the accountant, and a service with none (rules 20–23, 32–34).
- **`syp`**: the year's result and an unclosed earlier year in equity, with comparatives (rules 5, 16, 19; edge case 20); and the journal book's pages for the year and for a month alone (rules 26, 27).
- **`usd-syp`**: the income statement's subtotals in USD books, with a realised exchange gain, finance costs and income tax (rule 14).
- **`third`**: the account statement of a TRY account, with the TRY column beside the ledger amounts, and a trial balance at a mid-month date (rules 4, 11).

### Vertex Media: the worked example in both ledgers

On 1 December C1 is invoiced 600,000.00 SYP (M-1), C2 pays an advance of 50,000.00 SYP under no contract (a contract's advance is a contract liability, IFRS 15.106), C1 deposits 1,000.00 USD of ad funds, the agency pays 20.00 USD of ad spend for C3, who holds no funds, P1 (C1's project) receives a deposit of 1,200,000.00 SYP and has a done milestone of 500,000.00 not yet invoiced, and R1 (C3's retainer) has 300,000.00 released ahead of its invoice. The December revaluations find nothing to remeasure: the bulletin stays at 120 and the market rate at 125 (the row of 1 December is still in force at the month end, so no second row is recorded: S02 rule 14 refuses an unchanged rate as `RATE_UNCHANGED`).

The trial balance shows the accounts gross: `112001` debit 600,000.00, `211003` credit 50,000.00, `113001` debit 800,000.00, `212001` credit 1,200,000.00, `213001` credit 117,600.00. The balance sheet presents C3's debit on `213001` in trade receivables (602,400.00), C1's funds as client money (120,000.00), P1 net in contract liabilities (1,200,000.00 − 500,000.00 = 700,000.00) and R1 in contract assets (300,000.00). The parallel ledger presents the same at its own amounts: 1,000.00 USD of funds and 20.00 USD reclassified, P1 9,600.00 − 4,000.00 = 5,600.00 USD.

```yaml
case: S09's worked example; client ad funds in debit reclassified, contract positions netted per contract; book and parallel
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }, { code: R1, kind: retainer, client: C3 }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "125.0000", type: market }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - manual: invoice M-1 to C1
    accounting_date: 2026-12-01
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: SYP, amount: 60000000,
                         open_item: { ref: M-1 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -60000000 }] }
  - manual: advance received from C2, a liability (ADR 0013)
    accounting_date: 2026-12-01
    payload: { lines: [{ account: "111003", currency: SYP, amount: 5000000 },
                       { account: "211003", currency: SYP, amount: -5000000, memo: "دفعة مقدمة من العميل C2" }] }
  - manual: ad funds deposited by C1
    accounting_date: 2026-12-01
    payload: { lines: [{ account: "111004", currency: USD, amount: 100000 },
                       { account: "213001", dims: { client: C1 }, currency: USD, amount: -100000 }] }
  - manual: ad spend paid for C3, who holds no funds
    accounting_date: 2026-12-01
    payload: { lines: [{ account: "213001", dims: { client: C3 }, currency: USD, amount: 2000 },
                       { account: "111004", currency: USD, amount: -2000 }] }
  - manual: deposit received on P1
    accounting_date: 2026-12-01
    payload: { lines: [{ account: "111003", currency: SYP, amount: 120000000 },
                       { account: "212001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -120000000 }] }
  - manual: P1 milestone done, not yet invoiced
    accounting_date: 2026-12-01
    payload: { lines: [{ account: "113001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 50000000,
                         open_item: { ref: CA-1 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -50000000 }] }
  - manual: R1 revenue released ahead of its invoice
    accounting_date: 2026-12-01
    payload: { lines: [{ account: "113001", dims: { client: C3, contract: R1 }, currency: SYP, amount: 30000000,
                         open_item: { ref: CA-2 } },
                       { account: "411001", dims: { client: C3, service: S2 }, currency: SYP, amount: -30000000 }] }
  # every monetary balance is carried at the closing rate: nothing to remeasure, no entry
  - revalue: book
    period: 2026-12
  - revalue: parallel
    period: 2026-12
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        # parallel: 600,000.00 SYP / 125 (market) = 4,800.00 USD
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 60000000, book: 60000000, parallel: 480000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -60000000, book: -60000000, parallel: -480000 }
    - source: manual
      date: 2026-12-01
      lines:
        # 50,000.00 / 125 = 400.00 USD
        - { account: "111003", currency: SYP, amount: 5000000, book: 5000000, parallel: 40000 }
        - { account: "211003", currency: SYP, amount: -5000000, book: -5000000, parallel: -40000 }
    - source: manual
      date: 2026-12-01
      lines:
        # book: 1,000.00 USD × 120 (bulletin) = 120,000.00 SYP; parallel: USD as is
        - { account: "111004", currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: manual
      date: 2026-12-01
      lines:
        # 20.00 USD × 120 = 2,400.00 SYP
        - { account: "213001", dims: { client: C3 }, currency: USD, amount: 2000, book: 240000, parallel: 2000 }
        - { account: "111004", currency: USD, amount: -2000, book: -240000, parallel: -2000 }
    - source: manual
      date: 2026-12-01
      lines:
        # 1,200,000.00 / 125 = 9,600.00 USD
        - { account: "111003", currency: SYP, amount: 120000000, book: 120000000, parallel: 960000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -120000000, book: -120000000, parallel: -960000 }
    - source: manual
      date: 2026-12-01
      lines:
        # 500,000.00 / 125 = 4,000.00 USD
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 50000000, book: 50000000, parallel: 400000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -50000000, book: -50000000, parallel: -400000 }
    - source: manual
      date: 2026-12-01
      lines:
        # 300,000.00 / 125 = 2,400.00 USD
        - { account: "113001", dims: { client: C3, contract: R1 }, currency: SYP, amount: 30000000, book: 30000000, parallel: 240000 }
        - { account: "411001", dims: { client: C3, service: S2 }, currency: SYP, amount: -30000000, book: -30000000, parallel: -240000 }
  balances:
    - { account: "213001", dims: { client: C1 }, book: -12000000, parallel: -100000 }
    - { account: "213001", dims: { client: C3 }, book: 240000, parallel: 2000 }
  reports:
    - report: trial_balance
      params: { from: 2026-12-01, to: 2026-12-31, ledger: book, level: 4, non_zero: true }
      marks: [period_open]
      rows:
        # 111003: 50,000.00 + 1,200,000.00
        - { account: "111003", opening: 0, debits: 125000000, credits: 0, closing: 125000000 }
        - { account: "111004", opening: 0, debits: 12000000, credits: 240000, closing: 11760000 }
        - { account: "112001", opening: 0, debits: 60000000, credits: 0, closing: 60000000 }
        # gross: P1 500,000.00 + R1 300,000.00
        - { account: "113001", opening: 0, debits: 80000000, credits: 0, closing: 80000000 }
        - { account: "211003", opening: 0, debits: 0, credits: 5000000, closing: -5000000 }
        - { account: "212001", opening: 0, debits: 0, credits: 120000000, closing: -120000000 }
        # gross: C1 credit 120,000.00, C3 debit 2,400.00
        - { account: "213001", opening: 0, debits: 240000, credits: 12000000, closing: -11760000 }
        - { account: "411001", opening: 0, debits: 0, credits: 140000000, closing: -140000000 }
      # debits: 125,000,000 + 12,000,000 + 60,000,000 + 80,000,000 + 240,000 = 277,240,000
      # credits: 240,000 + 5,000,000 + 120,000,000 + 12,000,000 + 140,000,000 = 277,240,000
      # closing debit: 125,000,000 + 11,760,000 + 60,000,000 + 80,000,000 = 276,760,000
      # closing credit: 5,000,000 + 120,000,000 + 11,760,000 + 140,000,000 = 276,760,000
      totals: { opening_debit: 0, opening_credit: 0, debits: 277240000, credits: 277240000,
                closing_debit: 276760000, closing_credit: 276760000 }
    - report: trial_balance
      params: { from: 2026-12-01, to: 2026-12-31, ledger: parallel, level: 4, non_zero: true }
      marks: [period_open]
      rows:
        - { account: "111003", opening: 0, debits: 1000000, credits: 0, closing: 1000000 }
        - { account: "111004", opening: 0, debits: 100000, credits: 2000, closing: 98000 }
        - { account: "112001", opening: 0, debits: 480000, credits: 0, closing: 480000 }
        - { account: "113001", opening: 0, debits: 640000, credits: 0, closing: 640000 }
        - { account: "211003", opening: 0, debits: 0, credits: 40000, closing: -40000 }
        - { account: "212001", opening: 0, debits: 0, credits: 960000, closing: -960000 }
        - { account: "213001", opening: 0, debits: 2000, credits: 100000, closing: -98000 }
        - { account: "411001", opening: 0, debits: 0, credits: 1120000, closing: -1120000 }
      # debits: 1,000,000 + 100,000 + 480,000 + 640,000 + 2,000 = 2,222,000 = credits: 2,000 + 40,000 + 960,000 + 100,000 + 1,120,000
      # closing: 1,000,000 + 98,000 + 480,000 + 640,000 = 2,218,000 = 40,000 + 960,000 + 98,000 + 1,120,000
      totals: { opening_debit: 0, opening_credit: 0, debits: 2222000, credits: 2222000,
                closing_debit: 2218000, closing_credit: 2218000 }
    - report: balance_sheet
      params: { as_of: 2026-12-31, ledger: book }
      marks: [period_open]
      lines:
        - { line: bs.cash, amount: 136760000,
            parts: [{ account: "111003", amount: 125000000 }, { account: "111004", amount: 11760000 }] }
        # C1's receivable, and C3's debit on client ad funds presented here (rule 18): 600,000.00 + 2,400.00
        - { line: bs.trade_receivables, amount: 60240000,
            parts: [{ account: "112001", dims: { client: C1 }, amount: 60000000 },
                    { account: "213001", dims: { client: C3 }, amount: 240000, reclassified: true }] }
        # R1's net debit (rule 17)
        - { line: bs.contract_assets, amount: 30000000,
            parts: [{ account: "113001", dims: { client: C3, contract: R1 }, amount: 30000000 }] }
        - { line: bs.trade_payables, amount: 5000000,
            parts: [{ account: "211003", amount: 5000000 }] }
        # P1 netted: credit 1,200,000.00 − debit 500,000.00 = 700,000.00 (rule 17)
        - { line: bs.contract_liabilities, amount: 70000000,
            parts: [{ account: "212001", dims: { client: C1, contract: P1 }, amount: 120000000 },
                    { account: "113001", dims: { client: C1, contract: P1 }, amount: -50000000 }] }
        # C1's funds only; C3's debit is in receivables
        - { line: bs.client_money, amount: 12000000,
            parts: [{ account: "213001", dims: { client: C1 }, amount: 12000000 }] }
      # December's revenue, 600,000.00 + 500,000.00 + 300,000.00 (rule 16)
      year_result: 140000000
      # assets: 136,760,000 + 60,240,000 + 30,000,000 = 227,000,000
      # liabilities: 5,000,000 + 70,000,000 + 12,000,000 = 87,000,000; equity 140,000,000
      totals: { assets: 227000000, liabilities: 87000000, equity: 140000000, liabilities_and_equity: 227000000 }
    - report: balance_sheet
      params: { as_of: 2026-12-31, ledger: parallel }
      marks: [period_open]
      lines:
        - { line: bs.cash, amount: 1098000,
            parts: [{ account: "111003", amount: 1000000 }, { account: "111004", amount: 98000 }] }
        - { line: bs.trade_receivables, amount: 482000,
            parts: [{ account: "112001", dims: { client: C1 }, amount: 480000 },
                    { account: "213001", dims: { client: C3 }, amount: 2000, reclassified: true }] }
        - { line: bs.contract_assets, amount: 240000,
            parts: [{ account: "113001", dims: { client: C3, contract: R1 }, amount: 240000 }] }
        - { line: bs.trade_payables, amount: 40000,
            parts: [{ account: "211003", amount: 40000 }] }
        # 9,600.00 − 4,000.00 = 5,600.00 USD
        - { line: bs.contract_liabilities, amount: 560000,
            parts: [{ account: "212001", dims: { client: C1, contract: P1 }, amount: 960000 },
                    { account: "113001", dims: { client: C1, contract: P1 }, amount: -400000 }] }
        - { line: bs.client_money, amount: 100000,
            parts: [{ account: "213001", dims: { client: C1 }, amount: 100000 }] }
      # 4,800.00 + 4,000.00 + 2,400.00 USD
      year_result: 1120000
      # assets: 1,098,000 + 482,000 + 240,000 = 1,820,000; liabilities: 40,000 + 560,000 + 100,000 = 700,000
      totals: { assets: 1820000, liabilities: 700000, equity: 1120000, liabilities_and_equity: 1820000 }
```

### Vertex Media: profitability by department and by service

S1 comes from Hub with the department `design` on 3 December, and Hub sends it with `photography` on 15 December: from the 15th S1's revenue is photography's, and the invoice of the 20th, whose service carries no department, takes the one in force. S2 comes from Hub with no department: its revenue is "غير موزع". S3 is a manual service; the accountant sets its department to `design` from 1 December (rule 34), and a manual sale of S3 is design's. Direct costs come from Hub's project expenses with their departments. Other income is outside profitability (rule 20), so profitability's totals equal the income statement's revenue and direct costs, not its operating profit. Both ledgers are revalued at unchanged rates, with no entry.

```yaml
case: profitability by department with S1's department changed mid-month by Hub, a manual service's department, and a service with none; by service with costs unassigned
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-08, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-15, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-16, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-20, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  # S1 arrives with design: its department from 3 December (rule 33)
  - event: invoice.issued
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-90, client: C1, currency: USD, syp_per_usd: "121.0000",
               issued_on: 2026-12-03, due_on: 2026-12-18,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: { code: S1, department: design } },
                       { line: L2, amount: 40000, source: extra_work, service: S2 }] }
  - event: project_expense.recorded
    accounting_date: 2026-12-08
    payload: { expense: E-1, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: design, spent_on: 2026-12-08, currency: USD, amount: 30000,
               syp_per_usd: "121.0000", description: "تصميم هوية العميل" }
  - service_department: { service: S3, department: design, effective_from: 2026-12-01 }
    reason: "خدمة يدوية يقدمها قسم التصميم"
  - manual: a sale of the manual service S3 to C3, paid in USD
    accounting_date: 2026-12-10
    payload: { lines: [{ account: "111004", currency: USD, amount: 50000 },
                       { account: "411001", dims: { client: C3, service: S3 }, currency: USD, amount: -50000 }] }
  - manual: other income received in USD
    accounting_date: 2026-12-10
    payload: { lines: [{ account: "111004", currency: USD, amount: 10000 },
                       { account: "422001", currency: USD, amount: -10000 }] }
  # S1 arrives with photography: a new row from 15 December; the 3 December line keeps design
  - event: invoice.issued
    accounting_date: 2026-12-15
    payload: { invoice: INV-2026-91, client: C2, currency: USD, syp_per_usd: "121.0000",
               issued_on: 2026-12-15, due_on: 2026-12-30,
               lines: [{ line: L1, amount: 60000, source: extra_work, service: { code: S1, department: photography } }] }
  - event: project_expense.recorded
    accounting_date: 2026-12-16
    payload: { expense: E-2, client: C2, contract: { code: P2, kind: project, client: C2 },
               department: photography, spent_on: 2026-12-16, currency: USD, amount: 25000,
               syp_per_usd: "121.0000", description: "تصوير منتجات العميل" }
  # no department on the service: the one in force on the 20th, photography
  - event: invoice.issued
    accounting_date: 2026-12-20
    payload: { invoice: INV-2026-92, client: C1, currency: USD, syp_per_usd: "121.0000",
               issued_on: 2026-12-20, due_on: 2027-01-04,
               lines: [{ line: L1, amount: 20000, source: extra_work, service: S1 }] }
  - revalue: book
    period: 2026-12
  - revalue: parallel
    period: 2026-12
expect:
  entries:
    - source: invoice.issued
      date: 2026-12-03
      lines:
        # book: 1,400.00 USD × 120 = 168,000.00 SYP; revenue lines carry no department (S05 rule 2)
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 140000, book: 16800000, parallel: 140000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
        - { account: "411001", dims: { client: C1, service: S2 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
    - source: project_expense.recorded
      date: 2026-12-08
      lines:
        - { account: "511001", dims: { client: C1, contract: P1, department: design }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "211002", currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: manual
      date: 2026-12-10
      lines:
        - { account: "111004", currency: USD, amount: 50000, book: 6000000, parallel: 50000 }
        - { account: "411001", dims: { client: C3, service: S3 }, currency: USD, amount: -50000, book: -6000000, parallel: -50000 }
    - source: manual
      date: 2026-12-10
      lines:
        - { account: "111004", currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
        - { account: "422001", currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
    - source: invoice.issued
      date: 2026-12-15
      lines:
        - { account: "112001", dims: { client: C2 }, currency: USD, amount: 60000, book: 7200000, parallel: 60000 }
        - { account: "411001", dims: { client: C2, service: S1 }, currency: USD, amount: -60000, book: -7200000, parallel: -60000 }
    - source: project_expense.recorded
      date: 2026-12-16
      lines:
        - { account: "511001", dims: { client: C2, contract: P2, department: photography }, currency: USD, amount: 25000, book: 3000000, parallel: 25000 }
        - { account: "211002", currency: USD, amount: -25000, book: -3000000, parallel: -25000 }
    - source: invoice.issued
      date: 2026-12-20
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 20000, book: 2400000, parallel: 20000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -20000, book: -2400000, parallel: -20000 }
  reports:
    # the parallel ledger, profitability's default when the company keeps one (rule 23)
    - report: profitability
      params: { by: department, from: 2026-12-01, to: 2026-12-31, ledger: parallel }
      marks: [period_open]
      rows:
        # S1 on the 3rd (1,000.00) + S3 (500.00); E-1 300.00; 1,200 / 1,500 = 80.0 %
        - { value: design, revenue: 150000, direct_costs: 30000, contribution: 120000, margin: "80.0" }
        # S1 on the 15th (600.00) and the 20th (200.00); E-2 250.00; 550 / 800 = 68.75 → 68.8 % (half away from zero)
        - { value: photography, revenue: 80000, direct_costs: 25000, contribution: 55000, margin: "68.8" }
        # S2, with no department
        - { value: unassigned, revenue: 40000, direct_costs: 0, contribution: 40000, margin: "100.0" }
      # 2,150 / 2,700 = 79.629… → 79.6 %; the other income of 100.00 is outside
      totals: { revenue: 270000, direct_costs: 55000, contribution: 215000, margin: "79.6" }
    - report: profitability
      params: { by: department, from: 2026-12-01, to: 2026-12-31, ledger: book }
      marks: [period_open]
      rows:
        - { value: design, revenue: 18000000, direct_costs: 3600000, contribution: 14400000, margin: "80.0" }
        - { value: photography, revenue: 9600000, direct_costs: 3000000, contribution: 6600000, margin: "68.8" }
        - { value: unassigned, revenue: 4800000, direct_costs: 0, contribution: 4800000, margin: "100.0" }
      totals: { revenue: 32400000, direct_costs: 6600000, contribution: 25800000, margin: "79.6" }
    # costs carry no service (rule 22): all of them under "غير موزع", whose margin is "—" with no revenue
    - report: profitability
      params: { by: service, from: 2026-12-01, to: 2026-12-31, ledger: parallel }
      marks: [period_open]
      rows:
        - { value: S1, revenue: 180000, direct_costs: 0, contribution: 180000, margin: "100.0" }
        - { value: S2, revenue: 40000, direct_costs: 0, contribution: 40000, margin: "100.0" }
        - { value: S3, revenue: 50000, direct_costs: 0, contribution: 50000, margin: "100.0" }
        - { value: unassigned, revenue: 0, direct_costs: 55000, contribution: -55000, margin: null }
      totals: { revenue: 270000, direct_costs: 55000, contribution: 215000, margin: "79.6" }
    # the agreement of rule 23: revenue 2,700.00 and direct costs 550.00, as in profitability
    - report: income_statement
      params: { from: 2026-12-01, to: 2026-12-31, ledger: parallel }
      marks: [period_open]
      lines:
        - { line: is.revenue, amount: 270000 }
        - { line: is.other_income, amount: 10000 }
        - { line: is.direct_costs, amount: -55000 }
      subtotals: { operating_profit: 225000, profit_before_tax: 225000, profit: 225000 }
```

### The year's result and an unclosed earlier year (`syp`)

December 2026 earns 250,000.00 (revenue 400,000.00 less rent 150,000.00) and January 2027 180,000.00 (revenue 300,000.00 less salaries 120,000.00). No year-end close posts in phase 1, so at 31 January 2027 the balance sheet shows 2026's result in retained earnings with its note, and January's as the year's result; the comparative at 31 December 2026, the default (the end of the previous fiscal year), shows 2026's result as that date's year's result and nothing unclosed. A trial balance from 1 January 2027 opens the revenue and expense accounts with 2026's balances (edge case 20). The income statement's comparative is the default: the 31 days ending the day before `from`, December 2026.

```yaml
case: at 31 January 2027, 2026's result in retained earnings with its note and January's as the year's result; comparatives at 31 December 2026 and for December
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
steps:
  - manual: capital paid in
    accounting_date: 2026-12-01
    payload: { lines: [{ account: "111003", currency: SYP, amount: 100000000 },
                       { account: "311001", currency: SYP, amount: -100000000 }] }
  - manual: invoice M-1 to C1
    accounting_date: 2026-12-10
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: SYP, amount: 40000000,
                         open_item: { ref: M-1 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -40000000 }] }
  - manual: December rent
    accounting_date: 2026-12-20
    payload: { lines: [{ account: "531001", currency: SYP, amount: 15000000 },
                       { account: "111003", currency: SYP, amount: -15000000 }] }
  # nothing in a foreign currency: nothing to revalue; the clock moves to 2027-01-01
  - revalue: book
    period: 2026-12
  - manual: invoice M-2 to C1
    accounting_date: 2027-01-10
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: SYP, amount: 30000000,
                         open_item: { ref: M-2 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -30000000 }] }
  - manual: January salaries
    accounting_date: 2027-01-20
    payload: { lines: [{ account: "521001", dims: { department: design }, currency: SYP, amount: 12000000 },
                       { account: "111003", currency: SYP, amount: -12000000 }] }
  - manual: M-1 received
    accounting_date: 2027-01-25
    payload: { lines: [{ account: "111003", currency: SYP, amount: 40000000 },
                       { account: "112001", currency: SYP, amount: -40000000, item: M-1 }] }
  - revalue: book
    period: 2027-01
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "111003", currency: SYP, amount: 100000000, book: 100000000 }
        - { account: "311001", currency: SYP, amount: -100000000, book: -100000000 }
    - source: manual
      date: 2026-12-10
      lines:
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 40000000, book: 40000000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -40000000, book: -40000000 }
    - source: manual
      date: 2026-12-20
      lines:
        - { account: "531001", currency: SYP, amount: 15000000, book: 15000000 }
        - { account: "111003", currency: SYP, amount: -15000000, book: -15000000 }
    - source: manual
      date: 2027-01-10
      lines:
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 30000000, book: 30000000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -30000000, book: -30000000 }
    - source: manual
      date: 2027-01-20
      lines:
        - { account: "521001", dims: { department: design }, currency: SYP, amount: 12000000, book: 12000000 }
        - { account: "111003", currency: SYP, amount: -12000000, book: -12000000 }
    - source: manual
      date: 2027-01-25
      lines:
        - { account: "111003", currency: SYP, amount: 40000000, book: 40000000 }
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: -40000000, book: -40000000 }
  reports:
    - report: trial_balance
      params: { from: 2027-01-01, to: 2027-01-31, ledger: book, level: 4, non_zero: true }
      marks: [period_open]
      rows:
        # 1,000,000.00 − 150,000.00 = 850,000.00 at 31 December
        - { account: "111003", opening: 85000000, debits: 40000000, credits: 12000000, closing: 113000000 }
        - { account: "112001", opening: 40000000, debits: 30000000, credits: 40000000, closing: 30000000 }
        - { account: "311001", opening: -100000000, debits: 0, credits: 0, closing: -100000000 }
        # classes 4–5 open with 2026's balances: no year-end close in phase 1 (rule 9)
        - { account: "411001", opening: -40000000, debits: 0, credits: 30000000, closing: -70000000 }
        - { account: "521001", opening: 0, debits: 12000000, credits: 0, closing: 12000000 }
        - { account: "531001", opening: 15000000, debits: 0, credits: 0, closing: 15000000 }
      # opening: 85,000,000 + 40,000,000 + 15,000,000 = 140,000,000 = 100,000,000 + 40,000,000
      # period: 40,000,000 + 30,000,000 + 12,000,000 = 82,000,000 = 12,000,000 + 40,000,000 + 30,000,000
      # closing: 113,000,000 + 30,000,000 + 12,000,000 + 15,000,000 = 170,000,000 = 100,000,000 + 70,000,000
      totals: { opening_debit: 140000000, opening_credit: 140000000, debits: 82000000, credits: 82000000,
                closing_debit: 170000000, closing_credit: 170000000 }
    - report: income_statement
      params: { from: 2027-01-01, to: 2027-01-31, ledger: book, compare_from: 2026-12-01, compare_to: 2026-12-31 }
      marks: [period_open]
      compare_marks: [period_open]
      lines:
        - { line: is.revenue, amount: 30000000, compare: 40000000 }
        - { line: is.employee_benefits, amount: -12000000, compare: 0 }
        - { line: is.other_expenses, amount: 0, compare: -15000000 }
      subtotals: { operating_profit: 18000000, profit_before_tax: 18000000, profit: 18000000 }
      compare_subtotals: { operating_profit: 25000000, profit_before_tax: 25000000, profit: 25000000 }
    - report: balance_sheet
      params: { as_of: 2027-01-31, ledger: book, compare_as_of: 2026-12-31 }
      marks: [period_open]
      compare_marks: [period_open]
      lines:
        - { line: bs.cash, amount: 113000000, compare: 85000000,
            parts: [{ account: "111003", amount: 113000000 }] }
        - { line: bs.trade_receivables, amount: 30000000, compare: 40000000,
            parts: [{ account: "112001", dims: { client: C1 }, amount: 30000000 }] }
        - { line: bs.share_capital, amount: 100000000, compare: 100000000,
            parts: [{ account: "311001", amount: 100000000 }] }
        # 312001 holds nothing; 2026's result, 400,000.00 − 150,000.00, is added with the note
        # "تشمل نتائج سنوات غير مقفلة" at 31 January, and is the year's result at 31 December
        - { line: bs.retained_earnings, amount: 25000000, compare: 0, unclosed_years: 25000000, compare_unclosed_years: 0,
            parts: [{ account: "312001", amount: 0 }] }
      # 300,000.00 − 120,000.00; at 31 December, 2026's 250,000.00
      year_result: 18000000
      compare_year_result: 25000000
      # 113,000,000 + 30,000,000 = 143,000,000 = 100,000,000 + 25,000,000 + 18,000,000
      totals: { assets: 143000000, liabilities: 0, equity: 143000000, liabilities_and_equity: 143000000 }
      # 85,000,000 + 40,000,000 = 125,000,000 = 100,000,000 + 25,000,000
      compare_totals: { assets: 125000000, liabilities: 0, equity: 125000000, liabilities_and_equity: 125000000 }
```

### The journal book's pages, for the year and for a month alone (`syp`)

A page holds 30 rows (`JOURNAL_BOOK_ROWS_PER_PAGE`, owner, 2026-11-12); an entry takes one header row and one row per line, so every entry here, of two lines and a short description, takes 3 rows. Each month starts on a new page (owner, 2026-11-12), so a month printed alone has the pages and totals it has in the year's print (rule 27). November holds 11 entries: the first ten fill page 1 (30 rows) and the eleventh is page 2; December's two entries are page 3. Both months are closed, so the prints are official (rule 28).

The book's totals for the two months equal the trial balance's period debits and credits for the same dates (S09 "Reports").

```yaml
case: the journal book of November and December 2026 on three pages, page totals and totals brought forward; December printed alone keeps page 3 and its totals
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
steps:
  - manual: capital paid in
    accounting_date: 2026-11-02
    payload: { description: "رأس المال", lines: [{ account: "111003", currency: SYP, amount: 100000000 },
                                                { account: "311001", currency: SYP, amount: -100000000 }] }
  # entries 2 to 11: software subscriptions of n × 1,000.00 SYP for n = 2 … 11
  - manual: subscription 2
    accounting_date: 2026-11-03
    payload: { description: "اشتراك برمجيات", lines: [{ account: "531004", currency: SYP, amount: 200000 },
                                                     { account: "111003", currency: SYP, amount: -200000 }] }
  - manual: subscription 3
    accounting_date: 2026-11-04
    payload: { description: "اشتراك برمجيات", lines: [{ account: "531004", currency: SYP, amount: 300000 },
                                                     { account: "111003", currency: SYP, amount: -300000 }] }
  - manual: subscription 4
    accounting_date: 2026-11-05
    payload: { description: "اشتراك برمجيات", lines: [{ account: "531004", currency: SYP, amount: 400000 },
                                                     { account: "111003", currency: SYP, amount: -400000 }] }
  - manual: subscription 5
    accounting_date: 2026-11-08
    payload: { description: "اشتراك برمجيات", lines: [{ account: "531004", currency: SYP, amount: 500000 },
                                                     { account: "111003", currency: SYP, amount: -500000 }] }
  - manual: subscription 6
    accounting_date: 2026-11-09
    payload: { description: "اشتراك برمجيات", lines: [{ account: "531004", currency: SYP, amount: 600000 },
                                                     { account: "111003", currency: SYP, amount: -600000 }] }
  - manual: subscription 7
    accounting_date: 2026-11-10
    payload: { description: "اشتراك برمجيات", lines: [{ account: "531004", currency: SYP, amount: 700000 },
                                                     { account: "111003", currency: SYP, amount: -700000 }] }
  - manual: subscription 8
    accounting_date: 2026-11-11
    payload: { description: "اشتراك برمجيات", lines: [{ account: "531004", currency: SYP, amount: 800000 },
                                                     { account: "111003", currency: SYP, amount: -800000 }] }
  - manual: subscription 9
    accounting_date: 2026-11-12
    payload: { description: "اشتراك برمجيات", lines: [{ account: "531004", currency: SYP, amount: 900000 },
                                                     { account: "111003", currency: SYP, amount: -900000 }] }
  - manual: subscription 10
    accounting_date: 2026-11-15
    payload: { description: "اشتراك برمجيات", lines: [{ account: "531004", currency: SYP, amount: 1000000 },
                                                     { account: "111003", currency: SYP, amount: -1000000 }] }
  - manual: subscription 11
    accounting_date: 2026-11-16
    payload: { description: "اشتراك برمجيات", lines: [{ account: "531004", currency: SYP, amount: 1100000 },
                                                     { account: "111003", currency: SYP, amount: -1100000 }] }
  - revalue: book
    period: 2026-11
  - close: 2026-11
    reason: "إقفال تشرين الثاني"
  - manual: invoice M-1 to C1
    accounting_date: 2026-12-03
    payload: { description: "فاتورة خدمات", lines: [{ account: "112001", dims: { client: C1 }, currency: SYP, amount: 20000000,
                                                   open_item: { ref: M-1 } },
                                                 { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -20000000 }] }
  - manual: M-1 received
    accounting_date: 2026-12-10
    payload: { description: "تحصيل فاتورة", lines: [{ account: "111003", currency: SYP, amount: 20000000 },
                                                   { account: "112001", currency: SYP, amount: -20000000, item: M-1 }] }
  - revalue: book
    period: 2026-12
  - close: 2026-12
    reason: "إقفال كانون الأول"
expect:
  entries:
    - { source: manual, date: 2026-11-02, lines: [{ account: "111003", currency: SYP, amount: 100000000, book: 100000000 },
                                                  { account: "311001", currency: SYP, amount: -100000000, book: -100000000 }] }
    - { source: manual, date: 2026-11-03, lines: [{ account: "531004", currency: SYP, amount: 200000, book: 200000 },
                                                  { account: "111003", currency: SYP, amount: -200000, book: -200000 }] }
    - { source: manual, date: 2026-11-04, lines: [{ account: "531004", currency: SYP, amount: 300000, book: 300000 },
                                                  { account: "111003", currency: SYP, amount: -300000, book: -300000 }] }
    - { source: manual, date: 2026-11-05, lines: [{ account: "531004", currency: SYP, amount: 400000, book: 400000 },
                                                  { account: "111003", currency: SYP, amount: -400000, book: -400000 }] }
    - { source: manual, date: 2026-11-08, lines: [{ account: "531004", currency: SYP, amount: 500000, book: 500000 },
                                                  { account: "111003", currency: SYP, amount: -500000, book: -500000 }] }
    - { source: manual, date: 2026-11-09, lines: [{ account: "531004", currency: SYP, amount: 600000, book: 600000 },
                                                  { account: "111003", currency: SYP, amount: -600000, book: -600000 }] }
    - { source: manual, date: 2026-11-10, lines: [{ account: "531004", currency: SYP, amount: 700000, book: 700000 },
                                                  { account: "111003", currency: SYP, amount: -700000, book: -700000 }] }
    - { source: manual, date: 2026-11-11, lines: [{ account: "531004", currency: SYP, amount: 800000, book: 800000 },
                                                  { account: "111003", currency: SYP, amount: -800000, book: -800000 }] }
    - { source: manual, date: 2026-11-12, lines: [{ account: "531004", currency: SYP, amount: 900000, book: 900000 },
                                                  { account: "111003", currency: SYP, amount: -900000, book: -900000 }] }
    - { source: manual, date: 2026-11-15, lines: [{ account: "531004", currency: SYP, amount: 1000000, book: 1000000 },
                                                  { account: "111003", currency: SYP, amount: -1000000, book: -1000000 }] }
    - { source: manual, date: 2026-11-16, lines: [{ account: "531004", currency: SYP, amount: 1100000, book: 1100000 },
                                                  { account: "111003", currency: SYP, amount: -1100000, book: -1100000 }] }
    - { source: manual, date: 2026-12-03, lines: [{ account: "112001", dims: { client: C1 }, currency: SYP, amount: 20000000, book: 20000000 },
                                                  { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -20000000, book: -20000000 }] }
    - { source: manual, date: 2026-12-10, lines: [{ account: "111003", currency: SYP, amount: 20000000, book: 20000000 },
                                                  { account: "112001", dims: { client: C1 }, currency: SYP, amount: -20000000, book: -20000000 }] }
  reports:
    - report: journal_book
      params: { fiscal_year: 2026, from: 2026-11, to: 2026-12, official: true }
      marks: []
      pages:
        # entries 1–10: 1,000,000.00 + (2 + 3 + … + 10) × 1,000.00 = 1,000,000.00 + 54,000.00 = 1,054,000.00
        - { page: 1, entries: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], debits: 105400000, credits: 105400000,
            brought_forward: { debits: 0, credits: 0 }, cumulative: { debits: 105400000, credits: 105400000 } }
        # entry 11: 11,000.00; cumulative 1,054,000.00 + 11,000.00 = 1,065,000.00
        - { page: 2, entries: [11], debits: 1100000, credits: 1100000,
            brought_forward: { debits: 105400000, credits: 105400000 }, cumulative: { debits: 106500000, credits: 106500000 } }
        # December on a new page: 200,000.00 + 200,000.00; cumulative 1,465,000.00
        - { page: 3, entries: [12, 13], debits: 40000000, credits: 40000000,
            brought_forward: { debits: 106500000, credits: 106500000 }, cumulative: { debits: 146500000, credits: 146500000 } }
    # December alone: the same page 3 and the same totals, November's brought forward
    - report: journal_book
      params: { fiscal_year: 2026, from: 2026-12, to: 2026-12, official: true }
      marks: []
      pages:
        - { page: 3, entries: [12, 13], debits: 40000000, credits: 40000000,
            brought_forward: { debits: 106500000, credits: 106500000 }, cumulative: { debits: 146500000, credits: 146500000 } }
    # the book's totals equal the trial balance's period debits and credits for the same dates
    - report: trial_balance
      params: { from: 2026-11-01, to: 2026-12-31, ledger: book, level: 4, non_zero: true }
      marks: []
      rows:
        # 1,000,000.00 + 200,000.00 in; 65,000.00 out
        - { account: "111003", opening: 0, debits: 120000000, credits: 6500000, closing: 113500000 }
        - { account: "112001", opening: 0, debits: 20000000, credits: 20000000, closing: 0 }
        - { account: "311001", opening: 0, debits: 0, credits: 100000000, closing: -100000000 }
        - { account: "411001", opening: 0, debits: 0, credits: 20000000, closing: -20000000 }
        # 2 + 3 + … + 11 = 65 thousand
        - { account: "531004", opening: 0, debits: 6500000, credits: 0, closing: 6500000 }
      totals: { opening_debit: 0, opening_credit: 0, debits: 146500000, credits: 146500000,
                closing_debit: 120000000, closing_credit: 120000000 }
```

### USD books: the income statement's subtotals (`usd-syp`)

December in USD books, with the parallel ledger in SYP at the market rate of 125: revenue, other income, direct costs, salaries, rent, a realised gain on a SYP receipt for a USD receivable, finance costs and income tax. Operating profit takes the operating lines, the exchange differences included (IFRS 18.B65); profit before tax deducts the finance costs; profit for the period deducts the tax. The catalogue has no investing line, so "الربح قبل التمويل وضرائب الدخل" is not shown (rule 14). Both ledgers are revalued at unchanged rates, with no entry.

```yaml
case: December's income statement in USD books with operating profit, profit before tax and profit for the period; the parallel ledger in SYP
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market },
           contracts: [{ code: P1, kind: project, client: C1 }],
           accounts: [{ code: "532005", name: "تكاليف التمويل", name_latin: "Finance costs",
                        statement_line: is.finance_costs }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "125.0000", type: market }
  - { date: 2026-12-24, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - manual: capital paid in
    accounting_date: 2026-12-01
    payload: { lines: [{ account: "111004", currency: USD, amount: 1000000 },
                       { account: "311001", currency: USD, amount: -1000000 }] }
  - manual: invoice M-1 to C1
    accounting_date: 2026-12-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 500000,
                         open_item: { ref: M-1 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -500000 }] }
  - manual: other income
    accounting_date: 2026-12-08
    payload: { lines: [{ account: "111004", currency: USD, amount: 20000 },
                       { account: "422001", currency: USD, amount: -20000 }] }
  - manual: project cost awaiting its payment source
    accounting_date: 2026-12-10
    payload: { lines: [{ account: "511001", dims: { client: C1, contract: P1, department: design }, currency: USD, amount: 150000 },
                       { account: "211002", currency: USD, amount: -150000 }] }
  - manual: December salaries
    accounting_date: 2026-12-15
    payload: { lines: [{ account: "521001", dims: { department: design }, currency: USD, amount: 100000 },
                       { account: "111004", currency: USD, amount: -100000 }] }
  - manual: December rent
    accounting_date: 2026-12-17
    payload: { lines: [{ account: "531001", currency: USD, amount: 40000 },
                       { account: "111004", currency: USD, amount: -40000 }] }
  - manual: 1,000.00 USD of M-1 received as 125,000.00 SYP
    accounting_date: 2026-12-24
    payload: { lines: [{ account: "111003", currency: SYP, amount: 12500000 },
                       { account: "112001", currency: USD, amount: -100000, item: M-1 }] }
  - manual: finance costs
    accounting_date: 2026-12-28
    payload: { lines: [{ account: "532005", currency: USD, amount: 3000 },
                       { account: "111004", currency: USD, amount: -3000 }] }
  - manual: income tax for the period
    accounting_date: 2026-12-31
    payload: { lines: [{ account: "551001", currency: USD, amount: 30000 },
                       { account: "214001", currency: USD, amount: -30000 }] }
  # book: 125,000.00 SYP / 120 = 1,041.67 USD, its carrying amount; parallel: every USD balance at 125
  - revalue: book
    period: 2026-12
  - revalue: parallel
    period: 2026-12
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        # parallel: 10,000.00 USD × 125 (market) = 1,250,000.00 SYP
        - { account: "111004", currency: USD, amount: 1000000, book: 1000000, parallel: 125000000 }
        - { account: "311001", currency: USD, amount: -1000000, book: -1000000, parallel: -125000000 }
    - source: manual
      date: 2026-12-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 500000, book: 500000, parallel: 62500000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -500000, book: -500000, parallel: -62500000 }
    - source: manual
      date: 2026-12-08
      lines:
        - { account: "111004", currency: USD, amount: 20000, book: 20000, parallel: 2500000 }
        - { account: "422001", currency: USD, amount: -20000, book: -20000, parallel: -2500000 }
    - source: manual
      date: 2026-12-10
      lines:
        - { account: "511001", dims: { client: C1, contract: P1, department: design }, currency: USD, amount: 150000, book: 150000, parallel: 18750000 }
        - { account: "211002", currency: USD, amount: -150000, book: -150000, parallel: -18750000 }
    - source: manual
      date: 2026-12-15
      lines:
        - { account: "521001", dims: { department: design }, currency: USD, amount: 100000, book: 100000, parallel: 12500000 }
        - { account: "111004", currency: USD, amount: -100000, book: -100000, parallel: -12500000 }
    - source: manual
      date: 2026-12-17
      lines:
        - { account: "531001", currency: USD, amount: 40000, book: 40000, parallel: 5000000 }
        - { account: "111004", currency: USD, amount: -40000, book: -40000, parallel: -5000000 }
    - source: manual
      date: 2026-12-24
      lines:
        # book: 125,000.00 SYP / 120 (bulletin) = 1,041.666… → 1,041.67 USD; parallel: SYP as is
        - { account: "111003", currency: SYP, amount: 12500000, book: 104167, parallel: 12500000 }
        # 1,000 of 5,000 open: book 1,000.00; parallel 62,500,000 × 1,000 / 5,000 = 12,500,000
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -100000, book: -100000, parallel: -12500000 }
        # book residual 104,167 − 100,000 = 4,167 → a realised gain of 41.67 USD; parallel residual 0
        - { account: "421001", currency: USD, amount: -4167, book: -4167, parallel: 0 }
    - source: manual
      date: 2026-12-28
      lines:
        - { account: "532005", currency: USD, amount: 3000, book: 3000, parallel: 375000 }
        - { account: "111004", currency: USD, amount: -3000, book: -3000, parallel: -375000 }
    - source: manual
      date: 2026-12-31
      lines:
        - { account: "551001", currency: USD, amount: 30000, book: 30000, parallel: 3750000 }
        - { account: "214001", currency: USD, amount: -30000, book: -30000, parallel: -3750000 }
  reports:
    - report: income_statement
      params: { from: 2026-12-01, to: 2026-12-31, ledger: book }
      marks: [period_open]
      lines:
        - { line: is.revenue, amount: 500000 }
        - { line: is.other_income, amount: 20000 }
        - { line: is.direct_costs, amount: -150000 }
        - { line: is.employee_benefits, amount: -100000 }
        - { line: is.other_expenses, amount: -40000 }
        - { line: is.fx_differences, amount: 4167 }
        - { line: is.finance_costs, amount: -3000 }
        - { line: is.income_tax, amount: -30000 }
      # operating: 5,000.00 + 200.00 − 1,500.00 − 1,000.00 − 400.00 + 41.67 = 2,341.67
      # before tax: 2,341.67 − 30.00 = 2,311.67; profit: 2,311.67 − 300.00 = 2,011.67 USD
      subtotals: { operating_profit: 234167, profit_before_tax: 231167, profit: 201167 }
    - report: income_statement
      params: { from: 2026-12-01, to: 2026-12-31, ledger: parallel }
      marks: [period_open]
      lines:
        - { line: is.revenue, amount: 62500000 }
        - { line: is.other_income, amount: 2500000 }
        - { line: is.direct_costs, amount: -18750000 }
        - { line: is.employee_benefits, amount: -12500000 }
        - { line: is.other_expenses, amount: -5000000 }
        - { line: is.finance_costs, amount: -375000 }
        - { line: is.income_tax, amount: -3750000 }
      # operating: 625,000.00 + 25,000.00 − 187,500.00 − 125,000.00 − 50,000.00 = 287,500.00
      # before tax: 287,500.00 − 3,750.00 = 283,750.00; profit: 283,750.00 − 37,500.00 = 246,250.00 SYP
      subtotals: { operating_profit: 28750000, profit_before_tax: 28375000, profit: 24625000 }
```

### A TRY account's statement at a mid-month date (`third`)

A TRY cash account receives 4,100.00 TRY of sundry income on 3 December and pays 820.00 TRY of repairs on 10 December, when the TRY bulletin has moved from 41 to 40. The account statement shows each line's TRY amount with its running TRY balance beside the ledger amount and its running balance (rule 11); the trial balance shows ledger amounts only. Read at 10 December, a date other than a month end, every report carries "قبل إعادة التقييم" (rule 4).

```yaml
case: the account statement of a TRY cash account with its TRY column and both ledgers' running balances; the trial balance at 10 December before revaluation
company: { shape: third, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "111007", name: "الصندوق — ليرة تركية", name_latin: "Cash on hand — TRY",
                        currency: TRY, monetary: true, statement_line: bs.cash }] }
rates:
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "41.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "41.0000", type: market }
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-10, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-12-10, base: USD, quote: TRY, rate: "40.0000", type: market }
steps:
  - manual: sundry income received in TRY
    accounting_date: 2026-12-03
    payload: { lines: [{ account: "111007", currency: TRY, amount: 410000 },
                       { account: "422001", currency: TRY, amount: -410000 }] }
  - manual: repairs paid in TRY
    accounting_date: 2026-12-10
    payload: { lines: [{ account: "531006", currency: TRY, amount: 82000 },
                       { account: "111007", currency: TRY, amount: -82000 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-03
      lines:
        # book: 4,100.00 TRY / 41 × 120 (the cross of both bulletins) = 12,000.00 SYP; parallel: 4,100.00 / 41 = 100.00 USD
        - { account: "111007", currency: TRY, amount: 410000, book: 1200000, parallel: 10000 }
        - { account: "422001", currency: TRY, amount: -410000, book: -1200000, parallel: -10000 }
    - source: manual
      date: 2026-12-10
      lines:
        # book: 820.00 / 40 × 120 = 2,460.00 SYP; parallel: 820.00 / 40 = 20.50 USD
        - { account: "531006", currency: TRY, amount: 82000, book: 246000, parallel: 2050 }
        - { account: "111007", currency: TRY, amount: -82000, book: -246000, parallel: -2050 }
  reports:
    - report: account_statement
      params: { account: "111007", from: 2026-12-01, to: 2026-12-10, ledger: book }
      marks: [period_open, before_revaluation]
      opening: 0
      lines:
        # entry: the case's entry in posting order; balance and transaction_balance are running
        - { entry: 1, date: 2026-12-03, amount: 1200000, balance: 1200000,
            currency: TRY, transaction_amount: 410000, transaction_balance: 410000 }
        - { entry: 2, date: 2026-12-10, amount: -246000, balance: 954000,
            currency: TRY, transaction_amount: -82000, transaction_balance: 328000 }
      closing: 954000
      currencies: [{ currency: TRY, opening: 0, closing: 328000 }]
    - report: account_statement
      params: { account: "111007", from: 2026-12-01, to: 2026-12-10, ledger: parallel }
      marks: [period_open, before_revaluation]
      opening: 0
      lines:
        - { entry: 1, date: 2026-12-03, amount: 10000, balance: 10000,
            currency: TRY, transaction_amount: 410000, transaction_balance: 410000 }
        # 100.00 − 20.50 = 79.50 USD
        - { entry: 2, date: 2026-12-10, amount: -2050, balance: 7950,
            currency: TRY, transaction_amount: -82000, transaction_balance: 328000 }
      closing: 7950
      currencies: [{ currency: TRY, opening: 0, closing: 328000 }]
    - report: trial_balance
      params: { from: 2026-12-01, to: 2026-12-10, ledger: book, level: 4, non_zero: true }
      marks: [period_open, before_revaluation]
      rows:
        - { account: "111007", opening: 0, debits: 1200000, credits: 246000, closing: 954000 }
        - { account: "422001", opening: 0, debits: 0, credits: 1200000, closing: -1200000 }
        - { account: "531006", opening: 0, debits: 246000, credits: 0, closing: 246000 }
      totals: { opening_debit: 0, opening_credit: 0, debits: 1446000, credits: 1446000,
                closing_debit: 1200000, closing_credit: 1200000 }
```
