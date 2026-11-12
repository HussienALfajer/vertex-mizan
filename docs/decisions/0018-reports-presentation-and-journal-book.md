# 0018 — Reports: presentation from the ledger, the journal book's pages, the service's dated department

Status: Accepted (owner, 2026-11-12, with S09) · Date: 2026-11-12 · Refines [0007](0007-book-and-parallel-currency-ledgers.md) ("Reporting") and [0008](0008-foundation-audit-amendments.md) (journal order, period balances)

## Context
S09 (`docs/specs/S09-reports.md`) brings the trial balance, the statements, profitability and the printed journal book (F13). The ledger stays as it is: reports read the period balances and the lines (ADR 0008). Four choices shape what every statement and printed book shows:
- phase 1 has no year-end close, so the balance sheet needs the year's result without a closing entry;
- ADR 0007 nets contract positions per contract and presents a client's debit ad funds as a receivable, but says nothing of other control accounts;
- the Commercial Code requires a numbered chronological journal in Arabic (arts. 16–19, REPORTED), and a printed page number must not depend on what range was printed;
- revenue lines carry no department (S05), so profitability by department needs the service's department, which can change in Hub.

## Decision
- **Presentation never posts.** Statements are computed from the ledger accounts, which stay gross; every reclassification is shown with its amount and drill-down.
- **The year's result** (owner, 2026-11-12): equity shows "ربح (خسارة) السنة الحالية", the net of revenue and expenses from the start of the fiscal year to the balance sheet's date; earlier years not yet closed by a year-end entry (phase 2) are presented in retained earnings, with a note. Basis: IAS 1.54(r), 1.106(d).
- **No offsetting between counterparties on any control account** (owner, 2026-11-12; extends ADR 0007): after contract positions are netted per contract (IFRS 15.105), each control account is read per client, and a client's balance on the side opposite to the account's line is presented on the other side (receivables in credit as payables, client funds in debit as receivables). Basis: IAS 1.32.
- **The income statement by nature with IFRS 18's subtotals** (owner, 2026-11-12): operating profit, profit before financing and income taxes when an investing line has an amount, profit before tax, profit for the period, ordered by the IFRS 18 category the statement-line catalogue already carries (ADR 0011), so 2027 adds and never reorders.
- **Profitability is a direct contribution margin** (owner, 2026-11-12): revenue less direct costs carrying the dimension, with no allocation of overheads and nothing else of the income statement; unassigned amounts are shown, so totals equal the income statement.
- **The journal book is paginated by Mizan through the fiscal year** (owner, 2026-11-12): fixed rows per page, text split at fixed widths, pages numbered from 1 at the year's first entry, so a month printed alone has the pages it has in the year. Only closed months print officially; each official print is registered append-only with its pages, totals and hashes, and is marked superseded when a month of its range is reopened. Open months and the parallel ledger print as drafts.
- **A service's department is dated** (owner, 2026-11-12): kept as an append-only history effective from a date, sent by Hub on the service reference (an additive `/v1` field, ADR 0006) or set by the accountant for manual services; a revenue line takes the department in force on its accounting date; a change never takes effect inside a closed month.
- **Any date can be reported** (owner, 2026-11-12): reports covering an open month, or ending on a date without a current revaluation, carry a mark saying so, on screen and in every export.

## Consequences
- The balance sheet balances without any posting, and phase 2's year-end close entry will move the computed amounts into retained earnings without changing a presented figure.
- The statement-presentation rules are tested as a scenario (`docs/scenarios/reports/statement-presentation.md`), so the scenario runner gains a report expectation.
- Reprinting a closed range reproduces the same pages and content hash; a reopen of the latest closed month requires a new official print of that month after its re-close.
- Hub must send the department on its service reference (Q5); until then revenue by department is unassigned.
- A non-control account on its opposite side (an overdraft) is presented negative until a statement line exists for it (Q17).
