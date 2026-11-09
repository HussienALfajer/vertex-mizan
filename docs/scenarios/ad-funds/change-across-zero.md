# An ad spend changed across zero: the change as one movement

Status: Proposed

Q13 (`docs/open-questions.md`; the owner approved the recommendation on 2026-11-09). The expected entries below await the owner's approval; once approved they join `ad-funds/running-balance.md` with the code that posts them, in S05 PR 3. No expected value of `ad-funds/running-balance.md` changes: its one change case runs with the funds' balance, where no difference entry followed already.

## Rule

Within an `ad_spend.changed`, the reversal of the standing spend and the new state are one change: no difference entry follows the reversal, even across zero, so the new state moves the client's funds exactly as the reversal left them and measures its excess beyond zero at each ledger's policy rate of its own `period_to`. A spend re-sent with the same amount and period then nets to zero in both ledgers. A void or an archive is no change: when its reversal runs against the funds' balance or across zero, S04 rule 13's difference entry follows it.

## Basis

- **IAS 21.21–22:** the new state is a transaction of its own date, `period_to`, measured at that date's spot rate; a change of its description changes no amount.
- **IAS 21.28:** a rate's movement on the funds after that date is an exchange difference when the funds are settled or revalued, never a cost of the spend; so the change does not realise one.
- **IAS 8.36:** a change in Hub is prospective; months already closed are never touched (S05 rule 13).
- **Company policy:** S05 rule 13 and edge case 14; S04 rule 13 for a void or an archive (owner, 2026-11-06); `ad-funds/running-balance.md` for the funds' running balance, its accounts and its rates.

## Cases

The accounts, client and campaign are those of `ad-funds/running-balance.md`. Tuesday 3, Thursday 19, Wednesday 25 and Thursday 26 November 2026 are publication days. Every rate and amount is synthetic.

### Vertex Media: a spend across zero re-sent unchanged, then archived

Q13 (owner, 2026-11-09): within an `ad_spend.changed`, the reversal of the standing spend and the new state are one change. The reversal posts alone, with no difference entry after it, though it crosses zero back, so the new state moves the funds exactly as the reversal left them and measures its excess beyond zero at the bulletin of its own `period_to` (S05 rule 13). A spend re-sent with the same amount and period, a description changed in Hub, then nets to zero in both ledgers (S05 edge case 14). The archive is no change: its reversal crosses zero and S04 rule 13's difference entry follows it, measuring the 300.00 USD the client's funds hold again at the archive date's bulletin of 124, a realised loss of 1,200.00 SYP.

```yaml
case: 300.00 USD deposited at 120; 450.00 USD spent at 123, crossing zero; the spend re-sent unchanged at 123.5, netting to zero; then archived at 124 with its difference entry
company: { shape: syp-usd, book: SYP, parallel: USD, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
  - { date: 2026-11-26, base: USD, quote: SYP, rate: "124.0000", type: bulletin }
steps:
  - event: ad_wallet.deposited
    accounting_date: 2026-11-03
    payload: { entry: W-1, client: C1, entered_on: 2026-11-03, method: bank_transfer,
               currency: USD, amount: 30000, syp_per_usd: "122.0000", usd_amount: 30000 }
  - event: ad_spend.recorded
    accounting_date: 2026-11-19
    payload: { update: CU-1, campaign: CMP-1, client: C1, period_from: 2026-11-01,
               period_to: 2026-11-19, usd_spend: 45000 }
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
        # book: 300.00 USD × 120 = 36,000.00 SYP
        - { account: "111004", currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: ad_spend.recorded
      date: 2026-11-19
      lines:
        # the split at zero: the whole 300.00 USD credit, cleared at what it carries
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        # then the 150.00 USD beyond zero, a new measurement: 150.00 × 123 = 18,450.00 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 15000, book: 1845000, parallel: 15000 }
        # the payable carries both: 3,600,000 + 1,845,000 = 5,445,000
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -45000, book: -5445000, parallel: -45000 }
    - source: ad_spend.changed
      date: 2026-11-25
      lines:
        # the exact negation of the 19 November entry; the funds back to a 300.00 USD credit at 36,000.00 SYP
        # it crosses zero back, but within a change no difference entry follows it (Q13)
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -15000, book: -1845000, parallel: -15000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: 45000, book: 5445000, parallel: 45000 }
    - source: ad_spend.changed
      date: 2026-11-25
      lines:
        # the new state against the 300.00 USD credit at 36,000.00 SYP: cleared whole at what it carries
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        # the 150.00 USD beyond zero at the bulletin of period_to, 19 November: 150.00 × 123 = 18,450.00 SYP, not 123.5
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 15000, book: 1845000, parallel: 15000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -45000, book: -5445000, parallel: -45000 }
    - source: ad_spend.archived
      date: 2026-11-26
      lines:
        # the exact negation of the 25 November spend; the funds: a 300.00 USD credit at 36,000.00 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -15000, book: -1845000, parallel: -15000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: 45000, book: 5445000, parallel: 45000 }
    - source: ad_spend.archived
      date: 2026-11-26
      lines:
        # as a new movement: clear the 150.00 USD debit at 1,845,000, then 300.00 × 124 = 3,720,000 → a credit of 3,720,000
        # across zero: the 300.00 USD credit the reversal left, at 3,600,000, cleared to zero
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        # then the 300.00 USD beyond zero measured anew at the 26 November bulletin, its rate recorded
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -30000, book: -3720000, parallel: -30000 }
        # book residual: 3,600,000 − 3,720,000 = −120,000 → realised loss 1,200.00 SYP
        - { account: "541001", currency: SYP, amount: 120000, book: 120000, parallel: 0 }
  balances:
    - { account: "213001", book: -3720000, parallel: -30000 }
    - { account: "111004", book: 3600000, parallel: 30000 }
    - { account: "211001", book: 0, parallel: 0 }
    - { account: "541001", book: 120000, parallel: 0 }
  open_items:
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: -30000, book: -3720000, parallel: -30000 }
```

