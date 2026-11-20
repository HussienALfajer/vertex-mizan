# Project movements: the entry of each simple movement

Status: Approved (owner, 2026-11-19)

The expected entries of these eight cases, and the cash deposit, were approved by the owner on 2026-11-19 (ADR 0024, `docs/specs/S13-project-movements.md`). Every step is a path the engine already runs (a voucher, a purchase invoice, a manual entry), so the cases switch to `Approved` with S13's first API PR, which checks that each movement posts exactly these entries.

## Rule

A movement on a project posts one entry through an existing path. **Received:** a receipt voucher, the box of the currency against contract revenue `411001` for the project's client. **Expense:** a payment voucher, `511001` with its material, quantity and unit price, or `511006` without a material, against the box. **Wages:** a payment voucher, `511002` against the box. **Owed by us:** a project purchase invoice, the cost against the supplier's running item on `211001`. **Owed to us:** a manual entry, a new document item on `112001` against `411001`. **Debt paid:** a payment voucher, `211001` against the box. **Debt collected:** a receipt voucher, the box against the client's items on `112001`. **Deposit:** a receipt voucher, the box against the owner's current account `313001`. Every cost line carries its project. A movement is cancelled by reversing its entry exactly.

## Basis

- **IAS 1.102:** costs by nature (`511001` materials, `511002` wages, `511006` other site costs), each carrying its project (S11 rule 3).
- **IAS 21.21–22:** each new line at the rate of its day; the USD book at `market`. **IAS 21.28:** a debt paid at another rate than it was carried at realises an exchange difference (`421001`, `541001`), by S04's running-item clearing.
- **Company policy:** ADR 0024: a receipt from the client and an amount due from the client are revenue when recorded (owner, 2026-11-19), the company's management policy, departing from S12's revenue by certified billings (IFRS 15.35(b)); the USD book with no parallel ledger; one box per currency. S11 rules 8, 10, 11 and 15 (vouchers; a box may go below zero, owner, 2026-11-20); S12 rules 4 and 12 (materials, line amounts); S04 rules 3 and 10–13 (items and their clearing); S03 rule 9 (reversal).
- **Syrian rules:** none; the rates are the market rates the owner records.

## Cases

The company has the shape `usd`: the USD book at `market` accepting dealt rates, no parallel ledger, SYP and TRY as other currencies, the chart `contracting@1`: the boxes `111001` (SYP) and `111002` (USD), receivables `112001` (a document control account for clients, client and contract required), suppliers `211001` (a running control account for suppliers), the owner's current account `313001`, contract revenue `411001` (client and contract required), materials `511001` (requiring a material), wages `511002` and other site costs `511006` (each requiring the contract), realised gains `421001`. Client C1's project is P1; S1 is a supplier. The steel `STL` is in tonnes. Every rate and amount is synthetic. Without a parallel ledger, the cases state `book` and no `parallel`.

### Received from the client, in USD and in SYP

The client pays 5,000.00 USD into the USD box, then 1,185,000.00 SYP into the SYP box. Each is the project's revenue at once.

```yaml
case: received 5,000.00 USD and 1,185,000.00 SYP at 118.5; revenue at once
company: { shape: usd, book: USD, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "118.5000", type: market }
steps:
  - voucher: received 5,000.00 USD from the client for P1
    accounting_date: 2026-12-01
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "C1" },
               lines: [{ account: "111002", currency: USD, amount: 500000 },
                       { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -500000 }] }
  - voucher: received 1,185,000.00 SYP from the client for P1
    accounting_date: 2026-12-01
    payload: { voucher: { kind: receipt, cash_account: "111001", party_name: "C1" },
               lines: [{ account: "111001", currency: SYP, amount: 118500000 },
                       { account: "411001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -118500000 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "111002", currency: USD, amount: 500000, book: 500000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -500000, book: -500000 }
    - source: manual
      date: 2026-12-01
      lines:
        # 1,185,000.00 SYP / 118.5 = 10,000.00 USD
        - { account: "111001", currency: SYP, amount: 118500000, book: 1000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -118500000, book: -1000000 }
  balances:
    # revenue of P1: 5,000.00 + 10,000.00 = 15,000.00 USD
    - { account: "411001", dims: { client: C1, contract: P1 }, book: -1500000 }
```

