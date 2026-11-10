# Revenue released over time

Status: Proposed

S06 wrote these cases (S06 "Scenarios"); the owner approved the expected entries and outcomes of fourteen of them on 2026-11-10, with option A of the day split below, the job's clock and the order of a job's releases. The case of a missing bulletin on an elapsed month's last day was added after the accounting review and awaits the owner's approval. They stay `Proposed` until S06's feature slice brings their executors: the posting rules of `invoice.issued` with over-time lines, the release job `revenue_release_month`, the elapsed parts of a late issue, the hold `SERVICE_PERIOD_CLOSED` and the action `recognise` (S06 rules 1–5, 7, 10, 16). The case with a closed month also needs S07's close (`closed_periods`), as `inbox/post-in-next-open-period.md` does.

## Rule

A retainer cycle's `monthly` or `addition` charge, and a `manual` line marked deferred, are deferred at issue to contract liabilities and released evenly over the days of their service period, both ends included, actual days. The invoice posts as one entry on its accounting date: Dr trade receivables for the total, Cr contract liabilities for each over-time line. For each month the period touches, the job of the first day of the next month posts one entry per invoice, dated on the month's last day: Dr contract liabilities / Cr service revenue, with the client, the contract and the line's current service, at the line's part of the month in every ledger, carried, so no rate is read. A month's part is cut with cumulative rounding by days. An invoice issued after a month of its period has ended recognises that elapsed month as a contract asset at the policy rates of the month's last day, cleared by the invoice at its carried amounts; the residual is a realised exchange difference. An elapsed month that is closed holds the invoice `SERVICE_PERIOD_CLOSED` until the accountant recognises it in the first open period. A line without the facts its pattern needs is held `NEEDS_DECISION` (`recognition_pattern_unclear:<line position>`).

## Basis