### Vertex Media: a spend across zero changed to an amount the funds cover

The change's reversal puts the funds back to the 300.00 USD credit at 36,000.00 SYP, with no difference entry (Q13), and the new 250.00 USD spend runs against that credit: it clears 250.00 USD at the average and leaves 50.00 USD of funds. No rate of the change's date is read, and nothing is realised.

```yaml
case: 300.00 USD deposited at 120; 450.00 USD spent at 123, crossing zero; changed at 123.5 to 250.00 USD, within the funds
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
  - event: ad_spend.changed
    accounting_date: 2026-11-25
    payload: { update: CU-1, campaign: CMP-1, client: C1, period_from: 2026-11-01,
               period_to: 2026-11-19, usd_spend: 25000 }
expect:
  entries:
    - source: ad_wallet.deposited
      date: 2026-11-03
      lines:
        - { account: "111004", currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
    - source: ad_spend.recorded
      date: 2026-11-19
      lines:
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 30000, book: 3600000, parallel: 30000 }
        # 150.00 × 123 = 18,450.00 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 15000, book: 1845000, parallel: 15000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -45000, book: -5445000, parallel: -45000 }
    - source: ad_spend.changed
      date: 2026-11-25
      lines:
        # the exact negation of the 19 November entry; no difference entry within a change (Q13)
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -30000, book: -3600000, parallel: -30000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -15000, book: -1845000, parallel: -15000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: 45000, book: 5445000, parallel: 45000 }
    - source: ad_spend.changed
      date: 2026-11-25
      lines:
        # the new state against 300.00 USD at 36,000.00 SYP: 3,600,000 × 250 / 300 = 3,000,000 exactly
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 25000, book: 3000000, parallel: 25000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -25000, book: -3000000, parallel: -25000 }
  balances:
    # 3,600,000 − 3,000,000 = 600,000: 50.00 USD of funds at 120
    - { account: "213001", book: -600000, parallel: -5000 }
    - { account: "111004", book: 3600000, parallel: 30000 }
    - { account: "211001", book: -3000000, parallel: -25000 }
  open_items:
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: -5000, book: -600000, parallel: -5000 }
```

### SYP books only: a spend across zero re-sent unchanged

Q13 in the book ledger alone: the change's reversal posts with no difference entry, and the new state measures its excess at the bulletin of `period_to`, so a spend re-sent with the same amount nets to zero.

