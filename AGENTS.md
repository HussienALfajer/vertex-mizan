# Vertex Mizan

A professional multi-company accounting system by Vertex, Arabic-first. A permanent double-entry core (chart of accounts, journal entries, currencies with stored rates, dimensions, period close, statements), optional business modules per company, and an integration layer through which other systems post to the ledger exactly once. Vertex Media is company 1 and the design partner; Vertex Hub posts its financial events here.

Phase 1 goal: Vertex Media's books are kept in Mizan, fed by Vertex Hub (`docs/product/phase-1-scope.md`). **Accuracy comes before everything: this is an accounting system.**

Standing read-only references (owner, 2026-10-20), **read, never edit**: `D:\vertex-hub` (the integration counterpart, Hub ADRs 0006 and 0035, and the stack), `D:\vertex-food` and `D:\vertex-shifa` (tenancy, workflow and code patterns), `D:\vertex-digital` (its ledger pattern). Copy and adapt; never import across repositories.

## Source of truth

| File | Purpose |
|---|---|
| `docs/product/vision-and-phases.md` | The product, its layers and four phases |
| `docs/product/phase-1-scope.md` | What phase 1 includes (F01–F14), the accounting policies and the treatment of each Hub event. Anything not in it is out of scope: ask before adding. |
| `docs/decisions/` | ADRs, indexed in its `README.md`. Follow them; propose a new ADR to change one. 0002 stack, 0003 tenancy and access, 0005 and 0008 ledger invariants, 0006 and 0008 the Hub API, 0007 money (book and parallel ledgers; it supersedes 0004), 0009 and 0010 the brand and design system, 0011 the chart, dimensions and bulletin rate. |
| `docs/scenarios/` | The scenario book: one solved example per accounting rule, executed as a test (ADR 0005) |
| `docs/glossary.md` | Accounting terms in Arabic and English. Name code after the English term. |
| `docs/ROADMAP.md` | Phase and task status. Update it when an item is done. |
| `docs/specs/<id>-<name>.md` | Detailed spec per feature group, written before implementation |
| `docs/open-questions.md` | Unresolved decisions. Never guess an answer to one: ask. |
| `docs/research/` · `docs/audits/` | Market, legal and currency research with confidence labels; the approved working method · audits of the repository, kept as history |
| `docs/workflow.md` | How work is run with Claude Code, locally and in cloud sessions |
| `docs/testing.md` | How checks run: `pnpm verify`, what runs locally and what in CI, the test databases, the E2E rules, the measurements |
| `<app or package>/CLAUDE.md` | Local rules and the pattern to copy; each arrives with its folder |

Read these on demand. For a feature, read its spec, the ADRs it lists and its section of the scope.

## Stack (ADR 0002)

pnpm workspaces + Turborepo · TypeScript ~6.0 strict, ESM · Node 24 · PostgreSQL 17 with forced RLS · package scope `@vertex-mizan/*`.
- `apps/api` NestJS 12 · `apps/worker` NestJS + pg-boss · `apps/web` React + Vite + TanStack
- `packages/contracts` (Zod, money module, error codes, Hub event contracts) · `ledger` (pure accounting logic, no I/O) · `db` (schema, roles, company context, the posting function) · `scenarios` (the scenario-book runner) · `ui` · `tokens` · `i18n` · `config`

## Commands

The PR that adds a command adds it here and keeps it true. Run from the repository root (pnpm 12.14.0, Node 24).

