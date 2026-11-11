# Recognising a closed month's elapsed part in the first open period

Status: Proposed

This case is the seventh of `revenue/over-time-release.md`, moved unchanged by S06's feature slice (PR 1). The owner approved its expected entries and outcome on 2026-11-10, with the elapsed part of a closed month measured at the rates of its own month's last day. S06 brought its executors (the posting rule of `invoice.issued` with over-time lines, the hold `SERVICE_PERIOD_CLOSED`, the action `recognise` and the release job `revenue_release_month`; S06 rules 7, 16 and 18); its setup closes October, which the book does with S07's close (`closed_periods`), so it stays `Proposed` until S07, then becomes `Approved (owner, 2026-11-10)`. `packages/db/test/recognition.test.ts` runs the same case with the month closed by hand.

## Rule

An invoice whose elapsed month is closed is held `SERVICE_PERIOD_CLOSED` whole (S06 rules 7 and 18). The accountant may recognise it in the first open period, with a written reason (S06 rule 16): each elapsed part of a closed month posts on the first day of the first open period after it, still measured at each ledger's policy rate of its own month's last day; the invoice posts on its own date, clearing that contract asset at what it carries, and the residual is a realised exchange difference.

## Basis

- **ADR 0005, invariant 3:** nothing posts into a closed period. **IAS 8.41–42:** a late document of a closed month is recognised in the open month; a material one is a reason to reopen the month (S07) instead, which is the accountant's choice, not the system's.
- **IAS 21.21–22:** the elapsed month's revenue is recognised at the spot rate of the month's last day; moving the posting date into the open month changes the period the entry lands in, not the transaction's date. **IAS 21.28:** the gap between the asset and the invoice's measurement is a realised exchange difference.
- **IFRS 15.35(a), 15.107:** the service of the elapsed month was transferred before the invoice: a contract asset, reclassified to the receivable when invoiced.
- **Company policy:** S06 rules 7, 16 and 18 (owner, 2026-11-10); ADR 0015.
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The account codes and the short form are `revenue/over-time-release.md`'s. 29 October and 5 November 2026 are publication days; 31 October 2026 is a Saturday.

### Vertex Media: a late issue into a closed month, recognised in the first open period

The same invoice, with October closed: its elapsed month is closed, so it is held `SERVICE_PERIOD_CLOSED` whole (S06 rule 7). The accountant recognises it in the first open period (S06 rule 16): October's part posts on 1 November, still measured at the bulletin in force on 31 October; the invoice then posts on its own date, as in the case above.

```yaml
case: the same late invoice with October closed is held SERVICE_PERIOD_CLOSED; recognised on 1 Nov at the rate of 31 Oct
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency, closed_periods: [2026-10],
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-10-29, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "120.5000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-05
    payload: { invoice: INV-2026-24, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "121.0000", issued_on: 2026-11-05, due_on: 2026-11-20,
               lines: [{ line: L1, amount: 62000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-10-20, cycle_end: 2026-11-19, service: S1 }] }
    outcome: { status: held, reason: SERVICE_PERIOD_CLOSED }
  - recognise: 1
    reason: "أُغلق تشرين الأول قبل وصول الفاتورة؛ الجزء غير جوهري"
  - job: revenue_release_month
    period: 2026-11
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-01
      lines:
        # October's 12 days on the first day of the first open period, still at 119 (IAS 21.21–22), not at 1 Nov's rate
        - { account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: 24000, book: 2856000, parallel: 24000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -24000, book: -2856000, parallel: -24000 }
    - source: invoice.issued
      date: 2026-11-05
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 62000, book: 7471000, parallel: 62000 }
        - { account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: -24000, book: -2856000, parallel: -24000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -38000, book: -4579000, parallel: -38000 }
        - { account: "421001", currency: SYP, amount: -36000, book: -36000, parallel: 0 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 38000, book: 4579000, parallel: 38000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -38000, book: -4579000, parallel: -38000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -7435000, parallel: -62000 }
  open_items:
    - { item: INV-2026-24/1, account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```
