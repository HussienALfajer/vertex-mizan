# A project purchase invoice

Status: Approved (owner, 2026-11-16)

The expected entries of the eight cases were approved by the owner on 2026-11-16, with three readings of S12 rule 12 and its edge case 4: an advance's carried amounts are allocated across the covered lines in proportion to their covered amounts; `ADVANCE_CURRENCY_MISMATCH` refuses an advance applied while the supplier's advance for the project is held only in another currency (none at all, or too little, is `RELEASE_EXCEEDS_BALANCE`); and the supplier's credit on `211001` carries the project. S12's first PR brought the `project_document` executor, the materials setup and the project documents' and quantities' readers and switched them to `Approved` with no expected value changed.

## Rule

A project purchase invoice (فاتورة مشتريات المشروع) is a numbered project document: the project, the supplier, its date, an optional supplier's reference, and one or more cost lines in the document's currency, each on a postable expense account carrying the project. A line on an account that requires a material (`511001` in `contracting@1`) names a material and a quantity (`MATERIAL_REQUIRED` otherwise). Its amount is the quantity times the unit price rounded half away from zero to the currency's minor unit (`lineAmount()`), never typed, and a line that comes to zero is refused (`VALIDATION_FAILED`). A quantity of 0 on a material is a price adjustment whose amount the accountant types. The invoice posts each cost line as a debit and one credit on `211001`, the supplier's running item, for the total less any advance applied: a new measurement, or, against a debit balance, a clearing at its average carrying amount with the residual realised. An applied advance is a clearing line on `114002` in the document's currency (`ADVANCE_CURRENCY_MISMATCH` when the supplier's advance for the project is held in another currency). It is at most the advance carried for this project (`RELEASE_EXCEEDS_BALANCE`) and clears at the average carrying amount of the project's share. The part of each cost line it covers takes exactly the carried amounts, allocated across the covered lines, so the advance leaves no exchange difference. A cash purchase is a payment voucher whose cost lines carry their quantities. Cancelling the invoice reverses its entry, quantities included, and puts the advance back at exactly what it cleared.

## Basis

- **IAS 1.102:** a project's costs are expenses by nature under `is.direct_costs`, each carrying its contract; materials go straight to the project, with no store (S12 answer 1, Q19).
- **IAS 21.21–22:** each cost line and the supplier's credit are recorded at the spot rate of the invoice date (the ledger's policy rate); **IAS 21.23(a) and 21.28:** the supplier's balance is monetary, so clearing a debit balance at its carrying amount realises an exchange difference.
- **IFRIC 22.8–9 and IAS 21.23(b):** an advance paid to a supplier is non-monetary; the cost it pays for is measured, for the part it covers, at the rate of the advance's payment, so its application leaves no exchange difference and the advance is never revalued.
- **Company policy:** S12 rules 3–9, 12, 13, 21 and 22, its "Accounting treatment" and its "Currencies, rates and rounding" (owner, 2026-11-16; ADR 0023); the application of advances at their carrying amount (owner, 2026-11-14), at the average of the project's own share (owner, 2026-11-16); advances applied only in their own currency (S12 answer 6); quantities with up to 3 decimals and unit prices with up to 4, each line rounded once (S12 answer 12); S04 rules 3, 4, 10 and 13 (running items, clearing at the average, residuals, reopening by reversal); S11 rules 8 and 11 (payment vouchers, the box never below zero); S03 rule 9 (the accountant's reversal); ADR 0007 (cumulative rounding of allocations); the client's currencies, a USD book at `market` accepting dealt rates and an SYP parallel ledger at the bulletin (S11, ADR 0021).
- **Syrian rules:** the bulletin for the parallel ledger, UNVERIFIED (Q1), adopted by the owner as the company's policy; a daily TRY/SYP bulletin, UNVERIFIED (Q10), assumed by the owner (S11); Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The company is the contracting client's shape unless a case says otherwise: `usd-syp`, the USD book at `market` accepting dealt rates, the SYP parallel ledger at the bulletin, TRY as a third currency, and the chart `contracting@1` (S11 "Templates"), in which S12 marks `511001` as requiring a material:
- the TRY box `111005`;
- advances to suppliers `114002`, a running control account for suppliers, non-monetary, with supplier and contract required;
- suppliers `211001`, a running control account for suppliers, monetary, with the supplier required;
- the owner's current account `313001`;
- materials `511001`, site transport and fuel `511005` and other site costs `511006`, each requiring the contract;
- realised exchange gains `421001` and losses `541001`.

Project P1 belongs to client C1; S1 is a supplier. The materials catalogue holds `CEM` (أسمنت بورتلاندي, طن), `STL` (حديد تسليح, طن) and `SND` (رمل, م³). Every rate and amount is synthetic. Monday 2 November, Thursday 3 and Thursday 10 December 2026 are publication days.

A `project_document` step for a purchase is the document as the form sends it (S12 "Drafts"):
- `document`: `kind: purchase`, the `contract`, the `supplier`, the `currency`, an optional `supplier_reference`, and the advance applied (`advance`) when there is one.
- `lines`: each with its `account` and either a `material` with its `quantity` and `unit_price`, or a typed `amount`: a price adjustment (a material with the quantity `"0.000"`) or a line on an account that needs no material. A line may give its covered part of the advance (`advance`); otherwise the advance is allocated across the lines in proportion to their amounts (S12 rule 12).
- The lines take the document's currency and project. Quantities and unit prices are quoted decimals with 3 and 4 places, as typed.

