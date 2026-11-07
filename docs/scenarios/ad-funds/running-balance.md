# A client's ad funds as a running balance

Status: Approved (owner, 2026-11-07)

The expected entries were approved by the owner on 2026-11-06, with two decisions:
- **A reversal that runs with the item's balance** (a refund voided, a spend changed or archived while the funds hold a credit) posts its exact reversal and no difference entry: the item regains what the movement cleared, and the movement's difference is taken back with it. A reversal against the balance or across zero is followed by the difference entry of ADR 0013. S04 rule 13 says so.
- **A reversal across zero** (owner, 2026-11-06, after the accounting review of S04's first PR): its difference entry clears the item to zero at what the exact reversal left, measures the excess anew at the void date's policy rate, with that rate recorded so a correction of it lists the entry (S02 rule 15), and posts the realised difference. The item and the gain or loss are those approved before; the entry has these lines instead of one difference line on the item. A reversal against the balance that stays on its side of zero keeps its difference line on the item: it reads no rate.
- **A deposit or refund in SYP for a USD amount:** the gap between Hub's `usd_amount` and the SYP amount at Hub's `syp_per_usd` is a realised exchange difference within the tolerance of payments (1.00 USD by default, the same company setting; `receivables/hub-payment.md`), and beyond it the event is held `NEEDS_DECISION`.

S05 added four cases, whose expected entries and outcomes the owner approved on 2026-11-07 (S05 "Scenarios"): the tolerance on an SYP deposit and an SYP refund (a gap of exactly 1.00 USD posts as a realised difference, either way), one minor unit beyond it (held `NEEDS_DECISION`, with a parallel ledger and without), and a deposit held `RATE_MISSING` with a spend waiting behind it, both posted in order once the bulletin is recorded. No expected value of the earlier cases changes.

S05's feature slice brought their executors: the `event` executor through the event inbox, the posting rules of `ad_wallet.deposited`, `ad_wallet.refunded`, `ad_wallet.entry_voided`, `ad_spend.recorded`, `ad_spend.changed` and `ad_spend.archived`, the mapping of each payment method to its account, the void difference entry of a running item, the holds `RATE_MISSING`, `WAITING_FOR_EARLIER_EVENT` and `NEEDS_DECISION`, and the automatic retries (S04 rule 13; S04 "Out of scope"; owner, 2026-10-28; S05 rules 8–11).

## Rule

Each client's ad funds are one running item on client ad funds held `213001`, per client and in USD. `ad_wallet.deposited` debits the account of the deposit's method in the deposit's currency, a new measurement, and credits the client's item by the USD amount Hub credits. `ad_wallet.refunded` is the opposite entry. `ad_spend.recorded` debits the item and credits ad platforms payable `211001` with the same amounts. A movement against the item's balance clears it at its average carrying amount; a movement with the balance, or on a zero balance, is a new measurement at each ledger's policy rate of the day, or at Hub's `syp_per_usd` for a market ledger that accepts it; a movement that crosses zero clears the whole balance and measures the excess anew. Each ledger's residual, rounding included, posts in that ledger only as a realised exchange difference. `ad_wallet.entry_voided` posts the exact reversal of the wallet entry's posting; `ad_spend.changed` posts the reversal of the spend's posting, then the new spend; `ad_spend.archived` posts the reversal. When a reversal runs against the item's balance or crosses zero, a difference entry follows it and brings the item to the carrying amount it would have if the reversal were a new movement; a reversal with the balance stands alone (owner, 2026-11-06). A deposit or refund in SYP is held `NEEDS_DECISION` when its amount at Hub's `syp_per_usd` differs from its `usd_amount` by more than the company's USD tolerance (1.00 USD by default). Events on one client's funds post in Hub's order: an event received after a held one on the same client waits behind it (`WAITING_FOR_EARLIER_EVENT`), so the funds' average never depends on when a bulletin is recorded.

## Basis

- **Conceptual Framework 4.26:** the agency holds the client's money to spend for the client on ad platforms, so the funds are a liability, never revenue (scope Q4), and the spend reduces that liability as it moves to what the agency owes the platform.
- **IAS 21.21–22:** a deposit, a refund and the excess of a crossing are recorded at the spot rate of their date: the bulletin of the day for the book ledger (S02 rule 16), and for Vertex Media's USD parallel ledger the rate the deposit was dealt at, Hub's `syp_per_usd`, which the ledger's policy accepts.
- **IAS 21.23(b) and 21.28:** the funds are a monetary item. A movement against them takes their carrying amount and is not converted again. The gap between that and what is paid or received, in each ledger, is a realised exchange difference in profit or loss of the period.
- **IAS 1.32 and 1.54(h):** a client whose funds turn into a debit balance owes the agency; the balance sheet presents it as a receivable from that client, never netted against other clients' funds (S09).
- **ADR 0005:** posted entries are append-only; a void or an edit in Hub is a reversal in Mizan, dated on the void or edit date.
- **Company policy:** `phase-1-scope.md` §4 (book ledger at the bulletin, the USD parallel ledger at market or the transaction's own rate), F06 and §6 "Ad budget"; scope Q4 (client money held) and Q6 (one account per payment method); ADR 0006 (the event catalogue); ADR 0007 "Carrying amount" (the average, crossing zero, voiding a movement on a running balance) and "Exchange residuals"; ADR 0013 (item kinds, voiding a movement on a running item; owner, 2026-10-28); S04 rules 3, 10 and 13 (rule 13's reversal with the balance: owner, 2026-11-06) and its "Accounting treatment" of the ad-wallet events (owner, 2026-10-28).
- **S05 rules 8–11 and the tolerance** (owner, 2026-11-06 and 2026-11-07): the hold reasons and their order, the automatic retries, the order per client's funds (`ad_funds:<client>`), and the gap compared in USD, rounded half away from zero, held only when it is more than the tolerance.
- **Syrian rules:** the bulletin for the statutory books, UNVERIFIED (open question Q1), adopted by the owner as the company's policy; Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The account codes are the service-agency template's (S02): cash on hand in SYP and USD `111001` and `111002`, the SYP and USD bank accounts `111003` and `111004`, ad platforms payable `211001` (client required), client ad funds held `213001` (a `running` control account, USD only, client required), realised exchange gains `421001` and losses `541001`. A wallet entry's method maps to the account of that method in its currency (scope Q6): `cash` to `111001` or `111002`, `bank_transfer` to `111003` or `111004`, `e_wallet` to `111005` or `111006`. Every rate and amount is synthetic. Tuesday 3, Tuesday 10, Thursday 19, Wednesday 25 and Thursday 26 November 2026 are publication days.

The client's running item is named by the client's code (`C1`) and carries the client only. The payloads carry the fields of ADR 0006's catalogue that the rules read, in a short form: dimensions by their code, each wallet entry by its number (`W-1`) and each spend by its campaign update (`CU-1`). `usd_amount` is the USD amount Hub credits to or debits from the wallet. S05 fixes the full payload contract with Hub (Q5), which changes the payloads but no expected value. A void's or an edit's entries have that event as their source, the difference entry included (S04 rule 13). A difference line carries its amount in one ledger only: on the item, in USD with a transaction amount of zero; on the gain or loss account, in that ledger's currency (ADR 0007).

Shapes:
- **`syp-usd`** is Vertex Media, the company Hub feeds; most cases are in it. Its parallel ledger is in USD, the item's currency, so the item's parallel amount is always its USD amount, and every difference on the item is in the book ledger.
- **`syp`** has two cases and **`usd-syp`** one, for a company fed by Hub without a parallel ledger or with USD books.
- **`third`** cannot occur: `213001` is restricted to USD, and Hub's wallet entries are in SYP or USD with only `syp_per_usd` (ADR 0006), so an event in another currency is refused by the contract (S05 rule 2, from Hub's `CURRENCIES`, read on 2026-11-07), and stores nothing.