### Expenses with and without a material, and wages, paid from the boxes

The owner deposits 4,000.00 USD and 100,000.00 SYP into the boxes before spending from them. Then for P1: 2.500 t of steel at 820.0000 USD from the USD box; 59,250.00 SYP of site costs with no material from the SYP box; 1,200.00 USD of workers' wages from the USD box.

```yaml
case: deposits, a material expense of 2.500 t × 820, a SYP expense of 59,250.00 at 118.5, wages of 1,200.00
company: { shape: usd, book: USD, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }],
           materials: [{ code: STL, name: "حديد تسليح", unit: "طن" }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "118.5000", type: market }
steps:
  - voucher: the owner deposits 4,000.00 USD
    accounting_date: 2026-12-01
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 400000 },
                       { account: "313001", currency: USD, amount: -400000 }] }
  - voucher: the owner deposits 100,000.00 SYP
    accounting_date: 2026-12-01
    payload: { voucher: { kind: receipt, cash_account: "111001", party_name: "المالك" },
               lines: [{ account: "111001", currency: SYP, amount: 10000000 },
                       { account: "313001", currency: SYP, amount: -10000000 }] }
  - voucher: 2.500 t of steel for P1
    accounting_date: 2026-12-01
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "حديد" },
               lines: [{ account: "511001", dims: { contract: P1 }, currency: USD, amount: 205000,
                         material: STL, quantity: "2.500", unit_price: "820.0000" },
                       { account: "111002", currency: USD, amount: -205000 }] }
  - voucher: site costs for P1 in SYP, no material
    accounting_date: 2026-12-01
    payload: { voucher: { kind: payment, cash_account: "111001", party_name: "نقل" },
               lines: [{ account: "511006", dims: { contract: P1 }, currency: SYP, amount: 5925000 },
                       { account: "111001", currency: SYP, amount: -5925000 }] }
  - voucher: workers' wages for P1
    accounting_date: 2026-12-01
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "أجور العمال" },
               lines: [{ account: "511002", dims: { contract: P1 }, currency: USD, amount: 120000 },
                       { account: "111002", currency: USD, amount: -120000 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "111002", currency: USD, amount: 400000, book: 400000 }
        - { account: "313001", currency: USD, amount: -400000, book: -400000 }
    - source: manual
      date: 2026-12-01
      lines:
        # 100,000.00 SYP / 118.5 = 843.8818… → 843.88 USD
        - { account: "111001", currency: SYP, amount: 10000000, book: 84388 }
        - { account: "313001", currency: SYP, amount: -10000000, book: -84388 }
    - source: manual
      date: 2026-12-01
      lines:
        # 2.500 × 820.0000 = 2,050.00 USD
        - { account: "511001", dims: { contract: P1 }, currency: USD, amount: 205000, book: 205000 }
        - { account: "111002", currency: USD, amount: -205000, book: -205000 }
    - source: manual
      date: 2026-12-01
      lines:
        # 59,250.00 SYP / 118.5 = 500.00 USD
        - { account: "511006", dims: { contract: P1 }, currency: SYP, amount: 5925000, book: 50000 }
        - { account: "111001", currency: SYP, amount: -5925000, book: -50000 }
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "511002", dims: { contract: P1 }, currency: USD, amount: 120000, book: 120000 }
        - { account: "111002", currency: USD, amount: -120000, book: -120000 }
  balances:
    # 4,000.00 − 2,050.00 − 1,200.00 = 750.00 USD
    - { account: "111002", currency: USD, amount: 75000, book: 75000 }
    # 100,000.00 − 59,250.00 = 40,750.00 SYP, carried at 843.88 − 500.00 = 343.88 USD
    - { account: "111001", currency: SYP, amount: 4075000, book: 34388 }
  quantities:
    - { entry: 3, account: "511001", currency: USD, amount: 205000, material: STL, unit: "طن", quantity: "2.500", unit_price: "820.0000" }
```

