# Cancelled project

Status: Proposed

S06 wrote these cases (S06 "Scenarios"); the owner approved their expected entries and outcomes on 2026-11-10, with three readings of S06 rule 15 (the refund payable carries the client and the project; one refund line for the rest of the remainder, measured once, with a liability and a revenue line per schedule; the accountant's split as the `split` step) and two answers: a cancellation with a remainder and no policy rate of its date is held `RATE_MISSING` before `NEEDS_DECISION`, as S06 rule 18 orders the holds, since the decision screen shows the refund's measurement; and the void of an invoice whose schedule the split cleared is held `NEEDS_DECISION` (`schedule_split_at_cancellation`) for a manual entry, since reversing the invoice's entry alone would leave the liability below zero. After the accounting review the owner answered two more on the same day: a deposit or milestone invoice issued after its project's cancellation, its milestone not done, is held `NEEDS_DECISION` (`invoiced_after_cancellation`) and split with the same action, all at the invoice's rates; and a void of an invoice with a deposit or milestone line is in its project's order, so it waits behind a held cancellation. The eleventh and twelfth cases follow those answers, and the owner approved their numbers on 2026-11-11. They stay `Proposed` until S06's feature slice brings their executors: the posting rule of `project.cancelled`, the holds `NEEDS_DECISION` (`cancelled_project_remainder`, `schedule_split_at_cancellation`, `invoiced_after_cancellation`), the inbox action "تقسيم المتبقي" (split the remainder) that the `split` step runs, the order key `project:<id>`, and the holds `RATE_MISSING` and `WAITING_FOR_EARLIER_EVENT` for this event (S06 rules 8, 15–18). `packages/ledger`'s `cancelledProjectRemainder()`, `cancelledProjectSplit()`, `milestoneLineAtIssue()` and `invoicedAfterCancellationSplit()` compute it.

## Rule

When Hub cancels a project, what the project's point-in-time schedules still hold in contract liabilities (deposits and milestones invoiced and never reported done) is the accountant's to split. With nothing remaining, `project.cancelled` is recorded with no entry, and contract assets of milestones done before their invoices stay for those invoices. Otherwise the event is held `NEEDS_DECISION` (`cancelled_project_remainder`) with the remainder per schedule shown, and the accountant splits it: a transaction amount, from zero to the whole remainder, to service revenue, and the rest to a refund payable to the client. One entry dated on the cancellation's date: each schedule's liability is debited at the amounts it carries; the revenue part is credited at its carried share, cut across the schedules with cumulative rounding by transaction amount; the refund payable is a new measurement at each ledger's policy rate of the cancellation's date; each ledger's residual is a realised exchange difference. A later void of an invoice whose schedule the split cleared is held `NEEDS_DECISION` (`schedule_split_at_cancellation`) for the accountant's manual entry; a void received while the cancellation is held waits behind it, in the project's order. A deposit or milestone invoiced after the cancellation, its milestone not done, is held `NEEDS_DECISION` (`invoiced_after_cancellation`) and split the same way, every part measured anew at the invoice's rates.

## Basis

- **IFRS 15.B21 and 15.106 (by analogy):** consideration received or invoiced that the entity expects to refund is not revenue but a liability, measured at what is expected to be refunded. The part the client is not to get back is revenue now, since nothing is left to deliver (IFRS 15.B46 by analogy, consideration that is non-refundable).
- **IAS 21.16, 21.23(b) and IFRIC 22:** the contract liability is non-monetary, so it is cleared at the amounts it carries, and the revenue it becomes takes its carried share; no rate is read for it. **IAS 21.16, 21.23(a):** the refund payable is a monetary liability, recognised at the spot rate of the cancellation's date (each ledger's policy rate in force then, IAS 21.21–22) and revalued at month end by S07. **IAS 21.28 and ADR 0013:** the gap between the carried liability and the new refund measurement is a realised exchange difference, to the gain or loss account by its sign.
- **ADR 0007 "Allocation":** the revenue part is cut across the schedules with cumulative rounding by transaction amount; each schedule's book and parallel share is its carried amounts in proportion to the transaction share.
- **Company policy:** `phase-1-scope.md` §4 (the book ledger at the bulletin, the USD parallel ledger at market or the transaction's own rate) and §6 ("Cancelled project: the remainder goes to the accountant's decision list"); S06 rules 15–18 and "Currencies, rates and rounding" (owner, 2026-11-10); ADR 0015 ("Late parts and cancelled remainders are the accountant's").
- **Hub's side** (read on 2026-11-10, Hub F05 rule 7 and M2, F13 edge case 11): a project has one currency, that of every installment; a cancelled project's paid deposit invoice stays, and the refund is recorded outside the system. Mizan clears the refund payable by a manual entry when the money is paid back (S06 "Out of scope").
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting. No tax rule is applied.

## Cases

The account codes are the service-agency template's (S02): trade receivables `112001` (a `document` control account, client), contract assets `113001` (a `document` control account, monetary, client and contract), other payables `211003` (monetary; the `cancelled_project_refund` slot's default), contract liabilities `212001` (client and contract, not monetary), service revenue `411001` (client and service; the contract when the invoice names one), realised exchange gains `421001` and losses `541001`. The slots `contract_liability`, `contract_asset`, `released_revenue` and `cancelled_project_refund` take their template defaults (S06 "Data"). The refund line carries the client and the project, so the manual entry that pays the refund back and the client's statement find it. Every rate and amount is synthetic. 3 November and 1, 10 and 15 December 2026 are publication days; 20 November 2026 is a Friday, a day without a bulletin, and no case reads a rate on it.

