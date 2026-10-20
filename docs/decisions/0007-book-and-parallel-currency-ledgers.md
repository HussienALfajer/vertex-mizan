# 0007 — Money and currencies: a book currency and a parallel currency ledger, a rate policy per ledger

Status: Accepted · Date: 2026-10-20 (owner, after the foundation audit) · Supersedes [0004](0004-money-and-currencies.md)

## Context
ADR 0004 stored three amounts on every line: transaction, functional and "second". It required every entry to balance in the second currency, yet it defined the second amount as historical and never revalued. The foundation audit (`docs/audits/2026-10-foundation-audit.md`, B1 and B2) showed two consequences.
- **B1:** the balance rule is impossible for an ordinary case. Take a USD invoice at 122 SYP/USD, paid in USD at 125 SYP/USD: the entry is 30,000 SYP out of balance in the second currency, and no line may absorb the difference.
- **B2:** historical, never-revalued amounts cannot produce an SYP balance sheet or tax return.

Syrian practice keeps statutory books in Syrian pounds and watches the business in US dollars. Syrian businesses also deal in other currencies (TRY in the north, EUR).

**The law on the books:**
- The Commercial Code requires a chronological journal **in Arabic**, numbered and certified (Law 33/2007, arts. 16–19, REPORTED).
- The Income Tax Law states every amount in Syrian pounds but names no currency for the books (Law 24/2003, CONFIRMED).
- Whether books may be kept in USD is UNVERIFIED.

The owner decided on 2026-10-20, answering the audit:
- the third amount is a **full parallel ledger**;
- Vertex Media keeps its **statutory books in SYP** with a **parallel USD ledger**;
- each ledger uses **its own rate policy**: the Central Bank bulletin for the statutory SYP books, the market rate the company deals at for the USD ledger.

## Decision

### Amounts
These rules are unchanged from ADR 0004.
- **Amounts are integer minor units** (`bigint`) with an ISO 4217 code. The exponents come from one currency table in `packages/contracts`: `USD` 2, `SYP` 2 (the new pound), `TRY` 2, `EUR` 2; more are added as data. There is no floating point anywhere. `BigInt` arithmetic is used inside `packages/ledger`.
- **ISO code:** no ISO 4217 amendment for Syria was found, so `SYP` stands (REPORTED). A future code change is a change to the currency table.
- **Sign convention on lines:** positive is a debit, negative a credit.
- **An SYP amount dated before 2026-01-01 is refused** (`SYP_BEFORE_REDENOMINATION`). Old-pound history needs its own decision. SYP is labelled "الليرة السورية الجديدة" on printed output.

### Two ledgers per company
- **The book currency** is the currency of the company's statutory books: the journal, the trial balance and the statements filed with the tax return. It is the company's functional currency for its statutory financial statements. A stored policy note per company records the IAS 21.9–12 basis of that choice.
- **The parallel currency** is optional, one per company. When it is set, the company keeps a **full parallel ledger** in it, with its own exchange differences and revaluation. The parallel ledger is complete and correct on its own terms; it is not a memorandum.
- **Defaults:** a new company has book currency SYP and no parallel currency. Vertex Media has book SYP and parallel USD.
- **Every journal line carries three amounts:**
  1. the transaction currency and amount;
  2. the book amount;
  3. the parallel amount (null when the company has none).

  Each conversion stores the quoted rate it used, the base of that quote, and the rate's type and source.
- **Every entry balances in the book currency and, when set, in the parallel currency.**

### Rates
- **Stored as quoted:**
  - a base currency, a quote currency and a positive exact decimal (`numeric`, up to 10 decimal places): quote units per 1 base unit;
  - never inverted into a stored decimal;
  - Hub's "SYP per USD" is stored as base `USD`, quote `SYP`.
- **The company rate table:**
  - each row has an effective date, the pair, the rate, a type and a source;
  - the type is `market`, the rate the company deals at, or `bulletin`, the Central Bank of Syria bulletin;
  - the source is `hub`, `manual` or `import`;
  - rows are append-only: a correction is a newer row for the same date and type;
  - the rate of a type on a date is the newest row effective on or before that date.