### Owed by us: steel bought on credit, then paid in part

Supplier S1 sells 10.000 t of steel at 815.0000 USD to P1 on credit. The owner deposits 3,000.00 USD and pays S1 3,000.00 USD of it for P1. 5,150.00 USD stays owed.

```yaml
case: owed by us 10.000 t × 815 = 8,150.00 USD; 3,000.00 paid; 5,150.00 still owed
company: { shape: usd, book: USD, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }],
           materials: [{ code: STL, name: "حديد تسليح", unit: "طن" }] }
steps:
  - project_document: steel bought on credit from S1 for P1
    accounting_date: 2026-12-01
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: USD },
               lines: [{ account: "511001", material: STL, quantity: "10.000", unit_price: "815.0000" }] }
  - voucher: the owner deposits 3,000.00 USD
    accounting_date: 2026-12-02
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 300000 },
                       { account: "313001", currency: USD, amount: -300000 }] }
  - voucher: 3,000.00 USD paid to S1 for P1
    accounting_date: 2026-12-02
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "S1" },
               lines: [{ account: "211001", dims: { supplier: S1, contract: P1 }, currency: USD, amount: 300000 },
                       { account: "111002", currency: USD, amount: -300000 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        # 10.000 × 815.0000 = 8,150.00 USD
        - { account: "511001", dims: { contract: P1 }, currency: USD, amount: 815000, book: 815000 }
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: USD, amount: -815000, book: -815000 }
    - source: manual
      date: 2026-12-02
      lines:
        - { account: "111002", currency: USD, amount: 300000, book: 300000 }
        - { account: "313001", currency: USD, amount: -300000, book: -300000 }
    - source: manual
      date: 2026-12-02
      lines:
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: USD, amount: 300000, book: 300000 }
        - { account: "111002", currency: USD, amount: -300000, book: -300000 }
  open_items:
    # 8,150.00 − 3,000.00 = 5,150.00 USD owed to S1
    - { item: S1, account: "211001", dims: { supplier: S1 }, currency: USD, amount: -515000, book: -515000 }
  project_documents:
    - { kind: purchase, number: 1, date: 2026-12-01, contract: P1, client: C1, supplier: S1, entry: 1, currency: USD }
  quantities:
    - { entry: 1, account: "511001", currency: USD, amount: 815000, material: STL, unit: "طن", quantity: "10.000", unit_price: "815.0000" }
```

### A debt in SYP paid when the SYP is cheaper: a realised gain

S1 is owed 237,000.00 SYP of site costs for P1 from 1 December, at 118.5: 2,000.00 USD. On 2 December, at 120.0, the owner deposits 237,000.00 SYP and pays the whole debt. The debt clears at what it was carried at; the SYP paid is worth 1,975.00 USD; the 25.00 USD left is a realised gain.

