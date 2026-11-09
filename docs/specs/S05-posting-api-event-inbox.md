# S05 — Posting API, event inbox and posting rules

Status: Approved (owner, 2026-11-07) · Date: 2026-11-07 · Features: `docs/product/phase-1-scope.md` F10 (and §6 for the events it posts) · ADRs: 0003, 0005, 0006, 0007, 0008, 0011, 0012, 0013, 0014

## Summary
Vertex Hub keeps Vertex Media's operations: invoices, payments, project expenses, the clients' ad wallets and campaign spend. Today none of it reaches Mizan, and the receivables scenarios S04 approved wait for an event executor.

S05 builds the integration layer through which Hub posts each financial event to the ledger exactly once:
- API clients with scoped, hashed keys;
- `POST /v1/events` with a typed contract per event type and version;
- the event inbox, which keeps every event with its state (posted, held, recorded, resolved, dismissed) and the reason for each hold, and retries a held event by itself once its reason is fixed;
- the posting rules of the events whose treatment is settled outside revenue recognition: revenue at issue, payments, project expenses, ad funds, rates and due dates;
- the account mapping each rule reads, maintained in a screen;
- `GET /v1/periods/status`.

Events whose revenue is deferred (retainer cycles, project deposits and milestones) are accepted and kept now, and held `NO_MAPPING` until S06 brings their rules (owner, 2026-11-07).

## In scope / out of scope
- In:
  - **API clients** (`api_clients`, `api_client_keys`): created by the owner, keys shown once, stored as hashes, at most two active keys per client for a rotation, revoked keys kept, the date and address each key was last used, an optional IP allow-list, scopes (`events:write`, `periods:read`; `reconciliation:write` exists for S08) (owner, 2026-11-07);
  - **document sources** (ADR 0001, ADR 0003; deferred by S01): which API client issues each document type of a company, and `SOURCE_NOT_ALLOWED`;
  - **`POST /v1/events`**: the envelope, the catalogue of ADR 0006 as Zod schemas per type and version 1, the idempotency by event ID and payload hash, the responses of ADR 0008 and 0014;
  - **the event inbox** (ADR 0014): the received events with their payloads (append-only), each event's current state, every attempt and action (append-only), the order per item, the automatic retries, the accountant's actions (retry, post in the next open period, resolve by a manual entry, dismiss), the daily email of held events;
  - **Hub's master data** through the events: dimension values created and renamed by their Hub ID (S02 rule 10); `rate.changed` recorded as a `market` rate from source `hub` (S02 rule 14);
  - **the posting rules** (phase 1 scope §6), each through its scenario:
    - `invoice.issued` with lines whose revenue is recognised at issue (`extra_work`, `manual` not marked deferred, `retainer_charge` of kind `termination_fee`);
    - `invoice.voided` and `invoice.line_service_changed` of those invoices; `invoice.due_date_changed` for every invoice item;
    - `payment.recorded` and `payment.voided` (`receivables/hub-payment`);
    - `ad_wallet.deposited`, `.refunded`, `.entry_voided`; `ad_spend.recorded`, `.changed`, `.archived` (`ad-funds/running-balance`);
    - `project_expense.recorded`, `.changed`, `.archived`;
  - **the account mapping** of each rule (`posting_rule_accounts`), its defaults from the service-agency template, its screen and its audit (owner and accountant, open question Q9; owner, 2026-11-07);
  - **the payments' tolerance** (owner, 2026-11-06): a company setting per invoice currency, default 1.00;
  - **`GET /v1/periods/status`**;
  - the scenario book's `event` executor and its inbox steps; the Hub scenarios of S04 made `Approved`;
  - the screens: the inbox, an event's page, the posting-rule mapping, the API clients, the tolerance in the company settings, and the Hub links on an entry and an item.
- Out (later or never):
  - **S06:** the rules of `invoice.issued` lines from retainer cycles (`monthly`, `addition`, `credit`), deposits and milestones, manual lines marked deferred; `milestone.done`, `project.completed`, `project.cancelled`; `SERVICE_PERIOD_CLOSED`; the void and service change of those invoices. Until then these events are held `NO_MAPPING` (detail `deferred_revenue`) and retried when S06 deploys.
  - **S07:** closing and reopening periods (S05 reads the state S03 keeps), the pre-close checklist's inbox item (no held event dated in the month), revaluation.
  - **S08:** `POST /v1/reconciliation/daily` and `GET /v1/events?date=`; the `reconciliation:write` scope is defined now and used then.
  - **S10:** opening items on 2026-10-01 that carry their Hub document, so that payments of invoices issued before the replay find their reference; the history replay itself.
  - **Tax lines:** stored, never posted. An invoice with a non-zero tax amount is held `NO_MAPPING` (detail `tax_lines`) until a tax posting rule exists (owner, 2026-11-07; phase 1 scope §4).
  - **Webhooks or a read API for Hub** (phase 1 scope §8).
  - **Hub's side** (open question Q5): built in Hub's sessions against this contract.

