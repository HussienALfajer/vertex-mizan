# Credits on a retainer cycle

Status: Approved (owner, 2026-11-11)

S06 wrote these cases (S06 "Scenarios"); the owner approved their expected entries and outcomes on 2026-11-10, with three readings of S06 rule 6: a credit is shared across the cycle's schedules by each one's amount net of earlier credits; on each, the share already recognised reduces revenue and the rest the liability; and an invoice whose total the credit brings to zero has no receivable line and no item. After the accounting review the owner approved, the same day, three more decisions and their cases: a credit first releases the months of its cycle that ended before its date; a credit's void releases on its date, at the carried amounts, the part it gives back for the months released since the credit (option A, which changes the entries of the case "the void of the credit invoice", not its months' totals); and the case of an SYP cycle at Vertex Media. On 2026-11-11, after the reviews of S06's PR 3, the owner approved two more cases and their decision: a credit and a credit's void are measured as of their own date whenever they post, the months released since recut by adjustments at the carried amounts on their last days (a credit processed after its cycle's later months were released; a credit's void processed after a later month's release), and the corrected balance of `112001` in the case of a credit that brings the invoice to zero (INV-2026-42's receivable stays open). After the re-reviews the owner approved, the same day, that a credit or a credit's void received after a change of its cycle dated later than itself is held `NEEDS_DECISION` (`credit_after_later_change`) with nothing posted, and its two cases. S06's feature slice (PR 3) brought their executors, so they run `Approved` with the date of the last approval: the posting rules of `invoice.issued` with over-time and credit lines, `invoice.voided` of an invoice with schedules or credits, the release job `revenue_release_month` and the holds `UNKNOWN_REFERENCE` (`credit_cycle`) and `NEEDS_DECISION` (`credit_cycle_voided`, `credit_exceeds_cycle`, `schedule_credited`) (S06 rules 1, 2, 4–6, 8, 18, 19).

## Rule

A retainer `credit` line (negative) reduces the cycle it names: the retainer of its invoice and the line's `cycle_start`. The credit is shared among the cycle's active over-time schedules (its `monthly` and `addition` lines) in proportion to each schedule's amount net of earlier credits, with cumulative rounding in the order the schedules were created. On each schedule, on the credit invoice's date and inside that invoice's one entry, the credit's part is split by what the schedule has recognised so far (its releases and elapsed parts, out of its amount net of earlier credits): that share reduces service revenue, a new measurement at the credit invoice's rates (cumulative catch-up); the rest reduces the contract liability at the schedule's carried amounts for that transaction amount, rounded in proportion to what remains in each ledger. The months not yet released then cut what remains of the schedule by their days, in every ledger, with cumulative rounding (prospective). The receivable is the invoice's total, net of the credit; each ledger's residual of the entry is a realised exchange difference. A credit whose cycle has no schedule is held `UNKNOWN_REFERENCE` (`credit_cycle`) and retried when the cycle's invoice posts; one whose cycle's schedules are all voided, or that is larger than the cycle's amount net of earlier credits, is held `NEEDS_DECISION`. Before the split, the credit posts in the same transaction the release of every month of the cycle that ended before its date, so the share recognised never depends on when the month's job ran. A void of the credit invoice reverses its entry and gives the credited schedules their liability part back: the share of it for the months released since the credit (by their days, out of the days not released when the credit posted) is released on the void date at its carried amounts, all of it when no month is left; the rest joins what the later months release. A void of a credited cycle while the credit stands is held `NEEDS_DECISION` (`schedule_credited`). A credit and a credit's void are each measured as of their own date, whenever they post (owner, 2026-11-11): what was recognised and released counts only for the months that ended before that date; each month released since, which the credit or the void would have cut, is recut as of that date and corrected by an adjustment at the carried amounts, dated on the month's last day (on the first day of the first open period when the month is closed), so the books end as in Hub's order.

## Basis

- **IFRS 15.87–88:** a credit on a cycle already invoiced is a change in the transaction price after inception. It is allocated to the cycle's performance obligation, and the part relating to the service already transferred is recognised as a reduction of revenue in the period of the change (cumulative catch-up); the part relating to the service still to come reduces the contract liability and is recognised as the rest of the cycle is delivered (scope §6 "Credit lines": parts already released are never rewritten).
- **IFRS 15.35(a), 15.39–41:** progress is measured by time elapsed (scope Q3a); a credit changes the price, not the progress, so the measure of progress before and after the credit is the same.
- **IFRS 15.106:** what remains in the contract liability is the consideration invoiced for service not yet transferred.
- **IFRS 15.88 for a credit's void:** the void restores the price, a change in the transaction price of its own; the part of it for service transferred since the credit is recognised on the void date, as the credit's own revenue part was.
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
- afterwards, the months not yet released: `allocate(remaining, days of those months)` in each ledger;
- at the credit's void, the liability part given back, *g*, in each ledger: `allocate(g, [days released since the credit, days still to release])`; the first part is released on the void date, the second joins the remaining.

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