```yaml
case: owed by us 237,000.00 SYP at 118.5, paid at 120; a realised gain of 25.00 USD
company: { shape: usd, book: USD, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "118.5000", type: market }
  - { date: 2026-12-02, base: USD, quote: SYP, rate: "120.0000", type: market }
steps:
  - project_document: site costs owed to S1 for P1, in SYP
    accounting_date: 2026-12-01
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: SYP },
               lines: [{ account: "511006", amount: 23700000 }] }
  - voucher: the owner deposits 237,000.00 SYP
    accounting_date: 2026-12-02
    payload: { voucher: { kind: receipt, cash_account: "111001", party_name: "المالك" },
               lines: [{ account: "111001", currency: SYP, amount: 23700000 },
                       { account: "313001", currency: SYP, amount: -23700000 }] }
  - voucher: the debt to S1 paid
    accounting_date: 2026-12-02
    payload: { voucher: { kind: payment, cash_account: "111001", party_name: "S1" },
               lines: [{ account: "211001", dims: { supplier: S1, contract: P1 }, currency: SYP, amount: 23700000 },
                       { account: "111001", currency: SYP, amount: -23700000 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        # 237,000.00 SYP / 118.5 = 2,000.00 USD
        - { account: "511006", dims: { contract: P1 }, currency: SYP, amount: 23700000, book: 200000 }
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: SYP, amount: -23700000, book: -200000 }
    - source: manual
      date: 2026-12-02
      lines:
        # 237,000.00 SYP / 120 = 1,975.00 USD
        - { account: "111001", currency: SYP, amount: 23700000, book: 197500 }
        - { account: "313001", currency: SYP, amount: -23700000, book: -197500 }
    - source: manual
      date: 2026-12-02
      lines:
        # the whole debt, at what it carries
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: SYP, amount: 23700000, book: 200000 }
        - { account: "111001", currency: SYP, amount: -23700000, book: -197500 }
        # residual: 200,000 − 197,500 = 2,500 → a credit: realised gain 25.00 USD
        - { account: "421001", currency: USD, amount: -2500, book: -2500 }
  balances:
    - { account: "111001", currency: SYP, amount: 0, book: 0 }
    - { account: "421001", book: -2500 }
  open_items:
    - { item: S1, account: "211001", dims: { supplier: S1 }, currency: SYP, amount: 0, book: 0 }
```

### Owed to us, then collected in part

On 1 December the client owes 4,000.00 USD for P1, recorded as movement 1: a new item due that day, and revenue. On 3 December the client pays 1,500.00 USD of it. 2,500.00 USD stays owed.

```yaml
case: owed to us 4,000.00 USD, revenue at once; 1,500.00 collected; 2,500.00 still owed
company: { shape: usd, book: USD, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }] }
steps:
  - manual: owed to us by the client for P1
    accounting_date: 2026-12-01
    payload: { lines: [{ account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 400000,
                         open_item: { ref: M-1, due: 2026-12-01 } },
                       { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -400000 }] }
  - voucher: 1,500.00 USD collected from the client
    accounting_date: 2026-12-03
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "C1" },
               lines: [{ account: "111002", currency: USD, amount: 150000 },
                       { account: "112001", currency: USD, amount: -150000, item: M-1 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 400000, book: 400000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -400000, book: -400000 }
    - source: manual
      date: 2026-12-03
      lines:
        - { account: "111002", currency: USD, amount: 150000, book: 150000 }
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: -150000, book: -150000 }
  open_items:
    # 4,000.00 − 1,500.00 = 2,500.00 USD
    - { item: M-1, account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 250000, book: 250000 }
```

### Wages cancelled

Wages of 1,200.00 USD recorded by mistake are cancelled: the entry is reversed exactly, and the cash is back in the box.

```yaml
case: wages of 1,200.00 USD cancelled by their exact reversal
company: { shape: usd, book: USD, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }] }
steps:
  - voucher: the owner deposits 1,200.00 USD
    accounting_date: 2026-12-01
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 120000 },
                       { account: "313001", currency: USD, amount: -120000 }] }
  - voucher: workers' wages for P1
    accounting_date: 2026-12-01
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "أجور العمال" },
               lines: [{ account: "511002", dims: { contract: P1 }, currency: USD, amount: 120000 },
                       { account: "111002", currency: USD, amount: -120000 }] }
  - reversal: 2
    accounting_date: 2026-12-02
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "111002", currency: USD, amount: 120000, book: 120000 }
        - { account: "313001", currency: USD, amount: -120000, book: -120000 }
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "511002", dims: { contract: P1 }, currency: USD, amount: 120000, book: 120000 }
        - { account: "111002", currency: USD, amount: -120000, book: -120000 }
    - source: reversal
      date: 2026-12-02
      lines:
        - { account: "511002", dims: { contract: P1 }, currency: USD, amount: -120000, book: -120000 }
        - { account: "111002", currency: USD, amount: 120000, book: 120000 }
  balances:
    - { account: "511002", book: 0 }
    - { account: "111002", currency: USD, amount: 120000, book: 120000 }
```

