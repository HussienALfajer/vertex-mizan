# Phase 1 analysis: the core and the posting API

- **Date:** 2026-10-20 · **Status:** answered by the owner (2026-10-20). The answers and the resulting scope are in `docs/product/phase-1-scope.md`; where this analysis differs, the scope wins: IFRS 15 deferral, revaluation in phase 1, and, after the foundation audit, SYP statutory books with a USD parallel ledger (ADR 0007). Event names here are Hub's internal names; the contract names are in ADR 0006.
- **Inputs:** ADR 0001, `docs/product/vision-and-phases.md`, `docs/research/market-syria.md`, `docs/research/working-method.md`, Hub ADRs 0006, 0024, 0025, 0027, 0035, Hub `v2-scope.md` (F18, F19) and the Hub schema (read-only, 2026-10-20).

## 1. Goal and done-when

**Goal:** Vertex Media's books are kept in Mizan, fed by Vertex Hub.

**Done when:**
- Hub posts its financial events to Mizan in production;
- the daily reconciliation shows no gap;
- Vertex Media's accountant closes a real month in Mizan and reads its trial balance and profitability by client, project, department and service.

## 2. What Hub sends today

Hub V1 is in production since 2026-10-19 and has no integration code yet. Its money follows Hub ADR 0006:
- amounts are integer minor units (`bigint`);
- currencies are `USD` and `SYP`, both with 2 decimals;
- the rate is SYP per 1 USD, `numeric(12,4)`, carried on each document;
- all IDs are UUIDv7;
- departments are identified by fixed codes;
- nothing is hard-deleted: documents are voided with a reason, or archived.

| Hub event | Accounting meaning | Notes |
|---|---|---|
| `invoice.issued` | Receivable and revenue | Issued by a person. Lines carry an optional service and come from a milestone, a retainer charge or extra work. A retainer credit line can be negative. No tax, no invoice discount. |
| `invoice.voided` | Cancels the issue entry | Allowed only with no live payments. Hub has no credit notes: a wrong invoice is voided and reissued. |
| `invoice_line.service_changed` | Reclassification between services | Dimension only; it can happen after issue. |
| `invoice.due_date_changed` | None (receivable ageing only) | — |
| `payment.recorded` | Cash in, receivable settled | Has its own currency and rate, so a USD invoice can be paid in SYP. Method: cash, bank transfer or e-wallet; no cash box yet. Partial payments are allowed, overpayments are refused, and each payment belongs to one invoice. |
| `payment.voided` | Cancels the payment entry | — |
| `project_expense.created` / `.updated` / `.archived` | Direct project cost | Has an amount, currency, rate and date, but **no supplier and no payment source**. It can be edited freely, amount and date included. |
| `ad_wallet.deposit` / `.refund` / `entry.voided` | Client money held for ad spend | USD. Not revenue (Hub ADR 0025). |
| `ad_campaign_update.created` / `.updated` / `.archived` | Client money spent on a platform | A periodic USD estimate entered by hand, editable afterwards. Only for campaigns funded from the wallet. |
| Hub rate change | Reference data | Hub's current SYP/USD rate. |

Planned in Hub V2: purchases for clients (pass-through and resale), payroll with shares and commissions, cash boxes picked on payments, employee advances. Hub open question Q17 recommends replaying all Hub history since 2026-10-19 through the posting API.

## 3. Proposed accounting treatment of Hub events

Pending the owner's answers (section 6). "Functional currency" is the currency the company's books balance in (Q1).

1. **Invoice issued:** Dr Trade receivables (open item per invoice, client dimension) / Cr Service revenue (one line per invoice line, with client, project, department and service dimensions). Revenue timing depends on Q3.
2. **Invoice voided:** a reversal of the issue entry, dated on the void date, referencing the original. A posted entry is never changed.
3. **Service changed on a line:** a reclassification entry (Dr revenue for the old service / Cr revenue for the new one), dated on the change date.
4. **Payment recorded:** Dr the cash, bank or e-wallet account (Q6) / Cr Trade receivables, settling the invoice's open item. When the invoice and the payment are in different currencies, or carry different rates, the receivable is cleared at its carrying amount and the difference posts to **realised exchange gain or loss** (IAS 21.28).
5. **Payment voided:** a reversal of the payment entry, which reopens the open item.
6. **Project expense:** Dr Direct project costs (project, client and department dimensions) / Cr the account chosen in Q7. An edit becomes a reversal of the previous entry plus a new entry; an archive becomes a reversal.
7. **Ad wallet deposit:** Dr cash or bank / Cr **Client ad funds held** (a liability, client dimension). A refund is the opposite entry; a void is a reversal (Q4).
8. **Ad spend:** Dr Client ad funds held / Cr Ad platforms payable (a clearing account settled when the platform is paid). An edit or an archive becomes a reversal plus a new entry.
9. **Rates:** every Hub event carries the rate actually used; Mizan stores it with the entry. Reports never use today's rate for past entries.