| Command | Does |
|---|---|
| `pnpm lint` · `pnpm lint:fix` | Biome check of the repository · apply its fixes |
| `pnpm verify` · `pnpm verify <file>...` | Each check once: lint; typecheck, test, build and the scenario book (Turborepo replays unchanged packages); migration drift and guard when the schema's sources changed; the error-code guard; the OpenAPI guard when the API changed; the dependency audit; the secret scan; the changed E2E specs (`--e2e-all`: the whole suite). Summary on the console, logs in `.verify/` (`docs/testing.md`) · only some test files (paths from the root; a `docs/scenarios/` file runs the book; `--grep <title>` picks tests by title). Needs the local database below |
| `pnpm typecheck` · `pnpm test` · `pnpm build` | Every package through Turborepo; one package: `pnpm --filter @vertex-mizan/<name> test`. The `db` tests need the local database below |
| `pnpm test:scenarios` | The scenario book on a fresh test database: `Approved` cases run, `Proposed` ones are skipped and listed (`packages/scenarios/CLAUDE.md`); needs the local database below |
| `docker compose up -d` | The local PostgreSQL 17 (`compose.yaml`, `127.0.0.1:55417`) and Mailpit, which catches the worker's emails (inbox at `http://127.0.0.1:8025`); copy `.env.example` to `.env` first and set your own `AUTH_SECRET` |
| `pnpm db:setup-local` · `pnpm db:migrate` | Create or update the four database roles and the development database · apply the migrations to it as the owner (`packages/db/CLAUDE.md`) |
| `pnpm db:generate` | Generate a migration from the Drizzle schema; run again, it must report nothing (the CI drift check) |
| `pnpm check:migrations` | The migration guard: refuses guard-weakening SQL in `packages/db/migrations`, and changes to the append-only tables of the registry (ADR 0008) |
| `pnpm check:error-codes` | The error-code guard: the codes in `packages/contracts` at `origin/main` (or `--base <ref>`) are still first, in order, with their status (ADR 0006) |
| `pnpm check:openapi` | The OpenAPI guard: `apps/api/openapi.json` has no breaking change against `origin/main` (or `--base <ref>`), through the pinned oasdiff (ADR 0006). The test of `apps/api` keeps the file equal to the API: regenerate with `pnpm --filter @vertex-mizan/api test -u` |
| `node scripts/tools.mjs install` | Download the pinned oasdiff and gitleaks into `.tools/` (git-ignored), checked by SHA-256; `pnpm verify` and CI install them on first use |
| `pnpm check:boot` | Starts the built API and worker as a server does and checks `/api/health` answers 200 and the worker schedules its jobs; after `pnpm build` and `pnpm db:migrate` |
| `pnpm --filter @vertex-mizan/api start` · `pnpm --filter @vertex-mizan/worker start` | Run the built API (`127.0.0.1:3300`, Swagger UI at `/api/docs` outside production) or the worker with the root `.env` |
| `pnpm --filter @vertex-mizan/api admin:create-company --name <name> --policy-note <text> --owner-email <email>` · `… admin:reset-two-factor --email <email> --reason <text>` | Server commands, after `pnpm build`, as the app role (no `--` before the options: pnpm passes it on, and the command then refuses them as positional): a company with Vertex Media's ledgers and the service-agency chart by default (`--book-currency`, `--parallel-currency`, `--no-parallel`, `--template general\|none`, … in `apps/api/src/admin/commands.ts`) and the emailed invitation of its first owner · a person's two-factor reset by Vertex (S01 rules 9, 21) |
| `pnpm --filter @vertex-mizan/web dev` | The web app on `127.0.0.1:5173` (Vite), `/api` proxied to the API; the design-system page at `/design-system`. Stop it before `pnpm verify` |
| `pnpm test:e2e [--shard=<n>/<total>]` | CI only: every app's whole Playwright suite after its build, through Turborepo (arguments go to Playwright); the test guard refuses it in a session |
| `pnpm verify apps/web/e2e/<file>.spec.ts` · `pnpm verify --e2e-all` | Playwright specs on the web app's production build (`apps/web/CLAUDE.md`) · every check with the whole suite, the check before a PR. Needs Chromium once: `pnpm --filter @vertex-mizan/web exec playwright install chromium` |

## Non-negotiable conventions

- **Ledger invariants (ADR 0005):**
  - every entry balances in the book ledger and in the parallel ledger;
  - posted entries are append-only, and corrections are reversals;
  - nothing posts into a closed period;
  - nothing posts twice;
  - the audit log is append-only, written in the same transaction;
  - the posting function in `packages/db` is the only writer of the ledger.

  The database enforces each rule; never weaken a trigger, grant or constraint to make code pass.
- **Money (ADR 0007):**
  - integer minor units with an ISO code, and no floats anywhere;
  - rates stored as quoted, never inverted, with a rate policy per ledger;
  - three amounts on every line: transaction, book and parallel, each ledger with its own exchange differences;
  - conversions round half away from zero, through the one money module;
  - allocations use cumulative rounding.
- **Company isolation (ADR 0003):** every company table has `company_id` and forced RLS; the company context comes from the session or the API key, never from input; company foreign keys are composite. A cross-company read is a security incident.
- **Accounting rules start as scenarios:** a posting, recognition, revaluation or settlement rule is implemented only after its scenario in `docs/scenarios/` exists and the owner has approved its expected entries (`/posting-rule`).
- **Standards and law:** accounting treatment states its IFRS/IAS basis. A Syrian legal or tax rule carries CONFIRMED, REPORTED or UNVERIFIED; no code depends on an unconfirmed rule without a written owner decision. Never guess an accounting or business decision: ask, with a recommendation.
- **Hub API (ADR 0006):** `/v1` changes are additive only; every write is idempotent by key; error codes are stable and never reused.
- **One validation source:** Zod schemas in `packages/contracts`.
- **Authorization is server-side:** every endpoint declares its permission.
- **Audit; archive, don't delete.** Companies and used accounts are archived. Ledger data is kept at least 10 years.
- **Arabic-first RTL UI (ADR 0009, ADR 0010):** logical CSS, all text through i18n, Latin digits, design-system components only, responsive from 360 px. A screen that needs something the design system lacks gets it first as a general component in `packages/ui`, built for accounting work and tested, then uses it (ADR 0010 §7, `packages/ui/CLAUDE.md`). Amounts only through the Amount component (LTR-isolated, minus sign and negative color). SYP is labelled "الليرة السورية الجديدة" on printed output.
- **Public repository:** no secrets and no real company, client or financial data: synthetic data only.

