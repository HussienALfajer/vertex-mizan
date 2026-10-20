# Vertex Mizan

A professional multi-company accounting system by Vertex, Arabic-first. A permanent double-entry core (chart of accounts, journal entries, currencies with stored rates, dimensions, period close, statements), optional business modules per company, and an integration layer through which other systems post to the ledger exactly once. Vertex Media is company 1 and the design partner; Vertex Hub posts its financial events here.

Phase 1 goal: Vertex Media's books are kept in Mizan, fed by Vertex Hub (`docs/product/phase-1-scope.md`). **Accuracy comes before everything: this is an accounting system.**

Standing read-only references (owner, 2026-10-20), **read, never edit**:
- `D:\vertex-hub`: the integration counterpart (Hub ADRs 0006, 0035) and the stack;
- `D:\vertex-food` and `D:\vertex-shifa`: tenancy, workflow and code patterns;
- `D:\vertex-digital`: its ledger pattern.

Copy and adapt; never import across repositories.

## Source of truth

| File | Purpose |
|---|---|
| `docs/product/vision-and-phases.md` | The product, its layers and four phases |
| `docs/product/phase-1-scope.md` | What phase 1 includes (F01–F14), the accounting policies and the treatment of each Hub event. Anything not in it is out of scope: ask before adding. |
| `docs/decisions/` | ADRs. Follow them; propose a new ADR to change one. 0007 money (book and parallel ledgers), 0005 and 0008 ledger invariants, 0006 and 0008 the Hub API, 0009 the brand and design system. |
| `docs/scenarios/` | The scenario book: one solved example per accounting rule, executed as a test (ADR 0005) |
| `docs/glossary.md` | Accounting terms in Arabic and English. Name code after the English term. |
| `docs/ROADMAP.md` | Phase and task status. Update it when an item is done. |
| `docs/specs/<id>-<name>.md` | Detailed spec per feature group, written before implementation |
| `docs/open-questions.md` | Unresolved decisions. Never guess an answer to one: ask. |
| `docs/research/` | Market, legal and currency research with confidence labels; the approved working method |
| `docs/workflow.md` | How work is run with Claude Code |
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
| `pnpm typecheck` · `pnpm test` · `pnpm build` | Every package through Turborepo; one package: `pnpm --filter @vertex-mizan/<name> test`. The `db` tests need the local database below |
| `pnpm test:scenarios` | The scenario book on a fresh test database: `Approved` cases run, `Proposed` ones are skipped and listed (`packages/scenarios/CLAUDE.md`); needs the local database below |
| `docker compose up -d` | The local PostgreSQL 17 (`compose.yaml`, `127.0.0.1:55417`); copy `.env.example` to `.env` first |
| `pnpm db:setup-local` · `pnpm db:migrate` | Create or update the four database roles and the development database · apply the migrations to it as the owner (`packages/db/CLAUDE.md`) |
| `pnpm db:generate` | Generate a migration from the Drizzle schema; run again, it must report nothing (the CI drift check) |
| `pnpm check:migrations` | The migration guard: refuses guard-weakening SQL in `packages/db/migrations`, and changes to the append-only tables of the registry (ADR 0008) |
| `pnpm check:error-codes` | The error-code guard: the codes in `packages/contracts` at `origin/main` (or `--base <ref>`) are still first, in order, with their status (ADR 0006) |
| `pnpm --filter @vertex-mizan/ui preview` | The design system's preview page (Vite, until `apps/web`); `preview:build` writes `.preview/ui` |

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
- **Company isolation (ADR 0003):**
  - every company table has `company_id` and forced RLS;
  - the company context comes from the session or the API key, never from input;
  - composite company foreign keys.

  A cross-company read is a security incident.
- **Accounting rules start as scenarios:** a posting, recognition, revaluation or settlement rule is implemented only after its scenario in `docs/scenarios/` exists and the owner has approved its expected entries (`/posting-rule`).
- **Standards and law:** accounting treatment states its IFRS/IAS basis. A Syrian legal or tax rule carries CONFIRMED, REPORTED or UNVERIFIED; no code depends on an unconfirmed rule without a written owner decision. Never guess an accounting or business decision: ask, with a recommendation.
- **Hub API (ADR 0006):**
  - `/v1` changes are additive only;
  - every write is idempotent by key;
  - error codes are stable and never reused.
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
  - an action is destructive or outward-facing: deleting data, dropping tables, posting to a real company's books, force-push, production changes.
- A task is done only when its checks pass and `TASKS.md` has no open items for it. Show the evidence instead of asserting success.
- Fix root causes. Never silence a failing test, type error, lint rule or database guard.
- For multi-step work keep a checklist in `TASKS.md`. Commit each layer when its gate passes.
- Mark anything you could not confirm and say where you looked.
- Match the surrounding code: copy the pattern named in the folder's `CLAUDE.md`. No speculative code.

## Context economy

- Search before reading, then read only the relevant range.
- Never read generated or lock files: `pnpm-lock.yaml`, `**/migrations/meta/`, `routeTree.gen.ts`, `dist/`, `.turbo/`.
- Run the narrowest check first and the full set once before the PR.
- In replies, point to `path:line` instead of pasting files or diffs.

## Git

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- One branch per change, named by type (`feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `test/`). Never commit to or push `main` (a hook refuses it).
- Stage files by path; never `git add -A` or `git add .` (a hook refuses it).
- Merge commits only: never squash or rebase-merge.

## Finishing a task: open the PR at once

Stop and report at the first step that fails.

1. **Branch** is not `main`; `TASKS.md` has no open items for this PR.
2. **Docs:** update `docs/ROADMAP.md` and every doc the change made stale, including the commands table above.
3. **Secrets and data:** `git status` and `git diff --stat` show no `.env`, key or real data.
4. **Checks:** run lint, typecheck, test (property tests and the scenario book included) and build through the `checker` subagent. Add migration drift when `packages/db` changed, the OpenAPI check when the API changed, and E2E when a front end changed. Documentation-only changes run no checks.
5. **Review:** the `reviewer` subagent has run on every feature. The `accountant-reviewer` has run in parallel on any change to the ledger, money, posting rules, periods, reports or the API contract. Their blocking findings are fixed.
6. **Commit:** intended files only; a Conventional Commit subject and a body with what and why, ending with the session's attribution line.
7. **Pull request:** `git push -u origin <branch>`, then `gh pr create --base main` with `## Summary` and `## Test plan`, ending with the attribution line, then `gh pr merge <number> --auto --merge`.
   - **The owner approves before auto-merge** when the PR changes the scope, an ADR, a ledger invariant, the money module, a posting rule or an expected value in the scenario book. Exception: when the PR only writes down decisions the owner has just given in the conversation, those answers are the approval; it merges at once and the PR body quotes the decisions.
8. **Report** in the format below.

## Reporting

End every substantial task with these sections, in this order:

1. **Needs from you** — decisions or approvals blocking progress, or "nothing". After a merged PR, end with: `cd D:\vertex-mizan; git switch main; git pull --ff-only; git branch -d <branch>`
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
