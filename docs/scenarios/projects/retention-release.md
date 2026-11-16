# A retention release

Status: Proposed

The expected entries of the six cases were approved by the owner on 2026-11-16 (the sixth after the accounting review). Two readings of S12 rules 19 and 20 were decided by the owner the same day, before the numbers: a supplier's retention is cleared at the average carrying amount of the project's own share of the supplier's running item on `211006` (the item's lines with this project), as a recovered advance is (rule 12); and the client's new receivable on `112001` is named `إفراج <fiscal year>/<number>`, since a release and a progress billing of the same fiscal year share a number and an item's reference is unique on its account (S04 rule 6). The cases stay `Proposed` until S12's slice brings the `project_document` executor, the subcontracts setup and the project documents reader.

## Rule

A retention release (إفراج عن محتجزات) is a numbered project document that moves a retention to the ordinary receivable or payable when it becomes unconditional. On the client's side it names the project and one or more retention items of the project on `113002`, each with the amount released, at most its open amount (`RELEASE_EXCEEDS_BALANCE`). It posts Cr each item, cleared in proportion to what remains of it (S04 rule 4), and Dr `112001` one new document item for their sum, with the client and the project, named `إفراج <fiscal year>/<number>` and newly measured. On the supplier's side it names the project, the supplier and the amount released, at most the supplier's retention for the project on `211006` (the running item's lines with this project, `RELEASE_EXCEEDS_BALANCE`). It posts Dr `211006` with the project, cleared at the average carrying amount of the project's share, and Cr `211002` the supplier's running item with the project on the line, newly measured. Each ledger's residual is a realised exchange difference. The new receivable or payable is settled as any other, and a release is cancelled by reversing its entry, which reopens the retentions at exactly what they carried. A billing whose retention has been released, even in part, cannot be cancelled until the release is reversed (`OPEN_ITEM_HAS_SETTLEMENTS`).

## Basis

- **IFRS 15.108:** a receivable is a right to consideration that is unconditional; the retention, a contract asset while its payment waits on completion or the defects period (IFRS 15.105, 15.107), is reclassified to a receivable when the condition is met.
- **IAS 21.23(a) and 21.28:** the retention on `113002` and `211006` is monetary; settling it at the release date's rate, against the rate it was carried at, realises an exchange difference in each ledger. The new receivable or payable is recorded at the spot rate of the release date (the ledger's policy rate, IAS 21.21–22).
- **IAS 1.102:** the subcontractor's retention and the subcontractor's payable keep the project on the line, so the project report reads its retentions and its payables per contract.
- **Company policy:** S12 rules 19–22 and its "Accounting treatment" (owner, 2026-11-16; ADR 0023); the supplier's retention cleared at the average of the project's own share, and the release's receivable named `إفراج <fiscal year>/<number>` (owner, 2026-11-16, in this scenario); the supplier's credit carrying the project, as approved for a subcontractor's billing (`projects/subcontract-billing.md`, owner, 2026-11-16); S04 rules 3, 4, 10 and 13 (running items cleared at the average carrying amount, document items cleared in proportion, residuals, reopening by reversal); S11 rules 8 and 11 (vouchers, the box never below zero); S03 rule 9 (the accountant's reversal); the client's currencies, a USD book at `market` accepting dealt rates and an SYP parallel ledger at the bulletin (S11, ADR 0021).
- **Syrian rules:** the bulletin for the parallel ledger, UNVERIFIED (Q1), adopted by the owner as the company's policy; a daily TRY/SYP bulletin, UNVERIFIED (Q10), assumed by the owner (S11); Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The company is the contracting client's shape unless a case says otherwise: `usd-syp`, the USD book at `market` accepting dealt rates, the SYP parallel ledger at the bulletin, TRY as a third currency, and the chart `contracting@1` (S11 "Templates"):
- the USD box `111002` and the USD bank `111004`;
- trade receivables `112001` and retentions receivable `113002`, document control accounts for clients with client and contract required;
- subcontractors' payables `211002`, a running control account for suppliers, monetary, with the supplier required;
- retentions payable to subcontractors `211006`, a running control account for suppliers, monetary, with supplier and contract required;
- the owner's current account `313001`;
- contract revenue `411001` and subcontractors `511003`, requiring the contract;
- realised exchange gains `421001` and losses `541001`.

Project P1 (and P2 where a case names it) belongs to client C1; S2 is a subcontractor, a value of the `supplier` dimension. The projects' and subcontracts' recovery rate is 0, so the billings that make the retentions carry no advance (`projects/progress-billing.md` and `projects/subcontract-billing.md` own the recovery). Every rate and amount is synthetic. Thursday 31 December 2026, Sunday 31 January, Monday 1 February, Sunday 28 February and Sunday 7 March 2027 are publication days.

