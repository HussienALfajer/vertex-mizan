# Phase 1 scope: the core and the posting API

- **Date:** 2026-10-20 · **Status:** approved by the owner (2026-10-20); revised the same day after the foundation audit (`docs/audits/2026-10-foundation-audit.md`)
- **Decisions:** ADR 0001, ADRs 0007 and 0008; the owner's answers to `docs/product/phase-1-analysis.md` §6 and to the audit, recorded in §10 below.
- **Labels:** Syrian legal or tax facts carry CONFIRMED, REPORTED or UNVERIFIED (`docs/research/market-syria.md`).

## 1. Goal

Vertex Media's books are kept in Mizan, fed by Vertex Hub, on a core that serves any number of companies.

## 2. Done when

1. Hub posts its financial events to Mizan in production, including the replay of its history since 2026-10-19.
2. The daily reconciliation between Hub and Mizan shows no gap for seven consecutive days.
3. Vertex Media's opening balances on 2026-10-01 are posted and agree with Hub's open invoices and ad wallet balances.
4. A real month is closed in Mizan:
   - revenue is deferred and released under IFRS 15;
   - both ledgers (SYP books, USD parallel) are revalued;
   - the trial balance, income statement, balance sheet and profitability reports are read by the owner;
   - Hub refuses a change dated in that month.
5. The ledger invariants, tenant isolation and the scenario book pass in CI.

## 3. Users and companies

- **Companies:** Vertex Media (company 1) and test companies. Any number of companies under one login, each fully isolated.
- **People:** the owner, an internal accountant, an external accountant or office, and management readers. One person can belong to several companies, with a role in each.

| Role | Can |
|---|---|
| Owner | Everything in the company, including users, settings, periods, posting rules and API clients |
| Accountant | Chart of accounts, entries (draft, post, reverse), rates, the event inbox, revaluation, close and reopen periods if the owner allows |
| Approver | Approve manual entries when approval is switched on (F05) |
| Viewer | Read reports |
| Auditor | Read everything, including the audit log and the integrity check; change nothing |
| API client | A machine identity per integration (Hub), limited to its scopes |

## 4. Accounting policies decided for Vertex Media

| Policy | Decision |
|---|---|
| Book currency | **SYP** (the new Syrian pound): the statutory books, journal, statements and tax return (ADR 0007). |
| Parallel currency | **USD**: a full parallel ledger for management and profitability, with its own exchange differences and revaluation (ADR 0007). |
| Rate policy | Book ledger at the **Central Bank bulletin** rate of the accounting date; parallel ledger at the **market rate the company deals at**, Hub's own rate accepted (IAS 21.26). The reasoning is recorded as the company's policy note. |
| Fiscal year and periods | The calendar year (Income Tax Law 24/2003, CONFIRMED), with monthly periods. |
| Start of the books | Opening balances on **2026-10-01**; summarised manual entries for 1–18 October from existing records; then every Hub event since 2026-10-19 replayed through the API. |
| Revenue | **IFRS 15**: revenue is recognised as the service is delivered and dated when it is delivered (§6). Work done and not yet invoiced is a contract asset (IFRS 15.107). |
| Ad budget | **Client money held**, a liability; never revenue. |
| Month-end revaluation | In each ledger, monetary balances in other currencies are revalued at month end (IAS 21.23) at that ledger's policy rate: USD items in the SYP books at the bulletin, SYP items in the USD ledger at the market rate. Each entry reverses on the first day of the next month. |
| Exchange differences on settlement | Realised gains and losses in each ledger when a receivable or payable is settled (IAS 21.28), as difference lines carrying an amount in that ledger only. |
| Chart of accounts | Numbered and hierarchical, four levels: 1 assets, 2 liabilities, 3 equity, 4 revenue, 5 expenses. Classified for IFRS presentation, with Arabic and English names. |
| Approval of manual entries | Optional per company (F05); entries posted from Hub are never held for approval. |
| Tax | No tax posting rules in phase 1 (Hub has none today). The contract accepts optional tax lines on invoices and the templates carry tax accounts, ready for the reform the Ministry of Finance is preparing for the start of 2027 (CONFIRMED, SANA, 2026-10-11). |
| Journal order | Gapless numbers in posting order; the journal book printed by accounting date then number, in Arabic (Commercial Code arts. 16–19, REPORTED; ADR 0008). |
| Hyperinflation | IAS 29 is out of scope (Syria is on watch lists, not on the hyperinflation lists; REPORTED). |

