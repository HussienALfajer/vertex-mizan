# Documents before the books start

Status: Approved (owner, 2026-11-12)

S10 wrote these cases (S10 "Scenarios", `opening/before-books-start.md`); the owner approved their expected entries and outcomes on 2026-11-12: five cases, then, after the accounting review, the changed second case and the sixth and seventh, with the treatment they apply: the revenue or cost of the current period reduced for a change in estimate (IAS 8.36), retained earnings for a material error of an earlier fiscal year (IAS 8.42), with the entry's residual on retained earnings too, and the lines other than an item's or a schedule's measured at the day's rate, each ledger's residual otherwise a realised exchange difference. The owner decided the same day how a held void reaches an opening schedule (S10 rule 28): the manual entry that resolves it names the schedule on its contract liability line, as a line names its item, and clears what the schedule still carries; while the void is held, the schedule releases nothing and a credit to its cycle waits behind the void; once the void is dismissed, each ended month it missed is released at once, dated on that month's last day. The cases stay `Proposed` until S10's feature slice brings the executors of the `opening` step, the register of prior documents, the hold `before_books_start` and a manual line naming a schedule, then become `Approved (owner, 2026-11-12)` (`docs/scenarios/README.md`, "Status").

## Rule

Hub's snapshot lists every document dated on or before the eve of the books start in its register of prior documents (S10 rule 5). An event that voids, changes, archives or reopens one of them is held `NEEDS_DECISION` with the detail `before_books_start`, since Mizan holds no posting of it to reverse (S10 rule 28): `invoice.voided` of an invoice the opening carries, `payment.voided` of a payment dated before the books start, `ad_wallet.entry_voided`, `ad_spend.changed` and `ad_spend.archived` of such a wallet entry or spend update, `project_expense.changed` and `project_expense.archived` of such an expense, and `milestone.reopened` of a done dated before the books start. The register finds the document, so the event is not held `UNKNOWN_REFERENCE`; an earlier hold on the same item still holds it first (`WAITING_FOR_EARLIER_EVENT`, S05 rule 11). A retry leaves it held.

The accountant resolves it by a manual entry (S05 rule 15), on the items concerned with a memo (S04 rule 8):
- a line on a Hub item clears it at its carrying amount, every other line is a new measurement at each ledger's policy rate of the entry's date, and each ledger's residual is a realised exchange difference (S04 rules 4 and 10);
- a line on the contract liability account that names an opening schedule (`schedule: <invoice>/<line>`) takes its dimensions and clears what it carries, at its carried amounts, reading no rate; the schedule stops (owner, 2026-11-12). While an `invoice.voided` of the schedule's invoice is held, the schedule releases nothing, and a credit to its cycle waits behind the void (`WAITING_FOR_EARLIER_EVENT`). Once the void is dismissed, or resolved by an entry that leaves the schedule standing, every ended month it did not release is released at once, each dated on its own month's last day, which a held event kept open; the waiting credit is then retried (owner, 2026-11-12);
- in an entry with a line on retained earnings `312001` whose other lines are all an item's or a schedule's, each ledger's residual posts to `312001`, not to an exchange difference, so a correction of an earlier year's error takes exactly what the items it clears carried; such an entry with another newly measured line is refused `VALIDATION_FAILED`, and the correction posts on its own (owner, 2026-11-12);
- what was recognised before the books start is taken back from the current period's revenue or cost when the void is a change in estimate (IAS 8.36), or from retained earnings `312001` when it corrects a material error of an earlier fiscal year (IAS 8.42).

A later event on a document resolved this way is held `NEEDS_DECISION` (`document_resolved_manually`, S05 rule 16); an event on another document of the same invoice posts as usual (S10 rule 30).

An event dated before the books start about a document Hub created after its snapshot (a backdated document) is held `PERIOD_CLOSED`, since the months before the books start are closed (S10 rule 4), and the accountant may post it in the first open period at the rates of its own date (S05 rule 15). A service changed on an opening schedule's line reclassifies only what Mizan released from the books start; what was recognised before it is in equity (S10 rule 29, S06 rule 10).

## Basis

- **IAS 8.32–8.36:** a void, a change or a reopen in Hub after the books start revises an estimate made before it; its effect is recognised prospectively, in the period of the change, in profit or loss. **IAS 8.41–8.42:** a material error of an earlier fiscal year is corrected against the opening balance of retained earnings; phase 1 posts the correction to `312001` on the date it is found, and comparative restatement is out of scope (no comparative year is kept before the books start).
- **IFRS 15.88:** a change in the transaction price after revenue was recognised is recognised as an adjustment to revenue in the period of the change; a void of an invoice whose service was partly recognised before the books start reduces the revenue of the void's period.
- **IAS 21.23(a) and 21.28:** an opening receivable, contract asset or client ad funds balance is monetary, carried at the eve's rates; when the manual entry derecognises it, the gap between its carrying amount and the other lines' measurement at the day's rate is a realised exchange difference, in each ledger separately (as for a write-off, `receivables/write-off.md`). **IAS 21.23(b) and IFRIC 22:** a contract liability is non-monetary, so the schedule's line is cleared at its carried amounts, never remeasured.
- **IAS 21.21–22:** an event posted in the first open period is measured at the rates of its own accounting date, so the move creates no exchange difference (S05 rule 15).
- **Company policy:** `phase-1-scope.md` §4 ("Start of the books") and F10 ("History replay"); S10 rules 4, 5, 27–30 and "Accounting treatment" (owner, 2026-11-12, for voids; extended to every reversal and change); the owner's decision of 2026-11-12 on a manual line naming an opening schedule; S04 rules 2, 4, 8 and 10; S05 rules 8, 11, 15 and 16; S06 rules 5 and 10; ADR 0019.
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting. The calendar fiscal year is CONFIRMED (Income Tax Law 24/2003). No tax rule is applied.

## Cases

The account codes are the service-agency template's (S02), in the version with `312002` (S10 "Data"): the SYP cash on hand `111001`, the USD bank account `111004`, trade receivables `112001` and contract assets `113001` (document control accounts, monetary), ad platforms payable `211001` (client, monetary), project expenses awaiting payment source `211002` (monetary), contract liabilities `212001` (client and contract, non-monetary), client ad funds held `213001` (running, USD only, monetary), capital `311001`, retained earnings `312001`, the result of the year before the books start `312002`, service revenue `411001`, direct project costs `511001` (client, contract and department), realised exchange gains `421001` and losses `541001`. Every rate and amount is synthetic.

The books start is Thursday 1 October 2026 except in the second case (Friday 1 January 2027). Publication days used: 1, 10, 15, 21, 28 and 30 September, 5, 6, 12, 13, 14, 15, 20, 27 and 29 October 2026, 31 December 2026 and 12 January 2027.

**The register** (`prior_documents` in the snapshot, `docs/scenarios/README.md`) lists each document with its date and what a later event needs to find it: a payment's receipt and invoice, a wallet entry's or spend update's client. A void, change, archive or reopen of a listed document is held `before_books_start`; the runner sends a `payment.voided` with the payment's receipt and invoice from the register, and an `ad_wallet.entry_voided` with the entry's client.