A `project_document` step for a release is the document as the form sends it (S12 "Drafts"): `kind: retention_release`, the `side`, the `contract`, and on the client's side the retention items with the amount released of each (`retention_items`), on the supplier's side the `supplier` and the amount released (`retention`). Its currency is the project's or the subcontract's. It is saved as a draft and posted from it; its entry has the source `manual`. A billing's items on `112001` and `113002` are named by its printed number (`<fiscal year>/<number>`), a release's item on `112001` by `إفراج <fiscal year>/<number>`; the subcontractor's retention and payable are running items named by the supplier's code. `project_documents` states the exact set of the company's project documents; a release's row has its side, its supplier on the supplier's side, and the amount released as its `retention`.

A difference line carries its amount in one ledger only, in that ledger's currency (ADR 0007).

The cases leave out what other scenarios own:
- the advances and their recovery in a billing (`projects/progress-billing.md`, `projects/subcontract-billing.md`);
- the month-end revaluation of `113002`, `112001`, `211006` and `211002` (`currency/month-end-revaluation.md`);
- a release dated in a closed period, refused as any posting there (`periods/close-and-reopen.md`);
- the project report's retentions (`reports/project-report.md`).

### The retentions of two billings released into one receivable, then received

S12's scenario. P1's terms are USD: 100,000.00, retention 10%. Billing 1 certifies 30,000.00 at 31 December at the bulletin of 120, billing 2 another 20,000.00 at 31 January at 125: retentions of 3,000.00 and 2,000.00 on `113002`, carried at 360,000.00 and 250,000.00 SYP. On 28 February, at 130, the work is handed over and both are released into one receivable of 5,000.00 USD, measured at 650,000.00 SYP. The USD book has no residual; the parallel ledger realises a gain of 40,000.00 SYP, the bulletin's rise since each billing (IAS 21.28). On 7 March, at 132, the client pays the 5,000.00 into the USD bank, and the receivable realises a further 10,000.00 SYP. The release is 2027's first and so is billing 2: the release's receivable `إفراج 2027/1` stands beside billing 2's `2027/1` on `112001`.

```yaml
case: retentions of 3,000.00 at 120 and 2,000.00 at 125 released at 130 into one receivable; received at 132
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: USD, value: 10000000, retention_bp: 1000, advance_recovery_bp: 0 } }] }
rates:
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2027-01-31, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2027-02-28, base: USD, quote: SYP, rate: "130.0000", type: bulletin }
  - { date: 2027-03-07, base: USD, quote: SYP, rate: "132.0000", type: bulletin }
steps:
  - project_document: progress billing 1 of P1
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 3000000 } }
  - project_document: progress billing 2 of P1
    accounting_date: 2027-01-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 5000000 } }
  - project_document: the client's retentions of both billings released
    accounting_date: 2027-02-28
    payload: { document: { kind: retention_release, side: client, contract: P1,
                           retention_items: [{ item: "2026/1", amount: 300000 }, { item: "2027/1", amount: 200000 }] } }
  - voucher: client C1 pays the released retentions into the USD bank
    accounting_date: 2027-03-07
    payload: { voucher: { kind: receipt, cash_account: "111004", party_name: "العميل" },
               lines: [{ account: "111004", currency: USD, amount: 500000 },
                       { account: "112001", currency: USD, amount: -500000, item: "إفراج 2027/1" }] }
expect:
  entries:
    - source: manual
      date: 2026-12-31
      lines:
        # period 30,000.00; retention 10% = 3,000.00; recovery 0; net 27,000.00; every line × 120
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2700000, book: 2700000, parallel: 324000000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 300000, parallel: 36000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -3000000, book: -3000000, parallel: -360000000 }
    - source: manual
      date: 2027-01-31
      lines:
        # period 50,000.00 − 30,000.00 = 20,000.00; retention 2,000.00; net 18,000.00; every line × 125
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 1800000, book: 1800000, parallel: 225000000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 200000, book: 200000, parallel: 25000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000, book: -2000000, parallel: -250000000 }
    - source: manual
      date: 2027-02-28
      lines:
        # the new receivable "إفراج 2027/1": 3,000.00 + 2,000.00 = 5,000.00 USD × 130 = 650,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 500000, book: 500000, parallel: 65000000 }
        # each retention item cleared whole at what it carries
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: -300000, book: -300000, parallel: -36000000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: -200000, book: -200000, parallel: -25000000 }
        # book residual: 500,000 − 300,000 − 200,000 = 0 → no line
        # parallel residual: 65,000,000 − 36,000,000 − 25,000,000 = 4,000,000 debit → a credit: realised gain 40,000.00 SYP
        - { account: "421001", currency: SYP, amount: -4000000, book: 0, parallel: -4000000 }
    - source: manual
      date: 2027-03-07
      lines:
        # 5,000.00 USD × 132 = 660,000.00 SYP
        - { account: "111004", currency: USD, amount: 500000, book: 500000, parallel: 66000000 }
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: -500000, book: -500000, parallel: -65000000 }
        # parallel residual: 66,000,000 − 65,000,000 = 1,000,000 debit → a credit: realised gain 10,000.00 SYP
        - { account: "421001", currency: SYP, amount: -1000000, book: 0, parallel: -1000000 }
  balances:
    - { account: "113002", book: 0, parallel: 0 }
    # the billings' nets, unpaid: 27,000.00 + 18,000.00 = 45,000.00 USD; 324,000,000 + 225,000,000 = 549,000,000
    - { account: "112001", currency: USD, amount: 4500000, book: 4500000, parallel: 549000000 }
    # revenue = the cumulative certified, 50,000.00 USD; 360,000,000 + 250,000,000
    - { account: "411001", book: -5000000, parallel: -610000000 }
    - { account: "421001", book: 0, parallel: -5000000 }
  open_items:
    - { item: "2026/1", account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: "2027/1", account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: "إفراج 2027/1", account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: "2026/1", account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2700000, book: 2700000, parallel: 324000000 }
    - { item: "2027/1", account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 1800000, book: 1800000, parallel: 225000000 }
  project_documents:
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 1,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 0 }
    - { kind: progress_billing, number: 1, date: 2027-01-31, contract: P1, client: C1, sequence: 2, entry: 2,
        currency: USD, cumulative: 5000000, previous: 3000000, retention: 200000, advance: 0 }
    # the first release of 2027: number 1 of its kind, as billing 2 is of its own
    - { kind: retention_release, number: 1, date: 2027-02-28, contract: P1, client: C1, side: client, entry: 3,
        currency: USD, retention: 500000 }
```

