# Working method with Claude Code: comparison and approved proposal

- **Date:** 2026-10-20 · **Status:** approved by the owner (2026-10-20)
- **Purpose:** the basis for Vertex Mizan's `AGENTS.md`, `CLAUDE.md`, `docs/workflow.md` and `.claude/` files, which are written in step 4 of the project setup together with the technical ADRs.
- **Sources read (read-only):** `D:\vertex-hub`, `D:\vertex-digital`, `D:\vertex-shifa`, `D:\vertex-food`: `AGENTS.md`, `CLAUDE.md`, `docs/workflow.md`, `.claude/` (settings, skills, agents, hooks), the engineering-conventions ADRs (Hub 0013, Digital 0011, Shifa 0020, Food 0020), money and ledger (Hub 0006, Digital 0003, Food 0014), tenancy (Food 0004), security and audit (Shifa 0016), AI-assisted development (Hub 0010, Food 0019), and CI workflows.

## 1. Comparison

| Element | Hub | Digital | Shifa | Food |
|---|---|---|---|---|
| `AGENTS.md` shared with Codex; `CLAUDE.md` imports it; one `CLAUDE.md` per app or package | ✓ | ✓ | ✓ | ✓ |
| Skills `spec`, `feature-slice` (+ `wiring.md`), `db-migration` | ✓ | ✓ + `supplier-adapter` | ✓ | ✓ |
| Subagents `checker` (Haiku) and `reviewer` (Opus) | ✓ | ✓ (strongest money checklist) | ✓ + `explorer` (Sonnet) | ✓ + `explorer` |
| Biome format hook after every edit | ✓ | ✓ | ✓ | ✓ |
| Git guard hook: no commit on `main`, no `git add -A` / `.` | — | — | — | ✓ |
| Session-start hook: branch, uncommitted files, open `TASKS.md` items | — | — | — | ✓ |
| Cloud-session scripts with a disposable database | ✓ | ✓ | — | — |
| Commit at every passing gate inside `/feature-slice` | — | — | — | ✓ |
| PRs that change the scope or an ADR wait for the owner before auto-merge | — | — | ✓ | ✓ |
| Tight permissions (push only to typed branches; squash/rebase merge denied; `gh api` asks) | partial | partial | partial | ✓ |
| Ledger append-only by grants and trigger, unique idempotency key per journal, one posting function | — | ✓ | — | partial |
| Forced row-level security per tenant table, convention test, every endpoint tested with another tenant | — | — | ✓ | ✓ |
| Spec template with money, audit, abuse and edge-case sections | — | — | ✓ | ✓ |
| Prune instruction files once per phase | — | — | ✓ | ✓ |
| CI: gitleaks, migration drift, OpenAPI drift, dependency advisories, docs-only skip | ✓ | ✓ | ✓ | ✓ |

**Reading:** Food has the most complete method, Digital the strongest ledger enforcement, Shifa and Food the strongest tenant isolation, Hub and Digital the cloud-session scripts.

## 2. Base taken from the four projects

- **Food's setup as a whole:** `AGENTS.md` + `CLAUDE.md` under 200 lines together; `checker`, `reviewer` and `explorer` subagents; Biome, git-guard and session-start hooks; Food's permission list; a commit at every passing gate; owner approval before auto-merge for scope and ADR PRs.
- **Tenant isolation from Shifa and Food:** `tenant_id` and a forced RLS policy on every tenant table; apps connect as a role that cannot bypass RLS; tenant context set per transaction from the session; a convention test fails on a tenant table without a forced policy; every endpoint tested with a user of another tenant.
- **The ledger rules from Digital,** extended to a general-purpose ledger (section 4).
- **Cloud-session scripts from Hub,** added when application code starts.
- **From all four:** the report format (in Arabic), merge commits only, the cleanup line, Conventional Commits, model and effort per task, context economy rules.

## 3. Improvements over the four projects

1. **Rules as code first.** Every accounting rule a machine can check lives in the database, a test, a lint rule or a hook. Prose holds only what needs judgement.
2. **Wider owner approval.** Besides scope and ADR changes, a PR waits for the owner before auto-merge when it changes:
   - a ledger invariant or the money module;
   - a posting rule;
   - an expected value in the scenario book.
   A wrong accounting rule passes every code test; only the owner (or the accountant) catches it.
3. **Two independent reviewers** on accounting work, run in parallel: the code `reviewer` (security, isolation, code, spec coverage) and the `accountant-reviewer` (section 4.1).
4. **A glossary** (`docs/glossary.md`) of accounting terms in Arabic and English; code is named after the English term (journal entry = قيد, posting = ترحيل, reversal = عكس, trial balance = ميزان المراجعة, cost centre = مركز كلفة).
5. **Confirmation labels for Syrian law and tax.** Every Syrian legal or tax rule in the docs carries CONFIRMED, REPORTED or UNVERIFIED (as in `docs/research/market-syria.md`). No code depends on an UNVERIFIED rule without a written owner decision.
6. **Standing read-only references:** `D:\vertex-hub`, `D:\vertex-food` and `D:\vertex-shifa` may be read, never edited (owner, 2026-10-20). Hub for the integration contract and its money rules (ADR 0006, ADR 0035); Food and Shifa for patterns (tenancy, workflow) and their later integration. Nothing is imported across repositories; copied patterns are adapted.

