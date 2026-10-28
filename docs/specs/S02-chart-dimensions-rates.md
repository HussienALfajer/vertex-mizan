# S02 — Chart of accounts, dimensions and rates

Status: Approved (owner, 2026-10-27) · Date: 2026-10-27 · Features: `docs/product/phase-1-scope.md` F02, F03, F04 · ADRs: 0003, 0005, 0007, 0008, 0010, 0011

## Summary
Every later posting needs three things this spec delivers: the accounts a line posts to, the analysis tags it carries, and the exchange rates its book and parallel amounts are converted at. S02 gives each company a numbered four-level chart of accounts with IFRS statement lines (applied from a service-agency or general template), dimension types and values fed by Hub or added by hand, and a dated, append-only rate table with the Central Bank bulletin rule decided by the owner. It posts nothing; S03 enforces its rules at posting.

## In scope / out of scope
- In:
  - the chart of accounts: header and postable accounts, codes, Arabic and English names, class, normal balance, statement line, the flags of F02 (currency restriction, control, monetary, required dimensions), blocking and archiving, the lock after first use;
  - the statement-line catalogue (by nature, with IFRS 18 categories);
  - the account roles the posting function and revaluation need (conversion rounding, exchange gains and losses, retained earnings);
  - the service-agency and general templates, applied at company creation or to an empty chart;
  - dimension types and values: the four built-in types (client, contract, department, service), custom types, values from Hub by Hub ID, manual values and linking them to a Hub ID, renaming, archiving;
  - the rate pairs, the append-only rate table (manual entry and correction), the bulletin publication calendar (weekly days off and holidays), the rate-in-force rule per type, and the pure validation of a line against the chart (`packages/ledger`) that S03 calls;
  - the permission keys, internal `/api` endpoints, screens, the chart export, audit.
- Out (later or never):
  - posting, balances, open items and the "entries that used this rate" list's data (S03; the screen arrives with it);
  - Hub's rate and dimension intake through `/v1` (S05 calls this spec's services);
  - mapping accounts to posting rules (S05), revaluation (S07), statements and the chart print layout (S09);
  - rate import from a file or a feed (later; the `import` source stays reserved);
  - merging dimension values or accounts (later);
  - year-end close using the retained-earnings role (phase 2);
  - the bulletin schedule of a third-currency pair (open question Q10).

## Access
New permission keys, appended to `PERMISSIONS` in `packages/contracts/src/access.ts` (S01 role intents: the accountant keeps accounts and rates; everyone reads them; the auditor changes nothing):

| Action | Surface | Who (permission) |
|---|---|---|
| Read the chart, statement lines, account roles, templates | Web | Every role (`accounts.read`) |
| Create, edit, block, unblock, archive, restore accounts; apply a template; set account roles | Web | Owner, accountant (`accounts.manage`) |
| Read dimension types and values | Web | Every role (`dimensions.read`) |
| Create and edit dimension types and values; link a value to a Hub ID; archive and restore | Web | Owner, accountant (`dimensions.manage`) |
| Read rates, pairs and the publication calendar | Web | Every role (`rates.read`) |
| Record and correct rates; add pairs; edit the publication calendar | Web | Owner, accountant (`rates.manage`) |
| Record a Hub rate; create or rename a Hub dimension value | API `/v1` (S05) | API client with `events:write` |
| Export the chart to Excel or PDF | Web | Every role (`accounts.read`); audited (S01 rule 24) |

No action here needs `@Reauthenticated`. Every company write carries `X-Mizan-Company` (S01 rule 22) and is refused on an archived company (`COMPANY_ARCHIVED`).

## Data
All tables are company tables: `company_id`, forced RLS with `company_isolation`, `unique (company_id, id)`, composite company foreign keys, UUIDv7 ids, registered in `registry.ts` (ADR 0003). Business tables are archived, never deleted; the rate table is append-only.

### Accounts

| Table | Kind | Fields (all `not null` unless marked) | Keys and checks |
|---|---|---|---|
| `chart_accounts` | business | `id`, `company_id`, `code` (text), `level` (smallint 1–4), `parent_id` (null at level 1) → accounts, `kind` (`header` · `postable`), `class` (`asset` · `liability` · `equity` · `revenue` · `expense`), `name` (Arabic, 1–200), `name_latin` (null, 1–200), `normal_balance` (`debit` · `credit`), `statement_line` (text, null on headers), `currency` (null; a currency restriction), `is_control` (bool), `is_monetary` (bool), `blocked_at` (null), `blocked_reason` (null), `first_posted_at` (null; set by the posting function, S03), `created_at`, `updated_at`, `archived_at` (null), `archived_reason` (null) | unique `(company_id, code)`; `(company_id, parent_id)` → `(company_id, id)`; checks below. Named apart from Better Auth's `accounts` table (S01) |
| `account_required_dimensions` | business | `id`, `company_id`, `account_id` → chart_accounts, `dimension_type_id` → dimension_types, `created_at`, `updated_at`, `archived_at` (null) | unique `(company_id, account_id, dimension_type_id)` where `archived_at is null` |
| `account_roles` | business | `id`, `company_id`, `role` (enum `account_role`), `account_id` → chart_accounts, `created_at`, `updated_at`, `archived_at` (null) | unique `(company_id, role)` where `archived_at is null` |

`account_role` is the enum `conversion_rounding`, `fx_realised_gain`, `fx_realised_loss`, `fx_unrealised_gain`, `fx_unrealised_loss`, `retained_earnings`; values are never renamed.

`chart_accounts` checks (each a constraint or a `BEFORE` trigger with `ENABLE ALWAYS`, pinned in `GUARDS`):
1. **Code shape** (ADR 0011): level 1 is one digit `1`–`5`; level 2 two digits, level 3 three digits, each starting with the parent's code and adding one digit `1`–`9`; level 4 six digits, the parent's three digits then `001`–`999`. `class` follows the first digit: 1 asset, 2 liability, 3 equity, 4 revenue, 5 expense.
2. Levels 1 and 2 are headers. A postable account is a leaf at level 3 or 4; a header may have no children yet. A child's parent is a header of the level above.
3. `statement_line` is set exactly on postable accounts and is a code of the catalogue whose statement fits the class (balance sheet for 1–3, income statement for 4–5).
4. `is_monetary` and `is_control` only on assets and liabilities; headers carry neither, nor a currency, nor required dimensions.
5. **The lock after first use** (owner, 2026-10-27): once `first_posted_at` is set, a trigger refuses any change to `code`, `parent_id`, `level`, `kind`, `class`, `normal_balance`, `currency`, `is_control`, `is_monetary` and `first_posted_at` itself. The names, the statement line, the required dimensions and blocking stay editable. A header is locked the same way once it has any child.
6. `blocked_reason` set iff `blocked_at` set; `archived_reason` set iff `archived_at` set.
7. `BEFORE DELETE` and `BEFORE TRUNCATE` triggers (`refuse_delete()`) refuse every role.