The payloads use the short form of `revenue/milestones.md`: the project is the invoice's `contract` and the events' `project`, `{ code, kind: project, client }`; `project.cancelled` is `{ project, client, on }`. The step `split: { step: <n>, revenue: <minor units> }` is the accountant's action on the held cancellation of step *n*, with its written reason: `revenue` is the transaction amount to revenue, in the project's currency, and the rest of the remainder goes to the refund payable. Its entry has the event as its source, `project.cancelled`, dated on its `on`. A step whose answer is `recorded` (no entry) completes like a posted one.

The cases leave out what other scenarios own or what cannot occur: a cancellation dated in a closed month is held `PERIOD_CLOSED` like any event (`inbox/post-in-next-open-period.md`, S05 rule 8); `third` cannot occur, since Hub invoices only in SYP and USD; a project's remainder is in one currency, since a Hub project has one (Hub F05 M2). A replayed event and a second split post nothing new: property tests, since a step carries no event ID. Paying the refund back is an ordinary manual entry on `211003` (`receivables/manual-settlement.md`).

### Vertex Media: a deposit's remainder split between revenue and the refund payable

S06's example and acceptance step 5. The deposit MS-1 (300.00 USD) is invoiced on 3 November at the bulletin of 120 and never reported done. The project is cancelled on 10 December, when the bulletin is 124, and held for the accountant, who decides that 100.00 USD of it is earned and 200.00 USD is to be refunded.

```yaml
case: a 300.00 USD deposit invoiced at 120, the project cancelled on 10 Dec at 124; 100.00 to revenue at its carried 12,000.00 SYP, 200.00 to the refund payable at 24,800.00 SYP; an 800.00 SYP realised loss
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-80, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 30000, source: deposit, milestone: MS-1, service: S1 }] }
  - event: project.cancelled
    accounting_date: 2026-12-10
    payload: { project: { code: P1, kind: project, client: C1 }, client: C1, on: 2026-12-10 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: cancelled_project_remainder }
  - split: { step: 2, revenue: 10000 }
    reason: "العمل المنجز قبل الإلغاء يعادل ثلث الدفعة"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # 300.00 USD × 120 (bulletin; Hub's 122 is not read by the book ledger) = 36,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: project.cancelled
      date: 2026-12-10
      lines:
        # the schedule's liability cleared at what it carries
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        # revenue part, carried share: 3,600,000 × 10,000 ÷ 30,000 = 1,200,000
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
        # refund payable, a new measurement: 200.00 USD × 124 (bulletin of 10 Dec) = 24,800.00 SYP
        - { account: "211003", dims: { client: C1, contract: P1 }, currency: USD, amount: -20000, book: -2480000, parallel: -20000 }
        # book residual: 3,600,000 − 1,200,000 − 2,480,000 = −80,000 → a realised loss of 800.00 SYP; parallel: none
        - { account: "541001", currency: SYP, amount: 80000, book: 80000, parallel: 0 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -1200000, parallel: -10000 }
    - { account: "211003", book: -2480000, parallel: -20000 }
    - { account: "541001", book: 80000, parallel: 0 }
  open_items:
    - { item: INV-2026-80, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
```

### Vertex Media: no bulletin on the cancellation's date, and the split refused until it is valid

