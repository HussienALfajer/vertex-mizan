# 0015 — Revenue recognition: schedules and movements, releases per invoice and month, deposits with their milestone

Status: Superseded by [0021](0021-stand-alone-without-hub.md) (owner, 2026-11-13; was Accepted (owner, 2026-11-10, with S06)) · Date: 2026-11-10 (owner's answers in the S06 interview) · Amends `docs/product/phase-1-scope.md` §6 ("Project deposit")

## Context
S06 (`docs/specs/S06-revenue-recognition.md`) recognises Hub's deferred revenue under IFRS 15. The phase 1 scope fixes the patterns (retainer cycles evenly over their days, milestones on their done dates, releases at the amounts booked at issue), but leaves open:
- where the amounts still to recognise are kept, since contract liabilities (`212001`) are not a control account and are never revalued;
- how release entries are grouped, which decides whether a void can reverse them exactly;
- how a deposit is recognised, now that Hub's code shows a deposit is not a separate amount but the first milestone's installment, billed at quote acceptance (Hub F13 rule 2);
- what a void and a later re-issue do to revenue already recognised;
- how Hub tells Mizan that a done milestone was reopened.

## Decision
- **Schedules and movements.** Each deferred invoice line has one append-only `recognition_schedules` row (its pattern, period or milestone, dimensions and the liability account it was deferred to) and append-only `recognition_movements` (deferred, elapsed, released, credited, reclassified, reversed, remainder released or refunded), each linked to its entry, in transaction, book and parallel amounts. What remains is their sum in each ledger. They are written only in the posting transaction, beside `post()`'s entries, and the integrity check proves they equal the contract-liability lines of the rules. This mirrors open items and their movements (ADR 0013) without making `212001` a control account.
- **One release entry per invoice and month** (owner, 2026-11-10), dated on the month's last day, posted by a job on the first day of the next month, carrying the schedules' amounts (ADR 0007). A void then reverses an invoice's releases exactly (ADR 0005, 0012), and each invoice's revenue can be traced month by month. An invoice posted after its month's job releases the ended months in its own transaction.
- **A deposit follows its milestone** (owner, 2026-11-10; amends scope §6, which released a deposit in proportion to the other milestones): any milestone invoiced before it is done, the deposit included, is a contract liability until its done date, then revenue at its carried amounts; a milestone done before its invoice is a contract asset (IFRS 15.106, 15.107, 15.B15). The project's revenue then follows the milestones' own amounts, and the deposit milestone's work is recognised when it is delivered.
- **Voids take revenue back on their date; a re-issue recognises it on its own** (owner, 2026-11-10): a void reverses every entry of the invoice on the void date (IFRS 15.88), so closed months keep their figures. A later invoice for the same cycle or milestone recognises what the void took back on the re-issue's date and defers the rest, so no month is recognised twice.
- **`milestone.reopened`** (owner, 2026-11-10): a new event type in `/v1` (additive, ADR 0006) that reverses the done entry. A second done while the first stands is held for the accountant.
- **Late parts and cancelled remainders are the accountant's** (owner, 2026-11-10): an invoice whose elapsed months are closed is held `SERVICE_PERIOD_CLOSED`, and the accountant can recognise those parts in the first open period, measured at their own months' rates. A cancelled project's remainder is held, and the accountant splits it between revenue and a refund payable through a dedicated action, since a manual entry would remeasure the non-monetary liability at the day's rate.

## Consequences
- S05's hold `NO_MAPPING` (`deferred_revenue`) disappears once S06 deploys: the worker's start retries those events, and they post in Hub's order.
- Releases need no rate, so a missing bulletin never delays the close's release item; elapsed months, milestones done before their invoice and refund payables read the policy rates of their own dates.
- `inbound_events` gains further order keys, so a milestone's done waits behind its held invoice and a project's end behind its held events.
- Hub must add the milestone's service on `milestone.done` and the `milestone.reopened` event (open question Q5).
- The scenario book gains five revenue scenarios, and `revenue/revenue-at-issue.md`'s held-retainer case changes with the owner's approval.
