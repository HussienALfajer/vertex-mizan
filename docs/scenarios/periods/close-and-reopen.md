# Closing and reopening a period

Status: Approved (owner, 2026-11-12)

S07 wrote these cases (S07 "Scenarios"); the owner approved their expected entries and outcomes, and the readings of the checklist items below, on 2026-11-12. S07's feature slice brought the `revalue` executor (PR 1) and the `close`, `reopen`, `draft` and `discard` executors (PR 2), with no expected value changed.

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