### Debt collected across two items, oldest due first

The client owes P1 two amounts in SYP: M-1 of 118,500.00 SYP due 1 December at 118.5 (1,000.00 USD), and M-2 of 60,000.00 SYP due 5 December at 120 (500.00 USD). On 7 December, at 125, the client pays 150,000.00 SYP (1,200.00 USD). The collection clears M-1 whole, then 31,500.00 SYP of M-2 at its carrying amount in proportion; the two items carried 1,262.50 USD against 1,200.00 USD of cash, a realised loss of 62.50 USD. M-2 stays open at 28,500.00 SYP carrying 237.50 USD.

```yaml
case: debt collected 150,000.00 SYP at 125 across M-1 (118,500.00 at 118.5) and M-2 (60,000.00 at 120); a loss of 62.50
company: { shape: usd, book: USD, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "118.5000", type: market }
  - { date: 2026-12-05, base: USD, quote: SYP, rate: "120.0000", type: market }
  - { date: 2026-12-07, base: USD, quote: SYP, rate: "125.0000", type: market }
steps:
  - manual: owed to us M-1 for P1
    accounting_date: 2026-12-01
    payload: { lines: [{ account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 11850000,
                         open_item: { ref: M-1, due: 2026-12-01 } },
                       { account: "411001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -11850000 }] }
  - manual: owed to us M-2 for P1
    accounting_date: 2026-12-05
    payload: { lines: [{ account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 6000000,
                         open_item: { ref: M-2, due: 2026-12-05 } },
                       { account: "411001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -6000000 }] }
  - voucher: 150,000.00 SYP collected from the client, M-1 first
    accounting_date: 2026-12-07
    payload: { voucher: { kind: receipt, cash_account: "111001", party_name: "C1" },
               lines: [{ account: "111001", currency: SYP, amount: 15000000 },
                       { account: "112001", currency: SYP, amount: -11850000, item: M-1 },
                       { account: "112001", currency: SYP, amount: -3150000, item: M-2 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        # 118,500.00 SYP / 118.5 = 1,000.00 USD
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 11850000, book: 100000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -11850000, book: -100000 }
    - source: manual
      date: 2026-12-05
      lines:
        # 60,000.00 SYP / 120 = 500.00 USD
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 6000000, book: 50000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -6000000, book: -50000 }
    - source: manual
      date: 2026-12-07
      lines:
        # 150,000.00 SYP / 125 = 1,200.00 USD
        - { account: "111001", currency: SYP, amount: 15000000, book: 120000 }
        # M-1 whole, at what it carries
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -11850000, book: -100000 }
        # 31,500.00 of M-2's 60,000.00: 500.00 × 31,500 / 60,000 = 262.50 USD
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -3150000, book: -26250 }
        # residual: 120,000 − 100,000 − 26,250 = −6,250 → a debit: realised loss 62.50 USD
        - { account: "541001", currency: USD, amount: 6250, book: 6250 }
  balances:
    - { account: "111001", currency: SYP, amount: 15000000, book: 120000 }
    - { account: "541001", book: 6250 }
  open_items:
    - { item: M-1, account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 0, book: 0 }
    # 60,000.00 − 31,500.00 = 28,500.00 SYP; 500.00 − 262.50 = 237.50 USD
    - { item: M-2, account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 2850000, book: 23750 }
```

### One supplier owed on two projects: a project's debt paid at the item's average

