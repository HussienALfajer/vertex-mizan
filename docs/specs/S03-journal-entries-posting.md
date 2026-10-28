# S03 — Journal entries and the posting function

Status: Approved (owner, 2026-10-28) · Date: 2026-10-28 · Features: `docs/product/phase-1-scope.md` F05, F14 · ADRs: 0003, 0005, 0007, 0008, 0011, 0012

## Summary
Mizan has a chart, dimensions and rates (S02) but no ledger. S03 builds the ledger itself: the append-only entry and line tables with every guard of ADR 0005 and 0008, the one posting function every later spec posts through, period balances, the integrity chain with its daily anchor, and the accountant's manual entries (draft, optional approval, post, reverse, copy, attachments) on a fast keyboard screen. It also brings the scenario book's setup, ledger reader and the `manual`, `reversal` and `rate` executors, so the approved `currency/` scenarios run, and the owner's full export of a company's data.

## In scope / out of scope
- In:
  - the ledger tables (entries, lines, line conversions, dimension sets, posting requests), the ledger head, the entry-number counters, the period rows (open only) and the period balances, all under forced RLS with the ADR 0005 and 0008 guards;
  - the posting function `post()` in `packages/db`, used by the API, the worker (S05–S07) and the scenario runner;
  - manual entries: drafts, submission and approval when the company switches approval on, posting, reversal, copy, attachments, dealt rates, the realised exchange-difference and rounding lines shown before posting;
  - the journal list, the entry page, an account's lines with running balances, the entries that used a rate row (S02 rule 15's list), the approval queue;
  - the integrity chain, the integrity check (with anchors), the daily anchor email;
  - the full export of a company's data (owner);
  - `books_started_at` and `chart_accounts.first_posted_at` set at posting (S01 rule 4, S02);
  - the scenario book's setup, ledger reader and `manual`, `reversal`, `rate` executors; the two `currency/` scenarios become `Approved (owner, 2026-10-27)`.
- Out (later or never):
  - manual lines on control accounts and open items (S04: open items and settlements). Until S04, a manual line on a control account is refused (`ACCOUNT_IS_CONTROL`);
  - Hub events, the inbox and posting rules (S05); revenue releases (S06); revaluation, closing and reopening periods and the pre-close checklist (S07). S03 creates period rows as open and checks the state; S07 closes them;
  - the printed journal book, the trial balance, the general ledger with exports, statements (S09). S03's screens read the same tables;
  - opening balances (S10);
  - manual lines with a book or parallel amount typed by hand, or with an amount in one ledger only: every manual line is a new measurement (ADR 0012); a one-ledger correction is a reversal and a repost;
  - recurring and template entries, entry import from Excel, a reversal scheduled on the first day of next month for manual accruals (phase 2).

## Access
New permission keys, appended to `PERMISSIONS` in `packages/contracts/src/access.ts`:

| Action | Surface | Who (permission) |
|---|---|---|
| Read posted entries, an account's lines, the entries of a rate row | Web | Every role (`entries.read`; owner 2026-10-28: viewers drill down from reports) |
| Read drafts and the approval queue | Web | Owner, accountant, approver, auditor (`drafts.read`) |
| Create, edit, copy, discard a draft; attach and remove files on a draft; submit | Web | Owner, accountant (`drafts.manage`) |
| Post a draft, or reverse a manual entry, when approval is off | Web | Owner, accountant (`entries.post`) |
| Approve or reject a submitted draft (approval on) | Web | Owner, approver (`entries.approve`), never the person who prepared or submitted it (owner, 2026-10-28) |
| Add an attachment to a posted entry | Web | Owner, accountant (`entries.attach`) |
| Switch approval of manual entries on or off | Web | Owner (`company.settings`, S01) |
| Run the integrity check; verify an anchor | Web | Owner, auditor (`integrity.read`; scope §3: the auditor reads the integrity check) |
| Request and download the full export | Web | Owner (`company.export`, `@Reauthenticated`; owner, 2026-10-28) |

Every company write carries `X-Mizan-Company` (S01 rule 22) and is refused on an archived company (`COMPANY_ARCHIVED`). The export request is the only new `@Reauthenticated` action.

## Data
All tables are company tables: `company_id`, forced RLS with `company_isolation`, `unique (company_id, id)`, composite company foreign keys, UUIDv7 ids, registered in `registry.ts` (ADR 0003). Money columns are `bigint` minor units with a currency code; rates `numeric(22,10)` as quoted (ADR 0007).

### A new table kind: `ledger-state`
Rows that summarise the append-only ledger and change only as it grows: the ledger head, the entry-number counters and the period balances (ADR 0012). The app role has `SELECT, INSERT, UPDATE` and no `DELETE` or `TRUNCATE`. A `BEFORE INSERT OR UPDATE` guard trigger (`ENABLE ALWAYS`, pinned in `GUARDS`) checks each change against the ledger, as stated per table below, so a direct write that does not follow an append is refused for every role. The convention test checks the grants and the triggers of the kind; the invariant tests try each forbidden write as `mizan_app`.

### The ledger (append-only; ADR 0005 invariant 2)