**The resolution** is a `manual` step, then a `resolve` step naming the event and the entry. A manual line on a Hub item names it with `item:` and carries a memo; a line naming an opening schedule uses `schedule: <invoice>/<line>` and states no dimensions. The residual lines are posted by the posting function and are not in the payload.

The cases leave out what other scenarios and tests own: the opening entry's own measurement, checks and reversal (`opening/opening-entry.md`); the holds and actions of S05 on documents dated from the books start (`inbox/holds-and-actions.md`); every event type of rule 28 in API tests (`project_expense.changed`, `ad_spend.archived` and a second void of the same document there); the void of an opening invoice whose item a replayed payment has moved, held `OPEN_ITEM_HAS_SETTLEMENTS` first (S05 rule 8, an inbox test); a manual line naming a schedule for another amount than it carries, and an entry with a line on `312001` and another newly measured line, both refused `VALIDATION_FAILED` (API tests of the manual entry); a held void resolved by an entry that names no schedule, which releases the schedule's missed months as the dismissal of the seventh case does (a `packages/db` test of S10's resolve action, against the seventh case's numbers).

### Vertex Media: six holds of rule 28 and their resolutions

The snapshot holds:
- **INV-2026-7** to C1 (retainer R1), 300.00 USD issued on 10 September at the bulletin of 114, unpaid, for the cycle 16 September to 15 October: a receivable and a schedule of 150.00 USD (S10's worked example);
- **INV-2026-5** to C2, 400.00 USD of extra work issued on 10 September, 150.00 USD paid by **PAY-0** on 21 September: a receivable of 250.00 USD;
- **MS-2** of C2's project P2, 400.00 USD, done on 25 September and not invoiced: a contract asset;
- C1's wallet, 350.00 USD held: deposits **W-0** (2 September, 300.00) and **W-1** (12 September, 200.00) less the September spend **CU-0** (150.00);
- the expense **E-0** of P2 (18 September, 80.00 USD), awaiting its payment source in the records (`211002`), and the September spend owed to the platform in the records (`211001`, 150.00 USD).

In October Hub voids W-1 (the transfer was returned), lowers CU-0 to 120.00 USD, voids INV-2026-7 (the client's retainer was cancelled from its start), archives E-0 (charged to P2 in error), voids PAY-0 (the transfer was returned) and reopens MS-2 (the client rejected the delivery). Each is held `before_books_start`, except CU-0's change, which waits behind W-1's void on C1's funds and is held `before_books_start` once that void is resolved. October's release job runs while INV-2026-7's void is held, and releases nothing of its schedule. MS-2's later done is held `document_resolved_manually`.

```yaml
case: six holds before_books_start (a wallet void, a spend change behind it, an invoice void with its schedule, an expense archive, a payment void, a milestone reopen), each resolved by a manual entry; the schedule frozen while its void is held; a later done held document_resolved_manually
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency, books_start: 2026-10-01,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-09-10, base: USD, quote: SYP, rate: "114.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "118.0000", type: market }
  - { date: 2026-10-05, base: USD, quote: SYP, rate: "116.0000", type: bulletin }
  - { date: 2026-10-06, base: USD, quote: SYP, rate: "116.0000", type: bulletin }
  - { date: 2026-10-12, base: USD, quote: SYP, rate: "117.0000", type: bulletin }
  - { date: 2026-10-14, base: USD, quote: SYP, rate: "117.0000", type: bulletin }
  - { date: 2026-10-15, base: USD, quote: SYP, rate: "117.0000", type: bulletin }
  - { date: 2026-10-27, base: USD, quote: SYP, rate: "118.0000", type: bulletin }
  - { date: 2026-10-29, base: USD, quote: SYP, rate: "118.0000", type: bulletin }
steps:
  - opening: Vertex Media's opening with its register of prior documents
    snapshot:
      invoices:
        - { invoice: INV-2026-5, client: C2, currency: USD, syp_per_usd: "117.0000",
            issued_on: 2026-09-10, due_on: 2026-09-30, total: 40000, outstanding: 25000,
            lines: [{ line: L1, amount: 40000, source: extra_work, service: S2 }] }
        - { invoice: INV-2026-7, client: C1, contract: { code: R1, kind: retainer, client: C1 },
            currency: USD, syp_per_usd: "117.0000", issued_on: 2026-09-10, due_on: 2026-09-25,
            total: 30000, outstanding: 30000,
            lines: [{ line: L1, amount: 30000, source: retainer_charge, kind: monthly,
                      cycle_start: 2026-09-16, cycle_end: 2026-10-15, service: S1 }] }
      milestones:
        - { milestone: MS-2, project: { code: P2, kind: project, client: C2 }, client: C2,
            currency: USD, amount: 40000, service: S2, done_on: 2026-09-25 }
      wallets:
        - { client: C1, balance: 35000 }
      prior_documents:
        invoices:
          - { invoice: INV-2026-5, issued_on: 2026-09-10 }
          - { invoice: INV-2026-7, issued_on: 2026-09-10 }
        payments:
          - { payment: PAY-0, receipt: R-2026-0, invoice: INV-2026-5, paid_on: 2026-09-21 }
        wallet_entries:
          - { entry: W-0, client: C1, entered_on: 2026-09-02 }
          - { entry: W-1, client: C1, entered_on: 2026-09-12 }
        spend_updates:
          - { update: CU-0, campaign: CMP-1, client: C1, period_to: 2026-09-30 }
        project_expenses:
          - { expense: E-0, spent_on: 2026-09-18 }
        milestone_dones:
          - { milestone: MS-2, done_on: 2026-09-25 }
    records:
      lines:
        - { account: "111001", currency: SYP, amount: 200000000 }
        - { account: "111004", currency: USD, amount: 100000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -15000 }
        - { account: "211002", currency: USD, amount: -8000 }
        - { account: "311001", currency: SYP, amount: -100000000, parallel: -1000000 }
        - { account: "312002", currency: SYP, amount: -30000000, parallel: -260000 }
      figures:
        - { slot: receivable, client: C1, currency: USD, amount: 30000 }
        - { slot: receivable, client: C2, currency: USD, amount: 25000 }
        - { slot: ad_funds, client: C1, currency: USD, amount: 35000 }
  - event: ad_wallet.entry_voided
    accounting_date: 2026-10-05
    payload: { entry: W-1, voided_on: 2026-10-05 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: before_books_start }
  - event: ad_spend.changed
    accounting_date: 2026-10-06
    payload: { update: CU-0, campaign: CMP-1, client: C1, period_from: 2026-09-01,
               period_to: 2026-09-30, usd_spend: 12000 }
    outcome: { status: held, reason: WAITING_FOR_EARLIER_EVENT }
  - event: invoice.voided
    accounting_date: 2026-10-08
    payload: { invoice: INV-2026-7, voided_on: 2026-10-08, reason: "أُلغي عقد العميل من بدايته" }
    outcome: { status: held, reason: NEEDS_DECISION, detail: before_books_start }
  - event: project_expense.archived
    accounting_date: 2026-10-12
    payload: { expense: E-0, archived_on: 2026-10-12 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: before_books_start }
  - event: payment.voided
    accounting_date: 2026-10-14
    payload: { payment: PAY-0, voided_on: 2026-10-14 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: before_books_start }
  - event: milestone.reopened
    accounting_date: 2026-10-15
    payload: { milestone: MS-2, client: C2, project: { code: P2, kind: project, client: C2 },
               reopened_on: 2026-10-15 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: before_books_start }
  - retry: 4
    outcome: { status: held, reason: NEEDS_DECISION, detail: before_books_start }
  - manual: W-1 returned by the bank, taken off C1's funds
    accounting_date: 2026-10-05
    payload: { reference: W-1,
               lines: [{ account: "213001", dims: { client: C1 }, currency: USD, amount: 20000,
                         memo: "إلغاء الإيداع W-1 السابق لبدء الدفاتر" },
                       { account: "111004", currency: USD, amount: -20000 }] }
  - resolve: { step: 2, entry: 2 }
    reason: "الإيداع W-1 أُعيد من المصرف في تشرين الأول"
  - manual: CU-0 lowered from 150.00 to 120.00 USD, 30.00 back to C1's funds
    accounting_date: 2026-10-06
    payload: { reference: CU-0,
               lines: [{ account: "213001", dims: { client: C1 }, currency: USD, amount: -3000,
                         memo: "تعديل إنفاق أيلول CU-0 من 150 إلى 120 دولاراً" },
                       { account: "211001", dims: { client: C1 }, currency: USD, amount: 3000 }] }
  - resolve: { step: 3, entry: 3 }
    reason: "خُفّض إنفاق أيلول بعد تسوية المنصة"
  - manual: E-0 charged to P2 in error, the cost of the period reduced
    accounting_date: 2026-10-12
    payload: { reference: E-0,
               lines: [{ account: "211002", currency: USD, amount: 8000 },
                       { account: "511001", dims: { client: C2, contract: P2, department: design },
                         currency: USD, amount: -8000, memo: "أرشفة المصروف E-0 السابق لبدء الدفاتر" }] }
  - resolve: { step: 5, entry: 4 }
    reason: "المصروف E-0 سُجّل على المشروع P2 خطأً"
  - manual: PAY-0 returned by the bank, C2's receivable reopened
    accounting_date: 2026-10-14
    payload: { reference: PAY-0,
               lines: [{ account: "112001", dims: { client: C2 }, currency: USD, amount: 15000,
                         open_item: { ref: INV-2026-5/PAY-0 },
                         memo: "إعادة فتح ذمة INV-2026-5 بعد إلغاء الدفعة PAY-0" },
                       { account: "111004", currency: USD, amount: -15000 }] }
  - resolve: { step: 6, entry: 5 }
    reason: "الدفعة PAY-0 أُعيدت من المصرف"
  - manual: MS-2 rejected by the client, its contract asset and revenue taken back
    accounting_date: 2026-10-15
    payload: { reference: MS-2,
               lines: [{ account: "113001", currency: USD, amount: -40000, item: MS-2,
                         memo: "إعادة فتح المرحلة MS-2 المنجزة قبل بدء الدفاتر" },
                       { account: "411001", dims: { client: C2, contract: P2, service: S2 },
                         currency: USD, amount: 40000 }] }
  - resolve: { step: 7, entry: 6 }
    reason: "رفض العميل تسليم المرحلة MS-2"
  - job: revenue_release_month
    period: 2026-10
  - manual: INV-2026-7 voided, its receivable, schedule and September revenue taken back
    accounting_date: 2026-10-29
    payload: { reference: INV-2026-7,
               lines: [{ account: "112001", currency: USD, amount: -30000, item: INV-2026-7,
                         memo: "إلغاء الفاتورة INV-2026-7 السابقة لبدء الدفاتر" },
                       { account: "212001", currency: USD, amount: 15000, schedule: INV-2026-7/L1,
                         memo: "إقفال جدول INV-2026-7 بعد إلغائها" },
                       { account: "411001", dims: { client: C1, contract: R1, service: S1 },
                         currency: USD, amount: 15000, memo: "إيراد أيلول من INV-2026-7 (IAS 8.36)" }] }
  - resolve: { step: 4, entry: 7 }
    reason: "أُلغي عقد العميل C1 من بدايته؛ تغيير في التقدير"
  - event: milestone.done
    accounting_date: 2026-10-27
    payload: { milestone: MS-2, client: C2, project: { code: P2, kind: project, client: C2 },
               currency: USD, amount: 40000, done_on: 2026-10-27, service: S2 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: document_resolved_manually }
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        # receivables at the bulletin of the eve, 115: INV-2026-5's 250.00 USD outstanding = 28,750.00 SYP
        - { account: "112001", dims: { client: C2 }, currency: USD, amount: 25000, book: 2875000, parallel: 25000 }
        # INV-2026-7: 300.00 × 115 = 34,500.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 30000, book: 3450000, parallel: 30000 }
        # MS-2: 400.00 × 115 = 46,000.00 SYP
        - { account: "113001", dims: { client: C2, contract: P2 }, currency: USD, amount: 40000, book: 4600000, parallel: 40000 }
        # C1's funds: 350.00 × 115 = 40,250.00 SYP held
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -35000, book: -4025000, parallel: -35000 }
        # INV-2026-7/L1: 300.00 × 114 (bulletin of issue) = 34,200.00 SYP, less 15 of 30 days: 15,000 and 1,710,000 left
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -15000, book: -1710000, parallel: -15000 }
        # the records; SYP cash at the market 118: 2,000,000.00 / 118 = 16,949.152… → 16,949.15 USD
        - { account: "111001", currency: SYP, amount: 200000000, book: 200000000, parallel: 1694915 }
        # 1,000.00 USD × 115 = 115,000.00 SYP
        - { account: "111004", currency: USD, amount: 100000, book: 11500000, parallel: 100000 }
        # the September spend owed to the platform: 150.00 × 115 = 17,250.00 SYP
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -15000, book: -1725000, parallel: -15000 }
        # E-0 awaiting its payment source: 80.00 × 115 = 9,200.00 SYP
        - { account: "211002", currency: USD, amount: -8000, book: -920000, parallel: -8000 }
        - { account: "311001", currency: SYP, amount: -100000000, book: -100000000, parallel: -1000000 }
        - { account: "312002", currency: SYP, amount: -30000000, book: -30000000, parallel: -260000 }
        # balancing: book −(2,875,000 + 3,450,000 + 4,600,000 − 4,025,000 − 1,710,000 + 200,000,000 + 11,500,000
        #   − 1,725,000 − 920,000 − 100,000,000 − 30,000,000) = −84,045,000;
        #   parallel −(25,000 + 30,000 + 40,000 − 35,000 − 15,000 + 1,694,915 + 100,000 − 15,000 − 8,000
        #   − 1,000,000 − 260,000) = −556,915
        - { account: "312001", currency: SYP, amount: -84045000, book: -84045000, parallel: -556915 }
    - source: manual
      date: 2026-10-05
      lines:
        # against C1's credit balance: cleared at the average, 4,025,000 × 20,000 / 35,000 = 2,300,000
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 20000, book: 2300000, parallel: 20000 }
        # the bank returns 200.00 USD at 116 = 23,200.00 SYP
        - { account: "111004", currency: USD, amount: -20000, book: -2320000, parallel: -20000 }
        # book residual 2,300,000 − 2,320,000 = −20,000, so a realised loss of 200.00 SYP; parallel none
        - { account: "541001", currency: SYP, amount: 20000, book: 20000, parallel: 0 }
    - source: manual
      date: 2026-10-06
      lines:
        # with C1's credit balance: a new measurement, 30.00 × 116 = 3,480.00 SYP; no residual
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -3000, book: -348000, parallel: -3000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: 3000, book: 348000, parallel: 3000 }
    - source: manual
      date: 2026-10-12
      lines:
        # both new measurements at 117: 80.00 × 117 = 9,360.00 SYP; the payable's 160.00 SYP above its carrying
        #   9,200.00 stays on 211002 until October's revaluation, as on any line of a non-control monetary account
        - { account: "211002", currency: USD, amount: 8000, book: 936000, parallel: 8000 }
        - { account: "511001", dims: { client: C2, contract: P2, department: design }, currency: USD, amount: -8000, book: -936000, parallel: -8000 }
    - source: manual
      date: 2026-10-14
      lines:
        # a new manual item, since INV-2026-5's Hub item takes no addition (S04 rule 2): 150.00 × 117 = 17,550.00 SYP
        - { account: "112001", dims: { client: C2 }, currency: USD, amount: 15000, book: 1755000, parallel: 15000 }
        - { account: "111004", currency: USD, amount: -15000, book: -1755000, parallel: -15000 }
    - source: manual
      date: 2026-10-15
      lines:
        # MS-2 cleared at its carrying 46,000.00 SYP
        - { account: "113001", dims: { client: C2, contract: P2 }, currency: USD, amount: -40000, book: -4600000, parallel: -40000 }
        # the revenue recognised before the books start taken back in October (IAS 8.36): 400.00 × 117 = 46,800.00 SYP
        - { account: "411001", dims: { client: C2, contract: P2, service: S2 }, currency: USD, amount: 40000, book: 4680000, parallel: 40000 }
        # book residual −4,600,000 + 4,680,000 = 80,000, so a realised gain of 800.00 SYP
        - { account: "421001", currency: SYP, amount: -80000, book: -80000, parallel: 0 }
    # October's release (31 Oct) posts nothing: INV-2026-7's schedule is frozen while its void is held,
    #   and the company has no other schedule
    - source: manual
      date: 2026-10-29
      lines:
        # the receivable cleared at its carrying 34,500.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: -30000, book: -3450000, parallel: -30000 }
        # the schedule cleared at what it carries, 150.00 USD and 17,100.00 SYP; no rate read
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 15000, book: 1710000, parallel: 15000 }
        # September's 15 days, recognised before the books start, taken back from October's revenue: 150.00 × 118 = 17,700.00 SYP
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 15000, book: 1770000, parallel: 15000 }
        # book residual −3,450,000 + 1,710,000 + 1,770,000 = 30,000, so a realised gain of 300.00 SYP
        - { account: "421001", currency: SYP, amount: -30000, book: -30000, parallel: 0 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "113001", book: 0, parallel: 0 }
    # 4,680,000 + 1,770,000; parallel 40,000 + 15,000
    - { account: "411001", book: 6450000, parallel: 55000 }
    - { account: "421001", book: -110000, parallel: 0 }
    - { account: "541001", book: 20000, parallel: 0 }
    - { account: "511001", book: -936000, parallel: -8000 }
    # 11,500,000 − 2,320,000 − 1,755,000; parallel 100,000 − 20,000 − 15,000
    - { account: "111004", book: 7425000, parallel: 65000 }
    # −1,725,000 + 348,000; parallel −15,000 + 3,000
    - { account: "211001", book: -1377000, parallel: -12000 }
    - { account: "211002", book: 16000, parallel: 0 }
    # nothing before the books start is moved from equity
    - { account: "312002", book: -30000000, parallel: -260000 }
    - { account: "312001", book: -84045000, parallel: -556915 }
  open_items:
    - { item: INV-2026-7, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: INV-2026-5, account: "112001", dims: { client: C2 }, currency: USD, amount: 25000, book: 2875000, parallel: 25000 }
    - { item: INV-2026-5/PAY-0, account: "112001", dims: { client: C2 }, currency: USD, amount: 15000, book: 1755000, parallel: 15000 }
    - { item: MS-2, account: "113001", dims: { client: C2, contract: P2 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    # −4,025,000 + 2,300,000 − 348,000; 350.00 − 200.00 + 30.00 = 180.00 USD held, as Hub's wallet shows
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: -18000, book: -2073000, parallel: -18000 }
```

### A material error of an earlier fiscal year, against retained earnings

S10 rule 28, IAS 8.42. A company whose books start on 1 January 2027 opens with INV-2026-88, 200.00 USD unpaid, issued on 20 November 2026. On 12 January 2027 Hub voids it: it billed C1 a second time for work INV-2026-87 had billed and C1 had paid in 2026. The accountant judges the 2026 revenue overstated by a material error: the correction goes to retained earnings `312001`, not to January's revenue, and so does the entry's residual (owner, 2026-11-12): the receivable never existed, so its remeasurement from 125 to 126 is no exchange difference of 2027, and `312001` takes exactly what the item carried. The books start with the fiscal year, so the year's result before them is nothing and the opening has no line on `312002`.

```yaml
case: books from 1 January 2027; INV-2026-88 (200.00 USD at the eve's 125) voided on 12 January as a duplicate of 2026, held before_books_start, resolved against 312001, the residual of 126 on 312001 too, nothing in profit or loss
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency, books_start: 2027-01-01,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "128.0000", type: market }
  - { date: 2027-01-12, base: USD, quote: SYP, rate: "126.0000", type: bulletin }
steps:
  - opening: the opening of 2027
    snapshot:
      invoices:
        - { invoice: INV-2026-88, client: C1, currency: USD, syp_per_usd: "124.0000",
            issued_on: 2026-11-20, due_on: 2026-12-20, total: 20000, outstanding: 20000,
            lines: [{ line: L1, amount: 20000, source: extra_work, service: S1 }] }
      prior_documents:
        invoices:
          - { invoice: INV-2026-88, issued_on: 2026-11-20 }
    records:
      lines:
        - { account: "111004", currency: USD, amount: 300000 }
        - { account: "311001", currency: SYP, amount: -30000000, parallel: -250000 }
      figures:
        - { slot: receivable, client: C1, currency: USD, amount: 20000 }
  - event: invoice.voided
    accounting_date: 2027-01-12
    payload: { invoice: INV-2026-88, voided_on: 2027-01-12, reason: "فاتورة مكررة للعمل نفسه" }
    outcome: { status: held, reason: NEEDS_DECISION, detail: before_books_start }
  - manual: INV-2026-88 a duplicate of 2026, corrected against retained earnings
    accounting_date: 2027-01-12
    payload: { reference: INV-2026-88,
               lines: [{ account: "112001", currency: USD, amount: -20000, item: INV-2026-88,
                         memo: "إلغاء الفاتورة المكررة INV-2026-88" },
                       { account: "312001", currency: USD, amount: 20000,
                         memo: "تصحيح خطأ جوهري في إيراد 2026 (IAS 8.42)" }] }
  - resolve: { step: 2, entry: 2 }
    reason: "فوترة مكررة في 2026؛ خطأ جوهري لسنة سابقة"
expect:
  entries:
    - source: opening
      date: 2027-01-01
      lines:
        # 200.00 USD × 125 (bulletin of the eve) = 25,000.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 20000, book: 2500000, parallel: 20000 }
        # 3,000.00 USD × 125 = 375,000.00 SYP
        - { account: "111004", currency: USD, amount: 300000, book: 37500000, parallel: 300000 }
        - { account: "311001", currency: SYP, amount: -30000000, book: -30000000, parallel: -250000 }
        # balancing: book −(2,500,000 + 37,500,000 − 30,000,000) = −10,000,000; parallel −(20,000 + 300,000 − 250,000) = −70,000
        - { account: "312001", currency: SYP, amount: -10000000, book: -10000000, parallel: -70000 }
    - source: manual
      date: 2027-01-12
      lines:
        # cleared at its carrying 25,000.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -20000, book: -2500000, parallel: -20000 }
        # the correction in equity, a new measurement: 200.00 × 126 = 25,200.00 SYP
        - { account: "312001", currency: USD, amount: 20000, book: 2520000, parallel: 20000 }
        # book residual −2,500,000 + 2,520,000 = 20,000: in an entry with a line on retained earnings it posts
        #   there, not to 421001, so 312001 takes the item's carrying 25,000.00 SYP net (owner, 2026-11-12)
        - { account: "312001", currency: SYP, amount: -20000, book: -20000, parallel: 0 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    # −10,000,000 + 2,520,000 − 20,000; parallel −70,000 + 20,000
    - { account: "312001", book: -7500000, parallel: -50000 }
    - { account: "411001", book: 0, parallel: 0 }
    - { account: "421001", book: 0, parallel: 0 }
  open_items:
    - { item: INV-2026-88, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
```

### Vertex Media: a backdated expense moved to October, and a service changed on an opening schedule

S10 rules 4 and 29, edge case 29 and "A backdated document in Hub after the snapshot". INV-2026-9 to C1 (project P1), paid in full on 5 September, carries a 910.00 USD manual line deferred over 1 September to 30 November (91 days: 30, 31 and 30), issued on 1 September at the bulletin of 114: the opening holds 61 of its 91 days. Hub then sends E-9, an expense of 28 September entered after the snapshot: September is closed, so it is held `PERIOD_CLOSED`, and the accountant posts it on 1 October at the bulletin of its own date. October's release takes 31 days; on 10 November Hub moves the line from S1 to S2, which reclassifies October's release only; November's release follows S2. September's 30 days are in `312002` and stay there.

```yaml
case: a 910.00 USD line deferred over 1 Sep to 30 Nov at 114, 61 days in the opening; E-9 of 28 Sep held PERIOD_CLOSED and moved to 1 Oct at 114.8; October released on S1, reclassified to S2 on 10 Nov, November released on S2; September's part left in equity
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency, books_start: 2026-10-01,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-09-01, base: USD, quote: SYP, rate: "114.0000", type: bulletin }
  - { date: 2026-09-28, base: USD, quote: SYP, rate: "114.8000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "118.0000", type: market }
steps:
  - opening: Vertex Media's opening with a deferred line
    snapshot:
      invoices:
        - { invoice: INV-2026-9, client: C1, contract: { code: P1, kind: project, client: C1 },
            currency: USD, syp_per_usd: "117.0000", issued_on: 2026-09-01, due_on: 2026-09-15,
            total: 91000, outstanding: 0,
            lines: [{ line: L1, amount: 91000, source: manual, deferred: true,
                      cycle_start: 2026-09-01, cycle_end: 2026-11-30, service: S1 }] }
      prior_documents:
        invoices:
          - { invoice: INV-2026-9, issued_on: 2026-09-01 }
        payments:
          - { payment: PAY-9, receipt: R-2026-9, invoice: INV-2026-9, paid_on: 2026-09-05 }
    records:
      lines:
        - { account: "111001", currency: SYP, amount: 60000000 }
        - { account: "111004", currency: USD, amount: 50000 }
        - { account: "311001", currency: SYP, amount: -50000000, parallel: -450000 }
        - { account: "312002", currency: SYP, amount: -5000000, parallel: -42000 }
  - event: project_expense.recorded
    accounting_date: 2026-09-28
    payload: { expense: E-9, client: C1, contract: { code: P1, kind: project, client: C1 },
               department: design, spent_on: 2026-09-28, currency: USD, amount: 10000,
               syp_per_usd: "117.0000", description: "طباعة مواد الحملة" }
    outcome: { status: held, reason: PERIOD_CLOSED }
  - move: 2
    reason: "مصروف أيلول أُدخل في Hub بعد لقطة الافتتاح"
  - job: revenue_release_month
    period: 2026-10
  - event: invoice.line_service_changed
    accounting_date: 2026-11-10
    payload: { invoice: INV-2026-9, line: L1, old_service: S1, new_service: S2, changed_on: 2026-11-10 }
  - job: revenue_release_month
    period: 2026-11
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        # 910.00 USD × 114 (bulletin of issue) = 103,740.00 SYP; 10.00 USD and 1,140.00 SYP a day;
        #   less September's 30 days: 91,000 × 30 / 91 = 30,000 and 10,374,000 × 30 / 91 = 3,420,000; left 61,000 and 6,954,000
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -61000, book: -6954000, parallel: -61000 }
        # 600,000.00 SYP / 118 = 5,084.745… → 5,084.75 USD
        - { account: "111001", currency: SYP, amount: 60000000, book: 60000000, parallel: 508475 }
        # 500.00 USD × 115 = 57,500.00 SYP
        - { account: "111004", currency: USD, amount: 50000, book: 5750000, parallel: 50000 }
        - { account: "311001", currency: SYP, amount: -50000000, book: -50000000, parallel: -450000 }
        - { account: "312002", currency: SYP, amount: -5000000, book: -5000000, parallel: -42000 }
        # balancing: book −(−6,954,000 + 60,000,000 + 5,750,000 − 50,000,000 − 5,000,000) = −3,796,000;
        #   parallel −(−61,000 + 508,475 + 50,000 − 450,000 − 42,000) = −5,475
        - { account: "312001", currency: SYP, amount: -3796000, book: -3796000, parallel: -5475 }
    - source: project_expense.recorded
      date: 2026-10-01
      lines:
        # posted on the first day of the first open period, measured at its own date: 100.00 × 114.8 = 11,480.00 SYP
        - { account: "511001", dims: { client: C1, contract: P1, department: design }, currency: USD, amount: 10000, book: 1148000, parallel: 10000 }
        - { account: "211002", currency: USD, amount: -10000, book: -1148000, parallel: -10000 }
    - source: revenue_release
      date: 2026-10-31
      lines:
        # cumulative through 31 Oct, 61 of 91 days: 61,000 and 6,954,000, less September's 30,000 and 3,420,000
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 31000, book: 3534000, parallel: 31000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -31000, book: -3534000, parallel: -31000 }
    - source: invoice.line_service_changed
      date: 2026-11-10
      lines:
        # what Mizan released, October's, at its carried amounts; September's part in 312002 is not reclassified
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: 31000, book: 3534000, parallel: 31000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S2 }, currency: USD, amount: -31000, book: -3534000, parallel: -31000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # the last 30 days: 91,000 − 61,000 and 10,374,000 − 6,954,000, on the new service
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3420000, parallel: 30000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S2 }, currency: USD, amount: -30000, book: -3420000, parallel: -30000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", dims: { service: S1 }, book: 0, parallel: 0 }
    # 3,534,000 + 3,420,000; parallel 31,000 + 30,000
    - { account: "411001", dims: { service: S2 }, book: -6954000, parallel: -61000 }
    - { account: "312002", book: -5000000, parallel: -42000 }
    - { account: "211002", book: -1148000, parallel: -10000 }
```

### USD books with an SYP parallel ledger: an SYP invoice voided

S10 rule 28 in `usd-syp`. INV-2026-14, 115,000.00 SYP to C2, is in the opening as a receivable at the bulletin of the eve in the USD book (1,000.00 USD) and as is in the SYP parallel ledger. Hub voids it on 13 October after a dispute: a change in estimate, so the revenue recognised in September is taken back from October's, measured at the bulletin of 117 in the book.

```yaml
case: USD books; INV-2026-14 (115,000.00 SYP, 1,000.00 USD at the eve's 115) voided on 13 October, resolved at 117 with a 17.09 USD loss in the book
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency, books_start: 2026-10-01,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "118.0000", type: market }
  - { date: 2026-10-13, base: USD, quote: SYP, rate: "117.0000", type: bulletin }
steps:
  - opening: the opening in USD books
    snapshot:
      invoices:
        - { invoice: INV-2026-14, client: C2, currency: SYP, syp_per_usd: "116.0000",
            issued_on: 2026-09-21, due_on: 2026-10-21, total: 11500000, outstanding: 11500000,
            lines: [{ line: L1, amount: 11500000, source: extra_work, service: S2 }] }
      prior_documents:
        invoices:
          - { invoice: INV-2026-14, issued_on: 2026-09-21 }
    records:
      lines:
        - { account: "111004", currency: USD, amount: 100000 }
        - { account: "311001", currency: USD, amount: -150000, parallel: -17250000 }
        - { account: "312002", currency: USD, amount: -20000, parallel: -2300000 }
      figures:
        - { slot: receivable, client: C2, currency: SYP, amount: 11500000 }
  - event: invoice.voided
    accounting_date: 2026-10-13
    payload: { invoice: INV-2026-14, voided_on: 2026-10-13, reason: "خلاف مع العميل على العمل" }
    outcome: { status: held, reason: NEEDS_DECISION, detail: before_books_start }
  - manual: INV-2026-14 voided after a dispute, September's revenue taken back
    accounting_date: 2026-10-13
    payload: { reference: INV-2026-14,
               lines: [{ account: "112001", currency: SYP, amount: -11500000, item: INV-2026-14,
                         memo: "إلغاء الفاتورة INV-2026-14 السابقة لبدء الدفاتر" },
                       { account: "411001", dims: { client: C2, service: S2 }, currency: SYP,
                         amount: 11500000, memo: "إيراد أيلول من INV-2026-14 (IAS 8.36)" }] }
  - resolve: { step: 2, entry: 2 }
    reason: "خلاف مع العميل C2؛ تغيير في التقدير"
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        # book: 115,000.00 SYP / 115 (bulletin of the eve) = 1,000.00 USD; parallel: SYP as is
        - { account: "112001", dims: { client: C2 }, currency: SYP, amount: 11500000, book: 100000, parallel: 11500000 }
        # parallel: 1,000.00 USD × 118 (market of the eve) = 118,000.00 SYP
        - { account: "111004", currency: USD, amount: 100000, book: 100000, parallel: 11800000 }
        - { account: "311001", currency: USD, amount: -150000, book: -150000, parallel: -17250000 }
        - { account: "312002", currency: USD, amount: -20000, book: -20000, parallel: -2300000 }
        # balancing in USD: book −(100,000 + 100,000 − 150,000 − 20,000) = −30,000;
        #   parallel −(11,500,000 + 11,800,000 − 17,250,000 − 2,300,000) = −3,750,000
        - { account: "312001", currency: USD, amount: -30000, book: -30000, parallel: -3750000 }
    - source: manual
      date: 2026-10-13
      lines:
        # cleared at its carrying 1,000.00 USD and 115,000.00 SYP
        - { account: "112001", dims: { client: C2 }, currency: SYP, amount: -11500000, book: -100000, parallel: -11500000 }
        # book: 115,000.00 SYP / 117 = 982.905… → 982.91 USD; parallel SYP as is
        - { account: "411001", dims: { client: C2, service: S2 }, currency: SYP, amount: 11500000, book: 98291, parallel: 11500000 }
        # book residual −100,000 + 98,291 = −1,709, so a realised loss of 17.09 USD; parallel none
        - { account: "541001", currency: USD, amount: 1709, book: 1709, parallel: 0 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "411001", book: 98291, parallel: 11500000 }
    - { account: "541001", book: 1709, parallel: 0 }
  open_items:
    - { item: INV-2026-14, account: "112001", dims: { client: C2 }, currency: SYP, amount: 0, book: 0, parallel: 0 }
```

### SYP books only: a payment voided, then another payment of the invoice

S10 rule 28 and edge case 13 in `syp`, a company with a Hub client and no parallel ledger. INV-2026-6, 500.00 USD to C1, was paid 300.00 USD by PAY-3 on 25 September, so the opening holds its 200.00 USD outstanding. Hub voids PAY-3 on 20 October (the transfer was returned): held, and the accountant reopens the 300.00 USD as a manual item. On 27 October C1 pays the 200.00 USD Hub shows as outstanding: PAY-4 is another document, so it is not held `document_resolved_manually`, and it clears the opening item at its carrying amount (S10 rule 30).

```yaml
case: SYP books only; PAY-3 of 25 Sep voided on 20 Oct, held before_books_start and resolved by a manual item at 118; PAY-4 of 27 Oct posts against the opening item at 119 with an 800.00 SYP gain
company: { shape: syp, book: SYP, template: service-agency, books_start: 2026-10-01,
           rate_policy: { book: bulletin } }
rates:
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-10-20, base: USD, quote: SYP, rate: "118.0000", type: bulletin }
  - { date: 2026-10-27, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
steps:
  - opening: the opening in SYP books
    snapshot:
      invoices:
        - { invoice: INV-2026-6, client: C1, currency: USD, syp_per_usd: "117.0000",
            issued_on: 2026-09-15, due_on: 2026-10-15, total: 50000, outstanding: 20000,
            lines: [{ line: L1, amount: 50000, source: extra_work, service: S1 }] }
      prior_documents:
        invoices:
          - { invoice: INV-2026-6, issued_on: 2026-09-15 }
        payments:
          - { payment: PAY-3, receipt: R-2026-3, invoice: INV-2026-6, paid_on: 2026-09-25 }
    records:
      lines:
        - { account: "111004", currency: USD, amount: 50000 }
        - { account: "311001", currency: SYP, amount: -5000000 }
        - { account: "312002", currency: SYP, amount: -2000000 }
      figures:
        - { slot: receivable, client: C1, currency: USD, amount: 20000 }
  - event: payment.voided
    accounting_date: 2026-10-20
    payload: { payment: PAY-3, voided_on: 2026-10-20 }
    outcome: { status: held, reason: NEEDS_DECISION, detail: before_books_start }
  - manual: PAY-3 returned by the bank, C1's receivable reopened
    accounting_date: 2026-10-20
    payload: { reference: PAY-3,
               lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 30000,
                         open_item: { ref: INV-2026-6/PAY-3, due: 2026-11-20 },
                         memo: "إعادة فتح ذمة INV-2026-6 بعد إلغاء الدفعة PAY-3" },
                       { account: "111004", currency: USD, amount: -30000 }] }
  - resolve: { step: 2, entry: 2 }
    reason: "الدفعة PAY-3 أُعيدت من المصرف"
  - event: payment.recorded
    accounting_date: 2026-10-27
    payload: { payment: PAY-4, receipt: R-2026-4, invoice: INV-2026-6, paid_on: 2026-10-27,
               method: bank_transfer, currency: USD, amount: 20000, syp_per_usd: "120.0000",
               applied_amount: 20000, invoice_currency: USD }
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        # 200.00 USD × 115 = 23,000.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 20000, book: 2300000 }
        # 500.00 USD × 115 = 57,500.00 SYP
        - { account: "111004", currency: USD, amount: 50000, book: 5750000 }
        - { account: "311001", currency: SYP, amount: -5000000, book: -5000000 }
        - { account: "312002", currency: SYP, amount: -2000000, book: -2000000 }
        # balancing: −(2,300,000 + 5,750,000 − 5,000,000 − 2,000,000) = −1,050,000
        - { account: "312001", currency: SYP, amount: -1050000, book: -1050000 }
    - source: manual
      date: 2026-10-20
      lines:
        # both new measurements: 300.00 × 118 = 35,400.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 30000, book: 3540000 }
        - { account: "111004", currency: USD, amount: -30000, book: -3540000 }
    - source: payment.recorded
      date: 2026-10-27
      lines:
        # 200.00 × 119 = 23,800.00 SYP received
        - { account: "111004", currency: USD, amount: 20000, book: 2380000 }
        # the opening item cleared at its carrying 23,000.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -20000, book: -2300000 }
        # book residual 2,380,000 − 2,300,000 = 80,000, so a realised gain of 800.00 SYP
        - { account: "421001", currency: SYP, amount: -80000, book: -80000 }
  balances:
    # 5,750,000 − 3,540,000 + 2,380,000
    - { account: "111004", book: 4590000 }
    - { account: "421001", book: -80000 }
  open_items:
    - { item: INV-2026-6, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0 }
    - { item: INV-2026-6/PAY-3, account: "112001", dims: { client: C1 }, currency: USD, amount: 30000, book: 3540000 }
```

### Vertex Media: a credit waiting behind a held void, the void dismissed

The owner's decisions of 2026-11-12 on a frozen schedule. INV-2026-7 to C1 (retainer R1), 300.00 USD at the bulletin of 114 and paid on 20 September, carries 15 of its cycle's 30 days into the opening. Hub voids it on 8 October: held `before_books_start`, its schedule frozen. On 13 October Hub issues INV-2026-31, the next cycle's charge with a 60.00 USD credit to INV-2026-7's cycle: it waits behind the void. On 13 October the owner dismisses the void (Hub voided the wrong invoice and the client keeps its retainer); no month has ended, so nothing is released at once, and INV-2026-31 posts. The credit finds 15 of the cycle's 30 days recognised, before the books start: half of it reduces revenue at the credit invoice's bulletin, half the liability at what the schedule carries (S06 rule 6; S10 edge case 7). October's release then takes what each schedule carries for October.

```yaml
case: INV-2026-7's void held, the schedule frozen and INV-2026-31's 60.00 USD credit to its cycle waiting behind it; the void dismissed, the credit posts at 117 (30.00 to revenue, 30.00 to the liability at carried amounts, a 90.00 SYP loss); October releases both schedules
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency, books_start: 2026-10-01,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-09-10, base: USD, quote: SYP, rate: "114.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "118.0000", type: market }
  - { date: 2026-10-13, base: USD, quote: SYP, rate: "117.0000", type: bulletin }
steps:
  - opening: Vertex Media's opening with a paid retainer invoice
    snapshot:
      invoices:
        - { invoice: INV-2026-7, client: C1, contract: { code: R1, kind: retainer, client: C1 },
            currency: USD, syp_per_usd: "117.0000", issued_on: 2026-09-10, due_on: 2026-09-25,
            total: 30000, outstanding: 0,
            lines: [{ line: L1, amount: 30000, source: retainer_charge, kind: monthly,
                      cycle_start: 2026-09-16, cycle_end: 2026-10-15, service: S1 }] }
      prior_documents:
        invoices:
          - { invoice: INV-2026-7, issued_on: 2026-09-10 }
        payments:
          - { payment: PAY-7, receipt: R-2026-7, invoice: INV-2026-7, paid_on: 2026-09-20 }
    records:
      lines:
        - { account: "111004", currency: USD, amount: 100000 }
        - { account: "311001", currency: SYP, amount: -4000000, parallel: -35000 }
        - { account: "312002", currency: SYP, amount: -1000000, parallel: -8500 }
  - event: invoice.voided
    accounting_date: 2026-10-08
    payload: { invoice: INV-2026-7, voided_on: 2026-10-08, reason: "أُلغيت في Hub" }
    outcome: { status: held, reason: NEEDS_DECISION, detail: before_books_start }
  - event: invoice.issued
    accounting_date: 2026-10-13
    payload: { invoice: INV-2026-31, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "118.0000", issued_on: 2026-10-13, due_on: 2026-10-28,
               lines: [{ line: L1, amount: 30000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-10-16, cycle_end: 2026-11-15, service: S1 },
                       { line: L2, amount: -6000, source: retainer_charge, kind: credit,
                         cycle_start: 2026-09-16, service: S1 }] }
    outcome: { status: held, reason: WAITING_FOR_EARLIER_EVENT }
  - dismiss: 2
    reason: "ألغى Hub الفاتورة الخطأ؛ عقد العميل C1 قائم"
  - job: revenue_release_month
    period: 2026-10
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        # 300.00 × 114 (bulletin of issue) = 34,200.00 SYP, less 15 of 30 days: 15,000 and 1,710,000 left
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -15000, book: -1710000, parallel: -15000 }
        # 1,000.00 USD × 115 = 115,000.00 SYP
        - { account: "111004", currency: USD, amount: 100000, book: 11500000, parallel: 100000 }
        - { account: "311001", currency: SYP, amount: -4000000, book: -4000000, parallel: -35000 }
        - { account: "312002", currency: SYP, amount: -1000000, book: -1000000, parallel: -8500 }
        # balancing: book −(−1,710,000 + 11,500,000 − 4,000,000 − 1,000,000) = −4,790,000;
        #   parallel −(−15,000 + 100,000 − 35,000 − 8,500) = −41,500
        - { account: "312001", currency: SYP, amount: -4790000, book: -4790000, parallel: -41500 }
    # the dismissal on 13 Oct releases nothing: no month of the frozen schedule has ended
    - source: invoice.issued
      date: 2026-10-13
      lines:
        # 300.00 − 60.00 = 240.00 USD × 117 = 28,080.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 24000, book: 2808000, parallel: 24000 }
        # the next cycle deferred: 300.00 × 117 = 35,100.00 SYP
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -30000, book: -3510000, parallel: -30000 }
        # the credit on INV-2026-7's cycle, 15 of 30 days recognised before the books start (N 30,000, 15,000 still
        #   to recognise): revenue 6,000 × 15,000 / 30,000 = 3,000, × 117 = 351,000
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: 3000, book: 351000, parallel: 3000 }
        # the rest, 3,000, off the schedule at its carried amounts: 1,710,000 × 3,000 / 15,000 = 342,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 3000, book: 342000, parallel: 3000 }
        # book residual 2,808,000 − 3,510,000 + 351,000 + 342,000 = −9,000, so a realised loss of 90.00 SYP
        - { account: "541001", currency: SYP, amount: 9000, book: 9000, parallel: 0 }
    - source: revenue_release
      date: 2026-10-31
      lines:
        # INV-2026-7's schedule, an opening line, first: its last 15 days are all in October, all it carries,
        #   15,000 − 3,000 = 12,000 and 1,710,000 − 342,000 = 1,368,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 12000, book: 1368000, parallel: 12000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -12000, book: -1368000, parallel: -12000 }
    - source: revenue_release
      date: 2026-10-31
      lines:
        # INV-2026-31/L1, 16 Oct to 15 Nov (31 days), 16 in October: 30,000 × 16 / 31 = 15,483.87… → 15,484;
        #   3,510,000 × 16 / 31 = 1,811,612.90… → 1,811,613
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 15484, book: 1811613, parallel: 15484 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -15484, book: -1811613, parallel: -15484 }
  balances:
    # what INV-2026-31/L1 still carries for November: 30,000 − 15,484 and 3,510,000 − 1,811,613
    - { account: "212001", book: -1698387, parallel: -14516 }
    # −351,000 recognised back from the credit, 1,368,000 + 1,811,613 released: 351,000 − 3,179,613
    - { account: "411001", book: -2828613, parallel: -24484 }
    - { account: "541001", book: 9000, parallel: 0 }
  open_items:
    - { item: INV-2026-31, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 24000, book: 2808000, parallel: 24000 }
```

### Vertex Media: a void held over two month ends, then dismissed

The owner's decision of 2026-11-12. INV-2026-9, the deferred line of the third case (910.00 USD over 1 September to 30 November, 61 of its 91 days in the opening), is voided in Hub on 20 October: held `before_books_start`, its schedule frozen. October's and November's jobs release nothing of it, and neither month can close while the event is held (S07's `no_held_events`). On 1 December the owner dismisses the void: the schedule releases at once each ended month it missed, dated on that month's last day, so October and November show their own revenue as if nothing had been frozen.

```yaml
case: INV-2026-9's void held from 20 Oct, October's and November's jobs release nothing of it; dismissed on 1 Dec, it releases October on 31 Oct and November on 30 Nov at the amounts the schedule carries
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency, books_start: 2026-10-01,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-09-01, base: USD, quote: SYP, rate: "114.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "118.0000", type: market }
steps:
  - opening: Vertex Media's opening with a deferred line
    snapshot:
      invoices:
        - { invoice: INV-2026-9, client: C1, contract: { code: P1, kind: project, client: C1 },
            currency: USD, syp_per_usd: "117.0000", issued_on: 2026-09-01, due_on: 2026-09-15,
            total: 91000, outstanding: 0,
            lines: [{ line: L1, amount: 91000, source: manual, deferred: true,
                      cycle_start: 2026-09-01, cycle_end: 2026-11-30, service: S1 }] }
      prior_documents:
        invoices:
          - { invoice: INV-2026-9, issued_on: 2026-09-01 }
        payments:
          - { payment: PAY-9, receipt: R-2026-9, invoice: INV-2026-9, paid_on: 2026-09-05 }
    records:
      lines:
        - { account: "111001", currency: SYP, amount: 60000000 }
        - { account: "111004", currency: USD, amount: 50000 }
        - { account: "311001", currency: SYP, amount: -50000000, parallel: -450000 }
        - { account: "312002", currency: SYP, amount: -5000000, parallel: -42000 }
  - event: invoice.voided
    accounting_date: 2026-10-20
    payload: { invoice: INV-2026-9, voided_on: 2026-10-20, reason: "أُلغيت في Hub" }
    outcome: { status: held, reason: NEEDS_DECISION, detail: before_books_start }
  - job: revenue_release_month
    period: 2026-10
  - job: revenue_release_month
    period: 2026-11
  - dismiss: 2
    reason: "أُلغيت الفاتورة في Hub خطأً؛ الخدمة قُدّمت كاملة"
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        # as in the third case: 61 of 91 days left, 61,000 and 6,954,000
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -61000, book: -6954000, parallel: -61000 }
        - { account: "111001", currency: SYP, amount: 60000000, book: 60000000, parallel: 508475 }
        - { account: "111004", currency: USD, amount: 50000, book: 5750000, parallel: 50000 }
        - { account: "311001", currency: SYP, amount: -50000000, book: -50000000, parallel: -450000 }
        - { account: "312002", currency: SYP, amount: -5000000, book: -5000000, parallel: -42000 }
        - { account: "312001", currency: SYP, amount: -3796000, book: -3796000, parallel: -5475 }
    # October's and November's jobs post nothing: the schedule is frozen and the company has no other
    - source: revenue_release
      date: 2026-10-31
      lines:
        # posted on 1 Dec by the dismissal, dated on October's last day: 31 days, 31,000 and 3,534,000
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 31000, book: 3534000, parallel: 31000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -31000, book: -3534000, parallel: -31000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # November's last 30 days: 30,000 and 3,420,000
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 30000, book: 3420000, parallel: 30000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -30000, book: -3420000, parallel: -30000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -6954000, parallel: -61000 }
```