The cases leave out what other scenarios or later specs own:
- a manual movement on the item, such as an offset of an invoice against the funds (`receivables/manual-settlement.md`);
- the accountant's payment of `211001` to a platform, a manual entry on a plain account (S03);
- a wallet event dated in a closed period, held `PERIOD_CLOSED`, and the month-end revaluation of the item, added with S07's jobs;
- a replayed event (the same idempotency key), which posts nothing new: a property test of S05, since a step carries no event ID;
- a wallet entry or a spend of zero or a negative amount, and a USD wallet entry whose `usd_amount` differs from its amount: refused by the contract (422), nothing stored (S05 rule 3);
- a company tolerance other than the default 1.00 USD: the setting is S05's (rule 9), and its cases here use the default;
- a held event resolved by a manual entry or dismissed, and the events waiting behind it (`inbox/holds-and-actions.md`, S05);
- a refund beyond the client's balance, which would cross zero as the spend below does; S05 confirms with Hub whether one can be sent (Q5);
- campaigns the client pays directly, which Hub does not send (ADR 0006).

### Vertex Media: deposits in USD and in SYP, a spend at the average, and a refund

The first deposit is in USD, so its `syp_per_usd` is not read. The second is paid in SYP for a USD credit: the parallel ledger takes the SYP at Hub's 124, and the book ledger credits the 500.00 USD at the bulletin of 122, so the 1,000.00 SYP between them is a realised gain. The spend and the refund each clear the funds at their average, and the refund's cash, at the bulletin of its day, leaves a book loss.

