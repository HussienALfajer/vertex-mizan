# Credits on a retainer cycle

Status: Proposed

S06 wrote these cases (S06 "Scenarios"); the owner approved their expected entries and outcomes on 2026-11-10, with three readings of S06 rule 6: a credit is shared across the cycle's schedules by each one's amount net of earlier credits; on each, the share already recognised reduces revenue and the rest the liability; and an invoice whose total the credit brings to zero has no receivable line and no item. They stay `Proposed` until S06's feature slice brings their executors: the posting rules of `invoice.issued` with over-time and credit lines, `invoice.voided` of an invoice with schedules or credits, the release job `revenue_release_month` and the holds `UNKNOWN_REFERENCE` (`credit_cycle`) and `NEEDS_DECISION` (`credit_cycle_voided`, `credit_exceeds_cycle`, `schedule_credited`) (S06 rules 1, 2, 4–6, 8, 18, 19).

## Rule

A retainer `credit` line (negative) reduces the cycle it names: the retainer of its invoice and the line's `cycle_start`. The credit is shared among the cycle's active over-time schedules (its `monthly` and `addition` lines) in proportion to each schedule's amount net of earlier credits, with cumulative rounding in the order the schedules were created. On each schedule, on the credit invoice's date and inside that invoice's one entry, the credit's part is split by what the schedule has recognised so far (its releases and elapsed parts, out of its amount net of earlier credits): that share reduces service revenue, a new measurement at the credit invoice's rates (cumulative catch-up); the rest reduces the contract liability at the schedule's carried amounts for that transaction amount, rounded in proportion to what remains in each ledger. The months not yet released then cut what remains of the schedule by their days, in every ledger, with cumulative rounding (prospective). The receivable is the invoice's total, net of the credit; each ledger's residual of the entry is a realised exchange difference. A credit whose cycle has no schedule is held `UNKNOWN_REFERENCE` (`credit_cycle`) and retried when the cycle's invoice posts; one whose cycle's schedules are all voided, or that is larger than the cycle's amount net of earlier credits, is held `NEEDS_DECISION`. A void of the credit invoice reverses its entry and gives the credited schedules their part back; a void of a credited cycle while the credit stands is held `NEEDS_DECISION` (`schedule_credited`).

## Basis

