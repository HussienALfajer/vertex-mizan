# Testing

How the checks run, locally and in CI, and why. `AGENTS.md` holds the rules in short; this file explains them. The model is Vertex Hub's (its PR #172, 2026-10-26), adapted here before the web app and its E2E suite arrive. Measurements from 2026-10-26 are at the end.

## Where each check runs

Each check runs once, in the place where it is cheapest. The session checks what it changed; CI checks everything before a merge.

| When | What runs | Command | Time today |
|---|---|---|---|
| While writing | Biome on each edited file (hook), the test file you are working on | `pnpm verify <file>` | seconds |
| A layer's gate | That layer's test files, `pnpm typecheck` | `pnpm verify <files>` | under a minute |
| Before the PR, once | Lint; typecheck, test, build and the scenario book of every package (Turborepo replays the unchanged ones); the guards; the changed E2E specs | `pnpm verify` | under a minute, seconds when nothing changed |
| CI, before the merge | Everything, the whole E2E suite included (two shards) | — | a few minutes |

The whole E2E suite never runs in a session unless asked for (`pnpm verify --e2e-all`): CI runs it.

## `pnpm verify`

`scripts/verify.mjs`, from the repository root. The database tests and the scenario book need the database URLs of `.env` (`packages/db/CLAUDE.md`, "Local database").

- `pnpm verify`: Biome over the repository; `turbo run typecheck test build test:scenarios` (with `--continue`, so one failure does not hide the others); when `packages/db/src`, `packages/db/migrations` or `packages/contracts/src` changed, migration drift (`drizzle-kit generate` must write nothing) and the migration guard (`pnpm check:migrations`); the error-code guard against the merge base (`pnpm check:error-codes --base <base>`); when `apps/api` or `packages/contracts/src` changed, the OpenAPI guard against the merge base where oasdiff is installed (otherwise the summary says it was skipped; CI always runs it); the E2E specs the branch changed, against the built app. A migration that `drizzle-kit generate` writes fails the run as it fails CI: review it and commit it with the schema change.
- `pnpm verify <file>...`: only those test files, paths from the repository root. Vitest files run in their package after `turbo run build --filter=<package>^...` (a stale dependency `dist` gives failures that are not in the code). A path under `docs/scenarios/`, or `packages/scenarios/test/scenario-book.test.ts`, runs the scenario book with its own config. A spec under `apps/<app>/e2e/` runs with that app's Playwright after its build; `--grep "<title>"` picks tests of a spec.
- Changed files are those that differ from the merge base with `origin/main` (committed, uncommitted or new); `--base <ref>` compares with another ref. Changed E2E specs are any `apps/<app>/e2e/**/*.spec.ts` among them: an app that adds a Playwright suite there needs no change to the script.
- Output: the whole output of each step in `.verify/<step>.log` (git-ignored); the console and `.verify/summary.md` get only the summary: each step's result and time, the tasks Turborepo ran rather than replayed, the scenario book's counts (`Proposed` cases are skipped), each failure with its file and line, and the command that reruns only the failed files.
- Exit code 0 when everything passed, 1 when a check failed, 3 when it refused to start: another `pnpm verify` is running on the machine (lock file `vertex-mizan-verify.lock` in the temp folder; a lock left by a killed run expires after 30 minutes), a dev server is up (port 3300, the built API, 5173, Vite's dev server, or 4173, the web app's `vite preview`: the build replaces the `dist` it runs from, and Playwright would test a preview already listening there; `--allow-dev` overrides), or a file does not exist.

## Rules, and what enforces them

| Rule | Why | Enforced by |
|---|---|---|
| One test run at a time on the machine | Two runs share the CPU and the database server and fail each other's tests (timeouts) | The `test-guard` hook refuses a second run; the verify lock |
| Run once, read the log | Rerunning a suite to read its output again is the most common waste | `pnpm verify` keeps every log and prints the failures |
| Rerun only what failed | A full rerun after a one-file fix repeats passing tests | The summary prints the rerun command; Turborepo replays untouched packages |
| No edits while a check runs | The result no longer describes the code | Instructions (`CLAUDE.md`) |
| No whole E2E suite in a session | Minutes locally, timeouts under load; CI runs it on shards | The `test-guard` hook (`pnpm verify --e2e-all` to run it on purpose) |
| No `timeout` around a test run | A killed run proves nothing and gets run again | The `test-guard` hook |
| No checks while a dev server runs | The build replaces the `dist` it runs from | `pnpm verify` refuses |

The hook is `.claude/hooks/test-guard.mjs` (PreToolUse on Bash and PowerShell), tested by `packages/config/test/test-guard.test.ts`. Commands that run no tests pass straight through, and the text of a heredoc counts as data; for a test command it reads the verify lock and the running Node processes of this repository and its checkouts (one PowerShell call on Windows, about a second). It does not see other repositories' runs on the same machine.

## Test databases

- Every suite that needs a database creates its own throwaway one for the run, migrated, and drops it afterwards (`createTestDatabase()` in `packages/db/src/testing.ts`): `packages/db`, `apps/api`, `apps/worker` and the scenario book. Runs never share rows, so Turborepo runs them at the same time and no suite needs per-worker databases or an advisory lock. Keep it so: a new suite with a database gets its own from its global setup.
- `packages/db` runs one file at a time (`fileParallelism: false`): the files share the run's database, and the convention test alters the fixture tables inside transactions it rolls back, so its locks must never meet another file's.

## Vitest

