# Open questions

Decisions not yet made. Never guess an answer to one: ask the owner. Each has a recommendation and the point by which it is needed.

A bare `Q<n>` anywhere in the repository is a question of this file. The owner's answers of 2026-10-20 in `docs/product/phase-1-scope.md` §10 have their own numbers, cited as "scope Q<n>" (and "scope A<n>" for the audit's).

## Open

| # | Question | Recommendation | Needed before |
|---|---|---|---|
| Q1 | Does the tax authority accept the policy chosen for Vertex Media (statutory books in SYP at the Central Bank bulletin rate, a parallel USD ledger at the market rate), and do Decrees 5 and 6 of 2024 on foreign-currency dealing affect USD invoicing? (UNVERIFIED) | A Syrian certified auditor's written view | The 2026 tax return (filed in 2027) |
| Q2 | Off-server backups for Mizan's database. Hub keeps backups on the server only for now (Hub ADR 0034), but the ledger must be kept 10 years. | The deployment and backup ADR (point-in-time recovery, encrypted off-server copies, restore drills) is written before the first production deploy (owner, 2026-10-20); an off-server storage subscription is needed then. | The first production deploy |
| Q3 | The chart-of-accounts templates (service agency and general): account codes, Arabic names, statement lines, tax and exchange-difference accounts | Drafted in `docs/specs/S02-chart-dimensions-rates.md` (structure decided, ADR 0011); one or two Syrian accountants review them, and their changes become a new template version (owner, 2026-10-27) | Creating Vertex Media's production company |
| Q4 | Who holds the account for each Hub payment method (cash, bank transfer, e-wallet) per currency at Vertex Media, and which real bank and wallet accounts exist | The owner lists them; one account per method and currency | The opening-balances spec |
| Q5 | Hub's side of the integration (outbox, events, cycle dates on lines, milestone and project events with done dates, optional tax lines, period check, `202 held` handling, reconciliation, replay) is scheduled in Hub's sessions. S05 lists what Hub must add (its "Migration and compatibility"): `due_on`, the line source with `deposit` and the cycle end, a service on every revenue line and a department on every project expense, the applied amount and the invoice's currency on payments, the accounting dates of its rule 13, `rate.changed`, and the `recorded` and `held` answers. S06 adds (its "Migration and compatibility"): the milestone's service and number on `milestone.done`, the new `milestone.reopened`, a credit line's `cycle_start` with its retainer, a deposit line's `milestone_id`, a deferred manual line's service period, and the dates of `project.completed` and `project.cancelled` | Start Hub F18's integration part once Mizan's posting API contract is implemented and tested | Phase 1 integration |
| Q6 | Phase order: the audit proposes cheques and notes, fixed assets and the Al-Ameen import in phase 2, and a pilot with two accounting offices before the phone-shop vertical (audit M8) | Decide when phase 2 is detailed (owner, 2026-10-20) | Phase 2 detailing |
| Q7 | The hosting location and the data-residency statement for customers (the server is abroad) | Decide later (owner, 2026-10-20); the deployment ADR records the location | Phase 4 |
| Q8 | The tax authority's procedure for approving an accounting program and its electronic linkage specification | Open the inquiry with the General Commission for Taxes and Fees during phase 1 | Before any tax posting rule |
| Q10 | The bulletin schedule of a third-currency pair (TRY, EUR), which may be published weekly (S02 rule 16 requires a daily bulletin) | Each bulletin pair carries its schedule (daily, or weekly on a weekday), decided when a company first deals in a third currency | The first company with a third currency |
| Q11 | IFRS 18.B65 classifies exchange differences by the item that caused them, so differences on cash fall in investing for a company without a specified main business activity | S09 splits the exchange-difference line by the monetary item's category when IFRS 18 statements are first produced | IFRS 18 statements (periods from 2027-01-01) |

## Resolved

| # | Question | Answer | Date |
|---|---|---|---|
| — | Phase 1 product questions Q1–Q18 | `docs/product/phase-1-scope.md` §10 | 2026-10-20 |
| — | S01 access questions: two-factor for every role, email invitations and resets, company creation, the settings lock, sessions, the period permission, audited reads, archiving | `docs/specs/S01-companies-people-access.md` (rules 2, 5, 6, 9, 11, 12, 15, 24; the period permission) | 2026-10-26 |
| — | S02 chart, dimension and rate questions: account codes, the lock after use, statements by nature with IFRS 18 categories, separate exchange gain and loss accounts, the four tax accounts, one contract dimension, manual values linked to Hub, the bulletin rate of the day, rate corrections | `docs/specs/S02-chart-dimensions-rates.md`, ADR 0011 | 2026-10-27 |
| Q12 | A new asset or liability restricted to a currency starts with "monetary" off | The account sheet turns "monetary" on when an asset or liability is restricted to a currency; the accountant can still turn it off (S02 PR 3) | 2026-10-27 |
| Q9 | Which roles maintain the posting-rule account mapping | Owner and accountant (`posting_rules.manage`), every change audited with before and after (`docs/specs/S05-posting-api-event-inbox.md`) | 2026-11-07 |
| Q13 | An `ad_spend.changed` whose spend had taken the client's funds across zero: whether a difference entry follows the change's reversal | Within a `.changed`, the reversal and the new state are one change: while the spend is still the latest movement on the client's funds, no difference entry follows the reversal, and the new state is measured at its `period_to`, so a same-amount change nets to zero (S05 edge case 14); after another movement, and on a void or an archive, S04 rule 13's difference entry follows. Five cases in `ad-funds/running-balance.md`, their numbers approved by the owner | 2026-11-09 |
