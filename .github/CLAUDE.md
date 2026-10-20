# .github

CI for every pull request and for `main` (`workflows/ci.yml`), and Dependabot for the pinned actions. Copied from Vertex Food's `.github` and adapted.

## Rules
- Third-party actions are pinned to a full commit SHA with the tag in a comment; Dependabot proposes updates.
- The job names `Typecheck, lint, test, build` and `Secret scan` are the checks the `main: require CI` ruleset requires (added 2026-10-20 with the owner's approval). Renaming or splitting a job means updating the ruleset in the same PR, with the owner's approval. New jobs sit behind the `Typecheck, lint, test, build` gate (its `needs`), so the ruleset does not change.
- A step arrives with its first subject: the PostgreSQL service and migration drift with `packages/db`, the scenario book with its runner, the OpenAPI check with `apps/api`, E2E with `apps/web`.
- `pnpm audit --prod` accepts only advisories listed with a reason in `pnpm-workspace.yaml` (`auditConfig.ignoreGhsas`); none is listed today.
- The migration guard (`pnpm check:migrations`, ADR 0008) runs in the static job over `packages/db/migrations/*.sql`.
- Pull requests that change only Markdown skip the checks; the gate job still reports, so the ruleset and auto-merge work. The scenario book (`docs/scenarios/`) is executed as tests, so a change there runs the checks.
- CI runs the same root commands as the `AGENTS.md` commands table; a new check gets a root script first, then a step here.
- No secrets in workflows beyond `GITHUB_TOKEN`; deploys never run from CI without an ADR.