- **IFRS 15.35(a) and 15.39–41:** the client receives and consumes the agency's service as it is performed through the cycle, so the obligation is satisfied over time and progress is measured by time elapsed (an output method, scope Q3a: daily straight line).
- **IFRS 15.106:** consideration invoiced before the service is transferred is a contract liability. **IFRS 15.107:** service transferred before the invoice is a contract asset; once invoiced, the right is unconditional and the asset is reclassified to the receivable (IFRS 15.108).
- **IAS 21.16, 21.23(b) and IFRIC 22:** a contract liability is non-monetary: it stays at the rates of the invoice and is released at those carried amounts, never remeasured. A contract asset is monetary (IAS 21.16, 21.23(a)).
- **IAS 21.21–22:** the elapsed month's revenue is recognised at the spot rate of the month's last day, each ledger's policy rate in force then, not Hub's `syp_per_usd`, which is of the invoice's date. **IAS 21.28:** the gap between that asset and the invoice's measurement is a realised exchange difference.
- **IAS 8.42:** the accountant's "recognise in the first open period" keeps a closed month's figures; a material omission is corrected by reopening the month (S07).
- **Company policy:** `phase-1-scope.md` §4 (the book ledger at the bulletin, the USD parallel ledger at market or the transaction's own rate) and §6 ("Retainer cycle charge", late issue, "Service changed on a line"); S06 rules 1–5, 7, 10, 16, "Currencies, rates and rounding" and "Periods" (owner, 2026-11-10); ADR 0007 "New measurements versus carried amounts" and "Allocation"; ADR 0013 "Residuals of entries with carried lines"; ADR 0015.
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting. No tax rule is applied.

## Cases

The account codes are the service-agency template's (S02): trade receivables `112001` (a `document` control account, client), contract assets `113001` (a `document` control account, monetary, client and contract), contract liabilities `212001` (client and contract, not monetary), service revenue `411001` (client and service; the contract when the invoice names one), realised exchange gains `421001` and losses `541001`. The slots `contract_liability`, `contract_asset` and `released_revenue` take their template defaults (S06 "Data"). Every rate and amount is synthetic. 3, 5, 10, 15, 16, 19, 25, 26 and 30 November and 3 December 2026, 29 October 2026 and 15 February 2028 are publication days; 30 and 31 October 2026 are a Friday and a Saturday.

The payloads use the short form of `revenue/revenue-at-issue.md`. A line's `kind` is its `charge_kind`; its position is its place in `lines`, from 1. A contract asset item opened for a late issue's elapsed part is named `<invoice number>/<line position>` (S06 "Data") and carries the invoice's client and contract.

Sources: the issue entry and an elapsed month's entry have the event as their source (`invoice.issued`); a release's is `revenue_release`. The job `revenue_release_month` for month *m* runs on the first day of *m*+1, so the case's clock moves to that day; an invoice step after it is received after the month's job. The job posts its releases in the order the invoices posted.

**The day split** (S06 rule 3; ADR 0007 "Allocation"): with *A* a line's transaction amount and *T* the days of its period, the transaction part of month *m* is `round(A × days to the end of m ÷ T) − round(A × days to the end of m−1 ÷ T)`, halves away from zero. A ledger in the line's currency takes the transaction part as is (ADR 0007). Any other ledger cuts its own deferred amount the same way, over the days that amount covers: the whole period when the invoice is on time; from the first day of the issue month when months have elapsed (option A, owner 2026-11-10; the "deferred manual line" case is the one where this differs from a cut by transaction share). `packages/ledger`'s `overTimeMonths()` and `releaseParts()` compute it.

The cases leave out what other scenarios own: credits (`revenue/retainer-credit.md`), voids and re-issues (`revenue/void-and-reissue.md`), milestones and deposits (`revenue/milestones.md`). A line of zero is refused by the contract (S05 rule 2), so it has no case; a negative line is a credit. `third` cannot occur: Hub invoices only in SYP and USD (S06 "Currencies, rates and rounding"). A replayed event posts nothing new: a property test, since a step carries no event ID. A release never reads a rate, so no case has a release held `RATE_MISSING`; an elapsed month's part does read the policy rates of its month end, and one case holds it.

### Vertex Media: a retainer cycle across two months

S06's example. 15 November to 14 December is 30 days: 16 in November, 14 in December. The job for November runs twice: the second run posts nothing (the release key per invoice and month).

```yaml
case: a 900.00 USD cycle of 15 Nov to 14 Dec at bulletin 121; 16/30 released on 30 Nov, 14/30 on 31 Dec; a second November run posts nothing
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-15
    payload: { invoice: INV-2026-20, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-15, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - job: revenue_release_month
    period: 2026-11
  - job: revenue_release_month
    period: 2026-12
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-15
      lines:
        # 900.00 USD × 121 = 108,900.00 SYP; the USD parallel ledger takes the amount as is (Hub's 122 is not read)
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10890000, parallel: 90000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -90000, book: -10890000, parallel: -90000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # 90,000 × 16 / 30 = 48,000; book 10,890,000 × 16 / 30 = 5,808,000 (58,080.00 SYP), carried: the bulletin of 1 Dec is not read
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 48000, book: 5808000, parallel: 48000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -48000, book: -5808000, parallel: -48000 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        # the rest: 90,000 − 48,000 = 42,000; book 10,890,000 − 5,808,000 = 5,082,000 (50,820.00 SYP)
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 42000, book: 5082000, parallel: 42000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -42000, book: -5082000, parallel: -42000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -10890000, parallel: -90000 }
  open_items:
    - { item: INV-2026-20, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10890000, parallel: 90000 }
```

### Vertex Media: an SYP cycle inside one month, invoiced in advance

The invoice is issued on 29 October for November's cycle (S06 edge case 5): nothing elapses, and October's job releases nothing, since the period starts after it. November releases the whole amount on its last day. The SYP books take the amount as is and the parallel ledger measures it once, at issue, at Hub's 123; the release carries it.

```yaml
case: a 60,000.00 SYP cycle of 1 to 30 Nov issued on 29 Oct at Hub's 123; October releases nothing, November all of it
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
steps:
  - event: invoice.issued
    accounting_date: 2026-10-29
    payload: { invoice: INV-2026-21, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: SYP, syp_per_usd: "123.0000", issued_on: 2026-10-29, due_on: 2026-11-05,
               lines: [{ line: L1, amount: 6000000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-01, cycle_end: 2026-11-30, service: S1 }] }
  - job: revenue_release_month
    period: 2026-10
  - job: revenue_release_month
    period: 2026-11
expect:
  entries:
    - source: invoice.issued
      date: 2026-10-29
      lines:
        # parallel: 60,000.00 SYP / 123 = 487.8048… USD → 487.80
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 6000000, book: 6000000, parallel: 48780 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: -6000000, book: -6000000, parallel: -48780 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # 30 of 30 days: everything deferred, at its carried amounts
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 6000000, book: 6000000, parallel: 48780 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: SYP, amount: -6000000, book: -6000000, parallel: -48780 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -6000000, parallel: -48780 }
```

### Vertex Media: halves rounded in each ledger on its own

16 November to 15 December is 30 days, 15 in each month, so each month's part of an odd amount is a half. The transaction amount and the parallel ledger are each cut on their own, and the first part takes the half away from zero.

```yaml
case: a 60,000.01 SYP cycle of 16 Nov to 15 Dec at Hub's 121; each ledger's half rounds away from zero in November
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-16
    payload: { invoice: INV-2026-22, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: SYP, syp_per_usd: "121.0000", issued_on: 2026-11-16, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 6000001, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-16, cycle_end: 2026-12-15, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - job: revenue_release_month
    period: 2026-12
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-16
      lines:
        # parallel: 60,000.01 SYP / 121 = 495.867… USD → 495.87
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 6000001, book: 6000001, parallel: 49587 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: -6000001, book: -6000001, parallel: -49587 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # transaction and book: 6,000,001 × 15 / 30 = 3,000,000.5 → 3,000,001; parallel: 49,587 × 15 / 30 = 24,793.5 → 24,794
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 3000001, book: 3000001, parallel: 24794 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: SYP, amount: -3000001, book: -3000001, parallel: -24794 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        # the rest: 6,000,001 − 3,000,001 = 3,000,000; parallel 49,587 − 24,794 = 24,793
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 3000000, book: 3000000, parallel: 24793 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: SYP, amount: -3000000, book: -3000000, parallel: -24793 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -6000001, parallel: -49587 }
```

### Vertex Media: a leap day, and an amount that does not divide by the days

15 February to 14 March 2028 is 29 days, 29 February included: 15 in February, 14 in March. Neither ledger divides evenly; the cumulative cut makes the parts sum exactly.

```yaml
case: a 1,000.00 USD cycle of 15 Feb to 14 Mar 2028 (29 days with the leap day) at bulletin 130; 15/29 and 14/29
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2028-02-15, base: USD, quote: SYP, rate: "130.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2028-02-15
    payload: { invoice: INV-2028-1, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "131.0000", issued_on: 2028-02-15, due_on: 2028-02-29,
               lines: [{ line: L1, amount: 100000, source: retainer_charge, kind: monthly,
                         cycle_start: 2028-02-15, cycle_end: 2028-03-14, service: S1 }] }
  - job: revenue_release_month
    period: 2028-02
  - job: revenue_release_month
    period: 2028-03
expect:
  entries:
    - source: invoice.issued
      date: 2028-02-15
      lines:
        # 1,000.00 USD × 130 = 130,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 100000, book: 13000000, parallel: 100000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -100000, book: -13000000, parallel: -100000 }
    - source: revenue_release
      date: 2028-02-29
      lines:
        # 100,000 × 15 / 29 = 51,724.13… → 51,724; book 13,000,000 × 15 / 29 = 6,724,137.93… → 6,724,138
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 51724, book: 6724138, parallel: 51724 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -51724, book: -6724138, parallel: -51724 }
    - source: revenue_release
      date: 2028-03-31
      lines:
        # the rest: 100,000 − 51,724 = 48,276; book 13,000,000 − 6,724,138 = 6,275,862
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 48276, book: 6275862, parallel: 48276 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -48276, book: -6275862, parallel: -48276 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -13000000, parallel: -100000 }
```

### Vertex Media: an addition issued mid-cycle

The cycle's monthly charge is issued on 15 November; an addition for the same cycle on 25 November. The addition is spread over the whole cycle, the days before its issue included (scope Q3a; S06 edge case 4), and nothing of it has elapsed, since no month of the cycle ended before November. Each job posts one entry per invoice, in the order the invoices posted.

```yaml
case: the 900.00 USD cycle of 15 Nov to 14 Dec and a 300.00 USD addition issued on 25 Nov at 121.5, spread over the whole cycle
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-15
    payload: { invoice: INV-2026-20, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-15, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - event: invoice.issued
    accounting_date: 2026-11-25
    payload: { invoice: INV-2026-23, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.5000", issued_on: 2026-11-25, due_on: 2026-12-10,
               lines: [{ line: L1, amount: 30000, source: retainer_charge, kind: addition,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S2 }] }
  - job: revenue_release_month
    period: 2026-11
  - job: revenue_release_month
    period: 2026-12
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-15
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10890000, parallel: 90000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -90000, book: -10890000, parallel: -90000 }
    - source: invoice.issued
      date: 2026-11-25
      lines:
        # 300.00 USD × 121.5 = 36,450.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 30000, book: 3645000, parallel: 30000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -30000, book: -3645000, parallel: -30000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # INV-2026-20: 16 / 30 as in the first case
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 48000, book: 5808000, parallel: 48000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -48000, book: -5808000, parallel: -48000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # INV-2026-23: 30,000 × 16 / 30 = 16,000 (from 15 Nov, not from its issue); book 3,645,000 × 16 / 30 = 1,944,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 16000, book: 1944000, parallel: 16000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S2 }, currency: USD, amount: -16000, book: -1944000, parallel: -16000 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 42000, book: 5082000, parallel: 42000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -42000, book: -5082000, parallel: -42000 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        # the rest: 30,000 − 16,000 = 14,000; book 3,645,000 − 1,944,000 = 1,701,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 14000, book: 1701000, parallel: 14000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S2 }, currency: USD, amount: -14000, book: -1701000, parallel: -14000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", dims: { service: S1 }, book: -10890000, parallel: -90000 }
    - { account: "411001", dims: { service: S2 }, book: -3645000, parallel: -30000 }
```

### Vertex Media: a late issue with an open elapsed month

S06's example. The cycle runs from 20 October to 19 November (31 days: 12 in October, 19 in November), and its invoice is issued on 5 November. October ended before the issue month, so its 12 days are elapsed: a contract asset and revenue dated 31 October, at the bulletin in force that day, the one of Thursday 29 October (S02 rule 16), not Hub's `syp_per_usd`. The invoice clears that item at its carried amounts and defers the rest at the bulletin of 5 November; the book residual is a realised gain. November's days are released with November.

```yaml
case: a 620.00 USD cycle of 20 Oct to 19 Nov issued on 5 Nov at 120.5; October's 12 days elapsed at 119; a 360.00 SYP realised gain
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
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
  - job: revenue_release_month
    period: 2026-11
expect:
  entries:
    - source: invoice.issued
      date: 2026-10-31
      lines:
        # elapsed October: 62,000 × 12 / 31 = 24,000; 240.00 USD × 119 (in force on Saturday 31 Oct) = 28,560.00 SYP
        - { account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: 24000, book: 2856000, parallel: 24000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -24000, book: -2856000, parallel: -24000 }
    - source: invoice.issued
      date: 2026-11-05
      lines:
        # 620.00 USD × 120.5 = 74,710.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 62000, book: 7471000, parallel: 62000 }
        # the item INV-2026-24/1 cleared at what it carries
        - { account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: -24000, book: -2856000, parallel: -24000 }
        # the rest, 380.00 USD × 120.5 = 45,790.00 SYP, a new measurement
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -38000, book: -4579000, parallel: -38000 }
        # book residual: 7,471,000 − 2,856,000 − 4,579,000 = 36,000 → a realised gain of 360.00 SYP; parallel: none
        - { account: "421001", currency: SYP, amount: -36000, book: -36000, parallel: 0 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # November's 19 days: 62,000 − 24,000 = 38,000, all that was deferred, at 4,579,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 38000, book: 4579000, parallel: 38000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -38000, book: -4579000, parallel: -38000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -7435000, parallel: -62000 }
    - { account: "421001", book: -36000, parallel: 0 }
  open_items:
    - { item: INV-2026-24/1, account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: INV-2026-24, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 62000, book: 7471000, parallel: 62000 }
```

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

### Vertex Media: a late issue whose elapsed month end has no bulletin

Monday 30 November is a publication day, and its bulletin is not recorded when the invoice of 3 December arrives: the elapsed November part cannot be measured, so the invoice is held `RATE_MISSING` whole (S06 rule 18; ADR 0011). The bulletin of Thursday 26 November does not stand in for it, nor do Hub's rate or the issue date's. Recording the bulletin of 30 November retries the invoice (S05 rule 10), which then posts as a late issue. The asset is measured at 122 and collected at 120, so the book residual is a realised loss.

```yaml
case: a 450.00 USD cycle of 20 Nov to 19 Dec issued on 3 Dec at 120; no bulletin on Monday 30 Nov holds it RATE_MISSING; 122 recorded, it posts with a 330.00 SYP loss
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-26, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-32, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "121.5000", issued_on: 2026-12-03, due_on: 2026-12-18,
               lines: [{ line: L1, amount: 45000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-20, cycle_end: 2026-12-19, service: S1 }] }
    outcome: { status: held, reason: RATE_MISSING }
  - rate: { date: 2026-11-30, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - job: revenue_release_month
    period: 2026-12
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-30
      lines:
        # November: 45,000 × 11 / 30 = 16,500; 165.00 USD × 122 (30 Nov, not 26 Nov's 121) = 20,130.00 SYP
        - { account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: 16500, book: 2013000, parallel: 16500 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -16500, book: -2013000, parallel: -16500 }
    - source: invoice.issued
      date: 2026-12-03
      lines:
        # 450.00 USD × 120 = 54,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 45000, book: 5400000, parallel: 45000 }
        - { account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: -16500, book: -2013000, parallel: -16500 }
        # the rest: 285.00 USD × 120 = 34,200.00 SYP
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -28500, book: -3420000, parallel: -28500 }
        # book residual: 5,400,000 − 2,013,000 − 3,420,000 = −33,000 → a realised loss of 330.00 SYP; parallel: none
        - { account: "541001", currency: SYP, amount: 33000, book: 33000, parallel: 0 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        # December's 19 days: 45,000 − 16,500 = 28,500, all that was deferred, at 3,420,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 28500, book: 3420000, parallel: 28500 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -28500, book: -3420000, parallel: -28500 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -5433000, parallel: -45000 }
    - { account: "541001", book: 33000, parallel: 0 }
  open_items:
    - { item: INV-2026-32/1, account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: an invoice received after its month's job

November's job has run (with nothing to release) when the invoice of 19 November arrives. Its transaction posts the issue and November's release together, the release dated 30 November (S06 rule 5); a later November run posts nothing.

```yaml
case: a 600.00 USD cycle of 19 Nov to 18 Dec received after November's job; its November release posts with it
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
steps:
  - job: revenue_release_month
    period: 2026-11
  - event: invoice.issued
    accounting_date: 2026-11-19
    payload: { invoice: INV-2026-25, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-19, due_on: 2026-12-04,
               lines: [{ line: L1, amount: 60000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-19, cycle_end: 2026-12-18, service: S1 }] }
  - job: revenue_release_month
    period: 2026-12
  - job: revenue_release_month
    period: 2026-11
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-19
      lines:
        # 600.00 USD × 121 = 72,600.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 60000, book: 7260000, parallel: 60000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -60000, book: -7260000, parallel: -60000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # in the invoice's transaction: 60,000 × 12 / 30 = 24,000; book 7,260,000 × 12 / 30 = 2,904,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 24000, book: 2904000, parallel: 24000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -24000, book: -2904000, parallel: -24000 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        # the rest: 36,000; book 7,260,000 − 2,904,000 = 4,356,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 36000, book: 4356000, parallel: 36000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -36000, book: -4356000, parallel: -36000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -7260000, parallel: -60000 }
```

### Vertex Media: a deferred manual line over three months, issued late

A manual line marked deferred, for a service period of 1 October to 31 December (92 days: 31, 30 and 31), issued on 10 November. October has elapsed. The transaction amount follows the day split from 1 October, so each month's USD revenue is what it would be had the invoice been on time. The book ledger's deferred amount covers November and December only (61 days) and is cut over those days.

```yaml
case: a 1,000.00 USD manual line deferred over 1 Oct to 31 Dec, issued on 10 Nov at 120; October elapsed at 119; the book deferral cut over 61 days
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-10-29, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-10
    payload: { invoice: INV-2026-26, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "121.0000", issued_on: 2026-11-10, due_on: 2026-11-25,
               lines: [{ line: L1, amount: 100000, source: manual, deferred: true,
                         cycle_start: 2026-10-01, cycle_end: 2026-12-31, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - job: revenue_release_month
    period: 2026-12
expect:
  entries:
    - source: invoice.issued
      date: 2026-10-31
      lines:
        # October: 100,000 × 31 / 92 = 33,695.65… → 33,696; 336.96 USD × 119 = 40,098.24 SYP
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 33696, book: 4009824, parallel: 33696 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -33696, book: -4009824, parallel: -33696 }
    - source: invoice.issued
      date: 2026-11-10
      lines:
        # 1,000.00 USD × 120 = 120,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: -33696, book: -4009824, parallel: -33696 }
        # the rest: 663.04 USD × 120 = 79,564.80 SYP
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -66304, book: -7956480, parallel: -66304 }
        # book residual: 12,000,000 − 4,009,824 − 7,956,480 = 33,696 → a realised gain of 336.96 SYP
        - { account: "421001", currency: SYP, amount: -33696, book: -33696, parallel: 0 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # transaction: round(100,000 × 61 / 92) − 33,696 = 66,304 − 33,696 = 32,608
        # book: 7,956,480 × 30 / 61 = 3,913,022.95… → 3,913,023 (by transaction share it would be 3,912,960)
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 32608, book: 3913023, parallel: 32608 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -32608, book: -3913023, parallel: -32608 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        # the rest: 100,000 − 66,304 = 33,696; book 7,956,480 − 3,913,023 = 4,043,457
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 33696, book: 4043457, parallel: 33696 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -33696, book: -4043457, parallel: -33696 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -11966304, parallel: -100000 }
    - { account: "421001", book: -33696, parallel: 0 }
  open_items:
    - { item: INV-2026-26/1, account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: lines whose pattern is unclear

Hub's payload is valid, but a line lacks a fact its pattern needs: the invoice is held `NEEDS_DECISION` whole, with the line's position (S06 rule 1). Nothing posts, not even its at-issue line.

```yaml
case: a monthly charge without its cycle end, a deferred manual line ending before it starts, and a monthly charge on a project are each held; nothing posts
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-27, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 10000, source: extra_work, service: S1 },
                       { line: L2, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-03, service: S1 }] }
    outcome: { status: held, reason: NEEDS_DECISION, detail: "recognition_pattern_unclear:2" }
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-28, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 50000, source: manual, deferred: true,
                         cycle_start: 2026-12-01, cycle_end: 2026-11-30, service: S1 }] }
    outcome: { status: held, reason: NEEDS_DECISION, detail: "recognition_pattern_unclear:1" }
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-29, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-01, cycle_end: 2026-11-30, service: S1 }] }
    outcome: { status: held, reason: NEEDS_DECISION, detail: "recognition_pattern_unclear:1" }
expect:
  entries: []
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: 0, parallel: 0 }
```

### Vertex Media: a service change on a deferred line

After November's release, Hub moves the line from S1 to S2 on 7 December (S06 rule 10): what the line has released so far moves to S2 at its carried amounts, and December's release carries S2. The liability has no service, so it does not move.

```yaml
case: the 900.00 USD cycle of 15 Nov to 14 Dec moved from S1 to S2 on 7 Dec after November's release; December releases on S2
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-12-07, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-15
    payload: { invoice: INV-2026-20, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-15, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - event: invoice.line_service_changed
    accounting_date: 2026-12-07
    payload: { invoice: INV-2026-20, line: L1, old_service: S1, new_service: S2, changed_on: 2026-12-07 }
  - job: revenue_release_month
    period: 2026-12
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-15
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10890000, parallel: 90000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -90000, book: -10890000, parallel: -90000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 48000, book: 5808000, parallel: 48000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -48000, book: -5808000, parallel: -48000 }
    - source: invoice.line_service_changed
      date: 2026-12-07
      lines:
        # November's release at its carried amounts, not at 123
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 48000, book: 5808000, parallel: 48000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S2 }, currency: USD, amount: -48000, book: -5808000, parallel: -48000 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 42000, book: 5082000, parallel: 42000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S2 }, currency: USD, amount: -42000, book: -5082000, parallel: -42000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", dims: { service: S1 }, book: 0, parallel: 0 }
    - { account: "411001", dims: { service: S2 }, book: -10890000, parallel: -90000 }
```

### SYP books only

With no parallel ledger, only the transaction amount and the book amount are cut. 16 November to 15 December: 15 days in each month; both halves round away from zero in November.

```yaml
case: SYP books only; a 1,000.01 USD cycle of 16 Nov to 15 Dec at bulletin 121; each half rounds away from zero in November
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
rates:
  - { date: 2026-11-16, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-16
    payload: { invoice: INV-2026-30, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-16, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 100001, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-16, cycle_end: 2026-12-15, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - job: revenue_release_month
    period: 2026-12
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-16
      lines:
        # 1,000.01 USD × 121 = 121,001.21 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 100001, book: 12100121 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -100001, book: -12100121 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # 100,001 × 15 / 30 = 50,000.5 → 50,001; book 12,100,121 × 15 / 30 = 6,050,060.5 → 6,050,061
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 50001, book: 6050061 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -50001, book: -6050061 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 50000, book: 6050060 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -50000, book: -6050060 }
  balances:
    - { account: "212001", book: 0 }
    - { account: "411001", book: -12100121 }
```

### USD books with an SYP parallel ledger: a USD invoice issued late

The USD books take the USD amounts as is. The SYP parallel ledger measures the elapsed October at the market rate in force on 31 October, 118.5, and the invoice at Hub's 121, which it accepts for the invoice's own date; the parallel residual is a realised gain.

```yaml
case: USD books; the 620.00 USD late cycle of 20 Oct to 19 Nov; October at the market 118.5, the invoice at Hub's 121; a 600.00 SYP parallel gain
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-10-31, base: USD, quote: SYP, rate: "118.5000", type: market }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-05
    payload: { invoice: INV-2026-24, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "121.0000", issued_on: 2026-11-05, due_on: 2026-11-20,
               lines: [{ line: L1, amount: 62000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-10-20, cycle_end: 2026-11-19, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
expect:
  entries:
    - source: invoice.issued
      date: 2026-10-31
      lines:
        # 240.00 USD × 118.5 (market, 31 Oct) = 28,440.00 SYP; Hub's 121 is of 5 Nov and is not read here
        - { account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: 24000, book: 24000, parallel: 2844000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -24000, book: -24000, parallel: -2844000 }
    - source: invoice.issued
      date: 2026-11-05
      lines:
        # 620.00 USD × 121 (Hub's rate, accepted by the market ledger) = 75,020.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 62000, book: 62000, parallel: 7502000 }
        - { account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: -24000, book: -24000, parallel: -2844000 }
        # 380.00 USD × 121 = 45,980.00 SYP
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -38000, book: -38000, parallel: -4598000 }
        # parallel residual: 7,502,000 − 2,844,000 − 4,598,000 = 60,000 → a realised gain of 600.00 SYP; book: none
        - { account: "421001", currency: SYP, amount: -60000, book: 0, parallel: -60000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 38000, book: 38000, parallel: 4598000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -38000, book: -38000, parallel: -4598000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -62000, parallel: -7442000 }
    - { account: "421001", book: 0, parallel: -60000 }
  open_items:
    - { item: INV-2026-24/1, account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### USD books with an SYP parallel ledger: an SYP invoice issued late

The SYP parallel ledger takes the SYP amounts as is. The USD books measure October at the bulletin in force on 31 October, 120, and the invoice at the bulletin of 5 November, 124, never at Hub's rate; the pound weakened between them, so the book residual is a realised loss.

```yaml
case: USD books; a 74,400.00 SYP cycle of 20 Oct to 19 Nov issued on 5 Nov; October at bulletin 120, the invoice at 124; a 7.74 USD book loss
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-10-29, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-05
    payload: { invoice: INV-2026-31, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: SYP, syp_per_usd: "125.0000", issued_on: 2026-11-05, due_on: 2026-11-20,
               lines: [{ line: L1, amount: 7440000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-10-20, cycle_end: 2026-11-19, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
expect:
  entries:
    - source: invoice.issued
      date: 2026-10-31
      lines:
        # October: 7,440,000 × 12 / 31 = 2,880,000; 28,800.00 SYP / 120 = 240.00 USD
        - { account: "113001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 2880000, book: 24000, parallel: 2880000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: SYP, amount: -2880000, book: -24000, parallel: -2880000 }
    - source: invoice.issued
      date: 2026-11-05
      lines:
        # 74,400.00 SYP / 124 = 600.00 USD
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 7440000, book: 60000, parallel: 7440000 }
        - { account: "113001", dims: { client: C1, contract: R1 }, currency: SYP, amount: -2880000, book: -24000, parallel: -2880000 }
        # the rest: 45,600.00 SYP / 124 = 367.741… USD → 367.74
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: -4560000, book: -36774, parallel: -4560000 }
        # book residual: 60,000 − 24,000 − 36,774 = −774 → a realised loss of 7.74 USD; parallel: none
        - { account: "541001", currency: USD, amount: 774, book: 774, parallel: 0 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 4560000, book: 36774, parallel: 4560000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: SYP, amount: -4560000, book: -36774, parallel: -4560000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -60774, parallel: -7440000 }
    - { account: "541001", book: 774, parallel: 0 }
  open_items:
    - { item: INV-2026-31/1, account: "113001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 0, book: 0, parallel: 0 }
```

Each posted entry balances in both ledgers:
- **Releases and the service change** carry one amount to both sides, so they balance as the deferral does.
- **Late issue, `syp-usd`:** book 7,471,000 − 2,856,000 − 4,579,000 − 36,000 = 0; parallel 62,000 − 24,000 − 38,000 = 0.
- **Missing bulletin:** book 5,400,000 − 2,013,000 − 3,420,000 + 33,000 = 0; parallel 45,000 − 16,500 − 28,500 = 0.
- **Deferred manual line:** book 12,000,000 − 4,009,824 − 7,956,480 − 33,696 = 0; parallel 100,000 − 33,696 − 66,304 = 0.
- **USD books, USD invoice:** book 62,000 − 24,000 − 38,000 = 0; parallel 7,502,000 − 2,844,000 − 4,598,000 − 60,000 = 0.
- **USD books, SYP invoice:** book 60,000 − 24,000 − 36,774 + 774 = 0; parallel 7,440,000 − 2,880,000 − 4,560,000 = 0.
