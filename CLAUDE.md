@AGENTS.md

# Claude Code specifics

## Model and effort

- **Default:** Opus 5.5 at `medium` (`.claude/settings.json`); **`low`** for mechanical edits.
- **`xhigh`:** the ledger data model and its invariants.
- **`high`:** money and currencies; posting rules, revenue recognition and revaluation; periods; tenant isolation and access; the Hub API contract; specs and scenarios.
- Set model and effort at session start; don't switch models mid-session (it drops the prompt cache). `/spec` and `/posting-rule` run at `high`; the other skills keep the session's effort.
- If the same problem fails twice at `xhigh`, say so and suggest Fable 5.1 for that problem only.
- Don't write "think hard" or "step by step" in prompts or skills: effort controls depth.

## Delegation

- **`checker`** (Haiku 5.5): runs `pnpm verify` (the branch, or the test files you name) and returns its summary. Run verify yourself when you wait for it anyway; use the checker to keep a long run out of the context, as before a PR while the reviewers read the branch. Edit nothing while a check runs, and start no second one. Give a foreground run a Bash timeout of 600000 ms, or run it in the background and wait for its notification.
- **`reviewer`** (Opus 5.5, fresh context): isolation, access, ledger guards, the API contract, data, tests and spec coverage; blocking issues only. Runs on every PR that changes code. Launch it with `effort: medium` when the PR changes only screens (`apps/web`, `packages/ui`, `packages/i18n`, `packages/tokens`).
- **`accountant-reviewer`** (Opus 5.5, fresh context): accounting correctness (entries, signs, reversals, IFRS 15, IAS 21, IAS 1, IAS 8, rounding, closed periods, scenarios, Syrian labels). Runs in parallel with the `reviewer` when the diff touches `packages/ledger`, the money module, `docs/scenarios/`, posting, rate, period or report code in `packages/db`, `apps/api` or `apps/worker`, or the Hub API contract; not on screens alone.
- **Re-review:** after fixing findings, run each reviewer that had findings once more, on the fix commits only (`git diff <reviewed commit>..HEAD`) with its earlier findings. No further round unless that one finds a new blocking issue in the fixes.
- **`explorer`** (Sonnet 5.5): read-only searches across many files, the reference repositories or the web.
- Code is written by the main session on Opus 5.5, never by Sonnet or Haiku.

## Skills

- `/spec <id>`: interview the owner, then write `docs/specs/<id>-<name>.md`.
- `/posting-rule <name>`: the scenario with its expected entries, the owner's approval of the numbers, the implementation, property tests, then the reviewers.
- `/feature-slice <id>`: implement an approved spec layer by layer, committing at each passing gate, then both reviewers and the PR; the owner's acceptance test follows the merge.
- `/db-migration <change>`: change the schema with RLS and the ledger guards, generate and review the migration, and test it.

## Permissions and pull requests

- The owner grants full tool permissions (2026-10-27): the user settings run in `bypassPermissions`, and `.claude/settings.json` allows every tool with no `ask` rules, `.env` files included. Never stop to ask for permission to run a command, read or edit a file, migrate the local development database, push a branch or open a PR.
- **Standing instruction (owner, 2026-10-28):** every task ends, in the same turn, by opening its PR, enabling GitHub auto-merge and, in the desktop app, turning on the PR's Auto-fix ("Finishing a task" in `AGENTS.md`). Never ask the owner before any of these: the owner has asked for them for every task.
- What still stops work: the hooks (git guard, test guard), the `deny` rules (irreversible git and file deletion, generated files, the read-only reference repositories), and the owner's decisions under "How to work" in `AGENTS.md` (scope, accounting treatment, business rules). Those are decisions, not permissions.
- `.env` holds local secrets: read and edit it when a task needs it, but never print its values, commit it or copy them into another file.

## Hooks

- Biome formats and lint-fixes every edited file; remaining problems come back to fix. It does nothing until dependencies are installed.
- The test guard and the git guard run on both Bash and PowerShell. The test guard refuses a second test run while one is going (a `pnpm verify` lock or a Vitest or Playwright process of this repository), the whole E2E suite outside `pnpm verify --e2e-all`, and `timeout` around a test run (`docs/testing.md`). The git guard refuses `git commit` on `main`, `git commit -a` or paths, pushes to `main`, broad staging (`git add -A`, `.`, `./`, `:/`) and `--no-verify`.
- The two reviewers run Bash through a hook that allows only read-only git commands.
- At session start, a note shows the branch, uncommitted files and the open items of `TASKS.md`: continue from them.

## Context hygiene

- One spec PR or task per session. Suggest `/clear` when the owner moves to unrelated work.
- Don't load all of `docs/` up front. Read what the current task needs.
- Side questions go through the built-in `/btw` command.

When compacting, keep: the current spec or scenario and its path, files changed, failing checks with their exact commands, open decisions, and the state of `TASKS.md`.
