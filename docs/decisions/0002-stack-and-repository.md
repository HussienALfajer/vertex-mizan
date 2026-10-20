# 0002 — Stack and repository: Vertex Hub's stack, one monorepo, a pure ledger package

Status: Accepted, amended by [0008](0008-foundation-audit-amendments.md) (versions) · Date: 2026-10-20

## Context
Claude Code writes the whole system (`docs/research/working-method.md`). Vertex Hub runs in production on a stack its sessions know well, and Vertex Food and Vertex Shifa run the same backend stack with stronger tenancy and ledger patterns. Mizan integrates with Hub first, shares its server, and is built by the same owner and agent. The owner asked for Hub's stack unless there is a reason to differ (2026-10-20).

## Decision
- **Repository:** `HussienALfajer/vertex-mizan`; pnpm workspaces + Turborepo; TypeScript strict, pinned to ~6.0 (Hub ADR 0012); Node 24; ESM everywhere (`"type": "module"`, `NodeNext`); package scope `@vertex-mizan/*`.
- **Apps:**
  - `apps/api`: NestJS 12 with the Express adapter, a modular monolith (Hub ADR 0001, ADR 0012). Validation and responses use NestJS's native Standard Schema support with the Zod schemas of `packages/contracts`. The OpenAPI document comes from @nestjs/swagger. Logs go through nestjs-pino.
  - `apps/worker`: NestJS application context with pg-boss. It runs month-end revenue releases, revaluation previews, held-event retries, the reconciliation check, exports and PDF rendering with Playwright's Chromium (Hub ADR 0008).
  - `apps/web`: React 19 + Vite + TanStack Router and Query; Tailwind 4 with the Vertex design system on shadcn/ui and Base UI (Hub ADR 0004), copied and adapted; i18next with Arabic as the only shipped language and RTL by default.
- **Packages:**
  - `packages/contracts`: Zod schemas shared by the API, the web app and integrators; the money module (ADR 0007); error codes; the Hub event contracts (ADR 0006), exportable as JSON Schema.
  - `packages/ledger`: **pure accounting logic with no I/O**, the part property tests hammer:
    - building balanced lines from a request;
    - currency conversion and rounding;
    - posting-rule evaluation (event → lines);
    - revenue recognition schedules;
    - revaluation;
    - allocation;
    - the integrity hash.
  - `packages/db`: the Drizzle schema, migrations, database roles, the company context and **the single posting function** (ADR 0005), used by the API and the worker.
  - `packages/ui`, `packages/tokens`, `packages/i18n` and `packages/config`.
- **Database:** PostgreSQL 17 with forced row-level security (ADR 0003); Drizzle ORM and drizzle-kit migrations; tests against a real database, never mocks.
- **Authentication:** Better Auth with sessions in PostgreSQL and its two-factor plugin (TOTP and backup codes). API clients use their own hashed keys (ADR 0006), not Better Auth.
- **Exports:** Excel through exceljs (as Hub); PDF through the worker's Chromium.
- **Quality:**
  - Biome for lint and format.
  - Vitest with SWC for Nest code.
  - fast-check for property tests.
  - Playwright for end-to-end tests with RTL screenshots.
  - The scenario-book runner (ADR 0005).
  - Architecture and convention tests.
  - GitHub Actions CI with gitleaks, migration drift, the OpenAPI breaking-change check, `pnpm audit` and a docs-only skip.
- **Exact versions** are pinned at the scaffold, the newest stable at that time that the NestJS ecosystem supports (Hub ADR 0012's check is repeated then).
- **Hosting:** the existing Vertex server beside Hub, behind nginx with PM2, at `mizan.vertexmedia.pro`. Mizan has its own database and roles, and no database access to Hub's. A deployment ADR is written before the first production deploy.

## Consequences
- Hub's and the sister products' code (money module, design system, tenancy roles, outbox, PDF worker, CI) is copied and adapted, never imported across repositories.
- `packages/ledger` has no database or framework dependency, so every accounting rule can be tested in milliseconds with generated inputs, and the same code runs in the API, the worker and the scenario runner.
- Postings are made only through `packages/db`. A rule computed in `packages/ledger` reaches the books only through that one function, where the database invariants apply.
