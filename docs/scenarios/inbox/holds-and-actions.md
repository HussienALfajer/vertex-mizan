# Holds and the accountant's actions in the event inbox

Status: Proposed

The cases stay `Proposed` until S05 brings their executors: the `event` executor through the event inbox, the posting rules of `invoice.issued`, `payment.recorded` and `payment.voided`, the holds `PERIOD_CLOSED`, `WAITING_FOR_EARLIER_EVENT` and `NEEDS_DECISION`, the automatic retries, the inbox actions (`retry`, `move`, `resolve`, `dismiss`) and the closed periods of the setup (S05 rules 8–11, 15–17). S05's feature slice switches the file to `Approved (owner, <the approval's date>)`.

## Rule

An event dated in a closed period is held `PERIOD_CLOSED`; a retry keeps it held. The accountant may post it on the first day of the first open period after its accounting date, with a written reason: the entry is dated on that day, but every line is measured as the event would have been on its own accounting date, at each ledger's policy rate of that date or at the document's `syp_per_usd` where that ledger accepts it (owner, 2026-11-07). An event held `NEEDS_DECISION` is resolved by linking it to a posted manual entry the accountant made for it; the event never posts, and a manual entry resolves one event only. A later event on the same document (the payment for `payment.*`, the invoice for `invoice.*`; owner, 2026-11-07) is then held `NEEDS_DECISION` (`document_resolved_manually`), and the accountant resolves it with the reversal of the manual entry. The owner may dismiss any held event with a written reason: it never posts, the events waiting behind it are retried, and a later event on the dismissed document is held `document_resolved_manually`. A dismissed or resolved event never returns to `held`. Every action moves only the inbox; the entries are those of the posting rules and the manual entries.

## Basis

- **ADR 0005, invariant 3:** nothing posts into a closed period. **Phase 1 scope F10 "Closed period"** and ADR 0014: the accountant posts a held event on the first day of the next open period or reopens the period (S07).
- **IAS 21.21–22:** a foreign-currency transaction is recorded at the spot rate of the date of the transaction. Moving the posting date out of a closed month changes the period the entry lands in, not the transaction's date, so the measurement keeps the rates of the event's accounting date and the move creates no exchange difference (owner, 2026-11-07; the same principle as S05 rule 13, the new state measured at the document's date). **IAS 21.23(b) and 21.28:** a later settlement of the item carries what the item carries; the gap is a realised difference of the settlement's date.
- **IAS 8.41–42:** a late document of a closed month is recognised in the open month; a material one is a reason to reopen the month (S07) instead, which is the accountant's choice, not the system's.
- **IFRS 15.106 and IAS 1.32:** a payment beyond what was applied is a liability, never a credit on the client's receivable; S04's approved `receivables/manual-settlement` posts such an excess to other payables `211003`.
- **Company policy:** `phase-1-scope.md` §4 (book ledger at the bulletin, the USD parallel ledger at market or the transaction's own rate) and F10; S05 rules 8–11 (holds and order per item), 15–18 (the actions; owner, 2026-11-07); ADR 0013 (settlement in proportion to what remains).
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The account codes are the service-agency template's (S02): the USD bank account `111004`, trade receivables `112001` (a `document` control account, client required), other payables `211003`, service revenue `411001` (client and service required), realised exchange gains `421001`. Every rate and amount is synthetic. Tuesday 29 September, Wednesday 28 October, Sunday 1, Tuesday 3, Thursday 5, Thursday 19 and Tuesday 24 November 2026 are publication days.

An action names the event by its step number (`move: 1`); `resolve` also names the manual entry by its number in posting order. A rate a case lists but no expected line reads is there to show it is not read.

The shapes: the move is measured in `syp-usd` (the book ledger at the bulletin of the event's date) and in `usd-syp` (the USD books at that bulletin, the SYP parallel ledger at the document's `syp_per_usd`); in `syp` the same book measurement applies with no parallel ledger, so it adds no case. The other actions post nothing of their own: their entries are the manual entry and its reversal, whose rules `receivables/manual-settlement` and `manual/reversal` cover in every shape. `third` cannot occur, since Hub's events are in SYP or USD (S05 "Currencies, rates and rounding").

The cases leave out what other scenarios or later specs own: the reopening of a period (S07), an event held `SERVICE_PERIOD_CLOSED` (S06), the retries after a rate or a mapping (`receivables/hub-payment`, `ad-funds/running-balance`, `revenue/revenue-at-issue`), and S08's reconciliation of dismissed events.

### Vertex Media: an invoice of a closed month posted in the next open period, and the payment waiting behind it

The invoice is dated 28 October, after October was closed: held `PERIOD_CLOSED`. Its payment, received later, waits behind it on the invoice's key (S05 rule 11). A retry re-checks every reason, and October is still closed. The accountant moves the invoice: it posts on 1 November, measured at the bulletin of 28 October, 118, not that of 1 November, 120. Once the invoice leaves `held`, the payment is retried and posts on its own date against what the item carries.

```yaml
case: an invoice dated in closed October is moved to 1 November at the bulletin of its own date; the payment behind it then posts
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency, closed_periods: [2026-10],
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-10-28, base: USD, quote: SYP, rate: "118.0000", type: bulletin }
  - { date: 2026-11-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-10-28
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "119.0000",
               issued_on: 2026-10-28, due_on: 2026-11-27,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: S1 }] }
    outcome: { status: held, reason: PERIOD_CLOSED }
  - event: payment.recorded
    accounting_date: 2026-11-05
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-05,
               method: bank_transfer, currency: USD, amount: 40000, syp_per_usd: "122.0000",
               applied_amount: 40000, invoice_currency: USD }
    outcome: { status: held, reason: WAITING_FOR_EARLIER_EVENT }
  - retry: 1
    outcome: { status: held, reason: PERIOD_CLOSED }
  - move: 1
    reason: "وصلت الفاتورة بعد إقفال تشرين الأول"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-01
      lines:
        # dated 1 November; book: 1,000.00 USD × 118 (the bulletin of 28 October) = 118,000.00 SYP,
        # not × 120 (1 November); parallel: USD as is
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 11800000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -11800000, parallel: -100000 }
    - source: payment.recorded
      date: 2026-11-05
      lines:
        # retried once the invoice leaves held; bank_transfer in USD → 111004 at the bulletin of 5 November:
        # 400.00 × 121 = 48,400.00 SYP
        - { account: "111004", currency: USD, amount: 40000, book: 4840000, parallel: 40000 }
        # 400.00 of 1,000.00 open: book 11,800,000 × 40,000 / 100,000 = 4,720,000 exactly
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4720000, parallel: -40000 }
        # book residual: 4,840,000 − 4,720,000 = 120,000 → realised gain 1,200.00 SYP; none in the parallel ledger
        - { account: "421001", currency: SYP, amount: -120000, book: -120000, parallel: 0 }
  balances:
    - { account: "411001", book: -11800000, parallel: -100000 }
    - { account: "421001", book: -120000, parallel: 0 }
  open_items:
    # 1,000.00 − 400.00 = 600.00 USD; book 11,800,000 − 4,720,000 = 7,080,000
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 60000, book: 7080000, parallel: 60000 }
```

### USD books: an SYP invoice moved past two closed months

September and October are closed, so the first open period after 29 September is November: the invoice posts on 1 November. The USD books measure the SYP invoice at the bulletin of 29 September, 120, not that of 1 November, 125; the SYP parallel ledger takes the SYP amount as is.

```yaml
case: USD books; an SYP invoice dated 29 September, with September and October closed, posts on 1 November at the bulletin of 29 September
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency, closed_periods: [2026-09, 2026-10],
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-09-29, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-01, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-09-29
    payload: { invoice: INV-2026-1, client: C1, currency: SYP, syp_per_usd: "122.0000",
               issued_on: 2026-09-29, due_on: 2026-10-29,
               lines: [{ line: L1, amount: 12200000, source: extra_work, service: S1 }] }
    outcome: { status: held, reason: PERIOD_CLOSED }
  - move: 1
    reason: "وصلت الفاتورة بعد إقفال أيلول وتشرين الأول"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-01
      lines:
        # book: 122,000.00 SYP / 120 (the bulletin of 29 September) = 1,016.6666… → 1,016.67 USD,
        # not / 125 (1 November); parallel: SYP as is
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 12200000, book: 101667, parallel: 12200000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -12200000, book: -101667, parallel: -12200000 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: SYP, amount: 12200000, book: 101667, parallel: 12200000 }
```

### Vertex Media: an overpayment resolved by a manual entry, and its void

Hub applies 400.00 USD of a 450.00 USD payment: held `NEEDS_DECISION` (`amount_above_applied`, `receivables/hub-payment`). Moving it is refused, since only a `PERIOD_CLOSED` event can be moved. The accountant posts the payment by hand, the applied part to the invoice's item and the 50.00 USD excess to other payables (IFRS 15.106), and resolves the event with that entry; the event posts nothing itself. When Hub voids the payment, the void is held `document_resolved_manually`. The manual entry already resolved the payment, so it cannot resolve the void. The accountant reverses the manual entry on the void's date and resolves the void with the reversal: the item is back to the whole invoice, and every other account to zero.

```yaml
case: 450.00 USD applied as 400.00 is held, resolved by a manual entry with the excess in 211003; its void is held, then resolved by the entry's reversal
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: bank_transfer, currency: USD, amount: 45000, syp_per_usd: "124.0000",
               applied_amount: 40000, invoice_currency: USD }
    outcome: { status: held, reason: NEEDS_DECISION, detail: amount_above_applied }
  - move: 2
    reason: "محاولة نقل حدث غير مؤرخ في فترة مغلقة"
    outcome: { status: refused, reason: EVENT_ACTION_NOT_ALLOWED }
  - manual: the payment PAY-1 by hand, the excess as a liability to the client
    accounting_date: 2026-11-19
    payload: { reference: R-2026-1,
               lines: [{ account: "111004", currency: USD, amount: 45000 },
                       { account: "112001", currency: USD, amount: -40000, item: INV-2026-1 },
                       { account: "211003", currency: USD, amount: -5000, memo: "دفعة زائدة من العميل C1 — PAY-1" }] }
  - resolve: { step: 2, entry: 2 }
    reason: "الزيادة 50.00 دولار التزام للعميل وليست سداداً"
  - event: payment.voided
    accounting_date: 2026-11-24
    payload: { payment: PAY-1, voided_on: 2026-11-24 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: document_resolved_manually }
  - resolve: { step: 6, entry: 2 }
    reason: "القيد اليدوي نفسه"
    outcome: { status: refused, reason: ENTRY_ALREADY_LINKED }
  - reversal: 2
    accounting_date: 2026-11-24
  - resolve: { step: 6, entry: 3 }
    reason: "عُكس القيد اليدوي بعد إلغاء الدفعة في Hub"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: manual
      date: 2026-11-19
      lines:
        # a new measurement: 450.00 USD × 123 = 55,350.00 SYP
        - { account: "111004", currency: USD, amount: 45000, book: 5535000, parallel: 45000 }
        # 400.00 of 1,000.00 open: book 12,000,000 × 40,000 / 100,000 = 4,800,000 exactly
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
        # a new measurement: 50.00 USD × 123 = 6,150.00 SYP
        - { account: "211003", currency: USD, amount: -5000, book: -615000, parallel: -5000 }
        # book residual: 5,535,000 − 4,800,000 − 615,000 = 120,000 → realised gain 1,200.00 SYP;
        # parallel: 45,000 − 40,000 − 5,000 = 0
        - { account: "421001", currency: SYP, amount: -120000, book: -120000, parallel: 0 }
    - source: reversal
      date: 2026-11-24
      lines:
        # the exact negation of the manual entry; it reopens the item at what it had
        - { account: "111004", currency: USD, amount: -45000, book: -5535000, parallel: -45000 }
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 40000, book: 4800000, parallel: 40000 }
        - { account: "211003", currency: USD, amount: 5000, book: 615000, parallel: 5000 }
        - { account: "421001", currency: SYP, amount: 120000, book: 120000, parallel: 0 }
  balances:
    - { account: "111004", book: 0, parallel: 0 }
    - { account: "211003", book: 0, parallel: 0 }
    - { account: "421001", book: 0, parallel: 0 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
```

### Vertex Media: a dismissed payment and the payment waiting behind it

The first payment's gap is beyond the tolerance: held `NEEDS_DECISION` (`payment_gap_beyond_tolerance`, `receivables/hub-payment`). The second payment, on the same invoice, waits behind it. The owner dismisses the first: it never posts, and the second is retried. The second payment is another document, so it is not held `document_resolved_manually` (owner, 2026-11-07): it posts on its own date against the whole item.

```yaml
case: a payment held beyond the tolerance is dismissed; the payment waiting behind it then posts against the whole item
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-24, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    # the gap: 5,000,000 / 124 = 40,322.58… → 40,323; 40,323 − 40,222 = 101 = 1.01 USD, more than the tolerance
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: bank_transfer, currency: SYP, amount: 5000000, syp_per_usd: "124.0000",
               applied_amount: 40222, invoice_currency: USD }
    outcome: { status: held, reason: NEEDS_DECISION, detail: payment_gap_beyond_tolerance }
  - event: payment.recorded
    accounting_date: 2026-11-24
    payload: { payment: PAY-2, receipt: R-2026-2, invoice: INV-2026-1, paid_on: 2026-11-24,
               method: bank_transfer, currency: USD, amount: 60000, syp_per_usd: "124.5000",
               applied_amount: 60000, invoice_currency: USD }
    outcome: { status: held, reason: WAITING_FOR_EARLIER_EVENT }
  - dismiss: 2
    reason: "لم يصل التحويل إلى حساب الشركة"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: payment.recorded
      date: 2026-11-24
      lines:
        # retried once PAY-1 is dismissed; bank_transfer in USD → 111004: 600.00 × 123.5 = 74,100.00 SYP
        - { account: "111004", currency: USD, amount: 60000, book: 7410000, parallel: 60000 }
        # 600.00 of the 1,000.00 open: book 12,000,000 × 60,000 / 100,000 = 7,200,000 exactly
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -60000, book: -7200000, parallel: -60000 }
        # book residual: 7,410,000 − 7,200,000 = 210,000 → realised gain 2,100.00 SYP
        - { account: "421001", currency: SYP, amount: -210000, book: -210000, parallel: 0 }
  balances:
    - { account: "111004", book: 7410000, parallel: 60000 }
  open_items:
    # 1,000.00 − 600.00 = 400.00 USD; book 12,000,000 − 7,200,000 = 4,800,000
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 40000, book: 4800000, parallel: 40000 }
```

### Vertex Media: a dismissed payment and its own void

Hub voids the payment while it is held: the void waits behind it. The owner dismisses the payment, and the void is retried: it is on the dismissed document, so it is held `document_resolved_manually` (S05 rule 16). Nothing stands to reverse, so the owner dismisses the void too. A dismissed event never returns to `held`: a retry of it is refused. Only the invoice is in the books, as in Hub once its payment is voided.

```yaml
case: a payment held beyond the tolerance is dismissed; its void, waiting behind it, is then held document_resolved_manually and dismissed too
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-1, client: C1, currency: USD, syp_per_usd: "122.0000",
               issued_on: 2026-11-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 100000, source: extra_work, service: S1 }] }
  - event: payment.recorded
    accounting_date: 2026-11-19
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-1, paid_on: 2026-11-19,
               method: bank_transfer, currency: SYP, amount: 5000000, syp_per_usd: "124.0000",
               applied_amount: 40222, invoice_currency: USD }
    outcome: { status: held, reason: NEEDS_DECISION, detail: payment_gap_beyond_tolerance }
  - event: payment.voided
    accounting_date: 2026-11-24
    payload: { payment: PAY-1, voided_on: 2026-11-24 }
    outcome: { status: held, reason: WAITING_FOR_EARLIER_EVENT }
  - dismiss: 2
    reason: "أُلغيت الدفعة في Hub"
  - retry: 3
    outcome: { status: held, reason: NEEDS_DECISION, detail: document_resolved_manually }
  - dismiss: 3
    reason: "إلغاء لدفعة أُسقطت ولم تُرحّل"
  - retry: 2
    outcome: { status: refused, reason: EVENT_NOT_HELD }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
  balances:
    - { account: "111003", book: 0, parallel: 0 }
  open_items:
    - { item: INV-2026-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
```
