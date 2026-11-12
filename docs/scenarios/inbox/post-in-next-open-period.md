# Posting a held event of a closed month in the next open period

Status: Approved (owner, 2026-11-07)

These two cases are the first two of `inbox/holds-and-actions.md`, moved unchanged by S05's feature slice. The owner approved their expected entries and outcomes on 2026-11-07, with an event moved out of a closed period measured at the rates of its own accounting date. S05 brought their executors (the `event` executor, the hold `PERIOD_CLOSED`, the `retry` and `move` actions, S05 rules 8, 11 and 15), and their setup closes a month (`closed_periods`), which S07's close does through the close service (its second PR), as a case's company is made through the runtime roles, never the owner; S07's feature slice switched the file to `Approved (owner, 2026-11-07)`, with no expected value changed. `packages/db`'s inbox tests run the same move with the period closed as the ledger tests close one.

## Rule

An event dated in a closed period is held `PERIOD_CLOSED`; a retry keeps it held. The accountant may post it on the first day of the first open period after its accounting date, with a written reason: the entry is dated on that day, but every line is measured as the event would have been on its own accounting date, at each ledger's policy rate of that date or at the document's `syp_per_usd` where that ledger accepts it (owner, 2026-11-07). The events waiting behind it on its item key are retried once it posts.

## Basis

- **ADR 0005, invariant 3:** nothing posts into a closed period. **Phase 1 scope F10 "Closed period"** and ADR 0014: the accountant posts a held event on the first day of the next open period or reopens the period (S07).
- **IAS 21.21–22:** a foreign-currency transaction is recorded at the spot rate of the date of the transaction. Moving the posting date out of a closed month changes the period the entry lands in, not the transaction's date, so the measurement keeps the rates of the event's accounting date and the move creates no exchange difference (owner, 2026-11-07; the same principle as S05 rule 13, the new state measured at the document's date). **IAS 21.23(b) and 21.28:** a later settlement of the item carries what the item carries; the gap is a realised difference of the settlement's date.
- **IAS 8.41–42:** a late document of a closed month is recognised in the open month; a material one is a reason to reopen the month (S07) instead, which is the accountant's choice, not the system's.
- **Company policy:** `phase-1-scope.md` §4 (book ledger at the bulletin, the USD parallel ledger at market or the transaction's own rate) and F10; S05 rules 8–11 (holds and order per item) and 15 (the move; owner, 2026-11-07); ADR 0013 (settlement in proportion to what remains).
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The account codes are the service-agency template's (S02): the USD bank account `111004`, trade receivables `112001` (a `document` control account, client required), service revenue `411001` (client and service required), realised exchange gains `421001`. Every rate and amount is synthetic. Tuesday 29 September, Wednesday 28 October, Sunday 1 and Thursday 5 November 2026 are publication days.

An action names the event by its step number (`move: 1`). A rate a case lists but no expected line reads is there to show it is not read. The move is measured in `syp-usd` (the book ledger at the bulletin of the event's date) and in `usd-syp` (the USD books at that bulletin, the SYP parallel ledger at the document's `syp_per_usd`); in `syp` the same book measurement applies with no parallel ledger, so it adds no case. `third` cannot occur, since Hub's events are in SYP or USD (S05 "Currencies, rates and rounding").

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
