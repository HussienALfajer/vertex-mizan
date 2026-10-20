# 0004 — Money and currencies: integer minor units, quoted rates, three amounts on every line

Status: Accepted · Date: 2026-10-20

## Context
Vertex Media keeps its books in USD and needs an SYP view for the tax return (phase 1 scope §4). Hub sends amounts in USD or SYP with the SYP-per-USD rate it used (Hub ADR 0006). Revenue is deferred and released over time, SYP balances are revalued at month end, and settlements create realised exchange differences. Every one of these needs exact arithmetic and amounts that add up to the cent. Since 2026-01-01 the Syrian pound is the new pound (100 old = 1 new), and the ISO code is still SYP (`market-syria.md` §5.1, CONFIRMED).

## Decision

### Amounts
- **Amounts are integer minor units** (`bigint` in the database) with an ISO 4217 code.
- The exponent comes from one currency table in `packages/contracts`: `USD` 2, `SYP` 2 (the new pound, as in Hub ADR 0006). Other currencies are added there with their exponent.
- There is no floating point in any column, contract or calculation.
- Inside `packages/ledger`, arithmetic uses `BigInt`. Contracts carry amounts as integers within the safe-integer range, as Hub does.
- **Sign convention on journal lines:** positive is a debit, negative a credit. Screens and reports show debit and credit columns.

### Rates
- **A rate is stored as quoted:** a base currency, a quote currency and a positive exact decimal (`numeric`, up to 10 decimal places), meaning the quote-currency units per 1 base-currency unit.
- Hub's "SYP per USD" `numeric(12,4)` is stored as base `USD`, quote `SYP`, unchanged.
- Rates are never inverted into a stored decimal, because 1/122 has no exact decimal.
- **The company rate table:**
  - each row has an effective date, the pair, the rate, a type and a source;
  - the type is `market`, the rate the company deals at, or `bulletin`, the Central Bank of Syria bulletin;
  - the source is `hub`, `manual` or `import`;
  - rows are append-only: a correction is a newer row for the same date and type;
  - the rate of a type on a date is the newest row effective on or before that date.
- **A transaction's own rate wins.** A Hub event carries the rate actually used, and it is the rate of that transaction. The rate table serves manual entries (as a default the accountant can change) and revaluation.

### Conversion and rounding
- **One conversion function** converts an amount between two currencies with a quoted rate. It uses exact integer arithmetic, respects both exponents and **rounds half away from zero**. For non-negative amounts this equals Hub's half-up `convertMinor`; a compatibility test reuses Hub's examples.
- **Three amounts on every journal line:**
  1. the transaction amount in its currency;
  2. the **functional** amount (USD for Vertex Media);
  3. the **second-currency** amount (SYP for Vertex Media; a company may have none).

  Each conversion stores the quoted rate it used and the base of that quote.
- **Every entry balances in the functional currency and in the second currency.** When conversion leaves a difference, the posting function adds a line to the company's conversion-rounding account, flagged as rounding. The difference is bounded by half a minor unit per converted line; a larger one is an error, never a rounding line.
- **Allocation:** splitting an amount (revenue days across months, a deposit across milestones) uses cumulative rounding. Part *k* is `round(total × cumulative weight up to k) − round(total × cumulative weight up to k−1)`, so the parts always sum exactly to the total, and a later recomputation never changes parts already posted.

### Exchange differences (IAS 21)
- **Realised:** a monetary open item is carried at its functional amount. When it is settled, the difference between the carrying amount settled and the functional value of the settlement posts to realised exchange gain or loss (IAS 21.28).
- **Unrealised:** at month end, the balances of monetary accounts and open items in a foreign currency are revalued at the company's `market` rate for the last day of the month (IAS 21.23 and 21.26). The difference posts to unrealised exchange gain or loss, and the entry reverses on the first day of the next month.
  - Non-monetary items (contract liabilities, prepayments) are never revalued.
  - Each account carries a monetary flag, and the template sets it.
  - The accountant previews the revaluation and posts it; the pre-close checklist requires it.
- **The second-currency view** of an amount is its historical second-currency amount and is not revalued. Whether the SYP tax return needs a translation at the closing rate (IAS 21.39) is open (phase 1 scope §4, UNVERIFIED); the stored amounts allow either.

### The Syrian pound
- `SYP` means the new Syrian pound. Printed reports and exports label it "الليرة السورية الجديدة".
- **An SYP amount dated before 2026-01-01 is refused** (`SYP_BEFORE_REDENOMINATION`). Old-pound history and the 2026-01-01 conversion need their own decision (phase 4 onboarding).

## Consequences
- All money code lives in `packages/contracts` (types, the currency table, the conversion) and `packages/ledger` (lines, balancing, allocation, revaluation), and nowhere else. A lint rule forbids number arithmetic on fields named `*Minor` outside them.
- Property tests cover these rules:
  - a conversion followed by the inverse conversion differs from the original by at most half of one minor unit of the intermediate currency, expressed in the original currency;
  - every allocation sums exactly to its total;
  - every built entry balances in both currencies;
  - the rounding line never exceeds its bound;
  - a reversal negates every amount exactly.
- Reports never convert past entries at today's rate; they read the stored amounts.
