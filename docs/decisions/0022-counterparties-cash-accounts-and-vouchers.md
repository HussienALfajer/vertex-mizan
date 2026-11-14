# 0022 — Counterparties, cash accounts and vouchers

Status: Accepted (owner, 2026-11-14, in the S11 interview) · Date: 2026-11-14 · Amends [0013](0013-open-items-and-settlements.md) (an item's counterparty) and [0008](0008-foundation-audit-amendments.md) (a second, per-kind numbering beside the journal's) · Spec: `docs/specs/S11-contracting-chart-cash.md`

## Context
S04 (ADR 0013) keys every open item by a client: a running item is per account, client and currency, and the client statement reads the client dimension. The contracting client (ADR 0021) keeps balances of suppliers, subcontractors, workers and craftsmen too, each a running balance per counterparty, and needs them apart from clients in pickers and in profitability by client.

The client also moves cash between boxes in USD, TRY and SYP, exchanges currencies at money changers, and signs a paper voucher for each movement. Mizan has cash accounts only as ordinary accounts, no voucher, and nothing that stops a box from going negative.

## Decision
1. **Counterparty types.** Two built-in dimension types join `client`: `supplier` (suppliers and subcontractors) and `worker` (workers and craftsmen). A control account names its counterparty type (`client` · `supplier` · `worker`), requires that dimension, and keeps it after first use. An open item's counterparty is a value of that type (`open_items.counterparty_value_id`, renamed from `client_value_id`); S04's rules read "client" as "the account's counterparty". A new type is appended, never renamed.
2. **Cash accounts.** A postable, monetary asset account under `111` restricted to one currency may be marked a `box` or a `bank`, locked after first use. A box never goes below zero at any date: the posting function refuses an entry, of any source, that would make it so, under a per-box lock after the head lock. Banks are not checked (an overdraft is a borrowing).
3. **Vouchers.** A receipt, payment, transfer (an exchange when the currencies differ) or cash count is a manual entry prepared as a voucher draft, with S03's approval and posting. At posting the function gives it the next number of its kind and fiscal year, gapless, in the same transaction, and writes an append-only voucher row. The journal's numbering (ADR 0008) is unchanged; the voucher number is not part of the entry hash. A voucher is cancelled by reversing its entry, and keeps its number.
4. **No new measurement.** A voucher's lines are measured by S03, S04 and S07. A currency exchange is measured at the rate derived from its two amounts, used only by a ledger that accepts dealt rates; each ledger's residual is a realised difference (IAS 21.28).

## Consequences
- S02 gains the two built-in types and the account fields; S04's endpoints and screens serve any counterparty; S03's drafts gain the voucher header; S09's account statement shows the voucher.
- Every existing company gets the two types; every existing control account gets the type `client`.
- A cashier role limited to assigned boxes is left for phase 2.
- The application of advances at their carrying amount (IFRIC 22) is S12's posting rule.
