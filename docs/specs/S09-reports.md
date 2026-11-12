# S09 — Reports

Status: Approved (owner, 2026-11-12) · Date: 2026-11-12 · Features: `docs/product/phase-1-scope.md` F13 (and the printing S02, S04 and S07 left to S09) · ADRs: 0003, 0005, 0006, 0007, 0008, 0009, 0010, 0011, 0015, 0016, 0018

## Summary
Mizan keeps Vertex Media's books (S03–S08), but the owner cannot yet read them as an accountant does: no trial balance, no statements, no profitability, and no printed journal book, which the Commercial Code requires (arts. 16–19, REPORTED). The scope's "Done when" needs the trial balance, income statement, balance sheet and profitability read by the owner for a closed month.

S09 brings:
- **the trial balance, the general ledger, the account statement and the journal**, in the book ledger and the parallel ledger, read from the period balances (ADR 0008);
- **the basic income statement and balance sheet** from the statement-line catalogue (S02), with a comparative period, contract positions netted per contract (IFRS 15.105), each counterparty's balance on its own side (IAS 1.32) and the current year's result computed in equity;
- **profitability** by client, contract, department and service, as a direct contribution margin;
- **the contract position and the revenue release schedule** (F07);
- **the printed journal book** in Arabic with pages numbered through the fiscal year, an official copy of closed months only, and its print register;
- **exports**: every report to Excel and PDF (PDF rendered by the worker's Chromium, ADR 0002), including the receivables ageing and the client statement of S04 and the chart of S02;
- **drill-down** from every figure to its lines, its entries and the Hub document.

S09 posts nothing. It adds one piece of data: the department of each service, dated, which Hub sends with the service (rule 32).

## In scope / out of scope
- In:
  - the reports of F13 above, their screens, exports and drill-down;
  - the permission `reports.read`;
  - the service's department history (`service_departments`) and the optional `department` on Hub's service reference (`/v1`, additive);
  - `report_files` (the PDF queue) and `journal_book_prints` (the register of official prints);
  - the print layout in `packages/ui` that the worker renders to PDF, reused by the chart (S02), the ageing and the client statement (S04);
  - the scenario `reports/statement-presentation` (see "Scenarios").
- Out (later or never):
  - **Year-end close** and its closing entry (phase 2). Until then the balance sheet computes the year's result (rule 16), and the ledger's revenue and expense accounts keep accumulating across years.
  - **Cash-flow statement and notes** (phase 2, scope §8); **IFRS 18 statements** (periods from 2027-01-01), with the split of exchange differences by category (Q11).
  - **The IAS 21.39 presentation translation** and IAS 29 (scope §8).
  - **Allocation of overheads** to clients, contracts, departments or services (owner, 2026-11-12): profitability is a direct contribution margin.
  - **Consolidation** across companies (later); **a read API for Hub** (with Hub F18, scope Q11).
  - **Saved report layouts, scheduled report emails, custom report builders** (later).
  - **Rounding to thousands** for presentation (IAS 1.51(e)): figures are exact in minor units.

## Access
| Action | Surface | Who (role or permission) |
|---|---|---|
| Read every report of S09 (trial balance, general ledger, account statement, journal, income statement, balance sheet, profitability, contract position, revenue release schedule, the print register) | Web `/reports/*` | Every role (`reports.read`, new; owner, 2026-11-12) |
| Drill down to lines and entries | Web | `reports.read` for the lines; `entries.read` (every role) for the entry |
| Export a report to Excel or PDF | Web | `reports.read`; audited (S01 rule 24) |
| Print the official journal book of closed months | Web | `reports.read`; audited, and registered (rule 28) |
| Export the ageing and the client statement to PDF | Web | `open_items.read` (S04); audited |
| Export the chart to PDF | Web | `accounts.read` (S02); audited |
| Set the department of a manual service | Web `/dimensions` | Owner, accountant (`dimensions.manage`, S02) |
| Send a service's department | API `/v1/events` | API client with `events:write` (S05) |

`reports.read` is appended to `PERMISSIONS` and held by every role: owner, accountant, approver, viewer, auditor. Every route is a company route (`X-Mizan-Company`); an archived company's reports stay readable and exportable (S01 rule 12: reads are allowed).

## Data
No ledger table changes. Reports read `period_balances` for whole months and `journal_lines` for the days of a partial month (ADR 0008).

| Table | Kind | Fields | Keys and checks |
|---|---|---|---|
| `service_departments` | append-only | `id`, `company_id`, `service_value_id` → dimension_values, `department_value_id` → dimension_values, `effective_from` (date), `source` (`hub` · `manual`), `inbound_event_id` (null) → inbound_events, `recorded_by_user_id` (uuid, null, no FK), `reason` (null, 1–500), `created_at` | composite FKs `(company_id, …)`; the service value is of type `service` and the department value of type `department` (trigger); exactly one of `inbound_event_id` and `recorded_by_user_id` set, matching `source`; `effective_from` not in a closed period at insert (trigger, as the period guard); index `(company_id, service_value_id, effective_from, created_at)` |
| `report_files` | queue (as `company_exports`, S03) | `id`, `company_id`, `report` (enum of rule 37), `params` (jsonb, the report's validated query), `format` (`pdf`), `official` (bool), `state` (`queued` · `ready` · `failed` · `expired`), `storage_key` (null), `size_bytes` (null), `sha256` (null), `error` (null, an error code), `requested_by_user_id`, `created_at`, `ready_at` (null), `expires_at` (null) | index `(company_id, requested_by_user_id, created_at)`; index `(state, created_at)` for the worker; `official` only with `report = journal_book` |
| `journal_book_prints` | append-only | `id`, `company_id`, `report_file_id` → report_files, `fiscal_year` (smallint), `from_period_id`, `to_period_id` → periods, `first_page`, `last_page` (int ≥ 1), `entry_count`, `line_count` (int), `debit_total_minor`, `credit_total_minor` (bigint, book ledger), `content_sha256` (the canonical rows, rule 31), `file_sha256`, `printed_by_user_id`, `created_at` | composite FKs; `from_period ≤ to_period`, both in `fiscal_year`; `first_page ≤ last_page`; `debit_total_minor = credit_total_minor` |

- Every table has `company_id` and forced RLS (ADR 0003); the app role has `SELECT, INSERT` on the two append-only tables, with `refuse_change()` on update, delete and truncate (ADR 0005 invariant 10, `ENABLE ALWAYS`); `report_files` takes `UPDATE` of its state columns only, by the worker's role in the company's context (as `company_exports`).
- `report_files`' files live under `MIZAN_FILES_DIR` in the company's directory, served only through the API (ADR 0008 "Attachments"), deleted 24 hours after `ready_at` (the row turns `expired`). An official print's file is kept: its row never expires, as the journal book is kept ten years (AGENTS "Audit; archive, don't delete").
- No business table changes in S02's `dimension_values`: a service's department lives only in `service_departments`, since it is dated (owner, 2026-11-12).

## States and rules

### Common to every report
1. **Ledger:** every report reads one ledger, `book` (default) or `parallel`, and presents amounts in that ledger's currency (ADR 0007 "Reporting"). A company without a parallel ledger has no switch. The account statement and the general ledger also show each line's transaction amount and currency (rule 11).
2. **Dates** are accounting dates (`entry_date`) in Asia/Damascus. A period is `from`–`to` of whole days; a balance is as of a date's end. Reports read only posted entries; drafts and held events are never in a figure.
3. **Exact figures:** every amount is the exact sum of ledger amounts in minor units, formatted by the money module (Latin digits, every decimal). Nothing is rounded except a percentage (rule 21). Every figure is shown through `Amount` (negative with its minus sign and colour).
4. **Status marks** (owner, 2026-11-12): any date or period may be read. The header, the Excel file and the PDF carry:
   - **"غير نهائية: الفترة مفتوحة"** when any month the report reads (from its `from`, or the start of the books for a balance, to its `to`) is open or reopened;
   - **"قبل إعادة التقييم"** when the report's end date is not the last day of a month, or that month's revaluation in the report's ledger is not `current` (S07 `REVALUATION_STATES`), so monetary balances are at their carrying amounts, not at the closing rate (IAS 21.23);
   - the time it was produced and the latest entry number it includes.
5. **Comparative period** (owner, 2026-11-12): the trial balance and the income statement default to the previous period of the same number of days ending the day before `from`; the balance sheet to the end of the previous fiscal year (IAS 1.38), or the day before the company's first period when that is later. The reader changes it to any period or date, or removes it. A comparative period with no posted line shows "—", never zero. The marks of rule 4 are given for each column.
6. **Drill-down:** every figure opens the lines behind it (`/reports/lines`: the account or statement line, the counterparty or contract, the dimensions, the dates and the ledger), each line opening its entry (`/entries/:id`), and an entry from Hub its event and document (`hubDocument`, S05 PR 4). The lines of a figure always sum to it; a test checks it for every report.
7. **Archived** accounts and dimension values appear wherever they have a balance or a movement in the period, marked archived. Blocked accounts are marked.
8. **Every report agrees with the ledger:** the totals of the trial balance equal the sums of `period_balances` and the lines it reads; the income statement's result equals the trial balance's classes 4–5; the balance sheet balances; profitability's totals equal the income statement's revenue and direct costs. Each is a test, and the integrity check (S03) already proves the period balances equal the lines.

### Trial balance, general ledger, account statement, journal
9. **Trial balance** (owner, 2026-11-12): six columns per account: opening balance, the period's debits and credits, and closing balance, each balance as one net figure on its debit or credit side. Levels 1–4: at level *n*, each account at level *n* shows its subtree's sums, and each postable account above level *n* with no children shows itself. Totals: opening debits equal opening credits, the period's debits equal its credits, closing debits equal closing credits (ADR 0005). The comparative column is the comparative period's closing balance. Filters: the level, a code range, "with a balance or movement only" (default on). Revenue and expense accounts carry their balance from the start of the books until phase 2's year-end close entry, so a trial balance from 1 January opens with last year's result in classes 4–5 (rule 16 presents it as retained earnings).
10. **General ledger:** for each account of a code range, the opening balance, each line in `(entry_date, number, line)` order with its description, memo, dimensions, debit, credit and running balance, and the closing balance. Paged per account; the export carries all.
11. **Account statement:** one account, as the general ledger, with the account's currency too (F13): for each transaction currency on the account, the lines' transaction amounts with their running balance in that currency, beside the ledger amount and its running balance. An account restricted to a currency shows that currency only. Dimension filters (as `GET /api/accounts/:id/lines`, S03). For a control account, each line names its open item.
12. **Journal:** posted entries in `(entry_date, number)` order with their lines (account code and Arabic name, memo, dimensions, debit, credit in the report's ledger), the description and the reference. The screen is the journal book's content; the printed book is rules 26–31.

### Income statement and balance sheet
13. **Lines and order:** both statements present from `STATEMENT_LINES` (S02) in catalogue order, each line the sum of the accounts that carry it; a changed statement line re-presents every period (S02 rule 4). A line with no account and no amount in either column is hidden.
14. **Income statement** (owner, 2026-11-12): revenue and other income, then expenses by nature (IAS 1.102), each line's amount as income positive and expense negative; then the subtotals by the lines' IFRS 18 category: **"الربح التشغيلي"** (operating lines), then the investing and financing lines with **"الربح قبل التمويل وضرائب الدخل"** shown when an investing line has an amount, then **"الربح قبل الضريبة"**, then income tax, then **"ربح (خسارة) الفترة"** (IAS 1.81A–85; IFRS 18.69). Exchange differences are one net line, `is.fx_differences` (IAS 21.52(a)), until Q11 is answered.
15. **Balance sheet** as of a date: current and non-current assets, current liabilities, equity, by their catalogue sections, with totals of assets and of liabilities and equity, which are equal.
16. **The year's result** (owner, 2026-11-12): equity shows a computed line **"ربح (خسارة) السنة الحالية"**, the net of classes 4–5 from the start of the fiscal year of the balance sheet's date to that date. The net of classes 4–5 of earlier fiscal years, not yet closed by a year-end entry (phase 2), is added to `bs.retained_earnings`, and the line says so ("تشمل نتائج سنوات غير مقفلة"). Nothing is posted (IAS 1.54(r), 1.106(d)).
17. **Contract positions net per contract** (IFRS 15.105; ADR 0007): the balances of every account on `bs.contract_assets` and `bs.contract_liabilities` are summed per `contract` dimension value in the report's ledger. A net debit is presented in contract assets, a net credit in contract liabilities. A balance with no contract value stays on its own line, not netted. The ledger accounts stay gross.
18. **No offsetting between counterparties** (IAS 1.32; owner, 2026-11-12, extending ADR 0007's rule for client ad funds to every control account): after rule 17, each control account's balance is read per `client` dimension value (a balance with no client is one counterparty per account). A counterparty's balance on the account's normal side stays on the account's line; one on the other side is presented on the opposite side: a debit on a liability line in `bs.trade_receivables`, a credit on an asset line in `bs.trade_payables`. The statement shows each reclassified amount in a note under its line ("أعيد تبويب للعرض: …") with its drill-down to the counterparties. Non-control accounts are presented net on their line (a credit balance on an asset line shows negative and is flagged; open question Q17).
19. **Both columns** of a statement apply rules 16–18 at their own date or period.

### Profitability
20. **By client, contract, department or service** for a period (owner, 2026-11-12): each value's **revenue** (the lines of accounts on `is.revenue`), **direct costs** (accounts on `is.direct_costs`), **contribution** (revenue less direct costs) and **margin** (contribution over revenue). No other income-statement line enters: other income and expenses, exchange differences, finance costs and tax are outside. Client ad funds are a liability and never reach the income statement (scope §4). Pass-through purchases (Hub V2, scope §8) will come with their own statement line, outside these two, and so outside service profit.
21. The margin is a percentage with one decimal, rounded half away from zero (the money module's `divideHalfAwayFromZero`); "—" when revenue is zero.
22. **A line's value** is its own dimension value of the chosen type. For **department**, a revenue line without a department takes the department in force for its service on its `entry_date` (rule 32); a line with neither shows under **"غير موزع"**, and so does any line without the chosen dimension. Direct costs from Hub carry their department, client and contract (S05); revenue carries the client and the service and, when invoiced under one, the contract. Costs carry no service, so profitability by service shows costs only from manual lines tagged with a service, the rest under "غير موزع".
23. **Totals** equal the income statement's revenue and direct-cost lines for the period, "غير موزع" included. Default ledger: the parallel ledger (management, ADR 0007) when the company keeps one, else the book. A comparative period as rule 5.

### Contract position and revenue release schedule (F07)
24. **Contract position** as of a date: per contract, its contract assets and contract liabilities (gross, from rule 17's accounts), the net and the side it is presented on, its client and kind (project or retainer); totals agree with the balance sheet's two lines. Each row opens the contract's schedules (`/revenue`, S06).
25. **Revenue release schedule** from a date: per month ahead, the over-time releases still to post in the report's ledger at their carried amounts, by S06's plan with cumulative rounding (ADR 0007), per contract and in total; milestone and deposit lines still deferred show in a column **"عند الإنجاز"**, since their release date is their done (S06). The total equals what the schedules still have to recognise, which S06's integrity proof ties to the contract liabilities.

### The journal book (دفتر اليومية)
26. **Content** (ADR 0008; Commercial Code arts. 16–19, REPORTED): the book ledger's posted entries of a fiscal year in `(entry_date, number)` order. Each entry: its date, number, Arabic description and reference, then its lines with account code, Arabic account name, memo, debit and credit in the book currency. Each page's header: the company's legal name, "دفتر اليومية", the fiscal year, the page number; its footer: the page's debit and credit totals, the totals brought forward from earlier pages of the year ("ما قبله") and the cumulative totals ("المجموع حتى هذه الصفحة"), and the rule "مرتب حسب تاريخ القيد ثم رقمه". The book currency is labelled "الليرة السورية الجديدة" when it is SYP.
27. **Pages numbered through the year** (owner, 2026-11-12): pages are numbered from 1 at the first entry of the fiscal year and run on across months, so a month printed alone has the same page numbers and totals as in the year's print. Mizan paginates, not the browser: each entry takes one header row, plus continuation rows for a long description, and one row per line, plus continuation rows for a long name or memo; text is split at word boundaries at a fixed number of characters per column (constants in `packages/contracts`); a page holds a fixed number of rows; an entry split across pages continues with "تابع القيد رقم n". The renderer never reflows; a test renders a page of the longest values and checks nothing overflows.
28. **Official print** (owner, 2026-11-12): the reader picks a range of months of one fiscal year, every one closed (`PERIOD_NOT_CLOSED` otherwise, with the first open month). The worker renders it in one snapshot, refuses it if a month of the range is no longer closed in that snapshot (the file `failed` with `PERIOD_NOT_CLOSED`), and in the same transaction marks the file ready, inserts its `journal_book_prints` row (pages, counts, totals, `content_sha256` of the canonical rows and `file_sha256`) and writes `journal_book.printed`.
29. **The print register** lists every official print: range, pages, counts, totals, hashes, who and when. A print is **superseded** when a month of its range was reopened after it (from `period_events`, S07, computed on read); the register says so and the month's new print, after its re-close, takes the same first page. Only the latest closed month can be reopened (ADR 0016), so prints of earlier months never change.
30. **Draft print:** any range with an open month, and the parallel ledger's journal at any time, print with the mark "مسودة — غير رسمية" on every page, the same pagination, and no register row.
31. **Canonical rows:** the journal book's rows are produced by one function in `apps/worker` from the snapshot (header and line rows with their texts and amounts as strings). `content_sha256` is its SHA-256 over RFC 8785 JSON, so a reprint of the same closed range proves the same content.

### The service's department
32. **Dated department of a service** (owner, 2026-11-12): the department in force for a service on a date is its `service_departments` row with the latest `effective_from` on or before the date, the latest `created_at` among equals. Before its first row, a service has none.
33. **From Hub:** Hub's service reference on revenue lines gains an optional `department` (Hub's fixed department code; each catalogue service in Hub has one performing department). When an event's service carries a department other than the one in force on its accounting date, the posting transaction adds a row effective from the accounting date, or from the first day of the earliest open month when the date is in a closed month, so a closed month's profitability never changes. An unknown department code makes its value, as S05 rule 23 makes values.
34. **Manual:** for a service not linked to Hub, the owner or accountant adds a row with an effective date in an open month and a reason (`PERIOD_CLOSED` for a closed month). A Hub service's department comes only from Hub (`DIMENSION_FROM_HUB`).

### Exports and files
35. **Excel:** every report exports synchronously from the API (exceljs, ADR 0002) with Arabic headings, the report's parameters and marks (rule 4), amounts as numbers in major units when 15 digits hold them, else exact text (`spreadsheetAmount()`, S03), with the currency in its own column, and the SYP label "الليرة السورية الجديدة". At most 100,000 rows (`REPORT_TOO_LARGE`, with the count; a narrower range or the PDF).
36. **PDF:** `POST /api/reports/files` stores a `report_files` row and sends a pg-boss job; the worker renders the print layout of `packages/ui` to HTML with the brand fonts embedded and prints it with Chromium (A4, RTL, the company header, "صفحة n من m" except the journal book's rule 27 numbering); the screen shows the file's state and downloads it through the API. A file is ready within 60 s for a report of 2,000 pages. One user may have at most 3 files queued (`RATE_LIMITED`).
37. **Report identities** (`REPORTS`, append-only in `packages/contracts`): `trial_balance`, `general_ledger`, `account_statement`, `journal_book`, `income_statement`, `balance_sheet`, `profitability`, `contract_position`, `revenue_schedule`, `ageing`, `client_statement`, `chart`.

## Accounting treatment
None: S09 posts nothing. The presentation rules it introduces, each with its basis:
- the current year's result and earlier unclosed years in equity (rule 16; IAS 1.54(r), 1.106(d));
- contract positions net per contract (rule 17; IFRS 15.105, ADR 0007);
- no offsetting between counterparties on control accounts (rule 18; IAS 1.32);
- the income statement by nature with the IFRS 18 subtotals (rule 14; IAS 1.81A–85, 1.102; IFRS 18.69); exchange differences net on one line (IAS 21.52(a));
- profitability as a direct contribution margin, no allocation (rule 20; management reporting, outside IFRS);
- the department of revenue from the service's dated department (rules 22, 32).

**Worked example** (synthetic; SYP books, one fiscal year, balances as of 31 December, all months revalued):

| Account | Balance per counterparty (book) | Presented |
|---|---|---|
| `112001` receivables | C1 debit 600,000.00 · C2 credit 50,000.00 | Trade receivables 600,000.00 · trade payables 50,000.00 (reclassified) |
| `213001` client ad funds | C1 credit 120,000.00 · C3 debit 2,400.00 | Client money 120,000.00 · trade receivables 2,400.00 (reclassified) |
| `113001` contract assets | P-1 debit 500,000.00 · R-1 debit 300,000.00 | P-1 nets with `212001`; R-1 contract assets 300,000.00 |
| `212001` contract liabilities | P-1 credit 1,200,000.00 | P-1 contract liabilities 700,000.00 |

So trade receivables 602,400.00, trade payables 50,000.00, client money 120,000.00, contract assets 300,000.00, contract liabilities 700,000.00, while the trial balance shows `112001` debit 550,000.00, `213001` credit 117,600.00, `113001` debit 800,000.00 and `212001` credit 1,200,000.00. The scenario `reports/statement-presentation` states this example with its entries.

## Currencies, rates and rounding
- Reports convert nothing: each amount is a stored ledger amount (book or parallel) or a transaction amount (rule 11), summed exactly. No rate is read, except the closing rates shown beside the "قبل إعادة التقييم" mark's link to `/revaluation` (S07).
- Every currency shape: `syp` (one ledger, no switch), `syp-usd` (Vertex Media), `usd-syp` (USD books, SYP parallel), `third` (TRY or EUR lines: the account statement shows the TRY transaction column; statements show ledger amounts only).
- The only rounding is the margin percentage (rule 21). The revenue release schedule's future months use S06's cumulative rounding of carried amounts, so the months sum exactly to what remains.

## Periods
- Reports read open, closed and reopened months alike and mark the open ones (rule 4). Months before the first period read as closed (S07).
- The official journal book needs closed months (rule 28); a reopen supersedes the prints of its month (rule 29). A close racing an official print: the worker's snapshot decides (rule 28).
- A department row never takes effect in a closed month (rules 33, 34).
- No checklist item is added.

## API
All under the internal `/api`, `reports.read` unless stated, company context from the session (ADR 0003). Amounts are `MinorUnits` strings (S03). Queries are validated by Zod in `packages/contracts` (`reports.ts`).

| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/reports/trial-balance` | `reports.read` | `from`, `to`, `ledger`, `level` (1–4), `codeFrom`, `codeTo`, `nonZero`, `compareFrom`, `compareTo` | rows (account, level, kind, opening, debits, credits, closing, comparative), totals, marks | `VALIDATION_FAILED`, `COMPANY_NOT_SELECTED` |
| `GET /api/reports/general-ledger` | `reports.read` | `from`, `to`, `ledger`, `codeFrom`, `codeTo`, `cursor` | per account: opening, lines with running balance, closing; next cursor | as above |
| `GET /api/reports/accounts/:id/statement` | `reports.read` | `from`, `to`, `ledger`, `dims`, `currency`, `cursor` | opening, lines with ledger and transaction amounts and both running balances, closing, per currency | as above, `NOT_FOUND` |
| `GET /api/reports/journal` | `reports.read` | `from`, `to`, `ledger`, `cursor` | entries with lines, in `(entry_date, number)` order | as above |
| `GET /api/reports/income-statement` | `reports.read` | `from`, `to`, `ledger`, `compareFrom`, `compareTo` | lines, subtotals, both columns, marks | as above |
| `GET /api/reports/balance-sheet` | `reports.read` | `asOf`, `ledger`, `compareAsOf` | sections, lines, reclassification notes, the year's result, totals, marks | as above |
| `GET /api/reports/profitability` | `reports.read` | `by` (`client` · `contract` · `department` · `service`), `from`, `to`, `ledger`, `compareFrom`, `compareTo` | rows (value or unassigned, revenue, direct costs, contribution, margin), totals | as above |
| `GET /api/reports/contract-position` | `reports.read` | `asOf`, `ledger`, `client` | rows per contract, totals | as above |
| `GET /api/reports/revenue-schedule` | `reports.read` | `from`, `ledger`, `contract` | months ahead per contract, "at done", totals | as above |
| `GET /api/reports/lines` | `reports.read` | `ledger`, `from`, `to`, one of `account` · `statementLine`, `counterparty`, `contract`, `dims`, `profitability` (`by`, `value`), `cursor` | the lines behind a figure, with entry and Hub document, and their sum | as above |
| `GET /api/reports/:report/export` | `reports.read` (`open_items.read` for `ageing`, `client_statement`; `accounts.read` for `chart`) | the report's query, `format=xlsx` | the file | as above, `REPORT_TOO_LARGE` |
| `POST /api/reports/files` | as the report | `{ report, params, official? }` (`format` is `pdf`) | the file row | as above, `PERIOD_NOT_CLOSED`, `RATE_LIMITED` |
| `GET /api/reports/files` · `GET /api/reports/files/:id` · `GET /api/reports/files/:id/download` | the requester; the register's files for `reports.read` | — | rows (own, newest first); one row; the PDF | `NOT_FOUND`, `LINK_INVALID` (expired) |
| `GET /api/reports/journal-book/prints` | `reports.read` | `fiscalYear` | the register, with `superseded` | as above |
| `GET /api/dimensions/values/:id/departments` · `POST …/departments` | `dimensions.read` · `dimensions.manage` | `{ departmentValueId, effectiveFrom, reason }` | the service's history | `DIMENSION_FROM_HUB`, `PERIOD_CLOSED`, `VALIDATION_FAILED`, `NOT_FOUND` |
| `POST /v1/events` | API client `events:write` | the service reference gains `department` (optional, Hub's code) | unchanged | unchanged |

- New error codes, appended: `REPORT_TOO_LARGE` (422, detail: the row count), `DIMENSION_FROM_HUB` (409).
- `/v1`: one optional field, additive (ADR 0006); the OpenAPI guard sees no breaking change; the JSON Schema export and the examples carry it.
- Reads are idempotent; `POST /api/reports/files` makes a new file per request (a double click makes two, both counted by the limit of rule 36).

## Jobs and events
- **`reports.render`** (pg-boss, sent by the API after the `report_files` insert commits): the worker, as `mizan_jobs` in the file's company context, reads the report in one `REPEATABLE READ` snapshot, renders, writes the file and marks the row `ready` (or `failed` with the code). Retried twice on a crash; safe to run twice because a `ready` or `failed` row is skipped and the official print's register row is unique per `report_file_id`.
- **`reports.files-expire`** (hourly): rows `ready` for 24 hours and not official turn `expired` and their files are deleted.
- **Events:** `invoice.issued` and the other revenue-line events read the service's `department` (rule 33). No new event type.

## Screens
Design-system components only (ADR 0010). New general components in `packages/ui`, first, each tested and on the design-system page:
- **`ReportTable`**: hierarchical rows with indentation by level, subtotals and totals, comparative columns, every figure a drill-down link, a sticky header, both densities, keyboard navigation, and on a phone one card per row;
- **`ReportMarks`**: rule 4's marks with their links (the month's period page, the revaluation);
- **`ExportMenu`**: Excel (download) and PDF (queued, its state, download when ready);
- **`print/`**: the print layout (A4 page, the company header, page number, the journal book's page footer) rendered to static HTML by the worker.

| Route | Content and actions | Drill-down | Export | States | Roles |
|---|---|---|---|---|---|
| `/reports` | The reports by group, each with its last parameters (kept per viewer in the browser) | — | — | — | `reports.read` |
| `/reports/trial-balance` | Rule 9: period, comparative, level, code range, non-zero; ledger switch; totals with a mark if unequal (never expected; a failure is an incident) | figure → lines | Excel, PDF | loading (skeleton), empty ("لا قيود في هذه الفترة"), error | every role |
| `/reports/general-ledger` · `/reports/accounts/:id` | Rules 10, 11; the account picker; the currency view | line → entry → Hub event | Excel, PDF | as above | every role |
| `/reports/journal` | Rule 12; print the journal book: official (closed months) or draft | entry | Excel, PDF (rules 27–30) | as above; an official print refused names the first open month | every role |
| `/reports/journal-book/prints` | Rule 29: the register, superseded prints marked; download a print | — | the stored PDF | empty, error | every role |
| `/reports/income-statement` | Rule 14 with comparative; ledger switch | line → its accounts → lines | Excel, PDF | as above | every role |
| `/reports/balance-sheet` | Rules 15–19; the reclassification notes; the year's result line | line → accounts → counterparties or contracts → lines | Excel, PDF | as above | every role |
| `/reports/profitability` | Rule 20 by the chosen dimension; sort by contribution or margin | figure → lines | Excel, PDF | as above | every role |
| `/reports/contract-position` · `/reports/revenue-schedule` | Rules 24, 25 | contract → `/revenue` schedules | Excel, PDF | as above | every role |
| `/reports/lines` | The lines behind a figure, their sum equal to it, with the figure's parameters | entry | Excel | as above | every role |
| `/dimensions` (service sheet) | The department history; add a dated row for a manual service | — | — | — | `dimensions.manage` to add |

S04's `/receivables` and `/receivables/clients/:valueId` and S02's `/chart` gain PDF in their `ExportMenu`. The sidebar gains "التقارير"; the command palette "ميزان المراجعة"، "قائمة الدخل"، "الميزانية"، "كشف حساب…"، "دفتر اليومية". Every screen is RTL, responsive from 360 px.

## Reports
Each report and how it reconciles to the ledger:
- trial balance = `period_balances` + the partial month's lines; its totals balance (ADR 0005);
- general ledger and account statement: opening + lines = closing, and closing equals the trial balance's;
- income statement's result = the trial balance's classes 4–5 net for the period;
- balance sheet: assets = liabilities + equity, with rule 16's line; the reclassifications of rules 17–18 change both sides by the same amounts; the gross accounts equal the trial balance;
- profitability's totals = the income statement's revenue and direct costs;
- contract position's totals = the balance sheet's contract lines; the revenue schedule's total = the schedules' remaining;
- the journal book's totals for a range = the trial balance's period debits and credits for the same dates in the book ledger;
- the receivables ageing (S04) = the receivable accounts' balance in the trial balance at the same date.

## Printing and legal books
- **The journal book** (rules 26–31): Arabic, A4, the company's legal name, pages numbered through the fiscal year, page totals and totals brought forward, the ordering rule in the footer, the SYP label "الليرة السورية الجديدة", official only for closed months, its print register. The Commercial Code's numbering and certification by the competent authority (arts. 16–19, REPORTED) are done on the printed book outside Mizan; the register records what was printed.
- Every other report prints with the company header, its parameters and marks, "صفحة n من m", Arabic headings, the SYP label.
- Amounts in words: none.

## Volume and performance
- Vertex Media: a few hundred to 2,000 entries a month; the largest company served: 100,000 entries and 500,000 lines a year (S03), 2,000 accounts, 50,000 dimension sets.
- The trial balance, the income statement and the balance sheet read `period_balances` for whole months and the lines of at most two partial months (index `(company_id, entry_date)` on the lines, S03): ≤ 1 s for a year. Profitability by department reads the period balances per month and dimension set and, for a service whose department changed inside a month, that service's lines of the month: ≤ 2 s.
- The general ledger, the account statement and the journal page by cursor, 200 rows a page: ≤ 500 ms a page.
- PDF: ≤ 60 s for 2,000 pages; the journal book of a year of the largest company (≈ 15,000 pages) ≤ 10 minutes in the worker. Excel: ≤ 30 s for 100,000 rows.

## Migration and compatibility
- New schema module `reports` in `packages/db` (`report_files`, `journal_book_prints`) and `service_departments` in the `dimensions` module, with RLS, grants, guards and registry entries (`/db-migration`). Expand only.
- `packages/contracts`: `reports.ts` (the queries, rows, marks, `REPORTS`, the journal book's pagination constants and canonical row shape), `PERMISSIONS` gains `reports.read` for every role, the error codes and audit actions appended, `events.ts`' service reference gains the optional `department`.
- **Hub must send** (Q5, added): the service's department code on each revenue line's service reference. Until then, departments of Hub services are absent and revenue by department shows "غير موزع"; history replayed through S10 carries the department Hub knows at replay.
- `apps/worker` gains Chromium through the pinned Playwright already used by the E2E suite (ADR 0002), installed on the server by the deployment ADR (Q2's record).
- No existing data changes; S02's chart export and S04's exports gain PDF without changing Excel.

## Arabic strings and number formats
- New namespace `ar.reports`: the report names, columns (رصيد أول المدة، حركة الفترة، رصيد آخر المدة، مدين، دائن، المقارنة), marks (غير نهائية: الفترة مفتوحة، قبل إعادة التقييم، مسودة — غير رسمية), statement subtotals (الربح التشغيلي، الربح قبل التمويل وضرائب الدخل، الربح قبل الضريبة، ربح (خسارة) الفترة، ربح (خسارة) السنة الحالية، تشمل نتائج سنوات غير مقفلة), reclassification notes (أعيد تبويب للعرض), profitability (الإيراد، التكاليف المباشرة، هامش المساهمة، نسبة الهامش، غير موزع), the journal book (ما قبله، المجموع حتى هذه الصفحة، تابع القيد رقم، مرتب حسب تاريخ القيد ثم رقمه، سجل الطبعات الرسمية، مستبدلة), the release schedule (عند الإنجاز); `ar.errors` for `REPORT_TOO_LARGE` and `DIMENSION_FROM_HUB`.
- Latin digits, `,` grouping, every decimal; dates `YYYY-MM-DD`; percentages with one decimal and `%`; SYP printed as "الليرة السورية الجديدة".
- Glossary: contribution margin, comparative period, year's result, reclassified for presentation, official print, print register, brought forward, service department.

## Audit
One `audit_entries` row in the same transaction (S01 rules 23, 24):
- `export.trial_balance`, `export.general_ledger`, `export.account_statement`, `export.journal_book`, `export.income_statement`, `export.balance_sheet`, `export.profitability`, `export.contract_position`, `export.revenue_schedule`, with the format and parameters; S04's `export.ageing` and `export.client_statement` and S02's `export.chart` gain the format `pdf`;
- `report_file.downloaded` on each PDF download;
- `journal_book.printed` with the register row (rule 28);
- `service_department.set` with before and after, by a person or by an event (rules 33, 34).
Reading reports is not logged (S01 rule 24).

## Abuse and failure cases
- **Cross-company access:** every read is in the company context under forced RLS; files are served through the API by company and requester; composite keys on the new tables; an E2E and API test per endpoint with another company's ids answers `NOT_FOUND`.
- **A heavy request as denial of service:** the Excel row limit (rule 35), cursor pages, three queued PDFs per user (rule 36), the worker's concurrency of two renders per instance.
- **A leaked file link:** files only through the authenticated API, by the requester (the register's prints by `reports.read`), 24 hours, audited downloads.
- **A forged or altered printed journal:** the register's `content_sha256` and `file_sha256`; a reprint of the same closed range has the same content hash; the integrity chain (S03) proves the entries.
- **A race with a close or reopen:** the worker's snapshot (rule 28); a report read during a close is consistent, as it reads one snapshot per request.
- **A stolen Hub key:** it can only add a department row from a later open date (rule 33), audited with the event; no report is reachable with an API key.
- **Hub down or out of order:** reports read only what posted; an older-dated event arriving later adds its row at its own date, so the history stays dated (rule 32).
- **Double submit:** a second PDF request makes a second file (no harm, counted by the limit).

## Edge cases
1. **Concurrency:** an entry posted while a report runs is either fully in or fully out (one snapshot per request).
2. **Zero:** a trial balance of a period with no lines shows openings only; with "non-zero" off, every account with zeros.
3. **Negative balances:** an asset account in credit and a revenue account in debit show on their opposite side in the trial balance; rule 18 handles control accounts, Q17 the others.
4. **`syp`:** no ledger switch; profitability defaults to the book.
5. **`syp-usd`:** the book in SYP, the parallel in USD, each balanced; a USD receivable's revaluation entry and its reversal on the 1st appear in the book only.
6. **`usd-syp`:** the book in USD, the journal book's currency USD with no SYP label on its amounts.
7. **`third`:** a TRY line in the account statement's TRY column; statements in ledger amounts only.
8. **Mid-month balance sheet:** "قبل إعادة التقييم"; the previous month's revaluation already reversed on the 1st, so balances are at carrying amounts.
9. **A missing revaluation** at a month end (`rate_missing` or `to_post`): the mark links to `/revaluation`.
10. **Archived account or value** with a balance: shown and marked; with none in the period, hidden by "non-zero".
11. **A changed statement line:** every period re-presented (S02 rule 4); the comparative too.
12. **A void after a release** (S06): the void's entries are in their month; the contract position nets the reversed schedule; profitability shows the revenue reversed in the void's month.
13. **A reopened month:** its reports turn "غير نهائية"; its official prints superseded; a re-close and a new print take the same first page.
14. **A contract with assets and liabilities in two currencies:** netted in the ledger's amounts, which are in one currency.
15. **A client with a credit on receivables and a debit on ad funds:** each account split separately (rule 18), never netted across accounts.
16. **A balance with no client on a control account** (a manual line): one counterparty for the account.
17. **A service's department changed mid-month by Hub:** lines before the change date keep the old department, after it the new.
18. **A department event dated in a closed month:** effective from the first open day (rule 33).
19. **The first fiscal year:** the balance sheet's default comparative is the day before the first period (2026-09-30 for Vertex Media), showing "—".
20. **A year's change:** a trial balance from 2027-01-01 opens classes 4–5 with 2026's result; the balance sheet shows it in retained earnings with its note.
21. **A long description** in the journal book: continuation rows; an entry of 500 lines spans pages with "تابع القيد".
22. **Leap day:** 29 February 2028 is a day like any other; the comparative period's length is counted in days.
23. **An empty month in an official print:** included, with no rows; its pages are none, and the next month continues the numbering.

## Scenarios
- **`docs/scenarios/reports/statement-presentation.md`** (new area `reports`): the presentation rules of this spec as solved examples in `syp-usd`, `syp`, `usd-syp` and `third`: the worked example above (rules 17, 18) in both ledgers; the year's result and an earlier unclosed year in equity (rule 16); the income statement's subtotals (rule 14); profitability by department with a service's department changed mid-month and one with none (rules 20–23, 32, 33); the trial balance's totals and a journal book's page totals and brought-forward totals for a month and for the year (rules 9, 27). The book's YAML gains a `report` expectation (the report, its parameters and the expected lines), and the runner checks it after the steps. Written and approved through `/posting-rule` before the reports' code.

No posting, recognition, revaluation or settlement rule changes.

## Open questions
- **Q11** (open): exchange differences by IFRS 18 category; S09 keeps one line (rule 14) until IFRS 18 statements (2027).
- **Q17** (new): a non-control account presented on the opposite side (a bank account in credit, an overdraft). Recommendation: a new statement line `bs.borrowings` ("القروض والسلف قصيرة الأجل", IAS 1.54(m)) and the balance presented there; until then shown negative and flagged (rule 18). Needed before the first real balance sheet with an overdraft.
- **Q5** (open): Hub's side gains the service's department (Migration).

## Acceptance
- **The owner's end-to-end check** (a test company with the service-agency template, `syp-usd`, after `post:hub-examples` and a closed month):
  1. `/reports/trial-balance` for the closed month: six columns, debits equal credits in each pair; switch to the parallel ledger: balanced too. Open a receivables figure: its lines sum to it; open one line's entry and its Hub event.
  2. Change the level to 2: header sums; add the comparative: the previous month's closing balances.
  3. `/reports/income-statement` for the month: revenue, direct costs, "الربح التشغيلي", "ربح (خسارة) الفترة", equal to the trial balance's classes 4–5.
  4. `/reports/balance-sheet` at the month end: no mark; assets equal liabilities and equity; "ربح (خسارة) السنة الحالية" equals the year's income statement; a client with a credit on receivables appears in trade payables with its note; a project's deposit and its done milestone netted to one contract liability.
  5. The same at a mid-month date of the open month: both marks.
  6. `/reports/profitability` by department in USD: each department's revenue and direct costs; totals equal the income statement's; by service: costs "غير موزع".
  7. `/reports/contract-position` and `/reports/revenue-schedule`: totals equal the balance sheet's contract lines and the schedules' remaining.
  8. `/reports/journal`: print the closed month as official; the PDF in Arabic, pages from 1, page totals and "ما قبله"; the register lists it with its hashes. Try the open month: refused naming it; print it as a draft: marked "مسودة — غير رسمية". Reopen the closed month: the register marks the print superseded.
  9. Export each report to Excel and PDF; the audit log shows each export.
  10. As a viewer: every report reads and exports; no write action.
- **Tests:**
  - API: per endpoint success, 401, 403 (a role without the permission, none for `reports.read`), another company's ids `NOT_FOUND`, the files' requester rule, `REPORT_TOO_LARGE`, `PERIOD_NOT_CLOSED`, `DIMENSION_FROM_HUB`;
  - unit and property tests: every report's agreement of rule 8 over random posted books in every currency shape (trial balance equals the lines; balance sheet balances after reclassifications; profitability totals; the journal book's pagination is the same for a month alone and within the year, and every page's totals carry forward);
  - the scenario book with `reports/statement-presentation`;
  - invariant tests for `service_departments` and `journal_book_prints` (append-only, RLS, composite keys, the closed-period guard) and `report_files` (state updates only);
  - the worker: a render in a snapshot, the official print's refusal after a reopen, the retry safety;
  - E2E with RTL screenshots, light and dark, at 360, 768 and 1280 px: the trial balance with drill-down, the balance sheet with a reclassification note, profitability, the journal book's official print and the register, an export.