- **A rate policy per ledger.** Each company sets, for its book ledger and for its parallel ledger, the rate type that ledger uses. It also sets whether a transaction's own rate (the rate a connected system dealt at) is accepted for that ledger; only a `market` policy accepts one.
  - **Vertex Media:** the book ledger (SYP) uses `bulletin`; the parallel ledger (USD) uses `market`, with Hub's own rate accepted.
- **The reasoning is recorded:**
  - IAS 21.26: where several rates exist, use the one at which the cash flows would be settled; that is the market rate the company deals at, for the management ledger.
  - The statutory ledger follows the official bulletin, which the tax authority is expected to require (UNVERIFIED, open question Q1).
  - If the SYP is found not exchangeable at the official rate, IAS 21.8A and 19A require an estimate. This is reviewed with the auditor.
- **A missing rate never defaults.** If a ledger needs a rate of its type for the entry date and none exists, the posting is refused or the event is held with `RATE_MISSING`.

### Conversion
- **One conversion function** in `packages/contracts`. It converts between two currencies with a quoted rate, using exact integer arithmetic and both exponents, and **rounds half away from zero**. For non-negative amounts this equals Hub's half-up `convertMinor`; a compatibility test reuses Hub's examples.
- **New measurements versus carried amounts.**
  - A line that **measures a new amount** (revenue, a new receivable, cash received, an expense) converts at the ledger's policy rate on the entry date, as below.
  - A line that **releases, clears, settles or reverses an existing balance** carries that balance's own book and parallel amounts. This covers:
    - a contract liability released;
    - a contract asset cleared;
    - an open item settled;
    - a reversal.

    The amounts are allocated with cumulative rounding when only part is released or cleared. They are never converted again (IAS 21.23(b), IFRIC 22). The last part clears whatever remains, so a balance whose transaction amount reaches zero is zero in both ledgers.
- **The book amount** of a new measurement:
  - the transaction amount when the transaction currency is the book currency;
  - otherwise, the transaction amount converted with the book policy's rate for the pair (transaction currency, book currency) on the entry date.
- **The parallel amount** of a new measurement:
  - the transaction amount when the transaction currency is the parallel currency;
  - otherwise, the transaction amount converted with the parallel policy's rate for the pair (transaction currency, parallel currency) on the entry date, or with the transaction's own rate when the policy accepts it and the pair matches.
- **Third currencies** (TRY, EUR) need a rate of each ledger's policy type to that ledger's currency, either direct or crossed through two rates of the same type and date (for example TRY→USD market through TRY→SYP market and USD→SYP market), recorded with both quotes. A company that deals in a third currency keeps both its bulletin and its market rates.
- **Rounding lines:** when conversion leaves an entry out of balance in a ledger by rounding only, the posting function adds a line to the company's conversion-rounding account carrying an amount in that ledger only. The difference is bounded by half a minor unit per converted line.
- **Exchange residuals:** an entry can leave a residual in a ledger beyond the rounding bound when it settles or clears a carried balance (an open item, a contract asset, client funds), or when its lines are in more than one transaction currency (for example SYP received for a USD client fund). That residual is a **realised exchange difference** and posts as a difference line in that ledger (IAS 21.28). The posting rule computes it, its scenario shows it, and a manual entry shows it before posting. A residual beyond the rounding bound is an error only when every line is a new measurement in a single transaction currency.
- **Difference lines**, realised or unrealised, carry an amount in one ledger only.
  - On a monetary account or open item, the line keeps the item's transaction currency with a transaction amount of zero, so currency restrictions hold and the item's transaction balance is unchanged.
  - On the exchange gain or loss account, the line's transaction currency is the ledger's currency.
- **Allocation:** splitting an amount (days across months, a deposit across milestones, a partial settlement) uses cumulative rounding. Part *k* is `round(total × cumulative weight up to k) − round(total × cumulative weight up to k−1)`, so the parts sum exactly and a recomputation never changes parts already posted. Each ledger's amounts are allocated separately.

