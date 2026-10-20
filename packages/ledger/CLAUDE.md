# packages/ledger

The pure accounting mechanics of the double-entry core (ADR 0005, ADR 0007): journal lines with their transaction, book and parallel amounts, new measurements per ledger policy, carried amounts, balancing with rounding and exchange-difference lines, cumulative allocation and the integrity hash. No I/O: the posting function in `packages/db` (S03) reads rates and balances, calls these functions, and writes the ledger. Posting rules (which account, which event) come with their scenarios from S03 on (`/posting-rule`); nothing here decides an account.

## Layout
- `src/<module>.ts` with `src/<module>.test.ts` next to it; `src/index.ts` re-exports every public module.
- `lines.ts`: `Line` (kinds `measured`, `carried`, `difference`, `rounding`), `CarriedAmounts`, `Conversion` (the rate a ledger amount was converted at, `policy` or `transaction`), `carriedLine()`, `negate()`, `keptLedgers()`, `ledgerCurrency()`, `ledgerAmount()`.
- `rates.ts`: `rateInForce()` (the newest row of a type effective on or before the date; among rows of one date, the one recorded last) and `policyRate()` (direct, or a cross through `via`).
- `measure.ts`, **the pattern to copy for a mechanic with rules**: `measure()` and `measuredLine()` for new measurements.
- `carried.ts`: `clearOpenItem()` and `openItemCarrying()` (cumulative rounding over what is cleared), `moveRunningBalance()` (average carrying amount, zero-crossing split), `reverseLines()`.
- `allocation.ts`: `allocate()` and `allocateCarried()` (cumulative rounding, each ledger separately).
- `balance.ts`: `ledgerTotal()`, `differenceLine()`, `exchangeDifferenceLines()`, `balanceEntry()` (rounding lines; refuses `ENTRY_TOO_FEW_LINES`, `ENTRY_UNBALANCED`, `SYP_BEFORE_REDENOMINATION`).
- `integrity.ts`: `canonicalJson()`, `entryHash()`, `verifyChain()`. Its `node:crypto` import is the package's only Node API.
- `share.ts` (internal): `share()`, the rounding of every proportion, through contracts' `divideHalfAwayFromZero`.
- Tests: one example file per module; `adr-0007.examples.test.ts` (the ADR's and the scenario book's worked examples, end to end); `ledger.properties.test.ts` (fast-check: every ADR 0007 property, the refusals and the chain); `purity.test.ts`; `test-fixtures.ts` (synthetic companies and rates, left out of the build).

## Rules
- **Amounts** are `bigint` minor units. Conversions go through contracts' `convert()` only, and proportions through `share()`: both round half away from zero once, on the exact value. Never a float, never a `number` amount.
- **New measurement or carried amount (ADR 0007).** A line that measures something new converts per ledger with `measure()`. A line that releases, clears, settles or reverses a balance carries that balance's amounts (`clearOpenItem`, `moveRunningBalance`, `allocateCarried`, `reverseLines`) and is never converted again.
- **Rates.** A ledger uses the transaction's own rate only when its policy is `market`, accepts it, and the rate quotes the pair to convert; otherwise its policy's rate type in force on the entry date: the more recent of the direct rate and a cross through the company's other ledger currency (the book currency for the parallel ledger, the parallel currency for the book ledger), a cross being as recent as its older quote and the direct rate winning a tie. A missing rate throws `RATE_MISSING`: never a default, never another type.
- **Balance.** Every entry goes through `balanceEntry()` last. It adds a rounding line only when the exact, unrounded values balance (contracts' `sumsToZeroExactly`), so the difference is conversion rounding (at most half a minor unit per converted line); rounding lines passed in (a reversal's) must balance their ledger by themselves. Any other residual is the posting rule's to post first, as difference lines (`exchangeDifferenceLines`); otherwise the entry is refused with `ENTRY_UNBALANCED`.
- **No difference explains an imbalance in one currency.** When every line but difference and rounding lines is in one transaction currency, those lines balance in it, or `exchangeDifferenceLines()` and `balanceEntry()` refuse them (`ENTRY_UNBALANCED`): an overpayment is a liability to post, never a gain. When they are also all new measurements, no difference line is allowed: their residual can only be rounding.
- **Difference and rounding lines** carry an amount in one ledger only: in the ledger currency, or on an item in another currency with a transaction amount of zero.
- **Measured lines are built, never taken.** `balanceEntry()` checks that a measured amount is the conversion of its transaction amount at the rate it records, not that the rate is the one the policy picks. So the posting function builds every new measurement with `measuredLine()` and every reversal with `reverseLines()`, and never accepts lines from its caller.
- **One method per balance.** A schedule known in advance is split with `allocateCarried()`; movements as they come are cleared with `clearOpenItem()` or `moveRunningBalance()`. The methods round differently, so one balance never mixes them.
- **Purity** is tested (`purity.test.ts`): source files import only `@vertex-mizan/contracts` and their siblings (`integrity.ts` also `node:crypto`), and use no clock, randomness, timers, network or `process`.
- **Errors.** A business refusal is a `DomainError` with a code from contracts' registry (a new code goes there first). A line whose amounts contradict its kind, or an argument no caller should pass, is a programming error: `TypeError` or `RangeError`.
- **Integrity.** `canonicalJson()` and `entryHash()` must never change once an entry is posted: a stored chain is verified with them for at least ten years. The pinned hash in `integrity.test.ts` fails on any change. A `bigint` and its decimal string serialise differently, so the posting function and the integrity check build the entry value from the same typed fields (node-postgres returns `bigint` columns as strings: parse them back first).
- Arithmetic on `*Minor` fields is allowed here (`packages/config/biome-plugins/minor-arithmetic.grit`). Every test value is synthetic; account codes are the scenario book's placeholders.

Changing an exported type or function changes `packages/db` and every posting rule: run `pnpm typecheck` at the root.

Run: `pnpm --filter @vertex-mizan/ledger test`.