- **IFRS 15.87–88:** a credit on a cycle already invoiced is a change in the transaction price after inception. It is allocated to the cycle's performance obligation, and the part relating to the service already transferred is recognised as a reduction of revenue in the period of the change (cumulative catch-up); the part relating to the service still to come reduces the contract liability and is recognised as the rest of the cycle is delivered (scope §6 "Credit lines": parts already released are never rewritten).
- **IFRS 15.35(a), 15.39–41:** progress is measured by time elapsed (scope Q3a); a credit changes the price, not the progress, so the measure of progress before and after the credit is the same.
- **IFRS 15.106:** what remains in the contract liability is the consideration invoiced for service not yet transferred.
- **IAS 21.16, 21.23(b) and IFRIC 22:** the contract liability is non-monetary and is reduced at the amounts it carries. **IAS 21.21–22:** the revenue reduction is a new transaction on the credit's date, at that day's policy rates. **IAS 21.28 and ADR 0013:** an entry with carried lines posts each ledger's residual, rounding included, as a realised exchange difference.
- **Company policy:** `phase-1-scope.md` §4 (the book ledger at the bulletin, the USD parallel ledger at market or the transaction's own rate) and §6 ("Retainer cycle charges", "Credit lines", "Invoice voided"); S06 rules 2, 3, 6, 8 and "Currencies, rates and rounding" (owner, 2026-11-10); ADR 0007 "New measurements versus carried amounts" and "Allocation"; ADR 0015.
- **Hub's side** (read on 2026-11-10, Hub F05B rules C5, C7–C9): a credit is a charge of the retainer, in the retainer's one currency, taken off a later month's invoice while that invoice's total stays at or above zero; an invoice of total zero is allowed when it carries a credit and is paid at issue.
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting. No tax rule is applied.

## Cases

The account codes are the service-agency template's (S02): trade receivables `112001` (a `document` control account, client), contract liabilities `212001` (client and contract, not monetary), service revenue `411001` (client and service; the contract when the invoice names one), realised exchange gains `421001` and losses `541001`. The slots take their template defaults (S06 "Data"). Every rate and amount is synthetic. 3, 15, 16, 18, 19, 24, 25 and 26 November and 3 and 15 December 2026 are publication days.

The payloads use the short form of `revenue/over-time-release.md`. A credit line names its cycle by `cycle_start` and the invoice's contract, the retainer; its `service` is Hub's, and the revenue reduction carries the credited schedule's current service instead. A line's position is its place in `lines`, from 1.

**The credit's split** (S06 rule 6), per credited schedule with *N* its amount net of earlier credits, *R* what remains of it in contract liabilities (transaction amount) and *c* its part of the credit (positive):
- the parts *c* across the cycle's schedules: `allocate(credit, N of each schedule)`, cumulative, in creation order;
- revenue: `round(c × (N − R) ÷ N)`, measured anew at the credit invoice's rates, each ledger on its own;
- liability: `c − revenue`, at the schedule's carried amounts: each ledger `round(remaining in that ledger × liability ÷ R)`, everything left when it takes all of *R*;
- afterwards, the months not yet released: `allocate(remaining, days of those months)` in each ledger.

The cases leave out what other scenarios own: the release of a cycle without a credit (`revenue/over-time-release.md`), the void and re-issue of a cycle (`revenue/void-and-reissue.md`). A credit invoice dated in a closed period is held `PERIOD_CLOSED` on its accounting date as any invoice (S05; `inbox/post-in-next-open-period.md`): a credit never posts into the credited months, so it has no case of its own. `third` cannot occur (S06 "Currencies, rates and rounding"). A replayed event posts nothing new: a property test, since a step carries no event ID.

### Vertex Media: a credit on the next cycle's invoice, split between released revenue and the liability

The cycle of 15 November to 14 December (900.00 USD at 121) has released November's 16 days. On 15 December the next cycle's invoice (900.00 USD) carries a credit of 90.00 USD to it, at the bulletin of 123 (S06 edge case 9: one entry). 16/30 of the cycle is recognised, so 48.00 USD of the credit reduces revenue at 123 and 42.00 USD reduces the liability at the 121 it carries. December's release takes what is left of the first cycle, 378.00 USD, so the cycle's revenue is 810.00 USD in all.

```yaml
case: a 90.00 USD credit at 123 to a 900.00 USD cycle at 121 with 16/30 released; 48.00 to revenue, 42.00 to the liability; an 84.00 SYP realised loss
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-12-15, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-15
    payload: { invoice: INV-2026-40, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-15, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - event: invoice.issued
    accounting_date: 2026-12-15
    payload: { invoice: INV-2026-41, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "124.0000", issued_on: 2026-12-15, due_on: 2026-12-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-12-15, cycle_end: 2027-01-14, service: S1 },
                       { line: L2, amount: -9000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-15, service: S1 }] }
  - job: revenue_release_month
    period: 2026-12
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-15
      lines:
        # 900.00 USD × 121 = 108,900.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10890000, parallel: 90000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -90000, book: -10890000, parallel: -90000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # 16 / 30: 48,000; book 5,808,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 48000, book: 5808000, parallel: 48000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -48000, book: -5808000, parallel: -48000 }
    - source: invoice.issued
      date: 2026-12-15
      lines:
        # the total, 900.00 − 90.00 = 810.00 USD × 123 = 99,630.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 81000, book: 9963000, parallel: 81000 }
        # the new cycle deferred: 900.00 USD × 123 = 110,700.00 SYP
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -90000, book: -11070000, parallel: -90000 }
        # N = 90,000, R = 42,000: revenue 9,000 × 48,000 / 90,000 = 4,800, × 123 = 590,400 (a new measurement)
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 4800, book: 590400, parallel: 4800 }
        # liability 9,000 − 4,800 = 4,200, carried: 5,082,000 × 4,200 / 42,000 = 508,200 (at 121)
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 4200, book: 508200, parallel: 4200 }
        # book residual: 9,963,000 − 11,070,000 + 590,400 + 508,200 = −8,400 → a realised loss of 84.00 SYP (4,200 × (123 − 121)); parallel: none
        - { account: "541001", currency: SYP, amount: 8400, book: 8400, parallel: 0 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        # INV-2026-40, December the last month: what remains, 42,000 − 4,200 = 37,800; book 5,082,000 − 508,200 = 4,573,800
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 37800, book: 4573800, parallel: 37800 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -37800, book: -4573800, parallel: -37800 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        # INV-2026-41, 15 Dec to 14 Jan is 31 days, 17 in December: 90,000 × 17 / 31 = 49,354.8… → 49,355; book 11,070,000 × 17 / 31 = 6,070,645.1… → 6,070,645
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 49355, book: 6070645, parallel: 49355 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -49355, book: -6070645, parallel: -49355 }
  balances:
    # what remains is the new cycle's January: 90,000 − 49,355 = 40,645; book 11,070,000 − 6,070,645 = 4,999,355
    - { account: "212001", book: -4999355, parallel: -40645 }
    # the first cycle 5,808,000 − 590,400 + 4,573,800 = 9,791,400 (810.00 USD) and the new one's December 6,070,645
    - { account: "411001", book: -15862045, parallel: -130355 }
    - { account: "541001", book: 8400, parallel: 0 }
  open_items:
    - { item: INV-2026-41, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 81000, book: 9963000, parallel: 81000 }
```

### Vertex Media: a credit to a cycle fully released

The November cycle (600.00 USD at 120) is fully released on 30 November. A credit of 60.00 USD on December's invoice at 123 is all revenue reduction (S06 edge case 7), a new measurement like every other line of the entry: no liability line for the first cycle, and no residual.

```yaml
case: a 60.00 USD credit at 123 to a November cycle fully released; all of it reduces revenue; no residual
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-42, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "121.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 60000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-01, cycle_end: 2026-11-30, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - event: invoice.issued
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-43, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "124.0000", issued_on: 2026-12-03, due_on: 2026-12-18,
               lines: [{ line: L1, amount: 60000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-12-01, cycle_end: 2026-12-31, service: S1 },
                       { line: L2, amount: -6000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-01, service: S1 }] }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # 600.00 USD × 120 = 72,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 60000, book: 7200000, parallel: 60000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -60000, book: -7200000, parallel: -60000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 60000, book: 7200000, parallel: 60000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -60000, book: -7200000, parallel: -60000 }
    - source: invoice.issued
      date: 2026-12-03
      lines:
        # 540.00 USD × 123 = 66,420.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 54000, book: 6642000, parallel: 54000 }
        # 600.00 USD × 123 = 73,800.00 SYP
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -60000, book: -7380000, parallel: -60000 }
        # R = 0: revenue 6,000 × 60,000 / 60,000 = 6,000, × 123 = 738,000; liability 0, no line
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 6000, book: 738000, parallel: 6000 }
  balances:
    - { account: "212001", book: -7380000, parallel: -60000 }
    # 7,200,000 − 738,000
    - { account: "411001", book: -6462000, parallel: -54000 }
```

### Vertex Media: a credit to a cycle not released yet, shared between its monthly charge and an addition

The cycle of 15 November to 14 December has a monthly charge (900.00 USD at 121) and an addition (300.00 USD at 121.5). On 26 November, before November's release, a manual invoice of the retainer carries 200.00 USD of extra work and a credit of 100.01 USD to the cycle, at 122 (Hub F05B rule C9). Nothing is recognised yet (S06 edge case 8), so the credit only reduces the two liabilities, shared 3 : 1 with cumulative rounding, each at what it carries. November's and December's releases then cut what remains of each schedule by days.

```yaml
case: a 100.01 USD credit at 122 shared 75.01 / 25.00 between a 900.00 monthly charge at 121 and a 300.00 addition at 121.5, nothing released; an 87.51 SYP realised loss; the releases recut
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "121.5000", type: bulletin }
  - { date: 2026-11-26, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-15
    payload: { invoice: INV-2026-40, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-15, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - event: invoice.issued
    accounting_date: 2026-11-25
    payload: { invoice: INV-2026-44, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.5000", issued_on: 2026-11-25, due_on: 2026-12-10,
               lines: [{ line: L1, amount: 30000, source: retainer_charge, kind: addition,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S2 }] }
  - event: invoice.issued
    accounting_date: 2026-11-26
    payload: { invoice: INV-2026-45, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "123.0000", issued_on: 2026-11-26, due_on: 2026-12-11,
               lines: [{ line: L1, amount: 20000, source: extra_work, service: S3 },
                       { line: L2, amount: -10001, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-15, service: S1 }] }
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
    - source: invoice.issued
      date: 2026-11-26
      lines:
        # the total, 200.00 − 100.01 = 99.99 USD × 122 = 12,198.78 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 9999, book: 1219878, parallel: 9999 }
        # the extra work at issue: 200.00 USD × 122 = 24,400.00 SYP
        - { account: "411001", dims: { client: C1, contract: R1, service: S3 }, currency: USD, amount: -20000, book: -2440000, parallel: -20000 }
        # the parts: 10,001 × 90,000 / 120,000 = 7,500.75 → 7,501; the addition 10,001 − 7,501 = 2,500
        # nothing recognised (N = R), so all of each part reduces its liability, carried:
        # monthly 10,890,000 × 7,501 / 90,000 = 907,621 (at 121)
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 7501, book: 907621, parallel: 7501 }
        # addition 3,645,000 × 2,500 / 30,000 = 303,750 (at 121.5)
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 2500, book: 303750, parallel: 2500 }
        # book residual: 1,219,878 − 2,440,000 + 907,621 + 303,750 = −8,751 → a realised loss of 87.51 SYP; parallel: none
        - { account: "541001", currency: SYP, amount: 8751, book: 8751, parallel: 0 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # INV-2026-40, what remains 82,499 cut by 16 / 30: 43,999.4… → 43,999; book 9,982,379 × 16 / 30 = 5,323,935.4… → 5,323,935
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 43999, book: 5323935, parallel: 43999 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -43999, book: -5323935, parallel: -43999 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # INV-2026-44, what remains 27,500 × 16 / 30 = 14,666.6… → 14,667; book 3,341,250 × 16 / 30 = 1,782,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 14667, book: 1782000, parallel: 14667 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S2 }, currency: USD, amount: -14667, book: -1782000, parallel: -14667 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        # the rest: 82,499 − 43,999 = 38,500; book 9,982,379 − 5,323,935 = 4,658,444
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 38500, book: 4658444, parallel: 38500 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -38500, book: -4658444, parallel: -38500 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        # the rest: 27,500 − 14,667 = 12,833; book 3,341,250 − 1,782,000 = 1,559,250
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 12833, book: 1559250, parallel: 12833 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S2 }, currency: USD, amount: -12833, book: -1559250, parallel: -12833 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    # 10,890,000 − 907,621 = 9,982,379 (824.99 USD)
    - { account: "411001", dims: { service: S1 }, book: -9982379, parallel: -82499 }
    # 3,645,000 − 303,750 = 3,341,250 (275.00 USD)
    - { account: "411001", dims: { service: S2 }, book: -3341250, parallel: -27500 }
    - { account: "411001", dims: { service: S3 }, book: -2440000, parallel: -20000 }
    - { account: "541001", book: 8751, parallel: 0 }
```

### Vertex Media: a credit received before its cycle's invoice

The credit invoice of 19 November arrives before the cycle's invoice of 15 November: no schedule exists for the cycle, so it is held `UNKNOWN_REFERENCE` (`credit_cycle`), which never blocks other events (S06 rule 17). The cycle's invoice posts, and the credit is retried at once (S06 rule 19) and posts on its own date. Both days' bulletin is 121, so the carried liability and the credit agree and no residual is left.

```yaml
case: a 50.00 USD credit received before its 900.00 USD cycle's invoice is held UNKNOWN_REFERENCE; the cycle posts, then the credit on 19 Nov
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-19
    payload: { invoice: INV-2026-46, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-19, due_on: 2026-12-04,
               lines: [{ line: L1, amount: 10000, source: extra_work, service: S3 },
                       { line: L2, amount: -5000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-15, service: S1 }] }
    outcome: { status: held, reason: UNKNOWN_REFERENCE, detail: credit_cycle }
  - event: invoice.issued
    accounting_date: 2026-11-15
    payload: { invoice: INV-2026-40, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-15, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-15
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10890000, parallel: 90000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -90000, book: -10890000, parallel: -90000 }
    - source: invoice.issued
      date: 2026-11-19
      lines:
        # 50.00 USD × 121 = 6,050.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 5000, book: 605000, parallel: 5000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S3 }, currency: USD, amount: -10000, book: -1210000, parallel: -10000 }
        # nothing released: all to the liability, carried 10,890,000 × 5,000 / 90,000 = 605,000; residual 0, no line
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 5000, book: 605000, parallel: 5000 }
  balances:
    - { account: "212001", book: -10285000, parallel: -85000 }
```

### Vertex Media: the void of the credit invoice

The credit of 19 November (50.00 USD, all to the liability) shrinks November's release to 16/30 of 850.00 USD. Hub voids the credit invoice on 3 December (S06 rule 8): its entry is reversed exactly on the void date, the credit's movement is reversed, and the schedule's remainder grows back, so December's release takes everything left. November keeps its figure; the cycle's revenue is 900.00 USD in all.

```yaml
case: a 50.00 USD credit voided on 3 Dec after November released 16/30 of 850.00; December releases what grew back; the cycle's revenue is 900.00
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-15
    payload: { invoice: INV-2026-40, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-15, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - event: invoice.issued
    accounting_date: 2026-11-19
    payload: { invoice: INV-2026-46, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-19, due_on: 2026-12-04,
               lines: [{ line: L1, amount: 10000, source: extra_work, service: S3 },
                       { line: L2, amount: -5000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-15, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - event: invoice.voided
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-46, voided_on: 2026-12-03, reason: "أُلغي الإشعار الدائن في Hub" }
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
      date: 2026-11-19
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 5000, book: 605000, parallel: 5000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S3 }, currency: USD, amount: -10000, book: -1210000, parallel: -10000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 5000, book: 605000, parallel: 5000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # what remains, 85,000 × 16 / 30 = 45,333.3… → 45,333; book 10,285,000 × 16 / 30 = 5,485,333.3… → 5,485,333
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 45333, book: 5485333, parallel: 45333 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -45333, book: -5485333, parallel: -45333 }
    - source: invoice.voided
      date: 2026-12-03
      lines:
        # the exact negation of the credit invoice's entry; no rate is read
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: -5000, book: -605000, parallel: -5000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S3 }, currency: USD, amount: 10000, book: 1210000, parallel: 10000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -5000, book: -605000, parallel: -5000 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        # the last month takes what remains: 85,000 − 45,333 + 5,000 = 44,667; book 10,285,000 − 5,485,333 + 605,000 = 5,404,667
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 44667, book: 5404667, parallel: 44667 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -44667, book: -5404667, parallel: -44667 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", dims: { service: S1 }, book: -10890000, parallel: -90000 }
    - { account: "411001", dims: { service: S3 }, book: 0, parallel: 0 }
  open_items:
    - { item: INV-2026-46, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: credits held for the accountant

Two credits that cannot post (S06 rule 6), each held `NEEDS_DECISION` whole with nothing posted:
- to a cycle whose only schedule was voided on 18 November (`credit_cycle_voided`);
- 400.00 USD to a 900.00 USD cycle already credited 600.00 USD, so larger than the 300.00 USD it has left net of credits (`credit_exceeds_cycle`); the first credit posts.

```yaml
case: a credit to a voided cycle is held credit_cycle_voided
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-15
    payload: { invoice: INV-2026-40, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-15, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - event: invoice.voided
    accounting_date: 2026-11-18
    payload: { invoice: INV-2026-40, voided_on: 2026-11-18, reason: "أُلغيت الفاتورة في Hub" }
  - event: invoice.issued
    accounting_date: 2026-11-19
    payload: { invoice: INV-2026-46, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-19, due_on: 2026-12-04,
               lines: [{ line: L1, amount: 10000, source: extra_work, service: S3 },
                       { line: L2, amount: -5000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-15, service: S1 }] }
    outcome: { status: held, reason: NEEDS_DECISION, detail: credit_cycle_voided }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-15
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10890000, parallel: 90000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -90000, book: -10890000, parallel: -90000 }
    - source: invoice.voided
      date: 2026-11-18
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: -90000, book: -10890000, parallel: -90000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10890000, parallel: 90000 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: 0, parallel: 0 }
```

```yaml
case: a 400.00 USD credit to a 900.00 USD cycle already credited 600.00 is held credit_exceeds_cycle; the first credit posts
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-11-24, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-15
    payload: { invoice: INV-2026-40, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-15, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - event: invoice.issued
    accounting_date: 2026-11-19
    payload: { invoice: INV-2026-46, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-19, due_on: 2026-12-04,
               lines: [{ line: L1, amount: 70000, source: extra_work, service: S3 },
                       { line: L2, amount: -60000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-15, service: S1 }] }
  - event: invoice.issued
    accounting_date: 2026-11-24
    payload: { invoice: INV-2026-47, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-24, due_on: 2026-12-09,
               lines: [{ line: L1, amount: 50000, source: extra_work, service: S3 },
                       { line: L2, amount: -40000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-15, service: S1 }] }
    outcome: { status: held, reason: NEEDS_DECISION, detail: credit_exceeds_cycle }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-15
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10890000, parallel: 90000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -90000, book: -10890000, parallel: -90000 }
    - source: invoice.issued
      date: 2026-11-19
      lines:
        # 100.00 USD × 121
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 10000, book: 1210000, parallel: 10000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S3 }, currency: USD, amount: -70000, book: -8470000, parallel: -70000 }
        # carried 10,890,000 × 60,000 / 90,000 = 7,260,000; residual 0
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 60000, book: 7260000, parallel: 60000 }
  balances:
    - { account: "212001", book: -3630000, parallel: -30000 }