The cancellation of 10 December arrives before that day's bulletin is recorded. Its remainder may go to the refund payable, a new measurement at the rate of 10 December, so the event is held `RATE_MISSING` first (S06 rule 18), and a split is refused while it is: the action is for `NEEDS_DECISION` `cancelled_project_remainder` only (S06 rule 16). Once the bulletin is recorded, the retry holds it for the accountant; a split of more than the remainder is refused; a valid split posts the entry of the first case.

```yaml
case: a cancellation held RATE_MISSING on 10 Dec, a split refused while it is; the bulletin of 124 recorded, it is held NEEDS_DECISION; a split above the 300.00 USD remainder refused; 100.00 to revenue posts the first case's entry
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-81, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 30000, source: deposit, milestone: MS-1, service: S1 }] }
  - event: project.cancelled
    accounting_date: 2026-12-10
    payload: { project: { code: P1, kind: project, client: C1 }, client: C1, on: 2026-12-10 }
    outcome: { status: held, reason: RATE_MISSING }
  - split: { step: 2, revenue: 10000 }
    reason: "العمل المنجز قبل الإلغاء يعادل ثلث الدفعة"
    outcome: { status: refused, reason: EVENT_ACTION_NOT_ALLOWED }
  - rate: { date: 2026-12-10, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
  - retry: 2
    outcome: { status: held, reason: NEEDS_DECISION, detail: cancelled_project_remainder }
  - split: { step: 2, revenue: 30001 }
    reason: "خطأ في المبلغ"
    outcome: { status: refused, reason: VALIDATION_FAILED }
  - split: { step: 2, revenue: 10000 }
    reason: "العمل المنجز قبل الإلغاء يعادل ثلث الدفعة"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: project.cancelled
      date: 2026-12-10
      lines:
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
        - { account: "211003", dims: { client: C1, contract: P1 }, currency: USD, amount: -20000, book: -2480000, parallel: -20000 }
        - { account: "541001", currency: SYP, amount: 80000, book: 80000, parallel: 0 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "211003", book: -2480000, parallel: -20000 }
```

### Vertex Media: a cancellation received behind its project's held invoice

The deposit's invoice of 3 November arrives before that day's bulletin and is held `RATE_MISSING`. The cancellation of 10 December is in the project's order (`project:<id>`, S06 rule 17) and waits behind it. Once the bulletin of 3 November is recorded, the invoice posts and the cancellation, retried after it, is held for the accountant, who splits the remainder in halves.

```yaml
case: a deposit's invoice held RATE_MISSING; the cancellation waits behind it; the bulletin of 120 recorded, the invoice posts and the cancellation is held; 150.00 to revenue at 18,000.00 SYP, 150.00 refunded at 124; a 600.00 SYP realised loss
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-82, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 30000, source: deposit, milestone: MS-1, service: S1 }] }
    outcome: { status: held, reason: RATE_MISSING }
  - event: project.cancelled
    accounting_date: 2026-12-10
    payload: { project: { code: P1, kind: project, client: C1 }, client: C1, on: 2026-12-10 }
    outcome: { status: held, reason: WAITING_FOR_EARLIER_EVENT }
  - rate: { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - retry: 2
    outcome: { status: held, reason: NEEDS_DECISION, detail: cancelled_project_remainder }
  - split: { step: 2, revenue: 15000 }
    reason: "نصف الدفعة مستحق عن العمل المنجز"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: project.cancelled
      date: 2026-12-10
      lines:
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        # 3,600,000 × 15,000 ÷ 30,000 = 1,800,000
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -15000, book: -1800000, parallel: -15000 }
        # 150.00 USD × 124 = 18,600.00 SYP
        - { account: "211003", dims: { client: C1, contract: P1 }, currency: USD, amount: -15000, book: -1860000, parallel: -15000 }
        # book residual: 3,600,000 − 1,800,000 − 1,860,000 = −60,000 → a realised loss of 600.00 SYP
        - { account: "541001", currency: SYP, amount: 60000, book: 60000, parallel: 0 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -1800000, parallel: -15000 }
    - { account: "211003", book: -1860000, parallel: -15000 }
    - { account: "541001", book: 60000, parallel: 0 }
```

### Vertex Media: two schedules, the revenue part cut with cumulative rounding

The deposit MS-1 (70.00 USD, service S1) is invoiced on 3 November at 120 and the milestone MS-2 (230.00 USD, service S2) on 1 December at 122.5; neither is done. The project is cancelled on 10 December at 124 and the accountant puts 100.00 USD of the 300.00 remaining to revenue. The revenue part is cut across the schedules in the order they were created, by their remaining transaction amounts with cumulative rounding; each schedule's book share is its carried amount in proportion; the refund is one line for the rest of the remainder, measured once.

