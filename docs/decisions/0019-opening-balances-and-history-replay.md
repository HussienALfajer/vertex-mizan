# 0019 — Opening balances and the history replay: a books start, Hub's snapshot, one opening entry, the replay by accounting date

Status: Accepted (owner, 2026-11-12, with S10) · Date: 2026-11-12 · Amends [0006](0006-hub-posting-api-contract.md) ("History replay"), [0007](0007-book-and-parallel-currency-ledgers.md) (line kinds), [0017](0017-daily-reconciliation.md) (Vertex Media's start date) and phase 1 scope §4 ("Start of the books")

## Context
Phase 1 starts Vertex Media's books on 2026-10-01 with opening balances, summarised manual entries for 1–18 October, and Hub's events replayed from 2026-10-19 (scope §4, F12; ADR 0006). Hub went into production on 2026-10-19, but its users entered older documents with their original dates: unpaid invoices, payments, wallet deposits and retainer cycles dated before 19 October, some before 1 October (owner, 2026-11-12). Hub holds no recognition schedule and no as-of export. S10 (`docs/specs/S10-opening-balances-replay.md`) needed to settle:
- which Hub documents reach Mizan as events and which through the opening;
- how the opening learns Hub's open documents, and how it is checked;
- how amounts in a currency other than a ledger's are measured at the opening;
- what the opening holds besides the balance sheet;
- what happens before the opening is posted, and how it is corrected.

## Decision
- **A books start per company:** `companies.books_start`, the first day of a month (2026-10-01 for Vertex Media). Nothing posts and no month closes before the company's opening is posted (`OPENING_NOT_POSTED`, `503` on `/v1` so Hub retries); every month before the books start is closed.
- **The replay by accounting date** (amends ADR 0006 and scope §4): Hub replays every event whose accounting date is on or after the books start, in its order, through `/v1/events`. A Hub document dated before the books start and still open at its eve reaches Mizan only through the opening. The manual entries for 1–18 October carry only what Hub does not hold. The daily reconciliation starts on the books start (amends ADR 0017's 2026-10-19).
- **Hub's snapshot:** Hub posts a snapshot as of the eve of the books start to `/v1/opening/snapshot`: its open invoices with their lines and recognition facts, each client's wallet balance, the milestones done and not invoiced, and a register of every document dated on or before that eve. A later snapshot replaces the earlier one until the opening is posted.
- **Hub documents become ledger objects at the opening:** open items carrying their Hub document (receivables, contract assets) or their client (ad funds), and recognition schedules holding what S06's rules would have left at the eve. Monetary items are measured at each ledger's policy rate of the eve (IAS 21.23(a)); contract liabilities at the invoice's rates of issue, the bulletin of the issue date in the book ledger and Hub's rate in the parallel ledger (IAS 21.23(b)).
- **Balance sheet only:** the opening holds assets, liabilities and equity. Equity is the balancing figure on the retained-earnings role, per ledger; the result of the books start's fiscal year before the books start goes to its own account (`312002`, role `pre_opening_result`), which reports add to the year's result.
- **A new line kind `stated`:** a line whose book and parallel amounts come from the old records, with no conversion. It is allowed only in an entry of source `opening`, and is used for non-monetary balances and equity.
- **The records must agree with Hub:** the accountant enters the old records' receivables and client funds per client and currency; the opening posts only when they equal Hub's snapshot. There is no acceptance of a difference (as ADR 0017).
- **The owner posts it, once:** the accountant prepares, the owner posts with a fresh two-factor code. The owner may reverse it whole only while it is the company's only posted entry; after that, corrections are manual entries.
- **Events about documents before the books start** (a void, a change, an archive or a reopen of something only the opening carries) are held `NEEDS_DECISION` with the detail `before_books_start`.

## Consequences
- Hub adds the snapshot, the replay from the books start in its order, the retry on `503 OPENING_NOT_POSTED`, and the reconciliation reports from the books start (open question Q5).
- The opening entry is entry 1 of the books start's fiscal year, and the journal book begins with it.
- The opening's computation of schedules runs S06's pure functions over Hub's facts, so a Hub document opened at the books start continues under S06 exactly as one posted by its events.
- The service-agency and general templates gain `312002`; existing synthetic companies get it by migration.
- The trial balance and account statements show the opening entry in the opening column when their range starts on the books start.
