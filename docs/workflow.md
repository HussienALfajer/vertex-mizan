# Working method

How Vertex Mizan is built with Claude Code (Opus 5.5). `AGENTS.md` holds the rules agents follow; this file explains the method for the owner and for agents that need detail. It is Vertex Food's method (`D:\vertex-food\docs\workflow.md`), adapted for an accounting system, as approved in `docs/research/working-method.md` (2026-10-20).

## Why it works this way

- **Context is the scarcest resource.** Every turn resends the whole conversation, and quality drops as context fills.
- **Cost ≈ turns × context size.** Effort is the main cost lever: Opus 5.5 at `medium` matches Opus 5 at `high` on real-repo coding.
- **Verification enables autonomy.** With a check it can run, the agent iterates until the check passes. In accounting the check is a solved example: the scenario book.
- **A wrong accounting rule passes every code test.** Only the owner or an accountant catches it, so accounting rules start as numbers the owner approves, and a second reviewer reads every accounting change as an accountant.
- **Rules as code first.** Every rule a machine can check lives in the database, a test, a lint rule or a hook. Prose holds only what needs judgement.
- **Knowledge lives in files, not chat.** Sessions, accounts and tools change; the repository stays.

## The feature cycle

The unit of work is a spec from `docs/ROADMAP.md`. Each session ends with a merged PR and `/clear`, so the next one starts from files and git. Set the model and effort before the first message.

| # | Session | Model and effort | First message | The owner | Ends with |
|---|---|---|---|---|---|
| 1 | Spec | Opus 5.5, `high` | `/spec <id>` | Answers the interview; approves the spec | The spec's PR (`docs/<id>-spec`) |
| 2 | Scenarios | Opus 5.5, `high` | `/posting-rule <rule>` (one per rule the spec lists; several per session if small) | Approves the expected entries, in numbers | Scenario PRs, merged after the owner's approval |
| 3 | Backend PR | Opus 5.5, `xhigh` for the ledger model and invariants, `high` for money, postings, periods, isolation and the API; else `medium` | `/feature-slice <id>` | Approves the PR split and `TASKS.md`; reviews a worked example | PR 1 (contracts, ledger, db, api, worker) |
| 4 | Front-end PR | Opus 5.5, `medium` | `/feature-slice <id>` | Runs the acceptance steps in the app | PR 2 (screens and E2E); `docs/ROADMAP.md` updated |
| 5 | Deploy (once per phase) | Opus 5.5, `low` | `Deploy phase <n> to production` | Approves the deploy; checks the live system | Deploy done, ticked in `docs/ROADMAP.md` |

- A small spec does sessions 3 and 4 in one PR.
- **Each layer is committed when its gate passes,** so a crash or a wrong `/rewind` never loses a PR.
- `TASKS.md` is committed (owner, 2026-10-28: sessions also run in the cloud): `/feature-slice` writes the spec's checklist into it and commits it with each layer, and the spec's last PR resets it to "No task in progress". One spec at a time, so two branches never edit it.
- After each merge the owner runs the cleanup line from the report, then `/clear`.

## What waits for the owner before auto-merge

Any PR that changes:
- the phase scope or an ADR;
- a ledger invariant or the money module;
- a posting, recognition, revaluation or settlement rule;
- an expected value in the scenario book.

Exception (owner, 2026-10-20): a PR that only writes down decisions the owner has just given in the conversation merges at once. The owner's answers are the approval, and the PR body quotes them. Anything in such a PR that the owner was not asked about makes it wait.

Everything else merges automatically once CI passes.

## Two reviewers on accounting work

| Reviewer | Looks for |
|---|---|
| `reviewer` | Company isolation, access, the database guards of the ledger, idempotency and the API contract, spec coverage, tests |
| `accountant-reviewer` | Balanced entries with the right accounts and signs, reversals, IFRS 15, IAS 21, IAS 1 and IAS 8, rounding and allocation, closed periods, the scenarios' numbers, Syrian labels |

They run in parallel, in fresh contexts, and report blocking findings only. The accountant reviewer gives a numeric example for every finding.

## Parallel sessions

After a spec's backend PR is merged, its screens can be built in a separate session. Two sessions never edit the same files. Shared packages (`contracts`, `ledger`, `db`, `ui`) change only in the backend PR or in one session at a time. Hub's side of the integration is built in Hub's own sessions against ADR 0006.

## Cloud sessions

Claude Code cloud sessions run in the shared cloud environment `vertex`, which this repository does not configure. It provides Node 24 (the default), Corepack with pnpm 12, Docker with the `postgres:17` and `axllent/mailpit` images, Playwright Chromium in `/opt/ms-playwright`, full network access, and the command `vertex-session [repo-dir]`.

