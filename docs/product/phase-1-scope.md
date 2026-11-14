# Phase 1 scope: the core for a contracting client

- **Date:** 2026-10-20 · **Status:** approved by the owner (2026-10-20); revised the same day after the foundation audit (`docs/audits/2026-10-foundation-audit.md`); revised on 2026-11-13 by ADR 0021, a stand-alone system without Hub.
- **Decisions:** ADR 0001 and ADR 0021, ADRs 0007, 0008 and 0011 (the chart, the contract dimension and the bulletin rate, which refine F02–F04 below); the owner's answers to `docs/product/phase-1-analysis.md` §6 and to the audit, recorded in §10 below.
- **Labels:** Syrian legal or tax facts carry CONFIRMED, REPORTED or UNVERIFIED (`docs/research/market-syria.md`).
- **History:** the Hub integration (F07, F10, F11, §6, §7 and Hub's parts of the other sections) was withdrawn by ADR 0021. The text that the superseded ADRs 0006, 0014, 0015 and 0017 and the specs S05, S06 and S08 cite is in git history at commit `1a0ee40` (`git show 1a0ee40:docs/product/phase-1-scope.md`).

## 1. Goal

A contracting client's books are kept in Mizan, one company per business, entered in Mizan itself (owner, 2026-11-13). Nothing posts from another system. The core serves any number of companies.

The client's first needs, from the owner's notes (ADR 0021):
- the income and the expenses of a construction project, in detail;
- the wages of workers and craftsmen;
- the materials, item by item;
- amounts in US dollars and in Turkish lira;
- several businesses, each kept apart from the others;
- a copy of the data the client keeps on a USB drive (the full export, F14).

## 2. Done when

Proposed, settled with the specs:
1. the client's first company is created with its chart (N5);
2. N1–N4 are in use on it;
3. a real month is closed in Mizan, both ledgers revalued, and the trial balance, income statement and balance sheet read by the owner;
4. the client keeps the full export (F14);
5. the ledger invariants, tenant isolation and the scenario book pass in CI.

## 3. Users and companies

- **Companies:** one per business of the client, and test companies. Any number of companies under one login, each fully isolated. Vertex Media's production company is archived with its data kept (ADR 0021).
- **People:** the owner, an internal accountant, an external accountant or office, and management readers. One person can belong to several companies, with a role in each.

| Role | Can |
|---|---|
| Owner | Everything in the company, including users, settings and periods |
| Accountant | Chart of accounts, entries (draft, post, reverse), rates, revaluation, close and reopen periods if the owner allows |
| Approver | Approve manual entries when approval is switched on (F05) |
| Viewer | Read reports |
| Auditor | Read everything, including the audit log and the integrity check; change nothing |

## 4. Accounting policies

Each company chooses its own currencies, rate policies and books start when it is created (ADR 0021 §4). The rest holds for every company.

| Policy | Decision |
|---|---|
| Book currency | Chosen per company (`--book-currency`); SYP (the new Syrian pound) by default, for statutory books, journal, statements and tax return (ADR 0007). The contracting client's books are in USD at the market rate accepting dealt rates, with a parallel SYP ledger at the bulletin (owner, 2026-11-14; S11). |
| Parallel currency | Optional per company: a full parallel ledger with its own exchange differences and revaluation (ADR 0007), or none (`--no-parallel`). |
| Rate policy | Per ledger (ADR 0007): the **Central Bank bulletin** rate of the accounting date, or the **market rate the company deals at**, which may accept the rate a manual entry was dealt at (IAS 21.21–22, 21.26). The reasoning is recorded as the company's policy note. |
| Fiscal year and periods | The calendar year (Income Tax Law 24/2003, CONFIRMED), with monthly periods. |
| Start of the books | The first day of a month, chosen per company, with manual opening balances (F12, S10, ADR 0019 as amended by ADR 0021). |
| Month-end revaluation | In each ledger, monetary balances in other currencies are revalued at month end (IAS 21.23) at that ledger's policy rate. Each entry reverses on the first day of the next month. |
| Exchange differences on settlement | Realised gains and losses in each ledger when a receivable or payable is settled (IAS 21.28), as difference lines carrying an amount in that ledger only. |
| Chart of accounts | Numbered and hierarchical, four levels: 1 assets, 2 liabilities, 3 equity, 4 revenue, 5 expenses. Classified for IFRS presentation, with Arabic and English names. |
| Approval of manual entries | Optional per company (F05). |
| Tax | No tax posting rules in phase 1. The templates carry tax accounts, ready for the reform the Ministry of Finance is preparing for the start of 2027 (CONFIRMED, SANA, 2026-10-11). |
| Journal order | Gapless numbers in posting order; the journal book printed by accounting date then number, in Arabic (Commercial Code arts. 16–19, REPORTED; ADR 0008). |
| Hyperinflation | IAS 29 is out of scope (Syria is on watch lists, not on the hyperinflation lists; REPORTED). |

**Open (UNVERIFIED):** whether the tax authority requires the bulletin rate for the statutory books, and whether Decrees 5 and 6 of 2024 on foreign-currency dealing affect foreign-currency invoicing (open question Q1). A Syrian certified auditor confirms a company's SYP-book, bulletin-rate policy before its tax return; whether the client needs statutory books in SYP is open (ADR 0021 "Open").

## 5. Features

IDs are referred to by specs, the roadmap and the scenario book. A withdrawn ID is never reused.

### F01 Companies, users and access
- Companies with their book currency, optional parallel currency, the rate policy of each ledger, the policy note, the fiscal year start and enabled modules (all optional modules are off in phase 1).
- Users with membership in several companies; a company switcher; the roles in §3.
- Sign-in with two-factor authentication required for every role (owner, 2026-10-26; S01).
- Isolation enforced by the database (forced row-level security); every endpoint tested with a user of another company.
- An audit log that can only be appended to, showing who did what, when and from where, with before and after values.
- A company is archived, never deleted: read-only, its data kept (S01 rule 12).

### F02 Chart of accounts
- Headers and postable accounts in a numbered tree of up to four levels; Arabic and English names.
- Each account has a class, a normal balance and a statement line (for the income statement and the balance sheet).
- Flags on each account:
  - an optional currency restriction;
  - control account (open items per counterparty and document);
  - monetary or non-monetary, which decides revaluation;
  - required dimensions.
- Accounts are blocked or archived, never deleted once used.
- A general template; a contracting template (N5).

### F03 Dimensions
- Dimension types per company: client, contract (a project or a retainer, ADR 0011), department and service; the accountant adds values by hand.
- Required-dimension rules per account; for example, direct project costs require contract.

### F04 Currencies and rates
- ISO 4217 currencies; integer minor units; exact decimal rates.
- A dated rate table per company and currency pair, with the rate type (market, Central Bank bulletin), entered by the accountant. A bulletin rate is in force on a date only if it is effective on or after the latest publication day on or before that date (ADR 0011): a working day needs its own bulletin, and a day off takes the bulletin of the last publication day before it. When that publication day has no bulletin, the rate is missing (`RATE_MISSING`).
- The rate policy per ledger (ADR 0007).
- SYP is the new Syrian pound and is labelled "الليرة السورية الجديدة" on printed reports.

### F05 Journal entries
- Manual entries: draft, post, reverse, copy. A fast keyboard entry screen.
- Each line has:
  - the account and its dimensions;
  - the transaction currency and amount;
  - the book amount and the parallel amount, each with the quoted rate used;
  - a memo.
- Every entry balances in both ledgers. A conversion rounding difference goes to the rounding account, and exchange differences post as difference lines (ADR 0007).
- Gapless numbers per company and fiscal year, given at posting; the accounting date and the posting time are both stored (ADR 0008).
- The source is stored on every entry: manual, opening or revaluation. Entries posted from Hub before ADR 0021 keep their source and stay readable.
- Attachments on entries, stored per company (ADR 0008).
- Optional approval per company: a manual entry is posted only after another user with the Approver role approves it.
- A posted entry is never changed or deleted. A correction is a reversal that references the original.

### F06 Open items (subledgers)
- Open items on control accounts for manual entries: suppliers', contractors' and workers' balances, and receivables (ADR 0021 §3).
- Settlement by manual entries, with the realised exchange difference in each ledger.
- Balances by counterparty and document, with ageing.

### F07 Revenue recognition — withdrawn (ADR 0021)

### F08 Month-end revaluation
- In each ledger, monetary balances (accounts and open items) in other currencies are revalued at that ledger's policy rate for the month end (ADR 0007).
- The accountant previews each ledger's entry and posts it; it reverses on the first day of the next month.
- Non-monetary items are not revalued.

### F09 Periods and close
- Monthly periods with the states open, closed and reopened. Close and reopen need a reason and are written to the audit log.
- A checklist must pass before close:
  - no drafts or unapproved entries;
  - the bulletin and market rates of the month are entered;
  - both ledgers' revaluations are posted and current (no stale revaluation, ADR 0007).
- Year-end close is phase 2.

### F10 Posting API for Hub — withdrawn (ADR 0021)

### F11 Daily reconciliation — withdrawn (ADR 0021)

### F12 Opening balances
- A wizard for the books start: account balances, open items per counterparty and document, and equity as the balancing figure, each with its book amount and its parallel amount (S10).

### F13 Reports
Every report can be exported to Excel and PDF, and every figure drills down to its entries.
- **Trial balance:** by level, for any period, comparative, in the book ledger and in the parallel ledger, read from the period balances (ADR 0008).
- **General ledger and account statement,** in the account's currency too.
- **Journal book (دفتر اليومية)** in Arabic, printed by accounting date then number, with sequential page numbers. The Commercial Code requires a chronological journal in Arabic, numbered and certified (arts. 16–19, REPORTED).
- **Basic income statement and balance sheet** from the statement lines, with a comparative period.
- **Profitability by client, contract (project or retainer), department and service.**
- **Open items and ageing** (F06).

### F14 Trust and data
- **Integrity chain:** each posted entry stores a hash of its content and of the previous posted entry of the company. The "integrity check" report recomputes the chain and shows any break.
- **Daily anchor:** every day the owner receives by email each company's chain head, entry count and date; the integrity check compares the chain with these anchors (ADR 0008).
- **Full export of a company's data** that the owner can keep; the client keeps it on a USB drive (ADR 0021 §8).
- **Scenario book:** every posting rule and revaluation rule has a solved example in `docs/scenarios/` that runs as an automated test.

### Added by ADR 0021
Specified with the owner (`/spec`) before they are built, in two specs (owner, 2026-11-14), and each posting rule has its own scenario approved by the owner (`/posting-rule`). The IDs N1–N5 stay the features' names inside the specs.
- **S11 The contracting chart and cash boxes:**
  - **N5 A contracting chart template.**
  - **N1 Cash boxes:** receipts and payments in any currency.
- **S12 Project costs:**
  - **N2 Expenses by project.**
  - **N3 Wages** of workers and craftsmen.
  - **N4 Materials** with quantities, as lines of a project cost when materials go straight to the project. If the client keeps materials in a store and issues them later, N4 is inventory (IAS 2) and gets a spec of its own (Q19).

## 6. Accounting treatment of Hub events — withdrawn (ADR 0021)

## 7. What Hub must send — withdrawn (ADR 0021)

## 8. Not in phase 1

- Banks, transfers and exchange beyond the cash boxes (N1); recurring expenses (phase 2).
- Year-end close, cash-flow statement and notes (phase 2).
- Consolidation across companies (later).
- Tax posting rules, e-invoicing and the tax authority's QR linkage (when the law applies; the inquiry about program approval opens in phase 1).
- Sales, purchases, inventory valuation, installments (phase 3).
- Recurring and auto-reversing manual entries; import from Excel or Al-Ameen (later).
- An integration with another system, an installed desktop version and work without a connection (ADR 0021).
- An English interface. The interface is Arabic, with every text in translation files; account names are in Arabic and English.
- Old-pound history and redenomination tools (phase 4 onboarding).
- An IAS 21.39 presentation translation report (later); IAS 29 hyperinflation accounting.

## 9. Delivery

- **Address:** `mizan.vertexmedia.pro`, on the existing Vertex server (ADR 0020). Register `vertexmizan.com` before selling (phase 3).
- **Order:** the roadmap's "Phase 1, revised" section: the removal of Hub, S11 (N5 and N1), S12 (N2–N4), then the client's first company in production.

## 10. The owner's answers (2026-10-20)

Other files cite these as "scope Q<n>" and "scope A<n>"; a bare `Q<n>` is a question of `docs/open-questions.md`. They are kept as the record of the decisions; the answers about Hub (Q2's replay, Q3–Q8, Q11, A5 and A6's contract) were withdrawn with it by ADR 0021.

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
