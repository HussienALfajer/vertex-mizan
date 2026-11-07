// Synthetic cases in the README format for the runner's own tests, which break one thing at a time.

export const CASE = `
case: USD invoice issued
company: { shape: syp-usd, book: SYP, parallel: USD, rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-1, client: C1, currency: USD, lines: [{ amount: 10000, service: S1 }] }
expect:
  entries:
    - source: invoice.issued
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

export const INBOX = `
case: the accountant's actions on held events
company: { shape: syp, book: SYP, closed_periods: [2026-10], rate_policy: { book: bulletin } }
steps:
  - event: invoice.issued
    accounting_date: 2026-10-28
    payload: { invoice: INV-1, client: C1, currency: SYP, lines: [{ amount: 50000, service: S1 }] }
    outcome: { status: held, reason: PERIOD_CLOSED }
  - retry: 1
    outcome: { status: held, reason: PERIOD_CLOSED }
  - move: 1
    reason: "أُغلق تشرين الأول قبل وصول الفاتورة"
  - event: payment.recorded
    accounting_date: 2026-11-05
    payload: { payment: PAY-1, invoice: INV-1, currency: SYP, amount: 60000 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: amount_above_applied }
  - manual: the payment by hand
    accounting_date: 2026-11-05
    payload: { amount: 60000 }
  - resolve: { step: 4, entry: 2 }
    reason: "الزيادة التزام للعميل"
  - event: payment.recorded
    accounting_date: 2026-11-06
    payload: { payment: PAY-2, invoice: INV-1, currency: SYP, amount: 100 }
    outcome: { status: held, reason: NEEDS_DECISION }
  - dismiss: 7
    reason: "سُجّلت في Hub خطأً"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-01
      lines:
        - { account: "1210", dims: { client: C1 }, currency: SYP, amount: 50000, book: 50000 }
        - { account: "4110", dims: { client: C1, service: S1 }, currency: SYP, amount: -50000, book: -50000 }
    - source: manual
      date: 2026-11-05
      lines:
        - { account: "111003", currency: SYP, amount: 60000, book: 60000 }
        - { account: "1210", dims: { client: C1 }, currency: SYP, amount: -60000, book: -60000 }
`;
