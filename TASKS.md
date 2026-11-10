# TASKS

Branch `claude/funny-ramanujan-6g5rya`: `/posting-rule revenue/cancelled-project` (S06 rules 15–18).

- [x] Scenario `docs/scenarios/revenue/cancelled-project.md`, nine cases, written and shown to the owner (2026-11-10)
- [ ] The owner's approval of the numbers and the three readings (refund line with client and project; one refund line, per-schedule debit and revenue lines; the `split` step)
- [ ] The owner's answers: Q-a, a cancellation with a remainder and no rate of `on` held `RATE_MISSING` first (recommended) or `NEEDS_DECISION` with the rate read only for a refund part; Q-b, the void of an invoice whose schedule was split held `NEEDS_DECISION` `schedule_split_at_cancellation` (recommended) or reversing the whole split
- [ ] The scenario format's `split` step (`docs/scenarios/README.md`, `packages/scenarios/src/format.ts`, a test in `src/book.test.ts`); until then the file does not parse, so no PR before it
- [ ] `cancelledProjectSplit()` in `packages/ledger` with its properties (balanced in both ledgers, the revenue cut exact, netting to zero with its reversal, a replay posting nothing new)
- [ ] Open question: a reopened cancelled project (Hub F05 allows it; Mizan has no event)
- [ ] Checks, reviewers, `docs/ROADMAP.md`, the PR with the approval quoted