S1 is owed 118,500.00 SYP for P1 on 1 December at 118.5 (1,000.00 USD) and 120,000.00 SYP for P2 on 2 December at 120 (1,000.00 USD): one running item of 238,500.00 SYP carried at 2,000.00 USD. On 3 December, at 120, the owner deposits 118,500.00 SYP and pays P1's debt. The payment clears the item at its average carrying amount, 2,000.00 × 118,500 / 238,500 = 993.71 USD, against 987.50 USD of cash: a realised gain of 6.21 USD, the supplier's (S13 rule 6). P1 owes S1 nothing in SYP; P2 still owes 120,000.00 SYP, and the item carries 1,006.29 USD for it.

```yaml
case: S1 owed 118,500.00 SYP for P1 at 118.5 and 120,000.00 SYP for P2 at 120; P1's debt paid at 120; a gain of 6.21
company: { shape: usd, book: USD, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }, { code: P2, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "118.5000", type: market }
  # 120.0000 from 2 December stays in force on 3 December (a same rate would be RATE_UNCHANGED)
  - { date: 2026-12-02, base: USD, quote: SYP, rate: "120.0000", type: market }
steps:
  - project_document: site costs owed to S1 for P1
    accounting_date: 2026-12-01
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: SYP },
               lines: [{ account: "511006", amount: 11850000 }] }
  - project_document: site costs owed to S1 for P2
    accounting_date: 2026-12-02
    payload: { document: { kind: purchase, contract: P2, supplier: S1, currency: SYP },
               lines: [{ account: "511006", amount: 12000000 }] }
  - voucher: the owner deposits 118,500.00 SYP
    accounting_date: 2026-12-03
    payload: { voucher: { kind: receipt, cash_account: "111001", party_name: "المالك" },
               lines: [{ account: "111001", currency: SYP, amount: 11850000 },
                       { account: "313001", currency: SYP, amount: -11850000 }] }
  - voucher: P1's debt to S1 paid
    accounting_date: 2026-12-03
    payload: { voucher: { kind: payment, cash_account: "111001", party_name: "S1" },
               lines: [{ account: "211001", dims: { supplier: S1, contract: P1 }, currency: SYP, amount: 11850000 },
                       { account: "111001", currency: SYP, amount: -11850000 }] }
expect:
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        # 118,500.00 SYP / 118.5 = 1,000.00 USD
        - { account: "511006", dims: { contract: P1 }, currency: SYP, amount: 11850000, book: 100000 }
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: SYP, amount: -11850000, book: -100000 }
    - source: manual
      date: 2026-12-02
      lines:
        # 120,000.00 SYP / 120 = 1,000.00 USD
        - { account: "511006", dims: { contract: P2 }, currency: SYP, amount: 12000000, book: 100000 }
        - { account: "211001", dims: { supplier: S1, contract: P2 }, currency: SYP, amount: -12000000, book: -100000 }
    - source: manual
      date: 2026-12-03
      lines:
        # 118,500.00 SYP / 120 = 987.50 USD
        - { account: "111001", currency: SYP, amount: 11850000, book: 98750 }
        - { account: "313001", currency: SYP, amount: -11850000, book: -98750 }
    - source: manual
      date: 2026-12-03
      lines:
        # the item's average: 200,000 × 11,850,000 / 23,850,000 = 99,371.06… → 99,371
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: SYP, amount: 11850000, book: 99371 }
        - { account: "111001", currency: SYP, amount: -11850000, book: -98750 }
        # residual: 99,371 − 98,750 = 621 → a credit: realised gain 6.21 USD
        - { account: "421001", currency: USD, amount: -621, book: -621 }
  balances:
    # P1 owes S1 nothing in SYP; its lines carry −1,000.00 + 993.71 = −6.29 USD of the item's average
    - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: SYP, amount: 0, book: -629 }
    - { account: "211001", dims: { supplier: S1, contract: P2 }, currency: SYP, amount: -12000000, book: -100000 }
    - { account: "421001", book: -621 }
  open_items:
    # 238,500.00 − 118,500.00 = 120,000.00 SYP; 2,000.00 − 993.71 = 1,006.29 USD
    - { item: S1, account: "211001", dims: { supplier: S1 }, currency: SYP, amount: -12000000, book: -100629 }
```