```

### Vertex Media: the void of a credited cycle is held

The cycle's invoice is voided on 25 November while the credit of 19 November still stands on another invoice (S06 rule 8): reversing the cycle would leave the credit reducing nothing, so the void is held `NEEDS_DECISION` (`schedule_credited`) and nothing posts. Hub voids the credit invoice first, or the accountant decides.

```yaml
case: the void of a 900.00 USD cycle credited 50.00 by another invoice still standing is held schedule_credited
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-15
    payload: { invoice: INV-2026-40, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-15, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - event: invoice.issued
    accounting_date: 2026-11-19
    payload: { invoice: INV-2026-46, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-19, due_on: 2026-12-04,
               lines: [{ line: L1, amount: 10000, source: extra_work, service: S3 },
                       { line: L2, amount: -5000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-15, service: S1 }] }
  - event: invoice.voided
    accounting_date: 2026-11-25
    payload: { invoice: INV-2026-40, voided_on: 2026-11-25, reason: "أُلغيت الفاتورة في Hub" }
    outcome: { status: held, reason: NEEDS_DECISION, detail: schedule_credited }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-15
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10890000, parallel: 90000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -90000, book: -10890000, parallel: -90000 }
    - source: invoice.issued
      date: 2026-11-19
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 5000, book: 605000, parallel: 5000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S3 }, currency: USD, amount: -10000, book: -1210000, parallel: -10000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 5000, book: 605000, parallel: 5000 }
  balances:
    - { account: "212001", book: -10285000, parallel: -85000 }
