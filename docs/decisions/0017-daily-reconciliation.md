# 0017 — Daily reconciliation: a per-event report by accounting date, the latest report counts, no acceptance

Status: Superseded by [0021](0021-stand-alone-without-hub.md) (owner, 2026-11-13; was Accepted (owner, 2026-11-12, with S08)) · Date: 2026-11-12 (owner's answers in the S08 interview) · Amends [0006](0006-hub-posting-api-contract.md) ("Daily reconciliation")

## Context
ADR 0006 has Hub send, for one date, the count of events and the totals per type and currency, and Mizan compare them with what it received and posted, with `GET /v1/events?date=` for Hub to find what is missing; the pre-close checklist requires every day of the month reconciled. F11 asks Mizan to list every difference down to the event. S08 (`docs/specs/S08-daily-reconciliation.md`) needed to settle:
- which date places an event in a day;
- whether counts and totals alone can name a missing event;
- which differences make a day fail the close, and whether anyone can accept one;
- which days need a report.

## Decision
- **By accounting date:** a report covers the events whose `accounting_date` is its date, the date the entry is dated. A past-dated event makes Hub send that date's report again; for a client and a date, the report with the latest `generated_at` counts, and earlier ones are kept.
- **The report lists the events:** each event of the date with its id, type, amount and currency (one definition of an event's amount, in `packages/contracts`) and Hub's delivery state, with the counts and totals per type and currency of ADR 0006, which must equal the list. Mizan names an event it never received.
- **A day is clean** when its latest report arrived and every event is in both systems with the same date, type and amount. Held events are shown and fail only the checklist's `no_held_events`; events resolved by a manual entry or dismissed, and manual movements on Hub items (ADR 0013, 0014), are shown as explained. An event Mizan refused at receipt stays a gap until Hub replaces it.
- **Every day from the client's start date** needs its report, a day with no events included. The start date (`reconcile_from`, for Vertex Media 2026-10-01 since ADR 0019) is set by the owner, never cleared, and moves later only while the months it would release are open.
- **No acceptance:** no one marks a day reconciled; a difference clears only through data (ADR 0016: no checklist override).
- **Events, not balances:** Hub's open invoices and wallet balances are not compared; opening balances are compared in S10.

## Consequences
- Hub's outbox keeps each event's accounting date and delivery state and sends a report for every date, empty ones included (Q5).
- The close of a month with a Hub client cannot pass until Hub's reports for each of its days agree with Mizan; a Hub defect blocks the close until Hub is fixed.
- The comparison is computed on read, so a late event or a later report changes a day's state without a job.
