# 0008 — Amendments after the foundation audit: journal order, hardened guards, period balances, scenario runner, API holds and tax lines

Status: Accepted · Date: 2026-10-20 (owner, after the foundation audit) · Amends [0002](0002-stack-and-repository.md), [0003](0003-tenancy-and-access.md), [0005](0005-ledger-invariants.md), [0006](0006-hub-posting-api-contract.md)

## Context
The foundation audit (`docs/audits/2026-10-foundation-audit.md`) found that ADRs 0002, 0003, 0005 and 0006 are sound in design but miss details their guarantees depend on (M3, M4, M7, M9, M10, m5, m13, m15, S5). The owner answered the audit's questions on 2026-10-20. The currency model itself is replaced by ADR 0007. Where this record and an amended ADR differ, this record wins.

## Decision

### Journal order (amends 0005; audit M4)
- **Entry numbers stay gapless per company and fiscal year, in posting order.**
- Every entry stores its **accounting date** (`entry_date`) and its **posting time** (`posted_at`).
- **The journal book is printed in `(entry_date, number)` order.** Its footer states the rule, so a back-dated entry appears at its date with its number. Back-dating is possible only inside open periods.
- **Basis:** the Commercial Code requires a chronological journal in Arabic, numbered and certified (Law 33/2007, arts. 16–19, REPORTED). Account names on the printed journal are Arabic.

### Hardened guards (amends 0005; audit M9)
- **`ENABLE ALWAYS` triggers.** Every guard trigger (`refuse_change()`, balance, reversal, open-item, period) is created with `ENABLE ALWAYS`, so that `session_replication_role = replica` cannot skip it. The convention test checks it.
- **The owner role never runs the application.** `mizan_owner` connects only to run migrations. The API, the worker, jobs, scripts and operators connect as `mizan_app`, `mizan_jobs` or `mizan_queue`. A table owner can disable its triggers, so the deployment checks that no runtime connection uses the owner role. The convention and invariant tests run as `mizan_app`.
- **One lock order:** the company ledger head first, then the period row. Posting takes the head exclusively and the period with a share lock. Closing and reopening take the head exclusively, then the period exclusively. So a close and a posting serialise without deadlock.
- **Deferred constraint triggers** are `AFTER … FOR EACH ROW` and check the whole entry idempotently, so the same check firing once per line gives the same answer.
- **External anchor of the integrity chain** (phase 1, F14). Every day the worker emails the owner the head hash of each company's chain with its entry count and date.
  - The integrity check report compares the chain with the anchors received.
  - With anchors, the claim is that no posted entry before the last anchor was altered. Without them, the chain only detects accidental or casual tampering, and the documents say so.
- **A CI check on migrations** fails on guard-weakening SQL: `DISABLE TRIGGER`, `DROP TRIGGER` or `DROP POLICY` on a guarded table, `NO FORCE ROW LEVEL SECURITY`, `ALTER … OWNER`, and `UPDATE` or `DELETE` on a ledger table. An intended exception needs a new ADR.
- **Posting is serialised per company.** This is fine at the expected volumes. For thousands of postings a day (phase 3 retail), a per-fiscal-year chain or batched posting is decided then.

### Invariants restated (amends 0005)
- **Invariant 1** reads: every entry balances in the book ledger and, when set, in the parallel ledger (ADR 0007), and has at least two lines. Rounding and exchange-difference lines follow ADR 0007.
- **Invariant 9** reads: open items never flip sign in their transaction amount, and **when an open item's transaction amount reaches zero, its book and parallel amounts are zero too**. Both are checked by a deferred trigger.

### Period balances (amends 0005; audit M10)
- A **period-balance table** `(company, period, account, dimension set, currency) → debit and credit per amount type` (transaction, book, parallel) is part of the ledger model from S03.
- **The posting function is its only writer,** in the posting transaction.
- **It is rebuildable** from the lines, and a property test checks that it always equals them.
- **Reports read it** for totals and the lines for detail.

