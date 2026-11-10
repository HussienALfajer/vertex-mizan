# Milestones and deposits

Status: Proposed

S06 wrote these cases (S06 "Scenarios"); the owner approved their expected entries and outcomes on 2026-11-10, with two readings of S06 rules 11 and 13: the revenue of a milestone invoiced before its done carries its schedule's current service (the invoice line's, as later service changes leave it), and that of a milestone not invoiced the done's service; and a done after a reopen opens a new contract asset item named `<milestone number>/<n>`, since the reopen settles the earlier one at zero. They stay `Proposed` until S06's feature slice brings their executors: the posting rules of `invoice.issued` with deposit and milestone lines, `milestone.done`, the new `milestone.reopened` and `project.completed`, the order keys `milestone:<id>` and `project:<id>`, S04's unique key on an account's Hub document admitting one contract asset item per done (S06 "Data"), the automatic retry of a reopen when its done posts, and the holds `NEEDS_DECISION` (`milestone_amount_differs`, `milestone_already_done`, `milestone_service_missing`), `UNKNOWN_REFERENCE` and `OPEN_ITEM_HAS_SETTLEMENTS` for these events (S06 rules 1, 2, 11–14, 17–19).

## Rule

A project's milestone, its first installment (the deposit) included, is recognised at a point in time: on the day Hub reports it done. A deposit or milestone invoiced before it is done is deferred at issue to contract liabilities; its `milestone.done` releases it to service revenue at the amounts it carries, so no rate is read. A milestone done before it is invoiced is recognised on its done date as a contract asset, one document item per milestone with the client and the project, a new measurement at each ledger's policy rate of `done_on`; its invoice then credits that item at its carried amounts instead of revenue, and each ledger's residual is a realised exchange difference. A milestone whose amount differs from what was invoiced or recognised for it is held `NEEDS_DECISION` (`milestone_amount_differs`), a second done while one stands is held `milestone_already_done`, and a done without its service is held `milestone_service_missing`. `milestone.reopened` posts the exact reversal of the done's entry, while that entry stands, on its own date; a reopen whose item has been invoiced is held `OPEN_ITEM_HAS_SETTLEMENTS`, and one with no done standing is held `UNKNOWN_REFERENCE` and retried when its done posts. `project.completed` releases, at their carried amounts and in one entry, what remains of the project's milestones invoiced and never reported done; with nothing left it is recorded without an entry, and contract assets stay for their invoices.

## Basis