```yaml
case: 1,000.00 USD and 62,000.00 SYP for 500.00 USD deposited; 700.00 USD spent at the average; 300.00 USD refunded at 123.5
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
steps:
  - event: ad_wallet.deposited
    accounting_date: 2026-11-03
    payload: { entry: W-1, client: C1, entered_on: 2026-11-03, method: bank_transfer,
               currency: USD, amount: 100000, syp_per_usd: "122.0000", usd_amount: 100000 }
  - event: ad_wallet.deposited
    accounting_date: 2026-11-10
    payload: { entry: W-2, client: C1, entered_on: 2026-11-10, method: cash,
               currency: SYP, amount: 6200000, syp_per_usd: "124.0000", usd_amount: 50000 }
  - event: ad_spend.recorded
    accounting_date: 2026-11-19
    payload: { update: CU-1, campaign: CMP-1, client: C1, period_from: 2026-11-01,
               period_to: 2026-11-19, usd_spend: 70000 }
  - event: ad_wallet.refunded
    accounting_date: 2026-11-25
    payload: { entry: W-3, client: C1, entered_on: 2026-11-25, method: bank_transfer,
               currency: USD, amount: 30000, syp_per_usd: "124.5000", usd_amount: 30000 }
expect:
  entries:
    - source: ad_wallet.deposited
      date: 2026-11-03
      lines:
        # bank_transfer in USD → 111004; book: 1,000.00 USD × 120 = 120,000.00 SYP
        - { account: "111004", currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        # a new running item for C1 in USD, measured new
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: ad_wallet.deposited
      date: 2026-11-10
      lines:
        # cash in SYP → 111001; parallel: 62,000.00 SYP / 124 (Hub's rate) = 500.00 USD
        - { account: "111001", currency: SYP, amount: 6200000, book: 6200000, parallel: 50000 }
        # with the balance: a new measurement; book: 500.00 USD × 122 = 61,000.00 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -50000, book: -6100000, parallel: -50000 }
        # book residual: 6,200,000 − 6,100,000 = 100,000 → realised gain 1,000.00 SYP; parallel residual 0
        - { account: "421001", currency: SYP, amount: -100000, book: -100000, parallel: 0 }
    - source: ad_spend.recorded
      date: 2026-11-19
      lines:
        # against the balance of 1,500.00 USD carried at 181,000.00 SYP:
        # 18,100,000 × 700 / 1,500 = 8,446,666.67 → 8,446,667 (half away from zero)
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 70000, book: 8446667, parallel: 70000 }
        # the payable carries the same amounts; the bulletin of 123 is not read
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -70000, book: -8446667, parallel: -70000 }
    - source: ad_wallet.refunded
      date: 2026-11-25
      lines:
        # against the balance of 800.00 USD carried at 96,533.33 SYP:
        # 9,653,333 × 300 / 800 = 3,619,999.875 → 3,620,000
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 30000, book: 3620000, parallel: 30000 }
        # bank_transfer in USD → 111004; book: 300.00 USD × 123.5 = 37,050.00 SYP
        - { account: "111004", currency: USD, amount: -30000, book: -3705000, parallel: -30000 }
        # book residual: 3,620,000 − 3,705,000 = −85,000 → realised loss 850.00 SYP; parallel residual 0
        - { account: "541001", currency: SYP, amount: 85000, book: 85000, parallel: 0 }
  balances:
    # 9,653,333 − 3,620,000 = 6,033,333
    - { account: "213001", book: -6033333, parallel: -50000 }
    # 12,000,000 − 3,705,000 = 8,295,000
    - { account: "111004", book: 8295000, parallel: 70000 }
    - { account: "111001", book: 6200000, parallel: 50000 }
    - { account: "211001", book: -8446667, parallel: -70000 }
    - { account: "421001", book: -100000, parallel: 0 }
    - { account: "541001", book: 85000, parallel: 0 }
  open_items:
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: -50000, book: -6033333, parallel: -50000 }
```

### Vertex Media: a spend that crosses zero, then a deposit that crosses back

The spend clears the whole 300.00 USD at what it carries, and the 150.00 USD beyond it is a new measurement at the day's bulletin: the client now owes the agency (ADR 0007, owner 2026-10-20). The next deposit runs against that debit balance, so it clears it at its carrying amount, and its excess is a new credit at its own bulletin. The 75.00 SYP between what the client owed at 123 and paid at 123.5 is a realised gain.

```yaml
case: 300.00 USD deposited at 120; 450.00 USD spent at 123, crossing to a 150.00 USD debit; 500.00 USD deposited at 123.5, crossing back
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
steps:
  - event: ad_wallet.deposited
    accounting_date: 2026-11-03
    payload: { entry: W-1, client: C1, entered_on: 2026-11-03, method: bank_transfer,
               currency: USD, amount: 30000, syp_per_usd: "122.0000", usd_amount: 30000 }
  - event: ad_spend.recorded
    accounting_date: 2026-11-19
    payload: { update: CU-1, campaign: CMP-1, client: C1, period_from: 2026-11-01,
               period_to: 2026-11-19, usd_spend: 45000 }
  - event: ad_wallet.deposited
    accounting_date: 2026-11-25
    payload: { entry: W-2, client: C1, entered_on: 2026-11-25, method: bank_transfer,
               currency: USD, amount: 50000, syp_per_usd: "125.0000", usd_amount: 50000 }
expect:
  entries:
    - source: ad_wallet.deposited
      date: 2026-11-03
      lines:
        # book: 300.00 USD × 120 = 36,000.00 SYP
        - { account: "111004", currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: ad_spend.recorded
      date: 2026-11-19
      lines:
        # the split at zero: first the whole 300.00 USD balance, cleared at what it carries
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        # then the 150.00 USD beyond zero, a new measurement: 150.00 × 123 = 18,450.00 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 15000, book: 1845000, parallel: 15000 }
        # the payable carries the sum of both: 3,600,000 + 1,845,000 = 5,445,000; no residual
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -45000, book: -5445000, parallel: -45000 }
    - source: ad_wallet.deposited
      date: 2026-11-25
      lines:
        # book: 500.00 USD × 123.5 = 61,750.00 SYP
        - { account: "111004", currency: USD, amount: 50000, book: 6175000, parallel: 50000 }
        # the split at zero: the whole 150.00 USD debit, cleared at what it carries
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -15000, book: -1845000, parallel: -15000 }
        # then the 350.00 USD beyond zero, a new measurement: 350.00 × 123.5 = 43,225.00 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -35000, book: -4322500, parallel: -35000 }
        # book residual: 6,175,000 − 1,845,000 − 4,322,500 = 7,500 → realised gain 75.00 SYP; parallel 0
        - { account: "421001", currency: SYP, amount: -7500, book: -7500, parallel: 0 }
  balances:
    - { account: "213001", book: -4322500, parallel: -35000 }
    # 3,600,000 + 6,175,000 = 9,775,000
    - { account: "111004", book: 9775000, parallel: 80000 }
    - { account: "211001", book: -5445000, parallel: -45000 }
    - { account: "421001", book: -7500, parallel: 0 }
  open_items:
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: -35000, book: -4322500, parallel: -35000 }
```

### Vertex Media: a deposit voided after spend, crossing zero