```

### Vertex Media: a credit that brings the invoice to zero

December's 600.00 USD charge carries a credit of 600.00 USD to the fully released November cycle (Hub F05B rule C5: the credit is taken off while the total stays at or above zero; C7: a total of zero is paid at issue). The total is zero, so the entry has no receivable line and opens no item: nothing is to be collected. The new cycle's deferral and the revenue reduction, both at 123, balance by themselves.

```yaml
case: a 600.00 USD credit to a fully released cycle on a 600.00 USD invoice; total zero, no receivable line and no item
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-42, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "121.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 60000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-01, cycle_end: 2026-11-30, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - event: invoice.issued
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-48, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "124.0000", issued_on: 2026-12-03, due_on: 2026-12-03,
               lines: [{ line: L1, amount: 60000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-12-01, cycle_end: 2026-12-31, service: S1 },
                       { line: L2, amount: -60000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-01, service: S1 }] }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 60000, book: 7200000, parallel: 60000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -60000, book: -7200000, parallel: -60000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 60000, book: 7200000, parallel: 60000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -60000, book: -7200000, parallel: -60000 }
    - source: invoice.issued
      date: 2026-12-03
      lines:
        # 600.00 USD × 123 = 73,800.00 SYP deferred for December
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -60000, book: -7380000, parallel: -60000 }
        # the whole credit reduces November's revenue at 123
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 60000, book: 7380000, parallel: 60000 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "212001", book: -7380000, parallel: -60000 }
    # 7,200,000 − 7,380,000: November's revenue is reduced at December's rate (cumulative catch-up)
    - { account: "411001", book: 180000, parallel: 0 }