The step is saved as a draft and posted from it; its entry has the source `manual`. `project_documents` states the exact set of the company's project documents. For a purchase: kind, number in its kind and fiscal year, date, project and its client, the supplier, the entry it posted and the reversal that cancelled it (posting order), currency, and the supplier's reference (`reference`). `quantities` states the exact set of line quantities: the entry, the line by account, currency and amount, the material, the unit, the quantity, and the unit price (none on a price adjustment).

The advance's carried amounts are allocated across the lines it covers in proportion to each line's covered amount, with cumulative rounding in each ledger separately (ADR 0007). The covered amounts then sum exactly to the clearing line in every ledger, and a covered line's book and parallel amounts are its carried part plus its rest converted at the day's rate. A difference line carries its amount in one ledger only, in that ledger's currency (ADR 0007).

The cases leave out what other scenarios own:
- the payment of the supplier's balance (`cash/receipt-and-payment.md`);
- an advance a supplier holds for two projects (the same project-share rule as a client's, `projects/progress-billing.md`);
- the subcontractor's billing (`projects/subcontract-billing.md`);
- the month-end revaluation of `211001` (`currency/month-end-revaluation.md`);
- an invoice dated in a closed period, refused as any posting there (`periods/close-and-reopen.md`);
- the project report and the material quantities report (`reports/project-report.md`).

### S12's example: a TRY purchase with quantities

Supplier S1 invoices cement and reinforcing steel for P1 on 3 December, at the market 34.0000 TRY per USD and the bulletin 3.5000 SYP per TRY. Each line is its quantity times its unit price. The credit is a new running item for S1. Every amount is a new measurement, and the entry balances in both ledgers with nothing left over.

```yaml
case: S12's example; 12.500 t of cement and 2.000 t of steel for 86,975.00 TRY at 34 and 3.5
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }],
           materials: [{ code: CEM, name: "أسمنت بورتلاندي", unit: "طن" },
                       { code: STL, name: "حديد تسليح", unit: "طن" }] }
rates:
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - project_document: S1's invoice F-1024 for P1
    accounting_date: 2026-12-03
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: TRY, supplier_reference: "F-1024" },
               lines: [{ account: "511001", material: CEM, quantity: "12.500", unit_price: "3150.0000" },
                       { account: "511001", material: STL, quantity: "2.000", unit_price: "23800.0000" }] }
expect:
  entries:
    - source: manual
      date: 2026-12-03
      lines:
        # 12.500 × 3,150.0000 = 39,375.00 TRY; book: / 34 = 1,158.0882… → 1,158.09 USD; parallel: × 3.5 = 137,812.50 SYP
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 3937500, book: 115809, parallel: 13781250 }
        # 2.000 × 23,800.0000 = 47,600.00 TRY; book: / 34 = 1,400.00 USD; parallel: × 3.5 = 166,600.00 SYP
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 4760000, book: 140000, parallel: 16660000 }
        # the total 86,975.00 TRY, a new running item for S1: / 34 = 2,558.0882… → 2,558.09 USD; × 3.5 = 304,412.50 SYP
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: -8697500, book: -255809, parallel: -30441250 }
  balances:
    - { account: "511001", dims: { contract: P1 }, book: 255809, parallel: 30441250 }
  open_items:
    - { item: S1, account: "211001", dims: { supplier: S1 }, currency: TRY, amount: -8697500, book: -255809, parallel: -30441250 }
  project_documents:
    - { kind: purchase, number: 1, date: 2026-12-03, contract: P1, client: C1, supplier: S1, entry: 1,
        currency: TRY, reference: "F-1024" }
  quantities:
    - { entry: 1, account: "511001", currency: TRY, amount: 3937500, material: CEM, unit: "طن", quantity: "12.500", unit_price: "3150.0000" }
    - { entry: 1, account: "511001", currency: TRY, amount: 4760000, material: STL, unit: "طن", quantity: "2.000", unit_price: "23800.0000" }
```

### Line amounts rounded half away from zero, a return and a price adjustment

Supplier S1 invoices P1 in USD on 10 December, at the bulletin 120.0000:
- 12.500 m³ of sand at 3.0300 USD, which is 37.875 and rounds half away from zero to 37.88;
- 2.500 m³ of it taken back on delivery, a credit and a quantity out (S12 rule 5): −7.575 rounds away from zero to −7.58;
- 20.000 t of cement at 92.5000 USD;
- a discount of 50.00 USD on the cement, a price adjustment with the quantity 0.000 and no unit price (rule 6);
- 120.00 USD of site transport on `511005`, which needs no material.

The total is the sum of the rounded lines. The USD book takes every amount as it is, and the parallel ledger converts each at 120, exactly.

```yaml
case: a USD purchase on 10 December at 120; sand 12.500 at 3.0300 and 2.500 returned; cement 20.000 at 92.50 less a 50.00 discount; transport
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }],
           materials: [{ code: CEM, name: "أسمنت بورتلاندي", unit: "طن" },
                       { code: SND, name: "رمل", unit: "م³" }] }
rates:
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - project_document: S1's invoice F-1077 for P1, with a return and a discount
    accounting_date: 2026-12-10
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: USD, supplier_reference: "F-1077" },
               lines: [{ account: "511001", material: SND, quantity: "12.500", unit_price: "3.0300" },
                       { account: "511001", material: SND, quantity: "-2.500", unit_price: "3.0300" },
                       { account: "511001", material: CEM, quantity: "20.000", unit_price: "92.5000" },
                       { account: "511001", material: CEM, quantity: "0.000", amount: -5000 },
                       { account: "511005", amount: 12000 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-10
      lines:
        # 12.500 × 3.0300 = 37.875 → 37.88 USD (half away from zero); parallel: × 120 = 4,545.60 SYP
        - { account: "511001", dims: { contract: P1 }, currency: USD, amount: 3788, book: 3788, parallel: 454560 }
        # −2.500 × 3.0300 = −7.575 → −7.58 USD (away from zero); × 120 = −909.60 SYP
        - { account: "511001", dims: { contract: P1 }, currency: USD, amount: -758, book: -758, parallel: -90960 }
        # 20.000 × 92.5000 = 1,850.00 USD; × 120 = 222,000.00 SYP
        - { account: "511001", dims: { contract: P1 }, currency: USD, amount: 185000, book: 185000, parallel: 22200000 }
        # the discount typed: −50.00 USD; × 120 = −6,000.00 SYP
        - { account: "511001", dims: { contract: P1 }, currency: USD, amount: -5000, book: -5000, parallel: -600000 }
        # 120.00 USD; × 120 = 14,400.00 SYP
        - { account: "511005", dims: { contract: P1 }, currency: USD, amount: 12000, book: 12000, parallel: 1440000 }
        # the total of the lines: 37.88 − 7.58 + 1,850.00 − 50.00 + 120.00 = 1,950.30 USD; × 120 = 234,036.00 SYP
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: USD, amount: -195030, book: -195030, parallel: -23403600 }
  balances:
    # materials: 37.88 − 7.58 + 1,850.00 − 50.00 = 1,830.30 USD
    - { account: "511001", dims: { contract: P1 }, book: 183030, parallel: 21963600 }
    - { account: "511005", dims: { contract: P1 }, book: 12000, parallel: 1440000 }
  open_items:
    - { item: S1, account: "211001", dims: { supplier: S1 }, currency: USD, amount: -195030, book: -195030, parallel: -23403600 }
  project_documents:
    - { kind: purchase, number: 1, date: 2026-12-10, contract: P1, client: C1, supplier: S1, entry: 1,
        currency: USD, reference: "F-1077" }
  quantities:
    # net: 10.000 m³ of sand for 30.30 USD; 20.000 t of cement for 1,800.00 USD with its discount
    - { entry: 1, account: "511001", currency: USD, amount: 3788, material: SND, unit: "م³", quantity: "12.500", unit_price: "3.0300" }
    - { entry: 1, account: "511001", currency: USD, amount: -758, material: SND, unit: "م³", quantity: "-2.500", unit_price: "3.0300" }
    - { entry: 1, account: "511001", currency: USD, amount: 185000, material: CEM, unit: "طن", quantity: "20.000", unit_price: "92.5000" }
    - { entry: 1, account: "511001", currency: USD, amount: -5000, material: CEM, unit: "طن", quantity: "0.000" }
```

### A TRY advance applied: the covered cost at the advance's carrying amounts

On 2 November the owner puts 30,000.00 TRY into the TRY box, and the box pays it to S1 as an advance on P1 (`114002`). The market is 33.0000 TRY per USD and the bulletin 3.4000 SYP per TRY, so the advance is carried at 909.09 USD and 102,000.00 SYP. On 3 December S1 invoices the example's cement and steel, and the accountant applies 15,000.00 TRY of the advance.

The application clears half of P1's share at its average carrying amount. The default allocation spreads the 15,000.00 TRY over the two lines in proportion to their amounts (S12 rule 12), with cumulative rounding, and the carried amounts follow the covered amounts in each ledger. Each line's covered part keeps November's rates, and its rest is measured at December's. The supplier is credited with the total less the advance. The entry balances in both ledgers with no difference line: the advance leaves none (IFRIC 22.8), and here the new measurements' rounding leaves none either.

```yaml
case: a 30,000.00 TRY advance at 33 and 3.4; S12's purchase at 34 and 3.5 applying 15,000.00 of it, allocated across both lines; no difference
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }],
           materials: [{ code: CEM, name: "أسمنت بورتلاندي", unit: "طن" },
                       { code: STL, name: "حديد تسليح", unit: "طن" }] }
rates:
  - { date: 2026-11-02, base: TRY, quote: SYP, rate: "3.4000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: TRY, rate: "33.0000", type: market }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - voucher: the owner pays 30,000.00 TRY into the TRY box
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 3000000 },
                       { account: "313001", currency: TRY, amount: -3000000 }] }
  - voucher: an advance of 30,000.00 TRY paid to S1 for P1
    accounting_date: 2026-11-02
    payload: { voucher: { kind: payment, cash_account: "111005", party_name: "المورّد" },
               lines: [{ account: "114002", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: 3000000 },
                       { account: "111005", currency: TRY, amount: -3000000 }] }
  - project_document: S1's invoice F-1024 for P1, applying 15,000.00 TRY of the advance
    accounting_date: 2026-12-03
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: TRY, supplier_reference: "F-1024",
                           advance: 1500000 },
               lines: [{ account: "511001", material: CEM, quantity: "12.500", unit_price: "3150.0000" },
                       { account: "511001", material: STL, quantity: "2.000", unit_price: "23800.0000" }] }
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
        # a new running item for S1 in TRY, all of it P1's
        - { account: "114002", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: 3000000, book: 90909, parallel: 10200000 }
        - { account: "111005", currency: TRY, amount: -3000000, book: -90909, parallel: -10200000 }
    - source: manual
      date: 2026-12-03
      lines:
        # covered, by default in proportion to the lines (cumulative rounding):
        #   cement 1,500,000 × 3,937,500 / 8,697,500 = 679,074.45… → 679,074 (6,790.74 TRY); steel 1,500,000 − 679,074 = 820,926
        # the advance's carried amounts, in proportion to the covered amounts:
        #   book: 45,455 × 679,074 / 1,500,000 = 20,578.2… → 20,578; steel 45,455 − 20,578 = 24,877
        #   parallel: 5,100,000 × 679,074 / 1,500,000 = 2,308,851.6 → 2,308,852; steel 5,100,000 − 2,308,852 = 2,791,148
        # cement: the rest 3,937,500 − 679,074 = 3,258,426 TRY minor
        #   book: 20,578 + 3,258,426 / 34 (95,836.06… → 95,836) = 116,414
        #   parallel: 2,308,852 + 3,258,426 × 3.5 (11,404,491) = 13,713,343
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 3937500, book: 116414, parallel: 13713343 }
        # steel: the rest 4,760,000 − 820,926 = 3,939,074
        #   book: 24,877 + 3,939,074 / 34 (115,855.11… → 115,855) = 140,732
        #   parallel: 2,791,148 + 3,939,074 × 3.5 (13,786,759) = 16,577,907
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 4760000, book: 140732, parallel: 16577907 }
        # 15,000 of P1's 30,000 cleared at the average: book 90,909 × 1/2 = 45,454.5 → 45,455; parallel 10,200,000 × 1/2 = 5,100,000
        - { account: "114002", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: -1500000, book: -45455, parallel: -5100000 }
        # the total less the advance: 86,975.00 − 15,000.00 = 71,975.00 TRY, new
        #   book: / 34 = 2,116.9117… → 2,116.91 USD; parallel: × 3.5 = 251,912.50 SYP
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: -7197500, book: -211691, parallel: -25191250 }
        # book: 116,414 + 140,732 − 45,455 − 211,691 = 0; parallel: 13,713,343 + 16,577,907 − 5,100,000 − 25,191,250 = 0
  balances:
    # the 15,000.00 TRY covered at 33 rather than 34: 2,571.46 USD of cost against 2,558.09 USD without the advance
    - { account: "511001", dims: { contract: P1 }, book: 257146, parallel: 30291250 }
    # 15,000.00 TRY left of P1's advance: book 90,909 − 45,455 = 45,454; parallel 10,200,000 − 5,100,000 = 5,100,000
    - { account: "114002", dims: { contract: P1 }, currency: TRY, amount: 1500000, book: 45454, parallel: 5100000 }
    - { account: "111005", currency: TRY, amount: 0, book: 0, parallel: 0 }
  open_items:
    - { item: S1, account: "114002", dims: { supplier: S1 }, currency: TRY, amount: 1500000, book: 45454, parallel: 5100000 }
    - { item: S1, account: "211001", dims: { supplier: S1 }, currency: TRY, amount: -7197500, book: -211691, parallel: -25191250 }
  project_documents:
    - { kind: purchase, number: 1, date: 2026-12-03, contract: P1, client: C1, supplier: S1, entry: 3,
        currency: TRY, reference: "F-1024" }
  quantities:
    - { entry: 3, account: "511001", currency: TRY, amount: 3937500, material: CEM, unit: "طن", quantity: "12.500", unit_price: "3150.0000" }
    - { entry: 3, account: "511001", currency: TRY, amount: 4760000, material: STL, unit: "طن", quantity: "2.000", unit_price: "23800.0000" }
```

### The covered amount typed on one line

The same advance and invoice, but the accountant puts the whole 15,000.00 TRY applied on the steel line (S12 rule 12). The cement is all a new measurement, as in the first case. The steel's covered part takes all the cleared carrying amounts, and its rest is measured at December's rates. The cost and the supplier's credit in total are the previous case's: only their split between the lines changes.

```yaml
case: the previous case with the 15,000.00 TRY applied typed on the steel line only
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }],
           materials: [{ code: CEM, name: "أسمنت بورتلاندي", unit: "طن" },
                       { code: STL, name: "حديد تسليح", unit: "طن" }] }
rates:
  - { date: 2026-11-02, base: TRY, quote: SYP, rate: "3.4000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: TRY, rate: "33.0000", type: market }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - voucher: the owner pays 30,000.00 TRY into the TRY box
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 3000000 },
                       { account: "313001", currency: TRY, amount: -3000000 }] }
  - voucher: an advance of 30,000.00 TRY paid to S1 for P1
    accounting_date: 2026-11-02
    payload: { voucher: { kind: payment, cash_account: "111005", party_name: "المورّد" },
               lines: [{ account: "114002", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: 3000000 },
                       { account: "111005", currency: TRY, amount: -3000000 }] }
  - project_document: S1's invoice F-1024 for P1, the advance applied to the steel
    accounting_date: 2026-12-03
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: TRY, supplier_reference: "F-1024",
                           advance: 1500000 },
               lines: [{ account: "511001", material: CEM, quantity: "12.500", unit_price: "3150.0000" },
                       { account: "511001", material: STL, quantity: "2.000", unit_price: "23800.0000", advance: 1500000 }] }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "111005", currency: TRY, amount: 3000000, book: 90909, parallel: 10200000 }
        - { account: "313001", currency: TRY, amount: -3000000, book: -90909, parallel: -10200000 }
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "114002", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: 3000000, book: 90909, parallel: 10200000 }
        - { account: "111005", currency: TRY, amount: -3000000, book: -90909, parallel: -10200000 }
    - source: manual
      date: 2026-12-03
      lines:
        # cement, nothing covered: as the first case, 1,158.09 USD and 137,812.50 SYP
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 3937500, book: 115809, parallel: 13781250 }
        # steel: covered 15,000.00 TRY at the advance's 45,455 and 5,100,000; the rest 47,600.00 − 15,000.00 = 32,600.00 TRY
        #   book: 45,455 + 3,260,000 / 34 (95,882.35… → 95,882) = 141,337
        #   parallel: 5,100,000 + 3,260,000 × 3.5 (11,410,000) = 16,510,000
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 4760000, book: 141337, parallel: 16510000 }
        - { account: "114002", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: -1500000, book: -45455, parallel: -5100000 }
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: -7197500, book: -211691, parallel: -25191250 }
        # book: 115,809 + 141,337 − 45,455 − 211,691 = 0; parallel: 13,781,250 + 16,510,000 − 5,100,000 − 25,191,250 = 0
  balances:
    # the same cost as the previous case: 257,146 and 30,291,250
    - { account: "511001", dims: { contract: P1 }, book: 257146, parallel: 30291250 }
    - { account: "114002", dims: { contract: P1 }, currency: TRY, amount: 1500000, book: 45454, parallel: 5100000 }
  open_items:
    - { item: S1, account: "114002", dims: { supplier: S1 }, currency: TRY, amount: 1500000, book: 45454, parallel: 5100000 }
    - { item: S1, account: "211001", dims: { supplier: S1 }, currency: TRY, amount: -7197500, book: -211691, parallel: -25191250 }
  project_documents:
    - { kind: purchase, number: 1, date: 2026-12-03, contract: P1, client: C1, supplier: S1, entry: 3,
        currency: TRY, reference: "F-1024" }
  quantities:
    - { entry: 3, account: "511001", currency: TRY, amount: 3937500, material: CEM, unit: "طن", quantity: "12.500", unit_price: "3150.0000" }
    - { entry: 3, account: "511001", currency: TRY, amount: 4760000, material: STL, unit: "طن", quantity: "2.000", unit_price: "23800.0000" }
```

### The same advance in SYP books with a USD parallel ledger

The default-allocation case in a company with SYP books at the bulletin and a USD parallel ledger at the market, TRY being the third currency. Each conversion uses the same rate as before, now in the other ledger. So the book and parallel amounts trade places, the advance still leaves no difference, and neither ledger has a residual.

```yaml
case: third; the 30,000.00 TRY advance and S12's purchase applying 15,000.00 in SYP books with a USD parallel; no difference
company: { shape: third, book: SYP, parallel: USD, template: contracting,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }],
           materials: [{ code: CEM, name: "أسمنت بورتلاندي", unit: "طن" },
                       { code: STL, name: "حديد تسليح", unit: "طن" }] }
rates:
  - { date: 2026-11-02, base: TRY, quote: SYP, rate: "3.4000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: TRY, rate: "33.0000", type: market }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - voucher: the owner pays 30,000.00 TRY into the TRY box
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 3000000 },
                       { account: "313001", currency: TRY, amount: -3000000 }] }
  - voucher: an advance of 30,000.00 TRY paid to S1 for P1
    accounting_date: 2026-11-02
    payload: { voucher: { kind: payment, cash_account: "111005", party_name: "المورّد" },
               lines: [{ account: "114002", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: 3000000 },
                       { account: "111005", currency: TRY, amount: -3000000 }] }
  - project_document: S1's invoice F-1024 for P1, applying 15,000.00 TRY of the advance
    accounting_date: 2026-12-03
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: TRY, supplier_reference: "F-1024",
                           advance: 1500000 },
               lines: [{ account: "511001", material: CEM, quantity: "12.500", unit_price: "3150.0000" },
                       { account: "511001", material: STL, quantity: "2.000", unit_price: "23800.0000" }] }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        # book: 30,000.00 TRY × 3.4 = 102,000.00 SYP; parallel: / 33 = 909.0909… → 909.09 USD
        - { account: "111005", currency: TRY, amount: 3000000, book: 10200000, parallel: 90909 }
        - { account: "313001", currency: TRY, amount: -3000000, book: -10200000, parallel: -90909 }
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "114002", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: 3000000, book: 10200000, parallel: 90909 }
        - { account: "111005", currency: TRY, amount: -3000000, book: -10200000, parallel: -90909 }
    - source: manual
      date: 2026-12-03
      lines:
        # covered as before: cement 679,074 TRY minor, steel 820,926
        # cement: book 2,308,852 + 3,258,426 × 3.5 = 13,713,343; parallel 20,578 + 3,258,426 / 34 → 95,836 = 116,414
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 3937500, book: 13713343, parallel: 116414 }
        # steel: book 2,791,148 + 3,939,074 × 3.5 = 16,577,907; parallel 24,877 + 3,939,074 / 34 → 115,855 = 140,732
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 4760000, book: 16577907, parallel: 140732 }
        # half the advance at its average: book 10,200,000 / 2 = 5,100,000; parallel 90,909 / 2 = 45,454.5 → 45,455
        - { account: "114002", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: -1500000, book: -5100000, parallel: -45455 }
        # 71,975.00 TRY: book × 3.5 = 251,912.50 SYP; parallel / 34 → 2,116.91 USD
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: -7197500, book: -25191250, parallel: -211691 }
  balances:
    - { account: "511001", dims: { contract: P1 }, book: 30291250, parallel: 257146 }
    - { account: "114002", dims: { contract: P1 }, currency: TRY, amount: 1500000, book: 5100000, parallel: 45454 }
  open_items:
    - { item: S1, account: "114002", dims: { supplier: S1 }, currency: TRY, amount: 1500000, book: 5100000, parallel: 45454 }
    - { item: S1, account: "211001", dims: { supplier: S1 }, currency: TRY, amount: -7197500, book: -25191250, parallel: -211691 }
  project_documents:
    - { kind: purchase, number: 1, date: 2026-12-03, contract: P1, client: C1, supplier: S1, entry: 3,
        currency: TRY, reference: "F-1024" }
  quantities:
    - { entry: 3, account: "511001", currency: TRY, amount: 3937500, material: CEM, unit: "طن", quantity: "12.500", unit_price: "3150.0000" }
    - { entry: 3, account: "511001", currency: TRY, amount: 4760000, material: STL, unit: "طن", quantity: "2.000", unit_price: "23800.0000" }
```

### A supplier's debit balance cleared: the residual realised

On 2 November the TRY box pays S1 10,200.00 TRY on account, before any invoice. The payment is recorded on `211001`, not as an advance on `114002`, so S1's running item is a debit carried at 309.09 USD and 34,680.00 SYP. The example's invoice on 3 December credits 86,975.00 TRY and crosses zero (S04 rule 3). The credit first clears the 10,200.00 at what it carries, then adds the remaining 76,775.00 as a new measurement. The supplier's balance is monetary, so each ledger realises its residual (S04 rule 10; IAS 21.28): a loss of 9.09 USD in the book, where 10,200.00 TRY was worth 309.09 USD on 2 November and 300.00 on 3 December, and a gain of 1,020.00 SYP in the parallel ledger, where the bulletin rose from 3.4 to 3.5.

```yaml
case: 10,200.00 TRY paid to S1 on account at 33 and 3.4; S12's purchase at 34 and 3.5 crosses zero; a book loss and a parallel gain
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }],
           materials: [{ code: CEM, name: "أسمنت بورتلاندي", unit: "طن" },
                       { code: STL, name: "حديد تسليح", unit: "طن" }] }
rates:
  - { date: 2026-11-02, base: TRY, quote: SYP, rate: "3.4000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: TRY, rate: "33.0000", type: market }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - voucher: the owner pays 10,200.00 TRY into the TRY box
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 1020000 },
                       { account: "313001", currency: TRY, amount: -1020000 }] }
  - voucher: 10,200.00 TRY paid to S1 on account
    accounting_date: 2026-11-02
    payload: { voucher: { kind: payment, cash_account: "111005", party_name: "المورّد" },
               lines: [{ account: "211001", dims: { supplier: S1 }, currency: TRY, amount: 1020000 },
                       { account: "111005", currency: TRY, amount: -1020000 }] }
  - project_document: S1's invoice F-1024 for P1
    accounting_date: 2026-12-03
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: TRY, supplier_reference: "F-1024" },
               lines: [{ account: "511001", material: CEM, quantity: "12.500", unit_price: "3150.0000" },
                       { account: "511001", material: STL, quantity: "2.000", unit_price: "23800.0000" }] }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        # book: 10,200.00 TRY / 33 = 309.0909… → 309.09 USD; parallel: × 3.4 = 34,680.00 SYP
        - { account: "111005", currency: TRY, amount: 1020000, book: 30909, parallel: 3468000 }
        - { account: "313001", currency: TRY, amount: -1020000, book: -30909, parallel: -3468000 }
    - source: manual
      date: 2026-11-02
      lines:
        # a new running item for S1 in TRY, a debit
        - { account: "211001", dims: { supplier: S1 }, currency: TRY, amount: 1020000, book: 30909, parallel: 3468000 }
        - { account: "111005", currency: TRY, amount: -1020000, book: -30909, parallel: -3468000 }
    - source: manual
      date: 2026-12-03
      lines:
        # the example's lines: 1,158.09 and 1,400.00 USD; 137,812.50 and 166,600.00 SYP
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 3937500, book: 115809, parallel: 13781250 }
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 4760000, book: 140000, parallel: 16660000 }
        # the split at zero: first the whole 10,200.00 debit, cleared at what it carries
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: -1020000, book: -30909, parallel: -3468000 }
        # then the 86,975.00 − 10,200.00 = 76,775.00 TRY beyond zero, new:
        #   book: / 34 = 2,258.0882… → 2,258.09 USD; parallel: × 3.5 = 268,712.50 SYP
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: -7677500, book: -225809, parallel: -26871250 }
        # book residual: 115,809 + 140,000 − 30,909 − 225,809 = −909 → a debit: realised loss 9.09 USD
        - { account: "541001", currency: USD, amount: 909, book: 909, parallel: 0 }
        # parallel residual: 13,781,250 + 16,660,000 − 3,468,000 − 26,871,250 = 102,000 → a credit: realised gain 1,020.00 SYP
        - { account: "421001", currency: SYP, amount: -102000, book: 0, parallel: -102000 }
  balances:
    - { account: "511001", dims: { contract: P1 }, book: 255809, parallel: 30441250 }
    - { account: "541001", book: 909, parallel: 0 }
    - { account: "421001", book: 0, parallel: -102000 }
  open_items:
    # S1 is owed 76,775.00 TRY, measured on 3 December
    - { item: S1, account: "211001", dims: { supplier: S1 }, currency: TRY, amount: -7677500, book: -225809, parallel: -26871250 }
  project_documents:
    - { kind: purchase, number: 1, date: 2026-12-03, contract: P1, client: C1, supplier: S1, entry: 3,
        currency: TRY, reference: "F-1024" }
  quantities:
    - { entry: 3, account: "511001", currency: TRY, amount: 3937500, material: CEM, unit: "طن", quantity: "12.500", unit_price: "3150.0000" }
    - { entry: 3, account: "511001", currency: TRY, amount: 4760000, material: STL, unit: "طن", quantity: "2.000", unit_price: "23800.0000" }
```

### A cash purchase through a payment voucher

On 3 December the owner puts 20,000.00 TRY into the TRY box. The box then pays for 5.000 t of cement and 250.00 TRY of site transport for P1, bought for cash on site (S12 rule 9). The voucher's `511001` line names its material and quantity, and its amount is their product (rule 4). The transport line needs no material. The purchase is a voucher, not a project document: it takes a payment number and no purchase number, and no supplier's item opens.

```yaml
case: a payment voucher of 16,000.00 TRY for 5.000 t of cement and site transport at 34 and 3.5; no project document
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }],
           materials: [{ code: CEM, name: "أسمنت بورتلاندي", unit: "طن" }] }
rates:
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - voucher: the owner pays 20,000.00 TRY into the TRY box
    accounting_date: 2026-12-03
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 2000000 },
                       { account: "313001", currency: TRY, amount: -2000000 }] }
  - voucher: cement and transport bought for cash on site for P1
    accounting_date: 2026-12-03
    payload: { voucher: { kind: payment, cash_account: "111005", party_name: "مورّد الموقع" },
               lines: [{ account: "511001", dims: { contract: P1 }, currency: TRY, material: CEM, quantity: "5.000",
                         unit_price: "3150.0000" },
                       { account: "511005", dims: { contract: P1 }, currency: TRY, amount: 25000 },
                       { account: "111005", currency: TRY, amount: -1600000 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-03
      lines:
        # book: 20,000.00 TRY / 34 = 588.2352… → 588.24 USD; parallel: × 3.5 = 70,000.00 SYP
        - { account: "111005", currency: TRY, amount: 2000000, book: 58824, parallel: 7000000 }
        - { account: "313001", currency: TRY, amount: -2000000, book: -58824, parallel: -7000000 }
    - source: manual
      date: 2026-12-03
      lines:
        # 5.000 × 3,150.0000 = 15,750.00 TRY; book: / 34 = 463.2352… → 463.24 USD; parallel: × 3.5 = 55,125.00 SYP
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 1575000, book: 46324, parallel: 5512500 }
        # 250.00 TRY; book: / 34 = 7.3529… → 7.35 USD; parallel: × 3.5 = 875.00 SYP
        - { account: "511005", dims: { contract: P1 }, currency: TRY, amount: 25000, book: 735, parallel: 87500 }
        # 16,000.00 TRY; book: / 34 = 470.5882… → 470.59 USD; parallel: × 3.5 = 56,000.00 SYP
        - { account: "111005", currency: TRY, amount: -1600000, book: -47059, parallel: -5600000 }
        # book: 46,324 + 735 − 47,059 = 0; parallel: 5,512,500 + 87,500 − 5,600,000 = 0
  balances:
    # 4,000.00 TRY left: book 58,824 − 47,059 = 11,765; parallel 7,000,000 − 5,600,000 = 1,400,000
    - { account: "111005", currency: TRY, amount: 400000, book: 11765, parallel: 1400000 }
  vouchers:
    - { kind: receipt, number: 1, date: 2026-12-03, cash_account: "111005", entry: 1 }
    - { kind: payment, number: 1, date: 2026-12-03, cash_account: "111005", entry: 2 }
  project_documents: []
  quantities:
    - { entry: 2, account: "511001", currency: TRY, amount: 1575000, material: CEM, unit: "طن", quantity: "5.000", unit_price: "3150.0000" }
```

### Refused invoices, then the cancellation that puts the advance back

After the TRY advance of the third case, the accountant's invoices for P1 on 3 December are refused whole, one by one, and none takes a number:
- a `511001` line with no material (`MATERIAL_REQUIRED`, S12 rule 4);
- a quantity of 0.000 with no amount typed (`VALIDATION_FAILED`, S12 edge case 1);
- 0.125 m³ of sand at 0.0300 TRY, which comes to 0.00375 and rounds to a line of zero (`VALIDATION_FAILED`, S12 edge case 2);
- a USD invoice applying an advance, while S1's advance for P1 is held in TRY (`ADVANCE_CURRENCY_MISMATCH`, S12 edge case 4);
- the example's invoice applying 35,000.00 TRY, more than the 30,000.00 carried for P1 (`RELEASE_EXCEEDS_BALANCE`, S12 rule 12).

The third case's invoice then posts as purchase 1. On 10 December the accountant cancels it by reversing its entry (S12 rule 22). The reversal negates every line as posted, reads no rate and carries the negated quantities (S12 rule 4). The advance is back at exactly 30,000.00 TRY carried at 909.09 USD and 102,000.00 SYP, and S1's balance on `211001` is back to zero, with no difference entry (S04 rule 13). The cancelled invoice keeps its number.

```yaml
case: five refused invoices; S12's purchase applying 15,000.00 TRY of the advance, then cancelled; the advance restored with no difference
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1 }],
           materials: [{ code: CEM, name: "أسمنت بورتلاندي", unit: "طن" },
                       { code: STL, name: "حديد تسليح", unit: "طن" },
                       { code: SND, name: "رمل", unit: "م³" }] }
rates:
  - { date: 2026-11-02, base: TRY, quote: SYP, rate: "3.4000", type: bulletin }
  - { date: 2026-11-02, base: USD, quote: TRY, rate: "33.0000", type: market }
  - { date: 2026-12-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
steps:
  - voucher: the owner pays 30,000.00 TRY into the TRY box
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111005", party_name: "المالك" },
               lines: [{ account: "111005", currency: TRY, amount: 3000000 },
                       { account: "313001", currency: TRY, amount: -3000000 }] }
  - voucher: an advance of 30,000.00 TRY paid to S1 for P1
    accounting_date: 2026-11-02
    payload: { voucher: { kind: payment, cash_account: "111005", party_name: "المورّد" },
               lines: [{ account: "114002", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: 3000000 },
                       { account: "111005", currency: TRY, amount: -3000000 }] }
  - project_document: an invoice with a materials line naming no material
    accounting_date: 2026-12-03
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: TRY },
               lines: [{ account: "511001", amount: 100000 }] }
    outcome: { status: refused, reason: MATERIAL_REQUIRED }
  - project_document: an invoice with a quantity of 0 and no amount
    accounting_date: 2026-12-03
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: TRY },
               lines: [{ account: "511001", material: CEM, quantity: "0.000" }] }
    outcome: { status: refused, reason: VALIDATION_FAILED }
  - project_document: an invoice whose only line rounds to zero
    accounting_date: 2026-12-03
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: TRY },
               lines: [{ account: "511001", material: SND, quantity: "0.125", unit_price: "0.0300" }] }
    outcome: { status: refused, reason: VALIDATION_FAILED }
  - project_document: a USD invoice applying an advance held in TRY
    accounting_date: 2026-12-03
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: USD, advance: 50000 },
               lines: [{ account: "511006", amount: 50000 }] }
    outcome: { status: refused, reason: ADVANCE_CURRENCY_MISMATCH }
  - project_document: S12's invoice applying more than P1's advance
    accounting_date: 2026-12-03
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: TRY, supplier_reference: "F-1024",
                           advance: 3500000 },
               lines: [{ account: "511001", material: CEM, quantity: "12.500", unit_price: "3150.0000" },
                       { account: "511001", material: STL, quantity: "2.000", unit_price: "23800.0000" }] }
    outcome: { status: refused, reason: RELEASE_EXCEEDS_BALANCE }
  - project_document: S1's invoice F-1024 for P1, applying 15,000.00 TRY of the advance
    accounting_date: 2026-12-03
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: TRY, supplier_reference: "F-1024",
                           advance: 1500000 },
               lines: [{ account: "511001", material: CEM, quantity: "12.500", unit_price: "3150.0000" },
                       { account: "511001", material: STL, quantity: "2.000", unit_price: "23800.0000" }] }
  - reversal: 3
    accounting_date: 2026-12-10
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "111005", currency: TRY, amount: 3000000, book: 90909, parallel: 10200000 }
        - { account: "313001", currency: TRY, amount: -3000000, book: -90909, parallel: -10200000 }
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "114002", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: 3000000, book: 90909, parallel: 10200000 }
        - { account: "111005", currency: TRY, amount: -3000000, book: -90909, parallel: -10200000 }
    - source: manual
      date: 2026-12-03
      lines:
        # as the third case
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 3937500, book: 116414, parallel: 13713343 }
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 4760000, book: 140732, parallel: 16577907 }
        - { account: "114002", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: -1500000, book: -45455, parallel: -5100000 }
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: -7197500, book: -211691, parallel: -25191250 }
    - source: reversal
      date: 2026-12-10
      lines:
        # the exact negation, at the amounts posted
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: -3937500, book: -116414, parallel: -13713343 }
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: -4760000, book: -140732, parallel: -16577907 }
        # with the advance's balance: no difference entry (S04 rule 13)
        - { account: "114002", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: 1500000, book: 45455, parallel: 5100000 }
        # the whole of S1's balance at what it carries: the difference S04 rule 13 computes is zero, so none posts
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: 7197500, book: 211691, parallel: 25191250 }
  balances:
    - { account: "511001", book: 0, parallel: 0 }
    - { account: "114002", dims: { contract: P1 }, currency: TRY, amount: 3000000, book: 90909, parallel: 10200000 }
    - { account: "211001", book: 0, parallel: 0 }
  open_items:
    # the advance as it was paid
    - { item: S1, account: "114002", dims: { supplier: S1 }, currency: TRY, amount: 3000000, book: 90909, parallel: 10200000 }
    - { item: S1, account: "211001", dims: { supplier: S1 }, currency: TRY, amount: 0, book: 0, parallel: 0 }
  project_documents:
    # the refusals took no number; the cancelled invoice keeps its own
    - { kind: purchase, number: 1, date: 2026-12-03, contract: P1, client: C1, supplier: S1, entry: 3,
        currency: TRY, reference: "F-1024", cancelled_by: 4 }
  quantities:
    - { entry: 3, account: "511001", currency: TRY, amount: 3937500, material: CEM, unit: "طن", quantity: "12.500", unit_price: "3150.0000" }
    - { entry: 3, account: "511001", currency: TRY, amount: 4760000, material: STL, unit: "طن", quantity: "2.000", unit_price: "23800.0000" }
    # the reversal's lines carry the negated quantities (S12 rule 4)
    - { entry: 4, account: "511001", currency: TRY, amount: -3937500, material: CEM, unit: "طن", quantity: "-12.500", unit_price: "3150.0000" }
    - { entry: 4, account: "511001", currency: TRY, amount: -4760000, material: STL, unit: "طن", quantity: "-2.000", unit_price: "23800.0000" }
```