The void's reversal debits the funds by the 1,000.00 USD at the 120,000.00 SYP the deposit credited, which leaves a 300.00 USD debit carried at 120. Taken as a new movement, the void would clear the 700.00 USD left at what it carries and measure the 300.00 USD beyond zero at the void date's bulletin of 123. The difference entry posts the 900.00 SYP between them as a realised gain (ADR 0013).

```yaml
case: 1,000.00 USD deposited at 120; 300.00 USD spent; the deposit voided at 123; the funds become a 300.00 USD debit at 123
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: ad_wallet.deposited
    accounting_date: 2026-11-03
    payload: { entry: W-1, client: C1, entered_on: 2026-11-03, method: bank_transfer,
               currency: USD, amount: 100000, syp_per_usd: "122.0000", usd_amount: 100000 }
  - event: ad_spend.recorded
    accounting_date: 2026-11-10
    payload: { update: CU-1, campaign: CMP-1, client: C1, period_from: 2026-11-01,
               period_to: 2026-11-10, usd_spend: 30000 }
  - event: ad_wallet.entry_voided
    accounting_date: 2026-11-19
    payload: { entry: W-1, voided_on: 2026-11-19 }
expect:
  entries:
    - source: ad_wallet.deposited
      date: 2026-11-03
      lines:
        - { account: "111004", currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: ad_spend.recorded
      date: 2026-11-10
      lines:
        # 12,000,000 × 300 / 1,000 = 3,600,000; the funds: 700.00 USD at 84,000.00 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: ad_wallet.entry_voided
      date: 2026-11-19
      lines:
        # the exact negation of the 3 November entry; the funds: −8,400,000 + 12,000,000 = 3,600,000, a 300.00 USD debit
        - { account: "111004", currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
    - source: ad_wallet.entry_voided
      date: 2026-11-19
      lines:
        # as a new movement: clear 700.00 at 8,400,000, then 300.00 × 123 = 3,690,000 → a debit of 3,690,000
        # across zero: the 300.00 USD debit the reversal left, at 3,600,000, cleared to zero
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
        # then the 300.00 USD beyond zero measured anew at the 19 November bulletin, its rate recorded
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 30000, book: 3690000, parallel: 30000 }
        # book residual: 3,600,000 − 3,690,000 = −90,000 → realised gain 900.00 SYP
        - { account: "421001", currency: SYP, amount: -90000, book: -90000, parallel: 0 }
  balances:
    - { account: "213001", book: 3690000, parallel: 30000 }
    - { account: "111004", book: 0, parallel: 0 }
    - { account: "211001", book: -3600000, parallel: -30000 }
    - { account: "421001", book: -90000, parallel: 0 }
  open_items:
    # a debit balance: the client owes the agency 300.00 USD, carried at 123
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: 30000, book: 3690000, parallel: 30000 }
```

### Vertex Media: a deposit voided after spend and another deposit, at the average

The second deposit, at 123, raised the funds' average. Its reversal takes back the 86,100.00 SYP it credited, but as a new movement the void would clear 700 of the 1,300.00 USD at their average. The remaining 600.00 USD is then carried at that average, and the 969.23 SYP between the two is a realised loss.

```yaml
case: 1,000.00 USD at 120; 400.00 USD spent; 700.00 USD at 123; the second deposit voided; a loss of 969.23 SYP
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
steps:
  - event: ad_wallet.deposited
    accounting_date: 2026-11-03
    payload: { entry: W-1, client: C1, entered_on: 2026-11-03, method: bank_transfer,
               currency: USD, amount: 100000, syp_per_usd: "122.0000", usd_amount: 100000 }
  - event: ad_spend.recorded
    accounting_date: 2026-11-10
    payload: { update: CU-1, campaign: CMP-1, client: C1, period_from: 2026-11-01,
               period_to: 2026-11-10, usd_spend: 40000 }
  - event: ad_wallet.deposited
    accounting_date: 2026-11-19
    payload: { entry: W-2, client: C1, entered_on: 2026-11-19, method: bank_transfer,
               currency: USD, amount: 70000, syp_per_usd: "124.0000", usd_amount: 70000 }
  - event: ad_wallet.entry_voided
    accounting_date: 2026-11-25
    payload: { entry: W-2, voided_on: 2026-11-25 }
expect:
  entries:
    - source: ad_wallet.deposited
      date: 2026-11-03
      lines:
        - { account: "111004", currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: ad_spend.recorded
      date: 2026-11-10
      lines:
        # 12,000,000 × 400 / 1,000 = 4,800,000; the funds: 600.00 USD at 72,000.00 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 40000, book: 4800000, parallel: 40000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
    - source: ad_wallet.deposited
      date: 2026-11-19
      lines:
        # book: 700.00 USD × 123 = 86,100.00 SYP; the funds: 1,300.00 USD at 158,100.00 SYP
        - { account: "111004", currency: USD, amount: 70000, book: 8610000, parallel: 70000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -70000, book: -8610000, parallel: -70000 }
    - source: ad_wallet.entry_voided
      date: 2026-11-25
      lines:
        # the exact negation of the 19 November entry; the funds: 600.00 USD at 72,000.00 SYP
        - { account: "111004", currency: USD, amount: -70000, book: -8610000, parallel: -70000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 70000, book: 8610000, parallel: 70000 }
    - source: ad_wallet.entry_voided
      date: 2026-11-25
      lines:
        # as a new movement, against the balance: 15,810,000 × 700 / 1,300 = 8,513,076.92 → 8,513,077 cleared,
        # leaving 15,810,000 − 8,513,077 = 7,296,923; difference: 7,296,923 − 7,200,000 = 96,923 more credit
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 0, book: -96923, parallel: 0 }
        # → realised loss 969.23 SYP; the bulletin of 123.5 is not read
        - { account: "541001", currency: SYP, amount: 96923, book: 96923, parallel: 0 }
  balances:
    - { account: "213001", book: -7296923, parallel: -60000 }
    - { account: "111004", book: 12000000, parallel: 100000 }
    - { account: "211001", book: -4800000, parallel: -40000 }
    - { account: "541001", book: 96923, parallel: 0 }
  open_items:
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: -60000, book: -7296923, parallel: -60000 }
```

