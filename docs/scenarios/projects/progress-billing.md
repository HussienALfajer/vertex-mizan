# A client's progress billing

Status: Approved (owner, 2026-11-16)

The expected entries of the first eight cases were approved by the owner on 2026-11-16; after the accounting review the owner decided the same day that a recovery clears at the average of the project's own share of the client's advance (S12 rule 12, ADR 0023), and the last two cases were added for it and for S12 edge cases 7 and 8. S12's second PR brought the billings and releases to the `project_document` executor, the project terms setup and the project documents reader, and switched the cases to `Approved` with no expected value changed.

## Rule

A client's progress billing (مستخلص) is a numbered project document in the project's terms' currency. The accountant enters the cumulative certified value to date; the previous value is the cumulative of the project's latest posted, uncancelled billing; the period's value is their difference and must be above zero (`BILLING_NOT_INCREASING`), and a billing dated before the project's latest is refused (`VALIDATION_FAILED`). Retention and advance recovery are each the period's value times the project's rate, rounded half away from zero, the recovery capped at the client's advance balance for the project, and either may be changed by the accountant; the net is the remainder. The billing posts Dr `112001` the net and Dr `113002` the retention, each a new document item named by the billing's printed number and newly measured (no `112001` line when the net is zero), Dr `212002` the recovery, cleared at the average carrying amount of the project's share of the client's advance (the item's lines with this project), and Cr `411001` the period's value, whose covered part takes exactly the recovery's carried amounts and whose rest is newly measured, so the advance leaves no exchange difference; any conversion rounding of the new measurements, in an entry with a carried line, is a realised difference. Work done and not certified at month end, or certified in excess of the work done, is a manual entry the accountant reverses on the first of the next month. A billing is cancelled by reversing its entry, only while it is the latest uncancelled billing of its project (`PROJECT_DOCUMENT_NOT_LATEST`), and the reversal puts the advance back at exactly what it cleared.

## Basis

- **IFRS 15.35(b), 15.39 and 15.B15:** the contractor's performance creates an asset the client controls as it is built, so revenue is recognised over time; each certified billing is the survey of work performed to date (the output method), and the period's revenue is the cumulative less what was recognised before.
- **IFRS 15.105–108:** the unconditional right to the net is a receivable (`112001`); the retention, due only on completion, is a contract asset (`113002`); work done and not billed is a contract asset (`113001`) and a billing in excess of work done a contract liability (`212001`); an advance received is a contract liability (`212002`).
- **IFRIC 22.8–9 and IAS 21.23(b):** an advance received is non-monetary; the revenue it pays for is measured, for the part it covers, at the rate of the advance's receipt, so its recovery has no exchange difference and the advance is never revalued.
- **IAS 21.21–22 and 21.28:** every other line is recorded at the spot rate of the billing date (the ledger's policy rate); a residual left by conversion rounding in an entry with a carried line is a realised exchange difference.
- **Company policy:** S12 rules 12–17, 21 and 22 and its "Accounting treatment" (owner, 2026-11-16; Q20 answered: revenue by certified progress billings; ADR 0023); the application of advances at their carrying amount (owner, 2026-11-14), at the average of the project's own share of the client's advance (owner, 2026-11-16); advances applied only in their own currency (S12 answer 6); S04 rules 3, 4, 10 and 13 (running items cleared at the average carrying amount, document items, residuals, reopening by reversal); S03 rule 9 (the accountant's reversal); S07 (revaluation of monetary items only); the client's currencies, a USD book at `market` accepting dealt rates and an SYP parallel ledger at the bulletin (S11, ADR 0021).
- **Syrian rules:** the bulletin for the parallel ledger, UNVERIFIED (Q1), adopted by the owner as the company's policy; a daily TRY/SYP bulletin, UNVERIFIED (Q10), assumed by the owner (S11); Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The company is the contracting client's shape unless a case says otherwise: `usd-syp`, the USD book at `market` accepting dealt rates, the SYP parallel ledger at the bulletin, TRY as a third currency, and the chart `contracting@1` (S11 "Templates"): the USD bank `111004` and the TRY box `111005`, trade receivables `112001` (progress billings), contract assets `113001` (work done, not billed) and `113002` (retentions receivable), each a document control account for clients with client and contract required; contract liabilities `212001` (billings in excess) and advances from clients `212002` (a running control account for clients, non-monetary), with client and contract required; contract revenue `411001` (client and contract required); realised exchange gains `421001`. Project P1 belongs to client C1; its terms (S12 rule 1) are stated with the contract: the currency, the contract value, the retention rate (`retention_bp`) and the advance-recovery rate (`advance_recovery_bp`) in basis points. Every rate and amount is synthetic. Monday 2 November 2026, Wednesday 30 and Thursday 31 December 2026, Thursday 7 January, Sunday 31 January and Sunday 28 February 2027 are publication days; Friday 1 January 2027 is not, and a reversal reads no rate.

A `project_document` step is the document as the form sends it (S12 "Drafts"): `kind`, the `contract`, and for a billing the `cumulative` value typed, with `retention` and `advance` only where the accountant changed the computed deduction. It is saved as a draft and posted from it; its entry has the source `manual`. A billing's items on `112001` and `113002` are named by its printed number (`<fiscal year>/<number>`, S12 rule 21); the advance is a running item named by the client's code. `project_documents` states the exact set of the company's project documents: kind, number within its kind and fiscal year, date, project, client, the billing's number within its project (`sequence`), the entry it posted and the reversal that cancelled it (posting order), currency, cumulative, previous, retention and recovery (`advance`); the net is the period's value less both.

A difference line carries its amount in one ledger only, in that ledger's currency (ADR 0007).

The cases leave out what other scenarios own: the receipt of an advance and the settlement of a billing in another currency (`cash/receipt-and-payment.md`); the release of retentions (`projects/retention-release.md`); the subcontractor's billing (`projects/subcontract-billing.md`); the revaluation of receivables and contract assets (`currency/month-end-revaluation.md`); a billing dated in a closed period, refused as any posting there (`periods/close-and-reopen.md`); the project report and the balance sheet's contract positions (`reports/project-report.md`).

### The advance and the first billing

S12's example. Client C1 pays a 20,000.00 USD advance on P1 at the bulletin of 115. Billing 1 certifies 30,000.00 USD at 31 December, when the bulletin is 120: retention 10%, recovery 20%, net 21,000.00. The USD book takes every USD amount as it is. In the SYP parallel ledger the recovery clears 6,000 of the 20,000 advance at its average carrying amount, and the revenue's covered 6,000 takes exactly that, 690,000.00 SYP, while the other 24,000 is measured at 120: revenue 3,570,000.00 SYP, not 3,600,000.00, and no difference line.

```yaml
case: S12's example; advance 20,000.00 USD at 115, billing 1 cumulative 30,000.00 at 120; covered revenue at 115
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: USD, value: 10000000, retention_bp: 1000, advance_recovery_bp: 2000 } }] }
rates:
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: client C1 pays an advance on P1 into the USD bank
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111004", party_name: "العميل" },
               lines: [{ account: "111004", currency: USD, amount: 2000000 },
                       { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000 }] }
  - project_document: progress billing 1 of P1
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 3000000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        # parallel: 20,000.00 USD × 115 = 2,300,000.00 SYP
        - { account: "111004", currency: USD, amount: 2000000, book: 2000000, parallel: 230000000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000, book: -2000000, parallel: -230000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # period: 30,000.00 − 0 = 30,000.00; retention 10% = 3,000.00; recovery 20% = 6,000.00 (≤ 20,000.00)
        # net: 30,000.00 − 3,000.00 − 6,000.00 = 21,000.00; parallel × 120 = 2,520,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2100000, book: 2100000, parallel: 252000000 }
        # 3,000.00 × 120 = 360,000.00 SYP
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 300000, parallel: 36000000 }
        # cleared at the average: 230,000,000 × 6,000 / 20,000 = 69,000,000 (690,000.00 SYP)
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: 600000, book: 600000, parallel: 69000000 }
        # covered 6,000.00 at the advance's 69,000,000 + the other 24,000.00 × 120 = 288,000,000
        # → 357,000,000 (3,570,000.00 SYP); the entry balances with no residual: no difference line
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -3000000, book: -3000000, parallel: -357000000 }
  balances:
    - { account: "111004", currency: USD, amount: 2000000, book: 2000000, parallel: 230000000 }
    # 20,000.00 − 6,000.00 = 14,000.00 USD; 2,300,000.00 − 690,000.00 = 1,610,000.00 SYP
    - { account: "212002", book: -1400000, parallel: -161000000 }
    - { account: "411001", book: -3000000, parallel: -357000000 }
  open_items:
    - { item: "2026/1", account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2100000, book: 2100000, parallel: 252000000 }
    - { item: "2026/1", account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 300000, parallel: 36000000 }
    - { item: C1, account: "212002", dims: { client: C1 }, currency: USD, amount: -1400000, book: -1400000, parallel: -161000000 }
  project_documents:
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 2,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 600000 }
```

### Three cumulative billings, a receipt of the net and the advance used up

After billing 1 of the first case, the client pays its net on 7 January. Billing 2 certifies 75,000.00 cumulative at 31 January: the previous is 30,000.00, and the accountant raises the recovery to 10,000.00 as agreed with the client (S12 rule 15). Billing 3 certifies 110,000.00 at 28 February, above the contract value of 100,000.00 (a variation: posted with a warning); 20% of its period's value is 7,000.00, capped at the 4,000.00 left of the advance, which it clears to zero at what remains of its carrying amount. Billings 2 and 3 are the first and second of fiscal year 2027; their numbers within the project run on: 2 and 3.

```yaml
case: billings of 30,000, 75,000 and 110,000 cumulative; the net of billing 1 received; a recovery raised, then capped at the advance's balance
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: USD, value: 10000000, retention_bp: 1000, advance_recovery_bp: 2000 } }] }
rates:
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2027-01-07, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2027-01-31, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2027-02-28, base: USD, quote: SYP, rate: "130.0000", type: bulletin }
steps:
  - voucher: client C1 pays an advance on P1 into the USD bank
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111004", party_name: "العميل" },
               lines: [{ account: "111004", currency: USD, amount: 2000000 },
                       { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000 }] }
  - project_document: progress billing 1 of P1
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 3000000 } }
  - voucher: the client pays the net of billing 1
    accounting_date: 2027-01-07
    payload: { voucher: { kind: receipt, cash_account: "111004", party_name: "العميل" },
               lines: [{ account: "111004", currency: USD, amount: 2100000 },
                       { account: "112001", currency: USD, amount: -2100000, item: "2026/1" }] }
  - project_document: progress billing 2 of P1, the recovery raised to 10,000.00
    accounting_date: 2027-01-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 7500000, advance: 1000000 } }
  - project_document: progress billing 3 of P1, above the contract value
    accounting_date: 2027-02-28
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 11000000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "111004", currency: USD, amount: 2000000, book: 2000000, parallel: 230000000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000, book: -2000000, parallel: -230000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # as the first case: net 21,000.00, retention 3,000.00, recovery 6,000.00 at 690,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2100000, book: 2100000, parallel: 252000000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 300000, parallel: 36000000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: 600000, book: 600000, parallel: 69000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -3000000, book: -3000000, parallel: -357000000 }
    - source: manual
      date: 2027-01-07
      lines:
        # parallel: 21,000.00 USD × 122 = 2,562,000.00 SYP
        - { account: "111004", currency: USD, amount: 2100000, book: 2100000, parallel: 256200000 }
        # the whole item at what it carries: 2,520,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: -2100000, book: -2100000, parallel: -252000000 }
        # parallel residual: 256,200,000 − 252,000,000 = 4,200,000 → a credit: realised gain 42,000.00 SYP
        - { account: "421001", currency: SYP, amount: -4200000, book: 0, parallel: -4200000 }
    - source: manual
      date: 2027-01-31
      lines:
        # period: 75,000.00 − 30,000.00 = 45,000.00; retention 10% = 4,500.00; recovery typed 10,000.00
        #   (20% would be 9,000.00; 10,000.00 ≤ the 14,000.00 left); net: 45,000 − 4,500 − 10,000 = 30,500.00
        # parallel: 30,500.00 × 125 = 3,812,500.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 3050000, book: 3050000, parallel: 381250000 }
        # 4,500.00 × 125 = 562,500.00 SYP
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 450000, book: 450000, parallel: 56250000 }
        # cleared at the average: 161,000,000 × 10,000 / 14,000 = 115,000,000 (1,150,000.00 SYP)
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: 1000000, book: 1000000, parallel: 115000000 }
        # covered 10,000.00 at 115,000,000 + the other 35,000.00 × 125 = 437,500,000 → 552,500,000
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -4500000, book: -4500000, parallel: -552500000 }
    - source: manual
      date: 2027-02-28
      lines:
        # period: 110,000.00 − 75,000.00 = 35,000.00; retention 10% = 3,500.00
        # recovery: 20% = 7,000.00, capped at the 4,000.00 left of the advance; net: 35,000 − 3,500 − 4,000 = 27,500.00
        # parallel: 27,500.00 × 130 = 3,575,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2750000, book: 2750000, parallel: 357500000 }
        # 3,500.00 × 130 = 455,000.00 SYP
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 350000, book: 350000, parallel: 45500000 }
        # the whole balance at what is left: 161,000,000 − 115,000,000 = 46,000,000
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: 400000, book: 400000, parallel: 46000000 }
        # covered 4,000.00 at 46,000,000 + the other 31,000.00 × 130 = 403,000,000 → 449,000,000
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -3500000, book: -3500000, parallel: -449000000 }
  balances:
    # 20,000.00 + 21,000.00 = 41,000.00 USD; 2,300,000.00 + 2,562,000.00 = 4,862,000.00 SYP
    - { account: "111004", currency: USD, amount: 4100000, book: 4100000, parallel: 486200000 }
    # the advance used up in both ledgers: 6,000 + 10,000 + 4,000 = 20,000.00 USD
    - { account: "212002", book: 0, parallel: 0 }
    # 30,500.00 + 27,500.00 = 58,000.00 USD; 3,812,500.00 + 3,575,000.00 = 7,387,500.00 SYP
    - { account: "112001", book: 5800000, parallel: 738750000 }
    # 3,000 + 4,500 + 3,500 = 11,000.00 USD = 10% of 110,000.00; 360,000 + 562,500 + 455,000 = 1,377,500.00 SYP
    - { account: "113002", book: 1100000, parallel: 137750000 }
    # revenue = the cumulative certified, 110,000.00 USD; 3,570,000 + 5,525,000 + 4,490,000 = 13,585,000.00 SYP
    - { account: "411001", book: -11000000, parallel: -1358500000 }
    - { account: "421001", book: 0, parallel: -4200000 }
  open_items:
    - { item: "2026/1", account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: "2027/1", account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 3050000, book: 3050000, parallel: 381250000 }
    - { item: "2027/2", account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2750000, book: 2750000, parallel: 357500000 }
    - { item: "2027/2", account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 350000, book: 350000, parallel: 45500000 }
    - { item: C1, account: "212002", dims: { client: C1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
  project_documents:
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 2,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 600000 }
    # numbers restart in fiscal year 2027; the number within the project runs on
    - { kind: progress_billing, number: 1, date: 2027-01-31, contract: P1, client: C1, sequence: 2, entry: 4,
        currency: USD, cumulative: 7500000, previous: 3000000, retention: 450000, advance: 1000000 }
    - { kind: progress_billing, number: 2, date: 2027-02-28, contract: P1, client: C1, sequence: 3, entry: 5,
        currency: USD, cumulative: 11000000, previous: 7500000, retention: 350000, advance: 400000 }
```

### Work done and not billed at month end

At the end of December the site engineer's survey shows 8,000.00 USD of work done on P1 that the client has not certified. The accountant posts it as a contract asset, `113001`, against revenue, and reverses it on 1 January (S12 rule 17). Billing 1 then certifies 30,000.00 at 31 January; with no advance received, the recovery is capped at zero. December's revenue is 8,000.00 and January's 22,000.00: together the billing's period's value. The USD book has nothing in a foreign currency, so each month's revaluation posts nothing and only marks the month revalued.

```yaml
case: 8,000.00 USD of work not billed accrued on 113001 at 31 December and reversed on 1 January; billing 1 of 30,000.00 in January with no advance
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: USD, value: 10000000, retention_bp: 1000, advance_recovery_bp: 2000 } }] }
rates:
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2027-01-31, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - manual: work done on P1 in December and not yet certified
    accounting_date: 2026-12-31
    payload: { lines: [{ account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 800000,
                         open_item: { ref: WIP-2026-12 } },
                       { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -800000 }] }
  # nothing in a foreign currency in the USD book: nothing to revalue; the clock moves to 2027-01-01
  - revalue: book
    period: 2026-12
  - reversal: 1
    accounting_date: 2027-01-01
  - project_document: progress billing 1 of P1
    accounting_date: 2027-01-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 3000000 } }
  - revalue: book
    period: 2027-01
expect:
  entries:
    - source: manual
      date: 2026-12-31
      lines:
        # parallel: 8,000.00 × 120 = 960,000.00 SYP
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 800000, book: 800000, parallel: 96000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -800000, book: -800000, parallel: -96000000 }
    - source: reversal
      date: 2027-01-01
      lines:
        - { account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: -800000, book: -800000, parallel: -96000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: 800000, book: 800000, parallel: 96000000 }
    - source: manual
      date: 2027-01-31
      lines:
        # period: 30,000.00; retention 3,000.00; recovery: 20% = 6,000.00 capped at the advance's 0.00
        # net: 27,000.00; parallel × 125 = 3,375,000.00 SYP; no carried line, no residual
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2700000, book: 2700000, parallel: 337500000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 300000, parallel: 37500000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -3000000, book: -3000000, parallel: -375000000 }
  balances:
    - { account: "113001", book: 0, parallel: 0 }
    # revenue over the two months = the billing's period's value: 8,000.00 − 8,000.00 + 30,000.00
    - { account: "411001", book: -3000000, parallel: -375000000 }
  open_items:
    - { item: WIP-2026-12, account: "113001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: "2027/1", account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2700000, book: 2700000, parallel: 337500000 }
    - { item: "2027/1", account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 300000, parallel: 37500000 }
  project_documents:
    - { kind: progress_billing, number: 1, date: 2027-01-31, contract: P1, client: C1, sequence: 1, entry: 3,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 0 }
  reports:
    - report: income_statement
      params: { from: 2027-01-01, to: 2027-01-31, ledger: book, compare_from: 2026-12-01, compare_to: 2026-12-31 }
      marks: [period_open]
      compare_marks: [period_open]
      lines:
        # January: −8,000.00 (the reversal) + 30,000.00 (the billing) = 22,000.00; December: 8,000.00
        - { line: is.revenue, amount: 2200000, compare: 800000 }
      subtotals: { operating_profit: 2200000, profit_before_tax: 2200000, profit: 2200000 }
      compare_subtotals: { operating_profit: 800000, profit_before_tax: 800000, profit: 800000 }
```

### A billing in excess of the work done

Billing 1 certifies 30,000.00 USD at 31 December, but the site engineer's survey shows only 26,000.00 of work done. The accountant moves the 4,000.00 billed in excess from revenue to a contract liability, `212001`, and reverses it on 1 January (S12 rule 17). December's revenue is the 26,000.00 of work done.

```yaml
case: billing 1 of 30,000.00 USD at 31 December with 26,000.00 of work done; 4,000.00 moved to 212001 and reversed on 1 January
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: USD, value: 10000000, retention_bp: 1000, advance_recovery_bp: 2000 } }] }
rates:
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - project_document: progress billing 1 of P1
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 3000000 } }
  - manual: billed in excess of the work done on P1 at 31 December
    accounting_date: 2026-12-31
    payload: { lines: [{ account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: 400000 },
                       { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -400000 }] }
  - revalue: book
    period: 2026-12
  - reversal: 2
    accounting_date: 2027-01-01
expect:
  entries:
    - source: manual
      date: 2026-12-31
      lines:
        # no advance: recovery 0.00; retention 3,000.00; net 27,000.00; parallel × 120
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2700000, book: 2700000, parallel: 324000000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 300000, parallel: 36000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -3000000, book: -3000000, parallel: -360000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # 30,000.00 certified − 26,000.00 done = 4,000.00; parallel × 120 = 480,000.00 SYP
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: 400000, book: 400000, parallel: 48000000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: -400000, book: -400000, parallel: -48000000 }
    - source: reversal
      date: 2027-01-01
      lines:
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -400000, book: -400000, parallel: -48000000 }
        - { account: "212001", dims: { client: C1, contract: P1 }, currency: USD, amount: 400000, book: 400000, parallel: 48000000 }
  balances:
    - { account: "212001", book: 0, parallel: 0 }
    - { account: "411001", book: -3000000, parallel: -360000000 }
  project_documents:
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 1,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 0 }
  reports:
    - report: income_statement
      params: { from: 2026-12-01, to: 2026-12-31, ledger: book }
      marks: [period_open]
      lines:
        # 30,000.00 certified − 4,000.00 in excess = 26,000.00 of work done
        - { line: is.revenue, amount: 2600000 }
      subtotals: { operating_profit: 2600000, profit_before_tax: 2600000, profit: 2600000 }
```

### Refused billings, and the cancellations in order

After the advance and billing 1 of the first case, the accountant tries billing 2 with a cumulative of 25,000.00 and then of 30,000.00: neither is above the previous 30,000.00 (`BILLING_NOT_INCREASING`). Billing 2 dated 30 December, before billing 1, is refused too (`VALIDATION_FAILED`). Billing 2 then posts on 31 January with 50,000.00 cumulative; the refusals consumed no number. On 1 February the accountant cancels billing 1, which is refused while billing 2 stands (`PROJECT_DOCUMENT_NOT_LATEST`); cancelling billing 2, then billing 1, reverses each entry exactly, and the advance is back at 20,000.00 USD and 2,300,000.00 SYP with no difference line (S04 rule 13).

```yaml
case: billing 2 refused at 25,000 and 30,000 cumulative and when back-dated; billing 1 cancelled only after billing 2; the advance restored
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: USD, value: 10000000, retention_bp: 1000, advance_recovery_bp: 2000 } }] }
rates:
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-12-30, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2027-01-31, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - voucher: client C1 pays an advance on P1 into the USD bank
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111004", party_name: "العميل" },
               lines: [{ account: "111004", currency: USD, amount: 2000000 },
                       { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000 }] }
  - project_document: progress billing 1 of P1
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 3000000 } }
  - project_document: billing 2 below the previous cumulative
    accounting_date: 2027-01-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 2500000 } }
    outcome: { status: refused, reason: BILLING_NOT_INCREASING }
  - project_document: billing 2 equal to the previous cumulative
    accounting_date: 2027-01-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 3000000 } }
    outcome: { status: refused, reason: BILLING_NOT_INCREASING }
  - project_document: billing 2 dated before billing 1
    accounting_date: 2026-12-30
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 5000000 } }
    outcome: { status: refused, reason: VALIDATION_FAILED }
  - project_document: progress billing 2 of P1
    accounting_date: 2027-01-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 5000000 } }
  - reversal: 2
    accounting_date: 2027-02-01
    outcome: { status: refused, reason: PROJECT_DOCUMENT_NOT_LATEST }
  - reversal: 3
    accounting_date: 2027-02-01
  - reversal: 2
    accounting_date: 2027-02-01
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "111004", currency: USD, amount: 2000000, book: 2000000, parallel: 230000000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000, book: -2000000, parallel: -230000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # as the first case
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2100000, book: 2100000, parallel: 252000000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 300000, parallel: 36000000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: 600000, book: 600000, parallel: 69000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -3000000, book: -3000000, parallel: -357000000 }
    - source: manual
      date: 2027-01-31
      lines:
        # period: 50,000.00 − 30,000.00 = 20,000.00; retention 2,000.00; recovery 4,000.00 (≤ 14,000.00); net 14,000.00
        # parallel: 14,000.00 × 125 = 1,750,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 1400000, book: 1400000, parallel: 175000000 }
        # 2,000.00 × 125 = 250,000.00 SYP
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 200000, book: 200000, parallel: 25000000 }
        # cleared at the average: 161,000,000 × 4,000 / 14,000 = 46,000,000
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: 400000, book: 400000, parallel: 46000000 }
        # covered 4,000.00 at 46,000,000 + 16,000.00 × 125 = 200,000,000 → 246,000,000
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000, book: -2000000, parallel: -246000000 }
    - source: reversal
      date: 2027-02-01
      lines:
        # billing 2 reversed exactly; its items close and the advance takes back 4,000.00 at 46,000,000
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: -1400000, book: -1400000, parallel: -175000000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: -200000, book: -200000, parallel: -25000000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -400000, book: -400000, parallel: -46000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2000000, book: 2000000, parallel: 246000000 }
    - source: reversal
      date: 2027-02-01
      lines:
        # billing 1 reversed exactly; the advance takes back 6,000.00 at 69,000,000
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: -2100000, book: -2100000, parallel: -252000000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: -300000, book: -300000, parallel: -36000000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -600000, book: -600000, parallel: -69000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: 3000000, book: 3000000, parallel: 357000000 }
  balances:
    # the advance as received: 14,000 + 4,000 + 6,000 = 20,000.00 USD; 161,000,000 + 46,000,000 + 69,000,000
    - { account: "212002", book: -2000000, parallel: -230000000 }
    - { account: "112001", book: 0, parallel: 0 }
    - { account: "113002", book: 0, parallel: 0 }
    - { account: "411001", book: 0, parallel: 0 }
  open_items:
    - { item: "2026/1", account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: "2027/1", account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: C1, account: "212002", dims: { client: C1 }, currency: USD, amount: -2000000, book: -2000000, parallel: -230000000 }
  project_documents:
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 2,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 600000, cancelled_by: 5 }
    # the three refusals consumed no number: billing 2 is the project's second and 2027's first
    - { kind: progress_billing, number: 1, date: 2027-01-31, contract: P1, client: C1, sequence: 2, entry: 3,
        currency: USD, cumulative: 5000000, previous: 3000000, retention: 200000, advance: 400000, cancelled_by: 4 }
```

### A TRY contract in the USD book: the covered revenue at the advance's carrying amount in both ledgers

Project P1's terms are in TRY: 3,000,000.00 TRY, retention 10%, recovery 20%. Client C1 pays a 600,000.00 TRY advance into the TRY box on 2 November, at the market 33.0000 TRY per USD and the bulletin 3.4000 SYP per TRY. Billing 1 certifies 900,000.00 TRY at 31 December, at the market 34.3000 and the bulletin 3.5000. The recovery of 180,000.00 TRY clears 30% of the advance at its carrying amounts in each ledger, and the revenue's covered part takes them: so here the USD book keeps the November rate for the covered part too. The net, the retention and the revenue's other 720,000.00 TRY are each measured at the day's rates; their conversion leaves 0.01 USD in the book, which in an entry with a carried line is a realised difference (S04 rule 10).

```yaml
case: a TRY advance of 600,000.00 at 33 and 3.4; billing 1 of 900,000.00 TRY at 34.3 and 3.5; covered revenue in both ledgers; 0.01 USD realised
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: TRY, value: 300000000, retention_bp: 1000, advance_recovery_bp: 2000 } }] }
rates:
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-11-02, base: TRY, quote: SYP, rate: "3.4000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: TRY, rate: "33.0000", type: market }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-31, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: TRY, rate: "34.3000", type: market }
steps:
  - voucher: client C1 pays a TRY advance on P1 into the TRY box
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "العميل" },
               lines: [{ account: "111005", currency: TRY, amount: 60000000 },
                       { account: "212002", dims: { client: C1, contract: P1 }, currency: TRY, amount: -60000000 }] }
  - project_document: progress billing 1 of P1 in TRY
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 90000000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        # book: 600,000.00 TRY / 33 = 18,181.8181… → 18,181.82 USD; parallel: × 3.4 = 2,040,000.00 SYP
        - { account: "111005", currency: TRY, amount: 60000000, book: 1818182, parallel: 204000000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: TRY, amount: -60000000, book: -1818182, parallel: -204000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # period: 900,000.00 TRY; retention 90,000.00; recovery 180,000.00 (≤ 600,000.00); net 630,000.00
        # book: 630,000.00 / 34.3 = 18,367.3469… → 18,367.35 USD; parallel: × 3.5 = 2,205,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: TRY, amount: 63000000, book: 1836735, parallel: 220500000 }
        # book: 90,000.00 / 34.3 = 2,623.9067… → 2,623.91 USD; parallel: × 3.5 = 315,000.00 SYP
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: TRY, amount: 9000000, book: 262391, parallel: 31500000 }
        # 180,000 of 600,000 at the average: book 1,818,182 × 0.3 = 545,454.6 → 545,455;
        #   parallel 204,000,000 × 0.3 = 61,200,000
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: TRY, amount: 18000000, book: 545455, parallel: 61200000 }
        # covered 180,000.00 at the advance's 545,455 and 61,200,000; the other 720,000.00 TRY:
        #   book 720,000.00 / 34.3 = 20,991.2536… → 20,991.25 USD; parallel × 3.5 = 2,520,000.00 SYP
        # book: 545,455 + 2,099,125 = 2,644,580; parallel: 61,200,000 + 252,000,000 = 313,200,000
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: TRY, amount: -90000000, book: -2644580, parallel: -313200000 }
        # book residual: 1,836,735 + 262,391 + 545,455 − 2,644,580 = 1 → a credit: realised gain 0.01 USD
        # parallel residual: 220,500,000 + 31,500,000 + 61,200,000 − 313,200,000 = 0 → no line
        - { account: "421001", currency: USD, amount: -1, book: -1, parallel: 0 }
  balances:
    # 420,000.00 TRY left: book 1,818,182 − 545,455 = 1,272,727; parallel 204,000,000 − 61,200,000 = 142,800,000
    - { account: "212002", currency: TRY, amount: -42000000, book: -1272727, parallel: -142800000 }
    - { account: "411001", currency: TRY, amount: -90000000, book: -2644580, parallel: -313200000 }
  open_items:
    - { item: "2026/1", account: "112001", dims: { client: C1, contract: P1 }, currency: TRY, amount: 63000000, book: 1836735, parallel: 220500000 }
    - { item: "2026/1", account: "113002", dims: { client: C1, contract: P1 }, currency: TRY, amount: 9000000, book: 262391, parallel: 31500000 }
    - { item: C1, account: "212002", dims: { client: C1 }, currency: TRY, amount: -42000000, book: -1272727, parallel: -142800000 }
  project_documents:
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 2,
        currency: TRY, cumulative: 90000000, previous: 0, retention: 9000000, advance: 18000000 }
```

### The same billing in SYP books

S12 edge case 16: the first case in a company with SYP books at the bulletin and no parallel ledger. The book now moves with the USD: the covered revenue keeps the advance's 115, the rest is measured at 120, and no difference line arises.

```yaml
case: syp; advance 20,000.00 USD at 115, billing 1 cumulative 30,000.00 at 120; covered revenue at 115 in the book
company: { shape: syp, book: SYP, template: contracting,
           rate_policy: { book: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: USD, value: 10000000, retention_bp: 1000, advance_recovery_bp: 2000 } }] }
rates:
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: client C1 pays an advance on P1 into the USD bank
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111004", party_name: "العميل" },
               lines: [{ account: "111004", currency: USD, amount: 2000000 },
                       { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000 }] }
  - project_document: progress billing 1 of P1
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 3000000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        # 20,000.00 USD × 115 = 2,300,000.00 SYP
        - { account: "111004", currency: USD, amount: 2000000, book: 230000000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000, book: -230000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # net 21,000.00 × 120 = 2,520,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2100000, book: 252000000 }
        # retention 3,000.00 × 120 = 360,000.00 SYP
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 36000000 }
        # 230,000,000 × 6,000 / 20,000 = 69,000,000
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: 600000, book: 69000000 }
        # 69,000,000 + 24,000.00 × 120 = 357,000,000; no residual
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -3000000, book: -357000000 }
  balances:
    - { account: "212002", currency: USD, amount: -1400000, book: -161000000 }
    - { account: "411001", book: -357000000 }
  open_items:
    - { item: "2026/1", account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2100000, book: 252000000 }
    - { item: "2026/1", account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 36000000 }
    - { item: C1, account: "212002", dims: { client: C1 }, currency: USD, amount: -1400000, book: -161000000 }
  project_documents:
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 2,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 600000 }
```

### The same billing in SYP books with a USD parallel ledger

S12 edge case 17: the SYP book as in the previous case; the USD parallel ledger takes every USD amount as it is, so the advance has no effect there.

```yaml
case: syp-usd; advance 20,000.00 USD at 115, billing 1 cumulative 30,000.00 at 120; covered revenue at 115 in the book, USD as is in the parallel
company: { shape: syp-usd, book: SYP, parallel: USD, template: contracting,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: USD, value: 10000000, retention_bp: 1000, advance_recovery_bp: 2000 } }] }
rates:
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: client C1 pays an advance on P1 into the USD bank
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111004", party_name: "العميل" },
               lines: [{ account: "111004", currency: USD, amount: 2000000 },
                       { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000 }] }
  - project_document: progress billing 1 of P1
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 3000000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "111004", currency: USD, amount: 2000000, book: 230000000, parallel: 2000000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000, book: -230000000, parallel: -2000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # book as the SYP case; parallel: the USD amounts as they are
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2100000, book: 252000000, parallel: 2100000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 36000000, parallel: 300000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: 600000, book: 69000000, parallel: 600000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -3000000, book: -357000000, parallel: -3000000 }
  balances:
    - { account: "212002", currency: USD, amount: -1400000, book: -161000000, parallel: -1400000 }
    - { account: "411001", book: -357000000, parallel: -3000000 }
  open_items:
    - { item: "2026/1", account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2100000, book: 252000000, parallel: 2100000 }
    - { item: "2026/1", account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 36000000, parallel: 300000 }
    - { item: C1, account: "212002", dims: { client: C1 }, currency: USD, amount: -1400000, book: -161000000, parallel: -1400000 }
  project_documents:
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 2,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 600000 }
```

### One client's advance for two projects: each recovery at its own project's share

S12 edge case 6. Client C1 pays 20,000.00 USD on P1 at the bulletin of 115 and 10,000.00 USD on P2 at 125: one running item for C1 in USD on `212002`, carried at 3,550,000.00 SYP, whose average (118.33) belongs to neither project. A recovery clears at the average of its own project's lines in the item (S12 rule 12; owner, 2026-11-16), so P1's revenue keeps P1's 115 and P2's keeps P2's 125. P1's billing first tries a recovery of 21,000.00, above P1's 20,000.00 though within the item's 30,000.00: refused (`RELEASE_EXCEEDS_BALANCE`), and it consumes no number.

```yaml
case: C1's advances of 20,000.00 USD on P1 at 115 and 10,000.00 on P2 at 125; each billing at 120 recovers at its project's own average
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: USD, value: 10000000, retention_bp: 1000, advance_recovery_bp: 2000 } },
                       { code: P2, kind: project, client: C1,
                         terms: { currency: USD, value: 5000000, retention_bp: 1000, advance_recovery_bp: 2000 } }] }
rates:
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-11-16, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: client C1 pays an advance on P1 into the USD bank
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111004", party_name: "العميل" },
               lines: [{ account: "111004", currency: USD, amount: 2000000 },
                       { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000 }] }
  - voucher: client C1 pays an advance on P2 into the USD bank
    accounting_date: 2026-11-16
    payload: { voucher: { kind: receipt, cash_account: "111004", party_name: "العميل" },
               lines: [{ account: "111004", currency: USD, amount: 1000000 },
                       { account: "212002", dims: { client: C1, contract: P2 }, currency: USD, amount: -1000000 }] }
  - project_document: billing 1 of P1 recovering more than P1's advance
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 3000000, advance: 2100000 } }
    outcome: { status: refused, reason: RELEASE_EXCEEDS_BALANCE }
  - project_document: progress billing 1 of P1
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 3000000 } }
  - project_document: progress billing 1 of P2
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P2, cumulative: 2000000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        # 20,000.00 × 115 = 2,300,000.00 SYP
        - { account: "111004", currency: USD, amount: 2000000, book: 2000000, parallel: 230000000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000, book: -2000000, parallel: -230000000 }
    - source: manual
      date: 2026-11-16
      lines:
        # 10,000.00 × 125 = 1,250,000.00 SYP
        - { account: "111004", currency: USD, amount: 1000000, book: 1000000, parallel: 125000000 }
        - { account: "212002", dims: { client: C1, contract: P2 }, currency: USD, amount: -1000000, book: -1000000, parallel: -125000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # P1 as the first case: net 21,000.00, retention 3,000.00, recovery 6,000.00
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2100000, book: 2100000, parallel: 252000000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 300000, parallel: 36000000 }
        # P1's share: 20,000.00 at 230,000,000 → 230,000,000 × 6,000 / 20,000 = 69,000,000
        #   (the item's average would give 355,000,000 × 6,000 / 30,000 = 71,000,000)
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: 600000, book: 600000, parallel: 69000000 }
        # 69,000,000 + 24,000.00 × 120 = 357,000,000
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -3000000, book: -3000000, parallel: -357000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # P2: period 20,000.00; retention 2,000.00; recovery 4,000.00 (≤ P2's 10,000.00); net 14,000.00
        # 14,000.00 × 120 = 1,680,000.00 SYP
        - { account: "112001", dims: { client: C1, contract: P2 }, currency: USD, amount: 1400000, book: 1400000, parallel: 168000000 }
        # 2,000.00 × 120 = 240,000.00 SYP
        - { account: "113002", dims: { client: C1, contract: P2 }, currency: USD, amount: 200000, book: 200000, parallel: 24000000 }
        # P2's share: 10,000.00 at 125,000,000 → 125,000,000 × 4,000 / 10,000 = 50,000,000
        - { account: "212002", dims: { client: C1, contract: P2 }, currency: USD, amount: 400000, book: 400000, parallel: 50000000 }
        # 50,000,000 + 16,000.00 × 120 = 192,000,000 → 242,000,000
        - { account: "411001", dims: { client: C1, contract: P2 }, currency: USD, amount: -2000000, book: -2000000, parallel: -242000000 }
  balances:
    # what is left of each project's share: P1 14,000.00 at 1,610,000.00 SYP; P2 6,000.00 at 750,000.00 SYP
    - { account: "212002", dims: { contract: P1 }, book: -1400000, parallel: -161000000 }
    - { account: "212002", dims: { contract: P2 }, book: -600000, parallel: -75000000 }
    - { account: "411001", dims: { contract: P1 }, book: -3000000, parallel: -357000000 }
    - { account: "411001", dims: { contract: P2 }, book: -2000000, parallel: -242000000 }
  open_items:
    # one running item for C1 in USD: 20,000.00 left, 161,000,000 + 75,000,000 = 236,000,000
    - { item: C1, account: "212002", dims: { client: C1 }, currency: USD, amount: -2000000, book: -2000000, parallel: -236000000 }
    - { item: "2026/1", account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2100000, book: 2100000, parallel: 252000000 }
    - { item: "2026/2", account: "112001", dims: { client: C1, contract: P2 }, currency: USD, amount: 1400000, book: 1400000, parallel: 168000000 }
  project_documents:
    # the refusal consumed no number; numbers run per kind and year, sequences per project
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 3,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 600000 }
    - { kind: progress_billing, number: 2, date: 2026-12-31, contract: P2, client: C1, sequence: 1, entry: 4,
        currency: USD, cumulative: 2000000, previous: 0, retention: 200000, advance: 400000 }
```

### A first billing of zero, and a billing whose deductions take its whole value

S12 edge cases 7 and 8. A first billing with a cumulative of 0.00 is refused (`BILLING_NOT_INCREASING`). Billing 1 then certifies 10,000.00 USD; the retention is 1,000.00 and the accountant recovers 9,000.00 of the 20,000.00 advance, so the net is zero: the billing posts no `112001` line and opens no receivable, only the retention item.

```yaml
case: a first billing of 0.00 refused; billing 1 of 10,000.00 with retention 1,000.00 and recovery 9,000.00 posts no receivable
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: USD, value: 10000000, retention_bp: 1000, advance_recovery_bp: 2000 } }] }
rates:
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: client C1 pays an advance on P1 into the USD bank
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111004", party_name: "العميل" },
               lines: [{ account: "111004", currency: USD, amount: 2000000 },
                       { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000 }] }
  - project_document: a first billing of zero
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 0 } }
    outcome: { status: refused, reason: BILLING_NOT_INCREASING }
  - project_document: progress billing 1 of P1, all of it deducted
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 1000000, advance: 900000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "111004", currency: USD, amount: 2000000, book: 2000000, parallel: 230000000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000, book: -2000000, parallel: -230000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # period 10,000.00; retention 10% = 1,000.00; recovery typed 9,000.00 (20% would be 2,000.00);
        # net: 10,000.00 − 1,000.00 − 9,000.00 = 0 → no 112001 line
        # 1,000.00 × 120 = 120,000.00 SYP
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 100000, book: 100000, parallel: 12000000 }
        # 230,000,000 × 9,000 / 20,000 = 103,500,000
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: 900000, book: 900000, parallel: 103500000 }
        # covered 9,000.00 at 103,500,000 + the other 1,000.00 × 120 = 12,000,000 → 115,500,000
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -1000000, book: -1000000, parallel: -115500000 }
  balances:
    - { account: "112001", book: 0, parallel: 0 }
    # 11,000.00 USD left at 230,000,000 − 103,500,000 = 126,500,000
    - { account: "212002", book: -1100000, parallel: -126500000 }
  open_items:
    - { item: "2026/1", account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 100000, book: 100000, parallel: 12000000 }
  project_documents:
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 2,
        currency: USD, cumulative: 1000000, previous: 0, retention: 100000, advance: 900000 }
```