## 4. Rules applied without a question

These follow from the standards or from approved decisions:
- **Every entry balances** in the functional currency.
- **A posted entry is never edited or deleted.** Corrections are reversals that reference the original.
- **Closed periods:** no posting is dated inside a closed period.
- **Audit log:** every action is in a log that can only be appended to.
- **Exact posting:** each Hub event posts exactly once, keyed by Hub's event ID.
- **Money:** integer minor units, an ISO 4217 code and exact decimal rates. SYP means the new Syrian pound and is labelled "الليرة السورية الجديدة" on printed documents.
- **Fiscal year:** the calendar year (Income Tax Law 24/2003, CONFIRMED), with monthly periods.
- **Entry numbers:** gapless per company and fiscal year, given at posting; drafts have no number.
- **No tax in phase 1:** Hub has none, and the Syrian tax reform expected in 2027 is a draft (REPORTED).
- **No unrealised revaluation:** month-end revaluation of foreign-currency balances (IAS 21.23) is phase 2, with the cash and bank accounts.

## 5. Feature catalogue

**P1** = proposed for phase 1 · **Later** = a later phase · **Opt** = optional in phase 1, the owner decides.

### 5.1 Companies, users and security
| Feature | Proposal |
|---|---|
| Several companies under one login, company switcher, full isolation (forced row-level security) | P1 |
| Roles: owner, accountant, viewer (management), auditor (read-only + audit log) | P1 |
| API clients per company (keys with scopes, rotation, last used) | P1 |
| Two-factor sign-in for owners and accountants | P1 |
| Signed-in devices and sessions (Hub ADR 0032 pattern) | Later |
| Maker-checker: a second person approves manual entries before posting | Opt (Q16) |
| Consolidation across companies | Later |

### 5.2 Chart of accounts and dimensions
| Feature | Proposal |
|---|---|
| Hierarchical numbered chart (headers and postable accounts), Arabic and English names | P1 |
| Account classes and normal balance (asset, liability, equity, revenue, expense), mapped to statement lines | P1 |
| Chart templates: a service-agency template for Vertex Media and a general template | P1 (style: Q15) |
| Account currency restriction (for example a USD-only bank account) | P1 |
| Control accounts with open items per counterparty and document (receivables, client ad funds) | P1 |
| Generic dimensions: types per company (client, project, department, service), values created on the fly from Hub with their external IDs and names | P1 |
| Dimension rules per account (for example revenue requires client and service) | P1 |
| Account blocking and archiving (never deletion of a used account) | P1 |

### 5.3 Journal entries
| Feature | Proposal |
|---|---|
| Manual entries: draft, post, reverse, copy | P1 |
| Multi-currency lines: transaction amount, rate, functional amount, and a USD amount on every line (Q1) | P1 |
| Fast keyboard entry screen (accountants trained on Al-Ameen expect it) | P1 |
| Attachments on entries (receipts, contracts) | P1 |
| Source on every entry (manual, Hub event, opening balance) with a link back to the Hub document | P1 |
| Opening balances wizard | P1 |
| Recurring entries and auto-reversing accruals | Later |
| Import entries from Excel | Later (phase 4, migration) |

### 5.4 Currencies and rates
| Feature | Proposal |
|---|---|
| Dated rate table per company with its source (Central Bank bulletin, market, Hub, manual) | P1 |
| Rate entered by hand; the Hub rate received with each event | P1 |
| Automatic fetch of the Central Bank bulletin | Later |
| Realised exchange differences on settlement | P1 |
| Month-end revaluation (unrealised differences) | Later (phase 2) |
| Old-pound history and the 2026-01-01 redenomination tools | Later (phase 4 onboarding), unless Q2 needs pre-2026 data |

### 5.5 Periods
| Feature | Proposal |
|---|---|
| Fiscal years and monthly periods; close and reopen with a reason and the audit log | P1 |
| Pre-close checklist: reconciliation clean, no drafts, no held events | P1 |
| The period status served to Hub so it refuses changes inside closed periods | P1 |
| Year-end close (profit to retained earnings, opening entry of the next year) | Later (phase 2) |

