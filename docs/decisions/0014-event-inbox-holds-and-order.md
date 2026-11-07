# 0014 — The event inbox: outcomes, order per item, the accountant's actions and the dates of changes

Status: Accepted (owner, 2026-11-07, with S05) · Date: 2026-11-07 (owner's answers in the S05 interview) · Amends [0006](0006-hub-posting-api-contract.md) and [0008](0008-foundation-audit-amendments.md)

## Context
S05 (`docs/specs/S05-posting-api-event-inbox.md`) builds `POST /v1/events` and the event inbox. ADR 0006 and 0008 fix the envelope, the idempotency and the hold reasons, but leave open:
- what answers an event that changes data without posting;
- what happens when an event is held and a later event touches the same item;
- what the accountant may do with a held event besides fixing its cause;
- which date the entries of a void, an edit or an archive take;
- what happens to events whose rules belong to a later spec.

Hub's code (read 2026-11-07) also shows that Hub stores no rate history, sends only SYP and USD, keeps no department on invoice lines or project expenses, refuses an overpayment and refuses the void of an invoice with payments.

## Decision
- **Outcomes** (amends ADR 0006 "Responses"): `201 posted` with the entries; **`201 recorded`** with no entries for an event that changes data only (a due date, a rate, a rename); `202 held` with the reason and a **`detail`** code that says exactly what is missing; refusals that store nothing stay `4xx` (ADR 0008). A replay answers the event's current state.
- **Hold reasons** (amends ADR 0008): the list gains `OPEN_ITEM_HAS_SETTLEMENTS` (ADR 0013) and **`WAITING_FOR_EARLIER_EVENT`**. The reasons form an append-only enum in `packages/contracts`, guarded like the error codes.
- **Order per item** (owner, 2026-11-07): each event has an item key: the invoice for invoice and payment events, the client's ad funds for wallet and spend events, the document otherwise. An event whose item has an earlier held event is held `WAITING_FOR_EARLIER_EVENT`, and posts after it in Hub's order. A running item's average and a receivable's realised differences then never depend on when a rate was recorded (ADR 0007).
- **Automatic retries:** the commit that fixes a reason (a rate recorded, a mapping set, a reference arrived, a payment void posted, an earlier event resolved, a period reopened, a deploy) queues a retry of the events it frees. A daily sweep retries the rest except `NEEDS_DECISION` and `PERIOD_CLOSED`. Retries are idempotent through the event's posting requests.
- **The accountant's actions** (owner, 2026-11-07):
  - **retry** any held event;
  - **post in the next open period** an event held `PERIOD_CLOSED`, on the first day of the first open period after its date, with a reason (phase 1 scope F10);
  - **resolve by a manual entry** an event held `NEEDS_DECISION`, linking the posted manual entry that handled it;
  - **dismiss**, by the owner only, with a reason: the event never posts.

  After a resolution or a dismissal, later events on that document are held `NEEDS_DECISION`, because Mizan no longer follows Hub for it. The daily reconciliation (S08) lists both.
- **Dates of changes** (owner, 2026-11-07): a void, a `.changed` (the reversal and the new state) and an `.archived` are dated on the change date that Hub sends as the accounting date. A closed month is never touched, and a change shows in the month it was made (IAS 8.36). The original posting is dated on the document's date (an expense's `spent_on`, a spend update's `period_to`).
- **Rules of later specs** (owner, 2026-11-07): every event of the catalogue is accepted and kept now. An event whose rule belongs to a later spec (S06's deferred revenue), or that carries a non-zero tax line, is held `NO_MAPPING` whole and retried when its rule deploys. One invoice is never split between specs.
- **Required dimensions from Hub** (owner, 2026-11-07): revenue lines carry a service and project expenses a department; an event without them is refused (`422`). Hub must add them (open question Q5).
- **API keys** (owner, 2026-11-07): the owner manages them after a fresh two-factor code. A key is shown once and stored as a hash. A client has at most two active keys. Keys do not expire, and each client may have an IP allow-list. Clients and keys are platform tables scoped by `scope_company_id` (ADR 0003), since the key is read before any company context exists.

## Consequences
- Hub handles `recorded`, the `detail` code and the two new reasons before its first call. All of them are additive within `/v1`, and Hub accepts unknown values (ADR 0006).
- One held event can hold a client's whole ad funds until it is fixed. The daily email and the inbox counter make it visible, and the pre-close checklist (S07) refuses a close while events dated in the month are held.
- The scenario book expresses holds on any step and the inbox actions, so each rule above is tested through the real posting function.
- S06 implements its rules on this inbox; at its deploy, the events held for it post in Hub's order.