### Vertex Media: a credit posted before its ended month's release

The same credit as above, on December's invoice dated 1 December at 123, received before November's job has run (it runs at 01:00). November ended before the credit's date, so the credit first posts November's release, dated 30 November, in its own transaction; the split then finds the cycle fully released, as when the job runs first. November's job posts nothing afterwards.

```yaml
case: a 60.00 USD credit dated 1 Dec received before November's job; it posts November's release first, then reduces revenue as in the case above
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-42, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "121.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 60000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-01, cycle_end: 2026-11-30, service: S1 }] }
  - event: invoice.issued
    accounting_date: 2026-12-01
    payload: { invoice: INV-2026-43, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "124.0000", issued_on: 2026-12-01, due_on: 2026-12-16,
               lines: [{ line: L1, amount: 60000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-12-01, cycle_end: 2026-12-31, service: S1 },
                       { line: L2, amount: -6000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-01, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
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
        # posted by the credit's transaction, before its split; the job then finds it and posts nothing
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 60000, book: 7200000, parallel: 60000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -60000, book: -7200000, parallel: -60000 }
    - source: invoice.issued
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 54000, book: 6642000, parallel: 54000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -60000, book: -7380000, parallel: -60000 }
        # R = 0: all 6,000 reduces revenue at 123, no liability line, no residual
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 6000, book: 738000, parallel: 6000 }
  balances:
    - { account: "212001", book: -7380000, parallel: -60000 }
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

The credit of 19 November (50.00 USD, all to the liability) shrinks November's release to 16/30 of 850.00 USD. Hub voids the credit invoice on 3 December (S06 rule 8): its entry is reversed exactly on the void date, and the liability part comes back. When the credit posted, November and December were not released (30 days); since then November's 16 have been, so 16/30 of what comes back is released on 3 December, at its carried amounts; the rest waits for December, which then releases its original part. November keeps its figure; the cycle's revenue is 900.00 USD in all.

```yaml
case: a 50.00 USD credit voided on 3 Dec after November released 16/30 of 850.00; 16/30 of the 50.00 released on 3 Dec, the rest in December; the cycle's revenue is 900.00
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
    - source: invoice.voided
      date: 2026-12-03
      lines:
        # the part given back for November, released since the credit: 5,000 × 16 / 30 = 2,666.6… → 2,667; book 605,000 × 16 / 30 = 322,666.6… → 322,667, carried
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 2667, book: 322667, parallel: 2667 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -2667, book: -322667, parallel: -2667 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        # the last month takes what remains: 85,000 − 45,333 + 2,333 = 42,000; book 10,285,000 − 5,485,333 + 282,333 = 5,082,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 42000, book: 5082000, parallel: 42000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -42000, book: -5082000, parallel: -42000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", dims: { service: S1 }, book: -10890000, parallel: -90000 }
    - { account: "411001", dims: { service: S3 }, book: 0, parallel: 0 }
  open_items:
    - { item: INV-2026-46, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: the void of the credit invoice after its cycle is fully released

The same credit, voided on 5 January 2027, after November and December have released all that remained of the cycle: no month is left, so all of the 50.00 USD the void gives back is released on the void date, at what it carries. Without it the liability would keep 50.00 USD for a service delivered.

```yaml
case: the 50.00 USD credit voided on 5 Jan 2027 after its cycle fully released; all of it released on the void date
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
  - job: revenue_release_month
    period: 2026-12
  - event: invoice.voided
    accounting_date: 2027-01-05
    payload: { invoice: INV-2026-46, voided_on: 2027-01-05, reason: "أُلغي الإشعار الدائن في Hub" }
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
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 45333, book: 5485333, parallel: 45333 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -45333, book: -5485333, parallel: -45333 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        # the rest of the credited cycle: 85,000 − 45,333 = 39,667; book 10,285,000 − 5,485,333 = 4,799,667
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 39667, book: 4799667, parallel: 39667 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -39667, book: -4799667, parallel: -39667 }
    - source: invoice.voided
      date: 2027-01-05
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: -5000, book: -605000, parallel: -5000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S3 }, currency: USD, amount: 10000, book: 1210000, parallel: 10000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -5000, book: -605000, parallel: -5000 }
    - source: invoice.voided
      date: 2027-01-05
      lines:
        # all 30 days not released at the credit have been released since: all of the 5,000 / 605,000, carried
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 5000, book: 605000, parallel: 5000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -5000, book: -605000, parallel: -5000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", dims: { service: S1 }, book: -10890000, parallel: -90000 }
    - { account: "411001", dims: { service: S3 }, book: 0, parallel: 0 }
```

### Vertex Media: a credit processed after its cycle's later months were released

The credit of 19 November (50.00 USD) arrives before its cycle's invoice and is held `UNKNOWN_REFERENCE` (`credit_cycle`). The cycle's invoice of 15 November arrives only on 1 January: it posts, and in its own transaction November's and December's releases at 16/30 and 14/30 of 900.00 USD (S06 rule 5). The credit is then retried and posts, dated 19 November, as of its own date (owner, 2026-11-11): nothing of the cycle had been recognised on 19 November, so all of it reduces the liability, as in the case "a credit received before its cycle's invoice". The months released since, which the credit would have cut, are each recut as of the credit's date and corrected by an adjustment dated on the month's last day, at the carried amounts: November 480.00 becomes 453.33, December 420.00 becomes 396.67, as if the events had arrived in Hub's order. A month that is closed takes its adjustment on the first day of the first open period, as a closed month's release does.

```yaml
case: a 50.00 USD credit of 19 Nov posted after November and December were released; as of its date all of it to the liability, then November and December recut by adjustments on their last days
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
  - job: revenue_release_month
    period: 2026-11
  - job: revenue_release_month
    period: 2026-12
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
    - source: revenue_release
      date: 2026-11-30
      lines:
        # posted in the cycle invoice's transaction on 1 Jan (S06 rule 5): 16 / 30 of 900.00
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 48000, book: 5808000, parallel: 48000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -48000, book: -5808000, parallel: -48000 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 42000, book: 5082000, parallel: 42000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -42000, book: -5082000, parallel: -42000 }
    - source: invoice.issued
      date: 2026-11-19
      lines:
        # as of 19 Nov nothing was recognised (no month had ended): all 5,000 to the liability,
        # carried 10,890,000 × 5,000 / 90,000 = 605,000; residual 0, no line
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 5000, book: 605000, parallel: 5000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S3 }, currency: USD, amount: -10000, book: -1210000, parallel: -10000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 5000, book: 605000, parallel: 5000 }
    - source: invoice.issued
      date: 2026-11-30
      lines:
        # November recut as of 19 Nov: 85,000 × 16 / 30 = 45,333; book 10,285,000 × 16 / 30 = 5,485,333;
        # released 48,000 / 5,808,000, so 2,667 / 322,667 too much, carried back to the liability
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 2667, book: 322667, parallel: 2667 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -2667, book: -322667, parallel: -2667 }
    - source: invoice.issued
      date: 2026-12-31
      lines:
        # December, the last month, takes what remains: 85,000 − 45,333 = 39,667; book 4,799,667;
        # released 42,000 / 5,082,000, so 2,333 / 282,333 too much
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 2333, book: 282333, parallel: 2333 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -2333, book: -282333, parallel: -2333 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    # November 45,333 and December 39,667, as in Hub's order: 850.00 USD
    - { account: "411001", dims: { service: S1 }, book: -10285000, parallel: -85000 }
    - { account: "411001", dims: { service: S3 }, book: -1210000, parallel: -10000 }
```

### Vertex Media: a credit's void processed after a later month's release

The credit of 19 November (50.00 USD, all to the liability) posts on time, and November releases 16/30 of 850.00. Hub voids the credit invoice on 3 December, but the void arrives only on 1 January, after December's job released the rest of the credited cycle, 396.67 USD. The void posts as of its own date (owner, 2026-11-11): its reversal, then the share of what comes back for the months released between the credit and the void (November's 16 of the 30 days not released at the credit), 26.67 USD on 3 December, as in the case "the void of the credit invoice". December, released since the void's date, is recut as of it: it should have released 420.00, so an adjustment dated 31 December releases the 23.33 USD more, carried.

