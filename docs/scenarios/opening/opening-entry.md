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
