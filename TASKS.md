# TASKS

Branch `claude/great-dirac-8isru1` · `/posting-rule reports/statement-presentation` (S10 "Scenarios", third item: rules 31–33 in the reports).

- [x] Understand: S10 rules 14, 17, 19, 31–33 and "Accounting treatment"; S09 rules 4, 5, 9, 16, 26–27; `reports/statement-presentation.md`; the format's status per file.
- [x] Write `docs/scenarios/reports/opening-presentation.md` (two cases, `Proposed`): `syp` through 2026 and 2027 (the opening column, a report from before the books start, the income statement's note, the balance sheet with `312002`, the journal book from entry 1); `syp-usd` (`312002` stated in the parallel ledger).
- [x] The owner's approval (2026-11-12) of the numbers and of four presentation decisions (a file of its own; a report from before the books start carries both marks; the income statement's note on every statement of the books start's year; `312002` a part of retained earnings in later years, `unclosed_years` classes 4–5 only).
- [x] The format: the marks `opening_entry`, `before_books_start`, `pre_opening_result_in_equity` and the balance sheet's `year_result_pre_opening` in `docs/scenarios/README.md` and `packages/scenarios/src/report-format.ts`, with a test in `src/book.test.ts`.
- [x] S10 "Scenarios" names the new file; `docs/ROADMAP.md` records the approval and its date; `packages/scenarios/CLAUDE.md`.
- [ ] `pnpm verify --e2e-all`, the `accountant-reviewer` and the `reviewer` in parallel; their findings fixed.
- [ ] The PR with auto-merge.