### Vertex Media: a refund voided

The void's reversal credits the funds by the 400.00 USD the refund cleared, which runs with their balance, and takes back the refund's loss. The funds return to the 1,000.00 USD at 120,000.00 SYP they held before the refund, so no difference entry follows.

```yaml
case: 1,000.00 USD at 120; 400.00 USD refunded at 122 with a loss; the refund voided; the funds back at 120,000.00 SYP
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: ad_wallet.deposited
    accounting_date: 2026-11-03
    payload: { entry: W-1, client: C1, entered_on: 2026-11-03, method: bank_transfer,
               currency: USD, amount: 100000, syp_per_usd: "122.0000", usd_amount: 100000 }
  - event: ad_wallet.refunded
    accounting_date: 2026-11-10
    payload: { entry: W-2, client: C1, entered_on: 2026-11-10, method: bank_transfer,
               currency: USD, amount: 40000, syp_per_usd: "124.0000", usd_amount: 40000 }
  - event: ad_wallet.entry_voided
    accounting_date: 2026-11-19
    payload: { entry: W-2, voided_on: 2026-11-19 }
expect:
  entries:
    - source: ad_wallet.deposited
      date: 2026-11-03
      lines:
        - { account: "111004", currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: ad_wallet.refunded
      date: 2026-11-10
      lines:
        # 12,000,000 × 400 / 1,000 = 4,800,000
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 40000, book: 4800000, parallel: 40000 }
        # book: 400.00 USD × 122 = 48,800.00 SYP
        - { account: "111004", currency: USD, amount: -40000, book: -4880000, parallel: -40000 }
        # book residual: 4,800,000 − 4,880,000 = −80,000 → realised loss 800.00 SYP
        - { account: "541001", currency: SYP, amount: 80000, book: 80000, parallel: 0 }
    - source: ad_wallet.entry_voided
      date: 2026-11-19
      lines:
        # the exact negation of the 10 November entry; with the balance, so no difference entry
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -40000, book: -4800000, parallel: -40000 }
        - { account: "111004", currency: USD, amount: 40000, book: 4880000, parallel: 40000 }
        - { account: "541001", currency: SYP, amount: -80000, book: -80000, parallel: 0 }
  balances:
    - { account: "213001", book: -12000000, parallel: -100000 }
    - { account: "111004", book: 12000000, parallel: 100000 }
    - { account: "541001", book: 0, parallel: 0 }
  open_items:
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
```

### Vertex Media: a spend changed, then archived

`ad_spend.changed` carries the spend's new state: the posting of the 600.00 USD spend is reversed, and the 450.00 USD spend posts against the funds as they then stand. `ad_spend.archived` reverses the 450.00 USD posting. Each reversal runs with the funds' balance, so no difference entry follows, and the funds end at what the two deposits credited.

```yaml
case: 1,500.00 USD deposited; 600.00 USD spent, changed to 450.00 USD, then archived; the funds back to 181,000.00 SYP
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
  - { date: 2026-11-26, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
steps:
  - event: ad_wallet.deposited
    accounting_date: 2026-11-03
    payload: { entry: W-1, client: C1, entered_on: 2026-11-03, method: bank_transfer,
               currency: USD, amount: 100000, syp_per_usd: "122.0000", usd_amount: 100000 }
  - event: ad_wallet.deposited
    accounting_date: 2026-11-10
    payload: { entry: W-2, client: C1, entered_on: 2026-11-10, method: bank_transfer,
               currency: USD, amount: 50000, syp_per_usd: "124.0000", usd_amount: 50000 }
  - event: ad_spend.recorded
    accounting_date: 2026-11-19
    payload: { update: CU-1, campaign: CMP-1, client: C1, period_from: 2026-11-01,
               period_to: 2026-11-19, usd_spend: 60000 }
  - event: ad_spend.changed
    accounting_date: 2026-11-25
    payload: { update: CU-1, campaign: CMP-1, client: C1, period_from: 2026-11-01,
               period_to: 2026-11-19, usd_spend: 45000 }
  - event: ad_spend.archived
    accounting_date: 2026-11-26
    payload: { update: CU-1, campaign: CMP-1, client: C1 }
expect:
  entries:
    - source: ad_wallet.deposited
      date: 2026-11-03
      lines:
        - { account: "111004", currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: ad_wallet.deposited
      date: 2026-11-10
      lines:
        # book: 500.00 USD × 122 = 61,000.00 SYP; the funds: 1,500.00 USD at 181,000.00 SYP
        - { account: "111004", currency: USD, amount: 50000, book: 6100000, parallel: 50000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -50000, book: -6100000, parallel: -50000 }
    - source: ad_spend.recorded
      date: 2026-11-19
      lines:
        # 18,100,000 × 600 / 1,500 = 7,240,000
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 60000, book: 7240000, parallel: 60000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -60000, book: -7240000, parallel: -60000 }
    - source: ad_spend.changed
      date: 2026-11-25
      lines:
        # the exact negation of the 19 November entry; with the balance, so no difference entry
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -60000, book: -7240000, parallel: -60000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: 60000, book: 7240000, parallel: 60000 }
    - source: ad_spend.changed
      date: 2026-11-25
      lines:
        # the new state, against 1,500.00 USD at 181,000.00 SYP: 18,100,000 × 450 / 1,500 = 5,430,000
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 45000, book: 5430000, parallel: 45000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -45000, book: -5430000, parallel: -45000 }
    - source: ad_spend.archived
      date: 2026-11-26
      lines:
        # the exact negation of the 25 November spend; with the balance, so no difference entry
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -45000, book: -5430000, parallel: -45000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: 45000, book: 5430000, parallel: 45000 }
  balances:
    - { account: "213001", book: -18100000, parallel: -150000 }
    - { account: "211001", book: 0, parallel: 0 }
  open_items:
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: -150000, book: -18100000, parallel: -150000 }
```

