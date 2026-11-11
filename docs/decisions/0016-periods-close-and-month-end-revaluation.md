# 0016 — Periods, the close and the month-end revaluation

Status: Accepted (owner, 2026-11-11, with S07) · Date: 2026-11-11 (owner's answers in the S07 interview) · Amends [0007](0007-book-and-parallel-currency-ledgers.md) (revaluation units, closing rate, staleness) and [0008](0008-foundation-audit-amendments.md) (period states)

## Context
S07 (`docs/specs/S07-revaluation-periods-close.md`) closes months and revalues both ledgers. ADR 0005 and 0008 fix that a closed period takes no entry and the lock order of a close; ADR 0007 fixes that each ledger revalues its monetary balances in other currencies at its policy rate for the month end, per open item for control accounts and per account and currency otherwise, reversing on the next day, with an adjusting revaluation when a back-dated posting makes it stale. They leave open:
- whether months close in any order, and which months can be reopened;
- whether the pre-close checklist can be overridden;
- how the revaluation entry is shaped, and the unit for accounts that are not control accounts but carry dimensions (the project-expense clearing account `211002`);
- which market rate is the closing rate when none is recorded on the last day;
- when a revaluation may post, and whether a corrected closing rate makes it stale;
- whether blocked accounts are revalued.

## Decision
- **Months close in order; only the latest closed month reopens** (owner, 2026-11-11). Every month from the company's first period to the latest closed month is closed, so the reversal of a revaluation on the next month's first day always lands in an open month, and no closed month's figures change behind a later closed month. A posting dated before the first period after a close is refused `PERIOD_CLOSED`. States are `open`, `closed` and `reopened`; each transition has an append-only `period_events` row with its reason, and Hub reads `reopened` as `open`.
- **The checklist has no override** (owner, 2026-11-11). Every item passes, computed inside the close's transaction after the head and period locks (ADR 0008), and its results are stored with the close.
- **Revaluation units** (owner, 2026-11-11): open items per item (ADR 0007); every other monetary balance per account, dimension set and currency, the key the period balances already keep, so a project's balance on `211002` is right at the closing rate. A balance with a zero transaction amount and a residual in a ledger is brought to zero.
- **Entry shape** (owner, 2026-11-11): one entry per ledger, dated on the month's last day, with two lines per balance: the balance's line (transaction 0, that ledger only) and its counter line on the unrealised gain or loss account by sign, without dimensions as for realised differences. Gains and losses are not netted in the ledger; statements may present them net (IAS 1.35).
- **The closing rate** (owner, 2026-11-11) is the ledger's policy rate in force on the last day: the bulletin of the day (ADR 0011); for `market`, the newest rate on or before the last day, shown with its date.
- **Timing** (owner, 2026-11-11): the preview is open at any time; the posting only after the month has ended in Asia/Damascus, by the accountant, per ledger, with its reversal in the same transaction.
- **Current means recomputed equal** (owner, 2026-11-11): a revaluation is current when recomputing it gives no difference. A back-dated posting, a reopen's postings or a corrected closing rate while the month is open make it stale (IAS 21.23 needs the correct closing rate), and an adjusting revaluation posts only the differences.
- **Blocked accounts and archived dimension values are revalued** (owner, 2026-11-11): blocking stops new transactions; a revaluation remeasures an existing balance.
- **Open-item balances keep the carrying amount and the revaluations apart**, so settlements and invariant 9 read the carrying amount (ADR 0013) and the control-account comparison reads both.

## Consequences
- A reopen of an earlier month first reopens the later ones; this is deliberate friction for a rare correction (IAS 8.42).
- S08's reconciliation item joins the checklist when S08 ships; no real month is closed before it.
- Revaluation entries carry no client or contract dimension on their gain and loss lines, so S09's profitability reports show unrealised differences at company level, as they show realised ones.
- The scenario book gains `currency/month-end-revaluation.md`, `currency/stale-revaluation.md` and `periods/close-and-reopen.md`, and its `Proposed` cases waiting for a close run.