```yaml
case: a 50.00 USD credit voided on 3 Dec, the void received after December's release; 16/30 of the 50.00 released on 3 Dec, and December brought to 420.00 by an adjustment on 31 Dec
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
  - job: revenue_release_month
    period: 2026-12
  - event: invoice.voided
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-46, voided_on: 2026-12-03, reason: "أُلغي الإشعار الدائن في Hub" }
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
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 45333, book: 5485333, parallel: 45333 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -45333, book: -5485333, parallel: -45333 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        # the rest of the credited cycle: 85,000 − 45,333 = 39,667; book 10,285,000 − 5,485,333 = 4,799,667
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 39667, book: 4799667, parallel: 39667 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -39667, book: -4799667, parallel: -39667 }
    - source: invoice.voided
      date: 2026-12-03
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: -5000, book: -605000, parallel: -5000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S3 }, currency: USD, amount: 10000, book: 1210000, parallel: 10000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -5000, book: -605000, parallel: -5000 }
    - source: invoice.voided
      date: 2026-12-03
      lines:
        # as of 3 Dec only November was released since the credit: 16 of the 30 days, 2,667 / 322,667, carried
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 2667, book: 322667, parallel: 2667 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -2667, book: -322667, parallel: -2667 }
    - source: invoice.voided
      date: 2026-12-31
      lines:
        # December recut as of 3 Dec: what remains, 39,667 + 2,333 = 42,000 / 4,799,667 + 282,333 = 5,082,000;
        # released 39,667 / 4,799,667, so 2,333 / 282,333 more, carried
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 2333, book: 282333, parallel: 2333 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -2333, book: -282333, parallel: -2333 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    # November 453.33 + 26.67 on 3 Dec, December 420.00: the cycle's 900.00, as in Hub's order
    - { account: "411001", dims: { service: S1 }, book: -10890000, parallel: -90000 }
    - { account: "411001", dims: { service: S3 }, book: 0, parallel: 0 }
```