### 5.6 Reports
| Feature | Proposal |
|---|---|
| Trial balance: by level, by period, comparative, in the functional currency and in USD | P1 |
| General ledger and account statement (in the account's currency too) | P1 |
| Journal book (دفتر اليومية) printable with sequential page numbers, for the legal books (Commercial Code, REPORTED) | P1 |
| Profitability by client, project, department and service; pass-through and ad funds kept outside service profit | P1 |
| Receivables by client and invoice, with ageing | P1 |
| Basic income statement and balance sheet | Opt (Q10) |
| Drill-down from any figure to its entries and to the Hub document | P1 |
| Excel and PDF export of every report; full data export per company | P1 |
| Read API for profitability shown in Hub screens | Opt (Q11) |
| Dashboard (cash, receivables, revenue by month, top clients by margin) | Later |

### 5.7 Integration (Hub posting API)
| Feature | Proposal |
|---|---|
| Versioned API `/v1`, one endpoint per event type, typed contracts published as OpenAPI | P1 |
| Idempotency key from the Hub event: same key and payload return the first result; same key with another payload returns 409 | P1 |
| Posting rules owned by Mizan: an event-to-account mapping the accountant maintains (Q5) | P1 |
| Event inbox: received, posted, held (with the reason), with retry after the reason is fixed | P1 |
| Stable error code for a date inside a closed period, and the policy for late events (Q8) | P1 |
| Daily reconciliation: Hub's counts and totals per event type and day against Mizan's | P1 |
| Replay of Hub history since 2026-10-19 through the same API (Hub Q17) | P1 (depends on Q2) |
| Webhooks to Hub (period closed, event held) | Later; Hub reads the status by API in phase 1 |

### 5.8 Trust features (differentiators)
| Feature | Proposal |
|---|---|
| Database-enforced invariants (balance, immutability, closed periods, append-only audit, exact posting, isolation) | P1 |
| **Integrity chain:** each posted entry stores a hash of its content and of the previous entry; an "integrity check" report proves nothing was altered | P1 |
| Scenario book: every posting rule has a solved example that is also an automated test | P1 |
| Full export per company that a customer can keep | P1 |

## 6. Questions for the owner

Two follow-up questions were added after Q1 and Q3 were answered: the IFRS 15 patterns (Q3a, Q3b) and month-end revaluation with its rate (Q17, Q18). All answers: `phase-1-scope.md` §10.

| # | Question | Recommendation |
|---|---|---|
| Q1 | Vertex Media's functional (book) currency | SYP (new), the legal and tax currency. Every line also stores its USD amount at the transaction's rate, so management reports in USD (Hub ADR 0006) are exact and stable. |
| Q2 | When Vertex Media's books in Mizan start, and from what | Opening balances on 2026-10-01 from existing records, then Hub events replayed from 2026-10-19 (Hub Q17). A full-year start (2026-01-01) only if records for January–September exist and the 2026 tax return should come from Mizan. |
| Q3 | Revenue timing | At invoice issue, documented as the company's policy. Vertex Media is not required to report under IFRS (`market-syria.md` §4.5). Deferral of advance billing (IFRS 15) can be added later. |
| Q4 | Ad budget | Client money held (a liability), never revenue. Spend clears through an "ad platforms payable" account. |
| Q5 | Who chooses the accounts | Mizan: Hub sends business events, and Mizan's posting rules map them to accounts the accountant can change. |
| Q6 | Where a payment lands before cash boxes exist (phase 2) | One account per payment method (cash, bank transfer, e-wallet); Hub's cash box comes with phase 2. |
| Q7 | The credit side of a project expense with no payment source | A clearing account "project expenses awaiting payment source" that the accountant settles. |
| Q8 | An event dated inside a closed period | Refused with a stable code and held in Mizan's inbox; the accountant chooses to post it on the first day of the next open period. |
| Q9 | Who uses Mizan at Vertex Media | Depends on the owner; it sets the roles and the training needs. |
| Q10 | Statements in phase 1 | A basic income statement and balance sheet, since they come from the trial balance at small cost. |
| Q11 | Profitability in Hub screens | Mizan's own screens in phase 1; the read API for Hub comes with Hub F18. |
| Q12 | Companies in phase 1 | Vertex Media plus test companies. |
| Q13 | Web address | `mizan.vertexmedia.pro` now. Register `vertexmizan.com` before selling (phase 3). |
| Q14 | Interface languages | Arabic, built ready for translation; English when selling outside Arabic speakers. |
| Q15 | Chart-of-accounts style | Numbered and hierarchical (four levels), classified for IFRS presentation, with Arabic and English names. |
| Q16 | Approval of manual entries | One accountant posts directly, with the audit log; maker-checker can be switched on per company later. |
