# 0003 — Tenancy and access: companies isolated by forced row-level security, people with memberships, API clients per company

Status: Accepted, amended by [0008](0008-foundation-audit-amendments.md) (attachments) · Date: 2026-10-20

## Context
Mizan is multi-company from day one (ADR 0001). Its users are Vertex Media's owner, an internal accountant, an external accounting office that serves several companies, and management readers (phase 1 scope, Q9). Later it is sold to many unrelated businesses, and to accounting offices that hold dozens of client companies. A company must never see another's books. Isolation that depends on every query remembering a filter is too fragile for a system written across many AI sessions. Vertex Shifa and Vertex Food solved this with forced row-level security (Food ADR 0004).

## Decision

### Model
- **The tenant is the company:** a legal entity with its own books. The column is `company_id`; in the interface it is "the company" (الشركة).
- **Pool model:** one PostgreSQL database. Every company-owned table has `company_id NOT NULL`, row-level security enabled and forced (`FORCE ROW LEVEL SECURITY`), and one permissive policy `company_isolation` with `USING` and `WITH CHECK (company_id = current_company_id())`.
- **Company context:** set per transaction (`withCompany(db, companyId, work)`) from the authenticated session's active company or from the API client's company, never from request input. `current_company_id()` reads only the transaction setting, with no fallback.
- **Composite foreign keys between company tables:** `(company_id, x_id) → (company_id, id)` with `unique (company_id, id)` on the parent. PostgreSQL checks foreign keys without row-level security, so a plain key would accept another company's ID.
- **Platform tables,** with no company scope, reached only through the platform modules:
  - people (users), sessions and two-factor secrets;
  - companies;
  - memberships;
  - API client keys (hashed);
  - the platform audit log.

  A platform table never has a column named `company_id`.
- **Silo option:** the company catalog records where each company's data lives, so a large customer can later move to its own database without code changes (Food ADR 0004).

### People and roles
- **One login per person, membership in many companies.** A membership holds the person's role in that company. The person switches the active company; every request runs in exactly one company.
- **Roles (phase 1):** owner, accountant, approver, viewer, auditor (phase 1 scope §3). Permissions come from one permission map in `packages/contracts`; API guards and the web app read the same map.
- **Two-factor sign-in is required** for the owner, accountant and approver roles, in every company where the person holds one.
- **No platform super-user in the application.** Vertex support access to a customer company (phase 4) will be an explicit, time-limited, audited membership granted by the company's owner. Operations that span companies run as the jobs role below.

### API clients
- An API client belongs to **one company** and carries scopes (`events:write`, `periods:read`, `reconciliation:write`). The company comes from the key, never from the payload (ADR 0006).

### Database roles
Copied from Vertex Food's `packages/db` and adapted:

| Role | Purpose |
|---|---|
| `mizan_owner` | Runs migrations and owns every object. It does not bypass row-level security. |
| `mizan_app` | What the API and the worker connect as. It has no `BYPASSRLS` and only the grants each table's migration gives. It has no `TRUNCATE`, `TRIGGER` or `REFERENCES`, and no `UPDATE`/`DELETE` on append-only tables. |
| `mizan_jobs` | The worker's cross-company jobs (month-end runs, reconciliation, retries). It has no `BYPASSRLS`: it reaches across companies only through its own policies on the few tables granted to it, and every statement it runs is logged without values. |
| `mizan_queue` | The role pg-boss runs as, confined to the `pgboss` schema. |

No function is `SECURITY DEFINER`. No role is a member of another.

### Optional modules and the source of truth
- Each company has a module switch per business module (all off in phase 1) and, for each document type, its **source**: a Mizan module or a connected system (ADR 0001).
- The API refuses a posting whose document type the company has assigned to another source.

### Enforcement
- **A convention test** reads the migrated database and fails when:
  - a table with `company_id` lacks forced row-level security or the policy;
  - a company foreign key is not composite;
  - the app role holds a forbidden grant;
  - a function is `SECURITY DEFINER`.
- **API tests** call every endpoint as a member of another company and expect nothing to cross.
- **A property test** creates two companies with generated data and checks that no read, report or posting of one ever includes the other's rows.

## Consequences
- Isolation holds even when application code forgets a filter.
- Accounting offices (several companies per person) and groups (Vertex) work from the first day without a special case.
- Consolidation across companies, a later feature, must read through an audited cross-company path, never by bypassing row-level security in product code.
