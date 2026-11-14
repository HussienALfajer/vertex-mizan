// Synthetic cases in the README format for the runner's own tests, which break one thing at a time.

export const CASE = `
case: USD invoice issued
company: { shape: syp-usd, book: SYP, parallel: USD, rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - manual: a USD invoice
    accounting_date: 2026-11-03
    payload: { invoice: INV-1, client: C1, currency: USD, lines: [{ amount: 10000, service: S1 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "1210", dims: { client: C1 }, currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
        - { account: "4110", dims: { client: C1, service: S1 }, currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
  balances:
    - { account: "1210", book: 1200000, parallel: 10000 }
  open_items:
    - { item: INV-1, account: "1210", dims: { client: C1 }, currency: USD, amount: 10000, book: 1200000, parallel: 10000 }
`;

export const SYP_ONLY = `
case: SYP invoice issued
company: { shape: syp, book: SYP, rate_policy: { book: bulletin } }
steps:
  - manual: an SYP invoice
    accounting_date: 2026-11-03
    payload: { amount: 50000 }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "1210", currency: SYP, amount: 50000, book: 50000 }
        - { account: "4110", currency: SYP, amount: -50000, book: -50000 }
`;

export const CORRECTION = `
case: a bulletin corrected after use
company: { shape: syp-usd, book: SYP, parallel: USD, bulletin_holidays: [2026-11-09],
           rate_policy: { book: bulletin, parallel: market } }
rates:
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "112.5000", type: bulletin }
steps:
  - manual: an expense
    accounting_date: 2026-11-08
    payload: { amount: 10000 }
  - rate: { date: 2026-11-08, base: USD, quote: SYP, rate: "121.5000", type: bulletin, reason: Mistyped }
  - reversal: 1
    accounting_date: 2026-11-08
expect:
  entries:
    - source: manual
      date: 2026-11-08
      lines:
        - { account: "531004", currency: USD, amount: 10000, book: 1125000, parallel: 10000 }
        - { account: "111004", currency: USD, amount: -10000, book: -1125000, parallel: -10000 }
    - source: reversal
      date: 2026-11-08
      lines:
        - { account: "531004", currency: USD, amount: -10000, book: -1125000, parallel: -10000 }
        - { account: "111004", currency: USD, amount: 10000, book: 1125000, parallel: 10000 }
  corrections:
    - { step: 2, used_by: [1] }
`;

/** One report of each kind after an SYP invoice, a contract and a manual service's department (S09). */
export const REPORTS = `
case: reports after an SYP invoice
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }] }
steps:
  - service_department: { service: S1, department: design, effective_from: 2026-11-01 }
    reason: "خدمة يدوية يقدمها قسم التصميم"
  - manual: an SYP invoice
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: SYP, amount: 50000, open_item: { ref: M-1 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -50000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 50000, book: 50000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -50000, book: -50000 }
  reports:
    - report: trial_balance
      params: { from: 2026-11-01, to: 2026-11-30, ledger: book, level: 4 }
      marks: [period_open]
      rows:
        - { account: "112001", opening: 0, debits: 50000, credits: 0, closing: 50000 }
        - { account: "411001", opening: 0, debits: 0, credits: 50000, closing: -50000 }
      totals: { opening_debit: 0, opening_credit: 0, debits: 50000, credits: 50000,
                closing_debit: 50000, closing_credit: 50000 }
    - report: income_statement
      params: { from: 2026-11-01, to: 2026-11-30 }
      marks: [period_open]
      lines: [{ line: is.revenue, amount: 50000 }]
      subtotals: { operating_profit: 50000, profit_before_tax: 50000, profit: 50000 }
    - report: balance_sheet
      params: { as_of: 2026-11-30 }
      marks: [period_open]
      lines: [{ line: bs.trade_receivables, amount: 50000,
                parts: [{ account: "112001", dims: { client: C1 }, amount: 50000 }] }]
      year_result: 50000
      totals: { assets: 50000, liabilities: 0, equity: 50000, liabilities_and_equity: 50000 }
    - report: profitability
      params: { by: department, from: 2026-11-01, to: 2026-11-30 }
      marks: [period_open]
      rows: [{ value: design, revenue: 50000, direct_costs: 0, contribution: 50000, margin: "100.0" }]
      totals: { revenue: 50000, direct_costs: 0, contribution: 50000, margin: "100.0" }
    - report: account_statement
      params: { account: "112001", from: 2026-11-01, to: 2026-11-30 }
      marks: [period_open]
      opening: 0
      lines: [{ entry: 1, date: 2026-11-03, amount: 50000, balance: 50000,
                currency: SYP, transaction_amount: 50000, transaction_balance: 50000 }]
      closing: 50000
      currencies: [{ currency: SYP, opening: 0, closing: 50000 }]
    - report: journal_book
      params: { fiscal_year: 2026, from: 2026-11, to: 2026-11 }
      marks: [period_open]
      pages: [{ page: 1, entries: [1], debits: 50000, credits: 50000,
                brought_forward: { debits: 0, credits: 0 }, cumulative: { debits: 50000, credits: 50000 } }]
`;
