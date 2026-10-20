# packages/contracts

Zod schemas and pure rules shared by the API, the worker, the web app and integrators (ADR 0002): the money module (ADR 0007) and the error-code registry (ADR 0006). The Hub event contracts and the permission map arrive with their specs (S05, S01). Copied from Vertex Food's `packages/contracts` and adapted. No I/O and no Node APIs (`tsconfig.json` loads no Node types); Zod is the only dependency.

## Layout
- `src/<module>.ts` with `src/<module>.test.ts` next to it; `src/index.ts` re-exports every public file.
- `money.ts`, **the pattern to copy for a module with rules**: the currency table (`currencies`, exponents published as `x-exponents` on `CurrencyCode`), `Money` (bigint minor units), `money()`, `checkCurrencyDate()` (SYP before 2026-01-01), rate types and sources, `exchangeRateSchema` (a rate-table row, as quoted), `convert()` with a rate or a `CrossRate`, `ratePolicySchema` and `companyLedgersSchema` (book and parallel ledger, each with its policy).
- `money-arithmetic.ts`: the exact integer arithmetic behind `convert()` (`divideHalfAwayFromZero`, `scaleMinor`) and the stored range. Internal: not re-exported, so `convert()` stays the one public conversion.
- `errors.ts`: `errorStatus` (every code with its HTTP status), `errorCodeSchema`, `DomainError`.
- Tests: `money.test.ts` (examples), `money.hub-compat.test.ts` (Hub's `convertMinor` examples and an equivalence property), `money.properties.test.ts` (fast-check: exactness, sign symmetry, inverse, cross rates), `errors.test.ts` (the published codes).

## Rules
- **Money (ADR 0007):** amounts are `bigint` minor units with a currency, within ±(2⁶³ − 1); never `number`, never floats. Rates are decimal strings kept exactly as quoted (base, quote, up to 10 places) and never inverted: converting from the quote currency divides by the quote. Convert only with `convert()`; it rounds half away from zero once, on the exact value, and a cross rate is one exact product of both quotes, of one type, each effective on or before the entry date `on` (the lookup picks the newest; ADR 0007, owner 2026-10-20). It refuses what it cannot do (`RATE_PAIR_MISMATCH`, `CROSS_RATE_MISMATCH`, `INVALID_RATE`, `SYP_BEFORE_REDENOMINATION`, `AMOUNT_OUT_OF_RANGE`) instead of guessing. An amount in its own currency is not converted: the caller uses it as is.
- A currency is added as data in `currencies` and `CURRENCY_CODES`, with a test. Changing an exponent once amounts are stored needs a data migration of every stored amount.
- Arithmetic on `*Minor` fields is allowed only here and in `packages/ledger` (`packages/config/biome-plugins/minor-arithmetic.grit`). Elsewhere, call a money function; a `biome-ignore` for this plugin is refused in review.
- **Error codes** are upper snake case and never renamed, removed or reused (ADR 0006). A new code goes at the end of `errorStatus` with its status, at the end of the list in `errors.test.ts`, and gets its Arabic text in `packages/i18n` (from PR 6). `pnpm check:error-codes` (in CI) fails when a code published on `main` is renamed, removed, moved or re-statused.
- A refusal by a business rule throws `DomainError` with a code; input that fails a schema throws Zod's error. Schemas that put a code on a custom issue carry it in `params.code`.
- Schemas `<thing>Schema`, types `Thing = z.infer<…>`; every schema the API exposes has `.meta({ id })` and converts to JSON Schema (the test in `money.test.ts` fails on one that does not). `bigint` schemas have no id: the wire shape of amounts is decided with the API (S05).
- Every test value is synthetic: no real rates, companies or amounts.

Changing an exported schema or function changes every consumer: run `pnpm typecheck` at the root.

Run: `pnpm --filter @vertex-mizan/contracts test`.