```

### SYP books only

The first case without a parallel ledger: the book amounts are the same, and the residual is in the book only.

```yaml
case: SYP books only; a 90.00 USD credit at 123 to a 900.00 USD cycle at 121 with 16/30 released; an 84.00 SYP realised loss
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-12-15, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-15
    payload: { invoice: INV-2026-40, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-15, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - event: invoice.issued
    accounting_date: 2026-12-15
    payload: { invoice: INV-2026-41, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "124.0000", issued_on: 2026-12-15, due_on: 2026-12-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-12-15, cycle_end: 2027-01-14, service: S1 },
                       { line: L2, amount: -9000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-15, service: S1 }] }
  - job: revenue_release_month
    period: 2026-12
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-15
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10890000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -90000, book: -10890000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 48000, book: 5808000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -48000, book: -5808000 }
    - source: invoice.issued
      date: 2026-12-15
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 81000, book: 9963000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -90000, book: -11070000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 4800, book: 590400 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 4200, book: 508200 }
        - { account: "541001", currency: SYP, amount: 8400, book: 8400 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 37800, book: 4573800 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -37800, book: -4573800 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 49355, book: 6070645 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -49355, book: -6070645 }
  balances:
    - { account: "212001", book: -4999355 }
    - { account: "411001", book: -15862045 }
    - { account: "541001", book: 8400 }
