# packages/i18n

The Arabic text of every front end (ADR 0009): plain catalogs and locale constants, no i18n library and no I/O. The web app reads `ar` directly, with typed keys; only the emails' text has placeholders, filled by `apps/worker`. Copied from Vertex Food's `packages/i18n` and adapted.

## Layout
- `src/ar/<namespace>.ts`, collected in `src/ar/index.ts` (`ar`, `Catalog`):
  - `common`: shared text (product name, theme and density labels);
  - `accounting`: the accounting components' text (debit, credit, ledgers, period states, account kinds, each currency's name, SYP's printed name) and `amountInput`, the reason for every `AmountTextError` of the money module;
  - `grid`: the data grid's summary bar labels and the text of each refusal of the grid core (`packages/ui/src/grid/grid.test.tsx` checks every refusal has one);
  - `commandPalette`: the command palette's own labels (its commands' names come with their specs);
  - `shortcuts`: the name of every action of `packages/ui`'s keymap;
  - `errors`: the text of each error code of `packages/contracts`;
  - `designSystem`: the design-system page's headings and synthetic examples;
  - `shell`: the web app's shell (navigation, skip link, system status, home, not-found page);
  - `roles`: the name of each membership role (S01);
  - `auth`: signing in, two-factor, passwords, invitations, enrolment, re-authentication and the account security page, with the name of each platform audit action a person sees there (S01);
  - `company`: the companies list, a new company, the company settings, the switcher and the archived banner (S01);
  - `members`: members and invitations of the active company (S01);
  - `permissions`: what each permission of the permission map allows (S01);
  - `audit`: the company audit log screen, with the name of each company audit action, audited entity and field (S01);
  - `chart`: the chart of accounts (S02): account classes, kinds, normal balances, roles, templates and the chart export's columns;
  - `dimensions`: dimension types and values, the Hub link and contract kinds (S02);
  - `rates`: rate pairs, types and sources, the rate table and corrections, the rate in force, the bulletin status and calendar, the weekdays (S02);
  - `entries`: the journal, an entry's page, its reversal and files, an account's lines and a rate row's entries, with each entry source and line kind (S03), and `hubDocument`, the Hub document an entry, a line or an item came from, kept readable (ADR 0021);
  - `drafts`: the keyboard entry screen, dealt rates, the preview, the drafts list, approval and rejection, with each draft state (S03);
  - `integrity`: the integrity check, its report, the stored anchors and a pasted one, with each anchor result (S03);
  - `export` (the file `export.ts`, `exportData`, since `export` is a keyword): the company's full export, with each export state (S03);
  - `openItems`: the item kinds, states, movements, sources and ageing buckets, the receivables labels, and the columns of the ageing and client statement exports (S04); the client funds' screen left with Hub (ADR 0021);
  - `periods`: periods and the close (S07): each state, the list, a month's page, the checklist's items, results, counts and links, the close and reopen dialogs;
  - `revaluation`: the month-end revaluation (S07): the ledgers, the preview's states, closing rates, balances and totals, the posted revaluations, the postings, a revaluation entry's links;
  - S08 PR 1: the checklist item `reconciliation_clean` in `periods`, `reconciliation.read` in `permissions`, `RECONCILIATION_START_LOCKED` in `errors`, and the daily email's sections in `email.heldDigest` (each only when it has content); PR 2's `reconciliation`, the screens' namespace, left with the screens (ADR 0021);
  - S09 PR 1: `reports.read` in `permissions`, `DIMENSION_FROM_HUB` in `errors`, `service_department.set`, the entity `service_department` and its fields in `audit`; PR 2: `REPORT_TOO_LARGE`, the exports' audit actions, `report_file.downloaded`, `journal_book.printed`, the entities `report_export`, `report_file`, `journal_book_print` and their fields; PR 3: the screens' text in `reports` (the sidebar and palette, the index, the filters, the states, the marks' links, `exportMenu`, the drill-down, the lines, the ledgers, the journal book's print and its register, the profitability screen; the contracts screens left with Hub, ADR 0021) and `dimensions.departments` (a service's department history);
  - S10 PR 1: the opening's permissions, error codes, audit actions and entities (`opening_snapshot`, `opening`), the scope `opening:write`, the role `pre_opening_result`, the line kind `stated`, the movement `before_opening` and the hold detail `before_books_start`; the screens' `opening` namespace arrives with PR 5; PR 2: the digest's `email.heldDigest.opening`;
  - S10 PR 5: `opening`, the screens' namespace (the page, its steps and states, the records' grid, the agreement's columns (read by the API's workbook until the API drops them), the checks and what fails them, the preview's groups, the dialogs, the export's sheets, the opening entry's mark and `booksStart` for `/settings/company`), `designSystem.opening`, and in `audit` the action `export.opening`, the entity `opening_export` and the field `part`;
  - S10 PR 3: `reports.marks` gains `opening_entry`, `before_books_start` (`{date}`, the header's `booksStart`) and `pre_opening_result_in_equity`, and `reports.statements.yearResultPreOpening`;
  - `email`: the emails the worker sends (S01), with `{name}` placeholders the worker fills from the email's data.
- `src/locale.ts`: `defaultLanguage` (`ar`), `textDirection` (`rtl`), `formatLocale` (`ar-SY-u-nu-latn`: Syrian month names, Latin digits; pinned by `locale.test.ts`) for dates and counts, `displayTimeZone` (`Asia/Damascus`).
- `src/catalog.test.ts`: no empty text, no Arabic-Indic digit, a text for every error code and every amount-input reason.

## Rules
- Every text the user sees lives here; components never hold literal text.
- Terms come from `docs/glossary.md`, one term per concept.
- Digits are Latin, in text and through `formatLocale`; never format with a bare `ar` locale. Amounts are never formatted with `Intl`: the money module formats them (`formatMinor`).
- Never put real names, companies, accounts, amounts or numbers in a text or an example (AGENTS.md: public repository).
- A new error code in `packages/contracts` gets its text in `errors.ts`; a new `AmountTextError` in `accounting.ts`. The `satisfies` clauses and the tests fail until it does.

Run: `pnpm --filter @vertex-mizan/i18n test`.