- **IFRS 15.38 and 15.B15:** each milestone is a performance obligation satisfied at a point in time, when the client accepts the delivered stage; progress is measured by milestones reached (an output method), so revenue is dated on Hub's done date, not on the invoice's.
- **IFRS 15.106:** consideration invoiced before the milestone is delivered (the deposit, a milestone billed in advance) is a contract liability. **IFRS 15.107–108:** a milestone delivered before it is invoiced is a contract asset, reclassified to the receivable when the invoice makes the right unconditional.
- **IFRS 15.87–88:** an invoice or a done whose amount differs from the milestone's installment changes the transaction price; it is a decision for the accountant, not a silent posting.
- **IAS 21.16, 21.23(b) and IFRIC 22:** the contract liability is non-monetary and is released at the amounts it carries. **IAS 21.16, 21.23(a):** the contract asset is monetary (revalued at month end by S07). **IAS 21.21–22:** the asset is recognised at the spot rate of `done_on`, each ledger's policy rate in force then (`milestone.done` carries no rate). **IAS 21.28 and ADR 0013:** the gap between the asset's carried amounts and the invoice's measurement is a realised exchange difference.
- **ADR 0005 and ADR 0012:** a reopen is a reversal dated on its own date, so the month of the done keeps its figures.
- **Company policy:** `phase-1-scope.md` §4 (the book ledger at the bulletin, the USD parallel ledger at market or the transaction's own rate) and §6 ("Milestone invoice issued", "Completed project"); S06 rules 1, 2, 11–14, 17–19, "Currencies, rates and rounding" (owner, 2026-11-10); ADR 0007 "New measurements versus carried amounts"; ADR 0015.
- **Hub's side** (read on 2026-11-10, Hub F05 rule 8, F13 rules 2 and 25): a deposit is the first milestone's installment, billed at the quote's acceptance; an invoiced milestone's installment is locked; a done milestone can be reopened only while it is not invoiced.
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting. No tax rule is applied.

## Cases

The account codes are the service-agency template's (S02): trade receivables `112001` (a `document` control account, client), contract assets `113001` (a `document` control account, monetary, client and contract), contract liabilities `212001` (client and contract, not monetary), service revenue `411001` (client and service; the contract when the invoice names one), realised exchange gains `421001` and losses `541001`. The slots `contract_liability`, `contract_asset` and `released_revenue` take their template defaults (S06 "Data"). Every rate and amount is synthetic. 3 November and 1, 3, 10 and 15 December 2026 are publication days; 20 November 2026 is a Friday, a day without a bulletin, and no case reads a rate on it.

The payloads use the short form of `revenue/over-time-release.md`. A deposit or milestone line names its milestone by `milestone: <number>`, which the runner makes into the line's `milestone_id`, the same Hub id as the milestone in `milestone.done` and `milestone.reopened` (`milestone: <number>`). The project is the invoice's `contract` and the events' `project`, `{ code, kind: project, client }`. `project.completed` is `{ project, client, on }`. A milestone's contract asset item is named by Hub's milestone number and carries the client and the project (S06 "Data").

Sources: an entry has its event as its source: `invoice.issued`, `milestone.done`, `milestone.reopened`, `project.completed`. A step whose answer is `recorded` (no entry) completes like a posted one.

The cases leave out what other scenarios own: the void of a milestone's invoice and its re-issue, before and after the done (`revenue/void-and-reissue.md`, S06 edge case 11), and a cancelled project (`revenue/cancelled-project.md`). A reopen after the void of an invoiced milestone's invoice, and a done after the project's completion, wait for the owner's answer to open question Q14. A deposit or milestone line on an invoice without a project is held `recognition_pattern_unclear` like the over-time lines of `revenue/over-time-release.md`. `third` cannot occur: Hub invoices only in SYP and USD (S06 "Currencies, rates and rounding"). A replayed event posts nothing new: a property test, since a step carries no event ID. A done invoiced before reads no rate, so only the dones before their invoices name a rate.

### Vertex Media: a deposit invoiced, released at its milestone's done; the project completes with nothing left

S06's example and edge case 13. The deposit MS-1 (300.00 USD) is invoiced on 3 November at the bulletin of 120 and deferred. Its done on Friday 20 November releases it at the 36,000.00 SYP it carries; no rate is read, so the day without a bulletin does not matter. The project's completion on 25 November finds nothing remaining and is recorded without an entry.

```yaml
case: a 300.00 USD deposit invoiced at 120 and released at its done on 20 Nov at its carried 36,000.00 SYP; project.completed is recorded with no entry
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-60, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 30000, source: deposit, milestone: MS-1, service: S1 }] }
  - event: milestone.done
    accounting_date: 2026-11-20
    payload: { milestone: MS-1, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: USD, amount: 30000, done_on: 2026-11-20, service: S1 }
  - event: project.completed
    accounting_date: 2026-11-25
    payload: { project: { code: P1, kind: project, client: C1 }, client: C1, on: 2026-11-25 }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # 300.00 USD × 120 (bulletin; Hub's 122 is not read by the book ledger) = 36,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: milestone.done
      date: 2026-11-20
      lines:
        # released at what the liability carries: no rate read
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -3600000, parallel: -30000 }
  open_items:
    - { item: INV-2026-60, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
```

### Vertex Media: a milestone done before its invoice

S06's example and acceptance step 4. MS-2 (400.00 USD) is done on 1 December and not yet invoiced: a contract asset and revenue at the bulletin of that day, 122. Its invoice on 3 December, at 123, clears the item at what it carries instead of crediting revenue again; the book residual is a realised gain.

```yaml
case: a 400.00 USD milestone done on 1 Dec at 122 before its invoice; the invoice on 3 Dec at 123 clears the item; a 400.00 SYP realised gain
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
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
expect:
  entries:
    - source: milestone.done
      date: 2026-12-01
      lines:
        # 400.00 USD × 122 (bulletin of done_on) = 48,800.00 SYP, a new measurement
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 4880000, parallel: 40000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -40000, book: -4880000, parallel: -40000 }
    - source: invoice.issued
      date: 2026-12-03
      lines:
        # 400.00 USD × 123 = 49,200.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 4920000, parallel: 40000 }
        # the item MS-2 cleared at what it carries
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: -40000, book: -4880000, parallel: -40000 }
        # book residual: 4,920,000 − 4,880,000 = 40,000 → a realised gain of 400.00 SYP; parallel: none
        - { account: "421001", currency: SYP, amount: -40000, book: -40000, parallel: 0 }
  balances:
    - { account: "113001", book: 0, parallel: 0 }
    - { account: "411001", book: -4880000, parallel: -40000 }
    - { account: "421001", book: -40000, parallel: 0 }
  open_items:
    - { item: MS-2, account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: INV-2026-61, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 4920000, parallel: 40000 }
```

### Vertex Media: an SYP milestone done before its invoice

The SYP books take the SYP amounts as is. The USD parallel ledger measures the done at the market rate of 1 December, 122, since `milestone.done` carries no rate of Hub's, and the invoice at Hub's 125, which it accepts for the invoice's own date; the parallel residual is a realised loss.

```yaml
case: a 48,800.00 SYP milestone done on 1 Dec, the parallel at the market 122; its invoice on 3 Dec at Hub's 125; a 9.60 USD parallel loss
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "122.0000", type: market }
steps:
  - event: milestone.done
    accounting_date: 2026-12-01
    payload: { milestone: MS-3, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: SYP, amount: 4880000, done_on: 2026-12-01, service: S1 }
  - event: invoice.issued
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-62, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: SYP, syp_per_usd: "125.0000", issued_on: 2026-12-03, due_on: 2026-12-18,
               lines: [{ line: L1, amount: 4880000, source: milestone, milestone: MS-3, service: S1 }] }
expect:
  entries:
    - source: milestone.done
      date: 2026-12-01
      lines:
        # parallel: 48,800.00 SYP / 122 (market of done_on) = 400.00 USD
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 4880000, book: 4880000, parallel: 40000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: SYP, amount: -4880000, book: -4880000, parallel: -40000 }
    - source: invoice.issued
      date: 2026-12-03
      lines:
        # parallel: 48,800.00 SYP / 125 (Hub's rate, accepted) = 390.40 USD
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 4880000, book: 4880000, parallel: 39040 }
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -4880000, book: -4880000, parallel: -40000 }
        # parallel residual: 39,040 − 40,000 = −960 → a realised loss of 9.60 USD; book: none
        - { account: "541001", currency: USD, amount: 960, book: 0, parallel: 960 }
  balances:
    - { account: "411001", book: -4880000, parallel: -40000 }
    - { account: "541001", book: 0, parallel: 960 }
  open_items:
    - { item: MS-3, account: "113001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 0, book: 0, parallel: 0 }
    - { item: INV-2026-62, account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 4880000, book: 4880000, parallel: 39040 }
```

### Vertex Media: decisions held

Each project is its own, so a held event of one does not hold the others behind it (`project:<id>`, S06 rule 17). MS-4's deposit was invoiced at 300.00 USD and its done reports 350.00; MS-5 is done at 400.00 USD and invoiced at 450.00 (S06 edge case 12); MS-6 is done without its service; MS-7 is reported done twice. Each held event posts nothing: the deposit stays deferred and MS-5's and MS-7's items stay open.

```yaml
case: a done differing from its invoiced deposit, an invoice differing from its done milestone, a done without its service and a second done are each held NEEDS_DECISION
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-63, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 30000, source: deposit, milestone: MS-4, service: S1 }] }
  - event: milestone.done
    accounting_date: 2026-12-01
    payload: { milestone: MS-4, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: USD, amount: 35000, done_on: 2026-12-01, service: S1 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: milestone_amount_differs }
  - event: milestone.done
    accounting_date: 2026-12-01
    payload: { milestone: MS-5, client: C1, project: { code: P2, kind: project, client: C1 },
               currency: USD, amount: 40000, done_on: 2026-12-01, service: S1 }
  - event: invoice.issued
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-64, client: C1, contract: { code: P2, kind: project, client: C1 },
               currency: USD, syp_per_usd: "124.0000", issued_on: 2026-12-03, due_on: 2026-12-18,
               lines: [{ line: L1, amount: 45000, source: milestone, milestone: MS-5, service: S1 }] }
    outcome: { status: held, reason: NEEDS_DECISION, detail: milestone_amount_differs }
  - event: milestone.done
    accounting_date: 2026-12-01
    payload: { milestone: MS-6, client: C1, project: { code: P3, kind: project, client: C1 },
               currency: USD, amount: 40000, done_on: 2026-12-01 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: milestone_service_missing }
  - event: milestone.done
    accounting_date: 2026-12-01
    payload: { milestone: MS-7, client: C1, project: { code: P4, kind: project, client: C1 },
               currency: USD, amount: 40000, done_on: 2026-12-01, service: S1 }
  - event: milestone.done
    accounting_date: 2026-12-03
    payload: { milestone: MS-7, client: C1, project: { code: P4, kind: project, client: C1 },
               currency: USD, amount: 40000, done_on: 2026-12-03, service: S1 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: milestone_already_done }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: milestone.done
      date: 2026-12-01
      lines:
        # MS-5: 400.00 USD × 122 = 48,800.00 SYP
        - { account: "113001", dims: { client: C1, contract: P2 }, currency: USD, amount: 40000, book: 4880000, parallel: 40000 }
        - { account: "411001", dims: { client: C1, contract: P2, service: S1 }, currency: USD, amount: -40000, book: -4880000, parallel: -40000 }
    - source: milestone.done
      date: 2026-12-01
      lines:
        # MS-7's first done; the second posts nothing
        - { account: "113001", dims: { client: C1, contract: P4 }, currency: USD, amount: 40000, book: 4880000, parallel: 40000 }
        - { account: "411001", dims: { client: C1, contract: P4, service: S1 }, currency: USD, amount: -40000, book: -4880000, parallel: -40000 }
  balances:
    # MS-4's deposit stays deferred
    - { account: "212001", book: -3600000, parallel: -30000 }
    - { account: "411001", book: -9760000, parallel: -80000 }
  open_items:
    - { item: MS-5, account: "113001", dims: { client: C1, contract: P2 }, currency: USD, amount: 40000, book: 4880000, parallel: 40000 }
    - { item: MS-7, account: "113001", dims: { client: C1, contract: P4 }, currency: USD, amount: 40000, book: 4880000, parallel: 40000 }
```

### Vertex Media: a done milestone reopened, done again and invoiced

MS-8 is done on 1 December at 122 and reopened on 3 December: the exact reversal of the done's entry, dated on the reopen, closes its item at zero. Done again on 10 December, it is a new measurement at that day's 124, on a new item `MS-8/2`. Its invoice on 15 December, at 123, clears the new item; the book residual is a realised loss. A reopen received after the invoice (Hub refuses it, Hub F13 rule 25) is held `OPEN_ITEM_HAS_SETTLEMENTS`.

```yaml
case: a 400.00 USD milestone done at 122, reopened, done again at 124 on a new item and invoiced at 123; a 400.00 SYP realised loss; a reopen after its invoice held
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
  - { date: 2026-12-15, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: milestone.done
    accounting_date: 2026-12-01
    payload: { milestone: MS-8, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: USD, amount: 40000, done_on: 2026-12-01, service: S1 }
  - event: milestone.reopened
    accounting_date: 2026-12-03
    payload: { milestone: MS-8, client: C1, project: { code: P1, kind: project, client: C1 },
               reopened_on: 2026-12-03 }
  - event: milestone.done
    accounting_date: 2026-12-10
    payload: { milestone: MS-8, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: USD, amount: 40000, done_on: 2026-12-10, service: S1 }
  - event: invoice.issued
    accounting_date: 2026-12-15
    payload: { invoice: INV-2026-65, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "125.0000", issued_on: 2026-12-15, due_on: 2026-12-30,
               lines: [{ line: L1, amount: 40000, source: milestone, milestone: MS-8, service: S1 }] }
  - event: milestone.reopened
    accounting_date: 2026-12-16
    payload: { milestone: MS-8, client: C1, project: { code: P1, kind: project, client: C1 },
               reopened_on: 2026-12-16 }
    outcome: { status: held, reason: OPEN_ITEM_HAS_SETTLEMENTS }
expect:
  entries:
    - source: milestone.done
      date: 2026-12-01
      lines:
        # 400.00 USD × 122 = 48,800.00 SYP
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 4880000, parallel: 40000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -40000, book: -4880000, parallel: -40000 }
    - source: milestone.reopened
      date: 2026-12-03
      lines:
        # the exact reversal of the done's entry; no rate read
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: 40000, book: 4880000, parallel: 40000 }
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: -40000, book: -4880000, parallel: -40000 }
    - source: milestone.done
      date: 2026-12-10
      lines:
        # a new measurement on the item MS-8/2: 400.00 USD × 124 = 49,600.00 SYP
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 4960000, parallel: 40000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -40000, book: -4960000, parallel: -40000 }
    - source: invoice.issued
      date: 2026-12-15
      lines:
        # 400.00 USD × 123 = 49,200.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 4920000, parallel: 40000 }
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: -40000, book: -4960000, parallel: -40000 }
        # book residual: 4,920,000 − 4,960,000 = −40,000 → a realised loss of 400.00 SYP; parallel: none
        - { account: "541001", currency: SYP, amount: 40000, book: 40000, parallel: 0 }
  balances:
    - { account: "113001", book: 0, parallel: 0 }
    # the revenue of the second done only
    - { account: "411001", book: -4960000, parallel: -40000 }
    - { account: "541001", book: 40000, parallel: 0 }
  open_items:
    - { item: MS-8, account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: MS-8/2, account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: INV-2026-65, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 4920000, parallel: 40000 }
```

### Vertex Media: a done received behind its held invoice

The deposit MS-9's invoice of 3 November arrives before that day's bulletin is recorded and is held `RATE_MISSING`. The done of 20 November, in the same milestone's order (`milestone:<id>`, S06 rule 17), waits behind it. Once the bulletin is recorded, the invoice posts and then the done, in Hub's order, as in the first case.

```yaml
case: a deposit's invoice held RATE_MISSING; its done waits behind it; the bulletin of 120 recorded, both post in Hub's order
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-66, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 30000, source: deposit, milestone: MS-9, service: S1 }] }
    outcome: { status: held, reason: RATE_MISSING }
  - event: milestone.done
    accounting_date: 2026-11-20
    payload: { milestone: MS-9, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: USD, amount: 30000, done_on: 2026-11-20, service: S1 }
    outcome: { status: held, reason: WAITING_FOR_EARLIER_EVENT }
  - rate: { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
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
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -3600000, parallel: -30000 }
```

### Vertex Media: a reopen received before its done

Delivery reorders MS-10's events: its reopen arrives first and finds no done standing, so it is held `UNKNOWN_REFERENCE`, which never blocks (S06 rule 17). The done then posts and frees it (S06 rule 19): the reopen posts the exact reversal on its own date, and the milestone is not recognised.

```yaml
case: a reopen received before its done is held UNKNOWN_REFERENCE; the done posts at 122 and the reopen then reverses it; nothing is recognised
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - event: milestone.reopened
    accounting_date: 2026-12-03
    payload: { milestone: MS-10, client: C1, project: { code: P1, kind: project, client: C1 },
               reopened_on: 2026-12-03 }
    outcome: { status: held, reason: UNKNOWN_REFERENCE }
  - event: milestone.done
    accounting_date: 2026-12-01
    payload: { milestone: MS-10, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: USD, amount: 40000, done_on: 2026-12-01, service: S1 }
expect:
  entries:
    - source: milestone.done
      date: 2026-12-01
      lines:
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 4880000, parallel: 40000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -40000, book: -4880000, parallel: -40000 }
    - source: milestone.reopened
      date: 2026-12-03
      lines:
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: 40000, book: 4880000, parallel: 40000 }
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: -40000, book: -4880000, parallel: -40000 }
  balances:
    - { account: "113001", book: 0, parallel: 0 }
    - { account: "411001", book: 0, parallel: 0 }
  open_items:
    - { item: MS-10, account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: a project completed with a milestone invoiced and never done

The deposit MS-11 is invoiced and released at its done. MS-12 is done on 1 December before any invoice (a contract asset). MS-13 (200.00 USD) is invoiced in advance on 3 December at 123 and never reported done. The project's completion on 10 December releases MS-13's 200.00 USD at the 24,600.00 SYP it carries, one entry; MS-12's item stays open for its invoice (S06 rule 14).

```yaml
case: project.completed on 10 Dec releases a 200.00 USD milestone invoiced at 123 and never done, at its carried 24,600.00 SYP; a done milestone's contract asset stays open
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-67, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 30000, source: deposit, milestone: MS-11, service: S1 }] }
  - event: milestone.done
    accounting_date: 2026-11-20
    payload: { milestone: MS-11, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: USD, amount: 30000, done_on: 2026-11-20, service: S1 }
  - event: milestone.done
    accounting_date: 2026-12-01
    payload: { milestone: MS-12, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: USD, amount: 40000, done_on: 2026-12-01, service: S1 }
  - event: invoice.issued
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-68, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "124.0000", issued_on: 2026-12-03, due_on: 2026-12-18,
               lines: [{ line: L1, amount: 20000, source: milestone, milestone: MS-13, service: S1 }] }
  - event: project.completed
    accounting_date: 2026-12-10
    payload: { project: { code: P1, kind: project, client: C1 }, client: C1, on: 2026-12-10 }
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
    - source: milestone.done
      date: 2026-12-01
      lines:
        # MS-12: 400.00 USD × 122 = 48,800.00 SYP
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 4880000, parallel: 40000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -40000, book: -4880000, parallel: -40000 }
    - source: invoice.issued
      date: 2026-12-03
      lines:
        # MS-13 invoiced before done: 200.00 USD × 123 = 24,600.00 SYP, deferred
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 20000, book: 2460000, parallel: 20000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -20000, book: -2460000, parallel: -20000 }
    - source: project.completed
      date: 2026-12-10
      lines:
        # what remains of MS-13's schedule, at its carried amounts; no rate read
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 20000, book: 2460000, parallel: 20000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -20000, book: -2460000, parallel: -20000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    # 3,600,000 + 4,880,000 + 2,460,000 = 10,940,000; 300 + 400 + 200 = 900.00 USD
    - { account: "411001", book: -10940000, parallel: -90000 }
  open_items:
    - { item: MS-12, account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 4880000, parallel: 40000 }
    - { item: INV-2026-67, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
    - { item: INV-2026-68, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 20000, book: 2460000, parallel: 20000 }
```

### SYP books only

One ledger: the USD milestone done before its invoice is measured at the bulletin of each date, and the book residual is a realised gain, as at Vertex Media; no parallel amount anywhere.

```yaml
case: SYP books only; a 400.00 USD milestone done on 1 Dec at 122 and invoiced on 3 Dec at 123; a 400.00 SYP realised gain
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
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
expect:
  entries:
    - source: milestone.done
      date: 2026-12-01
      lines:
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 4880000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -40000, book: -4880000 }
    - source: invoice.issued
      date: 2026-12-03
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 4920000 }
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: -40000, book: -4880000 }
        - { account: "421001", currency: SYP, amount: -40000, book: -40000 }
  balances:
    - { account: "411001", book: -4880000 }
    - { account: "421001", book: -40000 }
  open_items:
    - { item: MS-2, account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0 }
