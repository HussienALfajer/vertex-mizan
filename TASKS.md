# TASKS

Branch `claude/ecstatic-archimedes-a2k8rk` · `/posting-rule opening/before-books-start` (S10 "Scenarios", second file).

- [x] Understand: S10 rules 4, 5, 27–30 and "Accounting treatment"; S05 rules 8, 11, 15, 16; S06 rules 8, 10; S04 rules 2, 4, 8, 10.
- [x] The owner's decision (2026-11-12): a held void of an opening invoice is resolved by a manual entry whose contract liability line names the opening schedule (`schedule:`), cleared at its carried amounts; the schedule releases nothing while the void is held. Written into S10 rule 28 and the format.
- [x] Write `docs/scenarios/opening/before-books-start.md` (five cases, `Proposed`), the format's `prior_documents` and manual `schedule` in `docs/scenarios/README.md`, `packages/scenarios/src/format.ts` reading the register, with a test in `src/book.test.ts`.
- [x] The owner's approval of the five cases' numbers (2026-11-12).
- [x] `docs/ROADMAP.md`: the approval and its date under S10; `packages/scenarios/CLAUDE.md`.
- [ ] `pnpm verify --e2e-all`, the `accountant-reviewer` and the `reviewer` in parallel; their findings fixed; the PR with auto-merge.