### Vertex Media: a credit dated before a later change of its cycle is held

A credit measured as of its date would need the later changes of its cycle measured again: a credit of a later date already posted, whose revenue part was measured at its own day's rates, or the void of another credit. So a credit, or a credit's void, received after a change of its cycle dated later than itself is held `NEEDS_DECISION` (`credit_after_later_change`) whole, with nothing posted (owner, 2026-11-11): Hub voids the later change and sends it again after it, or the accountant decides. Two cases:
- the credit of 19 November (50.00 USD) arrives after a credit of 3 December (30.00 USD) already posted on the same cycle;
- the credit of 25 November (50.00 USD) arrives after the void, on 3 December, of the credit of 19 November.

```yaml
case: a 50.00 USD credit of 19 Nov received after a 30.00 USD credit of 3 Dec posted on its cycle is held credit_after_later_change
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
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
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-47, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "124.0000", issued_on: 2026-12-03, due_on: 2026-12-18,
               lines: [{ line: L1, amount: 10000, source: extra_work, service: S3 },
                       { line: L2, amount: -3000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-15, service: S1 }] }
  - event: invoice.issued
    accounting_date: 2026-11-19
    payload: { invoice: INV-2026-46, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-19, due_on: 2026-12-04,
               lines: [{ line: L1, amount: 10000, source: extra_work, service: S3 },
                       { line: L2, amount: -5000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-15, service: S1 }] }
    outcome: { status: held, reason: NEEDS_DECISION, detail: credit_after_later_change }
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
    - source: invoice.issued
      date: 2026-12-03
      lines:
        # the total, 100.00 − 30.00 = 70.00 USD × 123 = 8,610.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 7000, book: 861000, parallel: 7000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S3 }, currency: USD, amount: -10000, book: -1230000, parallel: -10000 }
        # N = 90,000, R = 42,000: revenue 3,000 × 48,000 / 90,000 = 1,600 × 123 = 196,800
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 1600, book: 196800, parallel: 1600 }
        # liability 1,400, carried 5,082,000 × 1,400 / 42,000 = 169,400 (at 121)
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 1400, book: 169400, parallel: 1400 }
        # book residual: 861,000 − 1,230,000 + 196,800 + 169,400 = −2,800 → a realised loss of 28.00 SYP
        - { account: "541001", currency: SYP, amount: 2800, book: 2800, parallel: 0 }
  balances:
    # the credit of 19 Nov posts nothing
    - { account: "212001", book: -4912600, parallel: -40600 }
    - { account: "112001", book: 11751000, parallel: 97000 }
```

