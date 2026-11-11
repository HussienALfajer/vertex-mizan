# TASKS

Branch `claude/amazing-babbage-0euxxs` · `/posting-rule currency/month-end-revaluation` (S07 "Scenarios").

- [x] Read S07, ADR 0007, ADR 0016, the scenario format and the template accounts
- [x] Write `docs/scenarios/currency/month-end-revaluation.md` (10 cases, `Status: Proposed`)
- [x] Add the `revalue` and `block` steps to the format (`docs/scenarios/README.md`, `packages/scenarios/src/format.ts`, `run.ts`, a test in `book.test.ts`); executors arrive with S07's feature slice
- [ ] The owner approves the expected entries of the 10 cases (or asks for changes)
- [ ] Record the approval and its date in the file and in `docs/ROADMAP.md`; the file stays `Proposed` until S07's slice brings the executors
- [ ] `pnpm verify --e2e-all`, `accountant-reviewer` and `reviewer` in parallel; fix blocking findings
- [ ] Open the PR with auto-merge, quoting the approval