### Vertex Media: the tolerance on an SYP deposit and an SYP refund

The gap is measured in USD: the SYP amount at Hub's `syp_per_usd`, rounded half away from zero, against Hub's `usd_amount`. Within the tolerance (1.00 USD, the default), the parallel ledger takes the cash at Hub's rate and the funds by the `usd_amount`, and the gap between them is a realised difference in that ledger. Both gaps here are exactly the tolerance: the deposit's, after rounding, is a parallel gain; the refund's runs the other way, a parallel loss (S05 rule 9).

```yaml
case: 50,000.00 SYP at Hub's 124 credited as 402.23 USD, a gain of 1.00 USD; 24,800.00 SYP at 124 refunded as 199.00 USD, a loss of 1.00 USD
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
steps:
  - event: ad_wallet.deposited
    accounting_date: 2026-11-03
    # the gap: 5,000,000 / 124 = 40,322.58… → 40,323; 40,323 − 40,223 = 100 = 1.00 USD, not more than the tolerance
    payload: { entry: W-1, client: C1, entered_on: 2026-11-03, method: cash,
               currency: SYP, amount: 5000000, syp_per_usd: "124.0000", usd_amount: 40223 }
  - event: ad_wallet.refunded
    accounting_date: 2026-11-19
    # the gap: 2,480,000 / 124 = 20,000; 19,900 − 20,000 = −100 = −1.00 USD, not more than the tolerance
    payload: { entry: W-2, client: C1, entered_on: 2026-11-19, method: cash,
               currency: SYP, amount: 2480000, syp_per_usd: "124.0000", usd_amount: 19900 }
expect:
  entries:
    - source: ad_wallet.deposited
      date: 2026-11-03
      lines:
        # cash in SYP → 111001; parallel: 50,000.00 SYP / 124 (Hub's rate) = 403.2258… → 403.23 USD
        - { account: "111001", currency: SYP, amount: 5000000, book: 5000000, parallel: 40323 }
        # a new running item for C1, measured new by the usd_amount; book: 402.23 USD × 120 = 48,267.60 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -40223, book: -4826760, parallel: -40223 }
        # book residual: 5,000,000 − 4,826,760 = 173,240 → realised gain 1,732.40 SYP
        - { account: "421001", currency: SYP, amount: -173240, book: -173240, parallel: 0 }
        # parallel residual: 40,323 − 40,223 = 100 → realised gain 1.00 USD, the gap within the tolerance
        - { account: "421001", currency: USD, amount: -100, book: 0, parallel: -100 }
    - source: ad_wallet.refunded
      date: 2026-11-19
      lines:
        # against the balance of 402.23 USD carried at 48,267.60 SYP:
        # 4,826,760 × 19,900 / 40,223 = 2,388,000 exactly (the funds are carried at 120)
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 19900, book: 2388000, parallel: 19900 }
        # cash in SYP → 111001; parallel: 24,800.00 SYP / 124 = 200.00 USD; the bulletin of 123 is not read
        - { account: "111001", currency: SYP, amount: -2480000, book: -2480000, parallel: -20000 }
        # book residual: 2,388,000 − 2,480,000 = −92,000 → realised loss 920.00 SYP
        - { account: "541001", currency: SYP, amount: 92000, book: 92000, parallel: 0 }
        # parallel residual: 19,900 − 20,000 = −100 → realised loss 1.00 USD, the gap within the tolerance
        - { account: "541001", currency: USD, amount: 100, book: 0, parallel: 100 }
  balances:
    # 4,826,760 − 2,388,000 = 2,438,760; 40,223 − 19,900 = 20,323
    - { account: "213001", book: -2438760, parallel: -20323 }
    # 5,000,000 − 2,480,000 = 2,520,000; 40,323 − 20,000 = 20,323
    - { account: "111001", book: 2520000, parallel: 20323 }
    - { account: "421001", book: -173240, parallel: -100 }
    - { account: "541001", book: 92000, parallel: 100 }
  open_items:
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: -20323, book: -2438760, parallel: -20323 }
```

One minor unit beyond the tolerance, the deposit is held `NEEDS_DECISION` (`wallet_gap_beyond_tolerance`): whether the client is credited what Hub says or what was paid is the accountant's decision, so nothing posts, and the funds keep what the earlier deposit credited.

```yaml
case: 1,000.00 USD deposited; 50,000.00 SYP at Hub's 124 credited as 402.22 USD, a gap of 1.01 USD, is held NEEDS_DECISION
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-10, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
steps:
  - event: ad_wallet.deposited
    accounting_date: 2026-11-03
    payload: { entry: W-1, client: C1, entered_on: 2026-11-03, method: bank_transfer,
               currency: USD, amount: 100000, syp_per_usd: "122.0000", usd_amount: 100000 }
  - event: ad_wallet.deposited
    accounting_date: 2026-11-10
    # the gap: 5,000,000 / 124 = 40,322.58… → 40,323; 40,323 − 40,222 = 101 = 1.01 USD, more than the tolerance
    payload: { entry: W-2, client: C1, entered_on: 2026-11-10, method: cash,
               currency: SYP, amount: 5000000, syp_per_usd: "124.0000", usd_amount: 40222 }
expect:
  entries:
    - source: ad_wallet.deposited
      date: 2026-11-03
      lines:
        - { account: "111004", currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
  balances:
    - { account: "111001", book: 0, parallel: 0 }
  open_items:
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
  outcome: { status: held, reason: NEEDS_DECISION, detail: wallet_gap_beyond_tolerance }
```

