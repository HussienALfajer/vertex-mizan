# TASKS

Branch `claude/gallant-allen-oldms7` · `/posting-rule opening/opening-entry` (S10 "Scenarios", first file).

- [x] Understand: S10 rules 3, 11–13, 17–19, 23–25, "Accounting treatment", the worked example; scope §4 and F12.
- [x] Write `docs/scenarios/opening/opening-entry.md` (seven cases, `Proposed`) and the format's `books_start`, `opening` and `reverse_opening` in `docs/scenarios/README.md`.
- [ ] The owner's approval of the seven cases' numbers, and the answer on a company without Hub opening receivables on `112001` (S10 rule 12).
- [ ] `packages/scenarios/src/format.ts`: read `books_start`, the `opening` and `reverse_opening` steps (no executor until S10's feature slice), with a test in `src/book.test.ts`; `packages/scenarios/CLAUDE.md`.
- [ ] `docs/ROADMAP.md`: the approval and its date under S10.
- [ ] `pnpm verify --e2e-all`, the `accountant-reviewer` and the `reviewer` in parallel; fixes; the PR with auto-merge.