**Open (UNVERIFIED):** whether the tax authority requires the bulletin rate for the statutory books, and whether Decrees 5 and 6 of 2024 on foreign-currency dealing affect USD invoicing (open question Q1). A Syrian certified auditor confirms the SYP-book, bulletin-rate policy before the 2026 tax return.

## 5. Features

IDs are referred to by specs, the roadmap and the scenario book.

### F01 Companies, users and access
- Companies with their book currency (default SYP), optional parallel currency, the rate policy of each ledger, the policy note, the fiscal year start and enabled modules (all optional modules are off in phase 1).
- Users with membership in several companies; a company switcher; the roles in §3.
- Sign-in with two-factor authentication required for every role (owner, 2026-10-26; S01).
- Isolation enforced by the database (forced row-level security); every endpoint tested with a user of another company.
- An audit log that can only be appended to, showing who did what, when and from where, with before and after values.

### F02 Chart of accounts
- Headers and postable accounts in a numbered tree of up to four levels; Arabic and English names.
- Each account has a class, a normal balance and a statement line (for the income statement and the balance sheet).
- Flags on each account:
  - an optional currency restriction;
  - control account (open items per counterparty and document);
  - monetary or non-monetary, which decides revaluation;
  - required dimensions.
- Accounts are blocked or archived, never deleted once used.
- A service-agency template (used by Vertex Media) and a general template.

### F03 Dimensions
- Dimension types per company: client, project, department and service for Vertex Media.
- Values are created on the fly from Hub events with their Hub ID and name, and renamed when Hub sends a new name. The accountant can also add values by hand.
- Required-dimension rules per account; for example, revenue requires client and service, and direct project costs require project.

### F04 Currencies and rates
- ISO 4217 currencies; integer minor units; exact decimal rates.
- A dated rate table per company and currency pair, with the rate type (market, Central Bank bulletin) and source (Hub, manual).
- Hub's rate is received with each event and with each Hub rate change (type `market`). The accountant enters the bulletin rate by hand; a missing bulletin rate holds the events of that date (`RATE_MISSING`).
- The rate policy per ledger (ADR 0007).
- SYP is the new Syrian pound and is labelled "الليرة السورية الجديدة" on printed reports.

### F05 Journal entries
- Manual entries: draft, post, reverse, copy. A fast keyboard entry screen.
- Each line has:
  - the account and its dimensions;
  - the transaction currency and amount;
  - the book (SYP) amount and the parallel (USD) amount, each with the quoted rate used;
  - a memo.
- Every entry balances in both ledgers. A conversion rounding difference goes to the rounding account, and exchange differences post as difference lines (ADR 0007).
- Gapless numbers per company and fiscal year, given at posting; the accounting date and the posting time are both stored (ADR 0008).
- The source is stored on every entry: manual, Hub event, opening, revaluation or revenue release. Hub entries link back to the Hub document.
- Attachments on entries, stored per company (ADR 0008).
- Optional approval per company: a manual entry is posted only after another user with the Approver role approves it.
- A posted entry is never changed or deleted. A correction is a reversal that references the original.

### F06 Open items (subledgers)
- Receivables open per Hub invoice, and client ad funds open per client.
- Settlement by payment events, with the realised exchange difference in each ledger.
- Contract assets per project milestone (work done, not yet invoiced).
- Receivables by client and invoice, with ageing.

### F07 Revenue recognition (IFRS 15)
The rules are in §6.
- Recognition schedules are created from Hub invoice lines; milestone revenue is recognised when Hub reports the milestone done.
- Release entries are posted automatically at month end, dated in the month they belong to.
- A list of items needing the accountant's decision: late invoices whose service period is closed, the deposit left over on a cancelled project, and lines whose pattern is unclear.

### F08 Month-end revaluation
- In each ledger, monetary balances (accounts and open items, contract assets included) in other currencies are revalued at that ledger's policy rate for the month end (ADR 0007).
- The accountant previews each ledger's entry and posts it; it reverses on the first day of the next month.
- Non-monetary items, such as contract liabilities, are not revalued.

### F09 Periods and close
- Monthly periods with the states open, closed and reopened. Close and reopen need a reason and are written to the audit log.
- A checklist must pass before close:
  - the reconciliation is clean;
  - no held events;
  - no drafts or unapproved entries;
  - the revenue releases are posted;
  - the bulletin and market rates of the month are entered;
  - both ledgers' revaluations are posted and current (no stale revaluation, ADR 0007).
