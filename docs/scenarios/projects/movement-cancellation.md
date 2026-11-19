# Project movements: a cancellation is an exact reversal

Status: Approved (owner, 2026-11-19)

The owner chose, on 2026-11-19, that a cancelled movement is reversed exactly, with no exchange difference, even on a supplier's running item that holds another project's debt in the same currency at another rate ("عكس دقيق بلا فرق"). Both cases run through the movement service (`movement` and `cancel_movement` steps).

## Rule

A movement is cancelled by reversing its entry exactly (S13 rule 8): each running item it moved gets back exactly the amounts it moved, in every ledger, and no S04 rule 13 difference entry follows, so the books read as if the movement had never been recorded. To keep that true, the cancellation is refused (`OPEN_ITEM_HAS_SETTLEMENTS`) while a later clearing or difference stands on a running item the movement moved, whatever its project: the later payments are cancelled first.

## Basis

- **IAS 8.42:** an error is corrected so that the books read as if it had never been made; removing it realises nothing.
- **IAS 21.28:** an exchange difference is realised on a settlement; a cancellation settles nothing.
- **Company policy:** S13 rule 8 and ADR 0024 (owner, 2026-11-19); the same exception to S04 rule 13 as a project billing's cancellation (S12, owner 2026-11-16); ADR 0013 (a running item carried at its average while it is settled).

## Cases

The company has the shape `usd` (ADR 0024) and the chart `contracting@1`. Client C1's projects are P1 and P2; S1 is a supplier. Every rate and amount is synthetic.

### Cancelling P1's debt while S1 is also owed on P2

S1 is owed 118,500.00 SYP for P1 on 1 December at 118.5 (1,000.00 USD) and 120,000.00 SYP for P2 on 2 December at 120 (1,000.00 USD): one running item of 238,500.00 SYP carried at 2,000.00 USD. On 3 December P1's debt is cancelled. The reversal gives the item back exactly what P1's debt moved: 118,500.00 SYP at 1,000.00 USD. The item keeps P2's 120,000.00 SYP at 1,000.00 USD, as if P1's debt had never been recorded, and no exchange difference is posted.

```yaml
case: P1's debt of 118,500.00 SYP (at 118.5) cancelled exactly while S1 is owed 120,000.00 SYP on P2 (at 120)
company: { shape: usd, book: USD, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }, { code: P2, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "118.5000", type: market }
  - { date: 2026-12-02, base: USD, quote: SYP, rate: "120.0000", type: market }
steps:
  - movement: site costs owed to S1 for P1
    accounting_date: 2026-12-01
    payload: { kind: owed_by_us, contract: P1, supplier: S1, currency: SYP, amount: 11850000 }
  - movement: site costs owed to S1 for P2
    accounting_date: 2026-12-02
    payload: { kind: owed_by_us, contract: P2, supplier: S1, currency: SYP, amount: 12000000 }
  - cancel_movement: 1
    accounting_date: 2026-12-03
    reason: "سُجّل خطأً"
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
    - source: reversal
      date: 2026-12-03
      lines:
        # exactly the original's amounts, negated; no difference entry follows
        - { account: "511006", dims: { contract: P1 }, currency: SYP, amount: -11850000, book: -100000 }
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: SYP, amount: 11850000, book: 100000 }
  balances:
    - { account: "541001", book: 0 }
    - { account: "421001", book: 0 }
  open_items:
    # P2's debt alone, at what it was recorded at
    - { item: S1, account: "211001", dims: { supplier: S1 }, currency: SYP, amount: -12000000, book: -100000 }
```

### Refused while a later payment stands on the supplier's item

As before, then on 3 December the owner deposits 60,000.00 SYP and pays S1 60,000.00 SYP of P2's debt: a clearing of S1's item at its average, which included P1's debt. Cancelling P1's debt on 4 December is refused: the payment must be cancelled first.

```yaml
case: P1's debt cannot be cancelled while a later payment of S1 stands
company: { shape: usd, book: USD, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }, { code: P2, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "118.5000", type: market }
  - { date: 2026-12-02, base: USD, quote: SYP, rate: "120.0000", type: market }
steps:
  - movement: site costs owed to S1 for P1
    accounting_date: 2026-12-01
    payload: { kind: owed_by_us, contract: P1, supplier: S1, currency: SYP, amount: 11850000 }
  - movement: site costs owed to S1 for P2
    accounting_date: 2026-12-02
    payload: { kind: owed_by_us, contract: P2, supplier: S1, currency: SYP, amount: 12000000 }
  - movement: the owner deposits 60,000.00 SYP
    accounting_date: 2026-12-03
    payload: { kind: deposit, currency: SYP, amount: 6000000 }
  - movement: 60,000.00 SYP paid to S1 for P2
    accounting_date: 2026-12-03
    payload: { kind: debt_paid, contract: P2, supplier: S1, currency: SYP, amount: 6000000 }
  - cancel_movement: 1
    accounting_date: 2026-12-04
    reason: "سُجّل خطأً"
expect:
  outcome: { status: refused, reason: OPEN_ITEM_HAS_SETTLEMENTS }
  entries:
    - source: manual
      date: 2026-12-01
      lines:
        - { account: "511006", dims: { contract: P1 }, currency: SYP, amount: 11850000, book: 100000 }
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: SYP, amount: -11850000, book: -100000 }
    - source: manual
      date: 2026-12-02
      lines:
        - { account: "511006", dims: { contract: P2 }, currency: SYP, amount: 12000000, book: 100000 }
        - { account: "211001", dims: { supplier: S1, contract: P2 }, currency: SYP, amount: -12000000, book: -100000 }
    - source: manual
      date: 2026-12-03
      lines:
        # 60,000.00 SYP / 120 = 500.00 USD
        - { account: "111001", currency: SYP, amount: 6000000, book: 50000 }
        - { account: "313001", currency: SYP, amount: -6000000, book: -50000 }
    - source: manual
      date: 2026-12-03
      lines:
        # the item's average for 60,000.00 of 238,500.00: 200,000 × 6,000,000 / 23,850,000 = 50,314.46… → 50,314
        - { account: "211001", dims: { supplier: S1, contract: P2 }, currency: SYP, amount: 6000000, book: 50314 }
        - { account: "111001", currency: SYP, amount: -6000000, book: -50000 }
        # residual: 50,314 − 50,000 = 314 → a credit: realised gain 3.14 USD
        - { account: "421001", currency: USD, amount: -314, book: -314 }
```