### Vertex Media: a deposit held for a missing bulletin, and a spend waiting behind it

Thursday 19 November is a publication day, so a deposit dated then, received before the day's bulletin is recorded, is held `RATE_MISSING`: no earlier bulletin stands in for it (ADR 0011). The spend received after it on the same client waits behind it (`WAITING_FOR_EARLIER_EVENT`), though the spend reads no rate: it clears the funds at their average, and that average must include the deposit, as in Hub's order. Recording the bulletin retries the deposit; once it leaves `held`, the spend is retried (S05 rules 10, 11). Had the spend posted first, it would have cleared 700.00 USD at 120, 84,000.00 SYP, instead of the 84,700.00 SYP below.

```yaml
case: a deposit held RATE_MISSING and a spend waiting behind it; the bulletin of 123 recorded; both post in order at the average of Hub's order
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - event: ad_wallet.deposited
    accounting_date: 2026-11-03
    payload: { entry: W-1, client: C1, entered_on: 2026-11-03, method: bank_transfer,
               currency: USD, amount: 100000, syp_per_usd: "122.0000", usd_amount: 100000 }
  - event: ad_wallet.deposited
    accounting_date: 2026-11-19
    payload: { entry: W-2, client: C1, entered_on: 2026-11-19, method: bank_transfer,
               currency: USD, amount: 50000, syp_per_usd: "124.0000", usd_amount: 50000 }
    outcome: { status: held, reason: RATE_MISSING }
  - event: ad_spend.recorded
    accounting_date: 2026-11-19
    payload: { update: CU-1, campaign: CMP-1, client: C1, period_from: 2026-11-01,
               period_to: 2026-11-19, usd_spend: 70000 }
    outcome: { status: held, reason: WAITING_FOR_EARLIER_EVENT }
  - rate: { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
expect:
  entries:
    - source: ad_wallet.deposited
      date: 2026-11-03
      lines:
        - { account: "111004", currency: USD, amount: 100000, book: 12000000, parallel: 100000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000, parallel: -100000 }
    - source: ad_wallet.deposited
      date: 2026-11-19
      lines:
        # posted by the retry once the bulletin is recorded; book: 500.00 USD × 123 = 61,500.00 SYP
        # the funds: 1,500.00 USD at 12,000,000 + 6,150,000 = 18,150,000
        - { account: "111004", currency: USD, amount: 50000, book: 6150000, parallel: 50000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -50000, book: -6150000, parallel: -50000 }
    - source: ad_spend.recorded
      date: 2026-11-19
      lines:
        # retried once the deposit leaves held: 18,150,000 × 700 / 1,500 = 8,470,000 exactly
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 70000, book: 8470000, parallel: 70000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -70000, book: -8470000, parallel: -70000 }
  balances:
    # 18,150,000 − 8,470,000 = 9,680,000
    - { account: "213001", book: -9680000, parallel: -80000 }
    - { account: "111004", book: 18150000, parallel: 150000 }
    - { account: "211001", book: -8470000, parallel: -70000 }
  open_items:
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: -80000, book: -9680000, parallel: -80000 }
```

### SYP books only

The SYP deposit's gain and the SYP refund's loss post in the book ledger, the only one. The refund clears all that is left of the funds, so it takes everything they carry.

```yaml
case: SYP books only; 122,000.00 SYP deposited for 1,000.00 USD at 120; 700.00 USD spent; the last 300.00 USD refunded as 37,350.00 SYP
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
steps:
  - event: ad_wallet.deposited
    accounting_date: 2026-11-03
    payload: { entry: W-1, client: C1, entered_on: 2026-11-03, method: cash,
               currency: SYP, amount: 12200000, syp_per_usd: "122.0000", usd_amount: 100000 }
  - event: ad_spend.recorded
    accounting_date: 2026-11-19
    payload: { update: CU-1, campaign: CMP-1, client: C1, period_from: 2026-11-01,
               period_to: 2026-11-19, usd_spend: 70000 }
  - event: ad_wallet.refunded
    accounting_date: 2026-11-25
    payload: { entry: W-2, client: C1, entered_on: 2026-11-25, method: cash,
               currency: SYP, amount: 3735000, syp_per_usd: "124.5000", usd_amount: 30000 }
expect:
  entries:
    - source: ad_wallet.deposited
      date: 2026-11-03
      lines:
        # cash in SYP → 111001; Hub's 122 is not read without a parallel ledger
        - { account: "111001", currency: SYP, amount: 12200000, book: 12200000 }
        # book: 1,000.00 USD × 120 = 120,000.00 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -100000, book: -12000000 }
        # book residual: 12,200,000 − 12,000,000 = 200,000 → realised gain 2,000.00 SYP
        - { account: "421001", currency: SYP, amount: -200000, book: -200000 }
    - source: ad_spend.recorded
      date: 2026-11-19
      lines:
        # 12,000,000 × 700 / 1,000 = 8,400,000
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 70000, book: 8400000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -70000, book: -8400000 }
    - source: ad_wallet.refunded
      date: 2026-11-25
      lines:
        # all 300.00 USD left: everything the funds carry, 12,000,000 − 8,400,000 = 3,600,000
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 30000, book: 3600000 }
        - { account: "111001", currency: SYP, amount: -3735000, book: -3735000 }
        # book residual: 3,600,000 − 3,735,000 = −135,000 → realised loss 1,350.00 SYP
        - { account: "541001", currency: SYP, amount: 135000, book: 135000 }
  balances:
    - { account: "213001", book: 0 }
    # 12,200,000 − 3,735,000 = 8,465,000
    - { account: "111001", book: 8465000 }
    - { account: "211001", book: -8400000 }
    - { account: "421001", book: -200000 }
    - { account: "541001", book: 135000 }
  open_items:
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: 0, book: 0 }
```