- The period status is served to Hub through the API, so Hub refuses changes dated inside a closed period.
- Year-end close is phase 2.

### F10 Posting API for Hub
Details in the Hub API contract ADR (step 4).
- A versioned API `/v1`: one events endpoint with a typed contract per event type and version, published as an OpenAPI document (ADR 0006).
- **Exactly once:** an idempotency key from the Hub event. The same key with the same payload returns the first result; the same key with a different payload returns `409`.
- **Posting rules owned by Mizan.** For each event type, the accounts are mapped in a screen the accountant maintains, and each rule has its scenario in the scenario book.
- **Event inbox** with the states received, posted and held, and the reason for each hold (ADR 0008: `PERIOD_CLOSED`, `SERVICE_PERIOD_CLOSED`, `UNKNOWN_REFERENCE`, `NO_MAPPING`, `RATE_MISSING`, `NEEDS_DECISION`). A held event is retried once its reason is fixed.
- **Closed period:** an event dated inside a closed period is held (`202`, `PERIOD_CLOSED`). The accountant posts it on the first day of the next open period or reopens the period.
- **Optional tax lines** on invoice lines (ADR 0008); no tax posting rule until the law applies.
- **History replay:** Hub's events since 2026-10-19 go through the same endpoints.
- **API clients** per company with scoped keys, rotation and the date each key was last used.

### F11 Daily reconciliation
- Every day, Hub sends its counts and totals per event type and day.
- Mizan compares them with what it received and posted, and lists every difference down to the event.
- The pre-close checklist uses the result.

### F12 Opening balances
- A wizard for 2026-10-01: account balances, open receivables per Hub invoice, client ad funds per client, and equity as the balancing figure, each with its SYP book amount and its USD parallel amount.
- Summarised manual entries for 1–18 October 2026 from the existing records.
- Checked against Hub's open invoices and wallet balances.

### F13 Reports
Every report can be exported to Excel and PDF, and every figure drills down to its entries and to the Hub document.
- **Trial balance:** by level, for any period, comparative, in the SYP books and in the USD parallel ledger, read from the period balances (ADR 0008).
- **General ledger and account statement,** in the account's currency too.
- **Journal book (دفتر اليومية)** in Arabic, printed by accounting date then number, with sequential page numbers. The Commercial Code requires a chronological journal in Arabic, numbered and certified (arts. 16–19, REPORTED).
- **Basic income statement and balance sheet** from the statement lines, with a comparative period; contract assets and liabilities netted per contract (project or retainer).
- **Profitability by client, project, department and service.** Ad funds are outside revenue, and pass-through items are outside service profit.
- **Receivables and ageing** (F06).
- **Contract liabilities, contract assets and the revenue release schedule** (F07), with the contract position netted per contract, a project or a retainer (IFRS 15.105).

### F14 Trust and data
- **Integrity chain:** each posted entry stores a hash of its content and of the previous posted entry of the company. The "integrity check" report recomputes the chain and shows any break.
- **Daily anchor:** every day the owner receives by email each company's chain head, entry count and date; the integrity check compares the chain with these anchors (ADR 0008).
- **Full export of a company's data** that the owner can keep.
- **Scenario book:** every posting rule, recognition rule and revaluation rule has a solved example in `docs/scenarios/` that runs as an automated test.

## 6. Accounting treatment of Hub events

Accounts named here are template accounts; the accountant can remap them (F10). Each rule becomes a scenario in the scenario book before it is implemented.

### Invoices
- **Retainer cycle charges** (invoice lines from monthly, addition or credit charges):
  - **At issue:** Dr Trade receivables / Cr Contract liabilities (deferred revenue).
  - **Release:** recognised **evenly over the days of the cycle** (`cycle_start` to the cycle end). At each month end, the days of that month are released: Dr Contract liabilities / Cr Service revenue, dated in that month.
  - **Late issue:** when part of the cycle has already passed, the elapsed days are recognised in the months they belong to, as long as those months are open. Because no invoice existed then, those releases post Dr Contract assets / Cr Service revenue. The issue entry then credits that contract asset for the elapsed part and contract liabilities for the rest. If any of those months is closed, the invoice is held (`SERVICE_PERIOD_CLOSED`) for the accountant's decision.
  - **Releases carry the amounts booked at issue** in both ledgers, split with cumulative rounding; they are never converted again (ADR 0007).
  - **Credit lines** relate to a cycle. For the part of that cycle already recognised, revenue is reduced on the credit's date (cumulative catch-up, IFRS 15.88). The rest reduces the part of the schedule not yet released. Parts already released are never rewritten.