```

### USD books with an SYP parallel ledger: a USD milestone done before its invoice

The USD books take the USD amounts as is. The SYP parallel ledger measures the done at the market rate of 1 December, 122.5, and the invoice at Hub's 124, which it accepts for the invoice's own date; the parallel residual is a realised gain.

```yaml
case: USD books; a 400.00 USD milestone done on 1 Dec at the market 122.5 and invoiced on 3 Dec at Hub's 124; a 600.00 SYP parallel gain
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "122.5000", type: market }
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
expect:
  entries:
    - source: milestone.done
      date: 2026-12-01
      lines:
        # parallel: 400.00 USD × 122.5 (market of done_on) = 49,000.00 SYP
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 40000, parallel: 4900000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -40000, book: -40000, parallel: -4900000 }
    - source: invoice.issued
      date: 2026-12-03
      lines:
        # parallel: 400.00 USD × 124 (Hub's rate, accepted) = 49,600.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 40000, parallel: 4960000 }
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: -40000, book: -40000, parallel: -4900000 }
        # parallel residual: 4,960,000 − 4,900,000 = 60,000 → a realised gain of 600.00 SYP; book: none
        - { account: "421001", currency: SYP, amount: -60000, book: 0, parallel: -60000 }
  balances:
    - { account: "411001", book: -40000, parallel: -4900000 }
    - { account: "421001", book: 0, parallel: -60000 }
  open_items:
    - { item: MS-2, account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### USD books with an SYP parallel ledger: an SYP deposit and an SYP milestone

The SYP parallel ledger takes the SYP amounts as is; the USD books divide by the bulletin, never by Hub's rate. The deposit MS-1, invoiced at 124, is released at its done at the 300.00 USD it carries. MS-2 is done on 1 December at 122 and invoiced on 3 December at 124: the pound weakened between them, so the book residual is a realised loss.

```yaml
case: USD books; a 37,200.00 SYP deposit invoiced at 124 and released at its carried 300.00 USD; a 48,800.00 SYP milestone done at 122 and invoiced at 124; a 6.45 USD book loss
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-69, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: SYP, syp_per_usd: "125.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 3720000, source: deposit, milestone: MS-1, service: S1 }] }
  - event: milestone.done
    accounting_date: 2026-11-20
    payload: { milestone: MS-1, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: SYP, amount: 3720000, done_on: 2026-11-20, service: S1 }
  - event: milestone.done
    accounting_date: 2026-12-01
    payload: { milestone: MS-2, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: SYP, amount: 4880000, done_on: 2026-12-01, service: S1 }
  - event: invoice.issued
    accounting_date: 2026-12-03
    payload: { invoice: INV-2026-70, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: SYP, syp_per_usd: "125.0000", issued_on: 2026-12-03, due_on: 2026-12-18,
               lines: [{ line: L1, amount: 4880000, source: milestone, milestone: MS-2, service: S1 }] }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # 37,200.00 SYP / 124 = 300.00 USD
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 3720000, book: 30000, parallel: 3720000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -3720000, book: -30000, parallel: -3720000 }
    - source: milestone.done
      date: 2026-11-20
      lines:
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 3720000, book: 30000, parallel: 3720000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: SYP, amount: -3720000, book: -30000, parallel: -3720000 }
    - source: milestone.done
      date: 2026-12-01
      lines:
        # 48,800.00 SYP / 122 (bulletin of done_on) = 400.00 USD
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 4880000, book: 40000, parallel: 4880000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: SYP, amount: -4880000, book: -40000, parallel: -4880000 }
    - source: invoice.issued
      date: 2026-12-03
      lines:
        # 48,800.00 SYP / 124 = 393.548… USD → 393.55
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 4880000, book: 39355, parallel: 4880000 }
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -4880000, book: -40000, parallel: -4880000 }
        # book residual: 39,355 − 40,000 = −645 → a realised loss of 6.45 USD; parallel: none
        - { account: "541001", currency: USD, amount: 645, book: 645, parallel: 0 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -70000, parallel: -8600000 }
    - { account: "541001", book: 645, parallel: 0 }
  open_items:
    - { item: MS-2, account: "113001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 0, book: 0, parallel: 0 }
    - { item: INV-2026-70, account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 4880000, book: 39355, parallel: 4880000 }
```

Each posted entry balances in both ledgers:
- **Deferrals, releases, reopens and the completion** carry one amount to both sides, so they balance as the deferral does.
- **Dones before their invoices** are one measurement on both sides.
- **USD invoice clearing an item, `syp-usd`:** book 4,920,000 − 4,880,000 − 40,000 = 0 (and 4,920,000 − 4,960,000 + 40,000 = 0 after the second done); parallel 40,000 − 40,000 = 0.
- **SYP invoice clearing an item, `syp-usd`:** book 4,880,000 − 4,880,000 = 0; parallel 39,040 − 40,000 + 960 = 0.
- **SYP books only:** 4,920,000 − 4,880,000 − 40,000 = 0.
- **USD books, USD invoice:** book 40,000 − 40,000 = 0; parallel 4,960,000 − 4,900,000 − 60,000 = 0.
- **USD books, SYP invoice:** book 39,355 − 40,000 + 645 = 0; parallel 4,880,000 − 4,880,000 = 0.