- **Setup.** A SessionStart hook runs `scripts/cloud-session.sh`. It does nothing outside the cloud (`CLAUDE_CODE_REMOTE` is not `true`); in `vertex` it runs `vertex-session "$CLAUDE_PROJECT_DIR"`, which starts PostgreSQL 17 and Mailpit (SMTP 1025, inbox 8025), runs `pnpm install --frozen-lockfile`, creates `.env` from `.env.example` if it is missing, runs `pnpm db:setup-local` and `pnpm db:migrate`, and installs the web app's Chromium. It prints `Vertex cloud session ready: …` and any problems; the full log is `/tmp/vertex-session.log`. It always exits 0, so read its output before relying on the database.
- **Port.** `compose.yaml` is not used in the cloud. PostgreSQL listens on `127.0.0.1:5432` (superuser `postgres`/`postgres`) instead of `55417`: `vertex-session` rewrites the port in every URL of `.env`, sets the admin password, and generates `AUTH_SECRET` when it still has the example value. Everything else reads `.env` as it does locally.
- **Several repositories.** A session with more than one repository does not run repository hooks: run `vertex-session <path-to-vertex-mizan>` yourself before the first check.
- **OpenAPI guard.** `pnpm check:openapi` needs oasdiff: `RUNNER_TEMP=$HOME/.tools bash scripts/install-oasdiff.sh`, then `export OASDIFF=$HOME/.tools/oasdiff/oasdiff`.
- **Reference repositories.** `D:\vertex-hub`, `D:\vertex-food`, `D:\vertex-shifa` and `D:\vertex-digital` (`AGENTS.md`, `.claude/settings.json`) are not in the cloud. Add the ones a task needs to the session; they stay read-only.
- **Pull requests.** `gh pr create` is refused in the cloud (GitHub's GraphQL API is blocked): push the branch and open the PR with the Create PR button.
- **What stays local.** Real secrets (the cloud `.env` holds only generated and example values) and the owner's manual acceptance test in the running app.

## How the instructions are layered

| Layer | Files | Loaded |
|---|---|---|
| Owner's personal preferences | `~/.claude/CLAUDE.md` (language) | Every session |
| Project rules | `AGENTS.md`, `CLAUDE.md` (imports `AGENTS.md`), under 200 lines together | Every session |
| Folder rules | `<app or package>/CLAUDE.md` | When the agent reads a file in that folder |
| Product, decisions, scenarios | `docs/product/`, `docs/decisions/`, `docs/specs/`, `docs/scenarios/`, `docs/glossary.md` | On demand |
| Workflows | `.claude/skills/`: `spec`, `posting-rule`, `feature-slice`, `db-migration` | When invoked |
| Subagents | `.claude/agents/`: `checker` (Haiku 5.5, runs `pnpm verify` and returns its summary), `reviewer` and `accountant-reviewer` (Opus 5.5), `explorer` (Sonnet 5.5) | In their own context; only their summary returns |
| Enforcement | Database guards, hooks (Biome, git guard, test guard, session start, cloud session setup, read-only git for reviewers), convention, invariant and property tests, the scenario book, the migration guard check, CI, gitleaks | Always, without costing context |
| Guard rails | `.claude/settings.json`: model and effort, permissions, denied reads, read-only references | Always |

## Models and effort by task

| Task | Model | Effort |
|---|---|---|
| The ledger data model and its invariants | Opus 5.5 | `xhigh` |
| Money, posting rules, recognition, revaluation, periods, isolation and access, the Hub API, specs, scenarios | Opus 5.5 | `high` |
| A clearly specified feature outside those areas, screens | Opus 5.5 | `medium` |
| Deploys, mechanical edits | Opus 5.5 | `low` |
| Searching code, docs, standards or the web | `explorer` (Sonnet 5.5) | — |
| Running a long `pnpm verify` while other work goes on (the reviewers) | `checker` (Haiku 5.5) | — |
| A problem that failed twice at `xhigh` | Fable 5.1, for that problem only | — |

Sonnet and Haiku never write code.

## Session habits

1. Set model, effort and connectors at session start; don't change them mid-session.
2. `/clear` between unrelated tasks (`/rename` first if you may come back).
3. `/compact <what to keep>` at natural breaks; `/rewind` to abandon a failed path.
4. After two failed corrections on the same issue, `/clear` and start again with a better request.
5. Side questions: the built-in `/btw` command.
6. Run checks with `pnpm verify` (`docs/testing.md`): it prints a short summary and keeps the whole output in `.verify/`, so long output never enters the context. Delegate a long run to the `checker` when the reviewers run meanwhile, never edits.
7. Prune the instruction files once per phase.

## What changed from Vertex Food

- The `accountant-reviewer` subagent and the `/posting-rule` skill.
- The scenario book: accounting rules start as owner-approved numbers that run as tests.
- Wider owner approval before auto-merge (invariants, money, posting rules, expected values). It is a written rule, not enforced by GitHub (owner, 2026-10-20).
- Ledger invariants enforced by the database and checked by a convention test; a hash chain over posted entries.
- Property tests (fast-check) for the core.
- Confirmation labels for Syrian law and tax in every document.
- Four read-only reference repositories instead of one.
- Cloud-session scripts with a disposable database (from Hub) arrive with the application code.