- `packages/db` runs with `isolate: false`: its one worker keeps its modules from one file to the next instead of loading them again for each file. Each file opens and closes its own pools (`test/connections.ts`), so a test must leave nothing in module state; `test/restore-env.ts` puts `process.env` back after each file. A normal and a shuffled run (`--sequence.shuffle.files`) passed.
- The other packages keep isolation: turning it off saved them under a second each, within the noise. `packages/config` spends its time in the processes its tests start (git, Biome, the guards), not in loading modules.
- A suite that turns isolation off restores `process.env` after each file in its setup file, and is checked with a shuffled run first.

## E2E

The rules the web app's Playwright suite (`apps/web/e2e`, PR 8; `apps/web/CLAUDE.md`) follows:

- Traces are recorded on the first retry only (`trace: 'on-first-retry'`), and CI retries a failed test once, so the retry keeps its trace. Recording one for every test made Hub's suite 30% slower and kept the antivirus scanning each trace file. Debug locally with `--trace on`.
- Locally, only the changed specs run (`pnpm verify` picks them; `pnpm verify apps/web/e2e/<file>.spec.ts [--grep <title>]`). The whole suite runs in CI, split over parallel shards (`--shard`, with `fullyParallel`), behind the `Typecheck, lint, test, build` gate.
- A test that tours many screens sets `test.setTimeout(90_000)`; the default stays for the rest.
- The specs live under `apps/web/e2e/` with `playwright.config.ts` in `apps/web`, where `pnpm verify` finds them.

## CI

`.github/workflows/ci.yml` (`.github/CLAUDE.md`). A pull request that changes only Markdown outside `docs/scenarios/` and `brand/` skips the checks; the gate job still reports.

| Job | Runs |
|---|---|
| Changes | Decides whether the checks are needed |
| Lint, typecheck, build | Audit, Biome, typecheck, build, migration drift, the migration, error-code and OpenAPI guards |
| Tests | The database roles and migrations, every package's tests, the scenario book, the built API and worker starting |
| Playwright shard 1, 2 | The whole E2E suite of `apps/web` on its production build, split with `--shard` |
| Typecheck, lint, test, build | The gate the `main` ruleset requires, behind every job above |
| Secret scan | gitleaks |

Only E2E is split; each shard uploads its report and screenshots (`playwright-report-<n>`).

Turborepo's cache is kept between runs with `actions/cache`, per job. A pull request reads its own runs' cache and `main`'s; `main` cannot read a pull request's (GitHub keeps caches per branch), so after a merge `main` runs what the pull request changed once more.

### Remote cache

The workflow is ready for Turborepo's remote cache, which removes that repeat: `main` replays what its pull request ran, and a session can read what CI ran. It is off until the owner gives the repository:

1. A remote cache: Vercel's (a token from the Vercel account settings; check Vercel's current terms) or a self-hosted server that implements the same API (for example `ducktors/turborepo-remote-cache`; then set the variable `TURBO_API` to its URL).
2. Repository secrets `TURBO_TOKEN` and `TURBO_REMOTE_CACHE_SIGNATURE_KEY` (a long random string; `turbo.json` has `remoteCache.signature`, so artifacts are signed and checked), and the repository variable `TURBO_TEAM` (the team slug).

Only the jobs that run turbo (static, `Tests`, the Playwright shards) get these values. Pull requests from forks and from Dependabot get no secrets and keep the per-job cache.

## The local machine (Windows)

- **Other repositories.** The owner's other repositories run their suites on the same machine and the same Docker host. While Vertex Digital's Playwright suite and Vertex Shifa's api suite ran (CPU at 99%), this repository's suites took three to four times longer, and `packages/config` tests that start processes passed their 5-second timeout. The test guard sees only this repository's runs: compare timings only on a quiet machine, and treat a timeout under such load as load, not as a failing test.
- **Antivirus.** In Hub, Microsoft Defender scanned every file the tests read and wrote (4.2 CPU cores during E2E with traces on). A [Dev Drive](https://blogs.windows.com/windowsdeveloper/2023/06/01/dev-drive-performance-security-and-control-for-developers/) (ReFS, with Defender's performance mode) for the repositories and the pnpm store removes most of that; excluding the folders is the weaker alternative. Both are the owner's choice, set by hand.
- **Dev servers.** Stop them before `pnpm verify`.

## Measurements (2026-10-26)

Local: Intel i9-14900HX (24 cores, 32 threads), 32 GB, NVMe, Windows 11, PostgreSQL 17 in Docker. Other repositories' suites ran on the machine during part of the runs, so each figure is the best of two or more runs; single runs under that load were up to four times slower in both columns.

| | Before | After |
|---|---|---|
| `pnpm test`, nothing cached (`--force`) | 22.4 s | 23.5 s (the new hook test added to `packages/config`) |
| `pnpm test`, everything cached | 0.6 s | 0.7 s |
| `pnpm test:scenarios`, nothing cached | 4.5 s | 5.0 s |
| `packages/db` suite (6 files, 130 tests), Vitest's Duration | 19.5–20.2 s, 15% loading modules | 16.6–18.9 s, 3% (isolation off) |
| `apps/api` (3 files) · `apps/worker` (2 files) | 2.2 s · 4.9 s | unchanged (isolation kept) |
| The scenario book alone | 1.9 s | 2.0 s |
| `pnpm verify` with nothing changed since the last run | — | 20 s (lint, every task replayed but the typechecks, the guards) |

Nothing here is slow yet: CI takes under a minute. The point of this change is the model, set before the web app and its E2E suite arrive.