```yaml
case: two schedules (70.00 USD at 120, 230.00 USD at 122.5) cancelled on 10 Dec at 124; 100.00 to revenue cut 23.33 and 76.67; 200.00 refunded at 24,800.00 SYP; a 416.68 SYP realised loss
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "122.5000", type: bulletin }
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-83, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 7000, source: deposit, milestone: MS-1, service: S1 }] }
  - event: invoice.issued
    accounting_date: 2026-12-01
    payload: { invoice: INV-2026-84, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "123.0000", issued_on: 2026-12-01, due_on: 2026-12-16,
               lines: [{ line: L1, amount: 23000, source: milestone, milestone: MS-2, service: S2 }] }
  - event: project.cancelled
    accounting_date: 2026-12-10
    payload: { project: { code: P1, kind: project, client: C1 }, client: C1, on: 2026-12-10 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: cancelled_project_remainder }
  - split: { step: 3, revenue: 10000 }
    reason: "ثلث المتبقي مستحق عن العمل المنجز"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # 70.00 USD × 120 = 8,400.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 7000, book: 840000, parallel: 7000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -7000, book: -840000, parallel: -7000 }
    - source: invoice.issued
      date: 2026-12-01
      lines:
        # 230.00 USD × 122.5 = 28,175.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 23000, book: 2817500, parallel: 23000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -23000, book: -2817500, parallel: -23000 }
    - source: project.cancelled
      date: 2026-12-10
      lines:
        # each schedule's liability at what it carries
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 7000, book: 840000, parallel: 7000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 23000, book: 2817500, parallel: 23000 }
        # revenue 10,000 cut by 7,000 and 23,000: round(10,000 × 7,000 ÷ 30,000) = round(2,333.33) = 2,333;
        #   then round(10,000 × 30,000 ÷ 30,000) − 2,333 = 7,667
        # MS-1's carried share: 840,000 × 2,333 ÷ 7,000 = 279,960
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -2333, book: -279960, parallel: -2333 }
        # MS-2's carried share: 2,817,500 × 7,667 ÷ 23,000 = 939,207.5 → 939,208 (half away from zero)
        - { account: "411001", dims: { client: C1, contract: P1, service: S2 }, currency: USD, amount: -7667, book: -939208, parallel: -7667 }
        # refund: 30,000 − 10,000 = 20,000 → 200.00 USD × 124 = 24,800.00 SYP, one new measurement
        - { account: "211003", dims: { client: C1, contract: P1 }, currency: USD, amount: -20000, book: -2480000, parallel: -20000 }
        # book residual: 840,000 + 2,817,500 − 279,960 − 939,208 − 2,480,000 = −41,668 → a realised loss of 416.68 SYP
        - { account: "541001", currency: SYP, amount: 41668, book: 41668, parallel: 0 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    # 279,960 + 939,208 = 1,219,168; 23.33 + 76.67 = 100.00 USD
    - { account: "411001", book: -1219168, parallel: -10000 }
    - { account: "211003", book: -2480000, parallel: -20000 }
    - { account: "541001", book: 41668, parallel: 0 }
```

### Vertex Media: the whole remainder to revenue

S06 edge case 15. Two schedules, the deposit MS-1 (300.00 USD, S1) at 120 and the milestone MS-2 (500.00 USD, S2) at 122; the accountant puts the whole 800.00 USD to revenue. Every line is carried, so the entry balances in each ledger by itself and has no residual line.

```yaml
case: two schedules (300.00 USD at 120, 500.00 USD at 122) cancelled on 10 Dec; all 800.00 to revenue at the carried 97,000.00 SYP; no refund and no residual
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-85, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 30000, source: deposit, milestone: MS-1, service: S1 }] }
  - event: invoice.issued
    accounting_date: 2026-12-01
    payload: { invoice: INV-2026-86, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "123.0000", issued_on: 2026-12-01, due_on: 2026-12-16,
               lines: [{ line: L1, amount: 50000, source: milestone, milestone: MS-2, service: S2 }] }
  - event: project.cancelled
    accounting_date: 2026-12-10
    payload: { project: { code: P1, kind: project, client: C1 }, client: C1, on: 2026-12-10 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: cancelled_project_remainder }
  - split: { step: 3, revenue: 80000 }
    reason: "لا استرداد: العقد ينص على عدم رد الدفعات"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: invoice.issued
      date: 2026-12-01
      lines:
        # 500.00 USD × 122 = 61,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 50000, book: 6100000, parallel: 50000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -50000, book: -6100000, parallel: -50000 }
    - source: project.cancelled
      date: 2026-12-10
      lines:
        # all of each schedule to revenue at what it carries; the bulletin of 10 Dec is not used
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 50000, book: 6100000, parallel: 50000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S2 }, currency: USD, amount: -50000, book: -6100000, parallel: -50000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -9700000, parallel: -80000 }
    - { account: "211003", book: 0, parallel: 0 }
```