The **five root accounts** (1 Assets, 2 Liabilities, 3 Equity, 4 Revenue, 5 Expenses) are created with every company, in the company's creation transaction, and can only be renamed.

### The statement-line catalogue
A platform catalogue in code (`packages/contracts/src/chart.ts`, `STATEMENT_LINES`), not a table: reports (S09) present from it, accounts reference its codes, and a new line is an additive change to the catalogue. Each line has a code, the statement, a section, an order, Arabic and English names, and for the income statement its IFRS 18 category (owner, 2026-10-27; ADR 0011).

| Code | Statement · section | IFRS 18 category | Arabic | Basis |
|---|---|---|---|---|
| `bs.cash` | Balance sheet · current assets | — | النقد وما يعادله | IAS 1.54(i) |
| `bs.trade_receivables` | current assets | — | الذمم المدينة التجارية والأخرى | IAS 1.54(h) |
| `bs.contract_assets` | current assets | — | أصول العقود | IFRS 15.105 |
| `bs.other_current_assets` | current assets | — | مصاريف مدفوعة مقدمًا وأصول متداولة أخرى | IAS 1.55 |
| `bs.ppe` | non-current assets | — | الممتلكات والمعدات | IAS 1.54(a) |
| `bs.trade_payables` | current liabilities | — | الذمم الدائنة التجارية والأخرى | IAS 1.54(k) |
| `bs.contract_liabilities` | current liabilities | — | التزامات العقود | IFRS 15.105 |
| `bs.client_money` | current liabilities | — | أمانات العملاء | IAS 1.55 |
| `bs.tax_liabilities` | current liabilities | — | التزامات الضرائب والرسوم الجارية | IAS 1.54(n) |
| `bs.accruals` | current liabilities | — | المصاريف المستحقة | IAS 1.55 |
| `bs.share_capital` | equity | — | رأس المال | IAS 1.54(r) |
| `bs.retained_earnings` | equity | — | الأرباح المحتجزة | IAS 1.54(r) |
| `bs.owner_current` | equity | — | جاري المالك | IAS 1.55 |
| `is.revenue` | Income statement | operating | إيرادات العقود مع العملاء | IFRS 15.113(a) |
| `is.other_income` | | operating | إيرادات تشغيلية أخرى | IFRS 18.47 |
| `is.direct_costs` | | operating | تكاليف المشاريع والخدمات المباشرة | IAS 1.102 (by nature) |
| `is.employee_benefits` | | operating | مصاريف الموظفين | IAS 1.102 |
| `is.depreciation` | | operating | الاستهلاك | IAS 1.102 |
| `is.other_expenses` | | operating | مصاريف تشغيلية أخرى | IAS 1.102 |
| `is.fx_differences` | | operating | صافي فروق الصرف | IAS 21.52(a); IFRS 18.B65 (open question Q11) |
| `is.finance_costs` | | financing | تكاليف التمويل | IAS 1.82(b) |
| `is.income_tax` | | income taxes | مصروف ضريبة الدخل | IAS 1.82(d) |

A debit-balance client ad funds account is presented as a receivable from that client (ADR 0007); that per-counterparty split is S09's, from the open items, and needs no line here.

### Dimensions

