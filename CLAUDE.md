@AGENTS.md

# Claude Code specifics

## Model and effort

- **Default:** Opus 5.5 at `medium` (`.claude/settings.json`); **`low`** for mechanical edits.
- **`xhigh`:** the ledger data model and its invariants.
- **`high`:** money and currencies; posting rules, revenue recognition and revaluation; periods; tenant isolation and access; the Hub API contract; specs.
- Set model and effort at session start. Don't switch models mid-session: it drops the prompt cache.
- If the same problem fails twice at `xhigh`, say so and suggest Fable 5.1 for that problem only.
- Don't write "think hard" or "step by step" in prompts or skills: effort controls depth.

## Delegation

- **`checker`** (Haiku 5.5): runs lint, typecheck, tests (property tests and the scenario book included), build and drift checks, and returns only the failures.
- **`reviewer`** (Opus 5.5, fresh context): reviews the branch against its spec and the rules. It covers isolation, access, the API contract, data, tests and spec coverage, and reports blocking issues only.
- **`accountant-reviewer`** (Opus 5.5, fresh context): reviews accounting correctness:
  - balanced entries with the right accounts and signs;
  - reversals only;
  - IFRS 15, IAS 21, IAS 1 and IAS 8;
  - rounding and allocation;
  - closed periods;
  - scenarios;
  - Syrian labels.

  It runs in parallel with `reviewer` on every change to the ledger, money, posting rules, periods, reports or the API contract.
- **`explorer`** (Sonnet 5.5): read-only searches across many files, the reference repositories or the web.
- Code is written by the main session on Opus 5.5, never by Sonnet or Haiku.

## Skills

- `/spec <id>`: interview the owner, then write `docs/specs/<id>-<name>.md`.
- `/posting-rule <name>`: add or change an accounting rule. The order is:
  1. the scenario with its expected entries;
  2. the owner's approval;
  3. the implementation;
  4. property tests;
  5. the `accountant-reviewer`.
- `/feature-slice <id>`: implement an approved spec layer by layer, committing at each passing gate, with both reviewers and the owner's acceptance, then open the PR.
- `/db-migration <change>`: change the schema with RLS and the ledger guards, generate and review the migration, and test it.

## Hooks

- Biome formats and lint-fixes every edited file; remaining problems come back to fix. It does nothing until dependencies are installed.
- A git guard refuses `git commit` on `main`, `git commit -a` or `.`, pushes to `main`, broad staging (`git add -A`, `.`, `./`, `:/`) and `--no-verify`.
- The two reviewers run Bash through a hook that allows only read-only git commands.
- At session start, a note shows the branch, uncommitted files and the open items of `TASKS.md`: continue from them.

## Context hygiene

- One spec PR or task per session. Suggest `/clear` when the owner moves to unrelated work.
- Don't load all of `docs/` up front. Read what the current task needs.
- Side questions go through the built-in `/btw` command.

## Compaction

When compacting, keep: the current spec or scenario and its path, files changed, failing checks with their exact commands, open decisions, and the state of `TASKS.md`.
