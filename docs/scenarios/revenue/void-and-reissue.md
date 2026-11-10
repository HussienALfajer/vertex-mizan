# Voids and re-issues of deferred invoices

Status: Proposed

S06 wrote these cases (S06 "Scenarios"), with the owner's answer to open question Q14 (a) of 2026-11-10: a reopen after the void that reversed its done's release is recorded with no entry. They wait for the owner's approval of their expected entries and outcomes, and then stay `Proposed` until S06's feature slice brings their executors: `invoice.voided` of an invoice with schedules, releases, elapsed parts or a done's release; the re-issue of a voided schedule; `milestone.done` and `milestone.reopened`; and the release job `revenue_release_month` (S06 rules 4, 5, 7–9, 11–13).

## Rule

`invoice.voided` of an invoice whose revenue is deferred posts, on the void date, the exact reversal of every entry still standing for the invoice, latest first: its releases (a milestone's done release included), its issue entry, its elapsed parts; each its own entry, so no rate is read and each schedule becomes voided. Closed months keep their figures: what they recognised is taken back in the void's month. An over-time line with the same cycle (`cycle_key`) and charge kind as a voided schedule, or a point-in-time line of the same milestone, is its re-issue. On the re-issue's own date it recognises as service revenue, a new measurement at the re-issue's rates, the re-issued line's part of the months the void took back (those released or elapsed before the void); its later months follow the over-time rules, as a contract asset when they ended before the re-issue's month and as a deferral otherwise. A re-issued milestone line is revenue at issue when the void reversed its done's release and no reopen followed; it clears the milestone's contract asset when a done stands. A reopen whose done's release the void reversed is recorded with no entry.

## Basis

- **IFRS 15.88:** a void that withdraws the invoice of service already transferred changes the transaction price; the revenue it takes back is taken back in the period of the change (cumulative catch-up), and a re-issue restores it in its own period, so the months before keep their reported figures.
- **IFRS 15.38, 15.106–108:** a re-issued milestone whose done stands is a contract asset cleared by the invoice; one whose done's release was taken back by the void is delivered and invoiced at once, so revenue at issue.
- **ADR 0005 and ADR 0012:** posted entries are append-only; a void is reversals dated on its own date, latest first, so a document item's settlements are reversed before its opening (S04 rule 13).
- **IAS 21.16, 21.23(b) and IFRIC 22:** the reversals carry the amounts they reverse. **IAS 21.21–22:** the re-issue's lines are new measurements at the re-issue's policy rates; an elapsed month's asset at its month end's. **IAS 21.28 and ADR 0013:** the residual of an entry with carried lines is a realised exchange difference.
- **Company policy:** `phase-1-scope.md` §4 and §6 ("Invoice voided", "Retainer cycle charge", "Milestone invoice issued"); S06 rules 4, 5, 7–9, 11–13, "Currencies, rates and rounding", "Periods" (owner, 2026-11-10); open question Q14 (a), answered by the owner on 2026-11-10; ADR 0007; ADR 0015.
- **Hub's side** (read on 2026-11-10, Hub F13 rule 25): a done milestone can be reopened while it is not invoiced, so after its invoice's void.
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting. No tax rule is applied.

## Cases

The account codes are the service-agency template's (S02): trade receivables `112001`, contract assets `113001`, contract liabilities `212001`, service revenue `411001`, realised exchange gains `421001` and losses `541001`. The slots take their template defaults (S06 "Data"). Every rate and amount is synthetic. 29 October, 3, 5, 15 and 30 November, 1, 3, 7, 8, 10 and 31 December 2026 and 5 January 2027 are publication days; 31 October 2026 is a Saturday.

The payloads use the short forms of `revenue/over-time-release.md` and `revenue/milestones.md`. A void's entries are each the exact negation of the entry they reverse, dated on the void date, with the void as their source (`invoice.voided`); a reversal moves the item its line moved (S04 rule 13).

**A re-issue's catch-up** (S06 rule 9): the re-issued line is cut by days from its own period's start (S06 rule 3); its parts of the months the void took back are revenue at issue, at the re-issue's rates; its later months are elapsed or deferred as on any invoice. With the amount of the voided line, the catch-up is what the void took back.

The cases leave out what other scenarios own: a void before any release (`revenue/revenue-at-issue.md`'s void, the same reversal), a credit's void and a credited cycle's void (`revenue/retainer-credit.md`), a void with payments standing (held `OPEN_ITEM_HAS_SETTLEMENTS`, `receivables/hub-payment.md`). A void in an open month that takes back a closed month's revenue needs S07's close for its setup, and posts the same entries on the void's date. `third` cannot occur (S06 "Currencies, rates and rounding"). A replayed event posts nothing new: a property test, since a step carries no event ID.

### Vertex Media: a void after a release, and a re-issue in the same month

The cycle of 15 November to 14 December (900.00 USD at 121) has released November's 16 days. Hub voids it on 3 December: the release, then the issue, are reversed. The re-issue of 7 December, at 122, recognises November's 480.00 USD at once and defers December's 420.00 USD, which December's job releases.

```yaml
case: a 900.00 USD cycle at 121 voided on 3 Dec after November's release; re-issued on 7 Dec at 122; November caught up at 122, December deferred and released
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-12-07, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-15
    payload: { invoice: INV-2026-80, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-15, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - event: invoice.voided
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-80, voided_on: 2026-12-03, reason: "أُلغيت الفاتورة في Hub" }
  - event: invoice.issued
    accounting_date: 2026-12-07
    payload: { invoice: INV-2026-81, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "123.0000", issued_on: 2026-12-07, due_on: 2026-12-22,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
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
        # 16 / 30: 48,000; book 5,808,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 48000, book: 5808000, parallel: 48000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -48000, book: -5808000, parallel: -48000 }
    - source: invoice.voided
      date: 2026-12-03
      lines:
        # the release reversed first: November's revenue taken back in December
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 48000, book: 5808000, parallel: 48000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -48000, book: -5808000, parallel: -48000 }
    - source: invoice.voided
      date: 2026-12-03
      lines:
        # then the issue entry; the item INV-2026-80 closes
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: -90000, book: -10890000, parallel: -90000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10890000, parallel: 90000 }
    - source: invoice.issued
      date: 2026-12-07
      lines:
        # 900.00 USD × 122 = 109,800.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10980000, parallel: 90000 }
        # November, taken back by the void: 90,000 × 16 / 30 = 48,000 × 122 = 5,856,000, revenue at issue
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -48000, book: -5856000, parallel: -48000 }
        # December deferred: 42,000 × 122 = 5,124,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -42000, book: -5124000, parallel: -42000 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        # INV-2026-81's December; the voided INV-2026-80 releases nothing
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 42000, book: 5124000, parallel: 42000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -42000, book: -5124000, parallel: -42000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    # November 58,080.00 − 58,080.00 + 58,560.00, December 51,240.00: the cycle once, at 122
    - { account: "411001", book: -10980000, parallel: -90000 }
  open_items:
    - { item: INV-2026-80, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: INV-2026-81, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10980000, parallel: 90000 }
```

### Vertex Media: a re-issue the next month

The same cycle is voided on 10 December, and December's job releases nothing for it. The re-issue arrives on 5 January 2027, at 125. November, which the void took back, is revenue at issue. December was not released before the void and ended before January, so it is elapsed (S06 rule 7): a contract asset dated 31 December at that day's 124, cleared by the re-issue at what it carries; the book residual is a realised gain.

```yaml
case: the 900.00 USD cycle voided on 10 Dec; re-issued on 5 Jan 2027 at 125; November caught up at 125, December elapsed at 124 and cleared; a 420.00 SYP realised gain
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
  - { date: 2027-01-05, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-15
    payload: { invoice: INV-2026-80, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-15, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - event: invoice.voided
    accounting_date: 2026-12-10
    payload: { invoice: INV-2026-80, voided_on: 2026-12-10, reason: "أُلغيت الفاتورة في Hub" }
  - job: revenue_release_month
    period: 2026-12
  - event: invoice.issued
    accounting_date: 2027-01-05
    payload: { invoice: INV-2027-1, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "126.0000", issued_on: 2027-01-05, due_on: 2027-01-20,
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
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 48000, book: 5808000, parallel: 48000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -48000, book: -5808000, parallel: -48000 }
    - source: invoice.voided
      date: 2026-12-10
      lines:
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 48000, book: 5808000, parallel: 48000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -48000, book: -5808000, parallel: -48000 }
    - source: invoice.voided
      date: 2026-12-10
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: -90000, book: -10890000, parallel: -90000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10890000, parallel: 90000 }
    - source: invoice.issued
      date: 2026-12-31
      lines:
        # December elapsed: 90,000 × 14 / 30 = 42,000 × 124 (bulletin of 31 Dec) = 5,208,000, the item INV-2027-1/1
        - { account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: 42000, book: 5208000, parallel: 42000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -42000, book: -5208000, parallel: -42000 }
    - source: invoice.issued
      date: 2027-01-05
      lines:
        # 900.00 USD × 125 = 112,500.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 11250000, parallel: 90000 }
        # November, taken back by the void: 48,000 × 125 = 6,000,000, revenue at issue
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -48000, book: -6000000, parallel: -48000 }
        # the item cleared at what it carries
        - { account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: -42000, book: -5208000, parallel: -42000 }
        # book residual: 11,250,000 − 6,000,000 − 5,208,000 = 42,000 → a realised gain of 420.00 SYP; parallel: none
        - { account: "421001", currency: SYP, amount: -42000, book: -42000, parallel: 0 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "113001", book: 0, parallel: 0 }
    # 5,808,000 − 5,808,000 + 5,208,000 + 6,000,000
    - { account: "411001", book: -11208000, parallel: -90000 }
    - { account: "421001", book: -42000, parallel: 0 }
  open_items:
    - { item: INV-2027-1/1, account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: INV-2027-1, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 11250000, parallel: 90000 }
```

### Vertex Media: a void after an elapsed part and a release, and its re-issue

`revenue/over-time-release.md`'s late issue: the cycle of 20 October to 19 November (620.00 USD), issued on 5 November, recognised October as a contract asset at 119 and released November. The void of 3 December reverses its three entries, latest first: November's release, the issue (which reopens the item and takes back the 360.00 SYP gain), then October's elapsed part (which closes the item). The re-issue of 7 December, at 122, finds both months taken back: all of it is revenue at issue.

```yaml
case: the 620.00 USD late cycle voided on 3 Dec, its release, issue and elapsed part reversed latest first; re-issued on 7 Dec at 122, all of it revenue at issue
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-10-29, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "120.5000", type: bulletin }
  - { date: 2026-12-07, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-05
    payload: { invoice: INV-2026-24, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "121.0000", issued_on: 2026-11-05, due_on: 2026-11-20,
               lines: [{ line: L1, amount: 62000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-10-20, cycle_end: 2026-11-19, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - event: invoice.voided
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-24, voided_on: 2026-12-03, reason: "أُلغيت الفاتورة في Hub" }
  - event: invoice.issued
    accounting_date: 2026-12-07
    payload: { invoice: INV-2026-25, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "123.0000", issued_on: 2026-12-07, due_on: 2026-12-22,
               lines: [{ line: L1, amount: 62000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-10-20, cycle_end: 2026-11-19, service: S1 }] }
expect:
  entries:
    - source: invoice.issued
      date: 2026-10-31
      lines:
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
    - source: invoice.voided
      date: 2026-12-03
      lines:
        # November's release reversed
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 38000, book: 4579000, parallel: 38000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -38000, book: -4579000, parallel: -38000 }
    - source: invoice.voided
      date: 2026-12-03
      lines:
        # the issue reversed: the item INV-2026-24/1 reopens at 28,560.00, the gain is taken back
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: -62000, book: -7471000, parallel: -62000 }
        - { account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: 24000, book: 2856000, parallel: 24000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 38000, book: 4579000, parallel: 38000 }
        - { account: "421001", currency: SYP, amount: 36000, book: 36000, parallel: 0 }
    - source: invoice.voided
      date: 2026-12-03
      lines:
        # October's elapsed part reversed last: the item closes, October's revenue taken back in December
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 24000, book: 2856000, parallel: 24000 }
        - { account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: -24000, book: -2856000, parallel: -24000 }
    - source: invoice.issued
      date: 2026-12-07
      lines:
        # October and November taken back: all 620.00 USD × 122 = 75,640.00 SYP, revenue at issue
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 62000, book: 7564000, parallel: 62000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -62000, book: -7564000, parallel: -62000 }
  balances:
    - { account: "113001", book: 0, parallel: 0 }
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -7564000, parallel: -62000 }
    - { account: "421001", book: 0, parallel: 0 }
  open_items:
    - { item: INV-2026-24/1, account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: INV-2026-24, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: INV-2026-25, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 62000, book: 7564000, parallel: 62000 }
```

### Vertex Media: a re-issue at another amount

The cycle of the first case is re-issued at 930.00 USD instead of 900.00 (a change in the transaction price, IFRS 15.88). The re-issued line is cut by its own days: November's part of 930.00 is revenue at issue, December's is deferred; the cycle's revenue is 930.00 USD.

```yaml
case: the 900.00 USD cycle voided on 3 Dec after November's release; re-issued at 930.00 on 7 Dec at 122; November's 16/30 of 930.00 caught up, the rest deferred
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-12-07, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-15
    payload: { invoice: INV-2026-80, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-15, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - event: invoice.voided
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-80, voided_on: 2026-12-03, reason: "أُلغيت الفاتورة في Hub" }
  - event: invoice.issued
    accounting_date: 2026-12-07
    payload: { invoice: INV-2026-83, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "123.0000", issued_on: 2026-12-07, due_on: 2026-12-22,
               lines: [{ line: L1, amount: 93000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
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
    - source: invoice.voided
      date: 2026-12-03
      lines:
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 48000, book: 5808000, parallel: 48000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -48000, book: -5808000, parallel: -48000 }
    - source: invoice.voided
      date: 2026-12-03
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: -90000, book: -10890000, parallel: -90000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10890000, parallel: 90000 }
    - source: invoice.issued
      date: 2026-12-07
      lines:
        # 930.00 USD × 122 = 113,460.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 93000, book: 11346000, parallel: 93000 }
        # November: 93,000 × 16 / 30 = 49,600 × 122 = 6,051,200, revenue at issue
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -49600, book: -6051200, parallel: -49600 }
        # December deferred: 93,000 − 49,600 = 43,400 × 122 = 5,294,800
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -43400, book: -5294800, parallel: -43400 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 43400, book: 5294800, parallel: 43400 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -43400, book: -5294800, parallel: -43400 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -11346000, parallel: -93000 }
```

### Vertex Media: a milestone invoiced before its done, its invoice voided after the done, and re-issued

The deposit MS-1 (300.00 USD at 120) is released at its done on 20 November. Hub voids its invoice on 1 December: the done's release, then the issue, are reversed, so the milestone's revenue is taken back. The re-issue of 3 December, at 123, is revenue at issue: the milestone is delivered and invoiced at once (S06 rule 9), and Hub sends no new done.

```yaml
case: a 300.00 USD deposit released at its done; its invoice voided on 1 Dec, the release and the issue reversed; re-issued on 3 Dec at 123 as revenue at issue
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-90, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 30000, source: deposit, milestone: MS-1, service: S1 }] }
  - event: milestone.done
    accounting_date: 2026-11-20
    payload: { milestone: MS-1, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: USD, amount: 30000, done_on: 2026-11-20, service: S1 }
  - event: invoice.voided
    accounting_date: 2026-12-01
    payload: { invoice: INV-2026-90, voided_on: 2026-12-01, reason: "أُلغيت الفاتورة في Hub" }
  - event: invoice.issued
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-91, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "124.0000", issued_on: 2026-12-03, due_on: 2026-12-18,
               lines: [{ line: L1, amount: 30000, source: deposit, milestone: MS-1, service: S1 }] }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: milestone.done
      date: 2026-11-20
      lines:
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: invoice.voided
      date: 2026-12-01
      lines:
        # the done's release reversed first
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: invoice.voided
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
    - source: invoice.issued
      date: 2026-12-03
      lines:
        # 300.00 USD × 123 = 36,900.00 SYP, revenue at issue
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3690000, parallel: 30000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -30000, book: -3690000, parallel: -30000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -3690000, parallel: -30000 }
  open_items:
    - { item: INV-2026-90, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: INV-2026-91, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3690000, parallel: 30000 }
```

### Vertex Media: a reopen after the void, a new done and the re-issue

Open question Q14 (a), answered by the owner on 2026-11-10. As above, the void of 1 December takes back MS-1's done. Hub, where the milestone is no longer invoiced, reopens it on 2 December: the void already reversed the done's release, so the reopen is recorded with no entry. The milestone is done again on 8 December, not invoiced: a contract asset at 124, the item `MS-1` (no earlier item: the first done released a deferral). The re-issue of 10 December, at 125, clears it; the book residual is a realised gain.

```yaml
case: the deposit's invoice voided after its done; the reopen recorded with no entry; done again on 8 Dec at 124 as a contract asset; the re-issue at 125 clears it; a 300.00 SYP realised gain
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-08, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-90, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 30000, source: deposit, milestone: MS-1, service: S1 }] }
  - event: milestone.done
    accounting_date: 2026-11-20
    payload: { milestone: MS-1, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: USD, amount: 30000, done_on: 2026-11-20, service: S1 }
  - event: invoice.voided
    accounting_date: 2026-12-01
    payload: { invoice: INV-2026-90, voided_on: 2026-12-01, reason: "أُلغيت الفاتورة في Hub" }
  - event: milestone.reopened
    accounting_date: 2026-12-02
    payload: { milestone: MS-1, client: C1, project: { code: P1, kind: project, client: C1 },
               reopened_on: 2026-12-02 }
  - event: milestone.done
    accounting_date: 2026-12-08
    payload: { milestone: MS-1, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: USD, amount: 30000, done_on: 2026-12-08, service: S1 }
  - event: invoice.issued
    accounting_date: 2026-12-10
    payload: { invoice: INV-2026-92, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "126.0000", issued_on: 2026-12-10, due_on: 2026-12-25,
               lines: [{ line: L1, amount: 30000, source: deposit, milestone: MS-1, service: S1 }] }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: milestone.done
      date: 2026-11-20
      lines:
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: invoice.voided
      date: 2026-12-01
      lines:
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: invoice.voided
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
    # the reopen of 2 Dec: recorded, no entry
    - source: milestone.done
      date: 2026-12-08
      lines:
        # not invoiced: 300.00 USD × 124 = 37,200.00 SYP on the item MS-1
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3720000, parallel: 30000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -30000, book: -3720000, parallel: -30000 }
    - source: invoice.issued
      date: 2026-12-10
      lines:
        # 300.00 USD × 125 = 37,500.00 SYP; the item cleared at what it carries
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3750000, parallel: 30000 }
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: -30000, book: -3720000, parallel: -30000 }
        # book residual: 3,750,000 − 3,720,000 = 30,000 → a realised gain of 300.00 SYP
        - { account: "421001", currency: SYP, amount: -30000, book: -30000, parallel: 0 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "113001", book: 0, parallel: 0 }
    # the second done only
    - { account: "411001", book: -3720000, parallel: -30000 }
    - { account: "421001", book: -30000, parallel: 0 }
  open_items:
    - { item: MS-1, account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: INV-2026-92, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3750000, parallel: 30000 }
```

### Vertex Media: a milestone done before its invoice, the invoice voided and re-issued

`revenue/milestones.md`'s MS-2: done on 1 December at 122, invoiced on 3 December at 123 with a 400.00 SYP gain. The void of 8 December reverses the invoice's entry: the item reopens at the 48,800.00 SYP it carries and the gain is taken back. The done stands, so the re-issue of 10 December, at 125, clears the item again (S06 rule 12); the revenue stays the done's.

```yaml
case: a 400.00 USD milestone done at 122 and invoiced at 123; the invoice voided on 8 Dec reopens the item; re-issued on 10 Dec at 125, it clears the item with a 1,200.00 SYP realised gain
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - event: milestone.done
    accounting_date: 2026-12-01
    payload: { milestone: MS-2, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: USD, amount: 40000, done_on: 2026-12-01, service: S1 }
  - event: invoice.issued
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-61, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "124.0000", issued_on: 2026-12-03, due_on: 2026-12-18,
               lines: [{ line: L1, amount: 40000, source: milestone, milestone: MS-2, service: S1 }] }
  - event: invoice.voided
    accounting_date: 2026-12-08
    payload: { invoice: INV-2026-61, voided_on: 2026-12-08, reason: "أُلغيت الفاتورة في Hub" }
  - event: invoice.issued
    accounting_date: 2026-12-10
    payload: { invoice: INV-2026-93, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "126.0000", issued_on: 2026-12-10, due_on: 2026-12-25,
               lines: [{ line: L1, amount: 40000, source: milestone, milestone: MS-2, service: S1 }] }
expect:
  entries:
    - source: milestone.done
      date: 2026-12-01
      lines:
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 4880000, parallel: 40000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -40000, book: -4880000, parallel: -40000 }
    - source: invoice.issued
      date: 2026-12-03
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 4920000, parallel: 40000 }
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: -40000, book: -4880000, parallel: -40000 }
        - { account: "421001", currency: SYP, amount: -40000, book: -40000, parallel: 0 }
    - source: invoice.voided
      date: 2026-12-08
      lines:
        # the invoice's entry reversed: the item MS-2 reopens, the gain taken back
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: -40000, book: -4920000, parallel: -40000 }
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 4880000, parallel: 40000 }
        - { account: "421001", currency: SYP, amount: 40000, book: 40000, parallel: 0 }
    - source: invoice.issued
      date: 2026-12-10
      lines:
        # 400.00 USD × 125 = 50,000.00 SYP; the item cleared at its 48,800.00
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 5000000, parallel: 40000 }
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: -40000, book: -4880000, parallel: -40000 }
        # book residual: 5,000,000 − 4,880,000 = 120,000 → a realised gain of 1,200.00 SYP
        - { account: "421001", currency: SYP, amount: -120000, book: -120000, parallel: 0 }
  balances:
    - { account: "113001", book: 0, parallel: 0 }
    - { account: "411001", book: -4880000, parallel: -40000 }
    - { account: "421001", book: -120000, parallel: 0 }
  open_items:
    - { item: MS-2, account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: INV-2026-61, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: INV-2026-93, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 5000000, parallel: 40000 }
```

### SYP books only

The first case in one ledger: the same book amounts, no parallel amount.

```yaml
case: SYP books only; the 900.00 USD cycle at 121 voided on 3 Dec after November's release; re-issued on 7 Dec at 122; November caught up, December deferred and released
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-12-07, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-15
    payload: { invoice: INV-2026-80, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-15, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - event: invoice.voided
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-80, voided_on: 2026-12-03, reason: "أُلغيت الفاتورة في Hub" }
  - event: invoice.issued
    accounting_date: 2026-12-07
    payload: { invoice: INV-2026-81, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "123.0000", issued_on: 2026-12-07, due_on: 2026-12-22,
               lines: [{ line: L1, amount: 90000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
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
    - source: invoice.voided
      date: 2026-12-03
      lines:
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 48000, book: 5808000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -48000, book: -5808000 }
    - source: invoice.voided
      date: 2026-12-03
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: -90000, book: -10890000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10890000 }
    - source: invoice.issued
      date: 2026-12-07
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 90000, book: 10980000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -48000, book: -5856000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -42000, book: -5124000 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 42000, book: 5124000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -42000, book: -5124000 }
  balances:
    - { account: "212001", book: 0 }
    - { account: "411001", book: -10980000 }
```

### USD books with an SYP parallel ledger: an SYP cycle voided and re-issued

The SYP parallel ledger takes the SYP amounts as is; the USD books divide by the bulletin. The re-issue's catch-up and its deferral are each converted at the re-issue's 122 and round half away from zero, and they sum to its receivable exactly.

```yaml
case: USD books; a 72,600.00 SYP cycle at 121 voided on 3 Dec after November's release; re-issued on 7 Dec at 122; 317.38 USD caught up, 277.70 USD deferred
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-12-07, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-15
    payload: { invoice: INV-2026-84, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: SYP, syp_per_usd: "123.0000", issued_on: 2026-11-15, due_on: 2026-11-30,
               lines: [{ line: L1, amount: 7260000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - job: revenue_release_month
    period: 2026-11
  - event: invoice.voided
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-84, voided_on: 2026-12-03, reason: "أُلغيت الفاتورة في Hub" }
  - event: invoice.issued
    accounting_date: 2026-12-07
    payload: { invoice: INV-2026-85, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: SYP, syp_per_usd: "123.0000", issued_on: 2026-12-07, due_on: 2026-12-22,
               lines: [{ line: L1, amount: 7260000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-15, cycle_end: 2026-12-14, service: S1 }] }
  - job: revenue_release_month
    period: 2026-12
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-15
      lines:
        # 72,600.00 SYP / 121 = 600.00 USD
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 7260000, book: 60000, parallel: 7260000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: -7260000, book: -60000, parallel: -7260000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # 7,260,000 × 16 / 30 = 3,872,000; book 60,000 × 16 / 30 = 32,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 3872000, book: 32000, parallel: 3872000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: SYP, amount: -3872000, book: -32000, parallel: -3872000 }
    - source: invoice.voided
      date: 2026-12-03
      lines:
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: SYP, amount: 3872000, book: 32000, parallel: 3872000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: -3872000, book: -32000, parallel: -3872000 }
    - source: invoice.voided
      date: 2026-12-03
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: SYP, amount: -7260000, book: -60000, parallel: -7260000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 7260000, book: 60000, parallel: 7260000 }
    - source: invoice.issued
      date: 2026-12-07
      lines:
        # 72,600.00 SYP / 122 = 595.081… USD → 595.08
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 7260000, book: 59508, parallel: 7260000 }
        # November: 38,720.00 SYP / 122 = 317.377… → 317.38, revenue at issue
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: SYP, amount: -3872000, book: -31738, parallel: -3872000 }
        # December deferred: 33,880.00 SYP / 122 = 277.704… → 277.70; 59,508 − 31,738 − 27,770 = 0, no rounding line
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: -3388000, book: -27770, parallel: -3388000 }
    - source: revenue_release
      date: 2026-12-31
      lines:
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: SYP, amount: 3388000, book: 27770, parallel: 3388000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: SYP, amount: -3388000, book: -27770, parallel: -3388000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -59508, parallel: -7260000 }
```

Each posted entry balances in both ledgers:
- **Reversals** negate a balanced entry line by line; **releases** carry one amount to both sides.
- **Re-issues of new measurements only:** 10,980,000 − 5,856,000 − 5,124,000 = 0; 11,346,000 − 6,051,200 − 5,294,800 = 0; 7,564,000 − 7,564,000 = 0; 3,690,000 − 3,690,000 = 0; USD books 59,508 − 31,738 − 27,770 = 0; each parallel in the line's currency.
- **Re-issues clearing an item:** 11,250,000 − 6,000,000 − 5,208,000 − 42,000 = 0; 3,750,000 − 3,720,000 − 30,000 = 0; 5,000,000 − 4,880,000 − 120,000 = 0; parallel in USD as is.
