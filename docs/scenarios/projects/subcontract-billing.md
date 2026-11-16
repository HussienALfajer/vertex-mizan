# A subcontractor's billing

Status: Approved (owner, 2026-11-16)

The expected entries of the eight cases were approved by the owner on 2026-11-16, with two readings of S12 rules 12, 15 and 18: the subcontractor's net on `211002`, like the retention on `211006`, carries the project, as a purchase's credit does; and while the supplier's advance for the project is held only in another currency, a typed recovery is refused (`ADVANCE_CURRENCY_MISMATCH`) and the computed one is capped at zero, as when there is no advance. S12's second PR brought the billings and releases to the `project_document` executor, the project terms setup and the project documents reader, and switched the cases to `Approved` with no expected value changed. After the accounting review the owner decided on 2026-11-16 that a billing's or a release's cancellation is exact: its reversal gives each running item back exactly what it moved, with no S04 rule 13 difference entry, so a project's share of an advance or a retention stays the sum of its lines; it is refused (`OPEN_ITEM_HAS_SETTLEMENTS`) while a later payment of the supplier or a later release or recovery of the project's share stands.

## Rule

A subcontractor's billing (مستخلص مقاول باطن) is a numbered project document, the mirror of a client's progress billing. It names the project and the supplier; their subcontract (S12 rule 2) gives its currency, its value and its retention and advance-recovery rates, and a billing without one is refused (`PROJECT_TERMS_MISSING`). The accountant enters the cumulative value certified to date; the previous value is the cumulative of the subcontract's latest posted, uncancelled billing; the period's value is their difference and must be above zero (`BILLING_NOT_INCREASING`), and a billing dated before the subcontract's latest is refused (`VALIDATION_FAILED`). Retention and advance recovery are each the period's value times the subcontract's rate, rounded half away from zero, the recovery capped at the supplier's advance for the project in the subcontract's currency, and either may be changed by the accountant; the net is the remainder. The billing posts Dr `511003` the period's value with the project and the supplier, Cr `211006` the retention and Cr `211002` the net, each on the supplier's running item with the project on the line and newly measured, and Cr `114002` the recovery, cleared at the average carrying amount of the project's share of the supplier's advance (the item's lines with this project). The cost's covered part takes exactly the recovery's carried amounts and its rest is newly measured, so the advance leaves no exchange difference; any conversion rounding of the new measurements, in an entry with a carried line, is a realised difference. A recovery typed above the project's share is refused (`RELEASE_EXCEEDS_BALANCE`), and one typed while the supplier's advance for the project is held only in another currency is refused (`ADVANCE_CURRENCY_MISMATCH`). The net is paid by a payment voucher on `211002`, which clears the running item at its average carrying amount and realises each ledger's residual. A billing is cancelled by reversing its entry, only while it is the latest uncancelled billing of its subcontract (`PROJECT_DOCUMENT_NOT_LATEST`), and the reversal puts the advance back at exactly what it cleared.

## Basis