```yaml
case: SYP books only; 300.00 USD deposited at 120; 450.00 USD spent at 123, crossing zero; re-sent unchanged at 123.5, netting to zero
company: { shape: syp, book: SYP, template: service-agency, rate_policy: { book: bulletin } }
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
  - event: ad_spend.changed
    accounting_date: 2026-11-25
    payload: { update: CU-1, campaign: CMP-1, client: C1, period_from: 2026-11-01,
               period_to: 2026-11-19, usd_spend: 45000 }
expect:
  entries:
    - source: ad_wallet.deposited
      date: 2026-11-03
      lines:
        # book: 300.00 USD × 120 = 36,000.00 SYP; Hub's 122 is not read without a parallel ledger
        - { account: "111004", currency: USD, amount: 30000, book: 3600000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -30000, book: -3600000 }
    - source: ad_spend.recorded
      date: 2026-11-19
      lines:
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 30000, book: 3600000 }
        # 150.00 × 123 = 18,450.00 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 15000, book: 1845000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -45000, book: -5445000 }
    - source: ad_spend.changed
      date: 2026-11-25
      lines:
        # the exact negation; no difference entry within a change (Q13)
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -30000, book: -3600000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -15000, book: -1845000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: 45000, book: 5445000 }
    - source: ad_spend.changed
      date: 2026-11-25
      lines:
        # the new state: the excess at the bulletin of period_to, 19 November, not 123.5
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 30000, book: 3600000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 15000, book: 1845000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -45000, book: -5445000 }
  balances:
    - { account: "213001", book: 1845000 }
    - { account: "111004", book: 3600000 }
    - { account: "211001", book: -5445000 }
  open_items:
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: 15000, book: 1845000 }
```

### USD books with an SYP parallel ledger: a spend across zero re-sent unchanged

The funds are in the book currency, so the change only moves the SYP parallel ledger: its reversal posts with no difference entry, and the new state measures the 150.00 USD beyond zero at the market rate in force on `period_to`, 124 on 19 November, not the 125 of the change's date. The change nets to zero in both ledgers.

```yaml
case: USD books; 300.00 USD deposited at Hub's 122; 450.00 USD spent, the excess at the 19 November market rate of 124; re-sent unchanged on 25 November, netting to zero
company: { shape: usd-syp, book: USD, parallel: SYP, template: service-agency,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true } }
rates:
  - { date: 2026-11-03, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "123.0000", type: bulletin }
  - { date: 2026-11-19, base: USD, quote: SYP, rate: "124.0000", type: market }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "123.5000", type: bulletin }
  - { date: 2026-11-25, base: USD, quote: SYP, rate: "125.0000", type: market }
steps:
  - event: ad_wallet.deposited
    accounting_date: 2026-11-03
    payload: { entry: W-1, client: C1, entered_on: 2026-11-03, method: bank_transfer,
               currency: USD, amount: 30000, syp_per_usd: "122.0000", usd_amount: 30000 }
  - event: ad_spend.recorded
    accounting_date: 2026-11-19
    payload: { update: CU-1, campaign: CMP-1, client: C1, period_from: 2026-11-01,
               period_to: 2026-11-19, usd_spend: 45000 }
  - event: ad_spend.changed
    accounting_date: 2026-11-25
    payload: { update: CU-1, campaign: CMP-1, client: C1, period_from: 2026-11-01,
               period_to: 2026-11-19, usd_spend: 45000 }
expect:
  entries:
    - source: ad_wallet.deposited
      date: 2026-11-03
      lines:
        # book: USD as is; parallel: 300.00 USD × 122 (Hub's rate, accepted) = 36,600.00 SYP
        - { account: "111004", currency: USD, amount: 30000, book: 30000, parallel: 3660000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -30000, book: -30000, parallel: -3660000 }
    - source: ad_spend.recorded
      date: 2026-11-19
      lines:
        # the whole 300.00 USD credit at what it carries in the parallel ledger
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 30000, book: 30000, parallel: 3660000 }
        # the 150.00 USD beyond zero: parallel 150.00 × 124 (the 19 November market rate) = 18,600.00 SYP
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 15000, book: 15000, parallel: 1860000 }
        # the payable carries both: 3,660,000 + 1,860,000 = 5,520,000
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -45000, book: -45000, parallel: -5520000 }
    - source: ad_spend.changed
      date: 2026-11-25
      lines:
        # the exact negation; no difference entry within a change (Q13)
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -30000, book: -30000, parallel: -3660000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: -15000, book: -15000, parallel: -1860000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: 45000, book: 45000, parallel: 5520000 }
    - source: ad_spend.changed
      date: 2026-11-25
      lines:
        # the new state: the excess at the market rate of period_to, 124, not the 125 of 25 November
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 30000, book: 30000, parallel: 3660000 }
        - { account: "213001", dims: { client: C1 }, currency: USD, amount: 15000, book: 15000, parallel: 1860000 }
        - { account: "211001", dims: { client: C1 }, currency: USD, amount: -45000, book: -45000, parallel: -5520000 }
  balances:
    - { account: "213001", book: 15000, parallel: 1860000 }
    - { account: "111004", book: 30000, parallel: 3660000 }
    - { account: "211001", book: -45000, parallel: -5520000 }
  open_items:
    - { item: C1, account: "213001", dims: { client: C1 }, currency: USD, amount: 15000, book: 15000, parallel: 1860000 }
```
