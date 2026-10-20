# <ID> — <Spec name>

Status: Draft | Approved · Date: YYYY-MM-DD · Features: `docs/product/phase-1-scope.md` F<nn>, F<nn> · ADRs: <list>

## Summary
Two or three sentences: the problem this solves for the company, its accountant or a connected system, and what this spec delivers.

## In scope / out of scope
- In: …
- Out (later or never): …

## Access
| Action | Surface | Who (role or permission) |
|---|---|---|
| Post a manual entry | Web | Accountant (`entries.post`); Approver when approval is on |
| Post a Hub event | API `/v1/events` | API client with `events:write` |

## Data
For each entity, give:
- the table and its fields (name, type, required, constraints);
- relations, indexes and unique keys (idempotency keys, external references, numbers);
- company or platform scope and RLS;
- its kind: business (archived), append-only (ledger, audit), draft or queue.

Money fields follow ADR 0004.

## States and rules
States and allowed transitions (who or what triggers each, what happens). Business rules as numbered, testable statements.

## Accounting treatment
For every operation:
- the entry it posts (accounts by template code, dimensions, signs);
- its basis (standard paragraph, company policy, Syrian rule with its label);
- its reversal or correction;
- its effect on open items, recognition schedules and revaluation.

"None" if the feature posts nothing.

## Currencies, rates and rounding
For every amount:
- its currency, the rate it uses and where that rate comes from;
- the functional and second amounts;
- rounding lines and allocations (ADR 0004).

## Periods
How the feature behaves at month boundaries, in closed periods (refuse, hold) and at close (checklist items it adds).

## API
| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /v1/events` | API client `events:write` | `eventEnvelopeSchema` | `postingResultSchema` | `PERIOD_CLOSED`, `IDEMPOTENCY_CONFLICT`, `SOURCE_NOT_ALLOWED` |

Idempotency, versioning and held-event behaviour per ADR 0006.

## Jobs and events
Worker jobs: the queue, the trigger, retries, and why each is safe to run twice. Events received or emitted, with versions.

## Screens
For each screen, give:
- the route and purpose;
- its content and actions;
- the drill-down to entries;
- exports;
- loading, empty and error states;
- what each role sees.

## Reports
Figures the feature adds or changes, and how each reconciles to the ledger.

## Audit
Which changes and reads write audit entries.

## Abuse and failure cases
How the feature can be abused or fail, and the control for each:
- replays;
- double submits;
- races with a close;
- cross-company access;
- a stolen API key;
- Hub down;
- out-of-order events.

## Edge cases
A numbered list:
- concurrency;
- zero and negative amounts;
- rate changes mid-month;
- archived accounts or dimensions;
- a void after a release;
- a change after a close;
- leap days and cycles that cross months.

## Scenarios
Every accounting rule this spec introduces or changes, as `docs/scenarios/<area>/<rule>.md`, each written and approved through `/posting-rule` before its code.

## Open questions
Anything not yet decided, with a recommendation. Nothing here may be guessed during implementation.

## Acceptance
- **The owner's end-to-end check, step by step:** the company, the account, what to enter, and which entries and figures to see.
- **Tests:**
  - API: success, 401, 403, another company and an idempotent replay per endpoint;
  - unit and property tests for the ledger rules;
  - the scenario book;
  - invariant tests for new tables;
  - E2E with RTL screenshots for screens.