### A partial release, the billing it holds, its cancellation and a release beyond the balance

Billing 1 of P1 holds a retention of 3,000.00 USD at 120. On 31 January, at 125, a third of it is released: 1,000.00 USD, which clears a third of the item's 360,000.00 SYP and is measured new at 125,000.00 SYP, a gain of 5,000.00 SYP. Cancelling billing 1 is then refused, since its retention item has a settlement (`OPEN_ITEM_HAS_SETTLEMENTS`, S04), and so is a release of 2,500.00 USD, above the 2,000.00 left (`RELEASE_EXCEEDS_BALANCE`). On 1 February the accountant cancels the release: the reversal reopens the item at exactly its 3,000.00 USD and 360,000.00 SYP and takes back the gain. The whole retention is then released at 126: the release keeps its number 1 and prints "ملغى", and the new one is number 2.

```yaml
case: 1,000.00 of a 3,000.00 retention released at 125; the billing's cancellation and a release beyond the balance refused; the release reversed; the whole released at 126
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: USD, value: 10000000, retention_bp: 1000, advance_recovery_bp: 0 } }] }
rates:
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2027-01-31, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2027-02-01, base: USD, quote: SYP, rate: "126.0000", type: bulletin }
steps:
  - project_document: progress billing 1 of P1
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 3000000 } }
  - project_document: a third of billing 1's retention released
    accounting_date: 2027-01-31
    payload: { document: { kind: retention_release, side: client, contract: P1,
                           retention_items: [{ item: "2026/1", amount: 100000 }] } }
  - reversal: 1
    accounting_date: 2027-02-01
    outcome: { status: refused, reason: OPEN_ITEM_HAS_SETTLEMENTS }
  - project_document: a release of 2,500.00 from the 2,000.00 left
    accounting_date: 2027-01-31
    payload: { document: { kind: retention_release, side: client, contract: P1,
                           retention_items: [{ item: "2026/1", amount: 250000 }] } }
    outcome: { status: refused, reason: RELEASE_EXCEEDS_BALANCE }
  - reversal: 2
    accounting_date: 2027-02-01
  - project_document: the whole retention of billing 1 released
    accounting_date: 2027-02-01
    payload: { document: { kind: retention_release, side: client, contract: P1,
                           retention_items: [{ item: "2026/1", amount: 300000 }] } }
expect:
  entries:
    - source: manual
      date: 2026-12-31
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2700000, book: 2700000, parallel: 324000000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 300000, parallel: 36000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -3000000, book: -3000000, parallel: -360000000 }
    - source: manual
      date: 2027-01-31
      lines:
        # "إفراج 2027/1": 1,000.00 USD × 125 = 125,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 100000, book: 100000, parallel: 12500000 }
        # in proportion to what remains: 36,000,000 × 1,000 / 3,000 = 12,000,000
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: -100000, book: -100000, parallel: -12000000 }
        # parallel residual: 12,500,000 − 12,000,000 = 500,000 debit → realised gain 5,000.00 SYP
        - { account: "421001", currency: SYP, amount: -500000, book: 0, parallel: -500000 }
    - source: reversal
      date: 2027-02-01
      lines:
        # the release reversed exactly: the item back at 300,000 and 36,000,000, the gain taken back
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: -100000, book: -100000, parallel: -12500000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 100000, book: 100000, parallel: 12000000 }
        - { account: "421001", currency: SYP, amount: 500000, book: 0, parallel: 500000 }
    - source: manual
      date: 2027-02-01
      lines:
        # "إفراج 2027/2": 3,000.00 USD × 126 = 378,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 300000, parallel: 37800000 }
        # the whole item at what it carries again: 36,000,000
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: -300000, book: -300000, parallel: -36000000 }
        # parallel residual: 37,800,000 − 36,000,000 = 1,800,000 debit → realised gain 18,000.00 SYP
        - { account: "421001", currency: SYP, amount: -1800000, book: 0, parallel: -1800000 }
  balances:
    - { account: "113002", book: 0, parallel: 0 }
    - { account: "421001", book: 0, parallel: -1800000 }
  open_items:
    - { item: "2026/1", account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: "إفراج 2027/1", account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: "إفراج 2027/2", account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 300000, parallel: 37800000 }
    - { item: "2026/1", account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2700000, book: 2700000, parallel: 324000000 }
  project_documents:
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 1,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 0 }
    - { kind: retention_release, number: 1, date: 2027-01-31, contract: P1, client: C1, side: client, entry: 2,
        currency: USD, retention: 100000, cancelled_by: 3 }
    # the refusals consumed no number; the cancelled release keeps its own
    - { kind: retention_release, number: 2, date: 2027-02-01, contract: P1, client: C1, side: client, entry: 4,
        currency: USD, retention: 300000 }
```