## Access
| Action | Surface | Who (role or permission) |
|---|---|---|
| Post an event | API `POST /v1/events` | API client with `events:write` |
| Read the period states | API `GET /v1/periods/status` | API client with `periods:read` |
| Read the inbox and an event | Web `/inbox` | Owner, accountant, auditor (`events.read`) |
| Retry, post in the next open period, resolve by a manual entry | Web | Owner, accountant (`events.manage`) |
| Dismiss a held event | Web | Owner (`events.dismiss`) (owner, 2026-11-07) |
| Read the posting-rule mapping | Web | Owner, accountant, auditor (`posting_rules.read`) |
| Change the mapping | Web | Owner, accountant (`posting_rules.manage`) (open question Q9; owner, 2026-11-07) |
| Read API clients and keys (never a key's secret) | Web | Owner, auditor (`api_clients.read`) |
| Create a client, create, rotate or revoke a key, set its IP allow-list, scopes and document types | Web | Owner with a fresh two-factor code (`api_clients.manage`, S01's reauthentication) (owner, 2026-11-07) |
| Set the payments' tolerance | Web `/settings/company` | Owner (`company.settings`) |

S01's guard gains `@ApiClientRoute(...scopes)`: the request carries `Authorization: Bearer <key>`, the key's company becomes the transaction's company (`withCompany`), and a person's session is never accepted on `/v1`, nor a key on `/api`. Every role of S01 keeps its permissions; the new keys are added to the permission map in `packages/contracts` (owner: all; accountant: `events.read`, `events.manage`, `posting_rules.read`, `posting_rules.manage`; auditor: `events.read`, `posting_rules.read`, `api_clients.read`; approver and viewer: none of them).

An archived company refuses every `/v1` call (`COMPANY_ARCHIVED`), and archiving revokes its keys (S01 rule 12).

## Data
Every company table has `company_id`, forced RLS with `company_isolation`, composite company foreign keys and its kind in the registry (ADR 0003, 0005, 0008, 0012). Money fields follow ADR 0007.

### Platform tables (`api-clients` module)
The key is looked up before any company context exists, so clients and keys are platform tables (ADR 0003 "Platform tables"), scoped by `scope_company_id` like `memberships`; no column is named `company_id`.

| Table | Kind | Fields | Keys and checks |
|---|---|---|---|
| `api_clients` | business | `id`, `scope_company_id` → companies, `name` (text 1–100, "Vertex Hub"), `system` (`hub`; more later), `scopes` (text[] of `events:write` · `periods:read` · `reconciliation:write`), `ip_allow_list` (cidr[], empty = any), `created_by_user_id`, `created_at`, `updated_at`, `archived_at` | unique `(scope_company_id, name)`; index `(scope_company_id)` |
| `api_client_keys` | business | `id`, `api_client_id` → api_clients, `scope_company_id`, `prefix` (text: `mzn_` and 8 characters, shown in lists), `secret_hash` (SHA-256 hex of the whole key), `created_by_user_id`, `created_at`, `last_used_at` (null), `last_used_ip` (inet, null), `revoked_at` (null), `revoked_by_user_id` (null), `revoke_reason` (null) | unique `(secret_hash)`; unique `(prefix)`; at most two keys of a client with `revoked_at` null (a trigger; `API_KEY_LIMIT`); `revoked_at` never cleared |

A key is `mzn_` followed by 40 characters of base62 from a CSPRNG (238 bits). Only its hash is stored; it is shown once, in the answer to its creation. `last_used_at` is updated at most once a minute per key.

### Company tables
| Table | Kind | Fields | Keys and checks |
|---|---|---|---|
| `document_sources` | business | `id`, `company_id`, `document_type` (`invoice` · `payment` · `project_expense` · `ad_wallet_entry` · `ad_spend` · `milestone` · `project` · `rate`), `api_client_id` (uuid, no FK: a platform id), `created_at`, `updated_at` | unique `(company_id, document_type)` |
| `posting_rule_accounts` | business | `id`, `company_id`, `slot` (enum below), `currency` (null, or `SYP` · `USD` for the payment-method slots), `account_id` → chart accounts, `updated_by_user_id`, `created_at`, `updated_at` | unique `(company_id, slot, currency)` with nulls not distinct |
| `inbound_events` | append-only | `id`, `company_id`, `api_client_id` (uuid, no FK), `event_id` (uuid: Hub's UUIDv7 and the idempotency key), `type`, `version` (smallint), `occurred_at` (timestamptz), `accounting_date` (date), `payload` (jsonb, as received), `payload_hash` (SHA-256 hex of its canonical form, RFC 8785), `document_type`, `document_id` (uuid: Hub's document), `document_number` (text, null), `item_key` (text: the order key, rule 11), `received_at`, `request_id` | unique `(company_id, api_client_id, event_id)`; index `(company_id, item_key, received_at)`; index `(company_id, document_type, document_id)`; index `(company_id, accounting_date)` |
| `inbound_event_states` | queue | `id`, `company_id`, `event_id` → inbound_events (unique), `state` (`held` · `posted` · `recorded` · `resolved` · `dismissed`), `hold_reason` (null: `PERIOD_CLOSED` · `SERVICE_PERIOD_CLOSED` · `UNKNOWN_REFERENCE` · `NO_MAPPING` · `RATE_MISSING` · `NEEDS_DECISION` · `OPEN_ITEM_HAS_SETTLEMENTS` · `WAITING_FOR_EARLIER_EVENT`), `hold_detail` (null, text: rule 9), `waiting_for_event_id` (null) → inbound_events, `posted_on` (date, null: the date it posted at when the accountant moved it, rule 15), `resolved_by_entry_id` (null) → entries, `attempts` (int), `last_attempt_at`, `created_at`, `updated_at` | `hold_reason` set iff `state = held`; index `(company_id, state, hold_reason)` |
| `inbound_event_actions` | append-only | `id`, `company_id`, `event_id` → inbound_events, `action` (`received` · `replayed` · `attempted` · `held` · `posted` · `recorded` · `retried` · `moved_to_open_period` · `resolved` · `dismissed`), `hold_reason` (null), `hold_detail` (null), `entry_ids` (uuid[], empty), `actor_kind` (`api_client` · `person` · `system`), `actor_user_id` (null), `reason` (text, null), `created_at` | index `(company_id, event_id, created_at)` |

- **Entries:** S03's `journal_entries` already carries `source` `hub_event`, `source_ref` (the inbox event's id), `hub_document` (`{ type, id, number }`) and `posted_by_client_id`. A Hub event's entries use them. Its posting requests use `client` = the API client's id and the key `<event id>` for the main entry, `<event id>:reversal:<n>` for a reversal and `<event id>:difference` for a running item's difference entry (S04 rule 13), so a replay or a retry posts nothing twice (invariant 5).
- **Open items:** S04's `open_items.hub_document` names the Hub document; a document item opened by `invoice.issued` has `reference` = Hub's invoice number (`INV-2026-0012`) and `source` `hub_event`. `open_item_due_dates` rows with `set_by` `hub_event` record `due_on` and `invoice.due_date_changed`.
- **Company settings:** `company_settings` gains `payment_tolerance_syp_minor` and `payment_tolerance_usd_minor` (bigint ≥ 0, default 100 each: 1.00 SYP and 1.00 USD). They are outside the settings lock, since they decide how a future event is treated, never a posted amount.
- **Mapping slots** (enum `posting_slot`, values never renamed):

  | Slot | Template account (service agency) | Must be |
  |---|---|---|
  | `receivable` | `112001` | a `document` control account, asset |
  | `revenue_at_issue` | `411001` | revenue, postable |
  | `termination_fee_revenue` | `411002` | revenue, postable |
  | `payment_method.cash` (SYP, USD) | `111001`, `111002` | monetary asset, restricted to that currency |
  | `payment_method.bank_transfer` (SYP, USD) | `111003`, `111004` | the same |
  | `payment_method.e_wallet` (SYP, USD) | `111005`, `111006` | the same |
  | `ad_funds` | `213001` | a `running` control account, liability, restricted to USD |
  | `ad_platforms_payable` | `211001` | liability, postable |
  | `project_cost` | `511001` | expense, postable |
  | `project_expense_awaiting_payment` | `211002` | liability, postable |

  Exchange differences and rounding use the account roles of S02 rule 7. A company created with the service-agency template gets these defaults; the general template's companies start empty and hold `NO_MAPPING` until the accountant maps them. The migration fills the defaults for existing companies whose chart holds the template codes.

## States and rules
### The envelope and the contract
1. `POST /v1/events` takes one event: `{ id, type, version, occurred_at, accounting_date, payload }`, with `Idempotency-Key` equal to `id` (else `VALIDATION_FAILED`). The payload schema is chosen by `type` and `version` (a discriminated union in `packages/contracts`); an unknown type or version is `422` with field errors. Every event of the catalogue validates now, the S06 ones included.
2. **The payload contract** (ADR 0006, refined with Hub's code; open question Q5): amounts are integer minor units and positive, except a retainer `credit` line, which is negative; currencies are `SYP` or `USD` only (Hub's `CURRENCIES`, `packages/contracts/src/money.ts:7` in Hub); `syp_per_usd` is a decimal string of up to 8 integer and 4 decimal digits, as Hub stores it; dates are `YYYY-MM-DD`. Each dimension travels as `{ external_id, code?, name }` under its type: `client`, `contract` (a project or a retainer, with `kind` and the client's `external_id`), `department` (Hub's fixed code, which is its `external_id`) and `service`. Revenue lines carry a `service` and project expenses a `department`, both required (owner, 2026-11-07), so `411001` and `511001` get their required dimensions. A revenue line carries the client, the service and, when the invoice names one, the contract; the receivable item carries the client and, when named, the contract. This is the dimension set of the approved `receivables/hub-payment` cases, whose invoices name no contract, so none of their expected lines changes.
3. **Refusals store nothing:** an invalid payload `422 VALIDATION_FAILED`; an accounting date after the last day of the current month (Asia/Damascus) `422 ENTRY_DATE_OUT_OF_RANGE` (owner, 2026-11-07; ADR 0012); a `payment.recorded` in the invoice's currency whose applied amount exceeds its amount `422 VALIDATION_FAILED` (owner, 2026-11-06), judged at receipt from the payment's `invoice_currency`, which Hub sends (Q5); a USD wallet entry whose `usd_amount` differs from its amount `422 VALIDATION_FAILED`, since a gap in one currency is never an exchange difference (ADR 0007); a document type the company assigned to another source, or to none, `409 SOURCE_NOT_ALLOWED`; the same key with another payload `409 IDEMPOTENCY_CONFLICT`. Hub stops retrying on any `4xx` and shows the event as refused.
4. **Exactly once:** the same key with the same payload hash stores nothing new, writes a `replayed` action and answers the event's current state (`201` when it has posted or been recorded since, `202` while held, with the same entry ids, inbox id and reason). Concurrent requests with the same key serialise on the unique index; the second answers as a replay.
5. **Synchronous posting:** a valid event is stored, attempted and answered in one request. The insert of `inbound_events` and the first attempt run in one transaction; if the attempt fails for a reason that is not a hold (a deadlock, a crash), the transaction is retried once, then the request answers `503` and stores nothing, so Hub's retry is safe.

### Outcomes and holds
6. **Posted** (`201`, `status: posted`): the rule's entries posted through `post()` in the event's transaction, with their ids, fiscal years and numbers. **Recorded** (`201`, `status: recorded`, no entries; ADR 0014): `invoice.due_date_changed`, `rate.changed` and a dimension rename change data without posting.
7. **Held** (`202`, `status: held`, `reason`, `detail`, `inbox_id`): the event is kept and posts later. Hub stops retrying (ADR 0008).
8. **Hold reasons**, checked in this order:
   1. `WAITING_FOR_EARLIER_EVENT`: an earlier event with the same item key is held (rule 11);
   2. `UNKNOWN_REFERENCE`: the document it references has not arrived (a payment, void, due-date or service change before its invoice; a void or change before the posting it reverses);
   3. `NO_MAPPING`: no rule maps the event yet (S06's types and deferred lines: detail `deferred_revenue`; a non-zero tax line: `tax_lines`), a slot it needs is not mapped (`slot_unmapped:<slot>`), or a mapped account is blocked or archived (`account_blocked:<code>`, S02's recommendation);
   4. `PERIOD_CLOSED`: the accounting date is in a closed period;
   5. `RATE_MISSING`: a ledger's policy rate for the date is missing (ADR 0007, 0011);
   6. `OPEN_ITEM_HAS_SETTLEMENTS`: an `invoice.voided` whose item still has movements other than its opening (ADR 0013);
   7. `NEEDS_DECISION`: the treatment needs the accountant (rule 9).
9. **`NEEDS_DECISION` details** (owner, 2026-11-06 and 2026-11-07):
   - `payment_exceeds_open`: a payment applies more than the item's open amount (ADR 0013); Hub refuses an overpayment (`OVERPAYMENT`, Hub `packages/db/src/schema/invoices.ts`), so this arises only from a manual movement in Mizan;
   - `amount_above_applied`: in the invoice's currency, the amount exceeds the applied amount (an overpayment, IFRS 15.106);
   - `payment_gap_beyond_tolerance`: in the other currency, the applied amount differs from the amount at Hub's `syp_per_usd` by more than the tolerance in the invoice's currency;
   - `wallet_gap_beyond_tolerance`: a deposit or refund in SYP whose `usd_amount` differs from its amount at Hub's `syp_per_usd` by more than the USD tolerance;
   - `contract_client_mismatch`: a contract whose client differs from the event's (`DIMENSION_PARENT_MISMATCH`, S02 edge case 10);
   - `dimension_value_archived`: an event names a Hub value the accountant archived (S02 rule 13); restoring the value and retrying posts it;
   - `document_resolved_manually`: a later event on a document whose earlier event was resolved by a manual entry (rule 16);
   - `invoice_currency_mismatch`: a payment's `invoice_currency` differs from the invoice's currency once the invoice is known (Hub cannot send it; held rather than guessed).
10. **Automatic retries** (ADR 0014): after the commit that fixes a reason, the worker retries the held events it frees, in received order per item key:
    - a bulletin or market rate recorded or corrected for a date, or a holiday added, retries `RATE_MISSING` of that date (S02 rules 15, 17);
    - a mapping set, or an account unblocked or restored, retries `NO_MAPPING` with that slot or account;
    - an event posted for a document retries the `UNKNOWN_REFERENCE` events naming it;
    - a `payment.voided` posted retries the `OPEN_ITEM_HAS_SETTLEMENTS` void of its invoice (owner, 2026-10-28);
    - an event leaving `held` retries the events `WAITING_FOR_EARLIER_EVENT` on it;
    - a period reopened (S07) retries its `PERIOD_CLOSED` events;
    - the worker's start after a deploy retries every `NO_MAPPING` event (S06 brings rules that way), and a daily sweep retries every held event except `NEEDS_DECISION` and `PERIOD_CLOSED`.
    A retry re-checks every reason; an event still held keeps its state with the new reason and detail, and writes an `attempted` action only when the reason changes.

### Order per item
11. **Events on the same item post in Hub's order** (owner, 2026-11-07). Each event has an item key:
    - `invoice:<id>` for `invoice.*` and `payment.*` (the payment's invoice);
    - `ad_funds:<client id>` for `ad_wallet.*` and `ad_spend.*`;
    - `project_expense:<id>`, `milestone:<id>`, `project:<id>` for theirs;
    - none for `rate.changed`.
    An event whose key has an earlier held event (by `received_at`) is held `WAITING_FOR_EARLIER_EVENT` with `waiting_for_event_id`, and retries when that one leaves `held`. Two earlier holds never block, because they wait for later events themselves (accounting review, 2026-11-07):
    - an event held because the document a later event creates is missing: held `UNKNOWN_REFERENCE` for it, or `WAITING_FOR_EARLIER_EVENT` behind such an event, through any chain (two payments received before their invoice; a wallet void and a spend before the deposit). The creating event (`invoice.issued`, or the recording that a void or change references) posts, then those events retry in received order;
    - an `invoice.voided` held `OPEN_ITEM_HAS_SETTLEMENTS`: the later `payment.voided` events of that invoice post, then the void retries (rule 10).
    Every other later event on the key still waits. So the average of a client's ad funds, and the realised differences of a receivable, never depend on when the accountant records a bulletin. Hub delivers in outbox order per company (ADR 0006), so `received_at` is Hub's order.

### Posting rules
12. **One rule per event type and version**, in `packages/ledger` as pure functions from the event, the mapped accounts, the rates and the items' carrying amounts to line specifications; `post()` measures and writes them (S03 rule 1). Each rule is implemented only after its scenario is `Approved` with the owner's numbers.
13. **Dates** (owner, 2026-11-07): an event's entries take its accounting date. Hub sets it to the document's date: `issued_on`, `paid_on`, a wallet entry's date, an expense's `spent_on`, the last day of a spend update's period (`period_to`), and the change date for a void, a `.changed`, an `.archived` or a service change. A `.changed` event reverses what was posted for the document and posts the new state, both on the change date; an `.archived` posts the reversal on that date. **The new state is measured at the document's own date** (owner, 2026-11-07, after the accounting review): each new measurement of a `.changed` converts at each ledger's policy rate, or at the document's `syp_per_usd` where that ledger accepts it, for the document's date in the new state (an expense's `spent_on`; a spend update's `period_to` for the excess of a zero crossing), and the line stores that rate and its date. A change of the description alone then nets to zero in both ledgers (IAS 21.21–22: the spot rate at the date of the transaction; IAS 21.28: a rate's later movement on the payable is an exchange difference, never cost). The rate of that date existed when the original posted; if it was corrected since, the correction applies (S02 rule 15). Months already closed are never touched; a change appears in the month it was made (IAS 8.36: a change in estimate is prospective).
14. **Reversals of Hub entries** are posted only by their events: a void, a change, an archive (ADR 0012 "Manual reversal"). A void or archive reverses every entry still standing for the document, latest first. The accountant cannot reverse them by hand (`ENTRY_NOT_REVERSIBLE`).

### The accountant's actions (owner, 2026-11-07)
15. On a held event, with `events.manage`:
    - **Retry**, for any reason: runs the attempt now.
    - **Post in the next open period**, for `PERIOD_CLOSED` only: posts it on the first day of the first open period after its accounting date, with a written reason (phase 1 scope F10). Every line is measured as on its accounting date, at each ledger's policy rate of that date or the document's `syp_per_usd` where the ledger accepts it, so the move creates no exchange difference (owner, 2026-11-07; IAS 21.21–22). `posted_on` and the action keep both dates; the event's own payload never changes.
    - **Resolve by a manual entry**, for `NEEDS_DECISION` only: links the event to a posted manual entry the accountant made for it (for example an overpayment: the applied part to the item and the excess to `212001` or `211003`, IFRS 15.106), with a reason. The entry is not linked to another event. The event becomes `resolved`.
16. A later event on a document whose earlier event was resolved by a manual entry, or dismissed, is held `NEEDS_DECISION` (`document_resolved_manually`). The document is the event's own: the payment for `payment.*`, the invoice for `invoice.*`, so a dismissed payment holds its void but not another payment of the same invoice (owner, 2026-11-07). It is held because Mizan's books no longer follow Hub's for that document (for example a `payment.voided` of a payment resolved by hand: the accountant reverses the manual entry and resolves the void with that reversal).
17. **Dismiss**, by the owner (`events.dismiss`), for any held event, with a written reason: the event never posts, and S08's reconciliation lists it as dismissed in Mizan. Waiting events behind it retry. A dismissed or resolved event never returns to `held`.
18. Every action writes an `inbound_event_actions` row and an audit row in its transaction; posting from an action goes through `post()` like the first attempt.

### API clients and sources
19. The owner creates a client (name, scopes, IP allow-list) and its first key after a fresh two-factor code; the key is shown once with a copy button and never again. A second key may be created for a rotation; a third is refused (`API_KEY_LIMIT`) until one is revoked. A revoked key answers `401` at once. Keys do not expire (owner, 2026-11-07).
20. A request from an address outside a non-empty allow-list answers `403 FORBIDDEN` and is logged without the key.
21. Creating a `hub` client assigns it every Hub document type of the company that has no source yet. The owner can move a document type to another client or to none.
22. Rate limit: 600 requests a minute per client (the replay), body at most 256 KB, an invoice at most 200 lines; beyond, `429 RATE_LIMITED` or `413`.

### Master data
23. A dimension value is found by `(type, hub, external_id)` (S02 rule 10). An unknown one is created with the event's code, or with a generated code (`S-0001`) when Hub has none (Hub's services have no code); a different name renames it, audited with the API client as actor. A contract carries its kind and client; a client that differs from the stored one holds the event (rule 9).
24. `rate.changed` records a `market` row `USD→SYP` from source `hub`, effective on its date, through S02's rate service. A rate equal to the one in force answers `recorded` (S02's `RATE_UNCHANGED` becomes a no-op here). A different rate for a date that already has a Hub row is a correction with the reason "تصحيح من Hub" (S02 rule 15).

