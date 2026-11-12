# The opening entry

Status: Approved (owner, 2026-11-12)

S10 wrote these cases (S10 "Scenarios"); the owner approved their expected entries and outcomes on 2026-11-12: seven cases, then, after the accounting review, the eighth, a company without Hub opening its receivables on `112001`, with the owner's decision on S10 rule 12 of the same day (Hub's slots refuse the accountant's lines only in a company with a Hub client, an API client holding `events:write` or `opening:write`). They stay `Proposed` until S10's feature slice brings the executors of the `opening` and `reverse_opening` steps and of the company's `books_start`, then become `Approved (owner, 2026-11-12)` (`docs/scenarios/README.md`, "Status").

## Rule

A company with a books start posts nothing until its opening is posted (`OPENING_NOT_POSTED`): no Hub event, manual entry, revaluation, release or close. The opening is one entry, source `opening`, dated on the books start and posted by the owner once every check passes (`OPENING_CHECKS_FAILED` names the failing checks). It holds the balance sheet only, as of the eve of the books start:
- **Hub's part**, from its snapshot: a receivable item per invoice with an outstanding amount, a contract asset item per milestone done and not invoiced, and an ad funds item per client wallet, each monetary and measured at each ledger's policy rate in force on the eve; and a contract liability line per invoice line whose recognition is unfinished, at what S06's rules would leave of it at the end of the eve had the invoice posted on its date at its rates;
- **the records' part**, typed by the accountant: monetary balances measured as Hub's items are; non-monetary and equity balances `stated`, their book and parallel amounts typed from the records; the year's result before the books start on `312002`;
- **the balancing figure** on retained earnings `312001`, in the book currency, each ledger's remainder on its own, with no rounding line.

The opening may be reversed whole while it is the company's only entry; the reversal negates every line on the books start and the company is again without an opening. From the commit of the opening, Hub's events post as for any document: S06 releases the opening's schedules, S07 revalues its monetary items at month end from their opening carrying amounts, and a payment clears an opening receivable at its carrying amount with its realised difference.

## Basis

- **IAS 1.54:** the opening entry carries the statement of financial position as of the eve, line by line; no revenue or expense is posted (owner, 2026-11-12): what was recognised before the books start is in equity, on `312002` for the current fiscal year and `312001` for earlier ones.
- **IAS 21.23(a):** foreign-currency monetary items (cash, receivables, contract assets, client ad funds held, payables) are measured at the closing rate of the eve, each ledger's policy rate in force then. **IAS 21.23(b):** non-monetary items (equipment, equity) keep their historical rates, hence `stated` amounts from the records. **IAS 21.16, 21.23(b) and IFRIC 22:** a contract liability is non-monetary and stays at the rates of its invoice's issue.
- **IFRS 15.106 and 15.39–41:** the contract liability of an over-time line is its amount less the share of its cycle's days elapsed through the eve; a deposit or milestone line stays whole until its milestone is done (IFRS 15.38). **IFRS 15.107:** a milestone done and not invoiced is a contract asset.
- **IAS 21.28:** a payment after the books start realises the difference from the opening's carrying amount.
- **Company policy:** `phase-1-scope.md` §4 ("Start of the books": opening balances on 2026-10-01 with Hub's open documents from its snapshot; the book ledger at the Central Bank bulletin, the USD parallel ledger at the market rate or Hub's own rate) and F12; S10 rules 3, 11–13, 17–19, 23–25 and "Accounting treatment" (owner, 2026-11-12); ADR 0019; ADR 0007 "New measurements versus carried amounts"; S06 rules 3, 6 and 11; S07 rules 10–18.
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting. The calendar fiscal year that `312002` belongs to is CONFIRMED (Income Tax Law 24/2003). No tax rule is applied.

## Cases

The account codes are the service-agency template's (S02), in the new version with `312002` (S10 "Data"): the SYP and USD cash on hand `111001` and `111002`, the USD bank account `111004`, trade receivables `112001` and contract assets `113001` (document control accounts, monetary), computers and equipment `121001` and their accumulated depreciation `121003` (non-monetary), other payables `211003` (monetary), contract liabilities `212001` (client and contract, non-monetary), client ad funds held `213001` (a running control account, USD only, monetary), capital `311001`, retained earnings `312001` (role `retained_earnings`), the result of the year before the books start `312002` (role `pre_opening_result`), service revenue `411001`, rent `531001`, realised exchange gains `421001`, unrealised exchange gains `421002` and losses `541002`. The `third` case adds a TRY cash account `111007` (monetary, restricted to TRY, statement line `bs.cash`). Every rate and amount is synthetic.

Every case's books start is Thursday 1 October 2026, so its eve (`as_of`) is Wednesday 30 September, a publication day; 10, 15, 21 and 30 September and 20 and 29 October 2026 are publication days, and Saturday 31 October takes Thursday 29 October's bulletin.