## How to work

- Continue without asking when the next step needs no input from the owner. Put brief status notes in the same message as the next action.
- Stop and ask when:
  - a decision belongs to the owner: scope, accounting treatment, business rules, anything in `open-questions.md`;
  - a spec or scenario is ambiguous in a way that changes the numbers;
  - an action is destructive or outward-facing: deleting data, dropping tables, posting to a real company's books, force-push, production changes. Pushing a branch, opening its PR with auto-merge and Auto-fix, and migrating the local development database (synthetic data only) are routine steps, never a reason to ask.
- A task is done only when `pnpm verify --e2e-all` passes on its final state, CI is green and `TASKS.md` has no open items for it. Show the evidence (the verify summary) instead of asserting success.
- Fix root causes. Never silence a failing test, type error, lint rule or database guard.
- For multi-step work keep a checklist in `TASKS.md`. Commit each layer when its gate passes.
- Mark anything you could not confirm and say where you looked.
- Match the surrounding code: copy the pattern named in the folder's `CLAUDE.md`. No speculative code.

## Context economy

- Search before reading, then read only the relevant range.
- Never read generated or lock files: `pnpm-lock.yaml`, `**/migrations/meta/`, `routeTree.gen.ts`, `dist/`, `.turbo/`.
- Checks (`docs/testing.md`): while building, run only the tests you work on (`pnpm verify <file>`); before the PR, `pnpm verify --e2e-all` once (through the `checker` while the reviewers run), and again only after a change. Each check runs once: read its failures in the summary and in `.verify/`, never run a suite again to see its output, and rerun only the files that failed. One test run at a time, and no edits while it runs: the `test-guard` hook refuses a second run, the whole E2E suite and `timeout` around tests. CI runs everything.
- In replies, point to `path:line` instead of pasting files or diffs.

## Git

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- One branch per change, named by type (`feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `test/`); a session the app started on its own `claude/…` branch keeps it. Never commit to or push `main` (a hook refuses it).
- Stage files by path; never `git add -A` or `git add .` (a hook refuses it).
- Merge commits only: never squash or rebase-merge.

## Finishing a task: open the PR at once

Run these steps in one turn, without asking the owner (standing instruction, 2026-10-28). Stop and report at the first step that fails.

1. **Branch** is not `main`; `TASKS.md` has no open items for this PR.
2. **Docs:** update `docs/ROADMAP.md` and every doc the change made stale, including the commands table above.
3. **Secrets and data:** `git status` and `git diff --stat` show no `.env`, key or real data.
4. **Checks:** `pnpm verify --e2e-all` passes on the final tree: lint, typecheck, tests with properties, the scenario book, build, the migration, error-code and OpenAPI guards, the dependency audit, the secret scan and the whole E2E suite, as CI runs them. A green run on the same tree counts; after a fix run it again, and Turborepo replays what the fix did not touch. A PR that changes only Markdown outside `docs/scenarios/` and `brand/` runs no checks (CI skips them too).
5. **Review:** the reviewers have run as `CLAUDE.md` ("Delegation") says, in parallel with the checks, and their blocking findings are fixed.
6. **Commit:** intended files only; a Conventional Commit subject and a body with what and why, ending with the session's attribution line.
7. **Pull request:** `git push -u origin <branch>`, then `gh pr create --base main` with `## Summary` and `## Test plan`, ending with the attribution line, then `gh pr merge <number> --auto --merge`, then turn on the PR's Auto-fix in the desktop app. In a cloud session that refuses `gh pr create`, open the PR and its auto-merge through the app instead. If CI fails, read `gh run view <run-id> --log-failed`, fix the cause on the branch and push: auto-merge waits for green.
   - **Owner approval before the merge:** a PR that changes the scope, an ADR, a ledger invariant, the money module, a posting rule or an expected value in the scenario book merges only with the owner's approval. The approvals given in the conversation count (the spec, a scenario's numbers, a decision): quote them in the PR body and keep auto-merge on. Only a change of that kind the owner has not approved keeps auto-merge off, and the report asks for that approval.
8. **Report** in the format below.

## Reporting

End every substantial task with these sections, in this order:

1. **Needs from you** — decisions or approvals blocking progress, or "nothing". For a PR with screens, the acceptance steps the owner runs after the merge. End with the cleanup for after the merge: `cd D:\vertex-mizan; git switch main; git pull --ff-only; git branch -d <branch>`
2. **Changed** — what was built or modified.
3. **Verified** — checks run and their results.
4. **Found** — issues, risks or follow-ups.
5. **Next step** — always last:
   - the next task and why it comes next;
   - what it needs from the owner;
   - whether it needs a new session;
   - the model and effort to set;
   - the exact first message, in its own code block.

## Language

Talk to the owner in Arabic, including the report and its headings, with clear formatting. Write everything stored in the repository in English. UI text is Arabic, through i18n.