### Exchange differences, in each ledger (IAS 21)
- **Monetary open items** (receivables, payables, client funds) and monetary accounts carry a balance in every ledger.
- **Carrying amount:**
  - An open item's carrying amount in each ledger is its historical amount: the amounts it was measured at, less what was cleared before. Month-end revaluations reverse, so they are not part of it.
  - A **partial settlement** clears the carrying amount in proportion to the transaction amount settled, with cumulative rounding; the last settlement clears what remains.
  - Items kept as a running balance per counterparty (client ad funds) are carried at the **average** carrying amount: each withdrawal clears book and parallel amounts in proportion to the transaction balance before it.
  - **Voiding a movement on a running balance** (a deposit voided after spend) posts the exact reversal of the original entry (ADR 0005, invariant 3) and, in the same transaction, an exchange-difference entry that brings the item back to its average carrying amount, so that a zero transaction balance is zero in both ledgers.
- **Realised differences:**
  - At settlement, each ledger clears the open item at its carrying amount in that ledger.
  - The difference between that carrying amount and the settlement's amount in the same ledger posts to **realised exchange gain or loss**, as a difference line (IAS 21.28).
  - One settlement can produce a difference in the book ledger, in the parallel ledger, or in both.
- **Unrealised differences:**
  - At month end, each ledger revalues its monetary balances held in currencies other than its own, at its policy rate for the last day of the month (IAS 21.23). Revaluation is computed **per open item** for control accounts and per account and currency otherwise:
    - the book ledger (SYP) revalues USD, TRY and EUR items at the bulletin;
    - the parallel ledger (USD) revalues SYP, TRY and EUR items at the market rate.
  - Each revaluation entry carries amounts in its own ledger only and reverses on the first day of the next month.
  - Non-monetary items (contract liabilities, prepayments, equity) are never revalued. The account's monetary flag decides.
  - **A revaluation goes stale** when any posting is later dated on or before the month end it revalued while that month is still open. A back-dated payment is the typical case. The pre-close checklist then requires an **adjusting revaluation** for the difference, dated on that month end, with its own reversal on the first day of the next month.
- **The accountant previews and posts** each ledger's revaluation; the pre-close checklist requires both to be current.

### Reporting
- The trial balance, journal book, ledgers and statements are available in the book currency (statutory) and in the parallel currency (management). Each agrees with itself and with its own open items.
- **Contract positions are presented net per contract** (IFRS 15.105). A contract is a project or a retainer: its contract assets and contract liabilities are netted in the balance sheet and in the contract-position report; the ledger accounts stay gross and carry the contract as a dimension.
- A **presentation translation** under IAS 21.39 (closing rate for assets and liabilities, transaction-date rates for income and expenses, the difference in equity) into any currency is a later report feature for management. It never replaces the stored ledgers.
- **IAS 29** (hyperinflation) is out of scope. Syria is on watch lists, not on the hyperinflation lists, as of mid-2026 (REPORTED). An IFRS reporter whose functional currency is SYP must assess IAS 29.3 itself.

## Consequences
- **B1 is solved:** the USD invoice issued at bulletin 120 and paid in USD at bulletin 123 posts a 300.00 SYP realised gain in the book ledger and nothing in the parallel ledger. **B2 is solved:** the SYP books are a complete ledger, revalued at the bulletin.
- The rules on carried amounts, cross-currency residuals, partial settlements, third-currency rates and stale revaluations come from the accountant review of this record (2026-10-20). Each one gets its own scenario.
- Every Hub event is converted twice: to SYP at the bulletin of its accounting date, and to USD at Hub's own rate. The accountant must keep the bulletin rates up to date; a missing bulletin rate holds the events of that date (`RATE_MISSING`).
- The scenario book must cover the shapes:
  - an SYP book with no parallel;
  - an SYP book with a USD parallel (Vertex Media);
  - a USD book with an SYP parallel;
  - a third-currency transaction.
- **Property tests cover:**
  - every built entry balances in both ledgers;
  - every rounding line stays within its bound;
  - difference lines carry an amount in one ledger only;
  - a balance whose transaction amount reaches zero is zero in both ledgers;
  - releasing or clearing a balance never converts it again;
  - allocations sum exactly;
  - a reversal negates every amount exactly;
  - a conversion and its inverse differ by at most half of one minor unit of the intermediate currency, expressed in the original currency.
- All money code lives in `packages/contracts` (types, the currency table, the conversion) and `packages/ledger` (lines, balancing, differences, allocation, revaluation). A lint rule forbids number arithmetic on fields named `*Minor` elsewhere.