### Vertex Media: an SYP deposit refunded whole

S06 edge case 15. The SYP deposit MS-1 (36,000.00 SYP) is invoiced on 3 November; the SYP books take it as is and the USD parallel ledger at Hub's 120, which it accepts for the invoice's own date (300.00 USD). The accountant refunds all of it. The refund payable is a new measurement: SYP as is in the books, and the market rate of 10 December, 125, in the parallel ledger, since `project.cancelled` carries no rate of Hub's. The pound weakened, so the payable is worth fewer dollars than the liability carried: a parallel realised gain.

```yaml
case: a 36,000.00 SYP deposit invoiced at Hub's 120 (300.00 USD parallel), refunded whole on 10 Dec; the payable at the market 125 (288.00 USD); a 12.00 USD parallel realised gain
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "125.0000", type: market }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-87, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: SYP, syp_per_usd: "120.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 3600000, source: deposit, milestone: MS-1, service: S1 }] }
  - event: project.cancelled
    accounting_date: 2026-12-10
    payload: { project: { code: P1, kind: project, client: C1 }, client: C1, on: 2026-12-10 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: cancelled_project_remainder }
  - split: { step: 2, revenue: 0 }
    reason: "لم يبدأ العمل؛ تُرد الدفعة كاملة"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # parallel: 36,000.00 SYP ÷ 120 (Hub's rate) = 300.00 USD
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 3600000, book: 3600000, parallel: 30000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -3600000, book: -3600000, parallel: -30000 }
    - source: project.cancelled
      date: 2026-12-10
      lines:
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 3600000, book: 3600000, parallel: 30000 }
        # refund payable: SYP as is; parallel 36,000.00 SYP ÷ 125 (market of 10 Dec) = 288.00 USD
        - { account: "211003", dims: { client: C1, contract: P1 }, currency: SYP, amount: -3600000, book: -3600000, parallel: -28800 }
        # parallel residual: 30,000 − 28,800 = 1,200 → a realised gain of 12.00 USD; book: none
        - { account: "421001", currency: USD, amount: -1200, book: 0, parallel: -1200 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: 0, parallel: 0 }
    - { account: "211003", book: -3600000, parallel: -28800 }
    - { account: "421001", book: 0, parallel: -1200 }
```

### Vertex Media: nothing remaining; a done milestone's contract asset stays for its invoice

S06 edge case 14. The deposit MS-1 is invoiced and released at its done; the milestone MS-2 (400.00 USD) is done on 1 December before its invoice, a contract asset at 122. The cancellation on 10 December finds nothing in contract liabilities: it is recorded with no entry and reads no rate (no bulletin of 10 December is recorded). Hub keeps billing open on a cancelled project (Hub F05 M3), so MS-2's invoice on 15 December, at 125, clears the item as `revenue/milestones.md` does.

```yaml
case: a deposit released at its done and a milestone done before its invoice; project.cancelled is recorded with no entry and no rate read; the milestone's invoice on 15 Dec at 125 clears its item; a 1,200.00 SYP realised gain
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-12-15, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-88, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 30000, source: deposit, milestone: MS-1, service: S1 }] }
  - event: milestone.done
    accounting_date: 2026-11-20
    payload: { milestone: MS-1, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: USD, amount: 30000, done_on: 2026-11-20, service: S1 }
  - event: milestone.done
    accounting_date: 2026-12-01
    payload: { milestone: MS-2, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: USD, amount: 40000, done_on: 2026-12-01, service: S1 }
  - event: project.cancelled
    accounting_date: 2026-12-10
    payload: { project: { code: P1, kind: project, client: C1 }, client: C1, on: 2026-12-10 }
  - event: invoice.issued
    accounting_date: 2026-12-15
    payload: { invoice: INV-2026-89, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "126.0000", issued_on: 2026-12-15, due_on: 2026-12-30,
               lines: [{ line: L1, amount: 40000, source: milestone, milestone: MS-2, service: S1 }] }
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
        # 400.00 USD × 122 = 48,800.00 SYP
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 4880000, parallel: 40000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -40000, book: -4880000, parallel: -40000 }
    - source: invoice.issued
      date: 2026-12-15
      lines:
        # 400.00 USD × 125 = 50,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 5000000, parallel: 40000 }
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: -40000, book: -4880000, parallel: -40000 }
        # book residual: 5,000,000 − 4,880,000 = 120,000 → a realised gain of 1,200.00 SYP
        - { account: "421001", currency: SYP, amount: -120000, book: -120000, parallel: 0 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "211003", book: 0, parallel: 0 }
    # 3,600,000 + 4,880,000 = 8,480,000; 300 + 400 = 700.00 USD
    - { account: "411001", book: -8480000, parallel: -70000 }
    - { account: "421001", book: -120000, parallel: 0 }
  open_items:
    - { item: MS-2, account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: INV-2026-89, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 40000, book: 5000000, parallel: 40000 }
```

