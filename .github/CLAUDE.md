# .github

CI for every pull request and for `main` (`workflows/ci.yml`), and Dependabot for the pinned actions. Copied from Vertex Food's `.github` and adapted.

## Rules
- Third-party actions are pinned to a full commit SHA with the tag in a comment; Dependabot proposes updates.
- The job names `Typecheck, lint, test, build` and `Secret scan` are the checks the `main: require CI` ruleset requires (added 2026-10-20 with the owner's approval). Renaming or splitting a job means updating the ruleset in the same PR, with the owner's approval. New jobs sit behind the `Typecheck, lint, test, build` gate (its `needs`), so the ruleset does not change.
- A step arrives with its first subject: the scenario book with its runner, the OpenAPI check with `apps/api`, E2E with `apps/web`.
- The scenario book: the `Tests` job runs `pnpm test:scenarios` after `pnpm test`, on the same PostgreSQL service; the runner creates its own database.
- `packages/db`: the `Tests` job runs a PostgreSQL 17 service (fake passwords that exist only for the job), `pnpm db:setup-local` and `pnpm db:migrate` before `pnpm test`; the database tests create their own database per run. The static job checks migration drift: `pnpm db:generate` must leave `packages/db/migrations` unchanged.
- `pnpm audit --prod` accepts only advisories listed with a reason in `pnpm-workspace.yaml` (`auditConfig.ignoreGhsas`); none is listed today.
- The migration guard (`pnpm check:migrations`, ADR 0008) runs in the static job over `packages/db/migrations/*.sql`, with the table registry of `packages/db`.
- The error-code guard (`pnpm check:error-codes`, ADR 0006) runs in the static job against the pull request's base commit (the push's previous commit on `main`), so the static checkout fetches the full history.
- Pull requests that change only Markdown skip the checks; the gate job still reports, so the ruleset and auto-merge work. The scenario book (`docs/scenarios/`) is executed as tests, and `brand/` is read by the token tests, so a change in either runs the checks.
- CI runs the same root commands as the `AGENTS.md` commands table; a new check gets a root script first, then a step here.
- No secrets in workflows beyond `GITHUB_TOKEN`; deploys never run from CI without an ADR.