- **IAS 1.102:** the subcontractor's work is a project cost by nature under `is.direct_costs` (`511003`), carrying its contract and the supplier.
- **IAS 21.21–22 and 21.23(a):** the cost's uncovered part, the retention payable and the net payable are recorded at the spot rate of the billing date (the ledger's policy rate); both payables are monetary. **IAS 21.28:** settling the net at a later rate, or the conversion rounding of the new measurements in an entry with a carried line, realises an exchange difference.
- **IFRIC 22.8–9 and IAS 21.23(b):** an advance paid to a subcontractor is non-monetary; the cost it pays for is measured, for the part it covers, at the rate of the advance's payment, so its recovery has no exchange difference and the advance is never revalued.
- **Company policy:** S12 rules 2, 12–15, 18, 21 and 22 and its "Accounting treatment" (owner, 2026-11-16; ADR 0023); the application of advances at their carrying amount (owner, 2026-11-14), at the average of the project's own share (owner, 2026-11-16); advances applied only in their own currency (S12 answer 6); the supplier's credit carrying the project, as approved for a purchase (`projects/purchase-invoice.md`, owner, 2026-11-16); S04 rules 3, 10 and 13 (running items cleared at the average carrying amount, residuals, reopening by reversal); S11 rules 8 and 11 (payment vouchers, the box never below zero); S03 rule 9 (the accountant's reversal); S07 (revaluation of monetary items only); the client's currencies, a USD book at `market` accepting dealt rates and an SYP parallel ledger at the bulletin (S11, ADR 0021).
- **Syrian rules:** the bulletin for the parallel ledger, UNVERIFIED (Q1), adopted by the owner as the company's policy; a daily TRY/SYP bulletin, UNVERIFIED (Q10), assumed by the owner (S11); Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The company is the contracting client's shape unless a case says otherwise: `usd-syp`, the USD book at `market` accepting dealt rates, the SYP parallel ledger at the bulletin, TRY as a third currency, and the chart `contracting@1` (S11 "Templates"):
- the USD box `111002` and the TRY box `111005`;
- advances to suppliers and subcontractors `114002`, a running control account for suppliers, non-monetary, with supplier and contract required;
- subcontractors' payables `211002`, a running control account for suppliers, monetary, with the supplier required;
- retentions payable to subcontractors `211006`, a running control account for suppliers, monetary, with supplier and contract required;
- the owner's current account `313001`;
- subcontractors `511003`, requiring the contract;
- realised exchange gains `421001` and losses `541001`.

Project P1 (and P2 where a case names it) belongs to client C1; S2 and S3 are subcontractors, values of the `supplier` dimension. A subcontract pairs a project and a supplier with its currency, its value and its rates in basis points (`retention_bp`, `advance_recovery_bp`). Every rate and amount is synthetic. Monday 2 and Monday 16 November, Wednesday 30 and Thursday 31 December 2026, Thursday 7 January, Sunday 31 January and Monday 1 February 2027 are publication days.

A `project_document` step for a subcontractor's billing is the document as the form sends it (S12 "Drafts"): `kind: subcontract_billing`, the `contract`, the `supplier` and the `cumulative` value typed, with `retention` and `advance` only where the accountant changed the computed deduction; the currency is the subcontract's. It is saved as a draft and posted from it; its entry has the source `manual`. The advance, the retention and the payable are running items named by the supplier's code. `project_documents` states the exact set of the company's project documents: kind, number within its kind and fiscal year, date, project and its client, the supplier, the billing's number within its subcontract (`sequence`), the entry it posted and the reversal that cancelled it (posting order), currency, cumulative, previous, retention and recovery (`advance`); the net is the period's value less both.

Each case that pays from a box first puts cash into it by a receipt voucher from the owner's current account, since a box never goes below zero (S11 rule 8). A difference line carries its amount in one ledger only, in that ledger's currency (ADR 0007).

The cases leave out what other scenarios own:
- the release of the subcontractors' retentions (`projects/retention-release.md`);
- the month-end revaluation of `211002` and `211006` (`currency/month-end-revaluation.md`);
- a billing dated in a closed period, refused as any posting there (`periods/close-and-reopen.md`);
- the project report's subcontracts (`reports/project-report.md`).

### S12's example: a TRY advance, two billings and the payment between them

Subcontractor S2's subcontract on P1 is in TRY: 1,500,000.00 TRY, retention 10%, recovery 20%. On 2 November the owner puts 300,000.00 TRY into the TRY box, and the box pays it to S2 as an advance on P1, at the market 33.0000 TRY per USD and the bulletin 3.4000 SYP per TRY: carried at 9,090.91 USD and 1,020,000.00 SYP.

Billing 1 certifies 600,000.00 TRY at 31 December, at 34.3000 and 3.5000: retention 60,000.00, recovery 120,000.00, net 420,000.00. The recovery clears 40% of the advance at its carrying amounts, and the cost's covered part takes them, in both ledgers; the other 480,000.00 TRY and the two payables are measured at the day's rates, and nothing is left over.

On 7 January, at 35.0000 and 3.6000, the TRY box pays S2 the net. The payment clears S2's payable at what it carries; TRY has fallen against the USD and risen against the SYP, so the book realises a gain of 244.90 USD and the parallel ledger a loss of 42,000.00 SYP.

Billing 2 certifies 1,600,000.00 TRY at 31 January, at 35.8400 and 3.6500, above the subcontract's value (a variation: posted with a warning). 20% of its period's value is 200,000.00, capped at the 180,000.00 left of the advance, which it clears to zero at what remains of its carrying amount. The new measurements' conversion leaves the book 0.01 USD short, realised as a loss. It is 2027's first subcontract billing and S2's second on P1.

```yaml
case: a 300,000.00 TRY advance at 33 and 3.4; billings of 600,000 and 1,600,000 cumulative; the net of billing 1 paid at 35 and 3.6; the advance used up
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }],
           subcontracts: [{ contract: P1, supplier: S2, currency: TRY, value: 150000000,
                            retention_bp: 1000, advance_recovery_bp: 2000 }] }
rates:
  - { date: 2026-11-02, base: TRY, quote: SYP, rate: "3.4000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: TRY, rate: "33.0000", type: market }
  - { date: 2026-12-31, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: TRY, rate: "34.3000", type: market }
  - { date: 2027-01-07, base: TRY, quote: SYP, rate: "3.6000", type: bulletin }
  - { date: 2027-01-07, base: USD, quote: TRY, rate: "35.0000", type: market }
  - { date: 2027-01-31, base: TRY, quote: SYP, rate: "3.6500", type: bulletin }
  - { date: 2027-01-31, base: USD, quote: TRY, rate: "35.8400", type: market }
steps:
  - voucher: the owner pays 300,000.00 TRY into the TRY box
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 30000000 },
                       { account: "313001", currency: TRY, amount: -30000000 }] }
  - voucher: an advance of 300,000.00 TRY paid to S2 for P1
    accounting_date: 2026-11-02
    payload: { voucher: { kind: payment, cash_account: "111005", party_name: "مقاول الباطن" },
               lines: [{ account: "114002", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: 30000000 },
                       { account: "111005", currency: TRY, amount: -30000000 }] }
  - project_document: S2's billing 1 on P1
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 60000000 } }
  - voucher: the owner pays 420,000.00 TRY into the TRY box
    accounting_date: 2027-01-07
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 42000000 },
                       { account: "313001", currency: TRY, amount: -42000000 }] }
  - voucher: the net of billing 1 paid to S2
    accounting_date: 2027-01-07
    payload: { voucher: { kind: payment, cash_account: "111005", party_name: "مقاول الباطن" },
               lines: [{ account: "211002", dims: { supplier: S2 }, currency: TRY, amount: 42000000 },
                       { account: "111005", currency: TRY, amount: -42000000 }] }
  - project_document: S2's billing 2 on P1, above the subcontract's value
    accounting_date: 2027-01-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 160000000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        # book: 300,000.00 TRY / 33 = 9,090.9090… → 9,090.91 USD; parallel: × 3.4 = 1,020,000.00 SYP
        - { account: "111005", currency: TRY, amount: 30000000, book: 909091, parallel: 102000000 }
        - { account: "313001", currency: TRY, amount: -30000000, book: -909091, parallel: -102000000 }
    - source: manual
      date: 2026-11-02
      lines:
        # a new running item for S2 in TRY, all of it P1's
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: 30000000, book: 909091, parallel: 102000000 }
        - { account: "111005", currency: TRY, amount: -30000000, book: -909091, parallel: -102000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # period: 600,000.00 − 0 = 600,000.00; retention 10% = 60,000.00; recovery 20% = 120,000.00 (≤ 300,000.00)
        # net: 600,000.00 − 60,000.00 − 120,000.00 = 420,000.00
        # covered 120,000.00 at the advance's 363,636 and 40,800,000; the other 480,000.00 TRY:
        #   book / 34.3 = 13,994.1690… → 13,994.17 USD; parallel × 3.5 = 1,680,000.00 SYP
        # book: 363,636 + 1,399,417 = 1,763,053; parallel: 40,800,000 + 168,000,000 = 208,800,000
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: TRY, amount: 60000000, book: 1763053, parallel: 208800000 }
        # 60,000.00 / 34.3 = 1,749.2711… → 1,749.27 USD; × 3.5 = 210,000.00 SYP
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: -6000000, book: -174927, parallel: -21000000 }
        # 120,000 of P1's 300,000 at the average: book 909,091 × 0.4 = 363,636.4 → 363,636;
        #   parallel 102,000,000 × 0.4 = 40,800,000
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: -12000000, book: -363636, parallel: -40800000 }
        # 420,000.00 / 34.3 = 12,244.8979… → 12,244.90 USD; × 3.5 = 1,470,000.00 SYP
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: -42000000, book: -1224490, parallel: -147000000 }
        # book: 1,763,053 − 174,927 − 363,636 − 1,224,490 = 0; parallel: 208,800,000 − 21,000,000 − 40,800,000 − 147,000,000 = 0
    - source: manual
      date: 2027-01-07
      lines:
        # book: 420,000.00 / 35 = 12,000.00 USD; parallel: × 3.6 = 1,512,000.00 SYP
        - { account: "111005", currency: TRY, amount: 42000000, book: 1200000, parallel: 151200000 }
        - { account: "313001", currency: TRY, amount: -42000000, book: -1200000, parallel: -151200000 }
    - source: manual
      date: 2027-01-07
      lines:
        # the whole payable at what it carries
        - { account: "211002", dims: { supplier: S2 }, currency: TRY, amount: 42000000, book: 1224490, parallel: 147000000 }
        - { account: "111005", currency: TRY, amount: -42000000, book: -1200000, parallel: -151200000 }
        # book residual: 1,224,490 − 1,200,000 = 24,490 → a credit: realised gain 244.90 USD
        - { account: "421001", currency: USD, amount: -24490, book: -24490, parallel: 0 }
        # parallel residual: 147,000,000 − 151,200,000 = −4,200,000 → a debit: realised loss 42,000.00 SYP
        - { account: "541001", currency: SYP, amount: 4200000, book: 0, parallel: 4200000 }
    - source: manual
      date: 2027-01-31
      lines:
        # period: 1,600,000.00 − 600,000.00 = 1,000,000.00; retention 10% = 100,000.00
        # recovery: 20% = 200,000.00, capped at the 180,000.00 left of the advance
        # net: 1,000,000.00 − 100,000.00 − 180,000.00 = 720,000.00
        # covered 180,000.00 at what is left of the advance, 545,455 and 61,200,000; the other 820,000.00 TRY:
        #   book / 35.84 = 22,879.4642… → 22,879.46 USD; parallel × 3.65 = 2,993,000.00 SYP
        # book: 545,455 + 2,287,946 = 2,833,401; parallel: 61,200,000 + 299,300,000 = 360,500,000
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: TRY, amount: 100000000, book: 2833401, parallel: 360500000 }
        # 100,000.00 / 35.84 = 2,790.1785… → 2,790.18 USD; × 3.65 = 365,000.00 SYP
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: -10000000, book: -279018, parallel: -36500000 }
        # the whole balance at what is left: book 909,091 − 363,636 = 545,455; parallel 102,000,000 − 40,800,000 = 61,200,000
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: -18000000, book: -545455, parallel: -61200000 }
        # 720,000.00 / 35.84 = 20,089.2857… → 20,089.29 USD; × 3.65 = 2,628,000.00 SYP
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: -72000000, book: -2008929, parallel: -262800000 }
        # book residual: 2,833,401 − 279,018 − 545,455 − 2,008,929 = −1 → a debit: realised loss 0.01 USD
        #   (2,287,946 for the 820,000.00 against 279,018 + 2,008,929 = 2,287,947 for its two parts)
        # parallel residual: 360,500,000 − 36,500,000 − 61,200,000 − 262,800,000 = 0 → no line
        - { account: "541001", currency: USD, amount: 1, book: 1, parallel: 0 }
  balances:
    # the cost = the cumulative certified, 1,600,000.00 TRY: book 1,763,053 + 2,833,401 = 4,596,454;
    #   parallel 208,800,000 + 360,500,000 = 569,300,000
    - { account: "511003", dims: { contract: P1 }, currency: TRY, amount: 160000000, book: 4596454, parallel: 569300000 }
    # the advance used up in both ledgers: 120,000 + 180,000 = 300,000.00 TRY
    - { account: "114002", book: 0, parallel: 0 }
    # 60,000 + 100,000 = 160,000.00 TRY = 10% of 1,600,000.00: book 174,927 + 279,018; parallel 21,000,000 + 36,500,000
    - { account: "211006", currency: TRY, amount: -16000000, book: -453945, parallel: -57500000 }
    - { account: "211002", currency: TRY, amount: -72000000, book: -2008929, parallel: -262800000 }
    - { account: "111005", currency: TRY, amount: 0, book: 0, parallel: 0 }
    - { account: "421001", book: -24490, parallel: 0 }
    - { account: "541001", book: 1, parallel: 4200000 }
  open_items:
    - { item: S2, account: "114002", dims: { supplier: S2 }, currency: TRY, amount: 0, book: 0, parallel: 0 }
    - { item: S2, account: "211006", dims: { supplier: S2 }, currency: TRY, amount: -16000000, book: -453945, parallel: -57500000 }
    - { item: S2, account: "211002", dims: { supplier: S2 }, currency: TRY, amount: -72000000, book: -2008929, parallel: -262800000 }
  project_documents:
    - { kind: subcontract_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, supplier: S2, sequence: 1, entry: 3,
        currency: TRY, cumulative: 60000000, previous: 0, retention: 6000000, advance: 12000000 }
    # numbers restart in fiscal year 2027; the number within the subcontract runs on
    - { kind: subcontract_billing, number: 1, date: 2027-01-31, contract: P1, client: C1, supplier: S2, sequence: 2, entry: 6,
        currency: TRY, cumulative: 160000000, previous: 60000000, retention: 10000000, advance: 18000000 }
```

### A USD subcontract: the covered cost at the advance's rate in the parallel ledger

The mirror of S12's progress-billing example. S2's subcontract on P1 is in USD: 100,000.00 USD, retention 10%, recovery 20%. The USD box pays S2 a 20,000.00 USD advance on P1 at the bulletin of 115. Billing 1 certifies 30,000.00 USD at 31 December, when the bulletin is 120: retention 3,000.00, recovery 6,000.00, net 21,000.00. The USD book takes every USD amount as it is. In the SYP parallel ledger the recovery clears 6,000 of the 20,000 advance at its average carrying amount, and the cost's covered 6,000 takes exactly that, 690,000.00 SYP, while the other 24,000 is measured at 120: a cost of 3,570,000.00 SYP, not 3,600,000.00, and no difference line.

```yaml
case: a USD advance of 20,000.00 to S2 at 115; billing 1 of 30,000.00 at 120; the covered cost at 115 in the parallel ledger
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }],
           subcontracts: [{ contract: P1, supplier: S2, currency: USD, value: 10000000,
                            retention_bp: 1000, advance_recovery_bp: 2000 }] }
rates:
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: the owner pays 20,000.00 USD into the USD box
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 2000000 },
                       { account: "313001", currency: USD, amount: -2000000 }] }
  - voucher: an advance of 20,000.00 USD paid to S2 for P1
    accounting_date: 2026-11-02
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "مقاول الباطن" },
               lines: [{ account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 2000000 },
                       { account: "111002", currency: USD, amount: -2000000 }] }
  - project_document: S2's billing 1 on P1
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 3000000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        # parallel: 20,000.00 USD × 115 = 2,300,000.00 SYP
        - { account: "111002", currency: USD, amount: 2000000, book: 2000000, parallel: 230000000 }
        - { account: "313001", currency: USD, amount: -2000000, book: -2000000, parallel: -230000000 }
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 2000000, book: 2000000, parallel: 230000000 }
        - { account: "111002", currency: USD, amount: -2000000, book: -2000000, parallel: -230000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # period: 30,000.00; retention 10% = 3,000.00; recovery 20% = 6,000.00 (≤ 20,000.00); net 21,000.00
        # covered 6,000.00 at the advance's 69,000,000 + the other 24,000.00 × 120 = 288,000,000 → 357,000,000
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: USD, amount: 3000000, book: 3000000, parallel: 357000000 }
        # 3,000.00 × 120 = 360,000.00 SYP
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -300000, book: -300000, parallel: -36000000 }
        # cleared at the average: 230,000,000 × 6,000 / 20,000 = 69,000,000 (690,000.00 SYP)
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -600000, book: -600000, parallel: -69000000 }
        # 21,000.00 × 120 = 2,520,000.00 SYP; the entry balances with no residual: no difference line
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -2100000, book: -2100000, parallel: -252000000 }
  balances:
    - { account: "511003", book: 3000000, parallel: 357000000 }
    # 20,000.00 − 6,000.00 = 14,000.00 USD; 2,300,000.00 − 690,000.00 = 1,610,000.00 SYP
    - { account: "114002", currency: USD, amount: 1400000, book: 1400000, parallel: 161000000 }
    - { account: "111002", currency: USD, amount: 0, book: 0, parallel: 0 }
  open_items:
    - { item: S2, account: "114002", dims: { supplier: S2 }, currency: USD, amount: 1400000, book: 1400000, parallel: 161000000 }
    - { item: S2, account: "211006", dims: { supplier: S2 }, currency: USD, amount: -300000, book: -300000, parallel: -36000000 }
    - { item: S2, account: "211002", dims: { supplier: S2 }, currency: USD, amount: -2100000, book: -2100000, parallel: -252000000 }
  project_documents:
    - { kind: subcontract_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, supplier: S2, sequence: 1, entry: 3,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 600000 }
```

### Refused billings, and the cancellations in order

After the advance of the previous case, a billing of S3 on P1 is refused: S3 has no subcontract on P1 (`PROJECT_TERMS_MISSING`). S2's billing 1 with a recovery typed at 21,000.00, above the 20,000.00 advance, is refused (`RELEASE_EXCEEDS_BALANCE`); it then posts as in the previous case. Billing 2 with a cumulative of 30,000.00 is not above the previous (`BILLING_NOT_INCREASING`), and dated 30 December, before billing 1, it is refused (`VALIDATION_FAILED`). Billing 2 then posts on 31 January with 50,000.00 cumulative; the refusals consumed no number. On 1 February the accountant cancels billing 1, refused while billing 2 stands (`PROJECT_DOCUMENT_NOT_LATEST`); cancelling billing 2, then billing 1, reverses each entry exactly, and the advance is back at 20,000.00 USD and 2,300,000.00 SYP with no difference line (S04 rule 13).

```yaml
case: S3 without a subcontract, a recovery above the advance, billing 2 not increasing and back-dated, all refused; billing 1 cancelled only after billing 2; the advance restored
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }],
           subcontracts: [{ contract: P1, supplier: S2, currency: USD, value: 10000000,
                            retention_bp: 1000, advance_recovery_bp: 2000 }] }
rates:
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-12-30, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2027-01-31, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - voucher: the owner pays 20,000.00 USD into the USD box
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 2000000 },
                       { account: "313001", currency: USD, amount: -2000000 }] }
  - voucher: an advance of 20,000.00 USD paid to S2 for P1
    accounting_date: 2026-11-02
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "مقاول الباطن" },
               lines: [{ account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 2000000 },
                       { account: "111002", currency: USD, amount: -2000000 }] }
  - project_document: a billing of S3 on P1, with no subcontract
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S3, cumulative: 1000000 } }
    outcome: { status: refused, reason: PROJECT_TERMS_MISSING }
  - project_document: S2's billing 1 recovering more than the advance
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 3000000, advance: 2100000 } }
    outcome: { status: refused, reason: RELEASE_EXCEEDS_BALANCE }
  - project_document: S2's billing 1 on P1
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 3000000 } }
  - project_document: billing 2 equal to the previous cumulative
    accounting_date: 2027-01-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 3000000 } }
    outcome: { status: refused, reason: BILLING_NOT_INCREASING }
  - project_document: billing 2 dated before billing 1
    accounting_date: 2026-12-30
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 5000000 } }
    outcome: { status: refused, reason: VALIDATION_FAILED }
  - project_document: S2's billing 2 on P1
    accounting_date: 2027-01-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 5000000 } }
  - reversal: 3
    accounting_date: 2027-02-01
    outcome: { status: refused, reason: PROJECT_DOCUMENT_NOT_LATEST }
  - reversal: 4
    accounting_date: 2027-02-01
  - reversal: 3
    accounting_date: 2027-02-01
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "111002", currency: USD, amount: 2000000, book: 2000000, parallel: 230000000 }
        - { account: "313001", currency: USD, amount: -2000000, book: -2000000, parallel: -230000000 }
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 2000000, book: 2000000, parallel: 230000000 }
        - { account: "111002", currency: USD, amount: -2000000, book: -2000000, parallel: -230000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # as the previous case
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: USD, amount: 3000000, book: 3000000, parallel: 357000000 }
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -300000, book: -300000, parallel: -36000000 }
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -600000, book: -600000, parallel: -69000000 }
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -2100000, book: -2100000, parallel: -252000000 }
    - source: manual
      date: 2027-01-31
      lines:
        # period: 50,000.00 − 30,000.00 = 20,000.00; retention 2,000.00; recovery 4,000.00 (≤ 14,000.00); net 14,000.00
        # covered 4,000.00 at 46,000,000 + the other 16,000.00 × 125 = 200,000,000 → 246,000,000
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: USD, amount: 2000000, book: 2000000, parallel: 246000000 }
        # 2,000.00 × 125 = 250,000.00 SYP
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -200000, book: -200000, parallel: -25000000 }
        # cleared at the average: 161,000,000 × 4,000 / 14,000 = 46,000,000
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -400000, book: -400000, parallel: -46000000 }
        # 14,000.00 × 125 = 1,750,000.00 SYP
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -1400000, book: -1400000, parallel: -175000000 }
    - source: reversal
      date: 2027-02-01
      lines:
        # billing 2 reversed exactly; the advance takes back 4,000.00 at 46,000,000
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: USD, amount: -2000000, book: -2000000, parallel: -246000000 }
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 200000, book: 200000, parallel: 25000000 }
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 400000, book: 400000, parallel: 46000000 }
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 1400000, book: 1400000, parallel: 175000000 }
    - source: reversal
      date: 2027-02-01
      lines:
        # billing 1 reversed exactly; the advance takes back 6,000.00 at 69,000,000
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: USD, amount: -3000000, book: -3000000, parallel: -357000000 }
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 300000, book: 300000, parallel: 36000000 }
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 600000, book: 600000, parallel: 69000000 }
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 2100000, book: 2100000, parallel: 252000000 }
  balances:
    # the advance as paid: 14,000 + 4,000 + 6,000 = 20,000.00 USD; 161,000,000 + 46,000,000 + 69,000,000
    - { account: "114002", currency: USD, amount: 2000000, book: 2000000, parallel: 230000000 }
    - { account: "511003", book: 0, parallel: 0 }
    - { account: "211006", book: 0, parallel: 0 }
    - { account: "211002", book: 0, parallel: 0 }
  open_items:
    - { item: S2, account: "114002", dims: { supplier: S2 }, currency: USD, amount: 2000000, book: 2000000, parallel: 230000000 }
    - { item: S2, account: "211006", dims: { supplier: S2 }, currency: USD, amount: 0, book: 0, parallel: 0 }
    - { item: S2, account: "211002", dims: { supplier: S2 }, currency: USD, amount: 0, book: 0, parallel: 0 }
  project_documents:
    - { kind: subcontract_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, supplier: S2, sequence: 1, entry: 3,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 600000, cancelled_by: 6 }
    # the four refusals consumed no number: billing 2 is the subcontract's second and 2027's first
    - { kind: subcontract_billing, number: 1, date: 2027-01-31, contract: P1, client: C1, supplier: S2, sequence: 2, entry: 4,
        currency: USD, cumulative: 5000000, previous: 3000000, retention: 200000, advance: 400000, cancelled_by: 5 }
```

### One subcontractor's advance for two projects, and a second subcontractor on the first

S2 holds subcontracts on P1 and P2, both in USD with retention 10% and recovery 20%; S3 holds one on P1 in USD with retention 5% and recovery 10%. The USD box pays S2 20,000.00 USD on P1 at the bulletin of 115 and 10,000.00 USD on P2 at 125: one running item for S2 in USD on `114002`, carried at 3,550,000.00 SYP, whose average belongs to neither project. A recovery clears at the average of its own project's lines in the item (S12 rule 12; owner, 2026-11-16), so P1's cost keeps P1's 115 and P2's keeps P2's 125. S2's billing on P1 first tries a recovery of 21,000.00, above P1's 20,000.00 though within the item's 30,000.00: refused (`RELEASE_EXCEEDS_BALANCE`), and it consumes no number. S3 has no advance, so its 10% recovery is capped at zero and its billing carries no line on `114002`; with no carried line, each line is measured on its own. Each billing is the first of its subcontract, so each has the sequence 1, while their numbers run on within the kind.

```yaml
case: S2's advances of 20,000.00 USD on P1 at 115 and 10,000.00 on P2 at 125; each billing at 120 recovers at its project's own average; S3's billing on P1 with no advance
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }, { code: P2, kind: project, client: C1 }],
           subcontracts: [{ contract: P1, supplier: S2, currency: USD, value: 10000000,
                            retention_bp: 1000, advance_recovery_bp: 2000 },
                          { contract: P2, supplier: S2, currency: USD, value: 5000000,
                            retention_bp: 1000, advance_recovery_bp: 2000 },
                          { contract: P1, supplier: S3, currency: USD, value: 2000000,
                            retention_bp: 500, advance_recovery_bp: 1000 }] }
rates:
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-11-16, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: the owner pays 20,000.00 USD into the USD box
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 2000000 },
                       { account: "313001", currency: USD, amount: -2000000 }] }
  - voucher: an advance of 20,000.00 USD paid to S2 for P1
    accounting_date: 2026-11-02
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "مقاول الباطن" },
               lines: [{ account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 2000000 },
                       { account: "111002", currency: USD, amount: -2000000 }] }
  - voucher: the owner pays 10,000.00 USD into the USD box
    accounting_date: 2026-11-16
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 1000000 },
                       { account: "313001", currency: USD, amount: -1000000 }] }
  - voucher: an advance of 10,000.00 USD paid to S2 for P2
    accounting_date: 2026-11-16
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "مقاول الباطن" },
               lines: [{ account: "114002", dims: { supplier: S2, contract: P2 }, currency: USD, amount: 1000000 },
                       { account: "111002", currency: USD, amount: -1000000 }] }
  - project_document: S2's billing 1 on P1 recovering more than P1's advance
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 3000000, advance: 2100000 } }
    outcome: { status: refused, reason: RELEASE_EXCEEDS_BALANCE }
  - project_document: S2's billing 1 on P1
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 3000000 } }
  - project_document: S2's billing 1 on P2
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P2, supplier: S2, cumulative: 2000000 } }
  - project_document: S3's billing 1 on P1, with no advance
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S3, cumulative: 800000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        # 20,000.00 × 115 = 2,300,000.00 SYP
        - { account: "111002", currency: USD, amount: 2000000, book: 2000000, parallel: 230000000 }
        - { account: "313001", currency: USD, amount: -2000000, book: -2000000, parallel: -230000000 }
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 2000000, book: 2000000, parallel: 230000000 }
        - { account: "111002", currency: USD, amount: -2000000, book: -2000000, parallel: -230000000 }
    - source: manual
      date: 2026-11-16
      lines:
        # 10,000.00 × 125 = 1,250,000.00 SYP
        - { account: "111002", currency: USD, amount: 1000000, book: 1000000, parallel: 125000000 }
        - { account: "313001", currency: USD, amount: -1000000, book: -1000000, parallel: -125000000 }
    - source: manual
      date: 2026-11-16
      lines:
        - { account: "114002", dims: { supplier: S2, contract: P2 }, currency: USD, amount: 1000000, book: 1000000, parallel: 125000000 }
        - { account: "111002", currency: USD, amount: -1000000, book: -1000000, parallel: -125000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # S2 on P1 as the second case: net 21,000.00, retention 3,000.00, recovery 6,000.00
        # 69,000,000 + 24,000.00 × 120 = 357,000,000
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: USD, amount: 3000000, book: 3000000, parallel: 357000000 }
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -300000, book: -300000, parallel: -36000000 }
        # P1's share: 20,000.00 at 230,000,000 → 230,000,000 × 6,000 / 20,000 = 69,000,000
        #   (the item's average would give 355,000,000 × 6,000 / 30,000 = 71,000,000)
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -600000, book: -600000, parallel: -69000000 }
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -2100000, book: -2100000, parallel: -252000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # S2 on P2: period 20,000.00; retention 2,000.00; recovery 4,000.00 (≤ P2's 10,000.00); net 14,000.00
        # 50,000,000 + 16,000.00 × 120 = 192,000,000 → 242,000,000
        - { account: "511003", dims: { contract: P2, supplier: S2 }, currency: USD, amount: 2000000, book: 2000000, parallel: 242000000 }
        # 2,000.00 × 120 = 240,000.00 SYP
        - { account: "211006", dims: { supplier: S2, contract: P2 }, currency: USD, amount: -200000, book: -200000, parallel: -24000000 }
        # P2's share: 10,000.00 at 125,000,000 → 125,000,000 × 4,000 / 10,000 = 50,000,000
        - { account: "114002", dims: { supplier: S2, contract: P2 }, currency: USD, amount: -400000, book: -400000, parallel: -50000000 }
        # 14,000.00 × 120 = 1,680,000.00 SYP
        - { account: "211002", dims: { supplier: S2, contract: P2 }, currency: USD, amount: -1400000, book: -1400000, parallel: -168000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # S3 on P1: period 8,000.00; retention 5% = 400.00; recovery 10% = 800.00 capped at S3's advance of 0.00
        # net: 8,000.00 − 400.00 = 7,600.00; every line × 120, no carried line, no residual
        - { account: "511003", dims: { contract: P1, supplier: S3 }, currency: USD, amount: 800000, book: 800000, parallel: 96000000 }
        - { account: "211006", dims: { supplier: S3, contract: P1 }, currency: USD, amount: -40000, book: -40000, parallel: -4800000 }
        - { account: "211002", dims: { supplier: S3, contract: P1 }, currency: USD, amount: -760000, book: -760000, parallel: -91200000 }
  balances:
    # what is left of each project's share: P1 14,000.00 at 1,610,000.00 SYP; P2 6,000.00 at 750,000.00 SYP
    - { account: "114002", dims: { contract: P1 }, book: 1400000, parallel: 161000000 }
    - { account: "114002", dims: { contract: P2 }, book: 600000, parallel: 75000000 }
    # P1's cost: S2's 357,000,000 + S3's 96,000,000 = 453,000,000
    - { account: "511003", dims: { contract: P1 }, book: 3800000, parallel: 453000000 }
    - { account: "511003", dims: { contract: P2 }, book: 2000000, parallel: 242000000 }
  open_items:
    # one running item for S2 in USD: 20,000.00 left, 161,000,000 + 75,000,000 = 236,000,000
    - { item: S2, account: "114002", dims: { supplier: S2 }, currency: USD, amount: 2000000, book: 2000000, parallel: 236000000 }
    # S2's retentions on both projects: 3,000 + 2,000 = 5,000.00 USD; 36,000,000 + 24,000,000
    - { item: S2, account: "211006", dims: { supplier: S2 }, currency: USD, amount: -500000, book: -500000, parallel: -60000000 }
    - { item: S2, account: "211002", dims: { supplier: S2 }, currency: USD, amount: -3500000, book: -3500000, parallel: -420000000 }
    - { item: S3, account: "211006", dims: { supplier: S3 }, currency: USD, amount: -40000, book: -40000, parallel: -4800000 }
    - { item: S3, account: "211002", dims: { supplier: S3 }, currency: USD, amount: -760000, book: -760000, parallel: -91200000 }
  project_documents:
    # the refusal consumed no number; numbers run per kind and year, sequences per subcontract
    - { kind: subcontract_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, supplier: S2, sequence: 1, entry: 5,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 600000 }
    - { kind: subcontract_billing, number: 2, date: 2026-12-31, contract: P2, client: C1, supplier: S2, sequence: 1, entry: 6,
        currency: USD, cumulative: 2000000, previous: 0, retention: 200000, advance: 400000 }
    - { kind: subcontract_billing, number: 3, date: 2026-12-31, contract: P1, client: C1, supplier: S3, sequence: 1, entry: 7,
        currency: USD, cumulative: 800000, previous: 0, retention: 40000, advance: 0 }
```

### An advance held only in another currency

S2's subcontract on P1 is in USD, but the advance S2 holds for P1 was paid in TRY: 30,000.00 TRY on 2 November, at 33.0000 and 3.4000. A recovery is applied only in the advance's own currency (S12 answer 6). Billing 1 with a recovery typed at 6,000.00 USD is refused (`ADVANCE_CURRENCY_MISMATCH`). Posted without a typed recovery, its computed 20% is capped at S2's USD advance for P1, which is zero: the billing carries no line on `114002`, every line is a new measurement at the day's bulletin, and the TRY advance is untouched.

```yaml
case: a USD subcontract and a 30,000.00 TRY advance; a typed recovery refused; the computed recovery capped at zero
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }],
           subcontracts: [{ contract: P1, supplier: S2, currency: USD, value: 10000000,
                            retention_bp: 1000, advance_recovery_bp: 2000 }] }
rates:
  - { date: 2026-11-02, base: TRY, quote: SYP, rate: "3.4000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: TRY, rate: "33.0000", type: market }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: the owner pays 30,000.00 TRY into the TRY box
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 3000000 },
                       { account: "313001", currency: TRY, amount: -3000000 }] }
  - voucher: an advance of 30,000.00 TRY paid to S2 for P1
    accounting_date: 2026-11-02
    payload: { voucher: { kind: payment, cash_account: "111005", party_name: "مقاول الباطن" },
               lines: [{ account: "114002", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: 3000000 },
                       { account: "111005", currency: TRY, amount: -3000000 }] }
  - project_document: S2's USD billing 1 recovering 6,000.00 USD from a TRY advance
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 3000000, advance: 600000 } }
    outcome: { status: refused, reason: ADVANCE_CURRENCY_MISMATCH }
  - project_document: S2's billing 1 on P1
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 3000000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        # book: 30,000.00 TRY / 33 = 909.0909… → 909.09 USD; parallel: × 3.4 = 102,000.00 SYP
        - { account: "111005", currency: TRY, amount: 3000000, book: 90909, parallel: 10200000 }
        - { account: "313001", currency: TRY, amount: -3000000, book: -90909, parallel: -10200000 }
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: 3000000, book: 90909, parallel: 10200000 }
        - { account: "111005", currency: TRY, amount: -3000000, book: -90909, parallel: -10200000 }
    - source: manual
      date: 2026-12-31
      lines:
        # period: 30,000.00; retention 3,000.00; recovery: 20% = 6,000.00 capped at S2's USD advance of 0.00
        # net: 27,000.00; every line × 120, no carried line, no residual
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: USD, amount: 3000000, book: 3000000, parallel: 360000000 }
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -300000, book: -300000, parallel: -36000000 }
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -2700000, book: -2700000, parallel: -324000000 }
  balances:
    # the TRY advance as paid
    - { account: "114002", currency: TRY, amount: 3000000, book: 90909, parallel: 10200000 }
  open_items:
    - { item: S2, account: "114002", dims: { supplier: S2 }, currency: TRY, amount: 3000000, book: 90909, parallel: 10200000 }
    - { item: S2, account: "211002", dims: { supplier: S2 }, currency: USD, amount: -2700000, book: -2700000, parallel: -324000000 }
  project_documents:
    - { kind: subcontract_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, supplier: S2, sequence: 1, entry: 3,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 0 }
```

### The USD subcontract in SYP books

The second case in a company with SYP books at the bulletin and no parallel ledger. The book now moves with the USD: the covered cost keeps the advance's 115, the rest is measured at 120, and no difference line arises.

```yaml
case: syp; a USD advance of 20,000.00 at 115; billing 1 of 30,000.00 at 120; the covered cost at 115 in the book
company: { shape: syp, book: SYP, template: contracting,
           rate_policy: { book: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }],
           subcontracts: [{ contract: P1, supplier: S2, currency: USD, value: 10000000,
                            retention_bp: 1000, advance_recovery_bp: 2000 }] }
rates:
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: the owner pays 20,000.00 USD into the USD box
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 2000000 },
                       { account: "313001", currency: USD, amount: -2000000 }] }
  - voucher: an advance of 20,000.00 USD paid to S2 for P1
    accounting_date: 2026-11-02
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "مقاول الباطن" },
               lines: [{ account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 2000000 },
                       { account: "111002", currency: USD, amount: -2000000 }] }
  - project_document: S2's billing 1 on P1
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 3000000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        # 20,000.00 USD × 115 = 2,300,000.00 SYP
        - { account: "111002", currency: USD, amount: 2000000, book: 230000000 }
        - { account: "313001", currency: USD, amount: -2000000, book: -230000000 }
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 2000000, book: 230000000 }
        - { account: "111002", currency: USD, amount: -2000000, book: -230000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # 69,000,000 + 24,000.00 × 120 = 357,000,000; no residual
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: USD, amount: 3000000, book: 357000000 }
        # retention 3,000.00 × 120 = 360,000.00 SYP
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -300000, book: -36000000 }
        # 230,000,000 × 6,000 / 20,000 = 69,000,000
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -600000, book: -69000000 }
        # net 21,000.00 × 120 = 2,520,000.00 SYP
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -2100000, book: -252000000 }
  balances:
    - { account: "114002", currency: USD, amount: 1400000, book: 161000000 }
    - { account: "511003", book: 357000000 }
  open_items:
    - { item: S2, account: "114002", dims: { supplier: S2 }, currency: USD, amount: 1400000, book: 161000000 }
    - { item: S2, account: "211006", dims: { supplier: S2 }, currency: USD, amount: -300000, book: -36000000 }
    - { item: S2, account: "211002", dims: { supplier: S2 }, currency: USD, amount: -2100000, book: -252000000 }
  project_documents:
    - { kind: subcontract_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, supplier: S2, sequence: 1, entry: 3,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 600000 }
```

### The USD subcontract in SYP books with a USD parallel ledger

The previous case with a USD parallel ledger at `market`, as Vertex Media's ledgers. The parallel ledger takes every USD amount as it is, so the advance has no effect there.

```yaml
case: syp-usd; a USD advance of 20,000.00 at 115; billing 1 of 30,000.00 at 120; the covered cost at 115 in the book, USD as is in the parallel
company: { shape: syp-usd, book: SYP, parallel: USD, template: contracting,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }],
           subcontracts: [{ contract: P1, supplier: S2, currency: USD, value: 10000000,
                            retention_bp: 1000, advance_recovery_bp: 2000 }] }
rates:
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: the owner pays 20,000.00 USD into the USD box
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 2000000 },
                       { account: "313001", currency: USD, amount: -2000000 }] }
  - voucher: an advance of 20,000.00 USD paid to S2 for P1
    accounting_date: 2026-11-02
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "مقاول الباطن" },
               lines: [{ account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 2000000 },
                       { account: "111002", currency: USD, amount: -2000000 }] }
  - project_document: S2's billing 1 on P1
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 3000000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "111002", currency: USD, amount: 2000000, book: 230000000, parallel: 2000000 }
        - { account: "313001", currency: USD, amount: -2000000, book: -230000000, parallel: -2000000 }
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 2000000, book: 230000000, parallel: 2000000 }
        - { account: "111002", currency: USD, amount: -2000000, book: -230000000, parallel: -2000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # book as the SYP case; parallel: the USD amounts as they are
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: USD, amount: 3000000, book: 357000000, parallel: 3000000 }
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -300000, book: -36000000, parallel: -300000 }
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -600000, book: -69000000, parallel: -600000 }
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -2100000, book: -252000000, parallel: -2100000 }
  balances:
    - { account: "114002", currency: USD, amount: 1400000, book: 161000000, parallel: 1400000 }
    - { account: "511003", book: 357000000, parallel: 3000000 }
  open_items:
    - { item: S2, account: "114002", dims: { supplier: S2 }, currency: USD, amount: 1400000, book: 161000000, parallel: 1400000 }
    - { item: S2, account: "211006", dims: { supplier: S2 }, currency: USD, amount: -300000, book: -36000000, parallel: -300000 }
    - { item: S2, account: "211002", dims: { supplier: S2 }, currency: USD, amount: -2100000, book: -252000000, parallel: -2100000 }
  project_documents:
    - { kind: subcontract_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, supplier: S2, sequence: 1, entry: 3,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 600000 }
```

### The TRY subcontract in SYP books with a USD parallel ledger

The first case's advance and billing 1 in Vertex Media's ledgers: SYP books at the bulletin and a USD parallel ledger at `market` (shape `third`, since TRY is a third currency). The two ledgers trade places, with the same figures: the covered cost keeps the advance's carrying amounts in both, and nothing is left over.

```yaml
case: third; a 300,000.00 TRY advance at 3.4 and 33; billing 1 of 600,000.00 TRY at 3.5 and 34.3; the covered cost at the advance's amounts in both ledgers
company: { shape: third, book: SYP, parallel: USD, template: contracting,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }],
           subcontracts: [{ contract: P1, supplier: S2, currency: TRY, value: 150000000,
                            retention_bp: 1000, advance_recovery_bp: 2000 }] }
rates:
  - { date: 2026-11-02, base: TRY, quote: SYP, rate: "3.4000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: TRY, rate: "33.0000", type: market }
  - { date: 2026-12-31, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: TRY, rate: "34.3000", type: market }
steps:
  - voucher: the owner pays 300,000.00 TRY into the TRY box
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 30000000 },
                       { account: "313001", currency: TRY, amount: -30000000 }] }
  - voucher: an advance of 300,000.00 TRY paid to S2 for P1
    accounting_date: 2026-11-02
    payload: { voucher: { kind: payment, cash_account: "111005", party_name: "مقاول الباطن" },
               lines: [{ account: "114002", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: 30000000 },
                       { account: "111005", currency: TRY, amount: -30000000 }] }
  - project_document: S2's billing 1 on P1
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 60000000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        # book: 300,000.00 TRY × 3.4 = 1,020,000.00 SYP; parallel: / 33 = 9,090.91 USD
        - { account: "111005", currency: TRY, amount: 30000000, book: 102000000, parallel: 909091 }
        - { account: "313001", currency: TRY, amount: -30000000, book: -102000000, parallel: -909091 }
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: 30000000, book: 102000000, parallel: 909091 }
        - { account: "111005", currency: TRY, amount: -30000000, book: -102000000, parallel: -909091 }
    - source: manual
      date: 2026-12-31
      lines:
        # book: 40,800,000 + 480,000.00 × 3.5 (168,000,000) = 208,800,000;
        #   parallel: 363,636 + 480,000.00 / 34.3 (1,399,417) = 1,763,053
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: TRY, amount: 60000000, book: 208800000, parallel: 1763053 }
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: -6000000, book: -21000000, parallel: -174927 }
        # 120,000 of 300,000 at the average: book 102,000,000 × 0.4 = 40,800,000; parallel 909,091 × 0.4 = 363,636.4 → 363,636
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: -12000000, book: -40800000, parallel: -363636 }
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: TRY, amount: -42000000, book: -147000000, parallel: -1224490 }
  balances:
    # 180,000.00 TRY left: book 102,000,000 − 40,800,000 = 61,200,000; parallel 909,091 − 363,636 = 545,455
    - { account: "114002", currency: TRY, amount: 18000000, book: 61200000, parallel: 545455 }
    - { account: "511003", book: 208800000, parallel: 1763053 }
  open_items:
    - { item: S2, account: "114002", dims: { supplier: S2 }, currency: TRY, amount: 18000000, book: 61200000, parallel: 545455 }
    - { item: S2, account: "211006", dims: { supplier: S2 }, currency: TRY, amount: -6000000, book: -21000000, parallel: -174927 }
    - { item: S2, account: "211002", dims: { supplier: S2 }, currency: TRY, amount: -42000000, book: -147000000, parallel: -1224490 }
  project_documents:
    - { kind: subcontract_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, supplier: S2, sequence: 1, entry: 3,
        currency: TRY, cumulative: 60000000, previous: 0, retention: 6000000, advance: 12000000 }
```
