# Full audit of the repository, 2026-10-28

An external read-only audit (GPT 6.1 sol, prompted by the owner) of `main` at `9ee7a1c`, covering PRs #1–#38: backend, frontend, database, UI/UX, tests, documentation and process. The owner passed the report to Claude Code, which checked each finding against the code before fixing it.

## Verdict

The accounting and engineering foundation holds: no numeric error was found in conversion, rounding, allocation or the worked examples; no cross-company read path; lint, typecheck, 604 pure tests, 220 E2E tests, the migration, error-code and OpenAPI guards, gitleaks over the whole history and the dependency audit pass. Seven findings, none critical; the four major ones were to be fixed before S03.

## Findings and their resolution

| ID | Severity | Finding | Checked | Resolution |
|---|---|---|---|---|
| SEC-01 | Major | A refused replay of an authenticator code at re-authentication released the earlier claim, so a third try accepted the code (S01 "Code replay") | Confirmed in `account.service.ts`; the sign-in path releases only its own claim | Released only when this request made the claim; test of use, refused replay, refused third try |
| BE-01 | Major | Page cursors carried `created_at` through a JavaScript `Date`, losing microseconds, so rows of the same millisecond across a page boundary were skipped (audit log, sign-ins, rates, dimension values) | Confirmed: all four lists | The cursor names the row; `afterCursor` compares `(created_at, id)` with the row's own values in the database; test with 101 rows at one microsecond |
| BE-02 | Major | Entering a company updated the session and wrote `session.company_entered` in two transactions (ADR 0005, S01 rule 20) | Confirmed in `me.service.ts` | One transaction |
| BE-03 | Major | Turning an unused postable account with required dimensions into a header failed: the account changed before its dimensions were archived, and the database guard refused it (S02 rule 3) | Confirmed against `chart_account_rules()` | Dropped dimensions are archived before the account changes, added ones inserted after; test of header and back |
| SEC-02 | Minor | Failed password steps for a person's address were logged without the person, so their security page never showed them (S01 rule 26) | Confirmed | `GET /api/me/sign-ins` adds the failed sign-ins logged with the person's address; test that another address's failures stay out |
| FE-01 | Minor | The bulletin status of the last 30 days read only the first page of rates, so corrections could push a recorded day out and show it missing (S02 `/rates`) | Confirmed | The status reads every page before judging a day; E2E test with two pages |
| UX-01 | Minor | No error summary takes focus on a refused submit (ADR 0010 §"Errors") | Confirmed: no such component in `packages/ui` | `ErrorSummary` in `packages/ui` (focus at each refused submit, a link per field) and `FormErrorSummary` on every form that checks its fields on submit; the current password of the security page now shows its error beside the field too; unit, design-system and form E2E tests |

The previous audit's status (`2026-10-foundation-audit.md`) was rechecked by the auditor: every item is fixed, decided or deferred by an owner decision, as the roadmap states.
