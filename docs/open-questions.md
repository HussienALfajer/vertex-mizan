# Open questions

Decisions not yet made. Never guess an answer to one: ask the owner. Each has a recommendation and the point by which it is needed.

## Open

| # | Question | Recommendation | Needed before |
|---|---|---|---|
| Q1 | Are books kept in USD (functional currency) with an SYP view accepted by Syrian law and the tax authority, and which SYP translation does the tax return need (line-level historical amounts, or IAS 21.39 at closing rate)? (UNVERIFIED, `market-syria.md` §9 item 12) | Ask a Syrian certified auditor. Mizan stores both possibilities. | The 2026 tax return (filed in 2027) |
| Q2 | Off-server backups for Mizan's database. Hub keeps backups on the server only for now (Hub ADR 0034), but the ledger must be kept 10 years. | Subscribe to off-server storage and test a restore before Vertex Media's books go live. | Phase 1 production |
| Q3 | The service-agency chart-of-accounts template: account codes, names and statement lines for Vertex Media | Draft it in the chart spec, from the phase 1 scope's accounts, and approve it with the owner | The chart-of-accounts spec |
| Q4 | Who holds the account for each Hub payment method (cash, bank transfer, e-wallet) per currency at Vertex Media, and which real bank and wallet accounts exist | The owner lists them; one account per method and currency | The opening-balances spec |
| Q5 | Hub's side of the integration (outbox, events, cycle dates on lines, milestone and project events, period check, reconciliation, replay) is scheduled in Hub's sessions | Start Hub F18's integration part once Mizan's posting API contract is implemented and tested | Phase 1 integration |

## Resolved

| # | Question | Answer | Date |
|---|---|---|---|
| — | Phase 1 product questions Q1–Q18 | `docs/product/phase-1-scope.md` §10 | 2026-10-20 |
