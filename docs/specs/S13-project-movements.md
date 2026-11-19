# S13 — Project movements

Status: Draft · Date: 2026-11-19 · Features: ADR 0024 (replaces the screens of F01–F14 for one contracting company) · ADRs: 0003, 0005, 0007, 0013, 0021, 0022, 0023, 0024

<!-- Approved once the owner approves the expected entries of docs/scenarios/projects/simple-movements.md. -->

## Summary
The owner of a contracting company keeps each project's money in a few plain movements: received, expenses, workers' wages, what the company owes and what it is owed. S13 gives the screens and API for that, built over the existing ledger: projects and their clients, movements turned into vouchers, purchase invoices or manual entries, materials and their costs, daily SYP and TRY rates against the USD, a dashboard, and complete PDFs under the company's name and logo.

## The owner's answers (2026-11-19)
1. One person uses the system, with email and password.
2. Totals are in USD; each movement shows its own currency.
3. Seven project movements: received, expense, wages, owed by us, owed to us, debt paid, debt collected.
4. A movement is cancelled with a reason, never deleted, and stays visible as cancelled.
5. One box per currency, chosen by the movement's currency; the person never handles boxes.
6. The accounting screens (chart, journal, periods, revaluation, integrity) are hidden.
7. The company's name and logo are set in the app, not in the code (the repository is public).
8. A receipt from the client is revenue at once (ADR 0024 §4).
9. Everything simple, clear and professional; the PDF of all projects or of one project, with the company's name and logo.

## In scope / out of scope
- In:
  - projects (a `contract` value of kind `project`) with their client, optional contract value and currency, start date and state (active or finished);
  - clients and suppliers (the built-in `client` and `supplier` dimensions) added by name where they are needed;
  - movements and their cancellation; the cash deposit;
  - the materials catalogue (name, unit) and material costs, across projects or for one;
  - the day's rates USD/SYP and USD/TRY and their history;
  - the dashboard, the project page, the client and supplier pages;
  - the company's display name and logo;
  - three PDFs: all projects, one project, materials.
