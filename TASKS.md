# TASKS

`/posting-rule currency/stale-revaluation` (S07, ADR 0016), branch `docs/stale-revaluation`.

- [x] Scenario `docs/scenarios/currency/stale-revaluation.md`: seven cases (`syp-usd` ×4, `syp`, `usd-syp`, `third`), `Proposed`
- [x] The format reads S07's `close` and `reopen` steps (`packages/scenarios/src/format.ts`, `run.ts`, `book.test.ts`, the README)
- [x] The owner's approval of the expected entries and outcomes, recorded in the file and `docs/ROADMAP.md`
- [ ] Reviewers (`accountant-reviewer`, `reviewer`) and `pnpm verify --e2e-all`; the PR with auto-merge
