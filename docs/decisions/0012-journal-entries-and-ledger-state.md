# 0012 — Journal entries: numbering year, manual rates, approval and the ledger's derived state

Status: Accepted · Date: 2026-10-28 (owner's answers in the S03 interview; approved with the spec the same day) · Amends [0005](0005-ledger-invariants.md), [0007](0007-book-and-parallel-currency-ledgers.md), [0008](0008-foundation-audit-amendments.md)

## Context
S03 (`docs/specs/S03-journal-entries-posting.md`) builds the ledger tables, the posting function and manual entries. ADR 0005 and 0008 fix the invariants but leave four choices that shape every later spec: which fiscal year numbers an entry posted after the year turned, how a manual entry in more than one currency is measured, who may approve a manual entry, and how the summaries the posting function maintains (the ledger head, the number counters, the period balances) are protected when they cannot be append-only.

## Decision
- **Numbering year** (owner, 2026-10-28; refines ADR 0008 "Journal order"): an entry takes the next number of the fiscal year of its **accounting date**, in posting order. An entry dated 31 December and posted in January continues that year's sequence, so each year's journal book holds only its own numbers.
- **Manual entries are new measurements** (owner, 2026-10-28; amends ADR 0007 "Rates"):
  - every manual line is converted per ledger at that ledger's policy rate on the entry date; nobody types a book or parallel amount;
  - the accountant may give the rate actually dealt at for a currency pair of the entry. ADR 0007's "transaction's own rate" then includes this dealt rate: only a `market` ledger that accepts a transaction's rate uses it, for that pair only, and it is stored on the line's conversion, never in the rate table;
  - an entry in one currency balances in it, and any ledger residual is conversion rounding; an entry in more than one currency posts each ledger's residual, rounding included, as a realised exchange difference to the gain or loss role account by its sign (IAS 21.28).
- **Approval** (owner, 2026-10-28): when a company switches approval on, every manual entry and every manual reversal is approved by an owner or an approver who neither prepared nor submitted it. Approval posts it. There is no amount threshold.
- **Manual reversal** (owner, 2026-10-28): only manual entries are reversed by hand, at a date the accountant picks on or after the original's; entries from Hub, revaluation, revenue release and opening balances are reversed by their own processes, so Mizan and their source never disagree. A reversal is never reversed; the original is copied instead.
- **Entry dates** (owner, 2026-10-28): a manual entry may be dated up to the last day of the current month (Asia/Damascus), for month-end accruals, in any open period.
- **The ledger's derived state** (amends ADR 0005 "Balances" and ADR 0008 "Period balances"): the ledger head, the entry-number counters and the period balances form a table kind `ledger-state`. They cannot be append-only, since they summarise a growing ledger, so:
  - the app role has `SELECT, INSERT, UPDATE` on them, never `DELETE` or `TRUNCATE`;
  - a guard trigger on each (`ENABLE ALWAYS`, pinned) allows only the change an append makes: the head moves by one entry whose previous hash is the old head; a counter moves by exactly one; period balances are written only by the trigger on line inserts (a direct write at trigger depth 1 is refused) and never decrease;
  - the integrity check rebuilds the period balances and the head from the lines and compares them.
  No function is `SECURITY DEFINER` (ADR 0003).

## Consequences
- The journal book of a year is complete and gapless once its last period closes, even with back-dated postings across the year end.
- A currency purchase or a payment in another currency posts its realised difference at once, and Vertex Media's USD ledger can carry the rate the company actually dealt at.
- An approval queue needs two people with the right roles; the owner staffs it.
- The period balances can be trusted without being append-only: a property test and the integrity check prove they equal the lines.
- S05–S07 post through the same function and inherit these rules; their own reversals follow their processes.