| Table | Fields | Keys and checks |
|---|---|---|
| `posting_requests` | `id`, `company_id`, `client` (`manual` · `system` · the API client id in S05), `idempotency_key` (text), `payload_hash` (SHA-256 hex), `created_at` | unique `(company_id, client, idempotency_key)` (invariant 5). Manual: the key is the draft id; a reversal: `reversal:<entry id>` |
| `journal_entries` | `id`, `company_id`, `request_id` → posting requests, `sequence` (bigint: its place in the company's chain, posting order), `fiscal_year` (smallint, named after the calendar year it starts in), `number` (int), `entry_date` (date), `posted_at` (timestamptz, the transaction time), `source` (`manual` · `hub_event` · `opening` · `revaluation` · `revenue_release`), `source_ref` (text, null: the inbox id or job run from S05–S07), `hub_document` (jsonb, null: type, id and number; S05), `description` (text 1–500, Arabic), `reference` (text, null, 1–100), `reverses_entry_id` (null) → entries, `draft_id` (null) → drafts, `prepared_by_user_id` (null), `approved_by_user_id` (null), `posted_by_user_id` (null), `posted_by_client_id` (null; S05), `line_count` (smallint), `previous_hash` (text, null for the company's first entry), `hash` (text) | unique `(company_id, fiscal_year, number)`; unique `(company_id, reverses_entry_id)` (invariant 3); unique `(company_id, request_id)`; unique `(company_id, hash)`; unique `(company_id, sequence)`; unique `(company_id, previous_hash)` with nulls not distinct; index `(company_id, entry_date, number)`; check: a person or a client posted it, not both |
| `journal_lines` | `id`, `company_id`, `entry_id` → entries, `line_no` (smallint, from 1), `account_id` → chart accounts, `dimension_set_id` → dimension sets, `kind` (`measured` · `carried` · `difference` · `rounding`), `ledger` (`book` · `parallel`, only on difference and rounding lines), `currency`, `amount_minor`, `book_minor`, `parallel_minor` (null exactly when the company keeps no parallel ledger), `memo` (text, null, 1–300) | unique `(company_id, entry_id, line_no)`; index `(company_id, account_id, entry_id)`; checks: `ledger` set exactly on difference and rounding lines; a one-ledger line has zero in the other ledger |
| `line_conversions` | `id`, `company_id`, `line_id` → lines, `ledger`, `basis` (`policy` · `transaction`), `quote_no` (1, or 1 and 2 for a cross), `rate_id` (null for a transaction rate) → exchange rates, `base`, `quote`, `rate`, `rate_type`, `rate_source`, `effective_on` | unique `(company_id, line_id, ledger, quote_no)`; index `(company_id, rate_id)` (S02 rule 15's list). One row per converted ledger amount of a measured line, two for a cross (ADR 0007, S02 "S03 must") |
| `dimension_sets` | `id`, `company_id`, `key` (the canonical sorted `type:value` list), `created_at` | unique `(company_id, key)`; the empty set has key `''` |
| `dimension_set_values` | `company_id`, `set_id` → sets, `type_id` → dimension types, `value_id` → dimension values | primary key `(company_id, set_id, type_id)` |

Guards, all `ENABLE ALWAYS` and pinned:
- `refuse_change()` on every table above (invariant 2).
- **Balance** (invariant 1, ADR 0008): a deferred constraint trigger on `journal_lines` checks, per entry, at least two lines, `line_count` equal to the lines, the sum of `book_minor` zero and, when kept, the sum of `parallel_minor` zero.
- **Reversal** (invariant 3): a deferred trigger checks that a reversal has the same number of lines as the original and that each line negates one original line exactly (account, dimension set, kind, ledger, currency and every amount), that the original is not itself a reversal and is dated on or before the reversal.
- **Period** (invariant 4): an insert trigger on `journal_entries` reads the period row of `entry_date` `FOR SHARE` and refuses a closed one (`PERIOD_CLOSED`).
- **Lines are valid** (invariant 8): an insert trigger on `journal_lines` checks the account is a postable leaf of the company, the currency restriction, the required dimension types present in the set, and no SYP amount dated before 2026-01-01. The posting function checks the same first (`checkLineAgainstChart`) to give clear errors.
- **Number and chain:** an insert trigger on `journal_entries` checks `number` equals the counter's `last_number` and `previous_hash` equals the head's `last_hash`, both already moved in this transaction (below).

### Ledger state (`ledger-state`)

| Table | Fields | Guard |
|---|---|---|
| `ledger_heads` | `id`, `company_id`, `entry_count` (bigint), `last_entry_id` (null), `last_hash` (null), `updated_at` | unique `company_id`; created with the company (migration for existing ones). An update must add exactly one to `entry_count` and set `last_entry_id`/`last_hash` to an entry of this transaction whose `previous_hash` is the old `last_hash` (checked deferred, once the entry exists) |
| `entry_number_counters` | `id`, `company_id`, `fiscal_year`, `last_number` | unique `(company_id, fiscal_year)`; inserted with `last_number = 1` or updated by exactly `+1`; never decreases |
| `periods` | `id`, `company_id`, `period` (`YYYY-MM`), `fiscal_year`, `state` (`open` · `closed`; S07 adds the transitions and their events), `created_at`, `updated_at` | unique `(company_id, period)`; S03 inserts `open` rows only; an update is refused until S07's close service brings its own guarded transition |
| `period_balances` | `id`, `company_id`, `period_id` → periods, `account_id`, `dimension_set_id`, `currency`, `debit_minor`, `credit_minor` (transaction), `book_debit_minor`, `book_credit_minor`, `parallel_debit_minor`, `parallel_credit_minor` (null without a parallel ledger), `line_count` | unique `(company_id, period_id, account_id, dimension_set_id, currency)`; written only by the `AFTER INSERT` trigger on `journal_lines` (the guard refuses any write at trigger depth 1, so only the line trigger reaches it; ADR 0012); totals never decrease |

A debit adds to the debit column and a credit to the credit column, by the sign of each amount separately, so a line with a credit transaction amount and a zero ledger amount adds nothing to that ledger. `rebuild_period_balances()` (a read-only query in `packages/db`) recomputes them from the lines; the integrity check and a property test compare the two.

### Drafts (`draft`; ADR 0005 "drafts are not ledger")

| Table | Fields | Keys and checks |
|---|---|---|
| `entry_drafts` | `id`, `company_id`, `state` (`draft` · `submitted` · `posted`), `entry_date`, `description` (null until submit), `reference` (null), `dealt_rates` (jsonb: `[{ base, quote, rate }]`, ADR 0012), `reverses_entry_id` (null: a reversal waiting for approval), `copied_from_entry_id` (null), `prepared_by_user_id`, `submitted_by_user_id` (null), `submitted_at` (null), `rejected_by_user_id` (null), `rejected_reason` (null), `rejected_at` (null), `posted_entry_id` (null), `created_at`, `updated_at`, `archived_at` (null: discarded), `archived_reason` (null) | index `(company_id, state, updated_at)`; check: `posted_entry_id` set exactly in `posted`; a posted or discarded draft never changes (trigger) |
| `entry_draft_lines` | `id`, `company_id`, `draft_id`, `line_no`, `account_id` (null while typing), `dimension_value_ids` (uuid[]), `currency`, `amount_minor` (non-zero, positive debit), `memo` (null) | unique `(company_id, draft_id, line_no)`; at most 500 lines a draft |
| `entry_attachments` (business) | `id`, `company_id`, `draft_id` (null), `entry_id` (null), `file_name`, `content_type` (`application/pdf`, `image/png`, `image/jpeg`, `image/webp`), `size_bytes` (≤ 10 MB), `sha256`, `storage_key` (`<company_id>/<id>`), `uploaded_by_user_id`, `created_at`, `updated_at`, `archived_at` (null), `archived_reason` (null) | at most 20 unarchived per draft or entry; a trigger allows only setting `entry_id` once (at posting, from the draft's) and archiving while `entry_id` is null (owner, 2026-10-28: removed from drafts, never from posted entries) |

`company_settings` gains `manual_entry_approval` (bool, default false), outside the settings lock.

### Trust and export
| Table | Kind | Fields |
|---|---|---|
| `chain_anchors` | append-only | `id`, `company_id`, `anchored_on` (date, Damascus), `entry_count`, `head_entry_id` (null), `head_hash` (null), `email_outbox_ids` (uuid[]), `created_at`; unique `(company_id, anchored_on)` |
| `company_exports` | queue | `id`, `company_id`, `requested_by_user_id`, `state` (`queued` · `ready` · `failed` · `expired`), `storage_key` (null), `size_bytes` (null), `sha256` (null), `error` (null), `expires_at` (null; ready + 24 h), `created_at`, `updated_at`; one `queued` per company at a time |

Files (attachments and exports) live on the server's disk under a company-scoped directory outside the web root (`MIZAN_FILES_DIR`), served only through the API (ADR 0008 "Attachments"); off-server copies are the backup ADR's (Q2).

## States and rules

### The posting function (ADR 0005, 0008)
1. `post(tx, request)` in `packages/db`, inside `withCompany`, is the only writer of the ledger tables (invariant 11; the convention test greps for inserts elsewhere). A request names its source, client and idempotency key, entry date, description, reference, the actor, and **what to post, never posted amounts**: line specifications that the function measures with `measuredLine()`, or an entry to reverse with `reverseLines()` (packages/ledger "Measured lines are built, never taken"). Later specs add their own specifications (carried lines for S04, rule lines for S05–S07) through the same function.
2. Order inside the transaction (ADR 0008 lock order):
   1. insert the posting request; a duplicate key with the same payload hash returns the first entry and posts nothing, a different hash is `IDEMPOTENCY_CONFLICT`;
   2. lock the company's ledger head `FOR UPDATE`, then the `company_settings` row `FOR UPDATE` (S01 edge case 3);
   3. find or create the period row of the entry date (`open`) and lock it `FOR SHARE`; closed → `PERIOD_CLOSED`;
   4. read the accounts, dimension values, rates in force and the bulletin calendar the lines need; check every line (`checkLineAgainstChart`, S02 rule 8);
   5. build the lines (`measure()`, `reverseLines()`), the realised exchange-difference lines of a manual entry in more than one currency (rule 13) and `balanceEntry()` last;
   6. take the next number of the fiscal year of the entry date (`fiscal_year_start_month`; owner, 2026-10-28), creating the counter at 1;
   7. compute the hash (`entryHash()` over the header, the lines with their conversions and dimension keys, and the previous hash);
   8. insert the entry, lines, conversions, dimension sets as needed, the audit row (`entry.posted`, one per posting), move the head; set `chart_accounts.first_posted_at` on each account's first line and `books_started_at` on the company's first entry;
   9. commit: the deferred triggers check balance, reversal, head and number.
3. Any refusal rolls back everything: no number is consumed (gapless, invariant 6), no request is stored.

### Manual entries (F05)
4. **A draft** is created empty, by copy (rule 10) or by reversal with approval on (rule 9). It is saved as typed; incomplete lines are allowed in a draft. Anyone with `drafts.manage` edits any draft of the company (a team works on one queue); every save is audited.
5. **Required to submit or post:** an entry date, a description (البيان, owner 2026-10-28), at least two complete lines (account, currency, a non-zero amount); dimensions as the accounts require; a reference and line memos are optional.
6. **Entry date** (owner, 2026-10-28): any date in an open period up to the last day of the current month in Asia/Damascus (`ENTRY_DATE_OUT_OF_RANGE` after it), never before 2026-01-01 for SYP (`SYP_BEFORE_REDENOMINATION`). The current month is the month at the moment of posting, not of drafting.
7. **Approval off:** a person with `entries.post` posts the draft; it becomes `posted` with `posted_entry_id`. The preview before posting shows every line in both ledgers, the rates, and any rounding or exchange-difference line the function will add (rules 12–13), computed by the same code with no write.
8. **Approval on** (owner, 2026-10-28): posting becomes "submit for approval". A submitted draft is read-only. An owner or approver who neither prepared nor submitted it (`APPROVER_IS_PREPARER`) approves it, which posts it at that moment with `approved_by_user_id`, or rejects it with a reason, which returns it to `draft` with the reason shown. The preparer may withdraw a submitted draft back to `draft`. Every manual entry and every manual reversal goes through approval; there is no threshold. Switching approval off leaves submitted drafts submitted: they are approved, rejected or withdrawn as before. A company where only one person could approve is the owner's to staff; Mizan explains the refusal and never bypasses it.
9. **Reversal** (owner, 2026-10-28): only an entry whose source is `manual` and which is not itself a reversal is reversed by hand (`ENTRY_NOT_REVERSIBLE`); Hub, revaluation, release and opening entries are reversed by their own process (S05–S07, S10). The accountant picks the reversal date: by default the original's date when its period is open, otherwise today; never before the original's date (`REVERSAL_BEFORE_ORIGINAL`) and within rule 6. A description is required (default "عكس القيد <number>: <reason>"). The reversal negates every line exactly, rounding and difference lines included, at the original amounts, never converted again (ADR 0007), so no rate is needed (`manualReversalLines()` in `packages/ledger` checks the source, the earlier reversal and the date, then `reverseLines()`). An entry is reversed once (`ENTRY_ALREADY_REVERSED`). With approval on, a reversal is a draft with `reverses_entry_id` and fixed lines, submitted and approved like any other.
10. **Copy:** a new draft with the original's lines (account, dimensions, currency, transaction amount, memo), description and reference, dated today; amounts are measured again at posting. Any posted manual entry, reversal included, may be copied.
11. **Discard** archives a draft or a rejected one with an optional reason; a submitted draft must be withdrawn first.

### Measurement of manual lines (ADR 0007, ADR 0012)
12. Every manual line is a new measurement: its transaction amount is converted per ledger at that ledger's policy rate in force on the entry date (S02 rule 16), or kept as is in a ledger of its own currency. A missing rate refuses the posting with `RATE_MISSING`, naming the ledger, pair and date; the draft stays.
13. **Dealt rates** (owner, 2026-10-28): the accountant may give, per currency pair of the entry, the rate actually dealt at. It is used only by a ledger whose policy is `market` and accepts a transaction's rate (Vertex Media's parallel ledger), and only for that pair (`DEALT_RATE_NOT_ACCEPTED` otherwise); it is stored as quoted in the company's pair orientation (S02, `RATE_ORIENTATION`) on the line conversion with basis `transaction`. It is never written to the rate table.
14. **One currency:** lines in one transaction currency must balance in it (`ENTRY_UNBALANCED`), and any residual in a ledger is conversion rounding: one rounding line per ledger to the `conversion_rounding` role account (`balanceEntry()`).
15. **More than one currency** (a currency purchase, a payment in another currency): the residual of each ledger, rounding included, posts as a realised exchange difference (IAS 21.28) to the `fx_realised_gain` role account when it is a credit and to `fx_realised_loss` when it is a debit, in that ledger only (`exchangeDifferenceLines()`; ADR 0011 separate accounts). A missing role is `ACCOUNT_ROLE_MISSING`.
16. Manual lines may post to any postable account except a control account until S04 (`ACCOUNT_IS_CONTROL`), and to blocked or archived accounts never (S02 rules 5–6). Manual lines refuse archived dimension values (S02 rule 13).

### Attachments
17. PDF, PNG, JPEG or WebP, at most 10 MB a file and 20 a draft or entry (`ATTACHMENT_TYPE`, `ATTACHMENT_TOO_LARGE`, `ATTACHMENT_LIMIT`); the type is checked from the file's first bytes, not its name. They are added and removed on a draft, move to the entry at posting, and are only added after posting (owner, 2026-10-28). An attachment is not part of the entry hash: it changes no amount; its SHA-256 is stored and shown.

### Trust (F14)
18. **The chain:** every entry stores `previous_hash` and `hash`; the head holds the last. The hash input is fixed by `entryHash()` (`packages/ledger`), pinned by a test for ten years.
19. **The integrity check** recomputes, from the first entry: each hash and link, the gapless numbers per fiscal year, the balance of each entry, and the period balances against the lines. It compares the chain with every stored anchor and, when the person pastes an anchor from an email (company, date, count, hash), with that one: the only check that does not trust the server. It reports the first break and every mismatch. Each run is audited.
20. **The daily anchor** (owner, 2026-10-28): at 00:30 Asia/Damascus the worker records, for every company with at least one entry, the head as at the end of the previous day (count, hash, last entry) and emails each owner of the company one message listing the anchors of all their companies, through the email outbox (S01). It is sent every day, changed or not, so a missing email is itself a warning.
21. **The full export** (owner, 2026-10-28): the owner requests it after reauthenticating; the worker writes a ZIP with one JSON and one CSV file per company table (settings, chart, dimensions, rates, entries, lines, conversions, dimension sets, drafts, attachments' metadata, periods, period balances, anchors, the company audit log), the attachments' files, a `manifest.json` (tables, row counts, SHA-256 of every file, the chain head) and a README in Arabic and English. The owner gets an email; the link works for 24 hours, then the file is deleted and the row marked `expired`. Amounts are written as integer strings with their currency. Requesting and downloading are audited.

## Accounting treatment
- **A manual entry** posts the accountant's lines as new measurements (ADR 0007), plus:
  - in one currency, a rounding line per ledger to the conversion-rounding account when conversion rounding leaves a residual (at most half a minor unit per converted line);
  - in more than one currency, a realised exchange difference per ledger to the realised gain or loss account (IAS 21.28, ADR 0007 "Exchange residuals").
- **A reversal** posts the exact negation of every line of the original at its amounts (ADR 0005 invariant 3, ADR 0007 carried amounts), dated as rule 9. A posted entry is never changed (IAS 8.42 corrections go through reversal and a new entry).
- **Basis:** IAS 21.21–22 (spot rate on the transaction date; the bulletin of the day for the book ledger, S02 rule 16), IAS 21.28 (realised differences), company policy in scope §4, ADR 0007 rounding. Syrian: the Arabic, chronologically numbered journal (Commercial Code arts. 16–19, REPORTED).
- No open items, recognition schedules or revaluation are touched in S03 (control accounts refused, rule 16). Monetary balances posted here are revalued by S07.

**Example** (Vertex Media, `syp-usd`, Sunday 8 November 2026; bulletin 121.5000 SYP per USD; market 122.0000): the accountant buys 100.00 USD for 12,250.00 SYP from the SYP bank account, dealt at 122.5000.

| Account | Currency | Amount | Book (SYP) | Parallel (USD) |
|---|---|---|---|---|
| 111004 USD bank | USD | 100.00 | 12,150.00 (× 121.5 bulletin) | 100.00 |
| 111003 SYP bank | SYP | −12,250.00 | −12,250.00 | −100.00 (÷ 122.5 dealt) |
| 541001 realised exchange loss | SYP | 100.00 | 100.00 | 0 |

Without a dealt rate the parallel SYP line is −100.41 (÷ 122.0, market) and the parallel ledger also posts a 0.41 USD realised loss to 541001. These numbers are confirmed in the scenario `manual/currency-purchase` before any code (`/posting-rule`).

## Currencies, rates and rounding
- Transaction amounts in any currency of the money module; book and parallel amounts per ADR 0007: new measurements at each ledger's policy rate on the entry date (bulletin of the day, S02 rule 16; market newest on or before), crosses through the other ledger currency, or a dealt rate for a market ledger that accepts it (rule 13).
- Each converted ledger amount stores its rate row(s) and the quote as used (`line_conversions`), so S02 rule 15 lists "the entries that used this rate row" by `rate_id`.
- Rounding: one conversion per line, half away from zero (`convert()`); a rounding line per ledger only for an entry in one currency; in several currencies, rounding is part of the realised difference (ADR 0007 "Implementation choices").
- Reversals carry amounts; they never read a rate.
- The four shapes: `syp` (no parallel, so `parallel_minor` null, no parallel rounding); `syp-usd`; `usd-syp` (book USD at the bulletin, parallel SYP at market); `third` (TRY or EUR through a cross).

## Periods
- S03 creates the month's period row on the first posting dated in it (`open`), with its fiscal year from `fiscal_year_start_month`. The period guard refuses an entry into a `closed` period (`PERIOD_CLOSED`); S07 brings closing, reopening and their lock order (head, then period, ADR 0008).
- A draft dated in a period that S07 later closes cannot be posted; the accountant changes its date.
- Entry numbers restart at 1 each fiscal year of the entry date; an entry dated in 2026 and posted in January 2027 takes the next 2026 number (owner, 2026-10-28). The journal book (S09) prints by entry date then number (ADR 0008).
- A fiscal year's key (`fiscal_year`) is the calendar year it starts in. It is shown as that year when it is a calendar year (`2026`), and as both years when it spans two (`2026/2027` for July 2026 to June 2027), as the region names a July–June budget year; statements state the period's end date (IAS 1.51(c)). No amount or stored number depends on the label (decided on the owner's instruction to choose the most professional convention, 2026-10-28).
- Checklist items S07 adds from this spec: no drafts or submitted drafts dated in the period (F09).

## API
All under `/api`, with `X-Mizan-Company`; lists are cursor-paged (S01 pattern). Request and response schemas in `packages/contracts/src/entries.ts`.

| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/entries` | `entries.read` | `from`, `to`, `number`, `source`, `account`, `text`, cursor | entry summaries (number, date, description, source, totals in both ledgers, reversed by) | `VALIDATION_FAILED` |
| `GET /api/entries/:id` | `entries.read` | — | the entry, its lines with dimensions, conversions and rate rows, attachments, reversal links, hash | `NOT_FOUND` |
| `POST /api/entries/:id/reverse` | `entries.post` (approval off) or `drafts.manage` (on: creates the reversal draft) | `date`, `description` | the posted reversal, or the draft | `ENTRY_NOT_REVERSIBLE`, `ENTRY_ALREADY_REVERSED`, `REVERSAL_BEFORE_ORIGINAL`, `ENTRY_DATE_OUT_OF_RANGE`, `PERIOD_CLOSED` |
| `POST /api/entries/:id/copy` | `drafts.manage` | — | the new draft | `NOT_FOUND` |
| `POST /api/entries/:id/attachments` | `entries.attach` | multipart file | attachment | `ATTACHMENT_TYPE`, `ATTACHMENT_TOO_LARGE`, `ATTACHMENT_LIMIT` |
| `GET /api/attachments/:id` | `entries.read` (posted) or `drafts.read` | — | the file, `Content-Disposition: attachment` | `NOT_FOUND` |
| `GET /api/accounts/:id/lines` | `entries.read` | `from`, `to`, `dims`, `currency`, cursor | opening balance, lines with running balances in transaction, book and parallel amounts | `NOT_FOUND` |
| `GET /api/rates/:id/entries` | `entries.read` | cursor | the entries whose conversions used that rate row | `NOT_FOUND` |
| `GET /api/drafts` · `POST /api/drafts` · `GET/PUT /api/drafts/:id` | `drafts.read` · `drafts.manage` | the draft (date, description, reference, dealt rates, lines) | the draft | `DRAFT_NOT_EDITABLE`, `VALIDATION_FAILED` |
| `POST /api/drafts/:id/preview` | `drafts.read` | — | the lines as they would post, with rounding and difference lines, or the refusals | `RATE_MISSING`, line errors |
| `POST /api/drafts/:id/post` | `entries.post` | — | the posted entry | rules 5–16, `IDEMPOTENCY_CONFLICT`, `APPROVAL_REQUIRED` (approval on) |
| `POST /api/drafts/:id/submit` · `/withdraw` · `/discard` | `drafts.manage` | `reason` for discard | the draft | `DRAFT_NOT_EDITABLE`, `APPROVAL_NOT_REQUIRED` |
| `POST /api/drafts/:id/approve` · `/reject` | `entries.approve` | `reason` for reject | the entry or the draft | `APPROVER_IS_PREPARER`, `DRAFT_NOT_EDITABLE`, posting refusals |
| `POST /api/drafts/:id/attachments` · `DELETE /api/drafts/:id/attachments/:attachmentId` | `drafts.manage` | multipart · — | attachment | as above |
| `POST /api/integrity/check` | `integrity.read` | optional pasted anchor `{ date, count, hash }` | the report | — |
| `POST /api/company/exports` · `GET /api/company/exports` · `GET /api/company/exports/:id/download` | `company.export` | — | the export rows; the file | `EXPORT_IN_PROGRESS`, `REAUTHENTICATION_REQUIRED`, `LINK_INVALID` (expired) |

Posting a draft is idempotent by the draft id (rule 2); a double click returns the same entry. `PUT /api/drafts/:id` carries `updatedAt` and refuses a stale write (`DRAFT_CHANGED`), so two accountants never overwrite each other silently. New error codes are appended to the registry: `PERIOD_CLOSED` (409), `IDEMPOTENCY_CONFLICT` (409), `ENTRY_DATE_OUT_OF_RANGE` (422), `ENTRY_NOT_REVERSIBLE` (409), `ENTRY_ALREADY_REVERSED` (409), `REVERSAL_BEFORE_ORIGINAL` (422), `ACCOUNT_IS_CONTROL` (422), `DEALT_RATE_NOT_ACCEPTED` (422), `DRAFT_NOT_EDITABLE` (409), `DRAFT_CHANGED` (409), `APPROVAL_REQUIRED` (409), `APPROVAL_NOT_REQUIRED` (409), `APPROVER_IS_PREPARER` (403), `ATTACHMENT_TYPE` (422), `ATTACHMENT_TOO_LARGE` (413), `ATTACHMENT_LIMIT` (409), `EXPORT_IN_PROGRESS` (409). `/v1` is untouched (S05).

## Jobs and events
- **`ledger.daily-anchor`** (pg-boss cron `30 0 * * *` Asia/Damascus, `mizan_jobs`): per company, inserts the `chain_anchors` row for the previous day if missing (the unique key makes a second run a no-op) and enqueues the owners' emails with that row's id as the outbox idempotency key. Retries three times with backoff; a failure is logged and the next day's run still sends its own.
- **`company.export`** (on request, `mizan_jobs` in the company's context): builds the ZIP from one `REPEATABLE READ` snapshot, writes it, marks the row `ready` and emails the owner; a retry overwrites its own partial file. **`company.export-expire`** (hourly) deletes files past `expires_at` and marks them `expired`.
- No events are received or emitted.

## Screens
Design-system components only (ADR 0010); new general components go to `packages/ui` first.

| Route | Purpose and content | Actions | States | Roles |
|---|---|---|---|---|
| `/entries` | The journal: number, date, description, source, debit total in the selected ledger, reversal mark; filters by dates, number, source, account and text; the ledger switch (book · parallel) | Open; new entry; export comes with S09 | Empty journal explained; loading rows | Every role |
| `/entries/new`, `/drafts/:id` | **The keyboard entry screen** (F05): header (date, description, reference) and a `Grid` of lines (account picker, dimension pickers per required type, currency, debit, credit, memo); totals per currency and per ledger live; a "dealt rates" strip when the entry has a pair a ledger accepts; the preview panel with both ledgers' amounts, rates and the rounding or difference lines. Enter moves right, Ctrl+Enter adds a line, `=` takes the amount that balances the entry's currency, Ctrl+S saves, Ctrl+Shift+Enter posts or submits; paste from Excel (ADR 0010 §4) | Save, post or submit, withdraw, discard, attach files | Unbalanced currency totals shown as text; refusals per line with the `ErrorSummary` (UX-01); `RATE_MISSING` links to `/rates`; a rejected draft shows the reason | Owner, accountant edit; approver and auditor read |
| `/drafts` | Drafts and the approval queue: tabs "my drafts", "all drafts", "awaiting approval" | Open; approve or reject from the draft (approvers) | Empty tabs explained | Owner, accountant, approver, auditor |
| `/entries/:id` | The entry: header with number, date, posting time, source and who prepared, approved and posted it; lines with dimensions in transaction, book and parallel amounts (Amount component), each conversion's rate and its row; rounding and difference lines labelled; attachments; the reversal links both ways; the hash | Reverse, copy, add attachment; open the account's lines; open the rate row | Not found; a Hub document link appears with S05 | Every role reads; actions per access |
| `/accounts/:id/lines` | An account's lines in a date range with an opening balance and a running balance per ledger, filterable by dimensions and currency; from the chart's account sheet | Open an entry | Empty range explained | Every role |
| `/rates` (S02) | The "entries that used this rate" list after a correction becomes live, each linked | Open; reverse (rule 9) | — | As S02 |
| `/integrity` | The last check and a "run check" button; the anchors received (date, count, hash); a field to paste an anchor from the email | Run; verify a pasted anchor | Clean result with counts; a break names the first entry and what differs | Owner, auditor |
| `/settings/company` (S01) | Gains the switch "approval of manual entries" | Toggle (audited) | — | Owner |
| `/settings/export` | Request a full export; the list of exports with state and expiry | Request (reauthenticate); download | Queued, ready, failed, expired | Owner |

The command palette gains "new entry", "go to entry number…", "drafts awaiting approval" and "run integrity check". Every screen is RTL and works from 360 px; on a phone the entry screen shows one line per card.

## Reports
No new report: the journal list, an account's lines and the integrity check read the ledger directly. The period balances are built here for S09, which reads them for the trial balance; S03's property test proves they equal the lines.

## Printing and legal books
None in S03. The journal book (S09) prints these entries by entry date then number in Arabic (ADR 0008); the entry description is its "البيان". The export's README states SYP as "الليرة السورية الجديدة".

## Volume and performance
- Vertex Media: a few hundred entries a month (ADR 0005), up to about 3,000 lines; the largest company served in phase 1 about 5,000 entries and 20,000 lines a month.
- Posting is serialised per company (ADR 0008): a manual entry of 50 lines posts in ≤ 300 ms; the preview ≤ 200 ms.
- The journal list reads `(company_id, entry_date, number)`, ≤ 300 ms a page; an account's lines read `(company_id, account_id, entry_id)` with the opening balance from period balances plus the lines of the first month, ≤ 500 ms for a year.
- The integrity check streams entries in order; ≤ 60 s for 100,000 entries. The export of a company of that size ≤ 5 minutes in the worker.

## Migration and compatibility
- New schema module `ledger` in `packages/db` (the tables above, their grants, RLS, guards and registry entries with the new kind `ledger-state`); `drafts` module; `trust` module (anchors, exports). `company_settings` gains `manual_entry_approval` (additive with its default). Each existing company gets its ledger head row in the migration.
- The migration guard (ADR 0008) gains the new append-only tables and the `ledger-state` kind's rule (no `DELETE`, no `TRUNCATE`).
- `packages/contracts`: `entries.ts` (drafts, lines, dealt rates, entries, the preview, the integrity report, exports), the permission keys, error codes and audit actions, appended.
- `packages/ledger`: `manualEntryLines()` (rules 12–15: dealt rates per pair, `DEALT_RATE_NOT_ACCEPTED`, realised differences by sign) and `realisedDifferenceLines()` arrived with the scenario `manual/currency-purchase`; the posting function calls them before `balanceEntry()`. Any other change runs `pnpm typecheck` at the root.
- S02's archiving check (`ACCOUNT_HAS_BALANCE`) gains the ledger balances in both ledgers (open items join with S04); archiving locks the ledger head first (S02 abuse case).
- `packages/scenarios`: `bookHarness` registers the setup (a company of the case's shape through the company service, the chart template and the accounts a case adds to it, the bulletin calendar and rates; a case with `closed_periods` fails until S07 brings the close), the ledger reader, and the `manual`, `reversal` and `rate` executors through the same services as the API. The README documents the manual payload (`{ description?, reference?, dealt_rates?, lines: [{ account, dims?, currency, amount, memo? }] }`). `currency/bulletin-rate-of-the-day.md` and `currency/rate-correction-after-use.md` switch to `Approved (owner, 2026-10-27)` and `manual/currency-purchase.md` to `Approved (owner, 2026-10-28)`, with no expected value changed. The cases are dated after today's month, so the executors post with the clock set to the step's date (rule 6).
- `openapi.json` gains the `/api` routes (additive); `/v1` untouched.

## Arabic strings and number formats
- New namespaces `ar.entries`, `ar.drafts`, `ar.integrity`, `ar.export`, with the sources (يدوي، حدث من Hub، أرصدة افتتاحية، إعادة تقييم، تحرير إيراد)، states (مسودة، بانتظار الاعتماد، مرحّل، مرفوض), line kinds (سطر تقريب، فرق صرف محقق) and the new error codes in `ar.errors`.
- Terms (glossary): بيان القيد، المرجع، سعر الصفقة، إرسال للاعتماد، اعتماد، رفض، سحب، معاينة الترحيل، فحص السلامة، رأس السلسلة، تصدير بيانات الشركة، مجموعة الأبعاد، طلب الترحيل.
- Entry numbers shown as `2026/123` (fiscal year / number), or `2026-27/123` in a fiscal year that spans two calendar years ("Periods"), in Latin digits, LTR isolated; dates `YYYY-MM-DD`; amounts through the Amount component only; hashes in monospace, first 12 characters with copy.

## Audit
One `audit_entries` row per change in the same transaction (S01 rule 23): `entry.posted` (one per posting, any source: the runner counts it), `entry.reversed` is the reversal's own `entry.posted` with `reverses` in its details, `draft.created`, `draft.updated` (before and after of the changed fields), `draft.submitted`, `draft.withdrawn`, `draft.approved`, `draft.rejected` (reason), `draft.discarded`, `attachment.added`, `attachment.removed`, `integrity.checked` (result), `export.requested`, `export.downloaded`, and the settings change of `manual_entry_approval` through S01's `company.settings_updated`. Anchors are written by the job with the jobs role as actor.

## Abuse and failure cases
- **Replays and double submits:** the posting request's unique key (the draft id) and the draft's state transition under a row lock: a second post returns the same entry; approve twice posts once.
- **Self-approval:** the API compares the approver with the preparer and the submitter (`APPROVER_IS_PREPARER`); the database stores both, and a property test covers the rule.
- **Races with a close (S07):** head then period lock order (ADR 0008); S03's invariant test proves a posting into a period marked closed by a concurrent transaction is refused.
- **Concurrent postings:** the head lock serialises them; a test posts from many connections and checks gapless numbers and an unbroken chain.
- **A runtime role tampering:** append-only grants and `refuse_change()`; `ledger-state` guards; `ENABLE ALWAYS` triggers; the convention test; the integrity check and the anchors for a superuser who disables triggers (ADR 0008).
- **Cross-company access:** RLS on every table, composite keys (line → account, line → dimension set, conversion → rate row, attachment → entry); attachments and exports served only through the API in the company context, by id, never by path; every endpoint tested as another company's member; the isolation property test covers the new tables.
- **A malicious upload:** type from the file's magic bytes, size limit, stored under a generated name, served as a download with `X-Content-Type-Options: nosniff`, never rendered inline from user content.
- **A leaked export link:** owner only, reauthenticated, 24 hours, audited download, the file deleted after.
- **Mail down:** anchors are stored first; the outbox retries; the integrity check uses the stored rows and a pasted anchor.
- **A mistyped rate:** S02 rule 15 lists the entries; rule 9 reverses them.

## Edge cases
1. Two accountants post different drafts at once: both post, numbers consecutive, chain linked in posting order.
2. Two approvers approve the same draft: one posts, the other gets `DRAFT_NOT_EDITABLE`.
3. A line of zero amount: refused at save (`VALIDATION_FAILED`); a negative amount is a credit.
4. A one-currency entry whose lines do not balance: `ENTRY_UNBALANCED` with the currency and residual.
5. `syp`: no parallel amounts or conversions; rounding only in SYP when a foreign line converts.
6. `syp-usd`: a USD expense on a Friday takes Thursday's bulletin (the approved scenario).
7. `usd-syp`: the book USD at the bulletin, the parallel SYP at the market; a dealt rate applies to the SYP ledger only if its policy is market and accepts it.
8. `third`: a TRY expense through a cross; a missing quote is `RATE_MISSING` naming the pair.
9. A working day without its bulletin: `RATE_MISSING`; the draft stays and posts once the rate is recorded.
10. A rate corrected after posting: the entry is listed by `GET /api/rates/:id/entries`; nothing changes until the accountant reverses.
11. A reversal of an entry with a rounding line or a difference line: every line negated, so the reversal needs no new rounding (`balanceEntry()` with the passed rounding lines).
12. A reversal dated in a later month after the bulletin moved: amounts carried, no rate read, no difference.
13. A reversal requested twice at once: the unique `reverses_entry_id` lets one through.
14. An account blocked or archived after the draft was saved: refused at posting with the line named.
15. An account's first posted line: `first_posted_at` set, and S02's lock applies from then on, in the same transaction.
16. The company's first entry: `books_started_at` set; the ledger settings lock from then (S01 rule 11).
17. An entry dated 31 December posted on 2 January: numbered in the earlier fiscal year; allowed only while 31 December's period is open and within rule 6 (the current month is January, so a December date is a back-date, allowed).
18. A fiscal year starting in July: numbers restart on 1 July by entry date.
19. Approval switched on with drafts already in `draft`: they now need submission; switched off with submitted drafts: they stay submitted (rule 8).
20. A 500-line entry pasted from Excel: saved, previewed and posted within the limits; a 501st line refused.
21. A leap day: dates only; 29 February 2028 takes that day's bulletin or the last publication day's.
22. An attachment uploaded to a draft that is discarded: archived with it; the file stays on disk for the export and the ten-year retention.
23. A day with no new entries: the anchor repeats the previous count and hash; a company with no entries gets none.

## Scenarios
Accounting rules this spec introduces, each written and approved through `/posting-rule` before its code:
- `docs/scenarios/manual/conversion-rounding.md`: a one-currency entry whose conversions leave a minor unit or two: the rounding line per ledger to the conversion-rounding account, by sign, in `syp-usd` (a USD entry in the book, an SYP entry in the parallel), `syp`, `usd-syp` (an SYP entry rounded in the book, a USD entry in the SYP parallel ledger) and `third` (both ledgers); its reversal; an entry unbalanced in its currency refused; an SYP entry in `syp` needs none.
- `docs/scenarios/manual/currency-purchase.md`: 100.00 USD bought for 12,250.00 SYP, with and without a dealt rate (the example above): realised differences per ledger to the gain or loss account by sign, in `syp-usd`, `usd-syp` and `third` (TRY sold for USD).
- `docs/scenarios/manual/reversal.md`: a reversal in a later month after the bulletin moved carries the original amounts exactly, rounding and difference lines included; balances return to zero in both ledgers.

The existing `currency/bulletin-rate-of-the-day.md` and `currency/rate-correction-after-use.md` run unchanged once the executors exist.

## Open questions
- **Q2 (`docs/open-questions.md`):** attachments and exports live on the server's disk; their off-server copies are part of the backup ADR before the first production deploy.
- None blocks S03.

## Acceptance
- **The owner's end-to-end check** (a test company with Vertex Media's ledgers and the service-agency template):
  1. Record the bulletin 121.5 and a market rate 122.0 USD/SYP for today in `/rates`.
  2. In `/entries/new`, enter "شراء دولار" for today: Dr 111004 USD 100.00, Cr 111003 SYP 12,250.00, dealt rate 122.5. The preview shows 12,150.00 SYP and 100.00 USD on the USD bank line, and a 100.00 SYP realised loss on 541001 in the book ledger only. Post it: number `2026/1`.
  3. Open the entry: both ledgers, the rate rows, the hash. Reverse it today: number `2026/2`, every amount negated; open 111004's lines: zero in both ledgers.
  4. Copy entry 1, remove the dealt rate, post: the parallel ledger also shows a 0.41 USD loss.
  5. In `/settings/company`, switch approval on; as the accountant prepare an entry and submit it; as the same person, approving is refused; as the approver, reject with a reason, then approve after the fix.
  6. Attach a PDF to a posted entry; try to remove it: no remove action exists.
  7. In `/integrity`, run the check: clean, with the counts. The next morning's email lists the company's head; paste it into `/integrity`: verified.
  8. In `/settings/export`, request an export, reauthenticate, download the ZIP from the email link and open `manifest.json`.
- **Tests:**
  - API: success, 401, 403, another company and an idempotent replay per endpoint; stale draft writes; self-approval refused;
  - unit and property tests: posting builds balanced entries in every shape; entry plus reversal nets to zero on every account; period balances equal the lines after any sequence of postings; the chain verifies after any sequence and fails on any altered field; gapless numbers per fiscal year under concurrency; no posting into a closed period; replays post nothing;
  - invariant tests as `mizan_app` for every new table: update, delete, truncate, an unbalanced commit, a second reversal, a reversal that does not negate, a skipped number, a broken chain link, a direct write to period balances, the head or a counter;
  - the convention test: the new tables and kind, pinned guards, no insert into a ledger table outside the posting function;
  - the scenario book: the two `currency/` scenarios and the three `manual/` scenarios above;
  - E2E with RTL screenshots light and dark at 360, 768 and 1280 px: the entry screen by keyboard only, the preview, approval, reversal, the entry page, the integrity page, the export page.
