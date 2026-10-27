# 0006 — The posting API contract with Vertex Hub: versioned events, exactly once, closed periods, daily reconciliation

Status: Accepted, amended by [0008](0008-foundation-audit-amendments.md) (every hold is `202`, hold reasons, optional tax lines, milestone revenue date) · Date: 2026-10-20

## Context
Hub is the operational system and Mizan the ledger (ADR 0001, Hub ADR 0035). Hub writes each financial event to an outbox in the change's transaction, and its worker delivers it. Mizan may be down, Hub may resend, events may arrive out of order, and a period may close between Hub's check and the delivery. Mizan owns the accounting: Hub sends business events, and Mizan's posting rules turn them into entries (phase 1 scope, Q5). The same contract shape will later serve Vertex Food, Vertex Shifa and third parties.

## Decision

### Transport and authentication
- HTTPS JSON under **`/v1`** at `https://mizan.vertexmedia.pro/api/v1`.
- **API client keys:**
  - each key belongs to one company and holds scopes (ADR 0003);
  - it is sent as `Authorization: Bearer <key>`;
  - only its hash is stored;
  - it is shown once at creation;
  - two keys can be active during a rotation;
  - the date each key was last used is recorded.
- **The company comes from the key,** never from the payload.
- Request size limits and a rate limit per client. Every response carries a request ID.

### Events
- **`POST /v1/events`** accepts one event in an envelope:
  - `id`: Hub's event ID (UUIDv7); it is also the **`Idempotency-Key`** header;
  - `type` (for example `invoice.issued`) and `version` (an integer per type);
  - `occurred_at`: when it happened in Hub;
  - `accounting_date`: the date the entry is dated;
  - `payload`: typed per `type` and `version`.

  The contracts are Zod schemas in `packages/contracts`, published in the OpenAPI document as a discriminated union and exportable as JSON Schema for Hub.
- **Exactly once:**
  - the same key with the same payload returns the first result;
  - the same key with a different payload returns `409 IDEMPOTENCY_CONFLICT`;
  - payloads are compared by a hash of their canonical form.
- **Responses:**

  | Result | HTTP | Body |
  |---|---|---|
  | Posted | `201` | `status: posted`, the entry IDs and numbers |
  | Held: no mapping, unknown reference, needs the accountant's decision | `202` | `status: held`, a reason code, the inbox ID |
  | Dated inside a closed period | `409` `PERIOD_CLOSED` | The event is **kept in Mizan's inbox as held**; Hub stops retrying and shows it as held |
  | Invalid payload | `422` with field errors | Nothing is stored; Hub must fix it |
  | Document type owned by another source | `409` `SOURCE_NOT_ALLOWED` | Nothing is stored |
  | Unauthorised / forbidden | `401` / `403` | — |
  | Mizan unavailable | `5xx` or timeout | Hub retries with backoff; the key makes retries safe |
- **Order:** Hub delivers in outbox order per company. If a reference is missing (a payment for an invoice not yet received), Mizan holds the event with `UNKNOWN_REFERENCE` and retries it automatically when the reference arrives.
- **Dimensions travel with each event:** `{ type, external_id, code, name }` for client, project or retainer, department (by its fixed code) and service. Mizan creates the value on first sight and renames it when a newer name arrives.

### Event catalogue v1
Treatment per phase 1 scope §6.

| Type | Key payload fields |
|---|---|
| `invoice.issued` | Invoice ID and number, client, project or retainer, currency, `syp_per_usd`, issue date. Lines: ID, amount, service, department, the source (`retainer_charge` with its kind, `cycle_start` and `cycle_end`; `deposit`; `milestone`; `extra_work`; `manual`), the project's non-deposit installment total. |
| `invoice.voided` | Invoice ID, void date, reason |
| `invoice.line_service_changed` | Line ID, old and new service, date |
| `invoice.due_date_changed` | Invoice ID, new due date |
| `payment.recorded` | Payment ID and receipt number, invoice ID, `paid_on`, method, currency, amount, `syp_per_usd`, amount applied in the invoice's currency |
| `payment.voided` | Payment ID, void date |
| `milestone.done` | Milestone ID, project, installment amount, done date |
| `project.completed` / `project.cancelled` | Project ID, date |
| `project_expense.recorded` / `.changed` / `.archived` | Expense ID, project, client, departments, date, currency, amount, `syp_per_usd`, description |
| `ad_wallet.deposited` / `.refunded` / `.entry_voided` | Entry ID and number, client, date, method, currency, amount, `syp_per_usd`, USD amount |
| `ad_spend.recorded` / `.changed` / `.archived` | Campaign update ID, campaign, client, period, USD spend; wallet-funded campaigns only |
| `rate.changed` | Effective date, `syp_per_usd` (becomes a `market` rate from source `hub`) |

A `.changed` event carries the full new state. Mizan reverses what it posted for that document and posts the new state.

### Periods
- **`GET /v1/periods/status?from=&to=`** returns each month's state (`open`, `closed`). Hub calls it before any change dated in the past, and refuses the change when the month is closed.
- A race (the period closes after Hub's check) ends in `PERIOD_CLOSED` and the held event (above). The accountant then posts it on the first day of the next open period, or reopens the period.

### Daily reconciliation
- **`POST /v1/reconciliation/daily`**: Hub sends, for one date, the count of events and the totals per type and currency.
- Mizan compares them with what it received and posted for that date, stores the result and returns the differences.
- **`GET /v1/events?date=`** lists the event IDs Mizan received for a date with their status, so Hub can find exactly what is missing.
- The pre-close checklist requires every day of the month to be reconciled.

### Versioning
- **Within `/v1`, changes are additive only:** new optional fields, new event types, and new values appended to an enum in an answer (error codes, audit actions, event types).
- **Clients accept values they do not know** in an enum of an answer: they treat an unknown error code by its HTTP status and show or skip an unknown action or type, never fail on it (owner, 2026-10-27). A value is never removed or renamed.
- A breaking change needs `/v2` and an overlap period, or a new event `version` that Mizan accepts beside the old one.
- CI fails on a breaking change to the published OpenAPI document.
- **Stable error codes** are listed in `packages/contracts` and never reused.

### History replay
- Hub's history since 2026-10-19 is replayed through the same endpoint with the original event dates, after the 2026-10-01 opening balances are posted.
- Replayed events are ordinary events, idempotent like any other.

## Consequences
- Hub needs, on its side (Hub F18):
  - the outbox and worker;
  - the events above, including `milestone.done`, `project.completed`, `project.cancelled` and the cycle dates on invoice lines;
  - the period check before past-dated changes;
  - the daily reconciliation call;
  - the replay.

  These are built in Hub's sessions; this record is the contract both sides test against.
- Mizan keeps every received event in its inbox with its payload, so a held event can be posted later without Hub resending it, and every entry links back to the event and the Hub document.
- Food, Shifa and third parties will reuse the envelope, the idempotency, the periods endpoint and the reconciliation, with their own event catalogues.