## 4. Accounting-specific additions

### 4.1 `accountant-reviewer` subagent

- Opus, effort `high`, fresh context, read-only (git read commands only).
- Runs on every change that touches the ledger, posting rules, money, periods, reports or the API contract.
- Checks:
  - every operation produces a balanced entry, with accounts of the right nature and sign;
  - nothing edits or deletes a posted entry; corrections are reversals that reference the original;
  - IFRS treatment: IAS 21 (transaction-date rate, closing rate, realised and unrealised differences), IAS 1 (presentation), IAS 8 (corrections and comparatives), IFRS 15 where revenue is recognised;
  - rounding is explicit and allocations sum exactly;
  - a closed period refuses any posting dated inside it;
  - every new or changed rule has a scenario in the scenario book, and the scenario's expected entries are right;
  - Syrian rules used carry their confirmation label.
- Reports blocking findings only, each with a concrete example that would make the books wrong, then "Could not verify".

### 4.2 Ledger invariants enforced by the database

To be fixed in the "ledger invariants" ADR (step 4).

| Invariant | Enforced by |
|---|---|
| Every journal entry balances (debits equal credits in the company's functional currency) | Deferred constraint trigger checked at commit |
| A posted entry is never updated or deleted | Grants (the app role has no `UPDATE`/`DELETE` on posted ledger tables) and a trigger; corrections are reversal entries |
| A closed period stays closed | Trigger refusing an entry dated inside a closed period of that company |
| The audit log is append-only and written in the same transaction | Grants and a trigger |
| Nothing is posted twice | Unique constraint on (company, source, idempotency key) |
| No company sees another | Forced row-level security |
| No ledger table ships without these guards | Convention test in `packages/db` |
| One way to write the ledger | A single posting function in `packages/db`, used by the API and the worker |

### 4.3 Money

- Integer minor units with an ISO 4217 code; exact decimal rates stored with their source (central bank bulletin, market, manual) and date; no floating point anywhere; one tested money module.
- Compatible with Hub ADR 0006: SYP is the new Syrian pound with 2 decimals; USD.
- A functional currency per company; handling of pre-2026 old-pound history (redenomination) decided in the money ADR (step 4).

### 4.4 Property-based tests (fast-check) for the core

Properties that must hold for any generated input:

- every posting balances;
- an entry plus its reversal nets to zero on every account;
- the trial balance always balances;
- reports reconcile to the ledger;
- rounding allocations sum exactly to the total;
- replaying the same request returns the same result and posts nothing new;
- no posting lands in a closed period;
- company A never reads company B's data.

### 4.5 Scenario book (`docs/scenarios/`)

- One Markdown file per accounting rule: the explanation, the standard and the Syrian basis with its label, and a **YAML block** with the inputs (accounts, rates, events) and the expected journal lines and balances (owner, 2026-10-20).
- A test runner reads every scenario file and executes it against the real posting function and a real test database. The documented example is the test: when one changes, the other changes.
- Example: "a USD invoice paid in SYP at a different rate" → realised exchange difference, with the exact entries.
- Changing an expected value needs owner approval (section 3, item 2).

### 4.6 Tenant isolation tests

Forced RLS on every tenant table (convention test); every endpoint tested with a user of another company; a property test that creates two companies and checks that nothing crosses.

### 4.7 API with versions and idempotency

- Versioned paths (`/v1/`).
- An `Idempotency-Key` on every write: the same key with the same payload returns the first result; the same key with a different payload returns `409`.
- A stable error code for a posting dated inside a closed period.
- CI fails on a breaking change to the published OpenAPI document within the same version.

### 4.8 Skills

- `/posting-rule <name>`: add or change a posting rule. Order: write the scenario (expected entries) → owner approval → implementation → property tests → `accountant-reviewer`.
- `/spec`: the template adds accounting sections: accounting treatment and entries, standards and legal basis, currencies and rates, periods, API and idempotency, effect on reports, scenarios.
- `/db-migration`: adds the rule that no migration changes posted ledger data; historical corrections are reversal entries, never `UPDATE`.
- `/feature-slice`: as in Food, with the `accountant-reviewer` beside the `reviewer` on accounting work.

### 4.9 Model and effort

- `xhigh`: the ledger data model and its invariants.
- `high`: money, posting rules, periods, tenant isolation, the API contract, specs.
- `medium`: everything else; `low`: mechanical edits.
- Code is written by Opus only; Sonnet (`explorer`) and Haiku (`checker`) never write code.

### 4.10 CI and branch protection

- Checks: lint, typecheck, unit tests, property tests, the scenario book, migration drift, OpenAPI breaking-change check, gitleaks, dependency advisories, docs-only skip.
- When CI exists, its checks are added as required status checks to the `main: require CI` ruleset created in step 0.

## 5. Where this lands

Step 4 writes, from this document: `AGENTS.md`, `CLAUDE.md`, `docs/workflow.md`, `docs/glossary.md`, `.claude/settings.json`, `.claude/agents/{checker,reviewer,accountant-reviewer,explorer}.md`, `.claude/hooks/{biome-format,git-guard,session-start}.mjs`, `.claude/skills/{spec,feature-slice,db-migration,posting-rule}/`, the spec template, and the scenario-book format. Hooks and skills that need application tooling (Biome, the test runner) are written so they do nothing until that tooling exists.