### A TRY retention: a difference in each ledger

P1's terms are in TRY: 2,000,000.00, retention 10%. Billing 1 certifies 600,000.00 TRY at 31 December, at the market 34.3000 TRY per USD and the bulletin 3.5000 SYP per TRY: a retention of 60,000.00 TRY carried at 1,749.27 USD and 210,000.00 SYP. It is released on 31 January, at 35.8400 and 3.6500. TRY has fallen against the USD and risen against the SYP since the billing, so the book realises a loss of 75.16 USD and the parallel ledger a gain of 9,000.00 SYP.

```yaml
case: a 60,000.00 TRY retention at 34.3 and 3.5 released at 35.84 and 3.65; a loss in the book, a gain in the parallel ledger
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: TRY, value: 200000000, retention_bp: 1000, advance_recovery_bp: 0 } }] }
rates:
  - { date: 2026-12-31, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: TRY, rate: "34.3000", type: market }
  - { date: 2027-01-31, base: TRY, quote: SYP, rate: "3.6500", type: bulletin }
  - { date: 2027-01-31, base: USD, quote: TRY, rate: "35.8400", type: market }
steps:
  - project_document: progress billing 1 of P1 in TRY
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 60000000 } }
  - project_document: billing 1's retention released
    accounting_date: 2027-01-31
    payload: { document: { kind: retention_release, side: client, contract: P1,
                           retention_items: [{ item: "2026/1", amount: 6000000 }] } }
expect:
  entries:
    - source: manual
      date: 2026-12-31
      lines:
        # period 600,000.00 TRY; retention 60,000.00; net 540,000.00
        # net: book 540,000.00 / 34.3 = 15,743.4402… → 15,743.44 USD; parallel × 3.5 = 1,890,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: TRY, amount: 54000000, book: 1574344, parallel: 189000000 }
        # retention: 60,000.00 / 34.3 = 1,749.2711… → 1,749.27 USD; × 3.5 = 210,000.00 SYP
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: TRY, amount: 6000000, book: 174927, parallel: 21000000 }
        # revenue: 600,000.00 / 34.3 = 17,492.7113… → 17,492.71 USD; × 3.5 = 2,100,000.00 SYP
        # book: 1,574,344 + 174,927 − 1,749,271 = 0: no rounding line
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: TRY, amount: -60000000, book: -1749271, parallel: -210000000 }
    - source: manual
      date: 2027-01-31
      lines:
        # "إفراج 2027/1": 60,000.00 TRY / 35.84 = 1,674.1071… → 1,674.11 USD; × 3.65 = 219,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: TRY, amount: 6000000, book: 167411, parallel: 21900000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: TRY, amount: -6000000, book: -174927, parallel: -21000000 }
        # book residual: 167,411 − 174,927 = −7,516 credit → a debit: realised loss 75.16 USD
        - { account: "541001", currency: USD, amount: 7516, book: 7516, parallel: 0 }
        # parallel residual: 21,900,000 − 21,000,000 = 900,000 debit → a credit: realised gain 9,000.00 SYP
        - { account: "421001", currency: SYP, amount: -900000, book: 0, parallel: -900000 }
  balances:
    - { account: "113002", book: 0, parallel: 0 }
    # 540,000.00 + 60,000.00 = 600,000.00 TRY; book 1,574,344 + 167,411; parallel 189,000,000 + 21,900,000
    - { account: "112001", currency: TRY, amount: 60000000, book: 1741755, parallel: 210900000 }
  open_items:
    - { item: "2026/1", account: "113002", dims: { client: C1, contract: P1 }, currency: TRY, amount: 0, book: 0, parallel: 0 }
    - { item: "إفراج 2027/1", account: "112001", dims: { client: C1, contract: P1 }, currency: TRY, amount: 6000000, book: 167411, parallel: 21900000 }
  project_documents:
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 1,
        currency: TRY, cumulative: 60000000, previous: 0, retention: 6000000, advance: 0 }
    - { kind: retention_release, number: 1, date: 2027-01-31, contract: P1, client: C1, side: client, entry: 2,
        currency: TRY, retention: 6000000 }
```

