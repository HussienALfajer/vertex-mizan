# Closing and reopening a period

Status: Proposed

S07 wrote these cases (S07 "Scenarios"); the owner approved their expected entries and outcomes, and the readings of the checklist items below, on 2026-11-12. The file stays `Proposed` until S07's feature slice brings the `revalue`, `close`, `reopen`, `draft` and `discard` executors, then becomes `Approved (owner, 2026-11-12)`.

## Rule

A month is closed with a reason once it has ended in Asia/Damascus, in order (every month from the company's first period to the one before it is closed), and only when every item of the pre-close checklist passes; there is no override. A close and a reopen post nothing. Nothing posts into a closed month, nor before the company's first period while a month is closed: a manual entry is refused `PERIOD_CLOSED` and a Hub event is held `PERIOD_CLOSED`. Only the latest closed month is reopened, with a reason. A reopened month posts as an open one: the events held `PERIOD_CLOSED` with an accounting date in it, and those held `SERVICE_PERIOD_CLOSED` for it as an elapsed month, are retried into it. Re-closing it runs the same rules and checklist, so a revaluation that its new postings made stale is adjusted first, and an event its retry left held blocks it.

## Basis

- **ADR 0005, invariant 3:** nothing posts into a closed period; the database refuses it. **ADR 0008:** the period history is append-only, and a close and a posting serialise on the ledger head (S07 rule 5). **ADR 0016:** periods open, closed and reopened; the checklist; the revaluation current before a close (owner, 2026-11-11).
- **IAS 21.23(a):** monetary items are translated at the closing rate at the end of each reporting period, so a month closes only once each ledger's revaluation of it is current. **IAS 21.21–22:** a held event retried into its reopened month is measured at the rates of its own date, as if it had arrived on time.
- **IAS 8.41–42:** a late document of a closed month is either recognised in the open month (`inbox/post-in-next-open-period.md`, `revenue/recognise-in-open-period.md`) or, where the accountant judges it material, put back into its own month by reopening it: the accountant's choice, written as the reopen's reason.
- **IFRS 15.35(a), 15.107:** a late invoice's elapsed month is recognised in that month as a contract asset (S06 rule 7), which a reopen makes possible.
- **Company policy:** `phase-1-scope.md` §5, F09 (monthly periods open, closed and reopened; close and reopen with a reason, in the audit log; the checklist) and F10 ("Closed period"); S07 rules 1–9 (owner, 2026-11-11: close in order, no override, reopen only the latest closed month), 15 and 16, and edge cases 1, 15 and 17; S03 rules 4 and 11 (drafts); S05 rules 8, 10 and 16; S06 rules 7 and 18.
- **Syrian rules:** the calendar fiscal year with monthly periods (Income Tax Law 24/2003, CONFIRMED); the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting. No other Syrian rule is relied on.

## Cases

The account codes are the service-agency template's (S02): the SYP and USD bank accounts `111003` and `111004`, trade receivables `112001` and contract assets `113001` (document control accounts), other payables `211003`, contract liabilities `212001` (non-monetary), client ad funds held `213001` (a running control account), the owner's current account `313001` (non-monetary), service revenue `411001`, realised exchange gains `421001`, unrealised exchange gains `421002` and losses `541002`, software subscriptions `531004` and repairs `531006` (expenses, non-monetary). The `third` case adds a TRY cash account `111007` (monetary, restricted to TRY, statement line `bs.cash`). Every rate and amount is synthetic. Fridays and Saturdays are days off (the default calendar): the publication days of October 2026 are the 1st, 4th–8th, 11th–15th, 18th–22nd and 25th–29th (Saturday 31 October takes Thursday 29 October's bulletin), and those of November the 1st–5th, 8th–12th, 15th–19th, 22nd–26th, 29th and 30th.

The steps:
- A **`close`** step closes a month with a reason on the case's clock (S07 rules 2, 5, 7–9), and a **`reopen`** step reopens one (rule 3); neither posts an entry. A refusal names the first rule that fails, in rule 2's or rule 3's order: `PERIOD_CLOSED` (the month is closed already), `PERIOD_NOT_ENDED`, `PERIOD_ORDER` with the month it names as its detail (`period:2026-10`: the earliest open month for a close, the latest closed month for a reopen), `PERIOD_NOT_CLOSED`, and `CHECKLIST_FAILED` with its failing items as its detail, comma-separated in the checklist's order: `bulletins_recorded`, `closing_rates_recorded`, `no_drafts`, `open_items_agree`, `no_held_events`, `releases_posted`, `revaluation_current`. A refused close changes nothing; the case fixes what it names and closes again.
- A **`draft`** step saves a manual entry as a draft without posting it (S03 rule 4), and a **`discard`** step discards it with a reason, naming the draft's step (S03 rule 11). Neither posts an entry; the checklist's `no_drafts` reads them.
- The case's **clock** is its latest step date, and never moves back. A month has ended once the clock is in a later month. A `revalue` step for month *m* moves the clock to the first day of *m* + 1, like a job; a `revalue` step that finds nothing to revalue posts nothing and is done, so a case without foreign balances uses one to end the month.
- A retry that a reopen frees runs as after any other step (S05 rule 10); its entries are expected where they post, after the reopen.

How each checklist item reads in these cases (S07 rule 8):
- **`bulletins_recorded`** asks, for each ledger whose policy is the bulletin, a bulletin in force on every publication day of the month for each currency other than its own that has a line dated in the month or a revaluable balance at its end. A third currency without a direct bulletin to the ledger's currency needs each quote of its cross (ADR 0007) on every publication day: in the `third` case, the TRY books need both the USD/TRY and the USD/SYP bulletin of each day. A ledger at the market rate is not read by this item, nor is a month whose only lines are in the ledger's own currencies.
- **`closing_rates_recorded`** asks each ledger's policy rate of the month's last day for each currency of a revaluable balance (rule 11).
- **`revaluation_current`** fails while a ledger's revaluation of the month recomputes a difference other than zero (rule 15), and also while it cannot be computed for a missing closing rate (the preview's state `rate_missing`). A ledger with nothing to revalue passes with no entry.
- **`releases_posted`** asks a `released` movement for the month from every over-time schedule whose service period runs in it; a month the schedule recognised as elapsed at a late issue (S06 rule 7) is recognised already and asks none.

The cases leave out what other scenarios or tests own:
- **`open_items_agree`**: no posting can make a control account differ from its items, since the database refuses it at commit (ADR 0008 invariant 9, S04), so the item cannot fail in the book; `packages/db`'s invariant tests break it by hand;
- the revaluation's own computations and shapes (`currency/month-end-revaluation.md`), the adjusting revaluation after a back-dated posting or a corrected closing rate, December reopened after a later month's revaluation, and a rate corrected after the close (`currency/stale-revaluation.md`);
- a held event moved to the first open period instead of a reopen (`inbox/post-in-next-open-period.md`), and a closed elapsed month recognised in the first open period (`revenue/recognise-in-open-period.md`);
- the permission `periods.close`, a missing reason, a close racing a posting (rule 5) and the period status Hub reads (`GET /v1/periods/status`): API and invariant tests.

Shapes:
- **`syp-usd`** is Vertex Media: every checklist item that can fail, failing and then passing, with `PERIOD_NOT_ENDED` before them; the order of closes and reopens with every refusal of rules 2–4, a manual entry and a Hub event in the closed month, the reopen retrying the event, the adjusting revaluation and the re-close (S07's acceptance, steps 6–7); and a late invoice held `SERVICE_PERIOD_CLOSED` that a reopen posts into its elapsed month.
- **`syp`** has no parallel ledger and no foreign currency: its checklist reads only the drafts, the held events and the releases. It has the close in order across a month with no posting (edge case 1), and an event that the reopen's retry leaves held, which blocks the re-close (edge case 17).
- **`usd-syp`** has a missing bulletin of SYP in USD books.
- **`third`** has a missing USD/TRY bulletin while every USD/SYP bulletin is recorded.

### Vertex Media: each checklist item refuses the close, then the month closes

November holds a retainer invoice for the cycle of 1 to 30 November (deferred, to be released at the month end), the USD invoice M-1, a Hub payment for an invoice Hub never sent (held `UNKNOWN_REFERENCE`), and a draft. The bulletins of Tuesday 17 and Monday 30 November are not recorded. A close before the month has ended is refused `PERIOD_NOT_ENDED`, whatever the checklist says. Once a December posting moves the clock past November, the close is refused with six failing items. The accountant records the two bulletins, discards the draft and the owner dismisses the payment: two items are left. The release job releases November: one is left. The book revaluation posts at 125 (both receivables gain), and November closes. The parallel ledger has no SYP balance in November, so it has nothing to revalue and needs no closing rate.

```yaml
case: November refused PERIOD_NOT_ENDED, then CHECKLIST_FAILED with six items, then two and one as the accountant fixes them; closed after the release and the revaluation
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  # every November publication day at 120, except Tuesday 17 and Monday 30 (recorded by steps 8 and 9)
  - { date: 2026-11-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-04, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-09, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-11, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-12, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-16, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-18, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-22, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-23, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-24, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-26, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-29, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "125.0000", type: market }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-01
    payload: { invoice: INV-2026-30, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "122.0000", issued_on: 2026-11-01, due_on: 2026-11-15,
               lines: [{ line: L1, amount: 30000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-11-01, cycle_end: 2026-11-30, service: S1 }] }
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - event: payment.recorded
    accounting_date: 2026-11-20
    payload: { payment: PAY-9, receipt: R-2026-9, invoice: INV-2026-99, paid_on: 2026-11-20,
               method: bank_transfer, currency: USD, amount: 10000, syp_per_usd: "122.0000",
               applied_amount: 10000, invoice_currency: USD }
    outcome: { status: held, reason: UNKNOWN_REFERENCE }
  - draft: a software subscription the owner paid, not yet posted
    accounting_date: 2026-11-25
    payload: { lines: [{ account: "531004", currency: USD, amount: 5000 },
                       { account: "313001", currency: USD, amount: -5000 }] }
  - close: 2026-11
    reason: "إقفال تشرين الثاني"
    outcome: { status: refused, reason: PERIOD_NOT_ENDED }
  - manual: a December software subscription the owner paid in SYP
    accounting_date: 2026-12-02
    payload: { lines: [{ account: "531004", currency: SYP, amount: 5000000 },
                       { account: "313001", currency: SYP, amount: -5000000 }] }
  - close: 2026-11
    reason: "إقفال تشرين الثاني"
    outcome: { status: refused, reason: CHECKLIST_FAILED,
               detail: "bulletins_recorded,closing_rates_recorded,no_drafts,no_held_events,releases_posted,revaluation_current" }
  - rate: { date: 2026-11-17, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - rate: { date: 2026-11-30, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - discard: 4
    reason: "سُجّل الاشتراك في كانون الأول"
  - dismiss: 3
    reason: "دفعة لفاتورة لم تصدر، أرسلها Hub خطأً"
  - close: 2026-11
    reason: "إقفال تشرين الثاني"
    outcome: { status: refused, reason: CHECKLIST_FAILED, detail: "releases_posted,revaluation_current" }
  - job: revenue_release_month
    period: 2026-11
  - close: 2026-11
    reason: "إقفال تشرين الثاني"
    outcome: { status: refused, reason: CHECKLIST_FAILED, detail: revaluation_current }
  - revalue: book
    period: 2026-11
  - close: 2026-11
    reason: "إقفال تشرين الثاني بعد التحرير وإعادة التقييم"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-01
      lines:
        # 300.00 USD × 120 (the bulletin of 1 Nov) = 36,000.00 SYP, deferred whole: the cycle starts on the issue date
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: manual
      date: 2026-11-03
      lines:
        # 1,000.00 USD × 120 = 120,000.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: manual
      date: 2026-12-02
      lines:
        # parallel: 50,000.00 SYP / 125 (the market rate of 2 Nov, the newest) = 400.00 USD
        - { account: "531004", currency: SYP, amount: 5000000, book: 5000000, parallel: 40000 }
        - { account: "313001", currency: SYP, amount: -5000000, book: -5000000, parallel: -40000 }
    - source: revenue_release
      date: 2026-11-30
      lines:
        # the whole cycle, 30 of 30 days, at its carried amounts
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # M-1: 1,000.00 × 125 = 125,000.00; carrying 120,000.00; difference +5,000.00
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 500000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -500000, book: -500000, parallel: 0 }
        # INV-2026-30: 300.00 × 125 = 37,500.00; carrying 36,000.00; difference +1,500.00
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: 150000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -150000, book: -150000, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: -500000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 500000, book: 500000, parallel: 0 }
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: -150000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 150000, book: 150000, parallel: 0 }
  balances:
    - { account: "111004", book: 0, parallel: 0 }
    - { account: "212001", book: 0, parallel: 0 }
    # 120,000.00 + 36,000.00 = 156,000.00 SYP; 1,000.00 + 300.00 = 1,300.00 USD
    - { account: "411001", book: -15600000, parallel: -130000 }
    - { account: "421002", book: 0, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
    - { item: INV-2026-30, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
```

### Vertex Media: closed in order; a manual entry and a Hub event in the closed month; November reopened, the event retried, the revaluation adjusted and the month closed again

S07's acceptance, steps 6–7, after a first period in October that holds only SYP expenses (no bulletin and nothing to revalue). November holds M-1, revalued at 125. Closing November first is refused `PERIOD_ORDER`, naming October; October and then November close. A second close of November is refused `PERIOD_CLOSED`. A manual entry dated in closed November is refused `PERIOD_CLOSED`, and so is one dated on 30 September, before the first period (rule 4). A wallet deposit of 200.00 USD dated 29 November is held `PERIOD_CLOSED`. Reopening October is refused `PERIOD_ORDER`, naming November, the latest closed month; reopening December, which is open, is refused `PERIOD_NOT_CLOSED`. November is reopened: the deposit is retried and posts on 29 November at that day's bulletin. The book revaluation of November is now stale: at 125 the client's fund (a liability) needs 1,000.00 SYP more credit and the USD bank 1,000.00 SYP more debit. The re-close is refused on `revaluation_current` alone; the adjusting revaluation posts both, gross, with its reversal, and November closes again.

```yaml
case: November closed after October; a manual entry in November and one before the first period refused PERIOD_CLOSED; a deposit held PERIOD_CLOSED; the reopen of October refused PERIOD_ORDER and of December PERIOD_NOT_CLOSED; November reopened, the deposit posted, the revaluation adjusted by ±1,000.00 and November closed again
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  # every November publication day at 120, and 125 on Monday 30 November
  - { date: 2026-11-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-04, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-09, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-11, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-12, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-16, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-17, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-18, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-22, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-23, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-24, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-26, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-29, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2026-09-01, base: USD, quote: SYP, rate: "125.0000", type: market }
steps:
  - manual: an October software subscription the owner paid in SYP
    accounting_date: 2026-10-15
    payload: { lines: [{ account: "531004", currency: SYP, amount: 5000000 },
                       { account: "313001", currency: SYP, amount: -5000000 }] }
  - manual: invoice M-1 to client C1
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: USD, amount: 100000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000 }] }
  - revalue: book
    period: 2026-11
  - close: 2026-11
    reason: "إقفال تشرين الثاني"
    outcome: { status: refused, reason: PERIOD_ORDER, detail: "period:2026-10" }
  - close: 2026-10
    reason: "إقفال تشرين الأول"
  - close: 2026-11
    reason: "إقفال تشرين الثاني"
  - close: 2026-11
    reason: "إقفال تشرين الثاني مرة ثانية"
    outcome: { status: refused, reason: PERIOD_CLOSED }
  - manual: a repair invoice of 28 November that arrived after the close
    accounting_date: 2026-11-28
    payload: { lines: [{ account: "531006", currency: SYP, amount: 1000000 },
                       { account: "313001", currency: SYP, amount: -1000000 }] }
    outcome: { status: refused, reason: PERIOD_CLOSED }
  - manual: a September repair, before the first period
    accounting_date: 2026-09-30
    payload: { lines: [{ account: "531006", currency: SYP, amount: 1000000 },
                       { account: "313001", currency: SYP, amount: -1000000 }] }
    outcome: { status: refused, reason: PERIOD_CLOSED }
  - event: ad_wallet.deposited
    accounting_date: 2026-11-29
    payload: { entry: W-1, client: C1, entered_on: 2026-11-29, method: bank_transfer,
               currency: USD, amount: 20000, syp_per_usd: "124.0000", usd_amount: 20000 }
    outcome: { status: held, reason: PERIOD_CLOSED }
  - reopen: 2026-10
    reason: "مراجعة مصروف تشرين الأول"
    outcome: { status: refused, reason: PERIOD_ORDER, detail: "period:2026-11" }
  - reopen: 2026-12
    reason: "إعادة فتح كانون الأول"
    outcome: { status: refused, reason: PERIOD_NOT_CLOSED }
  - reopen: 2026-11
    reason: "إيداع العميل C1 في 29 تشرين الثاني وصل بعد الإقفال وهو جوهري"
  - close: 2026-11
    reason: "إعادة إقفال تشرين الثاني"
    outcome: { status: refused, reason: CHECKLIST_FAILED, detail: revaluation_current }
  - revalue: book
    period: 2026-11
  - close: 2026-11
    reason: "إعادة إقفال تشرين الثاني بعد قيد التسوية"
expect:
  entries:
    - source: manual
      date: 2026-10-15
      lines:
        # parallel: 50,000.00 SYP / 125 (the market rate of 1 Sep, the newest) = 400.00 USD
        - { account: "531004", currency: SYP, amount: 5000000, book: 5000000, parallel: 40000 }
        - { account: "313001", currency: SYP, amount: -5000000, book: -5000000, parallel: -40000 }
    - source: manual
      date: 2026-11-03
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # M-1: 1,000.00 × 125 = 125,000.00; carrying 120,000.00; difference +5,000.00
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 500000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -500000, book: -500000, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: -500000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 500000, book: 500000, parallel: 0 }
    - source: ad_wallet.deposited
      date: 2026-11-29
      lines:
        # retried by the reopen; bank_transfer in USD → 111004; book: 200.00 USD × 120 (the bulletin of
        #   29 Nov) = 24,000.00 SYP; Hub's 124 is not read for a USD amount
        - { account: "111004", currency: USD, amount: 20000, book: 2400000, parallel: 20000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -20000, book: -2400000, parallel: -20000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # M-1: 125,000.00 − 120,000.00 − 5,000.00 already = 0: no line
        # 213001 C1: target −200.00 × 125 = −25,000.00; carrying −24,000.00; already 0; difference
        #   −1,000.00: a loss on the liability
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 0, book: -100000, parallel: 0 }
        - { account: "541002", currency: SYP, amount: 100000, book: 100000, parallel: 0 }
        # 111004: target 200.00 × 125 = 25,000.00; carrying 24,000.00; already 0; difference +1,000.00
        - { account: "111004", currency: USD, amount: 0, book: 100000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -100000, book: -100000, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 0, book: 100000, parallel: 0 }
        - { account: "541002", currency: SYP, amount: -100000, book: -100000, parallel: 0 }
        - { account: "111004", currency: USD, amount: 0, book: -100000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 100000, book: 100000, parallel: 0 }
  balances:
    - { account: "111004", book: 2400000, parallel: 20000 }
    - { account: "531006", book: 0, parallel: 0 }
    - { account: "421002", book: 0, parallel: 0 }
    - { account: "541002", book: 0, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: -20000, book: -2400000, parallel: -20000 }
```

### Vertex Media: a late invoice held SERVICE_PERIOD_CLOSED, posted into its elapsed month by a reopen

The invoice of `revenue/over-time-release.md`'s late issue (a cycle of 20 October to 19 November issued on 5 November), with October closed: its elapsed month is closed, so it is held `SERVICE_PERIOD_CLOSED` whole (S06 rules 7 and 18). Instead of recognising it in the first open period (`revenue/recognise-in-open-period.md`), the accountant reopens October: the invoice is retried (S07 rule 6) and posts as it would have on time, October's 12 days as a contract asset dated 31 October at the bulletin in force that day (Thursday 29 October's, 119), and the invoice on 5 November. October's re-close needs every October bulletin, since a USD line is now dated in it. Its book revaluation is current with no entry: the contract asset item is open at the end of October at 119, the closing rate itself, so its difference is zero (rule 15). The schedule recognised October as elapsed, so `releases_posted` asks no October release. November's release is out of this case.

```yaml
case: a late invoice with October closed is held SERVICE_PERIOD_CLOSED; October reopened, its 12 days post as a contract asset on 31 Oct at 119 and the invoice on 5 Nov; October closed again, its revaluation current with no entry
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  # every October publication day at 119
  - { date: 2026-10-01, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-04, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-05, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-06, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-07, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-08, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-11, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-12, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-13, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-14, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-15, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-18, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-19, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-20, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-21, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-22, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-25, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-26, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-27, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-28, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-10-29, base: USD, quote: SYP, rate: "119.0000", type: bulletin }
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "120.5000", type: bulletin }
  - { date: 2026-09-01, base: USD, quote: SYP, rate: "125.0000", type: market }
steps:
  - manual: an October software subscription the owner paid in SYP
    accounting_date: 2026-10-15
    payload: { lines: [{ account: "531004", currency: SYP, amount: 5000000 },
                       { account: "313001", currency: SYP, amount: -5000000 }] }
  - revalue: book
    period: 2026-10
  - close: 2026-10
    reason: "إقفال تشرين الأول"
  - event: invoice.issued
    accounting_date: 2026-11-05
    payload: { invoice: INV-2026-24, client: C1, contract: { code: R1, kind: retainer, client: C1 },
               currency: USD, syp_per_usd: "121.0000", issued_on: 2026-11-05, due_on: 2026-11-20,
               lines: [{ line: L1, amount: 62000, source: retainer_charge, kind: monthly,
                         cycle_start: 2026-10-20, cycle_end: 2026-11-19, service: S1 }] }
    outcome: { status: held, reason: SERVICE_PERIOD_CLOSED }
  - reopen: 2026-10
    reason: "فاتورة الاشتراك الشهري صدرت متأخرة ويُعترف بأيام تشرين الأول في شهرها"
  - close: 2026-10
    reason: "إعادة إقفال تشرين الأول"
expect:
  entries:
    - source: manual
      date: 2026-10-15
      lines:
        - { account: "531004", currency: SYP, amount: 5000000, book: 5000000, parallel: 40000 }
        - { account: "313001", currency: SYP, amount: -5000000, book: -5000000, parallel: -40000 }
    - source: invoice.issued
      date: 2026-10-31
      lines:
        # retried by the reopen; elapsed October: 62,000 × 12 / 31 = 24,000; 240.00 USD × 119 (in force
        #   on Saturday 31 Oct) = 28,560.00 SYP
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
        # book residual: 7,471,000 − 2,856,000 − 4,579,000 = 36,000 → a realised gain of 360.00 SYP
        - { account: "421001", currency: SYP, amount: -36000, book: -36000, parallel: 0 }
    # October's re-close: INV-2026-24/1 open on 31 Oct, 240.00 × 119 = 28,560.00 against carrying
    #   28,560.00: difference 0, current with no entry
  balances:
    - { account: "411001", book: -2856000, parallel: -24000 }
    - { account: "421001", book: -36000, parallel: 0 }
    - { account: "421002", book: 0, parallel: 0 }
  open_items:
    - { item: INV-2026-24/1, account: "113001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: INV-2026-24, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 62000, book: 7471000, parallel: 62000 }
```

### SYP books only: closed in order across a month with no posting

October and December have SYP expenses; November has no posting, so it has no period row. Closing December is refused `PERIOD_ORDER`, naming October; once October is closed, it is refused again, naming November: a month between the first period and December is open whether or not it has a row. November is closed empty (it gets its row at its close, rule 2), then December. With no foreign currency, every revaluation is current with no entry, and the bulletin items have nothing to read.

```yaml
case: SYP books only; December refused PERIOD_ORDER naming October, then November, which has no posting; October, November and December closed in order
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
steps:
  - manual: an October software subscription the owner paid
    accounting_date: 2026-10-15
    payload: { lines: [{ account: "531004", currency: SYP, amount: 5000000 },
                       { account: "313001", currency: SYP, amount: -5000000 }] }
  - manual: a December repair the owner paid
    accounting_date: 2026-12-10
    payload: { lines: [{ account: "531006", currency: SYP, amount: 3000000 },
                       { account: "313001", currency: SYP, amount: -3000000 }] }
  - revalue: book
    period: 2026-12
  - close: 2026-12
    reason: "إقفال كانون الأول"
    outcome: { status: refused, reason: PERIOD_ORDER, detail: "period:2026-10" }
  - close: 2026-10
    reason: "إقفال تشرين الأول"
  - close: 2026-12
    reason: "إقفال كانون الأول"
    outcome: { status: refused, reason: PERIOD_ORDER, detail: "period:2026-11" }
  - close: 2026-11
    reason: "إقفال تشرين الثاني بلا حركات"
  - close: 2026-12
    reason: "إقفال كانون الأول"
expect:
  entries:
    - source: manual
      date: 2026-10-15
      lines:
        - { account: "531004", currency: SYP, amount: 5000000, book: 5000000 }
        - { account: "313001", currency: SYP, amount: -5000000, book: -5000000 }
    - source: manual
      date: 2026-12-10
      lines:
        - { account: "531006", currency: SYP, amount: 3000000, book: 3000000 }
        - { account: "313001", currency: SYP, amount: -3000000, book: -3000000 }
    # the December revaluation (step 3) finds no foreign balance: no entry, no reversal
  balances:
    - { account: "313001", book: -8000000 }
```

### SYP books only: an event the reopen's retry leaves held blocks the re-close

The SYP invoice INV-2026-40 posts in November, which closes. A payment of 650,000.00 SYP for it, dated 27 November, arrives after the close: held `PERIOD_CLOSED`, the first reason it fails in S05 rule 8's order. November is reopened and the payment is retried: it is no longer in a closed period, but Hub applied 600,000.00 of it, so it is held `NEEDS_DECISION` (`amount_above_applied`), which the accountant's retry confirms. The re-close is refused on `no_held_events`. The accountant posts the payment by hand, the applied part to the invoice's item and the 50,000.00 SYP excess to other payables (IFRS 15.106, as in `inbox/holds-and-actions.md`), dated in the reopened month, and resolves the event with it. November closes again.

```yaml
case: SYP books only; a payment held PERIOD_CLOSED is retried by the reopen and held NEEDS_DECISION; the re-close refused on no_held_events until it is resolved by a manual entry
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
steps:
  - event: invoice.issued
    accounting_date: 2026-11-10
    payload: { invoice: INV-2026-40, client: C1, currency: SYP, syp_per_usd: "122.0000",
               issued_on: 2026-11-10, due_on: 2026-12-10,
               lines: [{ line: L1, amount: 60000000, source: extra_work, service: S1 }] }
  - revalue: book
    period: 2026-11
  - close: 2026-11
    reason: "إقفال تشرين الثاني"
  - event: payment.recorded
    accounting_date: 2026-11-27
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-40, paid_on: 2026-11-27,
               method: bank_transfer, currency: SYP, amount: 65000000, syp_per_usd: "122.0000",
               applied_amount: 60000000, invoice_currency: SYP }
    outcome: { status: held, reason: PERIOD_CLOSED }
  - reopen: 2026-11
    reason: "دفعة العميل C1 في 27 تشرين الثاني وصلت بعد الإقفال"
  - retry: 4
    outcome: { status: held, reason: NEEDS_DECISION, detail: amount_above_applied }
  - close: 2026-11
    reason: "إعادة إقفال تشرين الثاني"
    outcome: { status: refused, reason: CHECKLIST_FAILED, detail: no_held_events }
  - manual: the payment PAY-1 by hand, the excess as a liability to the client
    accounting_date: 2026-11-27
    payload: { reference: R-2026-1,
               lines: [{ account: "111003", currency: SYP, amount: 65000000 },
                       { account: "112001", currency: SYP, amount: -60000000, item: INV-2026-40,
                         memo: "تسوية يدوية لدفعة PAY-1 المعلّقة" },
                       { account: "211003", currency: SYP, amount: -5000000, memo: "دفعة زائدة من العميل C1 — PAY-1" }] }
  - resolve: { step: 4, entry: 2 }
    reason: "الزيادة 50,000 ليرة التزام للعميل وليست سداداً"
  - close: 2026-11
    reason: "إعادة إقفال تشرين الثاني بعد تسوية الدفعة"
expect:
  entries:
    - source: invoice.issued
      date: 2026-11-10
      lines:
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 60000000, book: 60000000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -60000000, book: -60000000 }
    - source: manual
      date: 2026-11-27
      lines:
        - { account: "111003", currency: SYP, amount: 65000000, book: 65000000 }
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: -60000000, book: -60000000 }
        - { account: "211003", currency: SYP, amount: -5000000, book: -5000000 }
  balances:
    - { account: "111003", book: 65000000 }
    - { account: "211003", book: -5000000 }
  open_items:
    - { item: INV-2026-40, account: "112001", dims: { client: C1 }, currency: SYP, amount: 0, book: 0 }
```

### USD books with an SYP parallel ledger: a missing bulletin of SYP

USD books at the bulletin hold the SYP invoice M-1, revalued at 125 on 30 November (a loss in the USD books). The bulletin of Tuesday 17 November is not recorded: no line is dated that day, but M-1 is an SYP balance of the month, so the close is refused on `bulletins_recorded` alone; the closing rate is recorded and the revaluation is current. Once the bulletin is recorded (it changes no posted line), November closes. The SYP parallel ledger, at the market rate, holds no USD balance and is not read by the bulletin items.

```yaml
case: USD books; M-1 of 1,200,000.00 SYP revalued at 125 (−400.00 USD); the close refused on bulletins_recorded for 17 Nov, then closed once it is recorded
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  # every November publication day at 120, except Tuesday 17 (recorded by step 4); 125 on Monday 30 November
  - { date: 2026-11-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-04, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-09, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-11, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-12, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-16, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-18, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-22, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-23, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-24, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-26, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-29, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - manual: invoice M-1 to client C1 in SYP
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "112001", dims: { client: C1 }, currency: SYP, amount: 120000000,
                         open_item: { ref: M-1, due: 2026-12-03 } },
                       { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -120000000 }] }
  - revalue: book
    period: 2026-11
  - close: 2026-11
    reason: "إقفال تشرين الثاني"
    outcome: { status: refused, reason: CHECKLIST_FAILED, detail: bulletins_recorded }
  - rate: { date: 2026-11-17, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - close: 2026-11
    reason: "إقفال تشرين الثاني بعد تسجيل نشرة 17 تشرين الثاني"
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        # book: 1,200,000.00 SYP / 120 = 10,000.00 USD; parallel: SYP as is
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 120000000, book: 1000000, parallel: 120000000 }
        - { account: "411001", dims: { client: C1, service: S1 }, currency: SYP, amount: -120000000, book: -1000000, parallel: -120000000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # 1,200,000.00 / 125 = 9,600.00 USD; carrying 10,000.00; difference −400.00 USD (a loss)
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 0, book: -40000, parallel: 0 }
        - { account: "541002", currency: USD, amount: 40000, book: 40000, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1 }, currency: SYP, amount: 0, book: 40000, parallel: 0 }
        - { account: "541002", currency: USD, amount: -40000, book: -40000, parallel: 0 }
  balances:
    - { account: "541002", book: 0, parallel: 0 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1 }, currency: SYP, amount: 120000000, book: 1000000, parallel: 120000000 }
```

### A third currency: a missing USD/TRY bulletin while every USD/SYP bulletin is recorded

TRY cash of 2,000.00 is measured in the SYP books through the cross (TRY→USD at the USD/TRY bulletin, then USD→SYP at the USD/SYP bulletin, one exact product rounded once; ADR 0007) and in the USD parallel ledger at the direct USD/TRY market rate. Both ledgers revalue it at the end of November: the book at 125 / 42, the parallel at the market rate of the 27th, 41. The USD/TRY bulletin of Tuesday 17 November is not recorded: every USD/SYP bulletin is, but the TRY books need both quotes of the cross on every publication day, so the close is refused on `bulletins_recorded` alone. Once it is recorded, November closes.

```yaml
case: TRY cash revalued in both ledgers (−47.62 SYP, −1.22 USD); the close refused on bulletins_recorded for the USD/TRY bulletin of 17 Nov, then closed once it is recorded
company: { shape: third, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "111007", name: "الصندوق — ليرة تركية", name_latin: "Cash on hand — TRY",
                        currency: TRY, monetary: true, statement_line: bs.cash }] }
rates:
  # every November publication day: USD/SYP at 120 and 125 on the 30th; USD/TRY at 40 and 42 on the
  #   30th, except Tuesday 17 (recorded by step 5)
  - { date: 2026-11-01, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-04, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-05, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-09, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-11, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-12, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-15, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-16, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-17, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-18, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-22, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-23, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-24, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-26, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-29, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2026-11-01, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-03, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-04, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-05, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-08, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-09, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-11, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-12, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-15, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-16, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-18, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-22, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-23, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-24, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-26, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-29, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - { date: 2026-11-30, base: USD, quote: TRY, rate: "42.0000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: TRY, rate: "40.0000", type: market }
  - { date: 2026-11-27, base: USD, quote: TRY, rate: "41.0000", type: market }
steps:
  - manual: the owner pays TRY into the cash box
    accounting_date: 2026-11-03
    payload: { lines: [{ account: "111007", currency: TRY, amount: 200000 },
                       { account: "313001", currency: TRY, amount: -200000 }] }
  - revalue: book
    period: 2026-11
  - revalue: parallel
    period: 2026-11
  - close: 2026-11
    reason: "إقفال تشرين الثاني"
    outcome: { status: refused, reason: CHECKLIST_FAILED, detail: bulletins_recorded }
  - rate: { date: 2026-11-17, base: USD, quote: TRY, rate: "40.0000", type: bulletin }
  - close: 2026-11
    reason: "إقفال تشرين الثاني بعد تسجيل نشرة الليرة التركية"
expect:
  entries:
    - source: manual
      date: 2026-11-03
      lines:
        # book: 200,000 × 120 / 40 = 600,000 exactly (6,000.00 SYP); parallel: 200,000 / 40 = 5,000 (50.00 USD)
        - { account: "111007", currency: TRY, amount: 200000, book: 600000, parallel: 5000 }
        - { account: "313001", currency: TRY, amount: -200000, book: -600000, parallel: -5000 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # book: 200,000 × 125 / 42 = 595,238.095… → 595,238; carrying 600,000; difference −4,762 (−47.62 SYP)
        - { account: "111007", currency: TRY, amount: 0, book: -4762, parallel: 0 }
        - { account: "541002", currency: SYP, amount: 4762, book: 4762, parallel: 0 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111007", currency: TRY, amount: 0, book: 4762, parallel: 0 }
        - { account: "541002", currency: SYP, amount: -4762, book: -4762, parallel: 0 }
    - source: revaluation
      date: 2026-11-30
      lines:
        # parallel: 200,000 / 41 (the market rate of 27 Nov, the newest) = 4,878.048… → 4,878; carrying
        #   5,000; difference −122 (−1.22 USD)
        - { account: "111007", currency: TRY, amount: 0, book: 0, parallel: -122 }
        - { account: "541002", currency: USD, amount: 122, book: 0, parallel: 122 }
    - source: reversal
      date: 2026-12-01
      lines:
        - { account: "111007", currency: TRY, amount: 0, book: 0, parallel: 122 }
        - { account: "541002", currency: USD, amount: -122, book: 0, parallel: -122 }
  balances:
    - { account: "111007", book: 600000, parallel: 5000 }
    - { account: "541002", book: 0, parallel: 0 }
```
