# Project movements: cancelling a debt owed to a supplier who is owed on two projects

Status: Proposed

The owner decides how a cancellation in this case posts (S13 rule 8). The case pins what the engine posts today under S04 rule 13, checked against the engine on 2026-11-19 (it passed when run as approved); it stays `Proposed` until the owner approves it or chooses an exact reversal instead.

## Rule

A movement is cancelled by reversing its entry exactly (S03 rule 9). When the entry is on a supplier's running item (`211001`) that also holds another project's debt in the same currency at another rate, the reversal moves the item against its balance, and S04 rule 13 follows it with a difference entry: the item remeasured at its average carrying amount, the residual a realised exchange difference (`421001` or `541001`).

## Basis

- **IAS 21.28:** a monetary item's settlement at another amount than it was carried at realises an exchange difference.
- **IAS 8.42:** an error corrected so that the books read as if it had never been made.
- **Company policy:** S04 rule 13 and ADR 0013 (a running item carried at its average, owner 2026-11-06); S13 rule 8 (a movement cancelled by its reversal).

## Cases

The company has the shape `usd` (ADR 0024) and the chart `contracting@1`. Client C1's projects are P1 and P2; S1 is a supplier. Every rate and amount is synthetic.

### Cancelling P1's debt while S1 is also owed on P2

S1 is owed 118,500.00 SYP for P1 on 1 December at 118.5 (1,000.00 USD) and 120,000.00 SYP for P2 on 2 December at 120 (1,000.00 USD): one running item of 238,500.00 SYP carried at 2,000.00 USD. On 3 December P1's debt is cancelled. The reversal carries the original's amounts back: 118,500.00 SYP at 1,000.00 USD. The item's average for that much was 993.71 USD, so S04 rule 13 remeasures what remains, 120,000.00 SYP, at the average: 1,006.29 USD, and the 6.29 USD left is a realised loss.

```yaml
case: P1's debt of 118,500.00 SYP (at 118.5) cancelled while S1 is owed 120,000.00 SYP on P2 (at 120)
company: { shape: usd, book: USD, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1 }, { code: P2, kind: project, client: C1 }] }
rates:
  - { date: 2026-12-01, base: USD, quote: SYP, rate: "118.5000", type: market }
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
  - reversal: 1
    accounting_date: 2026-12-03
expect:
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
    - source: reversal
      date: 2026-12-03
      lines:
        - { account: "511006", dims: { contract: P1 }, currency: SYP, amount: -11850000, book: -100000 }
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: SYP, amount: 11850000, book: 100000 }
    - source: manual
      date: 2026-12-03
      lines:
        # what remains, 120,000.00 SYP, at the item's average: 200,000 × 12,000,000 / 23,850,000
        # = 100,628.93… → 100,629; it carried 100,000, so 629 more on the credit side
        - { account: "211001", dims: { supplier: S1 }, currency: SYP, amount: 0, book: -629 }
        # a debit: realised loss 6.29 USD
        - { account: "541001", currency: USD, amount: 629, book: 629 }
  open_items:
    - { item: S1, account: "211001", dims: { supplier: S1 }, currency: SYP, amount: -12000000, book: -100629 }
```