### The USD retention in SYP books

The client's release of a USD retention in a company with SYP books at the bulletin and no parallel ledger. The book now moves with the USD: the retention carried at 120 is released at 125, and the book realises a gain of 15,000.00 SYP.

```yaml
case: syp; a 3,000.00 USD retention at 120 released at 125; a gain in the book
company: { shape: syp, book: SYP, template: contracting,
           rate_policy: { book: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: USD, value: 10000000, retention_bp: 1000, advance_recovery_bp: 0 } }] }
rates:
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2027-01-31, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - project_document: progress billing 1 of P1
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 3000000 } }
  - project_document: billing 1's retention released
    accounting_date: 2027-01-31
    payload: { document: { kind: retention_release, side: client, contract: P1,
                           retention_items: [{ item: "2026/1", amount: 300000 }] } }
expect:
  entries:
    - source: manual
      date: 2026-12-31
      lines:
        # every line × 120
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2700000, book: 324000000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 36000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -3000000, book: -360000000 }
    - source: manual
      date: 2027-01-31
      lines:
        # "إفراج 2027/1": 3,000.00 USD × 125 = 375,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 37500000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: -300000, book: -36000000 }
        # book residual: 37,500,000 − 36,000,000 = 1,500,000 debit → a credit: realised gain 15,000.00 SYP
        - { account: "421001", currency: SYP, amount: -1500000, book: -1500000 }
  balances:
    - { account: "113002", book: 0 }
    - { account: "112001", currency: USD, amount: 3000000, book: 361500000 }
  open_items:
    - { item: "2026/1", account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0 }
    - { item: "إفراج 2027/1", account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 37500000 }
  project_documents:
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 1,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 0 }
    - { kind: retention_release, number: 1, date: 2027-01-31, contract: P1, client: C1, side: client, entry: 2,
        currency: USD, retention: 300000 }
```

### A subcontractor's retention on one of two projects, released and paid