```yaml
case: a 50.00 USD credit of 25 Nov received after the void, on 3 Dec, of the credit of 19 Nov is held credit_after_later_change
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
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
  - event: invoice.issued
    accounting_date: 2026-11-25
    payload: { invoice: INV-2026-49, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-25, due_on: 2026-12-10,
               lines: [{ line: L1, amount: 10000, source: extra_work, service: S3 },
                       { line: L2, amount: -5000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-15, service: S1 }] }
    outcome: { status: held, reason: NEEDS_DECISION, detail: credit_after_later_change }
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
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 45333, book: 5485333, parallel: 45333 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -45333, book: -5485333, parallel: -45333 }
    - source: invoice.voided
      date: 2026-12-03
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: -5000, book: -605000, parallel: -5000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S3 }, currency: USD, amount: 10000, book: 1210000, parallel: 10000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -5000, book: -605000, parallel: -5000 }
    - source: invoice.voided
      date: 2026-12-03
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 2667, book: 322667, parallel: 2667 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -2667, book: -322667, parallel: -2667 }
  balances:
    # the credit of 25 Nov posts nothing: December still to release 420.00 USD
    - { account: "212001", book: -5082000, parallel: -42000 }
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
    # INV-2026-42's 600.00 USD only, still to collect: the zero invoice adds nothing to receivables
    - { account: "112001", book: 7200000, parallel: 60000 }
    - { account: "212001", book: -7380000, parallel: -60000 }
    # 7,200,000 − 7,380,000: November's revenue is reduced at December's rate (cumulative catch-up)
    - { account: "411001", book: 180000, parallel: 0 }
```

### Vertex Media: an SYP cycle credited in SYP

An SYP retainer at Vertex Media: the SYP books take every amount as is, and the USD parallel ledger measures at Hub's `syp_per_usd`, which it accepts for each invoice's own date. The cycle of 15 November to 14 December (72,600.00 SYP at Hub's 121, 600.00 USD) releases 16/30 in November. On 15 December the next cycle's invoice carries a credit of 7,260.00 SYP at Hub's 120: the revenue reduction is measured at 120, the liability carried at 121, so the parallel ledger's residual is a realised loss; the SYP books have none.

```yaml
case: a 7,260.00 SYP credit at Hub's 120 to a 72,600.00 SYP cycle at Hub's 121 with 16/30 released; a 0.23 USD parallel loss, nothing in the SYP books
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-16
    payload: { invoice: INV-2026-51, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: SYP, syp_per_usd: "121.0000", issued_on: 2026-11-16, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 7260000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - event: invoice.issued
    accounting_date: 2026-12-15
    payload: { invoice: INV-2026-52, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: SYP, syp_per_usd: "120.0000", issued_on: 2026-12-15, due_on: 2026-12-30,
               lines: [{ line: L1, amount: 7260000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-12-15, cycle_end: 2027-01-14, service: S1 },
                       { line: L2, amount: -726000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-11-15, service: S1 }] }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-16
      lines:
        # parallel: 72,600.00 SYP / 121 (Hub's) = 600.00 USD
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 7260000, book: 7260000, parallel: 60000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: -7260000, book: -7260000, parallel: -60000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # 16 / 30: 3,872,000 SYP; the parallel ledger cuts its own 60,000 → 32,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 3872000, book: 3872000, parallel: 32000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: SYP, amount: -3872000, book: -3872000, parallel: -32000 }
    - source: invoice.issued
      date: 2026-12-15
      lines:
        # the total 6,534,000 SYP / 120 = 54,450
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 6534000, book: 6534000, parallel: 54450 }
        # the new cycle 7,260,000 / 120 = 60,500
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: -7260000, book: -7260000, parallel: -60500 }
        # revenue 726,000 × 3,872,000 / 7,260,000 = 387,200 SYP; / 120 = 3,226.6… → 3,227
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: SYP, amount: 387200, book: 387200, parallel: 3227 }
        # liability 338,800 SYP, carried: 28,000 × 338,800 / 3,388,000 = 2,800
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 338800, book: 338800, parallel: 2800 }
        # parallel residual: 54,450 − 60,500 + 3,227 + 2,800 = −23 → a realised loss of 0.23 USD; book: none
        - { account: "541001", currency: USD, amount: 23, book: 0, parallel: 23 }
  balances:
    - { account: "212001", book: -10309200, parallel: -85700 }
    - { account: "411001", book: -3484800, parallel: -28773 }
    - { account: "541001", book: 0, parallel: 23 }
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
