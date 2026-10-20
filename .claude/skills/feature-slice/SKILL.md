---
name: feature-slice
description: Implement an approved spec end to end, layer by layer (contracts → ledger → db → api/worker → bridge → web → E2E), with a check gate and a commit after each layer, the reviewer and the accountant-reviewer, the owner's acceptance, then the PR with auto-merge. The implement step of the feature cycle, after /spec and the spec's /posting-rule scenarios.
argument-hint: <spec id or path, e.g. S03>
disable-model-invocation: true
effort: medium
---

Implement **$ARGUMENTS**. This skill orders the work and names the gates; the rules for each folder stay in its `CLAUDE.md` and in the ADRs. The wiring checklist is in [wiring.md](wiring.md): read it before the first layer.

## 0. Preconditions (stop and tell the owner if one fails)
- The spec (`docs/specs/<id>-*.md`) says `Status: Approved`, and its "Open questions" block nothing this work touches. Never answer an open question yourself.
- Every scenario the spec lists exists in `docs/scenarios/` and is approved (merged through `/posting-rule`). A rule without an approved scenario is not implemented here.
- The branch is not `main`. Name it `feat/<id>-<slice>`, for example `feat/s03-posting-api`.
- The working tree is clean, and `main` is pulled.

## 1. Plan (no code)
- Read only:
  - the spec and the ADRs it lists;
  - its scenarios;
  - `wiring.md`;
  - the `CLAUDE.md` of each folder you will touch.

  Open reference files by range when you write the layer that needs them. For a pattern not yet in this repository, ask the `explorer` subagent for the matching Vertex Food, Vertex Shifa or Vertex Hub files.
- If `TASKS.md` already holds this spec, continue from its first open item instead of planning again; check that earlier PRs are merged into `main`.
- Split the spec into PRs. The default is PR 1 for contracts, ledger, db, api and worker with their tests, then one PR for the screens with E2E. A small spec is one PR. A PR never:
  - leaves `main` broken or half-wired;
  - ships company data without isolation tests;
  - ships a posting without its scenario and balance properties.
- Write `TASKS.md` for this spec (replace the previous one): a heading per PR, one item per layer below, the wiring items that apply, and "checks, reviewers, acceptance, PR with auto-merge" at the end of each PR.
- Show the owner the PR split and the task list in a few lines, in Arabic, then **stop and wait for approval**.

## 2. Build, one layer at a time
Finish a layer and run its gate through the `checker` subagent. Fix root causes, tick the item in `TASKS.md`, and **commit the layer** (`feat(<id>): <layer> …`) before starting the next one. Never start a layer while the previous gate fails.

| # | Layer | Build | Gate |
|---|---|---|---|
| 1 | contracts | Schemas and types, error codes, permissions, audit actions, Hub event contracts, money helpers with unit tests | `contracts` tests, root typecheck |
| 2 | ledger | Pure accounting logic in `packages/ledger` from the approved scenarios; property tests | `ledger` tests (unit and properties) |
| 3 | db | Run `/db-migration`: schema, RLS, ledger guards, generated migration, SQL review; the posting function's new paths with concurrency and invariant tests; the scenario runner | `db` tests, scenario book, migration drift |
| 4 | api | Module, controllers, service: permission declarations, company context, audit in the transaction, postings only through the posting function, idempotency, held events, coded errors; `test/<module>.test.ts` with another company and a missing permission | the module's tests, architecture test, `api` typecheck |
| 5 | worker | Jobs safe to run twice (releases, revaluation preview, retries, reconciliation), per company inside the company context | `worker` tests and typecheck |
| 6 | bridge | `pnpm build`, OpenAPI export and its breaking-change check, generated client types | web typecheck |
| 7 | web | Screens, i18n keys, loading, empty and error states, amounts with currencies, drill-down to entries, Excel and PDF exports | the app's typecheck, lint, tests |
| 8 | e2e | The spec's flows; RTL screenshots (light and dark) at phone, tablet and desktop widths | `pnpm test:e2e`; open the new screenshots and look at them |

Layers a PR does not include are skipped. Helpers arrive with their first real use.

## 3. Close each PR
1. Walk the wiring checklist in `wiring.md` against the diff (`git diff main...HEAD --stat`).
2. Start the full checks through `checker` in the background:
   - lint, typecheck, test (properties and scenarios included) and build;
   - migration drift when `packages/db` changed;
   - the OpenAPI check when the API changed;
   - E2E when the web app changed.
3. While they run, run the `reviewer` subagent with the spec path, and the `accountant-reviewer` in parallel when the PR touches the ledger, money, postings, periods, reports or the API contract. Fix every blocking finding and every failure, commit the fixes, and run the checks again.
4. Owner acceptance, in Arabic:
   - **PR with screens:** turn the spec's "Acceptance" section into numbered steps: how to start the apps, which test account and company, what to enter, and which entries and figures to see. Ask before `pnpm db:migrate` on the dev database.
   - **PR without screens:** summarise the endpoints, jobs and postings with one worked example in numbers.

   Fix what the owner reports in the same session, then run the checks and the reviewers on the fix.
5. Tick the PR's items in `TASKS.md`, then, as soon as the owner accepts, finish the PR in the same turn: follow "Finishing a task" in `AGENTS.md`.

## Stop and ask when
- The spec or a scenario is ambiguous in a way that changes the numbers, or the work needs an answer from `docs/open-questions.md`.
- The code disagrees with an approved scenario: the scenario wins unless the owner approves a change.
- The migration review in `/db-migration` finds a destructive or non-backward-compatible change, or anything that weakens a ledger guard.
- A command changes the owner's data (`pnpm db:migrate`), reaches a server or posts to a real company's books.
- The work would go beyond the spec: record the idea as a follow-up instead.

## Keep this skill true
If a step here or in `wiring.md` was missing, wrong or out of date, fix the file in the same PR and say so under "Found". After the first feature ships, fill the "Patterns to copy" table in `wiring.md` with its files.