```

### USD books with an SYP parallel ledger: an SYP credit

An SYP cycle of 15 November to 14 December (72,600.00 SYP) is issued on 16 November at the bulletin of 121: the USD books defer 600.00 USD. November releases 16/30. On 15 December the next cycle's invoice (72,600.00 SYP) carries a credit of 7,260.00 SYP, at the bulletin of 120. The SYP parallel ledger takes every SYP amount as is and has no residual; the USD books measure the revenue reduction at 120 and carry the liability at 121, and the pound strengthened between them, so the book residual is a realised loss.

```yaml
case: USD books; a 7,260.00 SYP credit at 120 to a 72,600.00 SYP cycle at 121 with 16/30 released; a 0.23 USD book loss
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-16, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-12-15, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-16
    payload: { invoice: INV-2026-49, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: SYP, syp_per_usd: "122.0000", issued_on: 2026-11-16, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 7260000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - event: invoice.issued
    accounting_date: 2026-12-15
    payload: { invoice: INV-2026-50, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: SYP, syp_per_usd: "121.0000", issued_on: 2026-12-15, due_on: 2026-12-30,
               lines: [{ line: L1, amount: 7260000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-12-15, cycle_end: 2027-01-14, service: S1 },
                       { line: L2, amount: -726000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-15, service: S1 }] }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-16
      lines:
        # 72,600.00 SYP / 121 (bulletin) = 600.00 USD; Hub's 122 is not read by the books
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 7260000, book: 60000, parallel: 7260000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: -7260000, book: -60000, parallel: -7260000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # 16 / 30: 7,260,000 → 3,872,000 SYP; book 60,000 → 32,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 3872000, book: 32000, parallel: 3872000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: SYP, amount: -3872000, book: -32000, parallel: -3872000 }
    - source: invoice.issued
      date: 2026-12-15
      lines:
        # the total 6,534,000 SYP / 120 = 54,450 (544.50 USD)
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 6534000, book: 54450, parallel: 6534000 }
        # the new cycle 7,260,000 / 120 = 60,500
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: -7260000, book: -60500, parallel: -7260000 }
        # revenue 726,000 × 3,872,000 / 7,260,000 = 387,200 SYP; / 120 = 3,226.6… → 3,227
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: SYP, amount: 387200, book: 3227, parallel: 387200 }
        # liability 726,000 − 387,200 = 338,800 SYP, carried: 28,000 × 338,800 / 3,388,000 = 2,800
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 338800, book: 2800, parallel: 338800 }
        # book residual: 54,450 − 60,500 + 3,227 + 2,800 = −23 → a realised loss of 0.23 USD; parallel: none
        - { account: "541001", currency: USD, amount: 23, book: 23, parallel: 0 }
  balances:
    # the first cycle's December 3,049,200 SYP / 25,200 and the new cycle 7,260,000 / 60,500
    - { account: "212001", book: -85700, parallel: -10309200 }
    - { account: "411001", book: -28773, parallel: -3484800 }
    - { account: "541001", book: 23, parallel: 0 }
```
