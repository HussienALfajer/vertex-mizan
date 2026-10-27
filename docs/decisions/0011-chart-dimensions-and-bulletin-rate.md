# 0011 — Chart of accounts, the contract dimension and the bulletin rate of the day

Status: Accepted · Date: 2026-10-27 (owner's answers in the S02 interview) · Amends [0007](0007-book-and-parallel-currency-ledgers.md) (the bulletin lookup)

## Context
S02 (`docs/specs/S02-chart-dimensions-rates.md`) defines the chart of accounts, dimensions and the rate table every posting depends on. Four of its choices shape the whole system: how account codes are built, how statements are classified, how contracts are tagged for IFRS 15 netting, and which bulletin rate the statutory books use on a given day. ADR 0007 said the rate of a type on a date is the newest row effective on or before it. For the bulletin that would let a forgotten entry silently reuse an old rate in the statutory books.

## Decision
- **Account codes** (owner, 2026-10-27): four levels with codes of 1, 2, 3 and 6 digits. Each code starts with its parent's code: levels 2 and 3 add one digit `1`–`9`, level 4 adds `001`–`999`. The first digit is the class: 1 assets, 2 liabilities, 3 equity, 4 revenue, 5 expenses. Levels 1 and 2 are headers. A postable account is a leaf at level 3 or 4.
- **The lock after first use** (owner, 2026-10-27): once an account has a posted line, its code, parent, kind, class, normal balance, currency restriction, control and monetary flags never change. Its names, statement line and required dimensions stay editable, and it can be blocked. It is archived only with a zero balance in every currency and in both ledgers.
- **Statements by nature, ready for IFRS 18** (owner, 2026-10-27): expenses are presented by nature (IAS 1.102). Each income-statement line in the platform's statement-line catalogue also carries its IFRS 18 category (operating, investing, financing, income taxes). IFRS 18 replaces IAS 1 for periods from 2027-01-01, so accounts need no reclassification then.
- **Exchange differences** (owner, 2026-10-27): separate gain and loss accounts for realised and unrealised differences. The posting rule picks one by the sign of each ledger's difference. The income statement shows them net on one line (IAS 21.52(a)).
- **One contract dimension** (owner, 2026-10-27): projects and retainers are values of one built-in `contract` dimension, each with its kind and its client. The contract position is netted per contract (IFRS 15.105) by reading one dimension. The built-in types are client, contract, department and service. Hub values are matched by Hub ID only.
- **The bulletin rate of the day** (owner, 2026-10-27; amends ADR 0007):
  - A `bulletin` rate is in force on a date only if it is effective on or after the latest publication day on or before that date.
  - A publication day is one that is not a weekly day off of the company (Friday and Saturday by default) and not a holiday the accountant has marked.
  - So a working day needs its own bulletin, and a day off takes the last published one. Otherwise the rate is missing (`RATE_MISSING`).
  - `market` rates keep ADR 0007's rule (the newest on or before the date), because Hub sends a rate only when it changes.
  - Basis: IAS 21.21–22 (the spot rate at the date of the transaction).
- **Rate pairs and corrections** (owner, 2026-10-27):
  - The first rate of two currencies fixes their orientation for the company.
  - A correction is a newer row with a reason. It never changes a posted entry. Mizan lists the entries that used the superseded row so the accountant can reverse and repost them (IAS 8).

## Consequences
- `packages/ledger`'s `rateInForce()` and `policyRate()` take the publication calendar, and the bulletin lookup gains property tests.
- The pre-close checklist (S07) checks that every publication day of the month has its bulletin.
- S03 stores on each converted line the rate row it used, and marks an account's first posted line.
- The chart templates are drafts until Syrian accountants review them (open question Q3). The structure above does not depend on that review.
- A third-currency bulletin published weekly needs a per-pair schedule (open question Q10).