The tolerance is checked without a parallel ledger too, where a gap would otherwise vanish into the book residual: the funds are credited by Hub's `usd_amount`, so a gap beyond the tolerance is still the accountant's decision.

```yaml
case: SYP books only; 122,000.00 SYP at Hub's 122 credited as 998.99 USD, a gap of 1.01 USD, is held NEEDS_DECISION
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - event: ad_wallet.deposited
    accounting_date: 2026-11-03
    # the gap: 12,200,000 / 122 = 100,000; 100,000 − 99,899 = 101 = 1.01 USD, more than the tolerance
    payload: { entry: W-1, client: C1, entered_on: 2026-11-03, method: cash,
               currency: SYP, amount: 12200000, syp_per_usd: "122.0000", usd_amount: 99899 }
expect:
  entries: []
  balances:
    - { account: "213001", book: 0 }
    - { account: "111001", book: 0 }
  outcome: { status: held, reason: NEEDS_DECISION, detail: wallet_gap_beyond_tolerance }
```

### USD books with an SYP parallel ledger

The funds are in the book currency, so every difference on them is in the SYP parallel ledger. The SYP deposit is measured in the book ledger at the bulletin, and its 16.67 USD residual is a book gain; the parallel ledger takes Hub's 122 for the cash and the funds alike. The void crosses zero, and the 400.00 USD beyond it is measured in the parallel ledger at the market rate in force on the void date: the void's own `syp_per_usd` is the voided deposit's rate, not a rate dealt on that day (ADR 0013, "the void date's policy rates").

```yaml
case: USD books; 122,000.00 SYP deposited for 1,000.00 USD; 400.00 USD spent; the deposit voided, crossing zero; a parallel gain of 1,200.00 SYP
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "125.0000", type: market }
steps:
  - event: ad_wallet.deposited
    accounting_date: 2026-11-03
    payload: { entry: W-1, client: C1, entered_on: 2026-11-03, method: cash,
               currency: SYP, amount: 12200000, syp_per_usd: "122.0000", usd_amount: 100000 }
  - event: ad_spend.recorded
    accounting_date: 2026-11-19
    payload: { update: CU-1, campaign: CMP-1, client: C1, period_from: 2026-11-01,
               period_to: 2026-11-19, usd_spend: 40000 }
  - event: ad_wallet.entry_voided
    accounting_date: 2026-11-25
    payload: { entry: W-1, voided_on: 2026-11-25 }
expect:
  entries:
    - source: ad_wallet.deposited
      date: 2026-11-03
      lines:
        # cash in SYP → 111001; book: 122,000.00 SYP / 120 (bulletin) = 1,016.6666… → 1,016.67 USD
        - { account: "111001", currency: SYP, amount: 12200000, book: 101667, parallel: 12200000 }
        # book: USD as is; parallel: 1,000.00 USD × 122 (Hub's rate) = 122,000.00 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -100000, book: -100000, parallel: -12200000 }
        # book residual: 101,667 − 100,000 = 1,667 → realised gain 16.67 USD; parallel residual 0
        - { account: "421001", currency: USD, amount: -1667, book: -1667, parallel: 0 }
    - source: ad_spend.recorded
      date: 2026-11-19
      lines:
        # parallel: 12,200,000 × 400 / 1,000 = 4,880,000; the funds: 600.00 USD at 73,200.00 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 40000, book: 40000, parallel: 4880000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -40000, book: -40000, parallel: -4880000 }
    - source: ad_wallet.entry_voided
      date: 2026-11-25
      lines:
        # the exact negation of the 3 November entry; the funds: a 400.00 USD debit at 48,800.00 SYP
        - { account: "111001", currency: SYP, amount: -12200000, book: -101667, parallel: -12200000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 100000, book: 100000, parallel: 12200000 }
        - { account: "421001", currency: USD, amount: 1667, book: 1667, parallel: 0 }
    - source: ad_wallet.entry_voided
      date: 2026-11-25
      lines:
        # as a new movement: clear 600.00 at 7,320,000, then 400.00 × 125 (market) = 5,000,000
        # across zero: the 400.00 USD debit the reversal left, at 4,880,000, cleared to zero
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -40000, book: -40000, parallel: -4880000 }
        # then the 400.00 USD beyond zero measured anew at the 25 November market rate, its rate recorded
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 40000, book: 40000, parallel: 5000000 }
        # parallel residual: 4,880,000 − 5,000,000 = −120,000 → realised gain 1,200.00 SYP
        - { account: "421001", currency: SYP, amount: -120000, book: 0, parallel: -120000 }
  balances:
    - { account: "213001", book: 40000, parallel: 5000000 }
    - { account: "111001", book: 0, parallel: 0 }
    - { account: "211001", book: -40000, parallel: -4880000 }
    - { account: "421001", book: 0, parallel: -120000 }
  open_items:
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: 40000, book: 40000, parallel: 5000000 }
```