### Vertex Media: the void of a deposit's invoice after its project's split

The owner's answer of 2026-11-10. The deposit's invoice is not paid, so Hub can still void it (Hub F13: a void needs no payments). The split cleared its schedule into revenue and the refund payable; the exact reversal of the invoice's entry alone would debit the receivable away and leave `212001` at −300.00 USD with the revenue and the payable standing. The void is held for the accountant, who resolves it by a manual entry (S05 rule 15).

```yaml
case: a deposit's remainder split 100.00 to revenue and 200.00 to the refund payable; the void of its unpaid invoice on 15 Dec is held NEEDS_DECISION schedule_split_at_cancellation; nothing is reversed
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
  - { date: 2026-12-15, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-92, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 30000, source: deposit, milestone: MS-1, service: S1 }] }
  - event: project.cancelled
    accounting_date: 2026-12-10
    payload: { project: { code: P1, kind: project, client: C1 }, client: C1, on: 2026-12-10 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: cancelled_project_remainder }
  - split: { step: 2, revenue: 10000 }
    reason: "العمل المنجز قبل الإلغاء يعادل ثلث الدفعة"
  - event: invoice.voided
    accounting_date: 2026-12-15
    payload: { invoice: INV-2026-92, voided_on: 2026-12-15, reason: "أُلغيت الفاتورة في Hub" }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: project.cancelled
      date: 2026-12-10
      lines:
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -10000, book: -1200000, parallel: -10000 }
        - { account: "211003", dims: { client: C1, contract: P1 }, currency: USD, amount: -20000, book: -2480000, parallel: -20000 }
        - { account: "541001", currency: SYP, amount: 80000, book: 80000, parallel: 0 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "211003", book: -2480000, parallel: -20000 }
  open_items:
    - { item: INV-2026-92, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
  outcome: { status: held, reason: NEEDS_DECISION, detail: schedule_split_at_cancellation }
```

### Vertex Media: a deposit invoiced after its project's cancellation

The owner's answer of 2026-11-10 to the accounting review. Hub keeps billing open on a cancelled project (Hub F05 M3) and issues the deposit's draft on 15 December, after the cancellation of 10 December found nothing to split and was recorded. Nothing is left to deliver, so a deferral would never be released: the invoice is held `NEEDS_DECISION` (`invoiced_after_cancellation`), and the accountant splits it with the same action. Its one entry, dated on its issue date, measures the receivable, the revenue part and the refund payable anew at that day's bulletin, 125, so no difference arises.

```yaml
case: a project cancelled with nothing invoiced is recorded; its 300.00 USD deposit invoiced on 15 Dec at 125 is held NEEDS_DECISION invoiced_after_cancellation; split 100.00 to revenue and 200.00 to the refund payable, all at 125
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-12-15, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - event: project.cancelled
    accounting_date: 2026-12-10
    payload: { project: { code: P1, kind: project, client: C1 }, client: C1, on: 2026-12-10 }
  - event: invoice.issued
    accounting_date: 2026-12-15
    payload: { invoice: INV-2026-93, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "126.0000", issued_on: 2026-12-15, due_on: 2026-12-30,
               lines: [{ line: L1, amount: 30000, source: deposit, milestone: MS-1, service: S1 }] }
    outcome: { status: held, reason: NEEDS_DECISION, detail: invoiced_after_cancellation }
  - split: { step: 2, revenue: 10000 }
    reason: "رسوم إلغاء متفق عليها؛ يُرد الباقي"
expect:
  entries:
    - source: invoice.issued
      date: 2026-12-15
      lines:
        # 300.00 USD × 125 = 37,500.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3750000, parallel: 30000 }
        # 100.00 USD × 125 = 12,500.00 SYP, a new measurement like the receivable
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -10000, book: -1250000, parallel: -10000 }
        # 200.00 USD × 125 = 25,000.00 SYP
        - { account: "211003", dims: { client: C1, contract: P1 }, currency: USD, amount: -20000, book: -2500000, parallel: -20000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -1250000, parallel: -10000 }
    - { account: "211003", book: -2500000, parallel: -20000 }
  open_items:
    - { item: INV-2026-93, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3750000, parallel: 30000 }
```

