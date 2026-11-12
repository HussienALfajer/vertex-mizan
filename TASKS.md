# TASKS

`/posting-rule reports/statement-presentation` (S09), branch `docs/s09-statement-presentation-scenario`.

- [x] Owner decisions 2026-11-12: C2's advance on `211003`, not a credit on `112001` (ADR 0013 invariant 9); the journal book holds 30 rows a page, each month on a new page
- [x] Scenario `docs/scenarios/reports/statement-presentation.md` (six cases, `Proposed`), the book's format (`reports`, `contracts`, a service's department, `service_department`) in `docs/scenarios/README.md`, S09's worked example corrected
- [x] Owner approval of the six cases' numbers (2026-11-12, in the session)
- [x] `packages/scenarios` reads the new format and the area `reports` (the cases stay `Proposed`, skipped)
- [x] `docs/ROADMAP.md` records the approval
- [ ] `pnpm verify --e2e-all`, the reviewers, the PR with auto-merge
