# Wiring checklist

Walk this list against the diff before a PR closes. Tick only what applies to the PR.

## Contracts
- [ ] New schemas exported from `packages/contracts/src/index.ts`, each API schema with `.meta({ id })`
- [ ] New error codes added with their Arabic text in `packages/i18n`; no code renamed, removed or reused
- [ ] New permissions in the permission map; new audit actions listed
- [ ] Hub event contracts versioned; changes within `/v1` additive only
- [ ] Money handled only through the money module

## Ledger
- [ ] Every rule comes from an approved scenario in `docs/scenarios/`
- [ ] Pure functions in `packages/ledger`, no I/O
- [ ] Property tests: balance in both ledgers, difference lines in one ledger only, reversal nets to zero, allocations sum exactly, closed periods refused, replay posts nothing
- [ ] Scenarios cover every currency shape the rule can occur in

## Database
- [ ] Schema file exported from `schema/index.ts` and registered with its owning module, scope and kind
- [ ] `company_id`, forced RLS, `company_id`-first indexes, composite company foreign keys on company tables
- [ ] Ledger and audit tables append-only (triggers `ENABLE ALWAYS` and grants); deferred invariant triggers where rows depend on each other; locks in the order ledger head, then period
- [ ] Period balances maintained by the posting function and checked against the lines
- [ ] Unique indexes on idempotency keys, external references and entry numbers
- [ ] Writes to the ledger only through the posting function
- [ ] Migration generated, SQL reviewed, no drift; nothing touches posted data
- [ ] Scenario book passes against the real database

## API and worker
- [ ] Module registered; every route declares its permission; API client scopes checked
- [ ] Company context from the session or key; tests with another company and a missing permission
- [ ] Audit and postings in the same transaction as the change
- [ ] Idempotency on every write; held events with reasons; stable error codes
- [ ] Jobs registered, safe to run twice, run per company in its context
- [ ] OpenAPI regenerated; breaking-change check passes

## Web
- [ ] Routes and navigation; permission-aware menus (cosmetic only)
- [ ] i18n keys; logical CSS; design-system components
- [ ] Loading, empty and error states; amounts always with their currency; SYP labelled as the new pound on printed output
- [ ] Drill-down from figures to entries; Excel and PDF exports where the spec asks
- [ ] E2E with RTL screenshots, light and dark, at phone, tablet and desktop widths

## Docs
- [ ] `docs/ROADMAP.md`, folder `CLAUDE.md`, `docs/glossary.md`, `docs/open-questions.md`, the `AGENTS.md` commands table

## Patterns to copy

From S01 (the first feature). For a pattern not listed, ask the `explorer` subagent for the matching files in Vertex Food, Vertex Hub or Vertex Digital (the ledger posting function).

| Layer | Copy |
|---|---|
| contracts | `packages/contracts/src/companies.ts` and `members.ts` (schemas with `.meta({ id })`), `access.ts` (the permission map), `errors.ts` |
| db | `packages/db/src/schema/companies.ts` and `audit.ts`, their registry entries, the S01 custom migration (RLS, grants, guards), `test/access.test.ts` |
| api | `apps/api/src/modules/members/` (controller with one access decorator per route, `@Reauthenticated`, service with the audit in the transaction), `test/members.test.ts` (another company, a missing permission, `COMPANY_SWITCHED`) |
| worker | `apps/worker/src/jobs/`: `email.send` and the daily clean-up (safe to run twice, as the app role) |
| web | `apps/web/src/features/company/company-settings-page.tsx` (company writes with `company: companyId`, sensitive actions, read-only roles), `features/members/members-page.tsx` (tables, dialogs, `ReasonDialog`), routes under `_app/_company` |
| e2e | `apps/web/e2e/company-mocks.ts`, `company.spec.ts` (flows with recorded requests), the screens in `screens.spec.ts` |