S2 holds USD subcontracts on P1 and P2, each with a retention of 10%. Its billing on P1 at 31 December, at the bulletin of 120, holds 3,000.00 USD; its billing on P2 at 31 January, at 125, holds 2,000.00 USD: one running item for S2 in USD on `211006`, carried at 610,000.00 SYP, whose average belongs to neither project. On 28 February, at 130, P1's retention is released. A release of 3,500.00 is refused: it is within the item's 5,000.00 but above P1's 3,000.00 (`RELEASE_EXCEEDS_BALANCE`, S12 edge case 19). The release of 3,000.00 clears P1's share at its own average, 360,000.00 SYP (the item's average would give 366,000.00), and credits S2's payable 390,000.00 SYP at 130: a loss of 30,000.00 SYP, the bulletin's rise on a USD liability. On 7 March, at 132, the USD box pays S2 3,000.00 USD; the payment clears S2's payable at the running item's average (S04 rule 3), which pools the nets of both billings and the release.

```yaml
case: S2's retentions of 3,000.00 on P1 at 120 and 2,000.00 on P2 at 125; 3,500.00 on P1 refused; P1's 3,000.00 released at 130 at P1's own average; 3,000.00 paid at 132
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }, { code: P2, kind: project, client: C1 }],
           subcontracts: [{ contract: P1, supplier: S2, currency: USD, value: 10000000,
                            retention_bp: 1000, advance_recovery_bp: 0 },
                          { contract: P2, supplier: S2, currency: USD, value: 5000000,
                            retention_bp: 1000, advance_recovery_bp: 0 }] }
rates:
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2027-01-31, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2027-02-28, base: USD, quote: SYP, rate: "130.0000", type: bulletin }
  - { date: 2027-03-07, base: USD, quote: SYP, rate: "132.0000", type: bulletin }
steps:
  - project_document: S2's billing 1 on P1
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 3000000 } }
  - project_document: S2's billing 1 on P2
    accounting_date: 2027-01-31
    payload: { document: { kind: subcontract_billing, contract: P2, supplier: S2, cumulative: 2000000 } }
  - project_document: a release of 3,500.00 of S2's retention on P1
    accounting_date: 2027-02-28
    payload: { document: { kind: retention_release, side: supplier, contract: P1, supplier: S2, retention: 350000 } }
    outcome: { status: refused, reason: RELEASE_EXCEEDS_BALANCE }
  - project_document: S2's retention on P1 released
    accounting_date: 2027-02-28
    payload: { document: { kind: retention_release, side: supplier, contract: P1, supplier: S2, retention: 300000 } }
  - voucher: the owner pays 3,000.00 USD into the USD box
    accounting_date: 2027-03-07
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 300000 },
                       { account: "313001", currency: USD, amount: -300000 }] }
  - voucher: the released retention paid to S2
    accounting_date: 2027-03-07
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "مقاول الباطن" },
               lines: [{ account: "211002", dims: { supplier: S2 }, currency: USD, amount: 300000 },
                       { account: "111002", currency: USD, amount: -300000 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-31
      lines:
        # period 30,000.00; retention 3,000.00; recovery 0; net 27,000.00; every line × 120
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: USD, amount: 3000000, book: 3000000, parallel: 360000000 }
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -300000, book: -300000, parallel: -36000000 }
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -2700000, book: -2700000, parallel: -324000000 }
    - source: manual
      date: 2027-01-31
      lines:
        # period 20,000.00; retention 2,000.00; net 18,000.00; every line × 125
        - { account: "511003", dims: { contract: P2, supplier: S2 }, currency: USD, amount: 2000000, book: 2000000, parallel: 250000000 }
        - { account: "211006", dims: { supplier: S2, contract: P2 }, currency: USD, amount: -200000, book: -200000, parallel: -25000000 }
        - { account: "211002", dims: { supplier: S2, contract: P2 }, currency: USD, amount: -1800000, book: -1800000, parallel: -225000000 }
    - source: manual
      date: 2027-02-28
      lines:
        # P1's share: 3,000.00 at 36,000,000 → 36,000,000 × 3,000 / 3,000 = 36,000,000
        #   (the item's average would give 61,000,000 × 3,000 / 5,000 = 36,600,000)
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 300000, book: 300000, parallel: 36000000 }
        # 3,000.00 USD × 130 = 390,000.00 SYP
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -300000, book: -300000, parallel: -39000000 }
        # book residual: 0; parallel residual: 36,000,000 − 39,000,000 = −3,000,000 credit → a debit: realised loss 30,000.00 SYP
        - { account: "541001", currency: SYP, amount: 3000000, book: 0, parallel: 3000000 }
    - source: manual
      date: 2027-03-07
      lines:
        # 3,000.00 USD × 132 = 396,000.00 SYP
        - { account: "111002", currency: USD, amount: 300000, book: 300000, parallel: 39600000 }
        - { account: "313001", currency: USD, amount: -300000, book: -300000, parallel: -39600000 }
    - source: manual
      date: 2027-03-07
      lines:
        # S2's payable: 27,000 + 18,000 + 3,000 = 48,000.00 USD at 324,000,000 + 225,000,000 + 39,000,000 = 588,000,000;
        #   3,000.00 cleared at its average: 588,000,000 × 3,000 / 48,000 = 36,750,000
        - { account: "211002", dims: { supplier: S2 }, currency: USD, amount: 300000, book: 300000, parallel: 36750000 }
        - { account: "111002", currency: USD, amount: -300000, book: -300000, parallel: -39600000 }
        # parallel residual: 36,750,000 − 39,600,000 = −2,850,000 credit → a debit: realised loss 28,500.00 SYP
        - { account: "541001", currency: SYP, amount: 2850000, book: 0, parallel: 2850000 }
  balances:
    # P1's retention released whole, in both ledgers; P2's stays as billed
    - { account: "211006", dims: { contract: P1 }, book: 0, parallel: 0 }
    - { account: "211006", dims: { contract: P2 }, book: -200000, parallel: -25000000 }
    # 588,000,000 − 36,750,000 = 551,250,000
    - { account: "211002", currency: USD, amount: -4500000, book: -4500000, parallel: -551250000 }
    - { account: "111002", currency: USD, amount: 0, book: 0, parallel: 0 }
    - { account: "541001", book: 0, parallel: 5850000 }
  open_items:
    - { item: S2, account: "211006", dims: { supplier: S2 }, currency: USD, amount: -200000, book: -200000, parallel: -25000000 }
    - { item: S2, account: "211002", dims: { supplier: S2 }, currency: USD, amount: -4500000, book: -4500000, parallel: -551250000 }
  project_documents:
    - { kind: subcontract_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, supplier: S2, sequence: 1, entry: 1,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 0 }
    - { kind: subcontract_billing, number: 1, date: 2027-01-31, contract: P2, client: C1, supplier: S2, sequence: 1, entry: 2,
        currency: USD, cumulative: 2000000, previous: 0, retention: 200000, advance: 0 }
    # the refusal consumed no number
    - { kind: retention_release, number: 1, date: 2027-02-28, contract: P1, client: C1, side: supplier, supplier: S2, entry: 3,
        currency: USD, retention: 300000 }
```

### Half of one project's TRY retention released: the project's average in both ledgers

S2 holds TRY subcontracts on P1 and P2, each with a retention of 10%. Its billing on P1 at 31 December, at 34.3000 TRY per USD and 3.5000 SYP per TRY, holds 60,000.00 TRY, carried at 1,749.27 USD and 210,000.00 SYP; its billing on P2 at 31 January, at 35.8400 and 3.6500, holds 40,000.00 TRY, carried at 1,116.07 USD and 146,000.00 SYP: one running item of 100,000.00 TRY at 2,865.34 USD and 356,000.00 SYP. On 28 February, at 36.0000 and 3.7000, half of P1's retention is released. It clears half of P1's own share in each ledger, 874.64 USD (874.635, rounded half away from zero) and 105,000.00 SYP; the item's average would give 859.60 USD and 106,800.00 SYP. The payable is measured at 833.33 USD and 111,000.00 SYP: a gain of 41.31 USD in the book and a loss of 6,000.00 SYP in the parallel ledger.

```yaml
case: S2's TRY retentions of 60,000.00 on P1 and 40,000.00 on P2; 30,000.00 of P1's released at 36 and 3.7 at P1's own average in both ledgers
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }, { code: P2, kind: project, client: C1 }],
           subcontracts: [{ contract: P1, supplier: S2, currency: TRY, value: 150000000,
                            retention_bp: 1000, advance_recovery_bp: 0 },
                          { contract: P2, supplier: S2, currency: TRY, value: 100000000,
                            retention_bp: 1000, advance_recovery_bp: 0 }] }
rates:
  - { date: 2026-12-31, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: TRY, rate: "34.3000", type: market }
  - { date: 2027-01-31, base: TRY, quote: SYP, rate: "3.6500", type: bulletin }
  - { date: 2027-01-31, base: USD, quote: TRY, rate: "35.8400", type: market }
  - { date: 2027-02-28, base: TRY, quote: SYP, rate: "3.7000", type: bulletin }
  - { date: 2027-02-28, base: USD, quote: TRY, rate: "36.0000", type: market }
steps:
  - project_document: S2's billing 1 on P1
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 60000000 } }
  - project_document: S2's billing 1 on P2
    accounting_date: 2027-01-31
    payload: { document: { kind: subcontract_billing, contract: P2, supplier: S2, cumulative: 40000000 } }
  - project_document: half of S2's retention on P1 released
    accounting_date: 2027-02-28
    payload: { document: { kind: retention_release, side: supplier, contract: P1, supplier: S2, retention: 3000000 } }
expect:
  entries:
    - source: manual
      date: 2026-12-31
      lines:
        # period 600,000.00 TRY: book / 34.3 = 17,492.7113… → 17,492.71 USD; parallel × 3.5 = 2,100,000.00 SYP
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: TRY, amount: 60000000, book: 1749271, parallel: 210000000 }
        # retention 60,000.00: / 34.3 = 1,749.2711… → 1,749.27 USD; × 3.5 = 210,000.00 SYP
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: -6000000, book: -174927, parallel: -21000000 }
        # net 540,000.00: / 34.3 = 15,743.4402… → 15,743.44 USD; × 3.5 = 1,890,000.00 SYP
        # book: 1,749,271 − 174,927 − 1,574,344 = 0: no rounding line
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: -54000000, book: -1574344, parallel: -189000000 }
    - source: manual
      date: 2027-01-31
      lines:
        # period 400,000.00 TRY: / 35.84 = 11,160.7142… → 11,160.71 USD; × 3.65 = 1,460,000.00 SYP
        - { account: "511003", dims: { contract: P2, supplier: S2 }, currency: TRY, amount: 40000000, book: 1116071, parallel: 146000000 }
        # retention 40,000.00: / 35.84 = 1,116.0714… → 1,116.07 USD; × 3.65 = 146,000.00 SYP
        - { account: "211006", dims: { supplier: S2, contract: P2 }, currency: TRY, amount: -4000000, book: -111607, parallel: -14600000 }
        # net 360,000.00: / 35.84 = 10,044.6428… → 10,044.64 USD; × 3.65 = 1,314,000.00 SYP
        # book: 1,116,071 − 111,607 − 1,004,464 = 0: no rounding line
        - { account: "211002", dims: { supplier: S2, contract: P2 }, currency: TRY, amount: -36000000, book: -1004464, parallel: -131400000 }
    - source: manual
      date: 2027-02-28
      lines:
        # P1's share: 60,000.00 TRY at 174,927 and 21,000,000; 30,000.00 of it at its average:
        #   book 174,927 × 30,000 / 60,000 = 87,463.5 → 87,464; parallel 21,000,000 × 0.5 = 10,500,000
        #   (the item's average would give 286,534 × 0.3 = 85,960.2 → 85,960 and 35,600,000 × 0.3 = 10,680,000)
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: 3000000, book: 87464, parallel: 10500000 }
        # 30,000.00 TRY / 36 = 833.3333… → 833.33 USD; × 3.7 = 111,000.00 SYP
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: -3000000, book: -83333, parallel: -11100000 }
        # book residual: 87,464 − 83,333 = 4,131 debit → a credit: realised gain 41.31 USD
        - { account: "421001", currency: USD, amount: -4131, book: -4131, parallel: 0 }
        # parallel residual: 10,500,000 − 11,100,000 = −600,000 credit → a debit: realised loss 6,000.00 SYP
        - { account: "541001", currency: SYP, amount: 600000, book: 0, parallel: 600000 }
  balances:
    # what is left of P1's share: 30,000.00 TRY; 174,927 − 87,464 = 87,463; 21,000,000 − 10,500,000
    - { account: "211006", dims: { contract: P1 }, currency: TRY, amount: -3000000, book: -87463, parallel: -10500000 }
    - { account: "211006", dims: { contract: P2 }, currency: TRY, amount: -4000000, book: -111607, parallel: -14600000 }
  open_items:
    # 87,463 + 111,607 = 199,070; 10,500,000 + 14,600,000 = 25,100,000
    - { item: S2, account: "211006", dims: { supplier: S2 }, currency: TRY, amount: -7000000, book: -199070, parallel: -25100000 }
    # 54,000,000 + 36,000,000 + 3,000,000 = 93,000,000 TRY; 1,574,344 + 1,004,464 + 83,333; 189,000,000 + 131,400,000 + 11,100,000
    - { item: S2, account: "211002", dims: { supplier: S2 }, currency: TRY, amount: -93000000, book: -2662141, parallel: -331500000 }
  project_documents:
    - { kind: subcontract_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, supplier: S2, sequence: 1, entry: 1,
        currency: TRY, cumulative: 60000000, previous: 0, retention: 6000000, advance: 0 }
    - { kind: subcontract_billing, number: 1, date: 2027-01-31, contract: P2, client: C1, supplier: S2, sequence: 1, entry: 2,
        currency: TRY, cumulative: 40000000, previous: 0, retention: 4000000, advance: 0 }
    - { kind: retention_release, number: 1, date: 2027-02-28, contract: P1, client: C1, side: supplier, supplier: S2, entry: 3,
        currency: TRY, retention: 3000000 }
```