### Vertex Media: a void received while the cancellation waits for the split

The owner's answer of 2026-11-10 to the accounting review. The cancellation of 10 December is held for the accountant with the remainder of the fourth case, 300.00 USD over MS-1 and MS-2. Hub voids MS-2's unpaid invoice on 14 December, before the split. A void of an invoice with a deposit or milestone line is in its project's order (`project:<id>`, S06 rule 17), so it waits behind the held cancellation instead of changing the remainder the accountant is deciding on. The split posts the fourth case's entry; the void, retried after it, finds its schedule cleared by the split and is held `NEEDS_DECISION` (`schedule_split_at_cancellation`), as in the eighth case.

```yaml
case: a cancellation held for the split; the void of MS-2's invoice on 14 Dec waits behind it; the split posts the fourth case's entry; the void is then held NEEDS_DECISION schedule_split_at_cancellation
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "122.5000", type: bulletin }
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-94, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 7000, source: deposit, milestone: MS-1, service: S1 }] }
  - event: invoice.issued
    accounting_date: 2026-12-01
    payload: { invoice: INV-2026-95, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "123.0000", issued_on: 2026-12-01, due_on: 2026-12-16,
               lines: [{ line: L1, amount: 23000, source: milestone, milestone: MS-2, service: S2 }] }
  - event: project.cancelled
    accounting_date: 2026-12-10
    payload: { project: { code: P1, kind: project, client: C1 }, client: C1, on: 2026-12-10 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: cancelled_project_remainder }
  - event: invoice.voided
    accounting_date: 2026-12-14
    payload: { invoice: INV-2026-95, voided_on: 2026-12-14, reason: "أُلغيت الفاتورة في Hub" }
    outcome: { status: held, reason: WAITING_FOR_EARLIER_EVENT }
  - split: { step: 3, revenue: 10000 }
    reason: "ثلث المتبقي مستحق عن العمل المنجز"
  - retry: 4
    outcome: { status: held, reason: NEEDS_DECISION, detail: schedule_split_at_cancellation }
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 7000, book: 840000, parallel: 7000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -7000, book: -840000, parallel: -7000 }
    - source: invoice.issued
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 23000, book: 2817500, parallel: 23000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -23000, book: -2817500, parallel: -23000 }
    - source: project.cancelled
      date: 2026-12-10
      lines:
        # the fourth case's entry: nothing the void did changed the remainder before the split
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 7000, book: 840000, parallel: 7000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 23000, book: 2817500, parallel: 23000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -2333, book: -279960, parallel: -2333 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S2 }, currency: USD, amount: -7667, book: -939208, parallel: -7667 }
        - { account: "211003", dims: { client: C1, contract: P1 }, currency: USD, amount: -20000, book: -2480000, parallel: -20000 }
        - { account: "541001", currency: SYP, amount: 41668, book: 41668, parallel: 0 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
  open_items:
    - { item: INV-2026-95, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 23000, book: 2817500, parallel: 23000 }
```

### SYP books only

One ledger: the first case's deposit and split, with no parallel amount anywhere. The book residual is the same 800.00 SYP loss.

```yaml
case: SYP books only; a 300.00 USD deposit invoiced at 120, cancelled on 10 Dec at 124; 100.00 to revenue, 200.00 refunded; an 800.00 SYP realised loss
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-90, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 30000, source: deposit, milestone: MS-1, service: S1 }] }
  - event: project.cancelled
    accounting_date: 2026-12-10
    payload: { project: { code: P1, kind: project, client: C1 }, client: C1, on: 2026-12-10 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: cancelled_project_remainder }
  - split: { step: 2, revenue: 10000 }
    reason: "العمل المنجز قبل الإلغاء يعادل ثلث الدفعة"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -30000, book: -3600000 }
    - source: project.cancelled
      date: 2026-12-10
      lines:
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3600000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -10000, book: -1200000 }
        - { account: "211003", dims: { client: C1, contract: P1 }, currency: USD, amount: -20000, book: -2480000 }
        - { account: "541001", currency: SYP, amount: 80000, book: 80000 }
  balances:
    - { account: "212001", book: 0 }
    - { account: "411001", book: -1200000 }
    - { account: "211003", book: -2480000 }
    - { account: "541001", book: 80000 }
```

