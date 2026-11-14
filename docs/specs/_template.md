# <ID> — <Spec name>

Status: Draft | Approved · Date: YYYY-MM-DD · Features: `docs/product/phase-1-scope.md` F<nn>, F<nn> · ADRs: <list>

<!-- `Approved` is set when the owner approves the spec and stays; docs/ROADMAP.md tracks its implementation. -->

## Summary
Two or three sentences: the problem this solves for the company, its accountant or a connected system, and what this spec delivers.

## In scope / out of scope
- In: …
- Out (later or never): …

## Access
| Action | Surface | Who (role or permission) |
|---|---|---|
| Post a manual entry | Web | Accountant (`entries.post`); Approver when approval is on |
| Close a period | Web | Owner; accountant with the period permission (`periods.close`) |

## Data
For each entity, give:
- the table and its fields (name, type, required, constraints);
- relations, indexes and unique keys (idempotency keys, references, numbers);
- company or platform scope and RLS;
- its kind: business (archived), append-only (ledger, audit), draft, queue, or ephemeral (deleted once handled, like the email outbox).

Money fields follow ADR 0007.

## States and rules
States and allowed transitions (who or what triggers each, what happens). Business rules as numbered, testable statements.

## Accounting treatment
For every operation:
- the entry it posts (accounts by template code, dimensions, signs);
- its basis (standard paragraph, company policy, Syrian rule with its label);
- its reversal or correction;
- its effect on open items and revaluation.

"None" if the feature posts nothing.

## Currencies, rates and rounding
For every amount:
- its currency, the rate it uses and where that rate comes from;
- the book and parallel amounts and the rate policy each uses;
- exchange-difference and rounding lines, and allocations (ADR 0007).

## Periods
How the feature behaves at month boundaries, in closed periods (refused) and at close (checklist items it adds).

## API
| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /api/drafts/:id/post` | `entries.post` | — | the posted entry | `PERIOD_CLOSED`, `IDEMPOTENCY_CONFLICT`, `DRAFT_CHANGED` |

Idempotency per invariant 5 (ADR 0005); error codes appended to the registry, never reused.

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

## Printing and legal books
Documents and books the feature prints (journal book, vouchers, statements): content, Arabic text, page numbering, the SYP label, amounts in words where used. "None" if it prints nothing.

## Volume and performance
Expected rows per company per month and the largest company served; which queries read period balances and which read lines; indexes; how long the slowest screen or report may take.

## Migration and compatibility
What existing data and scenarios the change affects; expand-then-contract steps.

## Arabic strings and number formats
New i18n keys, Arabic terms from the glossary, number and date formats (Latin digits), currency labels.

## Audit
Which changes and reads write audit entries.

## Abuse and failure cases
How the feature can be abused or fail, and the control for each:
- replays;
- double submits;
- races with a close;
- cross-company access;
- a stolen session;
- back-dated entries.

## Edge cases
A numbered list:
- concurrency;
- zero and negative amounts;
- every currency shape (`syp`, `syp-usd`, `usd-syp`, `third`);
- a missing policy rate;
- rate changes mid-month;
- archived accounts or dimensions;
- a reversal after a settlement;
- a change after a close;
- leap days and periods that cross months.

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