| Table | Kind | Fields | Keys and checks |
|---|---|---|---|
| `dimension_types` | business | `id`, `company_id`, `code` (text, `^[a-z][a-z0-9_]{1,39}$`), `builtin` (bool), `parent_type_id` (null) → dimension_types, `name` (Arabic, 1–100), `name_latin` (null), `position` (smallint), `created_at`, `updated_at`, `archived_at` (null) | unique `(company_id, code)`; at most 10 active types per company (`DIMENSION_TYPE_LIMIT`) |
| `dimension_values` | business | `id`, `company_id`, `type_id` → dimension_types, `code` (null, 1–40; the accountant's short code), `name` (1–200), `name_latin` (null), `contract_kind` (null; `project` · `retainer`), `parent_value_id` (null) → dimension_values, `external_source` (null; `hub`), `external_id` (null, 1–100), `created_at`, `updated_at`, `archived_at` (null) | unique `(company_id, type_id, code)` where code not null; unique `(company_id, type_id, external_source, external_id)` where not null; index `(company_id, type_id, name)`; checks below |

- The **built-in types** (`builtin = true`): `client` (العميل), `contract` (العقد) with `parent_type_id` = client, `department` (القسم), `service` (الخدمة) (owner, 2026-10-27: one contract dimension for projects and retainers, IFRS 15.105). Their codes never change; posting rules (S05) and reports (S09) know them. Custom types (a cost centre, say) have `builtin = false` and no parent type.
- `contract_kind` is set exactly on values of the `contract` type; a contract value's `parent_value_id` is a value of its type's parent type (its client), required for Hub values and optional for manual ones. Values of other types have no parent.
- `external_source` and `external_id` are both null or both set. For Hub: clients, contracts and services carry Hub's UUID; departments carry Hub's fixed department code (`design`, `development`, …; Hub ADR 0014). Once set they never change (a trigger).
- No `DELETE`; values and types are archived.

### Rates

| Table | Kind | Fields | Keys and checks |
|---|---|---|---|
| `rate_pairs` | business | `id`, `company_id`, `base` (currency), `quote` (currency), `created_at`, `updated_at`, `archived_at` (null) | unique `(company_id, base, quote)`; unique `(company_id, least(base, quote), greatest(base, quote))`; `base <> quote` |
| `exchange_rates` | append-only | `id`, `company_id`, `effective_on` (date), `base`, `quote` (`(company_id, base, quote)` → rate_pairs), `rate` (`numeric(22,10)` > 0, as quoted), `type` (`market` · `bulletin`), `source` (`hub` · `manual` · `import`), `supersedes_rate_id` (null) → exchange_rates, `reason` (null, 1–500), `recorded_by_user_id` (uuid, null, no FK), `recorded_by_api_client_id` (uuid, null, no FK), `created_at` | index `(company_id, type, base, quote, effective_on, created_at)`; `reason` set iff `supersedes_rate_id` set; exactly one recorder set; SYP pairs dated from 2026-01-01 |
| `bulletin_holidays` | business | `id`, `company_id`, `holiday_on` (date), `note` (1–200), `created_at`, `updated_at`, `archived_at` (null) | unique `(company_id, holiday_on)` where `archived_at is null` |

- `company_settings` (S01) gains `bulletin_days_off` (`smallint[]` of ISO weekdays 1–7, default `{5,6}`: Friday and Saturday, UNVERIFIED as the Central Bank's publication days, so it is a setting the accountant can change). It is not part of the settings lock: it decides which bulletin a future posting needs, never a posted amount.
- `exchange_rates` follows ADR 0005 invariant 10 for append-only tables: the app role has `SELECT, INSERT`; `refuse_change()` refuses update, delete and truncate. A correction is a newer row (ADR 0007).
- **One orientation per pair** (ADR 0011): the first rate of two currencies creates their pair; every later rate of those currencies, of either type, uses the same base and quote (`RATE_ORIENTATION`). Hub's "SYP per USD" is base USD, quote SYP.

## States and rules

### Chart of accounts
1. Every company has the five roots. At creation (the S01 form and the `admin:create-company` command, which gains `--template`), the owner picks the service-agency template, the general template or none. A template is applied later only to a chart that holds the roots alone (`CHART_NOT_EMPTY`), in one transaction with one audit row.
2. A new account takes its parent, code, kind, names, normal balance (default by class: debit for assets and expenses, credit for the others), and for a postable account its statement line, monetary and control flags, currency restriction and required dimensions. Choosing a currency restriction for an asset or liability turns the monetary flag on, which the accountant can turn off (Q12, owner 2026-10-27). A code that breaks the shape is `ACCOUNT_CODE_INVALID`; a used code is `ACCOUNT_CODE_TAKEN`.
3. A child under a postable account is refused (`ACCOUNT_NOT_HEADER`). A header with children cannot become postable; a postable account never used and without children may become a header.
4. Before first use every field may change, the code only together with a valid parent (moving an unused leaf). After first use the lock of check 5 applies (`ACCOUNT_LOCKED`). A changed statement line moves the account in every period's statements, comparatives included (IAS 1.41); the audit log keeps before and after. A changed required-dimension set applies to postings from then on.
5. **Blocking** with a reason stops new postings to the account (S03 refuses manual lines with `ACCOUNT_BLOCKED`; how S05 holds a Hub event mapped to it is S05's, recommendation `NO_MAPPING`). It stays in reports. Unblocking needs no reason.
6. **Archiving** with a reason needs: no unarchived children, not an account role (`ACCOUNT_IN_ROLE`), and a zero balance in every currency in both ledgers with no open item (`ACCOUNT_HAS_BALANCE`). S02 has no balances, so every account passes the balance check until S03 adds it in the PR that adds period balances and open items. An archived account is hidden from pickers and refused on every new line. Restore needs a reason.
7. **Account roles:** each role points to one postable, unblocked, unarchived account: `conversion_rounding` to a revenue or expense account; `fx_*_gain` to revenue; `fx_*_loss` to expense; `retained_earnings` to equity (`ACCOUNT_ROLE_INVALID`). The templates set all six. A posting that needs a role the company has not set is refused (`ACCOUNT_ROLE_MISSING`, raised by S03 and S07).
8. **Line validation** (`packages/ledger`, `checkLineAgainstChart`; S03 calls it for every line): the account exists, is postable, not blocked or archived; the line's transaction currency equals the account's restriction when set (a difference line keeps the item's currency, ADR 0007); every required dimension type has a value; each value is of the right type and not archived (manual lines only, rule 13); a contract value's client equals the line's client value when the line carries both (`DIMENSION_PARENT_MISMATCH`). A line may carry dimensions an account does not require.

### Dimensions
9. The accountant creates custom types; built-in types are created with every company (the general template and "none" create them too, so Hub can feed any company). A type is archived only when no account requires it.
10. **Hub values** are matched by `(type, hub, external_id)` only, never by name. S05 creates a value the first time an event names an unknown Hub ID, and renames it when the event carries a different name; the rename is audited with the API client as actor. Reports show the current name.
11. **Manual values** (owner, 2026-10-27): the accountant adds a value to any type, for example a client from the opening balances. Before Hub first sends that client, the accountant may link the manual value to its Hub ID; from then on Hub's events find it, and the link never changes (`DIMENSION_ALREADY_LINKED`; `DIMENSION_LINK_TAKEN` when another value of the type holds that ID). There is no merge in phase 1: a duplicate made by mistake is archived and its postings moved by a reclassification entry (S03).
12. The accountant renames a value (Hub's next differing name renames it again; the screen says so for Hub values) and gives it a short code.
13. **Archiving** a value hides it from pickers and refuses it on manual lines (`DIMENSION_VALUE_ARCHIVED`). A Hub event naming an archived Hub value is still accepted: Hub is the source of its records; the value stays archived.

### Rates
14. **Recording:** a rate row has its date, pair, rate (up to 12 integer digits and 10 decimals, as quoted), type and source. The accountant records `manual` rows of either type; Hub records `market` rows (S05). A row equal in rate to the one already in force for the same pair, type and date is refused (`RATE_UNCHANGED`), which also stops double submits.
15. **Correction** (owner, 2026-10-27): a new row for a pair, type and date that already has a row is a correction. It needs a reason and points to the row it supersedes. Posted entries never change. The answer lists the entries that used the superseded row, with each entry's number, date and amounts (from S03, whose lines store the rate row they converted at), so the accountant can reverse and repost those they judge wrong (IAS 8.42). Events held for that date retry (S05), and a revaluation of a month end whose rate changed becomes stale (S07).
16. **The rate in force** for a type, pair and date (ADR 0011, amending ADR 0007's lookup for the bulletin):
    - `market`: the newest row effective on or before the date, the last recorded among rows of the same date (unchanged; Hub sends a rate only when it changes).
    - `bulletin` (owner, 2026-10-27): let *P* be the latest **publication day** on or before the date, a publication day being one that is not a weekly day off (`bulletin_days_off`) and not a holiday (`bulletin_holidays`). The newest row effective on or before the date is in force only if it is effective on or after *P*. Otherwise the bulletin is missing for that date (`RATE_MISSING`; Hub events are held, manual postings refused). So a working day needs its own bulletin, and a Friday, Saturday or holiday takes the last published one.
    - A cross rate (ADR 0007) applies the rule to each of its quotes.
17. **The publication calendar:** the accountant sets the weekly days off and adds or removes holidays with a note. A change affects only postings after it; adding a holiday retries the events held `RATE_MISSING` for that date (S05).
18. A rate dated inside a closed period is accepted: it changes no posted entry, and a held event of that date posts in the next open period (S07).

## Accounting treatment
None. S02 posts nothing. It decides, for every later entry:
- which accounts may carry a line and with which dimensions and currency (rule 8);
- which accounts the posting function uses for conversion rounding and for realised and unrealised exchange differences (rule 7). Gains and losses post to separate accounts (owner, 2026-10-27), by the sign of each ledger's difference; the income statement shows them net on `is.fx_differences` (IAS 21.52(a));
- which rate converts a new measurement in each ledger (rule 16; ADR 0007).

The templates' accounts for each Hub event follow `phase-1-scope.md` §6; the mapping itself is S05's.

## Currencies, rates and rounding
- Rates are stored as quoted (`numeric(22,10)`), never inverted; `exchangeRateSchema` and `convert()` in the money module are unchanged.
- `packages/ledger` changes: `rateInForce()` and `policyRate()` take the publication calendar (days off and holidays) and apply rule 16 to `bulletin` rates; `market` is unchanged. Property tests: a `market` lookup is unchanged; a `bulletin` lookup on a publication day returns only a row of that day or later; on a day off it equals the lookup on the last publication day before it, unless a later row exists; adding a holiday never makes a found rate missing.
- No amounts, so no rounding. The currency restriction compares the line's transaction currency only.

## Periods
No periods yet (S07). Rates and holidays inside closed periods are allowed (rule 18). Changing the chart affects no closed period's posted lines; a changed statement line re-presents every period (rule 4). Checklist items S07 adds from this spec: the bulletin of every publication day of the month is recorded; the month-end market and bulletin rates of each pair the company holds balances in are recorded.

## API
Internal web API under `/api` (S01's access guard, `X-Mizan-Company`, request IDs; in `openapi.json`, checked by `pnpm check:openapi`). No `/v1` change: S05 adds Hub's rate and dimension intake on top of the same services. Another company's id answers `NOT_FOUND`.

| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/accounts` | `accounts.read` | `?includeArchived` | the whole tree (`accountSchema[]`, with required dimension types and roles) | `COMPANY_NOT_SELECTED`, `COMPANY_SWITCHED` |
| `POST /api/accounts` | `accounts.manage` | `createAccountSchema` | `accountSchema` | `ACCOUNT_CODE_INVALID`, `ACCOUNT_CODE_TAKEN`, `ACCOUNT_NOT_HEADER`, `STATEMENT_LINE_INVALID`, `NOT_FOUND`, `COMPANY_ARCHIVED`, `COMPANY_SWITCHED`, `VALIDATION_FAILED` |
| `PATCH /api/accounts/:id` | `accounts.manage` | `updateAccountSchema` | `accountSchema` | the above, `ACCOUNT_LOCKED`, `ACCOUNT_HAS_CHILDREN` |
| `POST /api/accounts/:id/block` · `…/unblock` | `accounts.manage` | `{ reason }` · — | `accountSchema` | `NOT_FOUND`, `ACCOUNT_NOT_POSTABLE`, `ACCOUNT_IN_ROLE`, `COMPANY_SWITCHED` |
| `POST /api/accounts/:id/archive` · `…/restore` | `accounts.manage` | `{ reason }` | `accountSchema` | `NOT_FOUND`, `ACCOUNT_HAS_CHILDREN`, `ACCOUNT_IN_ROLE`, `ACCOUNT_HAS_BALANCE`, `COMPANY_SWITCHED` |
| `GET /api/chart/templates` | `accounts.read` | — | the templates (id, version, names, account count) | `COMPANY_NOT_SELECTED` |
| `POST /api/chart/apply-template` | `accounts.manage` | `{ templateId }` | the tree | `CHART_NOT_EMPTY`, `NOT_FOUND`, `COMPANY_SWITCHED` |
| `GET /api/chart/statement-lines` | `accounts.read` | — | `STATEMENT_LINES` | — |
| `GET /api/chart/export` | `accounts.read` | `?format=xlsx` (`pdf` joins with the worker's PDF rendering, ADR 0002; owner, 2026-10-27) | the file | `COMPANY_NOT_SELECTED` |
| `GET /api/account-roles` · `PUT /api/account-roles` | `accounts.read` · `accounts.manage` | — · `{ role, accountId }` | the six roles | `ACCOUNT_ROLE_INVALID`, `NOT_FOUND`, `COMPANY_SWITCHED` |
| `GET /api/dimension-types` · `POST` · `PATCH /:id` · `POST /:id/archive` · `…/restore` | `dimensions.read` · `dimensions.manage` | `createDimensionTypeSchema`, `updateDimensionTypeSchema` | `dimensionTypeSchema` | `DIMENSION_TYPE_LIMIT`, `DIMENSION_TYPE_IN_USE`, `DIMENSION_CODE_TAKEN`, `NOT_FOUND`, `COMPANY_SWITCHED`, `VALIDATION_FAILED` |
| `GET /api/dimension-values` | `dimensions.read` | `?typeId&q&includeArchived&cursor` (search by code or name) | a cursor page of `dimensionValueSchema` | `NOT_FOUND` |
| `POST /api/dimension-values` · `PATCH /:id` | `dimensions.manage` | `createDimensionValueSchema` · `updateDimensionValueSchema` (names, code, parent) | `dimensionValueSchema` | `DIMENSION_CODE_TAKEN`, `DIMENSION_PARENT_MISMATCH`, `NOT_FOUND`, `COMPANY_SWITCHED`, `VALIDATION_FAILED` |
| `POST /api/dimension-values/:id/link` | `dimensions.manage` | `{ externalId }` | `dimensionValueSchema` | `DIMENSION_ALREADY_LINKED`, `DIMENSION_LINK_TAKEN`, `NOT_FOUND`, `COMPANY_SWITCHED` |
| `POST /api/dimension-values/:id/archive` · `…/restore` | `dimensions.manage` | — | `dimensionValueSchema` | `NOT_FOUND`, `COMPANY_SWITCHED` |
| `GET /api/rates` | `rates.read` | `?base&quote&type&from&to&cursor` | rows with recorder, source, superseded mark | `NOT_FOUND` |
| `GET /api/rates/in-force` | `rates.read` | `?type&from&to&on` | the row or cross in force, or `RATE_MISSING` with *P* | `RATE_MISSING` |
| `POST /api/rates` | `rates.manage` | `recordRateSchema` (`exchangeRateSchema` with `source: manual`, and `reason` for a correction) | the row; for a correction, the superseded row and the entries that used it | `RATE_ORIENTATION`, `RATE_UNCHANGED`, `RATE_REASON_REQUIRED`, `SYP_BEFORE_REDENOMINATION`, `INVALID_RATE`, `COMPANY_SWITCHED`, `VALIDATION_FAILED` |
| `GET /api/rate-pairs` · `POST` | `rates.read` · `rates.manage` | `{ base, quote }` | pairs | `RATE_ORIENTATION` |
| `GET /api/rate-calendar` · `PUT` | `rates.read` · `rates.manage` | `{ daysOff }` | days off and holidays | `VALIDATION_FAILED` |
| `POST /api/rate-calendar/holidays` · `POST /…/:id/remove` | `rates.manage` | `{ on, note }` | the holiday | `HOLIDAY_EXISTS`, `NOT_FOUND` |

New error codes, appended to `errorStatus` in this order, each with its Arabic text:

| Code | Status | Meaning |
|---|---|---|
| `ACCOUNT_CODE_INVALID` | 422 | The code breaks the 1-2-3-6 shape or does not start with the parent's code |
| `ACCOUNT_CODE_TAKEN` | 409 | Another account has the code |
| `ACCOUNT_NOT_HEADER` | 422 | The parent is a postable account |
| `ACCOUNT_NOT_POSTABLE` | 422 | A header account on a line or blocked |
| `ACCOUNT_LOCKED` | 409 | A locked field of a used account |
| `ACCOUNT_HAS_CHILDREN` | 409 | Archiving, or making postable, a header with children |
| `ACCOUNT_HAS_BALANCE` | 409 | Archiving an account with a balance or open items |
| `ACCOUNT_IN_ROLE` | 409 | Blocking or archiving an account that holds a role |
| `ACCOUNT_ROLE_INVALID` | 422 | The account does not fit the role |
| `ACCOUNT_ROLE_MISSING` | 422 | A posting needs a role the company has not set |
| `ACCOUNT_BLOCKED` | 422 | A line on a blocked account |
| `ACCOUNT_ARCHIVED` | 422 | A line on an archived account |
| `ACCOUNT_CURRENCY_MISMATCH` | 422 | The line's currency differs from the account's restriction |
| `STATEMENT_LINE_INVALID` | 422 | Unknown line, or one that does not fit the class |
| `CHART_NOT_EMPTY` | 409 | A template applied to a chart with accounts |
| `DIMENSION_REQUIRED` | 422 | A required dimension is missing on a line |
| `DIMENSION_VALUE_ARCHIVED` | 422 | An archived value on a manual line |
| `DIMENSION_PARENT_MISMATCH` | 422 | The contract belongs to another client |
| `DIMENSION_TYPE_LIMIT` | 409 | More than 10 active types |
| `DIMENSION_TYPE_IN_USE` | 409 | Archiving a type an account requires, or a built-in type |
| `DIMENSION_CODE_TAKEN` | 409 | The type or value code is used |
| `DIMENSION_ALREADY_LINKED` | 409 | The value already has a Hub ID |
| `DIMENSION_LINK_TAKEN` | 409 | Another value holds the Hub ID |
| `RATE_ORIENTATION` | 422 | The pair is held the other way round |
| `RATE_UNCHANGED` | 409 | The same rate is already in force for that date |
| `RATE_REASON_REQUIRED` | 422 | A correction without a reason |
| `HOLIDAY_EXISTS` | 409 | The date is already a holiday |

## Jobs and events
No worker jobs. No events received or emitted in S02; S05 adds Hub's rate event and the dimension facts of every event, calling the rate and dimension services with the API client as actor.

## Screens
Arabic RTL, design-system components only (ADR 0010), responsive from 360 px, texts in `ar.chart`, `ar.dimensions`, `ar.rates`. New general components in `packages/ui`, built and tested first (ADR 0010 §7): the **account tree** (the data grid with expandable rows, codes as LTR isolates through `AccountLabel`), the **account picker** and the **dimension picker** (search by code or name, keyboard-complete; headers, blocked and archived accounts not selectable; required dimensions shown).

| Route | Purpose and content | Actions | States | Who |
|---|---|---|---|---|
| `/chart` | The tree: code, name, class, statement line, flags (control, monetary, currency), required dimensions, blocked and archived marks; filters by class, flag and text | Add a child; edit in a side sheet; block, unblock, archive, restore with a reason; apply a template to an empty chart; export Excel or PDF | Empty chart: the template choice; a lock notice on used accounts with the fields it keeps | Owner, accountant edit; others read |
| `/chart/roles` | The six account roles and their accounts | Change through the account picker | Missing role warned | Owner, accountant edit; others read |
| `/dimensions` | Tabs per type; values in the grid: code, name, Latin name, kind and client (contracts), Hub link, archived | Add a type or value; rename; link to a Hub ID; archive, restore | Empty type; Hub value notice "Hub renames it" | Owner, accountant edit; others read |
| `/rates` | Per pair and type: dated rows with source, recorder, superseded marks; the bulletin status of the last 30 days (recorded, day off, holiday, missing) | Record today's bulletin (the date defaults to today); record a market rate; correct with a reason; add a pair | Missing bulletins highlighted with text, not color alone; after a correction, the entries that used the old rate (from S03) | Owner, accountant edit; others read |
| `/rates/calendar` | Weekly days off; holidays with notes | Change days off; add or remove a holiday | — | Owner, accountant edit; others read |

The drill-down to entries starts with S03 (an account's statement, the entries of a rate). The command palette gains "new account", "record bulletin rate" and the three routes.

## Reports
None. The chart export lists every account with its fields; it agrees with `GET /api/accounts`.

## Printing and legal books
The chart of accounts prints in Arabic (code, Arabic name, class, statement line), A4, with the company header and page *n* of *m*; the S09 print layout is reused when it exists, until then the export's PDF. No legal book.

## Volume and performance
Per company: 100–2,000 accounts; up to 50,000 dimension values (clients and contracts over ten years); about two rate rows a day per pair. The tree loads whole (≤ 300 ms for 2,000 accounts); value search uses `(company_id, type_id, name)` and a trigram index on name and code (≤ 200 ms); the rate in force reads the composite index (one row per lookup, ≤ 5 ms), cached per request by S03's posting.

## Migration and compatibility
- New `packages/db` schema modules `chart`, `dimensions`, `rates`, with registry entries, RLS, grants, the account lock and code-shape triggers and `refuse_delete()` in `GUARDS`; `company_settings` gains `bulletin_days_off` (additive, with its default).
- Existing companies (test data only) get the five roots and the built-in dimension types in the migration.
- `packages/contracts` gains `chart.ts` (statement lines, templates, account schemas), `dimensions.ts`, `rates.ts` (record, pair and calendar schemas), the permission keys and the error codes, appended.
- `packages/ledger`: `rateInForce()` and `policyRate()` take the calendar (rule 16); existing callers and tests pass an empty calendar for `market` only. `checkLineAgainstChart()` is new.
- S01's company creation (web form and command) gains the template choice. `/v1` is untouched; `openapi.json` gains the `/api` routes (additive).
- **S03 must** store on each converted line the rate row (or both rows of a cross) it used, and set `chart_accounts.first_posted_at` at an account's first posted line, in the posting transaction.

## Arabic strings and number formats
- New namespaces: `ar.chart`, `ar.dimensions`, `ar.rates`, with the account classes, normal balances, statement lines, role names, dimension types and the new error codes in `ar.errors`.
- Terms (glossary): دليل الحسابات، حساب رئيسي، حساب فرعي، رمز الحساب، طبيعة الحساب، فئة الحساب، بند القائمة، حساب مراقبة، حساب نقدي، حساب موقوف، دور الحساب، قالب دليل الحسابات، نوع البعد، قيمة البعد، العقد، الربط بـ Hub، زوج العملات، سعر النشرة، تصحيح السعر، تقويم النشرة، يوم عدم نشر.
- Codes and rates in Latin digits as LTR isolates; rates shown with every quoted decimal; currency codes with their Arabic names from the money module.

## Audit
One `audit_entries` row per change, in the same transaction, with before and after of the changed fields (S01 rule 23): `account.created`, `account.updated`, `account.blocked`, `account.unblocked`, `account.archived`, `account.restored`, `chart.template_applied` (template id and version), `account_role.set`, `dimension_type.created`, `dimension_type.updated`, `dimension_type.archived`, `dimension_type.restored`, `dimension_value.created`, `dimension_value.updated` (the actor is the API client for Hub renames), `dimension_value.linked`, `dimension_value.archived`, `dimension_value.restored`, `rate_pair.created`, `rate.recorded`, `rate.corrected` (the reason and the superseded row), `rate_calendar.updated`, `bulletin_holiday.added`, `bulletin_holiday.removed`, and `export.chart` for each export.

## Abuse and failure cases
- **Cross-company access:** RLS on every table, composite foreign keys (an account's parent, a value's parent, a rate's pair), every endpoint tested as another company's member; the isolation property test covers the new tables.
- **A wrong rate recorded:** never silently replaced; the correction with its reason and the list of entries that used the old rate (rule 15); the rate screen shows who recorded each row.
- **A forgotten bulletin:** rule 16 refuses to reuse yesterday's rate on a working day; the rate screen and (S07) the checklist show the missing days.
- **Silent reclassification:** the lock after first use; statement-line changes audited with before and after.
- **Duplicated clients by name:** Hub values match by ID only (rule 10); manual values are linked explicitly (rule 11).
- **Double submits:** unique codes (`ACCOUNT_CODE_TAKEN`, `DIMENSION_CODE_TAKEN`), `RATE_UNCHANGED`, `HOLIDAY_EXISTS`, `CHART_NOT_EMPTY`.
- **A race between archiving and a posting** (S03): archiving locks the company ledger head first (ADR 0008 lock order) before checking the balance, so no posting interleaves.
- **Hub down:** nothing here depends on Hub; manual market rates keep manual postings going.

## Edge cases
1. Two accountants create the same code at once: one gets `ACCOUNT_CODE_TAKEN`.
2. A Hub event and a manual link claim the same Hub ID at once: the unique key decides; the loser gets `DIMENSION_LINK_TAKEN` (manual) or finds the linked value (Hub).
3. A rate of zero or negative, or with 11 decimals: refused by `rateValueSchema`.
4. Currency shapes: `syp` needs only the bulletin pairs of the currencies it deals in; `syp-usd` (Vertex Media) needs USD/SYP bulletin daily and USD/SYP market; `usd-syp` uses the bulletin for its USD book in the same way; `third` needs TRY or EUR rates of each type, the bulletin schedule of such a pair being open (Q10).
5. The bulletin is recorded at noon while Hub events of that morning were held: they retry (S05) and post at that day's rate.
6. A holiday added after manual postings that day were refused: those postings are simply retried by the accountant; nothing posted changes.
7. A correction for a date in a closed period: recorded; entries in that period stay; the accountant decides under IAS 8.
8. A day off changed from Friday–Saturday to Friday only: Saturdays from then on need their own bulletin.
9. A client renamed in Hub twice in one day: the last event's name wins; both renames are audited.
10. A contract whose client changes in Hub: not possible in Hub (a project or retainer keeps its client); a different client on an event is `DIMENSION_PARENT_MISMATCH` and S05 holds it (`NEEDS_DECISION`).
11. An account restricted to USD receives an SYP-paid deposit: the client-funds line stays in USD and the SYP side posts to the cash account (ADR 0007); a difference line keeps USD with a zero transaction amount.
12. The general template on a company that later deals with Hub: the built-in types exist, so Hub values arrive; the posting-rule mapping (S05) names the accounts.
13. A leap day or a holiday on 29 February: the calendar works on dates only.

## Scenarios
Accounting rules this spec introduces, each written and approved through `/posting-rule` before its code:
- `docs/scenarios/currency/bulletin-rate-of-the-day.md`: which bulletin converts an entry on a working day, a Friday, a holiday and a working day without a bulletin (`RATE_MISSING`), in the `syp-usd` and `usd-syp` shapes, with a cross in `third`.
- `docs/scenarios/currency/rate-correction-after-use.md`: a bulletin corrected after an entry used it: the posted entry is unchanged, a later entry uses the corrected rate, the reversal and repost the accountant chooses.

## Open questions
- **Q3 (stays open, owner 2026-10-27):** the two templates below are drafts. One or two Syrian accountants review them before Vertex Media's production company is created; the code ships with them, and their changes are a new template version.
- **Q10 (`docs/open-questions.md`):** the bulletin schedule of a third-currency pair (TRY or EUR), which may be published weekly. Recommendation: each bulletin pair carries its schedule (daily, or weekly on a weekday), decided when a company first deals in a third currency; no phase 1 company does.
- **Q11 (`docs/open-questions.md`, for S09):** IFRS 18.B65 classifies exchange differences in the category of the item that caused them, so differences on cash fall in investing for a company without a specified main business activity. Recommendation: S09 splits `is.fx_differences` by the monetary item's category when IFRS 18 statements are first produced (periods from 2027-01-01).
- **For S05:** how a Hub event whose mapped account is blocked is held. Recommendation: `NO_MAPPING`.

## Templates (drafts, Q3)

Columns: code · Arabic · English · kind (H header, P postable) · normal balance (D, C) · flags (M monetary, Ctl control, a currency) · required dimensions · statement line · role. Headers carry no flags.

### Service agency (`service-agency@1`, Vertex Media)
Dimension types: client, contract, department, service (all built in).

| Code | Arabic | English | Kind | Bal | Flags | Required | Line | Role |
|---|---|---|---|---|---|---|---|---|
| 1 | الأصول | Assets | H | D | | | | |
| 11 | الأصول المتداولة | Current assets | H | D | | | | |
| 111 | النقد وما يعادله | Cash and cash equivalents | H | D | | | | |
| 111001 | الصندوق — ليرة سورية | Cash on hand — SYP | P | D | M, SYP | | `bs.cash` | |
| 111002 | الصندوق — دولار أمريكي | Cash on hand — USD | P | D | M, USD | | `bs.cash` | |
| 111003 | الحساب المصرفي — ليرة سورية | Bank account — SYP | P | D | M, SYP | | `bs.cash` | |
| 111004 | الحساب المصرفي — دولار أمريكي | Bank account — USD | P | D | M, USD | | `bs.cash` | |
| 111005 | المحفظة الإلكترونية — ليرة سورية | E-wallet — SYP | P | D | M, SYP | | `bs.cash` | |
| 111006 | المحفظة الإلكترونية — دولار أمريكي | E-wallet — USD | P | D | M, USD | | `bs.cash` | |
| 112 | الذمم المدينة | Receivables | H | D | | | | |
| 112001 | ذمم العملاء التجارية | Trade receivables | P | D | M, Ctl | client | `bs.trade_receivables` | |
| 112002 | ذمم مدينة أخرى | Other receivables | P | D | M | | `bs.trade_receivables` | |
| 113 | أصول العقود | Contract assets | H | D | | | | |
| 113001 | أصول العقود | Contract assets | P | D | M, Ctl | client, contract | `bs.contract_assets` | |
| 114 | أصول متداولة أخرى | Other current assets | H | D | | | | |
| 114001 | مصاريف مدفوعة مقدمًا | Prepaid expenses | P | D | | | `bs.other_current_assets` | |
| 12 | الأصول غير المتداولة | Non-current assets | H | D | | | | |
| 121 | الممتلكات والمعدات | Property and equipment | H | D | | | | |
| 121001 | أجهزة الحاسوب ومعدات التصوير | Computers and camera equipment | P | D | | | `bs.ppe` | |
| 121002 | الأثاث والمفروشات | Furniture and fittings | P | D | | | `bs.ppe` | |
| 121003 | مجمع استهلاك أجهزة الحاسوب ومعدات التصوير | Accumulated depreciation — computers and equipment | P | C | | | `bs.ppe` | |
| 121004 | مجمع استهلاك الأثاث والمفروشات | Accumulated depreciation — furniture | P | C | | | `bs.ppe` | |
| 2 | الخصوم | Liabilities | H | C | | | | |
| 21 | الخصوم المتداولة | Current liabilities | H | C | | | | |
| 211 | الذمم الدائنة | Payables | H | C | | | | |
| 211001 | ذمم منصات الإعلان | Ad platforms payable | P | C | M | client | `bs.trade_payables` | |
| 211002 | مصاريف مشاريع بانتظار مصدر الدفع | Project expenses awaiting payment source | P | C | M | | `bs.trade_payables` | |
| 211003 | ذمم دائنة أخرى | Other payables | P | C | M | | `bs.trade_payables` | |
| 212 | التزامات العقود | Contract liabilities | H | C | | | | |
| 212001 | التزامات العقود (إيرادات مؤجلة) | Contract liabilities (deferred revenue) | P | C | | client, contract | `bs.contract_liabilities` | |
| 213 | أمانات العملاء | Client money held | H | C | | | | |
| 213001 | أمانات إعلانات العملاء | Client ad funds held | P | C | M, Ctl, USD | client | `bs.client_money` | |
| 214 | الضرائب والرسوم المستحقة | Taxes and fees payable | H | C | | | | |
| 214001 | ضريبة الدخل المستحقة | Income tax payable | P | C | M | | `bs.tax_liabilities` | |
| 214002 | رسم الإنفاق الاستهلاكي المستحق | Consumption expenditure fee payable (UNVERIFIED) | P | C | M | | `bs.tax_liabilities` | |
| 214003 | رسم الطابع المستحق | Stamp duty payable (UNVERIFIED) | P | C | M | | `bs.tax_liabilities` | |
| 214004 | ضريبة الرواتب والأجور المقتطعة | Payroll tax withheld (UNVERIFIED) | P | C | M | | `bs.tax_liabilities` | |
| 215 | المصاريف المستحقة | Accrued expenses | H | C | | | | |
| 215001 | رواتب وأجور مستحقة | Accrued salaries and wages | P | C | M | | `bs.accruals` | |
| 215002 | مصاريف مستحقة أخرى | Other accrued expenses | P | C | M | | `bs.accruals` | |
| 3 | حقوق الملكية | Equity | H | C | | | | |
| 31 | رأس المال والاحتياطيات | Capital and reserves | H | C | | | | |
| 311 | رأس المال | Capital | H | C | | | | |
| 311001 | رأس المال | Capital | P | C | | | `bs.share_capital` | |
| 312 | الأرباح المحتجزة | Retained earnings | H | C | | | | |
| 312001 | الأرباح المحتجزة | Retained earnings | P | C | | | `bs.retained_earnings` | `retained_earnings` |
| 313 | جاري المالك | Owner's current account | H | C | | | | |
| 313001 | جاري المالك | Owner's current account | P | C | | | `bs.owner_current` | |
| 4 | الإيرادات | Revenue | H | C | | | | |
| 41 | إيرادات النشاط | Operating revenue | H | C | | | | |
| 411 | إيرادات الخدمات | Service revenue | H | C | | | | |
| 411001 | إيرادات الخدمات | Service revenue | P | C | | client, service | `is.revenue` | |
| 411002 | إيرادات رسوم إنهاء العقود | Contract termination fees | P | C | | client | `is.revenue` | |
| 42 | إيرادات أخرى | Other income | H | C | | | | |
| 421 | أرباح فروق الصرف | Exchange gains | H | C | | | | |
| 421001 | أرباح فروق صرف محققة | Realised exchange gains | P | C | | | `is.fx_differences` | `fx_realised_gain` |
| 421002 | أرباح فروق صرف غير محققة | Unrealised exchange gains | P | C | | | `is.fx_differences` | `fx_unrealised_gain` |
| 422 | إيرادات متنوعة | Sundry income | H | C | | | | |
| 422001 | إيرادات أخرى | Other income | P | C | | | `is.other_income` | |
| 5 | المصاريف | Expenses | H | D | | | | |
| 51 | التكاليف المباشرة | Direct costs | H | D | | | | |
| 511 | تكاليف المشاريع | Project costs | H | D | | | | |
| 511001 | تكاليف المشاريع المباشرة | Direct project costs | P | D | | client, contract, department | `is.direct_costs` | |
| 52 | مصاريف الموظفين | Employee costs | H | D | | | | |
| 521 | الرواتب والأجور | Salaries and wages | H | D | | | | |
| 521001 | رواتب وأجور | Salaries and wages | P | D | | department | `is.employee_benefits` | |
| 521002 | مزايا الموظفين الأخرى | Other employee benefits | P | D | | department | `is.employee_benefits` | |
| 53 | المصاريف التشغيلية | Operating expenses | H | D | | | | |
| 531 | مصاريف المكتب | Office expenses | H | D | | | | |
| 531001 | الإيجار | Rent | P | D | | | `is.other_expenses` | |
| 531002 | الكهرباء والمياه والمحروقات | Utilities and fuel | P | D | | | `is.other_expenses` | |
| 531003 | الاتصالات والإنترنت | Telecom and internet | P | D | | | `is.other_expenses` | |
| 531004 | اشتراكات البرمجيات | Software subscriptions | P | D | | | `is.other_expenses` | |
| 531005 | القرطاسية والمستلزمات | Stationery and supplies | P | D | | | `is.other_expenses` | |
| 531006 | الصيانة والإصلاح | Repairs and maintenance | P | D | | | `is.other_expenses` | |
| 532 | المصاريف الإدارية | Administrative expenses | H | D | | | | |
| 532001 | الأتعاب المهنية | Professional fees | P | D | | | `is.other_expenses` | |
| 532002 | الرسوم المصرفية وعمولات التحويل | Bank and transfer charges | P | D | | | `is.other_expenses` | |
| 532003 | الرسوم والطوابع الحكومية | Government fees and stamps | P | D | | | `is.other_expenses` | |
| 532004 | تسويق الوكالة | Agency marketing | P | D | | | `is.other_expenses` | |
| 533 | الاستهلاك | Depreciation | H | D | | | | |
| 533001 | استهلاك أجهزة الحاسوب ومعدات التصوير | Depreciation — computers and equipment | P | D | | | `is.depreciation` | |
| 533002 | استهلاك الأثاث والمفروشات | Depreciation — furniture | P | D | | | `is.depreciation` | |
| 54 | مصاريف أخرى | Other expenses | H | D | | | | |
| 541 | خسائر فروق الصرف والتقريب | Exchange losses and rounding | H | D | | | | |
| 541001 | خسائر فروق صرف محققة | Realised exchange losses | P | D | | | `is.fx_differences` | `fx_realised_loss` |
| 541002 | خسائر فروق صرف غير محققة | Unrealised exchange losses | P | D | | | `is.fx_differences` | `fx_unrealised_loss` |
| 541003 | فروق تقريب التحويل | Conversion rounding differences | P | D | | | `is.fx_differences` | `conversion_rounding` |
| 55 | ضريبة الدخل | Income tax | H | D | | | | |
| 551 | مصروف ضريبة الدخل | Income tax expense | H | D | | | | |
| 551001 | مصروف ضريبة الدخل | Income tax expense | P | D | | | `is.income_tax` | |

The cash, bank and e-wallet accounts are one per Hub payment method and currency (scope Q6); the real bank and wallet accounts are open question Q4, settled by the opening-balances spec.

### General (`general@1`)
Dimension types: the four built-in types; no account requires contract, department or service. The service-agency chart with these differences:
- removed: 111005, 111006 (e-wallets), 113 and 113001 (contract assets), 211001, 211002, 213 and 213001, 411002, 511 and 511001;
- 121001 is "أجهزة ومعدات" (Equipment), 121003 "مجمع استهلاك الأجهزة والمعدات", 533001 "استهلاك الأجهزة والمعدات";
- added: 211001 "ذمم الموردين" (Trade payables, P, C, M, `bs.trade_payables`); 212001 is "التزامات العقود (دفعات مقدمة من العملاء)" requiring client only; 411001 "إيرادات المبيعات والخدمات" (Revenue from sales and services) requiring client only; 511 "تكلفة المبيعات والخدمات" with 511001 "تكلفة المبيعات والخدمات" (Cost of sales and services, `is.direct_costs`), no required dimensions; 521001 and 521002 require nothing.

## Acceptance
- **The owner's end-to-end check, step by step:**
  1. Create a test company "شركة تجريبية" with the service-agency template: the tree shows the accounts above, `/chart/roles` shows all six roles set.
  2. Add 111007 "الحساب المصرفي — يورو" under 111 with currency EUR: accepted; add 1110071: `ACCOUNT_CODE_INVALID`.
  3. Block 111007, archive it with a reason: it disappears from the account picker; restore it.
  4. In `/dimensions`, add a manual client "عميل تجريبي", link it to a synthetic Hub ID, try linking it again: `DIMENSION_ALREADY_LINKED`. Add a contract of kind project under that client.
  5. In `/rates/calendar`, keep Friday and Saturday off and add a holiday on a Thursday.
  6. In `/rates`, record USD/SYP bulletin 120.0000 on Wednesday 2026-11-04 and market 125.5000 the same day. Ask the rate in force: Thursday (holiday) and Friday answer Wednesday's bulletin; the following Sunday answers `RATE_MISSING`; the market rate on Sunday answers 125.5000.
  7. Record SYP/USD (inverted): `RATE_ORIENTATION`. Record 121.0000 for Wednesday again: asked for a reason; with one, the row supersedes the first and the audit log shows both.
  8. Export the chart to Excel; the audit log shows `export.chart` (PDF joins with the worker's rendering, owner 2026-10-27).
- **Tests:**
  - API: for every endpoint, success, `401`, `403` (a viewer writing), another company's member (`NOT_FOUND`, nothing changed), `COMPANY_SWITCHED`, `COMPANY_ARCHIVED` on writes, and each documented error code;
  - unit and property tests: the code shape and class for every level; the lock after use for every locked field (database tests as `mizan_app`); `checkLineAgainstChart` for every rule 8 refusal; rule 16 properties (Currencies section) and the market lookup unchanged; template data: every postable account has a statement line fitting its class, roles fit rule 7, codes fit the shape, Arabic and English names present;
  - invariant tests for the new tables: forced RLS, composite keys, append-only `exchange_rates`, `refuse_delete()` on business tables, the triggers `ENABLE ALWAYS`, the isolation property test;
  - the scenario book: the two scenarios above once S03 provides the posting executor (they are `Proposed` until then);
  - E2E with RTL screenshots, light and dark, at 360, 768 and 1280 px: the chart tree, the account sheet, dimensions, rates and the calendar.
