# 0005 — Ledger invariants: guaranteed by the database, written by one posting function, proven by a hash chain and the scenario book

Status: Accepted, amended by [0008](0008-foundation-audit-amendments.md) (journal order, hardened guards, period balances, scenario runner) and [0012](0012-journal-entries-and-ledger-state.md) (the ledger's derived state); currency rules in [0007](0007-book-and-parallel-currency-ledgers.md) · Date: 2026-10-20

## Context
A ledger is only worth what its guarantees are. The market does not trust cloud accounting (`market-syria.md` §8), the tax law accepts electronic books and requires 10-year retention (Income Tax Law 24/2003, arts. 14 c and 124, CONFIRMED), and the system is written across many AI sessions. A rule that lives only in application code will eventually be broken by a new code path, a script or a migration. The approved working method (§4.2) lists the invariants; this record fixes how each is enforced. Vertex Digital ADR 0003 is the pattern: an append-only journal, idempotency keys and one posting function.

## Decision

### Drafts are not ledger
- Manual entries being prepared, and entries waiting for approval, live in **draft tables** that can change.
- Posting copies a draft into the ledger tables. The ledger tables hold **posted entries only**, so "a posted entry never changes" becomes "the ledger tables are append-only".

### The invariants

| # | Invariant | Enforced by |
|---|---|---|
| 1 | **Every entry balances** in the functional currency and in the second currency, and has at least two lines. | A deferred constraint trigger checked at commit. |
| 2 | **Posted entries never change.** No `UPDATE`, `DELETE` or `TRUNCATE` on entries, lines, line dimensions, open-item movements, posting requests, rate rows, period events or the audit log. | Grants (the app role has `SELECT, INSERT` only) and a `refuse_change()` trigger for every role. |
| 3 | **Corrections are reversals.** A reversal is a new entry that references the original and negates every line exactly. An entry is reversed at most once. | A unique constraint on the reversed entry, and a deferred trigger that compares the lines. |
| 4 | **A closed period stays closed.** No entry is dated inside a closed period. | A trigger on insert that reads the period under a share lock; closing takes an exclusive lock on the period row, so a close and a posting can never interleave. |
| 5 | **Nothing posts twice.** | A unique `(company_id, client, idempotency_key)` on posting requests; an entry references its request. |
| 6 | **Entry numbers have no gaps** per company and fiscal year. | A counter row locked inside the posting transaction; the number is given at posting. |
| 7 | **No company sees another.** | Forced row-level security (ADR 0003). |
| 8 | **Lines are valid:** the account is postable, active and of the same company; the currency restriction is respected; required dimensions are present; no SYP amount is dated before 2026-01-01. | Composite foreign keys, checks and an insert trigger; the posting function checks the same rules first to give clear errors. |
| 9 | **Open items never flip sign.** A receivable is never settled beyond its amount. | A deferred trigger on open-item movements. |
| 10 | **The audit log is written in the same transaction** as the change, and only appended to. | Grants, triggers, and the posting function and services writing it in the transaction. |
| 11 | **One way to write the ledger.** | The posting function in `packages/db`. A convention test fails if any other module inserts into a ledger table. |
| 12 | **No ledger table ships without these guards.** | The convention test (below). |

### The posting function
`post(tx, request)` in `packages/db`, used by the API, the worker and the scenario runner, runs inside `withCompany`:

1. Lock the company's ledger head row (serialises numbering and the hash chain per company).
2. Read the entry date's period with a share lock; refuse if it is closed.
3. Validate accounts, dimensions, currencies and dates.
4. Build the lines with `packages/ledger`: conversions, the rounding line (ADR 0004) and open-item movements.
5. Give the next number of the fiscal year.
6. Compute the entry hash: SHA-256 of a canonical serialisation of the header, lines, dimensions and the previous entry's hash.
7. Insert the entry, lines, dimensions, open-item movements and the audit entry; move the ledger head forward.
8. Commit. The deferred triggers check balance, reversal and open items.

### The integrity chain
- Every posted entry stores its hash and the previous hash of the company's chain.
- The **integrity check** report recomputes the chain from the start and shows the first break.
- It detects what the guards cannot prevent: a database superuser who disables triggers. A later step may send the daily chain head to the owner by email, so a rewritten chain cannot match a head held outside the server.

### Balances
- Balances and reports are computed from lines on read, with indexes on `(company_id, account_id, entry_date)`.
- A snapshot table may be added for closed periods, since they cannot change. It must be rebuildable from the lines, and a test must compare it with them.

### Retention
- **Companies are archived, never deleted.** Ledger data is kept at least 10 years (Income Tax Law 24/2003, art. 124, CONFIRMED).
- **No migration changes posted ledger data.** A historical correction is a reversal entry, never an `UPDATE` (`/db-migration`).

### Tests
- **Convention test** (reads the migrated database). It fails when a ledger table:
  - is not registered as append-only;
  - lacks a `refuse_change()` trigger, forced row-level security or its composite company keys;
  - grants the app role anything beyond `SELECT, INSERT`;
  - is inserted into outside `packages/db`'s posting function.
- **Invariant tests** try every forbidden action as each database role and expect a refusal: update, delete, an unbalanced commit, a posting into a closed period, a second reversal, and a duplicate key.
- **Property tests** (fast-check) check, for any generated input:
  - every posting balances in both currencies;
  - an entry plus its reversal nets to zero on every account;
  - the trial balance always balances;
  - reports reconcile to the ledger;
  - allocations sum exactly;
  - replaying a request returns the first result and posts nothing;
  - nothing lands in a closed period;
  - concurrent postings and a close never interleave wrongly;
  - two companies never see each other;
  - the hash chain verifies after any sequence of postings.
- **The scenario book** (`docs/scenarios/`):
  - Each posting, recognition, revaluation and settlement rule is one Markdown file. It holds the explanation, the standard (and the Syrian basis with its label), and a YAML block with the setup (template, rates), the events or manual entries, and the expected entries and balances (account code, dimensions, transaction, functional and second amounts).
  - A runner executes every file against the real posting function and a fresh test database.
  - A rule is implemented only after its scenario exists. Changing an expected value needs the owner's approval (working method §3).

## Consequences
- Correctness does not depend on every code path remembering the rules: the database refuses what the rules forbid, and CI proves the refusals.
- Posting is serialised per company. This is fine at the expected volume (Vertex Media posts a few hundred entries a month), and a company is the natural unit of contention.
- Hub's edits of expenses and ad spend become reversal pairs. The ledger grows faster than the documents, but every change stays visible.