### Scenario runner contract (amends 0005; audit M3)
- A scenario with `Status: Proposed` is skipped and reported, never counted as passing.
- The runner checks **the exact set of entries posted**: no missing and no extra entry or line. It also checks one audit row per posting and the open-item balances.
- **The book must cover the currency shapes of ADR 0007:**
  - an SYP book with no parallel;
  - an SYP book with a USD parallel;
  - a USD book with an SYP parallel;
  - a third currency.

  Each rule is tested in every shape it can occur in.

### API holds and tax lines (amends 0006; audit M5, M7, m5)
- **Every hold returns `202`** with `status: held`, a reason code and the inbox ID. **Only refusals that store nothing return `4xx`:** `IDEMPOTENCY_CONFLICT` and `SOURCE_NOT_ALLOWED` with `409`, and validation with `422`.
- **Hold reasons:**

  | Code | Meaning |
  |---|---|
  | `PERIOD_CLOSED` | The accounting date is inside a closed period |
  | `SERVICE_PERIOD_CLOSED` | A recognised service period falls in a closed period (late retainer invoice) |
  | `UNKNOWN_REFERENCE` | Retried automatically when the reference arrives |
  | `NO_MAPPING` | No posting rule maps the event yet |
  | `RATE_MISSING` | A ledger's policy rate is missing for the date (ADR 0007) |
  | `NEEDS_DECISION` | The accountant must decide the treatment |

  Hub stops retrying on any `202 held`.
- **Optional tax lines.** Invoice lines in `invoice.issued` accept an optional `taxes[]`, each with a tax code, the base, the rate and the amount in the invoice's currency. This is additive within `/v1`. Tax payable and consumption-fee accounts are added to both chart templates.
  - **Basis:** the Ministry of Finance is preparing to apply the new tax system from the start of 2027 (CONFIRMED, SANA, 2026-10-11). The draft requires an approved accounting program linked to the tax authority (REPORTED).
  - The inquiry about program approval opens in phase 1.
- **Revenue facts** (phase 1 scope §6):
  - `milestone.done` carries the milestone ID, the project, the installment amount and its currency, and the date the milestone was completed. That date is the revenue date of the milestone.
  - Invoice lines from a milestone carry the milestone ID.
  - Retainer credit lines carry the cycle they relate to.
- **Event names:** the names in ADR 0006 are the contract. `docs/product/phase-1-analysis.md` used Hub's internal names. The mapping is listed in the Hub event contracts in `packages/contracts`.

### Attachments (amends 0003; audit m15)
- Files attached to entries are stored under a company-scoped path.
- They are served only through an endpoint that checks the company context and the permission.
- Each has a size limit and a type allow-list (PDF and images).
- Their metadata row is a company table under forced RLS.

### Versions (amends 0002; audit m13)
Decided by the owner, 2026-10-20:
- **PostgreSQL 17**, the same cluster version as Hub on the shared server, supported to 2029.
- **Node 24**, maintenance LTS to 2028.
- **TypeScript is pinned to ~6.0 on purpose,** until the NestJS ecosystem supports TypeScript 7.
- **Drizzle 1.0** changes the migrations layout. If the scaffold adopts it, the deny rules on `migrations/meta/` and the drift check are updated in the same PR.

### Backups (open question Q2)
- The deployment and backup ADR is written **before the first production deploy** (owner, 2026-10-20), not in phase 0.
- It covers point-in-time recovery, encrypted off-server copies, a restore drill that runs the integrity check on the restored copy, and RPO/RTO targets.
- **No real company data enters Mizan before it is in force.**

## Consequences
- S03's data model includes `posted_at`, the period-balance table and the hardened triggers from the start; nothing needs a migration of posted data later.
- The daily anchor needs outgoing email in phase 1: the worker sends it through the server's SMTP account, configured at deployment.
- Hub's side handles a single `202 held` path. Tax lines are optional until the tax law applies.