### USD books with an SYP parallel ledger: an SYP deposit split

The SYP parallel ledger takes the SYP amounts as is; the USD books divide by the bulletin, never by Hub's rate. The deposit (37,200.00 SYP) is invoiced at 124 (300.00 USD). On 10 December the bulletin is 120: the refund payable of 24,800.00 SYP is worth more dollars than the liability's share carried, so the book residual is a realised loss.

```yaml
case: USD books; a 37,200.00 SYP deposit invoiced at 124 (300.00 USD), cancelled on 10 Dec at 120; 12,400.00 SYP to revenue at its carried 100.00 USD, 24,800.00 SYP refunded at 206.67 USD; a 6.67 USD book loss
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-03
    payload: { invoice: INV-2026-91, client: C1, contract: { code: P1, kind: project, client: C1 },
               currency: SYP, syp_per_usd: "125.0000", issued_on: 2026-11-03, due_on: 2026-11-18,
               lines: [{ line: L1, amount: 3720000, source: deposit, milestone: MS-1, service: S1 }] }
  - event: project.cancelled
    accounting_date: 2026-12-10
    payload: { project: { code: P1, kind: project, client: C1 }, client: C1, on: 2026-12-10 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: cancelled_project_remainder }
  - split: { step: 2, revenue: 1240000 }
    reason: "العمل المنجز قبل الإلغاء يعادل ثلث الدفعة"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-03
      lines:
        # 37,200.00 SYP ÷ 124 = 300.00 USD
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 3720000, book: 30000, parallel: 3720000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -3720000, book: -30000, parallel: -3720000 }
    - source: project.cancelled
      date: 2026-12-10
      lines:
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 3720000, book: 30000, parallel: 3720000 }
        # carried share: 30,000 × 1,240,000 ÷ 3,720,000 = 10,000
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: SYP, amount: -1240000, book: -10000, parallel: -1240000 }
        # refund: 24,800.00 SYP ÷ 120 (bulletin of 10 Dec) = 206.666… → 206.67 USD
        - { account: "211003", dims: { client: C1, contract: P1 }, currency: SYP, amount: -2480000, book: -20667, parallel: -2480000 }
        # book residual: 30,000 − 10,000 − 20,667 = −667 → a realised loss of 6.67 USD; parallel: none
        - { account: "541001", currency: USD, amount: 667, book: 667, parallel: 0 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -10000, parallel: -1240000 }
    - { account: "211003", book: -20667, parallel: -2480000 }
    - { account: "541001", book: 667, parallel: 0 }
```

Each posted entry balances in both ledgers:
- **The invoice after the cancellation:** book 3,750,000 − 1,250,000 − 2,500,000 = 0; parallel 30,000 − 10,000 − 20,000 = 0; one rate on every line, so no rounding.
- **Deferrals, releases and the done before its invoice** balance as in `revenue/milestones.md`; the invoice clearing MS-2's item: book 5,000,000 − 4,880,000 − 120,000 = 0, parallel 40,000 − 40,000 = 0.
- **The split, USD deposit at 120, 1:2, bulletin 124** (the first, second, eighth and ninth cases): book 3,600,000 − 1,200,000 − 2,480,000 + 80,000 = 0; parallel 30,000 − 10,000 − 20,000 = 0.
- **The split in halves:** book 3,600,000 − 1,800,000 − 1,860,000 + 60,000 = 0; parallel 30,000 − 15,000 − 15,000 = 0.
- **Two schedules** (the fourth and twelfth cases): book 840,000 + 2,817,500 − 279,960 − 939,208 − 2,480,000 + 41,668 = 0; parallel 7,000 + 23,000 − 2,333 − 7,667 − 20,000 = 0.
- **All to revenue:** book 3,600,000 + 6,100,000 − 3,600,000 − 6,100,000 = 0; parallel 30,000 + 50,000 − 30,000 − 50,000 = 0.
- **SYP deposit refunded whole:** book 3,600,000 − 3,600,000 = 0; parallel 30,000 − 28,800 − 1,200 = 0.
- **USD books, SYP deposit:** book 30,000 − 10,000 − 20,667 + 667 = 0; parallel 3,720,000 − 1,240,000 − 2,480,000 = 0.