- Out:
  - several companies or people, roles, invitations, two-factor screens;
  - progress billings, retentions, advances, subcontracts and wage sheets per worker (S12's documents stay in the engine, without screens);
  - screens for the chart, journal, drafts, periods, revaluation, integrity, exports and the statutory reports;
  - an automatic month-end revaluation of SYP and TRY balances (ADR 0024, Consequences);
  - Excel exports.

## Access
| Action | Surface | Who |
|---|---|---|
| Everything in this spec | Web | The company's one person, its owner (every permission) |

Every endpoint declares its permission (the API table); the owner holds them all. Movements post their entry at once, so the company keeps manual-entry approval off: the settings screen never offers it, and a movement while it is on is refused (`VALIDATION_FAILED`, detail `manualEntryApproval`), since one person cannot approve their own draft (S03 rule 8).

## Data
- `project_movements` (company, append-only): `id`, `company_id`, `number` (per fiscal year, gapless, from `project_movement_sequences`), `kind` (enum `movement_kind`: `received` · `expense` · `wages` · `owed_by_us` · `owed_to_us` · `debt_paid` · `debt_collected` · `deposit`), `date`, `contract_value_id` (the project; null only for `deposit`), `counterparty_value_id` (the client or supplier; null for `expense`, `wages`, `deposit`), `currency`, `amount_minor` (positive), `description`, `material_id`, `quantity`, `unit_price` (all three or none; only on `expense` and `owed_by_us`), `entry_id` (the posted entry, unique), `request_key` and `request_hash` (the idempotency key and the canonical request's SHA-256; unique on `(company_id, request_key)`), `created_by`, `created_at`. Composite keys to the contract value, counterparty, material and entry. Written only by `post()` (rule 1). A pinned guard: the row's entry is the one its draft posted in this transaction, its number its sequence's next, its kind's shape holds, and its counterparty is the project's client for `received`, `owed_to_us` and `debt_collected`.
- `project_movement_sequences` (company, ledger state): as `voucher_sequences`.
- `project_movement_cancellations` (company, append-only): `movement_id` (unique), `reversal_entry_id` (unique), `reason`, `created_by`, `created_at`; composite keys to the movement and the entry. A pinned guard: the reversal entry reverses exactly the movement's entry. A deferred check on `journal_entries`: a reversal of a movement's entry has its cancellation row at commit, so the entry reversal route refuses one outside the movement path (`ENTRY_NOT_REVERSIBLE`). The ledger and a movement's state never disagree.
- `project_details` (company, business): `contract_value_id` (unique, composite key), `start_date`, `state` (`active` · `finished`). Management data with no accounting effect. The optional contract value and its currency are S12's `project_terms`, which the project report already reads.
- `company_branding` (company, business, one row): `display_name`, `logo_storage_key`, `logo_content_type` (`image/png`, `image/jpeg`), `logo_sha256`, `updated_at`. The logo is stored as attachments are, at most 1 MB, PNG or JPEG only (no SVG, so nothing to sanitise), served with its stored `Content-Type`, `X-Content-Type-Options: nosniff` and a `Content-Security-Policy` that allows nothing. The sign-in page, before any session, reads the branding of the one company the server names in its `.env` (`SIGN_IN_COMPANY_ID`) under `withCompany`, never from the request: `GET /api/branding/public` answers that company's display name and logo only; without the setting it answers the product's generic name and no logo. A test proves a signed-out request cannot choose another company.
- Materials: S12's `materials` (code generated, name, unit).

## States and rules
1. A movement is recorded and posted in one request and one transaction. After the ledger head is locked, the request's key is looked up: the same key with the same request answers the first movement; with another request it is `IDEMPOTENCY_CONFLICT`. Otherwise the API prepares the draft of its path (§ Accounting treatment) and posts it through `post()` (or `postVoucher()`) with a `movement` part, as a voucher passes its `voucher`: `post()` takes the movement's next number before the entry (an owed-to-us item needs it), posts the entry and writes the movement row. Tests: two identical requests at once post one entry; the same key with another request is refused.
2. A refusal of the path is the movement's refusal with the same code: `CASH_BOX_NEGATIVE` (the box would go below zero: the screen offers a deposit), `RATE_MISSING` (no rate for the day: the screen opens the rates), `PERIOD_CLOSED`, `VALIDATION_FAILED`.
3. The date is today by default and may be any earlier day; a future date is refused (`ENTRY_DATE_OUT_OF_RANGE`).
4. `debt_paid` and `debt_collected` take the debt's currency: a supplier's running item and a client's open items are per currency (S04). The screen offers the currencies with an open amount for that project and party.
5. `debt_collected` settles the client's open items of that project and currency, oldest due date first, then oldest number; the last item it reaches may be cleared in part, at its carrying amount in proportion (S04 rule 10). More than is open for that project and currency is refused (`VALIDATION_FAILED` with the open amount).
6. `debt_paid` pays the supplier for that project and currency, at most what the project owes the supplier in that currency (the transaction amounts of the `211001` lines carrying the project), else `VALIDATION_FAILED` with that amount. The supplier's running item is per account, supplier and currency, not per project (S04 rule 3), so the payment clears it at the average carrying amount of the whole item (ADR 0007): the exchange difference it realises is the supplier's, not the project's (`projects/simple-movements.md`, two projects).
7. `received` is refused while the project's client has open items for that project in any currency (`CLIENT_HAS_OPEN_DEBT`, a new error code, with the open amounts), even when the cash comes in another currency than the debt: the money pays what is due first, so it is a `debt_collected`; the screen offers to record it as one. This keeps a receipt from being revenue twice (ADR 0024 §4: revenue when received with nothing due before it).
8. Cancelling a movement reverses its entry (S03 rule 9; a voucher's cancellation, S11) on the cancellation day in Damascus, with a reason, and writes the cancellation row through the same `post()`. A cancelled movement stays in every list, marked; the figures read the ledger, so the movement counts on its date and its reversal on the cancellation's, and they net to zero in any range holding both. Cancelling a receipt or a deposit whose cash was spent is refused (`CASH_BOX_NEGATIVE`). `owed_to_us` with collections standing on its item is refused (`OPEN_ITEM_HAS_SETTLEMENTS`): cancel those first. `owed_by_us` is refused when, after it, the project's `211001` lines for that supplier and currency would net to a debit, more paid than owed (`VALIDATION_FAILED`): cancel the payments first.
9. A project is created with its client; a finished project takes no new movement (`PROJECT_FINISHED`, a new error code) and can be made active again.
10. A material with movements keeps its unit (S12 rule 3); a material is archived, never deleted.

## Accounting treatment
Accounts of `contracting@1` (S11, S12). The project is the line's `contract` dimension; the client and supplier their own. The scenario `docs/scenarios/projects/simple-movements.md` pins each entry.

| Movement | Path | Entry |
|---|---|---|
| Received | receipt voucher | Dr box of the currency / Cr `411001` revenue (client, project) |
| Expense with a material | payment voucher | Dr `511001` materials (project; material, quantity, unit price) / Cr box |
| Expense without a material | payment voucher | Dr `511006` other site costs (project) / Cr box |
| Wages | payment voucher | Dr `511002` wages (project) / Cr box |
| Owed by us | purchase invoice (S12) | Dr `511001` (with a material) or `511006` (project) / Cr `211001` suppliers (supplier, project) |
| Owed to us | manual entry | Dr `112001` receivables (client, project; a new item `حركة <fiscal year>/<number>`, unique for good like every document reference, due on its date) / Cr `411001` (client, project) |
| Debt paid | payment voucher | Dr `211001` (supplier, project) / Cr box |
| Debt collected | receipt voucher | Dr box / Cr `112001` (the items, oldest first) |
| Deposit | receipt voucher | Dr box / Cr `313001` owner's current account |

- **Basis:** IAS 1.102 (costs by nature, each carrying its project); IAS 21.21–22 (each line at the rate of its day, the dealt rate accepted by the USD book) and 21.28 (a debt paid or collected at another rate than it was carried at realises an exchange difference, `421001` or `541001`, posted by the existing settlement rules); revenue by ADR 0024 §4, the company's management policy approved by the owner on 2026-11-19, departing from IFRS 15.35(b).
- **Correction:** by cancellation only (rule 8).
- **Exchange differences:** a debt paid or collected at another rate than it was carried at realises the difference of the whole item (rules 5 and 6), outside the project's profit (§ Reports).
- **Open items:** owed to us opens a document item; debt collected settles it; owed by us and debt paid move the supplier's running item.

## Currencies, rates and rounding
- The book is USD at `market`, accepting the dealt rate; there is no parallel ledger. The person records, once a day, 1 USD in SYP and 1 USD in TRY (`market` rows, the company's orientation of each pair).
- A movement in SYP or TRY is measured in USD at that day's rate, rounding half away from zero through the money module. A movement may carry a rate dealt for it, which then measures it.
- A material's line amount is quantity (up to 3 decimals) × unit price (up to 4), rounded per line (S12 rule 12).
- The dashboard and PDFs give totals in USD from the book amounts, with each currency's own balance beside them.

## Periods
No period screen. A movement dated in a closed month is refused (`PERIOD_CLOSED`); nothing in S13 closes a month.

## API
| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/dashboard?from&to` | `reports.read` | — | totals in USD, balances by currency, projects ranked, latest movements, top materials, today's rates or what is missing | — |
| `GET /api/projects` · `POST /api/projects` · `PATCH /api/projects/:id` | read `reports.read`; write `dimensions.manage` | name, client (id or a new name), start date, contract value and currency, state | the project with its summary | `DIMENSION_CODE_TAKEN`, `VALIDATION_FAILED` |
| `GET /api/projects/:id/summary` | `reports.read` | — | received, expenses, wages, revenue, costs, profit, cash, owed by us, owed to us, each in USD and by currency | `NOT_FOUND` |
| `GET /api/movements?project&kind&currency&from&to&cursor` | `entries.read` | — | movements, newest first, with their state | — |
| `POST /api/movements` | `drafts.manage` and `entries.post` | kind, date, project, party, currency, amount or material with quantity and unit price, description, dealt rate, idempotency key | the movement | rule 2's codes, `ENTRY_DATE_OUT_OF_RANGE`, `PROJECT_FINISHED`, `CLIENT_HAS_OPEN_DEBT`, `IDEMPOTENCY_CONFLICT` |
| `POST /api/movements/:id/cancel` | `entries.post` | reason | the movement | `ENTRY_ALREADY_REVERSED`, `OPEN_ITEM_HAS_SETTLEMENTS`, `CASH_BOX_NEGATIVE`, `REVERSAL_BEFORE_ORIGINAL`, `PERIOD_CLOSED`, `VALIDATION_FAILED` |
| `GET /api/parties?type=client|supplier` · `POST /api/parties` | read `dimensions.read`; write `dimensions.manage` | name | parties with what they owe or are owed | `DIMENSION_CODE_TAKEN` |
| `GET /api/materials` · `POST` · `PATCH /api/materials/:id` | read `dimensions.read`; write `dimensions.manage` | name, unit | S12's | `MATERIAL_LOCKED` |
| `GET /api/materials/costs?project&from&to` | `reports.read` | — | per material: quantity, cost in USD and by currency, per project | — |
| `GET /api/rates/today` · `POST /api/rates` | read `rates.read`; write `rates.manage` | SYP and TRY per USD for a day | the day's rates | `RATE_REASON_REQUIRED` (a correction) |
| `GET /api/company/branding` · `PUT /api/company/branding` · `GET /api/company/logo` | read `company.read`; write `company.settings`; `GET /api/branding/public` public | display name; the logo as one file | the branding | `VALIDATION_FAILED` (type, size) |
| `POST /api/reports/files` | `reports.read` | `projects_overview`, `project_statement` (project), `material_costs`, with a range | the queued file, as S09's | S09's |

New error codes are appended to the registry: `PROJECT_FINISHED`, `CLIENT_HAS_OPEN_DEBT`. The API tests cover each refusal of rules 3 to 9, the more-than-open refusals of rules 5 and 6 included, and each route as another company's member and as a person without its permission.

## Jobs and events
The three PDFs render in the worker's `reports.render` job as S09's do, idempotent by file.

## Screens
All in Arabic, on the design system, responsive from 360 px, each with its loading, empty and error states. The header shows the company's logo and display name.

1. **Sign-in** (`/sign-in`): the logo and name from `GET /api/branding/public`, email and password.
2. **Dashboard** (`/`): cards (projects, received, costs, profit, cash, owed by us, owed to us) in USD; the day's rates or a prompt to record them; projects by profit; latest movements; materials by cost; actions: new project, new movement, PDF of everything.
3. **Projects** (`/projects`): each project's client, movements, cash and profit; search; active or finished; new project in a dialog (name, client picked or added, start date, contract value optional).
4. **Project** (`/projects/:id`): the summary cards; the tab "الحركات" (filters by kind, currency, dates; each movement's number, date, kind, description, material, amount; cancel with a reason); the tab "المواد" (the project's materials with quantity and cost); new movement; the project's PDF.
5. **New movement** (a dialog, from the project or the dashboard): the kind first, then only its fields: date, amount and currency, or material, quantity and unit price; the supplier for owed by us and debt paid; the open amount shown for debts; a description. Keyboard-first; a refusal says what to do (record today's rate, deposit cash).
6. **Clients** (`/clients`) and **suppliers** (`/suppliers`): each party's projects and what it owes or is owed, by currency; a party's page with its movements.
7. **Materials** (`/materials`): the catalogue with its dialog; the costs per material across projects or for one, over a range.
8. **Rates** (`/rates`): today's two rates, the record dialog, the last 30 days.
9. **Cash** (part of the dashboard): each box's balance, and "إيداع في الصندوق".
10. **Settings** (`/settings`): the company's display name and logo, the person's password.

## Printing
Three PDFs on A4, Arabic, right to left, each page with the company's logo and name, the report's title and range, the print time and page numbers; amounts with their currency, totals in USD, SYP labelled "الليرة السورية الجديدة".
- **All projects:** a cover; the summary; one section per project (summary, movements, materials, debts); materials across projects; debts by party; the rates used.
- **One project:** the project and client; the summary; the movements; the materials; its debts.
- **Materials:** per material and per project.

## Reports
Every figure is read from ledger lines, never summed from movement amounts, so a debt settled at another rate leaves no gap:
- **Revenue** of a project: its `411001` lines; **costs**: its `511xxx` lines (`is.direct_costs`); **profit**: revenue less costs, in USD (book amounts). Received, expenses and wages, shown apart, are the same lines grouped by their movement's kind.
- **Net cash** of a project: the book amounts of the box lines of its movements' entries and of their cancellations' reversal entries, each on its own date (received, collected, less expenses, wages and debts paid). The boxes themselves are the company's: the dashboard shows each box's balance in its currency and its book amount.
- **Owed to us** of a project: the open amounts of its items on `112001`, in each currency, with what they carry in USD.
- **Owed by us** of a project: the transaction amounts of the `211001` lines carrying the project, in each currency (exact: 0 once the project's debt is paid). Its USD figure is the supplier's average carrying amount of the item times the project's share; the supplier's page shows the item's exact book balance.
- **Exchange differences** (`421001`, `541001`) are the company's, outside project profit; the dashboard shows them as one line.

Property tests: each project's revenue and costs equal its lines in the ledger; the projects' net cash plus deposits and the other box lines equals the boxes; owed to us equals the items; a project's owed by us is 0 exactly when its `211001` lines net to 0 in every currency.

## Volume and performance
Tens of projects, a few hundred movements a month. Every read is under 300 ms; the PDF of everything under 30 s.

## Migration and compatibility
New tables and one enum; nothing existing changes. The company is made by `admin:create-account` with `--book-currency USD --no-parallel --template contracting`.