**The `opening` step** (`docs/scenarios/README.md`) is the owner's posting of the opening from its preview, with its fingerprint (S10 rules 20–23): Hub's snapshot as the API stores it (short form: an invoice as `invoice.issued`'s payload with its `total` and `outstanding`; a credit line of an invoice not in `invoices`, with that invoice's number, date and rate; a milestone with its project, installment and `done_on` if done by the eve; a wallet's USD balance as Hub shows it, funds held positive), then the accountant's lines and the records' figures, saved, then the post. A refused post (`OPENING_CHECKS_FAILED`) leaves the draft as saved. A step without `snapshot` is a company with no Hub client (no API client holding `events:write` or `opening:write`, S10 rules 10 and 12).

**Items and schedules:** a receivable item is named by Hub's invoice number, a contract asset item by Hub's milestone number, both with the client and the contract an `invoice.issued` or `milestone.done` gives them, and a running ad funds item by the client's code. A schedule's opening line carries the client and the contract, as S06's deferral does. A schedule from the opening gets two movements on the opening entry (S10 rule 13): `deferred`, the line's amount at its rates of issue, and `before_opening`, minus what S06 would have taken off it through the eve: its releases and, after a credit (case 2), the credit's liability part; the opening line is their sum. The movements are not in the expected entries; the integrity check holds them equal to the line.

**The October that follows:** S06's job for October releases what remains of each opening schedule's cycle in October (cumulative from the cycle's start), in the order of the opening's lines, at the amounts the schedule carries. S07's revaluation of October revalues the opening's monetary items from their opening carrying amounts at the rates of 31 October.

**The lines' order** in the opening (S10 rule 23) is Hub's items by slot and number, the schedules, the accountant's lines and the balancing line; the runner compares the lines of an entry in any order.

The cases leave out what other scenarios and tests own:
- events about documents dated before the books start, held `NEEDS_DECISION` (`before_books_start`), a backdated event held `PERIOD_CLOSED`, and the service reclassification of an opening schedule (`opening/before-books-start.md`);
- the year's result with `312002` and the trial balance's opening column (`reports/statement-presentation.md`);
- the snapshot's validation, idempotency and refusals after posting, the checks `snapshot`, `mappings`, `schedules` and `lines`, a line refused on one of Hub's slots, and the races of S10 "Abuse and failure cases" (API tests);
- property tests: the opening's schedules equal what S06's functions leave after posting the same invoices on their dates, for any cycles, credits and eves; the entry balances in both ledgers for any snapshot and lines; the balancing figure is the only remainder; the opening and its reversal net to zero on every account, item and schedule.

### Vertex Media: the spec's example, refused until the opening posts, then October

S10's worked example and acceptance steps 1–5. Before the opening, Hub's payment and the accountant's first October entry are refused `OPENING_NOT_POSTED`. The first post fails two checks: the records' receivable figure for C1 is missing, and the bulletin of 30 September is not recorded. Once both are fixed, the opening posts the example's seven lines; then the rent, the payment of INV-2026-7 (a 900.00 SYP realised gain over its opening carrying amount) and October's release of the cycle's last 15 days.

```yaml
case: the S10 worked example; refused before the opening, a failed post (records_agree, rates), then the opening, the rent, the payment with a 900.00 SYP gain and October's release
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency, books_start: 2026-10-01,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-09-10, base: USD, quote: SYP, rate: "114.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "118.0000", type: market }
  - { date: 2026-10-20, base: USD, quote: SYP, rate: "118.0000", type: bulletin }
steps:
  - event: payment.recorded
    accounting_date: 2026-10-20
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-7, paid_on: 2026-10-20,
               method: bank_transfer, currency: USD, amount: 30000, syp_per_usd: "119.0000",
               applied_amount: 30000, invoice_currency: USD }
    outcome: { status: refused, reason: OPENING_NOT_POSTED }
  - manual: October's rent paid in SYP cash
    accounting_date: 2026-10-05
    payload: { lines: [{ account: "531001", currency: SYP, amount: 10000000 },
                       { account: "111001", currency: SYP, amount: -10000000 }] }
    outcome: { status: refused, reason: OPENING_NOT_POSTED }
  - opening: Vertex Media's opening, the records' receivable figure not entered
    snapshot:
      invoices:
        - { invoice: INV-2026-7, client: C1, contract: { code: R1, kind: retainer, client: C1 },
            currency: USD, syp_per_usd: "117.0000", issued_on: 2026-09-10, due_on: 2026-09-25,
            total: 30000, outstanding: 30000,
            lines: [{ line: L1, amount: 30000, source: retainer_charge, kind: monthly,
                      cycle_start: 2026-09-16, cycle_end: 2026-10-15, service: S1 }] }
      wallets:
        - { client: C1, balance: 50000 }
    records:
      lines:
        - { account: "111001", currency: SYP, amount: 200000000 }
        - { account: "311001", currency: SYP, amount: -100000000, parallel: -1000000 }
        - { account: "312002", currency: SYP, amount: -30000000, parallel: -260000 }
      figures:
        - { slot: ad_funds, client: C1, currency: USD, amount: 50000 }
    outcome: { status: refused, reason: OPENING_CHECKS_FAILED, detail: "records_agree,rates" }
  - rate: { date: 2026-09-30, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - opening: Vertex Media's opening, the figure entered
    snapshot:
      invoices:
        - { invoice: INV-2026-7, client: C1, contract: { code: R1, kind: retainer, client: C1 },
            currency: USD, syp_per_usd: "117.0000", issued_on: 2026-09-10, due_on: 2026-09-25,
            total: 30000, outstanding: 30000,
            lines: [{ line: L1, amount: 30000, source: retainer_charge, kind: monthly,
                      cycle_start: 2026-09-16, cycle_end: 2026-10-15, service: S1 }] }
      wallets:
        - { client: C1, balance: 50000 }
    records:
      lines:
        - { account: "111001", currency: SYP, amount: 200000000 }
        - { account: "311001", currency: SYP, amount: -100000000, parallel: -1000000 }
        - { account: "312002", currency: SYP, amount: -30000000, parallel: -260000 }
      figures:
        - { slot: receivable, client: C1, currency: USD, amount: 30000 }
        - { slot: ad_funds, client: C1, currency: USD, amount: 50000 }
  - manual: October's rent paid in SYP cash
    accounting_date: 2026-10-05
    payload: { lines: [{ account: "531001", currency: SYP, amount: 10000000 },
                       { account: "111001", currency: SYP, amount: -10000000 }] }
  - event: payment.recorded
    accounting_date: 2026-10-20
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-7, paid_on: 2026-10-20,
               method: bank_transfer, currency: USD, amount: 30000, syp_per_usd: "119.0000",
               applied_amount: 30000, invoice_currency: USD }
  - job: revenue_release_month
    period: 2026-10
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        # INV-2026-7's outstanding 300.00 USD, monetary: × 115 (bulletin of the eve) = 34,500.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 30000, book: 3450000, parallel: 30000 }
        # C1's wallet, 500.00 USD held, monetary: × 115 = 57,500.00 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -50000, book: -5750000, parallel: -50000 }
        # the cycle 16 Sep to 15 Oct is 30 days, 15 before the books start; deferred 300.00 × 114 (bulletin of
        #   issue) = 34,200.00 SYP; less 15/30: 30,000 × 15 / 30 = 15,000; book 3,420,000 × 15 / 30 = 1,710,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -15000, book: -1710000, parallel: -15000 }
        # monetary, in the book's currency; parallel: 2,000,000.00 / 118 (market of the eve) = 16,949.152… → 16,949.15
        - { account: "111001", currency: SYP, amount: 200000000, book: 200000000, parallel: 1694915 }
        # stated from the records
        - { account: "311001", currency: SYP, amount: -100000000, book: -100000000, parallel: -1000000 }
        - { account: "312002", currency: SYP, amount: -30000000, book: -30000000, parallel: -260000 }
        # balancing: book −(3,450,000 − 5,750,000 − 1,710,000 + 200,000,000 − 100,000,000 − 30,000,000) = −65,990,000;
        #   parallel −(30,000 − 50,000 − 15,000 + 1,694,915 − 1,000,000 − 260,000) = −399,915
        - { account: "312001", currency: SYP, amount: -65990000, book: -65990000, parallel: -399915 }
    - source: manual
      date: 2026-10-05
      lines:
        # parallel: 100,000.00 / 118 (the market rate in force, of 30 Sep) = 847.457… → 847.46
        - { account: "531001", currency: SYP, amount: 10000000, book: 10000000, parallel: 84746 }
        - { account: "111001", currency: SYP, amount: -10000000, book: -10000000, parallel: -84746 }
    - source: payment.recorded
      date: 2026-10-20
      lines:
        # bank_transfer in USD → 111004; book: 300.00 × 118 = 35,400.00 SYP
        - { account: "111004", currency: USD, amount: 30000, book: 3540000, parallel: 30000 }
        # the opening item cleared at its carrying 34,500.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: -30000, book: -3450000, parallel: -30000 }
        # book residual 3,540,000 − 3,450,000 = 90,000 → a realised gain of 900.00 SYP; parallel none
        - { account: "421001", currency: SYP, amount: -90000, book: -90000, parallel: 0 }
    - source: revenue_release
      date: 2026-10-31
      lines:
        # the cycle's last 15 days, at the amounts the schedule carries: 15,000; book 3,420,000 − 1,710,000 = 1,710,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 15000, book: 1710000, parallel: 15000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -15000, book: -1710000, parallel: -15000 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -1710000, parallel: -15000 }
    - { account: "421001", book: -90000, parallel: 0 }
    - { account: "312001", book: -65990000, parallel: -399915 }
    # 2,000,000.00 − 100,000.00; parallel 16,949.15 − 847.46
    - { account: "111001", book: 190000000, parallel: 1610169 }
  open_items:
    - { item: INV-2026-7, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: -50000, book: -5750000, parallel: -50000 }
```

### Vertex Media: every kind of Hub balance, with October's done, release and revaluation

The snapshot holds:
- **INV-2026-11** to C1 (retainer R1), 600.00 USD at the bulletin of 114, unpaid, for the cycle 11 September to 10 October (30 days, 20 before the books start); on 24 September, invoice INV-2026-12 (paid in full, so not in `invoices`) credited the cycle 60.00 USD. As of the credit no month of the cycle had ended, so all of it reduces the liability at its carried amounts (S06 rule 6), and September then releases 20/30 of the 540.00 USD left;
- **INV-2026-8** to C1 (project P1), a 200.00 USD deposit at the bulletin of 114.5, paid in full and its milestone MS-1 not done: a schedule and no receivable (S10 edge case 1); MS-1 is done on 12 October, releasing it (edge case 5);
- **INV-2026-10** to C2 (retainer R2), 120,000.00 SYP at Hub's 116, half paid in SYP, for the cycle 21 September to 20 October (30 days, 10 before the books start): an SYP receivable and an SYP schedule in the USD parallel ledger (edge case 3);
- **MS-2** of C2's project P2, 400.00 USD, done on 25 September and not invoiced: a contract asset;
- C1's wallet at 250.00 USD held and C2's at −120.00 USD, spent beyond its deposits (edge case 4).

The records hold the SYP cash, the USD bank, the computers (a non-monetary asset, stated), the capital, and a loss of 150,000.00 SYP for 1 January to 30 September (edge case 20).

```yaml
case: deposit, contract asset, negative wallet, a credit before the eve, an SYP invoice half paid, a stated asset and a loss before the books start; October's done, release and revaluation of both ledgers
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency, books_start: 2026-10-01,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-09-10, base: USD, quote: SYP, rate: "114.0000", type: bulletin }
  - { date: 2026-09-15, base: USD, quote: SYP, rate: "114.5000", type: bulletin }
  - { date: 2026-09-21, base: USD, quote: SYP, rate: "114.8000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "118.0000", type: market }
  - { date: 2026-10-29, base: USD, quote: SYP, rate: "117.0000", type: bulletin }
  - { date: 2026-10-29, base: USD, quote: SYP, rate: "120.0000", type: market }
steps:
  - opening: Vertex Media's opening with every kind of Hub balance
    snapshot:
      invoices:
        - { invoice: INV-2026-8, client: C1, contract: { code: P1, kind: project, client: C1 },
            currency: USD, syp_per_usd: "117.5000", issued_on: 2026-09-15, due_on: 2026-09-30,
            total: 20000, outstanding: 0,
            lines: [{ line: L1, amount: 20000, source: deposit, milestone: MS-1, service: S1 }] }
        - { invoice: INV-2026-10, client: C2, contract: { code: R2, kind: retainer, client: C2 },
            currency: SYP, syp_per_usd: "116.0000", issued_on: 2026-09-21, due_on: 2026-10-05,
            total: 12000000, outstanding: 6000000,
            lines: [{ line: L1, amount: 12000000, source: retainer_charge, kind: monthly,
                      cycle_start: 2026-09-21, cycle_end: 2026-10-20, service: S2 }] }
        - { invoice: INV-2026-11, client: C1, contract: { code: R1, kind: retainer, client: C1 },
            currency: USD, syp_per_usd: "117.0000", issued_on: 2026-09-10, due_on: 2026-09-25,
            total: 60000, outstanding: 60000,
            lines: [{ line: L1, amount: 60000, source: retainer_charge, kind: monthly,
                      cycle_start: 2026-09-11, cycle_end: 2026-10-10, service: S1 }] }
      credits:
        - { invoice: INV-2026-12, client: C1, contract: { code: R1, kind: retainer, client: C1 },
            currency: USD, syp_per_usd: "117.5000", issued_on: 2026-09-24,
            line: L2, amount: -6000, source: retainer_charge, kind: credit, cycle_start: 2026-09-11, service: S1 }
      milestones:
        - { milestone: MS-1, project: { code: P1, kind: project, client: C1 }, client: C1,
            currency: USD, amount: 20000, service: S1 }
        - { milestone: MS-2, project: { code: P2, kind: project, client: C2 }, client: C2,
            currency: USD, amount: 40000, service: S2, done_on: 2026-09-25 }
      wallets:
        - { client: C1, balance: 25000 }
        - { client: C2, balance: -12000 }
    records:
      lines:
        - { account: "111001", currency: SYP, amount: 50000000 }
        - { account: "111004", currency: USD, amount: 100000 }
        - { account: "121001", currency: SYP, amount: 300000000, parallel: 2500000 }
        - { account: "311001", currency: SYP, amount: -300000000, parallel: -3000000 }
        - { account: "312002", currency: SYP, amount: 15000000, parallel: 130000 }
      figures:
        - { slot: receivable, client: C1, currency: USD, amount: 60000 }
        - { slot: receivable, client: C2, currency: SYP, amount: 6000000 }
        - { slot: ad_funds, client: C1, currency: USD, amount: 25000 }
        - { slot: ad_funds, client: C2, currency: USD, amount: -12000 }
  - event: milestone.done
    accounting_date: 2026-10-12
    payload: { milestone: MS-1, client: C1, project: { code: P1, kind: project, client: C1 },
               currency: USD, amount: 20000, done_on: 2026-10-12, service: S1 }
  - job: revenue_release_month
    period: 2026-10
  - revalue: book
    period: 2026-10
  - revalue: parallel
    period: 2026-10
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        # receivables, monetary at the eve's rates
        # INV-2026-10: 60,000.00 SYP outstanding; parallel 60,000.00 / 118 = 508.474… → 508.47
        - { account: "112001", dims: { client: C2, contract: R2 }, currency: SYP, amount: 6000000, book: 6000000, parallel: 50847 }
        # INV-2026-11: 600.00 USD × 115 = 69,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 60000, book: 6900000, parallel: 60000 }
        # contract asset MS-2: 400.00 USD × 115 = 46,000.00 SYP (the eve's rate, not that of its done)
        - { account: "113001", dims: { client: C2, contract: P2 }, currency: USD, amount: 40000, book: 4600000, parallel: 40000 }
        # ad funds: C1 250.00 USD held × 115 = 28,750.00 SYP, a credit
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -25000, book: -2875000, parallel: -25000 }
        # C2 −120.00 USD, spent beyond its deposits: a debit, 120.00 × 115 = 13,800.00 SYP
        - { account: "213001", dims: { client: C2 }, currency: USD, amount: 12000, book: 1380000, parallel: 12000 }
        # schedules
        # INV-2026-8/L1, a deposit whose milestone is not done: all of it, 200.00 USD × 114.5 (bulletin of issue) = 22,900.00 SYP
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -20000, book: -2290000, parallel: -20000 }
        # INV-2026-10/L1: SYP as is in the book; parallel 120,000.00 / 116 (Hub's rate of issue) = 1,034.482… → 1,034.48;
        #   September's 10/30: 12,000,000 × 10 / 30 = 4,000,000 and 103,448 × 10 / 30 = 34,482.67 → 34,483;
        #   left 8,000,000 and 103,448 − 34,483 = 68,965
        - { account: "212001", dims: { client: C2, contract: R2 }, currency: SYP, amount: -8000000, book: -8000000, parallel: -68965 }
        # INV-2026-11/L1: 600.00 USD × 114 = 68,400.00 SYP; the credit of 24 Sep, nothing recognised by then, all to
        #   the liability at its carried amounts: 60.00 USD, 6,840,000 × 6,000 / 60,000 = 684,000; left 54,000 and 6,156,000;
        #   September's 20/30: 36,000 and 4,104,000; left 18,000 and 2,052,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -18000, book: -2052000, parallel: -18000 }
        # the records
        # SYP cash; parallel 500,000.00 / 118 = 4,237.288… → 4,237.29
        - { account: "111001", currency: SYP, amount: 50000000, book: 50000000, parallel: 423729 }
        # USD bank, monetary: 1,000.00 × 115 = 115,000.00 SYP
        - { account: "111004", currency: USD, amount: 100000, book: 11500000, parallel: 100000 }
        # computers, non-monetary: stated at their historical 25,000.00 USD
        - { account: "121001", currency: SYP, amount: 300000000, book: 300000000, parallel: 2500000 }
        - { account: "311001", currency: SYP, amount: -300000000, book: -300000000, parallel: -3000000 }
        # the year's loss before the books start: a debit
        - { account: "312002", currency: SYP, amount: 15000000, book: 15000000, parallel: 130000 }
        # balancing: book −(6,000,000 + 6,900,000 + 4,600,000 − 2,875,000 + 1,380,000 − 2,290,000 − 8,000,000 − 2,052,000
        #   + 50,000,000 + 11,500,000 + 300,000,000 − 300,000,000 + 15,000,000) = −80,163,000;
        #   parallel −(50,847 + 60,000 + 40,000 − 25,000 + 12,000 − 20,000 − 68,965 − 18,000 + 423,729 + 100,000
        #   + 2,500,000 − 3,000,000 + 130,000) = −184,611
        - { account: "312001", currency: SYP, amount: -80163000, book: -80163000, parallel: -184611 }
    - source: milestone.done
      date: 2026-10-12
      lines:
        # the deposit's opening schedule released at what it carries; no rate read
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 20000, book: 2290000, parallel: 20000 }
        - { account: "411001", dims: { client: C1, contract: P1, service: S1 }, currency: USD, amount: -20000, book: -2290000, parallel: -20000 }
    - source: revenue_release
      date: 2026-10-31
      lines:
        # INV-2026-10, its cycle ends on 20 Oct: all that remains, carried
        - { account: "212001", dims: { client: C2, contract: R2 }, currency: SYP, amount: 8000000, book: 8000000, parallel: 68965 }
        - { account: "411001", dims: { client: C2, contract: R2, service: S2 }, currency: SYP, amount: -8000000, book: -8000000, parallel: -68965 }
    - source: revenue_release
      date: 2026-10-31
      lines:
        # INV-2026-11, its cycle ends on 10 Oct: all that remains, carried
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 18000, book: 2052000, parallel: 18000 }
        - { account: "411001", dims: { client: C1, contract: R1, service: S1 }, currency: USD, amount: -18000, book: -2052000, parallel: -18000 }
    - source: revaluation
      date: 2026-10-31
      lines:
        # the book at the bulletin in force on Saturday 31 Oct, Thursday 29 Oct's 117
        # INV-2026-11: 600.00 × 117 = 70,200.00; carrying 69,000.00; +1,200.00, a gain
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: 120000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -120000, book: -120000, parallel: 0 }
        # MS-2: 400.00 × 117 = 46,800.00; carrying 46,000.00; +800.00, a gain
        - { account: "113001", dims: { client: C2, contract: P2 }, currency: USD, amount: 0, book: 80000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -80000, book: -80000, parallel: 0 }
        # C1's funds: −250.00 × 117 = −29,250.00; carrying −28,750.00; −500.00, a loss
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 0, book: -50000, parallel: 0 }
        - { account: "541002", currency: SYP, amount: 50000, book: 50000, parallel: 0 }
        # C2's funds: 120.00 × 117 = 14,040.00; carrying 13,800.00; +240.00, a gain
        - { account: "213001", dims: { client: C2 }, currency: USD, amount: 0, book: 24000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -24000, book: -24000, parallel: 0 }
        # 111004: 1,000.00 × 117 = 117,000.00; carrying 115,000.00; +2,000.00, a gain
        - { account: "111004", currency: USD, amount: 0, book: 200000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -200000, book: -200000, parallel: 0 }
        # SYP balances are in the book's currency; 212001, 121001 and equity are non-monetary
    - source: reversal
      date: 2026-11-01
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 0, book: -120000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 120000, book: 120000, parallel: 0 }
        - { account: "113001", dims: { client: C2, contract: P2 }, currency: USD, amount: 0, book: -80000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 80000, book: 80000, parallel: 0 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 0, book: 50000, parallel: 0 }
        - { account: "541002", currency: SYP, amount: -50000, book: -50000, parallel: 0 }
        - { account: "213001", dims: { client: C2 }, currency: USD, amount: 0, book: -24000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 24000, book: 24000, parallel: 0 }
        - { account: "111004", currency: USD, amount: 0, book: -200000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 200000, book: 200000, parallel: 0 }
    - source: revaluation
      date: 2026-10-31
      lines:
        # the parallel at the market rate of 29 Oct, 120, the newest on or before the 31st
        # INV-2026-10: 60,000.00 / 120 = 500.00; carrying 508.47; −8.47, a loss
        - { account: "112001", dims: { client: C2, contract: R2 }, currency: SYP, amount: 0, book: 0, parallel: -847 }
        - { account: "541002", currency: USD, amount: 847, book: 0, parallel: 847 }
        # 111001: 500,000.00 / 120 = 4,166.666… → 4,166.67; carrying 4,237.29; −70.62, a loss
        - { account: "111001", currency: SYP, amount: 0, book: 0, parallel: -7062 }
        - { account: "541002", currency: USD, amount: 7062, book: 0, parallel: 7062 }
        # USD balances are in the parallel's currency
    - source: reversal
      date: 2026-11-01
      lines:
        - { account: "112001", dims: { client: C2, contract: R2 }, currency: SYP, amount: 0, book: 0, parallel: 847 }
        - { account: "541002", currency: USD, amount: -847, book: 0, parallel: -847 }
        - { account: "111001", currency: SYP, amount: 0, book: 0, parallel: 7062 }
        - { account: "541002", currency: USD, amount: -7062, book: 0, parallel: -7062 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    # 2,290,000 + 8,000,000 + 2,052,000; parallel 20,000 + 68,965 + 18,000
    - { account: "411001", book: -12342000, parallel: -106965 }
    - { account: "421002", book: 0, parallel: 0 }
    - { account: "541002", book: 0, parallel: 0 }
    - { account: "312001", book: -80163000, parallel: -184611 }
    - { account: "312002", book: 15000000, parallel: 130000 }
  open_items:
    - { item: INV-2026-10, account: "112001", dims: { client: C2, contract: R2 }, currency: SYP, amount: 6000000, book: 6000000, parallel: 50847 }
    - { item: INV-2026-11, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 60000, book: 6900000, parallel: 60000 }
    - { item: MS-2, account: "113001", dims: { client: C2, contract: P2 }, currency: USD, amount: 40000, book: 4600000, parallel: 40000 }
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: -25000, book: -2875000, parallel: -25000 }
    - { item: C2, account: "213001", dims: { client: C2 }, currency: USD, amount: 12000, book: 1380000, parallel: 12000 }
```

### Vertex Media: the whole reversal and a new opening

S10 rule 25 and edge cases 24 and 25. The opening posts with a mistyped SYP cash balance (2,000,000.00 instead of 2,100,000.00). While it is the only entry, the owner reverses it whole: its reversal negates every line on the books start, and the company is again without an opening, so Hub's payment is refused. The new opening posts with the right balance, the payment then posts against the new item, and a second reversal is refused, since the opening is no longer the only entry.

```yaml
case: an opening reversed whole while it is the only entry; Hub refused again until the new opening posts; its reversal refused once the payment has posted
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency, books_start: 2026-10-01,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-09-10, base: USD, quote: SYP, rate: "114.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "118.0000", type: market }
  - { date: 2026-10-20, base: USD, quote: SYP, rate: "118.0000", type: bulletin }
steps:
  - opening: Vertex Media's opening, the SYP cash mistyped
    snapshot:
      invoices:
        - { invoice: INV-2026-7, client: C1, contract: { code: R1, kind: retainer, client: C1 },
            currency: USD, syp_per_usd: "117.0000", issued_on: 2026-09-10, due_on: 2026-09-25,
            total: 30000, outstanding: 30000,
            lines: [{ line: L1, amount: 30000, source: retainer_charge, kind: monthly,
                      cycle_start: 2026-09-16, cycle_end: 2026-10-15, service: S1 }] }
      wallets:
        - { client: C1, balance: 50000 }
    records:
      lines:
        - { account: "111001", currency: SYP, amount: 200000000 }
        - { account: "311001", currency: SYP, amount: -100000000, parallel: -1000000 }
        - { account: "312002", currency: SYP, amount: -30000000, parallel: -260000 }
      figures:
        - { slot: receivable, client: C1, currency: USD, amount: 30000 }
        - { slot: ad_funds, client: C1, currency: USD, amount: 50000 }
  - reverse_opening: "The SYP cash on hand was typed as 2,000,000.00 instead of 2,100,000.00"
  - event: payment.recorded
    accounting_date: 2026-10-20
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-7, paid_on: 2026-10-20,
               method: bank_transfer, currency: USD, amount: 30000, syp_per_usd: "119.0000",
               applied_amount: 30000, invoice_currency: USD }
    outcome: { status: refused, reason: OPENING_NOT_POSTED }
  - opening: Vertex Media's opening, the SYP cash corrected
    snapshot:
      invoices:
        - { invoice: INV-2026-7, client: C1, contract: { code: R1, kind: retainer, client: C1 },
            currency: USD, syp_per_usd: "117.0000", issued_on: 2026-09-10, due_on: 2026-09-25,
            total: 30000, outstanding: 30000,
            lines: [{ line: L1, amount: 30000, source: retainer_charge, kind: monthly,
                      cycle_start: 2026-09-16, cycle_end: 2026-10-15, service: S1 }] }
      wallets:
        - { client: C1, balance: 50000 }
    records:
      lines:
        - { account: "111001", currency: SYP, amount: 210000000 }
        - { account: "311001", currency: SYP, amount: -100000000, parallel: -1000000 }
        - { account: "312002", currency: SYP, amount: -30000000, parallel: -260000 }
      figures:
        - { slot: receivable, client: C1, currency: USD, amount: 30000 }
        - { slot: ad_funds, client: C1, currency: USD, amount: 50000 }
  - event: payment.recorded
    accounting_date: 2026-10-20
    payload: { payment: PAY-1, receipt: R-2026-1, invoice: INV-2026-7, paid_on: 2026-10-20,
               method: bank_transfer, currency: USD, amount: 30000, syp_per_usd: "119.0000",
               applied_amount: 30000, invoice_currency: USD }
  - reverse_opening: "A second correction"
    outcome: { status: refused, reason: OPENING_NOT_REVERSIBLE }
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        # as the first case's opening
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 30000, book: 3450000, parallel: 30000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -50000, book: -5750000, parallel: -50000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -15000, book: -1710000, parallel: -15000 }
        - { account: "111001", currency: SYP, amount: 200000000, book: 200000000, parallel: 1694915 }
        - { account: "311001", currency: SYP, amount: -100000000, book: -100000000, parallel: -1000000 }
        - { account: "312002", currency: SYP, amount: -30000000, book: -30000000, parallel: -260000 }
        - { account: "312001", currency: SYP, amount: -65990000, book: -65990000, parallel: -399915 }
    - source: reversal
      date: 2026-10-01
      lines:
        # the exact negation, on the books start; INV-2026-7's item and C1's funds back to zero, the schedule reversed
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: -30000, book: -3450000, parallel: -30000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 50000, book: 5750000, parallel: 50000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: 15000, book: 1710000, parallel: 15000 }
        - { account: "111001", currency: SYP, amount: -200000000, book: -200000000, parallel: -1694915 }
        - { account: "311001", currency: SYP, amount: 100000000, book: 100000000, parallel: 1000000 }
        - { account: "312002", currency: SYP, amount: 30000000, book: 30000000, parallel: 260000 }
        - { account: "312001", currency: SYP, amount: 65990000, book: 65990000, parallel: 399915 }
    - source: opening
      date: 2026-10-01
      lines:
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 30000, book: 3450000, parallel: 30000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -50000, book: -5750000, parallel: -50000 }
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -15000, book: -1710000, parallel: -15000 }
        # 2,100,000.00 / 118 = 17,796.610… → 17,796.61
        - { account: "111001", currency: SYP, amount: 210000000, book: 210000000, parallel: 1779661 }
        - { account: "311001", currency: SYP, amount: -100000000, book: -100000000, parallel: -1000000 }
        - { account: "312002", currency: SYP, amount: -30000000, book: -30000000, parallel: -260000 }
        # balancing: book −(3,450,000 − 5,750,000 − 1,710,000 + 210,000,000 − 100,000,000 − 30,000,000) = −75,990,000;
        #   parallel −(30,000 − 50,000 − 15,000 + 1,779,661 − 1,000,000 − 260,000) = −484,661
        - { account: "312001", currency: SYP, amount: -75990000, book: -75990000, parallel: -484661 }
    - source: payment.recorded
      date: 2026-10-20
      lines:
        # the new opening's item cleared at its carrying 34,500.00 SYP; a 900.00 SYP gain
        - { account: "111004", currency: USD, amount: 30000, book: 3540000, parallel: 30000 }
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: -30000, book: -3450000, parallel: -30000 }
        - { account: "421001", currency: SYP, amount: -90000, book: -90000, parallel: 0 }
  balances:
    - { account: "111001", book: 210000000, parallel: 1779661 }
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "212001", book: -1710000, parallel: -15000 }
    - { account: "213001", book: -5750000, parallel: -50000 }
    - { account: "312001", book: -75990000, parallel: -484661 }
```

### SYP books only, without Hub

S10 edge case 21. A company with a books start and no Hub client: no snapshot and no records' figures, only the accountant's lines and the balancing figure; its receivables are the next case's. A USD cash balance is monetary and is measured at the bulletin of the eve; every other line is in SYP, so its amount is its book amount, and no parallel amount is stated.

```yaml
case: SYP books only and no Hub; the records' lines, a USD cash balance at the bulletin of the eve and a 30,000.00 SYP balancing figure
company: { shape: syp, book: SYP, template: service-agency, books_start: 2026-10-01,
           rate_policy: { book: bulletin } }
rates:
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
steps:
  - opening: the records' balances
    records:
      lines:
        - { account: "111001", currency: SYP, amount: 40000000 }
        - { account: "111002", currency: USD, amount: 10000 }
        - { account: "121001", currency: SYP, amount: 20000000 }
        - { account: "121003", currency: SYP, amount: -4000000 }
        - { account: "211003", currency: SYP, amount: -2000000 }
        - { account: "311001", currency: SYP, amount: -50000000 }
        - { account: "312002", currency: SYP, amount: -2150000 }
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        - { account: "111001", currency: SYP, amount: 40000000, book: 40000000 }
        # 100.00 USD × 115 = 11,500.00 SYP
        - { account: "111002", currency: USD, amount: 10000, book: 1150000 }
        - { account: "121001", currency: SYP, amount: 20000000, book: 20000000 }
        - { account: "121003", currency: SYP, amount: -4000000, book: -4000000 }
        - { account: "211003", currency: SYP, amount: -2000000, book: -2000000 }
        - { account: "311001", currency: SYP, amount: -50000000, book: -50000000 }
        - { account: "312002", currency: SYP, amount: -2150000, book: -2150000 }
        # balancing: −(40,000,000 + 1,150,000 + 20,000,000 − 4,000,000 − 2,000,000 − 50,000,000 − 2,150,000) = −3,000,000
        - { account: "312001", currency: SYP, amount: -3000000, book: -3000000 }
  balances:
    - { account: "312001", book: -3000000 }
```

### SYP books only: records that balance post no balancing line

S10 rule 19: a balancing figure of zero in every ledger posts no line.

```yaml
case: SYP books only, the records balance exactly; no line on 312001
company: { shape: syp, book: SYP, template: service-agency, books_start: 2026-10-01,
           rate_policy: { book: bulletin } }
rates:
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
steps:
  - opening: the records' balances
    records:
      lines:
        - { account: "111001", currency: SYP, amount: 40000000 }
        - { account: "111002", currency: USD, amount: 10000 }
        - { account: "121001", currency: SYP, amount: 20000000 }
        - { account: "121003", currency: SYP, amount: -4000000 }
        - { account: "211003", currency: SYP, amount: -2000000 }
        - { account: "311001", currency: SYP, amount: -50000000 }
        - { account: "312002", currency: SYP, amount: -5150000 }
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        - { account: "111001", currency: SYP, amount: 40000000, book: 40000000 }
        - { account: "111002", currency: USD, amount: 10000, book: 1150000 }
        - { account: "121001", currency: SYP, amount: 20000000, book: 20000000 }
        - { account: "121003", currency: SYP, amount: -4000000, book: -4000000 }
        - { account: "211003", currency: SYP, amount: -2000000, book: -2000000 }
        - { account: "311001", currency: SYP, amount: -50000000, book: -50000000 }
        # 40,000,000 + 1,150,000 + 20,000,000 − 4,000,000 − 2,000,000 − 50,000,000 − 5,150,000 = 0
        - { account: "312002", currency: SYP, amount: -5150000, book: -5150000 }
  balances:
    - { account: "312001", book: 0 }
```

### SYP books only, without Hub: receivables opened on `112001`, one paid

S10 rule 12 and edge case 21 (owner, 2026-11-12). With no Hub client, the receivable slot takes the accountant's lines: each opens a document item with its reference and due date (source `opening`, no Hub document), monetary, so a USD receivable is measured at the bulletin of the eve, never stated. On 20 October the USD receivable is received in USD cash at 118: the item clears at its carrying amount and the book residual is a realised gain (S04 rules 4 and 10).

```yaml
case: SYP books only and no Hub; OLD-1 (100.00 USD at 115) and OLD-2 (250,000.00 SYP) opened on 112001; OLD-1 received at 118 with a 300.00 SYP gain
company: { shape: syp, book: SYP, template: service-agency, books_start: 2026-10-01,
           rate_policy: { book: bulletin } }
rates:
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-10-20, base: USD, quote: SYP, rate: "118.0000", type: bulletin }
steps:
  - opening: the records' balances with two receivables
    records:
      lines:
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 10000,
            open_item: { ref: OLD-1, due: 2026-10-15 } }
        - { account: "112001", dims: { client: C2 }, currency: SYP, amount: 25000000,
            open_item: { ref: OLD-2 } }
        - { account: "111001", currency: SYP, amount: 10000000 }
        - { account: "311001", currency: SYP, amount: -30000000 }
        - { account: "312002", currency: SYP, amount: -5000000 }
  - manual: OLD-1 received in full in USD cash
    accounting_date: 2026-10-20
    payload: { lines: [{ account: "111002", currency: USD, amount: 10000 },
                       { account: "112001", currency: USD, amount: -10000, item: OLD-1 }] }
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        # monetary: 100.00 USD × 115 (bulletin of the eve) = 11,500.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: 10000, book: 1150000 }
        - { account: "112001", dims: { client: C2 }, currency: SYP, amount: 25000000, book: 25000000 }
        - { account: "111001", currency: SYP, amount: 10000000, book: 10000000 }
        - { account: "311001", currency: SYP, amount: -30000000, book: -30000000 }
        - { account: "312002", currency: SYP, amount: -5000000, book: -5000000 }
        # balancing: −(1,150,000 + 25,000,000 + 10,000,000 − 30,000,000 − 5,000,000) = −1,150,000
        - { account: "312001", currency: SYP, amount: -1150000, book: -1150000 }
    - source: manual
      date: 2026-10-20
      lines:
        # 100.00 USD × 118 = 11,800.00 SYP received
        - { account: "111002", currency: USD, amount: 10000, book: 1180000 }
        # OLD-1 cleared at its carrying 11,500.00 SYP
        - { account: "112001", dims: { client: C1 }, currency: USD, amount: -10000, book: -1150000 }
        # book residual 1,180,000 − 1,150,000 = 30,000 → a realised gain of 300.00 SYP
        - { account: "421001", currency: SYP, amount: -30000, book: -30000 }
  balances:
    - { account: "112001", book: 25000000 }
    - { account: "421001", book: -30000 }
    - { account: "312001", book: -1150000 }
  open_items:
    - { item: OLD-1, account: "112001", dims: { client: C1 }, currency: USD, amount: 0, book: 0 }
    - { item: OLD-2, account: "112001", dims: { client: C2 }, currency: SYP, amount: 25000000, book: 25000000 }
```

### USD books with an SYP parallel ledger

S10 edge case 22 and "Currencies, rates and rounding" (`usd-syp`). The roles swap: USD amounts are the book's own, and the SYP parallel ledger measures the receivable and the wallet at the market rate of the eve and the schedule at Hub's rate of issue. The SYP cash is monetary in the USD book, measured at the bulletin of the eve. Capital and the year's result are stated in both ledgers' terms, the book amount being the line's USD amount. The balancing line is in USD, the book currency.

```yaml
case: USD books; the example's invoice and wallet with the SYP parallel at market 118 and Hub's 117; SYP cash at the bulletin 115 into the USD book; a 4,441.30 USD balancing figure
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency, books_start: 2026-10-01,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-09-10, base: USD, quote: SYP, rate: "114.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "118.0000", type: market }
steps:
  - opening: the opening in USD books
    snapshot:
      invoices:
        - { invoice: INV-2026-7, client: C1, contract: { code: R1, kind: retainer, client: C1 },
            currency: USD, syp_per_usd: "117.0000", issued_on: 2026-09-10, due_on: 2026-09-25,
            total: 30000, outstanding: 30000,
            lines: [{ line: L1, amount: 30000, source: retainer_charge, kind: monthly,
                      cycle_start: 2026-09-16, cycle_end: 2026-10-15, service: S1 }] }
      wallets:
        - { client: C1, balance: 50000 }
    records:
      lines:
        - { account: "111001", currency: SYP, amount: 200000000 }
        - { account: "311001", currency: USD, amount: -1000000, parallel: -115000000 }
        - { account: "312002", currency: USD, amount: -260000, parallel: -30000000 }
      figures:
        - { slot: receivable, client: C1, currency: USD, amount: 30000 }
        - { slot: ad_funds, client: C1, currency: USD, amount: 50000 }
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        # USD as is in the book; parallel 300.00 × 118 (market of the eve) = 35,400.00 SYP
        - { account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 30000, book: 30000, parallel: 3540000 }
        # parallel −500.00 × 118 = −59,000.00 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -50000, book: -50000, parallel: -5900000 }
        # book: 15 of 30 days left, 15,000; parallel: deferred 300.00 × 117 (Hub's rate of issue) = 35,100.00 SYP,
        #   less 3,510,000 × 15 / 30 = 1,755,000; left 1,755,000
        - { account: "212001", dims: { client: C1, contract: R1 }, currency: USD, amount: -15000, book: -15000, parallel: -1755000 }
        # book: 2,000,000.00 SYP / 115 (bulletin of the eve) = 17,391.304… → 17,391.30 USD
        - { account: "111001", currency: SYP, amount: 200000000, book: 1739130, parallel: 200000000 }
        # stated: the book amount is the USD amount, the SYP parallel typed
        - { account: "311001", currency: USD, amount: -1000000, book: -1000000, parallel: -115000000 }
        - { account: "312002", currency: USD, amount: -260000, book: -260000, parallel: -30000000 }
        # balancing in USD: book −(30,000 − 50,000 − 15,000 + 1,739,130 − 1,000,000 − 260,000) = −444,130;
        #   parallel −(3,540,000 − 5,900,000 − 1,755,000 + 200,000,000 − 115,000,000 − 30,000,000) = −50,885,000
        - { account: "312001", currency: USD, amount: -444130, book: -444130, parallel: -50885000 }
  open_items:
    - { item: INV-2026-7, account: "112001", dims: { client: C1, contract: R1 }, currency: USD, amount: 30000, book: 30000, parallel: 3540000 }
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: -50000, book: -50000, parallel: -5900000 }
```

### A third currency: TRY cash in the records

S10 edge cases 23 and 19. The TRY cash is monetary: the SYP book has no TRY bulletin pair, so it crosses through USD (TRY → USD at the USD/TRY bulletin, then USD → SYP at the USD/SYP bulletin, one exact product rounded once; ADR 0007); the USD parallel ledger takes the direct USD/TRY market rate. Hub's part has none (Hub sends only SYP and USD). The capital's stated parallel amount happens to equal the other lines' parallel sum, so the balancing line carries zero in the parallel ledger and posts for its book amount (edge case 19).

```yaml
case: TRY cash through the cross 115 / 42 in the SYP book and at the market 42.5 in the USD parallel; the balancing line zero in the parallel ledger
company: { shape: third, book: SYP, parallel: USD, template: service-agency, books_start: 2026-10-01,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           accounts: [{ code: "111007", name: "الصندوق — ليرة تركية", name_latin: "Cash on hand — TRY",
                        currency: TRY, monetary: true, statement_line: bs.cash }] }
rates:
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: TRY, rate: "42.0000", type: bulletin }
  - { date: 2026-09-30, base: USD, quote: SYP, rate: "118.0000", type: market }
  - { date: 2026-09-30, base: USD, quote: TRY, rate: "42.5000", type: market }
steps:
  - opening: the records' balances with TRY cash
    records:
      lines:
        - { account: "111007", currency: TRY, amount: 1000000 }
        - { account: "111001", currency: SYP, amount: 10000000 }
        - { account: "311001", currency: SYP, amount: -12000000, parallel: -108275 }
expect:
  entries:
    - source: opening
      date: 2026-10-01
      lines:
        # book: 10,000.00 TRY / 42 × 115 = 27,380.952… → 27,380.95 SYP; parallel: 10,000.00 / 42.5 = 235.294… → 235.29 USD
        - { account: "111007", currency: TRY, amount: 1000000, book: 2738095, parallel: 23529 }
        # parallel: 100,000.00 / 118 = 847.457… → 847.46
        - { account: "111001", currency: SYP, amount: 10000000, book: 10000000, parallel: 84746 }
        # stated at 1,082.75 USD, the sum 235.29 + 847.46
        - { account: "311001", currency: SYP, amount: -12000000, book: -12000000, parallel: -108275 }
        # balancing: book −(2,738,095 + 10,000,000 − 12,000,000) = −738,095; parallel −(23,529 + 84,746 − 108,275) = 0
        - { account: "312001", currency: SYP, amount: -738095, book: -738095, parallel: 0 }
  balances:
    - { account: "111007", book: 2738095, parallel: 23529 }
    - { account: "312001", book: -738095, parallel: 0 }
```