## Accounting treatment
The accounts are the mapped slots (Data). Every rule is a scenario, approved before its code.

- **`invoice.issued`, revenue at issue** (phase 1 scope §6 "Extra work and manual invoices", "Termination fee"; IFRS 15.38, the service is delivered):
  - Dr `receivable`, one document item per invoice (reference = Hub's number, the client and, when named, the contract, due date `due_on`), the invoice's total, a new measurement;
  - Cr per line `revenue_at_issue` (`extra_work`, `manual` not deferred) or `termination_fee_revenue` (`retainer_charge` of kind `termination_fee`), with the client, the service and, when named, the contract (rule 2), new measurements;
  - an invoice with any line of S06's kinds, or a non-zero tax line, is held `NO_MAPPING` whole: one invoice is never split between specs (IFRS 15.31 is applied to the contract once).
- **`invoice.voided`**: the reversal of every entry posted for the invoice, dated on the void date; the item closes (S04 rule 13). Held `OPEN_ITEM_HAS_SETTLEMENTS` while payments stand (Hub itself refuses that void, `INVOICE_HAS_PAYMENTS`, so it arises only out of order).
- **`invoice.line_service_changed`** (at-issue lines): Dr the account the line posted to at issue (`revenue_at_issue` or `termination_fee_revenue`) with the old service / Cr the same account with the new service, carrying the amounts the line posted at issue in both ledgers, dated on the change date (phase 1 scope §6 "Service changed on a line"). A deferred line's change is S06's.
- **`invoice.due_date_changed`**: records the due date, effective on its accounting date (S04 rule 15); no entry.
- **`payment.recorded` and `payment.voided`**: `receivables/hub-payment` (owner, 2026-11-06), with the tolerance and holds of rule 9.
- **Ad funds**: `ad-funds/running-balance` (owner, 2026-11-06): deposits and refunds on the method's account and the client's running item on `ad_funds`; spend on `ad_funds` / `ad_platforms_payable`; voids, changes and archives as reversals with S04 rule 13's difference entry.
- **`project_expense.recorded`**: Dr `project_cost` (client, contract, department) / Cr `project_expense_awaiting_payment`, both new measurements in the expense's currency (phase 1 scope §6; scope Q7). The accountant clears `211002` by a manual entry when the source of payment is known. **`.changed`**: the reversal and the new state on the change date, the new state measured at the rates of its `spent_on` (rule 13). **`.archived`**: the reversal.
- **`rate.changed`**: no entry.

**Example** (Vertex Media, `syp-usd`; bulletin 120.0000 on Tuesday 3 November 2026; Hub's rate 124.0000 on an SYP expense of 10 November, bulletin 122.0000 that day):

| Event | Account | Currency | Amount | Book (SYP) | Parallel (USD) |
|---|---|---|---|---|---|
| `invoice.issued` INV-2026-0012, 11-03, extra work 100.00 USD | `112001` item INV-2026-0012 (C1) | USD | 100.00 | 12,000.00 (× 120) | 100.00 |
| | `411001` (C1, S1, design) | USD | −100.00 | −12,000.00 | −100.00 |
| `project_expense.recorded`, 11-10, 50,000.00 SYP | `511001` (C1, P1, photography) | SYP | 50,000.00 | 50,000.00 | 403.23 (÷ 124, Hub's rate) |
| | `211002` | SYP | −50,000.00 | −50,000.00 | −403.23 |

## Currencies, rates and rounding
- **Hub's currencies are SYP and USD**, and its rate is `syp_per_usd` on each document (Hub `packages/contracts/src/money.ts`, `invoices.ts`, `campaigns.ts`). An event in another currency is refused (rule 2). So the `third` shape cannot occur for a Hub event; the scenarios say so.
- **New measurements** (an invoice's lines and its item, cash received, an expense, a deposit or refund of an empty or same-direction balance) convert per ledger at its policy rate on the accounting date, except a `.changed` event's new state, measured at its document's date (rule 13; ADR 0007): the book ledger at the bulletin of the day (ADR 0011), the parallel at `market`, or at the document's `syp_per_usd` where that ledger accepts a transaction's rate (Vertex Media). A ledger in the document's currency takes the amount as is; a ledger in the other currency reads the document's `syp_per_usd` only where its policy accepts a transaction's rate (so Vertex Media's book ledger never reads it, and a `usd-syp` company's SYP parallel ledger does, as `receivables/hub-payment` shows).
- **Carried amounts** (a payment's credit to the item, a spend or refund at the funds' average, reversals) never convert again (ADR 0007, 0013).
- **Residuals:** an entry with a carried line posts each ledger's residual as a realised difference to the role accounts (ADR 0013); a single-currency entry of new measurements posts rounding to `conversion_rounding` (bounded by half a minor unit per line).
- **The tolerance** is compared in the invoice's currency for payments and in USD for wallet entries, with Hub's `syp_per_usd` and the one conversion function, rounding half away from zero; Hub rounds half up, which agrees for positive amounts (ADR 0007 compatibility test).
- **A missing policy rate** holds the event `RATE_MISSING`, never a default.

## Periods
- An event dated in a closed period is held `PERIOD_CLOSED`; it posts after a reopen (S07) or, by the accountant, on the first day of the first open period after it (rule 15).
- `GET /v1/periods/status?from=YYYY-MM&to=YYYY-MM` returns each month in the range (at most 24) with `open` or `closed`; a month with no period row is `open`. Hub calls it before a past-dated change (ADR 0006).
- A void, change or archive is dated on its own date, so a closed month keeps its figures (rule 13).
- **S07's pre-close checklist** gains one item from S05: no held event dated in the month.

## API
Hub's API under `/v1`, in `openapi.json` and checked by `pnpm check:openapi`; every response carries `X-Request-Id`. The internal web API under `/api` follows S01 (`X-Mizan-Company` on writes, `NOT_FOUND` for another company's id).

| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /v1/events` | `events:write` | `eventEnvelopeSchema` + `Idempotency-Key` | `201 { status: posted \| recorded, inbox_id, entries: [{ id, fiscal_year, number }] }` · `202 { status: held, inbox_id, reason, detail }` | `VALIDATION_FAILED`, `ENTRY_DATE_OUT_OF_RANGE`, `IDEMPOTENCY_CONFLICT`, `SOURCE_NOT_ALLOWED`, `UNAUTHENTICATED`, `FORBIDDEN`, `COMPANY_ARCHIVED`, `RATE_LIMITED` |
| `GET /v1/periods/status?from=&to=` | `periods:read` | months | `[{ period, state }]` | `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN` |
| `GET /api/inbox?state=&reason=&type=&from=&to=&cursor=` | `events.read` | filters | page of events with state, reason, detail, document number, dates, entries | — |
| `GET /api/inbox/counts` | `events.read` | — | held count per reason | — |
| `GET /api/inbox/:id` | `events.read` | — | the event, its payload, state, actions and entries | `NOT_FOUND` |
| `POST /api/inbox/:id/retry` | `events.manage` | — | the event | `EVENT_NOT_HELD` |
| `POST /api/inbox/:id/post-in-open-period` | `events.manage` | `{ reason }` | the event | `EVENT_NOT_HELD`, `EVENT_ACTION_NOT_ALLOWED` |
| `POST /api/inbox/:id/resolve` | `events.manage` | `{ entryId, reason }` | the event | `EVENT_NOT_HELD`, `EVENT_ACTION_NOT_ALLOWED`, `ENTRY_ALREADY_LINKED`, `NOT_FOUND` |
| `POST /api/inbox/:id/dismiss` | `events.dismiss` | `{ reason }` | the event | `EVENT_NOT_HELD` |
| `GET /api/posting-rules` | `posting_rules.read` | — | every slot with its account and the rules that read it | — |
| `PUT /api/posting-rules/:slot` | `posting_rules.manage` | `{ currency?, accountId }` | the slot; refused while the account mapped now holds open items (owner, 2026-11-09) | `MAPPING_ACCOUNT_INVALID`, `NOT_FOUND`, `ACCOUNT_HAS_BALANCE` |
| `GET /api/api-clients` | `api_clients.read` | — | clients with keys (prefix, dates, last use), scopes, allow-list, document types | — |
| `POST /api/api-clients` | `api_clients.manage` + reauthentication | `{ name, system, scopes, ipAllowList }` | the client and its first key, once | `REAUTHENTICATION_REQUIRED`, `VALIDATION_FAILED` |
| `PUT /api/api-clients/:id` | `api_clients.manage` + reauthentication | `{ name?, scopes?, ipAllowList?, documentTypes? }` | the client | `REAUTHENTICATION_REQUIRED` |
| `POST /api/api-clients/:id/keys` | `api_clients.manage` + reauthentication | — | the new key, once | `API_KEY_LIMIT`, `REAUTHENTICATION_REQUIRED` |
| `POST /api/api-clients/:id/keys/:keyId/revoke` | `api_clients.manage` + reauthentication | `{ reason }` | the key | `REAUTHENTICATION_REQUIRED` |
| `PUT /api/company/settings` (S01) | `company.settings` | gains `paymentToleranceSyp`, `paymentToleranceUsd` | the settings | `VALIDATION_FAILED` |

New error codes, appended to the registry in this order: `SOURCE_NOT_ALLOWED` (409), `API_KEY_LIMIT` (409), `EVENT_NOT_HELD` (409), `EVENT_ACTION_NOT_ALLOWED` (409), `ENTRY_ALREADY_LINKED` (409), `MAPPING_ACCOUNT_INVALID` (422). The hold reasons are their own enum in `packages/contracts` (`holdReasonSchema`), append-only like the error codes and checked by the same guard; `WAITING_FOR_EARLIER_EVENT` and `OPEN_ITEM_HAS_SETTLEMENTS` join ADR 0008's list (ADR 0014). Clients accept a reason, status or detail they do not know (ADR 0006).

The contracts are exported as JSON Schema for Hub (`packages/contracts`, `pnpm --filter @vertex-mizan/contracts export:hub-schema`), with one example payload per type that the API test posts.

## Jobs and events
| Job | Queue and trigger | Safe twice because |
|---|---|---|
| `events.retry` | pg-boss, enqueued after the commit of a change that frees held events (rule 10), with the company and the trigger | each held event posts under its idempotency keys, and a retry of a posted event does nothing |
| `events.retry-sweep` | daily 04:00 Asia/Damascus, and at worker start | the same; the jobs role lists companies with held events through its own policy on `inbound_event_states`, then each company runs as `mizan_app` in `withCompany` |
| `events.held-digest` | daily 08:00 Asia/Damascus (owner, 2026-11-07) | one email per company and day, keyed by company and date in the email outbox; sent to the owner and the accountants only when an event is held: new holds of the last day and all held, by reason, with a link to `/inbox` |

Events received: the catalogue of ADR 0006, version 1. Events emitted: none (no webhooks in phase 1).

## Screens
| Route | Purpose and content | Actions | States | Who |
|---|---|---|---|---|
| Sidebar | "صندوق الوارد" with the count of held events | — | the count hides at zero | `events.read` |
| `/inbox` | The events: tabs "معلّقة" (default), "مرحّلة", "الكل"; a row per event with its type in Arabic, Hub's document number, client, accounting date, received time, state, reason and detail in Arabic, its entries; filters by reason, type and date | Open an event; retry from the row | Empty: "لا أحداث معلّقة" / "لم يصل أي حدث من Hub بعد"; loading skeleton; error with retry | Every role with `events.read` |
| `/inbox/:id` | The event: envelope (Hub ID, type, version, dates), the payload's key fields rendered with Amount and the raw JSON (copyable), the hold with an explanation and what fixes it (record the bulletin of the date, map the slot, open S06), the event it waits for, the history of actions, the entries with links | Retry; post in the next open period (with the target date shown); resolve by a manual entry (pick a posted manual entry, `EntryPicker`); dismiss (owner); open a document's other events | Not found; read-only for the auditor | `events.read`; actions per access |
| `/settings/posting-rules` | Each rule with its slots, each slot's account (`AccountPicker`, filtered to what fits), the template default, the scenario it follows; a warning for an unmapped slot with its held events | Change an account (audited before and after) | Unmapped slots marked | `posting_rules.read`; change with `posting_rules.manage` |
| `/settings/api-clients` | Clients with scopes, allow-list, document types; keys with prefix, created, last used (time and address), revoked | New client, new key, revoke with a reason, edit scopes, allow-list and document types | The new key in a dialog shown once, with copy and "لن يظهر المفتاح مرة أخرى" | Owner; auditor reads |
| `/settings/company` | Gains the payments' tolerance in SYP and USD (Amount input) | Save | — | Owner |
| `/entries/:id`, `/open-items/:id` | Show the Hub document (type and number) and a link to the event | — | — | per S03, S04 |

New components in `packages/ui`: `EventStateBadge` (state and reason, color and text, never color alone), `JsonViewer` (LTR, monospaced, collapsible, copy), `SecretReveal` (shown once, copy, confirmation that it was saved), `EntryPicker` (a posted entry by number or description). The palette gains "صندوق الوارد" and "حدث…" (by Hub document number).

## Reports
No report changes. Revenue lines carry no department (rule 2): S09's profitability by department reads it from the line's service, which has one department in Hub. Hub's entries feed S04's ageing, client statements and funds, and S09's reports. The inbox's counts are not ledger figures. S08 compares Hub's daily totals with the posted events.

## Printing and legal books
None. Hub's entries print in the journal book (S09) like any other, with their description in Arabic ("فاتورة INV-2026-0012 — <client>", "دفعة RC-2026-0007 على INV-2026-0012", …) and their number.

## Volume and performance
- Vertex Media: about 300–600 events a month (invoices, payments, wallet entries, spend updates, expenses), 1–3 entries each; the replay since 2026-10-19 is a few hundred events.
- The largest company served in phase 1 is Vertex Media; posting is serialised per company (ADR 0008), at most a few events a second.
- `POST /v1/events` answers within 500 ms at p95 for an invoice of 20 lines; the inbox page within 1 s for 10,000 events (indexes above, cursor pagination).
- The order check reads `inbound_events` by `(company_id, item_key, received_at)` joined to the held states.

## Migration and compatibility
- New tables and enums, the settings' two columns, the mapping defaults for existing companies with the template's codes, and the document sources (none until a client exists). No ledger data changes.
- `/v1` appears for the first time; within it changes are additive from now on (ADR 0006). The answer gains `recorded`, `detail` and the two hold reasons of ADR 0014 before Hub builds against it.
- The scenario book gains the `event` executor and the inbox steps (`retry`, `move`, `resolve`, `dismiss`) and the expectation of a hold on any step; `receivables/hub-payment` and `ad-funds/running-balance` become `Approved` once their added cases are approved (Scenarios).
- **Hub must send** (open question Q5, updated): the envelope with the event ID as idempotency key; `due_on` on `invoice.issued`; the line source (`retainer_charge` with its kind and `cycle_start`, `cycle_end`; `deposit`; `milestone`; `extra_work`; `manual`), since Hub stores a deposit as the first milestone and derives the cycle end; a `service` on every revenue line and a `department` on every project expense (Hub's lines and expenses have none today); `applied_amount` and `invoice_currency` on payments (Hub's `applied_minor` and the invoice's currency); the dimensions with their Hub IDs; the accounting dates of rule 13; `rate.changed` when Finance changes the current rate; the handling of `202 held` and `409`/`422`.

## Arabic strings and number formats
- `ar.inbox`: the states (مرحّل، معلّق، مسجّل، حُلّ بقيد يدوي، أُسقط), the reasons (فترة مغلقة، فترة خدمة مغلقة، مرجع غير معروف، لا ربط للحسابات، سعر غير موجود، يحتاج قرار المحاسب، للبند حركات سداد، بانتظار حدث سابق) and each detail, the event types (فاتورة صادرة، إلغاء فاتورة، دفعة مسجّلة، إيداع في المحفظة، صرف إعلاني، مصروف مشروع، تغيّر السعر، …), the actions and their confirmations.
- `ar.postingRules`, `ar.apiClients` and the settings' tolerance ("هامش فرق السداد").
- Latin digits, amounts through Amount, dates `YYYY-MM-DD`; JSON and keys LTR-isolated.

## Audit
In `audit_entries`, in the same transaction: `api_client.created`, `api_client.updated`, `api_client_key.created`, `api_client_key.revoked` (in the company's log, actor the owner); `document_source.set`; `posting_rule.mapped` (before and after); `company.settings_updated` for the tolerance (S01); `event.retried`, `event.moved_to_open_period`, `event.resolved`, `event.dismissed` (each with its reason); `dimension_value.created` and `.updated` and `rate.recorded` with the API client as actor. Each posted entry has its audit row from `post()` (invariant 10). Received events are audited by `inbound_event_actions`, not by `audit_entries`, since every one is kept with its payload.

## Abuse and failure cases
- **Replays and double submits:** the unique `(company, client, event_id)` and the payload hash (rule 4); entries by their posting requests (invariant 5).
- **A different payload under a used key:** `409 IDEMPOTENCY_CONFLICT`, nothing stored, logged.
- **A stolen key:** the allow-list, the rotation and immediate revocation, last use shown; a key reaches one company only, and only the document types assigned to its client (`SOURCE_NOT_ALLOWED`).
- **Cross-company access:** the company comes from the key, never the payload; forced RLS on every inbox table; tests post with company A's key naming company B's documents and see nothing cross.
- **A close racing an event:** `post()` takes the head, then the period with a share lock (ADR 0008), so the event either posts before the close or is held `PERIOD_CLOSED`.
- **Hub down:** nothing to do in Mizan; Hub's outbox retries. **Mizan down:** `5xx` and Hub retries with the same key.
- **Out-of-order events:** `UNKNOWN_REFERENCE` and the order per item (rules 8, 11).
- **A flood of holds** (a missing bulletin holds a day's events): one daily email, the counter, and one retry when the rate is recorded.
- **A payload Mizan cannot read later** (a new version): versions are kept beside each other; stored payloads are never migrated.
- **Silent divergence from Hub:** a resolved or dismissed event marks the document, later events on it are held (rule 16), and S08 shows both.

## Edge cases
1. Two requests with the same key at once: one stores, the other answers as a replay.
2. A payment arrives before its invoice: `UNKNOWN_REFERENCE`; the invoice does not wait behind it (rule 11), and the payment posts once the invoice posts. A payment received after a held invoice waits behind it (`WAITING_FOR_EARLIER_EVENT`).
3. A deposit held `RATE_MISSING` at 9:00 and a spend on the same client at 10:00: the spend waits; at 12:00 the bulletin is recorded and both post in order.
4. A void of an invoice with a standing payment: `OPEN_ITEM_HAS_SETTLEMENTS`, retried after `payment.voided` posts.
5. An SYP payment of a USD invoice whose applied amount differs beyond the tolerance: `NEEDS_DECISION`; the accountant posts it by hand (Dr cash, Cr the item with a memo, the difference where it belongs) and resolves the event; a later `payment.voided` of it is held `document_resolved_manually`.
6. An invoice mixing an extra-work line and a retainer charge: held `NO_MAPPING` (`deferred_revenue`) whole; posted when S06 deploys.
7. An invoice with a zero tax line: posts; with a non-zero one: `NO_MAPPING` (`tax_lines`).
8. Zero or negative amounts: refused (`422`), except a retainer `credit` line (negative, S06).
9. Shapes: `syp-usd` (Vertex Media), `syp` (no parallel: one ledger, no transaction rate read), `usd-syp` (USD books: the book ledger's policy rate converts SYP documents; Hub's rate only where that ledger is `market` and accepts it); `third` cannot occur.
10. A missing bulletin on a day off: the last published one applies (ADR 0011); on a publication day without one: `RATE_MISSING`.
11. A rate correction for a date whose events posted: the entries stay (S02 rule 15); the correction's answer lists them, and held events of that date retry.
12. A mapped account blocked: new events hold `NO_MAPPING` (`account_blocked`); unblocking retries them.
13. A Hub value archived in Mizan: `NEEDS_DECISION` (`dimension_value_archived`).
14. A `.changed` with the same amounts as posted (a description changed): still a reversal and the new entry, measured at the document's date, so the two net to zero in both ledgers; the accountant sees both.
15. A change after a close: dated on the change date in an open month (rule 13); a change dated in a closed month is `PERIOD_CLOSED`.
16. A void after a service change: both entries are reversed, latest first.
17. An event dated 31 December posted in January: numbered in the old fiscal year (ADR 0012), if that period is open.
18. An event dated before 2026-01-01 in SYP: `SYP_BEFORE_REDENOMINATION` refused (422).
19. A payment of an invoice issued before the replay (before 2026-10-19): `UNKNOWN_REFERENCE` until S10's opening item for it exists with its Hub document.
20. A key used from two servers during a rotation: both active; the old one is revoked once Hub uses the new.

## Scenarios
Each written and approved through `/posting-rule` before its code:
- **`receivables/hub-payment.md`** (numbers approved 2026-11-06; S05 adds cases, then `Approved`): a payment gap beyond the tolerance (held), an amount above the applied amount (held), a gap within it (a realised difference); an invoice void held `OPEN_ITEM_HAS_SETTLEMENTS` and posted by itself once the payment's void posts; two payments before their invoice (`UNKNOWN_REFERENCE`, the second waiting behind the first; the invoice posts, then both payments in order), with no expected value of the approved cases changed (rule 2).
- **`ad-funds/running-balance.md`** (numbers approved 2026-11-06; S05 adds cases, then `Approved`): an SYP deposit whose `usd_amount` differs within the tolerance (a realised difference) and beyond it (held); a deposit held `RATE_MISSING` with a spend waiting behind it, both posted in order once the bulletin is recorded.
- **`revenue/revenue-at-issue.md`** (new): an extra-work invoice in USD and in SYP, a manual line, a termination fee, in `syp-usd`, `syp` and `usd-syp`; its void; a service change on a line; an invoice with a retainer line and one with a tax line, both held `NO_MAPPING`.
- **`expenses/project-expense.md`** (new): an expense in SYP at Hub's rate and in USD; a change of the description in a later month at a different bulletin (nets to zero), a change of the amount, and an archive, all dated on the change date and measured at `spent_on`; in `syp-usd`, `syp` and `usd-syp`.
- **`inbox/holds-and-actions.md`** (new): an event held `PERIOD_CLOSED` and posted in the next open period; a `NEEDS_DECISION` payment resolved by a manual entry and its void held `document_resolved_manually`; a dismissed event and the event waiting behind it.

The scenario format gains: a hold expected on any step (`outcome` per step), the inbox steps (`retry: <step>`, `move: <step>`, `resolve: { step, entry }`, `dismiss: <step>`), and the settings' tolerance in `company`.

## Open questions
- **Q5 (Hub's side):** stays open; this spec lists what Hub must send and add (Migration). Hub's code was read on 2026-11-07 (`HussienALfajer/vertex-hub`, ADR 0035, `packages/contracts/src/{money,invoices,campaigns,departments}.ts`, `packages/db/src/schema/{invoices,projects,campaigns}.ts`): none of the integration exists yet in Hub.
- **Whether Hub can send a refund beyond a client's wallet balance** (S04's scenario left it to S05): not confirmed in Hub's code. The running-balance rules handle a crossing either way (ADR 0007), so no number depends on it.

## Acceptance
- **The owner's end-to-end check:**
  1. In a test company with the service-agency template, open `/settings/api-clients`, create the client "Vertex Hub" with `events:write` and `periods:read`, enter a fresh code, copy the key shown once.
  2. Record the bulletin of 3 November 2026 at 120.0000 in `/rates`.
  3. Post the example `invoice.issued` (100.00 USD extra work, client C1) with the key (a script in `apps/api` posts the JSON examples): `201 posted`. The entry shows Dr `112001` 12,000.00 SYP / 100.00 USD, Cr `411001`; `/receivables` shows INV-2026-0012 due on its date.
  4. Post the same request again: the same answer, no new entry. Change one amount and post it with the same key: `409`.
  5. Post a `payment.recorded` dated 19 November before recording that day's bulletin: `202 held RATE_MISSING`; the sidebar counts one held event, and the next morning's email lists it. Record 123.0000: the payment posts by itself with the 300.00 SYP realised gain.
  6. Post a `project_expense.recorded` while `project_cost` is unmapped: held `NO_MAPPING`; map it in `/settings/posting-rules`: it posts.
  7. Post an `invoice.issued` with a monthly retainer line: held `NO_MAPPING` "يُرحَّل مع الاعتراف بالإيراد (S06)".
  8. Revoke the key: the next call answers `401`.
- **Tests:**
  - API: every endpoint with success, 401, 403 (scope, allow-list, role), another company's key and documents, an idempotent replay, a conflicting replay, a refused source; `/v1` and `/api` refuse each other's credentials;
  - unit and property tests: each rule's lines balance in both ledgers; replaying any sequence of events posts nothing new; any order of arrival of one item's events posts the same entries as Hub's order, given the order rule; a held event posts exactly once through any sequence of retries and actions;
  - the scenario book: the five scenarios above `Approved` and run;
  - invariant and convention tests for the new tables (append-only inbox and actions, forced RLS, the key limit trigger, the jobs role's policy);
  - E2E with RTL screenshots: `/inbox`, `/inbox/:id` in each state, `/settings/posting-rules`, `/settings/api-clients` with the key dialog, at 360, 768 and 1280 px in light and dark.
