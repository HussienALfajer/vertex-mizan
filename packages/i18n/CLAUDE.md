# packages/i18n

The Arabic text of every front end (ADR 0009): plain catalogs and locale constants, no i18n library and no I/O. The web app wires its own i18next instance to `ar` (PR 8). Copied from Vertex Food's `packages/i18n` and adapted.

## Layout
- `src/ar/<namespace>.ts`, collected in `src/ar/index.ts` (`ar`, `Catalog`):
  - `common`: shared text (product name, theme and density labels);
  - `accounting`: the accounting components' text (debit, credit, ledgers, period states, account kinds, SYP's printed name) and `amountInput`, the reason for every `AmountTextError` of the money module;
  - `grid`: the data grid's summary bar labels and the text of each refusal of the grid core (`packages/ui/src/grid/grid.test.tsx` checks every refusal has one);
  - `commandPalette`: the command palette's own labels (its commands' names come with their specs);
  - `shortcuts`: the name of every action of `packages/ui`'s keymap;
  - `errors`: the text of each error code of `packages/contracts`;
  - `designSystem`: the design-system page's headings and synthetic examples.
- `src/locale.ts`: `defaultLanguage` (`ar`), `textDirection` (`rtl`), `formatLocale` (`ar-SY-u-nu-latn`: Syrian month names, Latin digits; pinned by `locale.test.ts`) for dates and counts, `displayTimeZone` (`Asia/Damascus`).
- `src/catalog.test.ts`: no empty text, no Arabic-Indic digit, a text for every error code and every amount-input reason.

## Rules
- Every text the user sees lives here; components never hold literal text.
- Terms come from `docs/glossary.md`, one term per concept.
- Digits are Latin, in text and through `formatLocale`; never format with a bare `ar` locale. Amounts are never formatted with `Intl`: the money module formats them (`formatMinor`).
- Never put real names, companies, accounts, amounts or numbers in a text or an example (AGENTS.md: public repository).
- A new error code in `packages/contracts` gets its text in `errors.ts`; a new `AmountTextError` in `accounting.ts`. The `satisfies` clauses and the tests fail until it does.

Run: `pnpm --filter @vertex-mizan/i18n test`.