- **Termination fee:** revenue at issue (no service is left to deliver).
- **Project deposit** (the invoice drafted at quote acceptance, before any work):
  - **At issue:** Dr Trade receivables / Cr Contract liabilities.
  - **Release:** when Hub reports a milestone done, deposit × (the milestone's installment / the total of the project's non-deposit installments) is released to revenue, dated on the milestone's done date.
  - **Completed project:** any remainder is released.
  - **Cancelled project:** the remainder goes to the accountant's decision list (refund liability or revenue).
- **Milestone done** (`milestone.done`): revenue for the milestone's installment, dated on the done date: Dr Contract assets / Cr Service revenue (IFRS 15.107).
- **Milestone invoice issued:** Dr Trade receivables / Cr Contract assets for the invoice line's amount, up to the milestone's open contract asset in its currency (the project's currency is fixed in Hub).
  - **Differences in that currency** (the invoice differs from the installment) are a change in the transaction price (IFRS 15.87–88). The invoice is held (`NEEDS_DECISION`) for the accountant.
  - **Differences in a ledger** that remain once the contract asset is fully cleared post as exchange differences.
  - **Contract assets are monetary** (a fixed amount of currency still to be invoiced, IAS 21.16) and are revalued.
- **Extra work** and **manual invoices:** revenue at issue, since the work is delivered. A manual line can be marked as deferred, with a service period.
- **Invoice voided:** the reversal of the issue entry and of any release already posted, dated on the void date.
- **Service changed on a line:** a reclassification entry for the revenue already recognised, dated on the change date; the part not yet released follows the new service prospectively.

### Payments
- **Payment recorded:** Dr the account of the payment method in the payment's currency (cash, bank transfer, e-wallet) / Cr Trade receivables (the invoice's open item). In each ledger, any difference between the open item's carrying amount and the payment's amount in that ledger posts to realised exchange gain or loss (ADR 0007).
- **Payment voided:** the reversal; the open item reopens.

### Expenses
- **Project expense:** Dr Direct project costs (project, client and department dimensions) / Cr "Project expenses awaiting payment source", which the accountant settles by a manual entry.
- **Expense edited:** the reversal of the previous entry and a new entry.
- **Expense archived:** the reversal.

### Ad budget
- **Wallet deposit:** Dr the account of the payment method / Cr Client ad funds held (client open item, USD). A deposit paid in SYP for a USD credit leaves a residual in a ledger, which posts as a realised exchange difference (ADR 0007).
- **Refunds and spend** clear the client's funds at their average carrying amount. A voided deposit posts its exact reversal and an exchange-difference entry that restores the carrying amount (ADR 0007).
- **A negative wallet** (spend beyond deposits, or a deposit voided after spend) is allowed: the client's funds account turns into a debit balance, the client owes the agency, and the balance sheet shows it as a receivable from that client (ADR 0007). Scenarios: a void after spend, and a spend that crosses zero.
- **Refund:** the opposite entry.
- **Void:** the reversal.
- **Spend** (only for campaigns funded from the wallet): Dr Client ad funds held / Cr Ad platforms payable, which the accountant settles when the platform is paid. An edit or an archive becomes a reversal and a new entry. Campaigns the client pays directly post nothing.

### Events that post nothing
- **Due date changed:** updates the open item's due date for ageing.
- **Retainer charge settled outside, and quotes:** nothing.

## 7. What Hub must send

Hub's side is built in Hub's own sessions (Hub ADR 0035, F18). Phase 1 needs:

1. The outbox and worker, the versioned calls with the event ID as the idempotency key, and the retry.
2. The events in §6, each with:
   - the company;
   - the event date (the accounting date);
   - the currency, minor units and rate;
   - optional tax lines on invoice lines (ADR 0008);
   - the dimensions: client, project or retainer, department code, service;
   - the Hub document ID and number.
3. For invoice lines, the recognition facts:
   - the line source (retainer charge with its kind, its cycle start and end, deposit milestone, milestone, extra work, manual);
   - for project lines, the project ID, the milestone ID and installment, and the project's non-deposit total;
   - for retainer credit lines, the cycle they relate to.
