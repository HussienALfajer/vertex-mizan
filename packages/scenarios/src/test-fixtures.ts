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
company: { shape: syp, book: SYP, template: contracting, rate_policy: { book: bulletin },
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

/** S12: a progress billing of a project with its terms, and the document it holds. */
export const BILLING = `
case: a progress billing
company: { shape: syp, book: SYP, rate_policy: { book: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: SYP, value: 1000000, retention_bp: 1000, advance_recovery_bp: 2000 } }] }
steps:
  - project_document: progress billing 1 of P1
    accounting_date: 2026-11-03
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 100000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 90000, book: 90000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: SYP, amount: 10000, book: 10000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -100000, book: -100000 }
  project_documents:
    - { kind: progress_billing, number: 1, date: 2026-11-03, contract: P1, client: C1, sequence: 1, entry: 1,
        currency: SYP, cumulative: 100000, previous: 0, retention: 10000, advance: 0 }
`;

/** S12: a subcontractor's billing on a subcontract, and the document it holds. */
export const SUBCONTRACT_BILLING = `
case: a subcontractor's billing
company: { shape: syp, book: SYP, rate_policy: { book: bulletin }, template: contracting,
           contracts: [{ code: P1, kind: project, client: C1 }],
           subcontracts: [{ contract: P1, supplier: S2, currency: SYP, value: 1000000,
                            retention_bp: 1000, advance_recovery_bp: 2000 }] }
steps:
  - project_document: S2's billing 1 on P1
    accounting_date: 2026-11-03
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 100000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: SYP, amount: 100000, book: 100000 }
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: SYP, amount: -10000, book: -10000 }
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: SYP, amount: -90000, book: -90000 }
  project_documents:
    - { kind: subcontract_billing, number: 1, date: 2026-11-03, contract: P1, client: C1, supplier: S2, sequence: 1,
        entry: 1, currency: SYP, cumulative: 100000, previous: 0, retention: 10000, advance: 0 }
`;

/** S12: a client's and a subcontractor's retention released, and the documents they hold. */
export const RETENTION_RELEASE = `
case: retention releases
company: { shape: syp, book: SYP, rate_policy: { book: bulletin }, template: contracting,
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: SYP, value: 1000000, retention_bp: 1000, advance_recovery_bp: 0 } }],
           subcontracts: [{ contract: P1, supplier: S2, currency: SYP, retention_bp: 1000, advance_recovery_bp: 0 }] }
steps:
  - project_document: progress billing 1 of P1
    accounting_date: 2026-11-03
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 100000 } }
  - project_document: S2's billing 1 on P1
    accounting_date: 2026-11-03
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 100000 } }
  - project_document: the client's retention released
    accounting_date: 2026-11-30
    payload: { document: { kind: retention_release, side: client, contract: P1,
                           retention_items: [{ item: "2026/1", amount: 10000 }] } }
  - project_document: S2's retention released
    accounting_date: 2026-11-30
    payload: { document: { kind: retention_release, side: supplier, contract: P1, supplier: S2, retention: 10000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 90000, book: 90000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: SYP, amount: 10000, book: 10000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -100000, book: -100000 }
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: SYP, amount: 100000, book: 100000 }
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: SYP, amount: -10000, book: -10000 }
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: SYP, amount: -90000, book: -90000 }
    - source: manual
      date: 2026-11-30
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 10000, book: 10000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: SYP, amount: -10000, book: -10000 }
    - source: manual
      date: 2026-11-30
      lines:
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: SYP, amount: 10000, book: 10000 }
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: SYP, amount: -10000, book: -10000 }
  project_documents:
    - { kind: progress_billing, number: 1, date: 2026-11-03, contract: P1, client: C1, sequence: 1, entry: 1,
        currency: SYP, cumulative: 100000, previous: 0, retention: 10000, advance: 0 }
    - { kind: subcontract_billing, number: 1, date: 2026-11-03, contract: P1, client: C1, supplier: S2, sequence: 1,
        entry: 2, currency: SYP, cumulative: 100000, previous: 0, retention: 10000, advance: 0 }
    - { kind: retention_release, number: 1, date: 2026-11-30, contract: P1, client: C1, side: client, entry: 3,
        currency: SYP, retention: 10000 }
    - { kind: retention_release, number: 2, date: 2026-11-30, contract: P1, client: C1, side: supplier, supplier: S2,
        entry: 4, currency: SYP, retention: 10000 }
`;

/** S12: a wage sheet with a days line and a lump sum, and the document it holds. */
export const WAGE_SHEET = `
case: a wage sheet
company: { shape: syp, book: SYP, rate_policy: { book: bulletin }, template: contracting,
           contracts: [{ code: P1, kind: project, client: C1 }] }
steps:
  - project_document: the wage sheet of P1 for 1–15 December
    accounting_date: 2026-12-15
    payload: { document: { kind: wage_sheet, contract: P1, currency: SYP, period_from: 2026-12-01, period_to: 2026-12-15 },
               lines: [{ worker: W1, days: "6.0", daily_rate: "3000.0000" },
                       { worker: W2, amount: 4800000, description: "نجارة" }] }
expect:
  entries:
    - source: manual
      date: 2026-12-15
      lines:
        - { account: "511002", dims: { contract: P1, worker: W1 }, currency: SYP, amount: 1800000, book: 1800000 }
        - { account: "511002", dims: { contract: P1, worker: W2 }, currency: SYP, amount: 4800000, book: 4800000 }
        - { account: "211007", dims: { worker: W1, contract: P1 }, currency: SYP, amount: -1800000, book: -1800000 }
        - { account: "211007", dims: { worker: W2, contract: P1 }, currency: SYP, amount: -4800000, book: -4800000 }
  project_documents:
    - { kind: wage_sheet, number: 1, date: 2026-12-15, contract: P1, client: C1, entry: 1, currency: SYP,
        period_from: 2026-12-01, period_to: 2026-12-15 }
  quantities:
    - { entry: 1, account: "511002", currency: SYP, amount: 1800000, unit: "يوم", quantity: "6.000", unit_price: "3000.0000" }
`;

/** S12: a project purchase invoice with quantities, a price adjustment and the document it holds. */
export const PURCHASE = `
case: a project purchase invoice
company: { shape: syp, book: SYP, rate_policy: { book: bulletin }, template: contracting,
           contracts: [{ code: P1, kind: project, client: C1 }],
           materials: [{ code: CEM, name: "أسمنت", unit: "طن" }] }
steps:
  - project_document: S1's invoice for P1
    accounting_date: 2026-11-03
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: SYP, supplier_reference: "F-1" },
               lines: [{ account: "511001", material: CEM, quantity: "12.500", unit_price: "3.0300" },
                       { account: "511001", material: CEM, quantity: "0.000", amount: -500 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "511001", dims: { contract: P1 }, currency: SYP, amount: 3788, book: 3788 }
        - { account: "511001", dims: { contract: P1 }, currency: SYP, amount: -500, book: -500 }
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: SYP, amount: -3288, book: -3288 }
  project_documents:
    - { kind: purchase, number: 1, date: 2026-11-03, contract: P1, client: C1, supplier: S1, entry: 1,
        currency: SYP, reference: "F-1" }
  quantities:
    - { entry: 1, account: "511001", currency: SYP, amount: 3788, material: CEM, unit: "طن", quantity: "12.500", unit_price: "3.0300" }
    - { entry: 1, account: "511001", currency: SYP, amount: -500, material: CEM, unit: "طن", quantity: "0.000" }
`;