4. New events: `milestone.done` (the milestone ID, the installment amount and currency, and the done date, the milestone's revenue date) and `project.completed` / `project.cancelled`.
5. A rate event when Hub's SYP/USD rate changes.
6. The daily reconciliation call (counts and totals per event type and day).
7. Before any change dated in the past, a period-status check, and handling of `202 held` responses.
8. The replay of all history since 2026-10-19.

## 8. Not in phase 1

- Cash boxes, banks, transfers and exchange; suppliers and payables; general and recurring expenses (phase 2).
- Year-end close, cash-flow statement and notes (phase 2).
- Consolidation across companies (later).
- Tax posting rules, e-invoicing and the tax authority's QR linkage (when the law applies; the inquiry about program approval opens in phase 1).
- Sales, purchases, inventory, installments (phase 3).
- Recurring and auto-reversing manual entries; import from Excel or Al-Ameen (later).
- A read API for Hub screens and webhooks to Hub (with Hub F18).
- An English interface. The interface is Arabic, with every text in translation files; account names are in Arabic and English.
- Old-pound history and redenomination tools (phase 4 onboarding; Vertex Media's books start after 2026-01-01).
- Payroll, purchases for clients and employee advances. They post when Hub V2 sends them, each with its own scenario.
- An IAS 21.39 presentation translation report (later); IAS 29 hyperinflation accounting.

## 9. Delivery

- **Address:** `mizan.vertexmedia.pro`, on the existing Vertex server. Register `vertexmizan.com` before selling (phase 3).
- **Build order:** fixed in the roadmap after the technical ADRs. Expected order:
  1. data model and invariants;
  2. tenancy and access;
  3. chart, dimensions and rates;
  4. entries;
  5. API and inbox;
  6. revenue recognition and revaluation;
  7. periods and reconciliation;
  8. reports;
  9. opening balances and replay;
  10. production.

## 10. The owner's answers (2026-10-20)

| # | Question | Answer |
|---|---|---|
| Q1 | Functional currency | USD (superseded on 2026-10-20 by A2 below) |
| Q2 | Start of the books | 2026-10-01 opening balances; Hub replay since 2026-10-19 |
| Q3 | Revenue timing | IFRS 15 |
| Q3a | Retainer cycles | Evenly over the days of the cycle |
| Q3b | Project deposit | Released in proportion to milestones done |
| Q4 | Ad budget | Client money held |
| Q5 | Who chooses accounts | Mizan's posting rules |
| Q6 | Payment destination | One account per payment method |
| Q7 | Project expense credit | A clearing account settled by the accountant |
| Q8 | Event in a closed period | Refused and held for the accountant |
| Q9 | Users | The owner, an internal accountant, an external accountant or office, management readers |
| Q10 | Statements | Basic income statement and balance sheet in phase 1 |
| Q11 | Profitability | Mizan's screens; the read API for Hub comes with Hub F18 |
| Q12 | Companies | Vertex Media and test companies |
| Q13 | Address | `mizan.vertexmedia.pro` now |
| Q14 | Languages | Arabic, ready for translation |
| Q15 | Chart of accounts | Numbered, hierarchical, IFRS-classified |
| Q16 | Approval of manual entries | Optional per company |
| Q17 | Month-end revaluation | In phase 1, automatic and reversing |
| Q18 | Revaluation rate | The market rate the company deals at |

### After the foundation audit (2026-10-20)

| # | Question | Answer |
|---|---|---|
| A1 | Meaning of the third amount | A full parallel ledger with its own exchange differences and revaluation (ADR 0007) |
| A2 | Vertex Media's book currency | SYP statutory books with a parallel USD ledger; SYP is the default for every company |
| A3 | Rates | A policy per ledger: the bulletin for the statutory books, the market rate for the parallel ledger |
| A4 | Journal numbering | Posting order; printed by accounting date then number; `posted_at` stored |
| A5 | Revenue cut-off | Dated when delivered; contract assets for milestones; late invoices into closed months are held |
| A6 | Tax | Optional tax lines in the contract and tax accounts in the templates now; program-approval inquiry in phase 1 |
| A7 | 1–18 October 2026 | Summarised manual entries from existing records |
| A8 | Integrity anchor | A daily email of each company's chain head to the owner, in phase 1 |
| A9 | Owner approval before merge | Stays a written rule (no CODEOWNERS) |
| A10 | Backup ADR | Before the first production deploy |
| A11 | Hosting statement for customers | Decided later |
| A12 | Versions | PostgreSQL 17, Node 24 |
| A13 | Phase order (accounting offices, cheques) | Decided when phase 2 is detailed |
