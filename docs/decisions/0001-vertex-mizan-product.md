# 0001 — Vertex Mizan: a multi-company accounting product with a permanent core, optional modules and an integration layer

Status: Accepted · Date: 2026-10-20 (owner)

## Context
Vertex needs a complete, professional accounting system. Vertex Media's operations run on Vertex Hub, which decided not to build accounting inside itself and to post its financial events to a separate ledger product (Hub ADR 0035). Vertex also wants an accounting product to sell, like Vertex Food and Vertex Shifa.

The Syrian market runs on old desktop software (Al-Ameen, Al-Bayan). One modern Syrian challenger exists (Wakeed). Regional cloud products are built for Saudi and Egyptian tax rules. None of them documents a ledger guaranteed by the database, native support for the 2026 redenomination of the Syrian pound, or a ledger-grade posting API (`docs/research/market-syria.md`). The working method for building it with Claude Code is approved in `docs/research/working-method.md`.

## Decision

### Name and repository
- **Vertex Mizan (فيرتكس ميزان).** The name comes from *mizan* (الميزان), the balance, as in the trial balance (ميزان المراجعة). The full name is always used: "Mizan" alone is descriptive and crowded (`market-syria.md` §7).
- **Repository `HussienALfajer/vertex-mizan`, public** so CI runs free, with no licence (all rights reserved). It can be made private when sales start.

### Roles
- **The owner** decides every product, accounting and commercial question.
- **Claude Code is the main developer and the accounting adviser.** Advice states the standard it rests on (IFRS, IAS). Every Syrian legal or tax detail not read on an official source is labelled **unconfirmed** (REPORTED or UNVERIFIED, `market-syria.md`), and no code depends on an unconfirmed rule without a written owner decision.

### Tenancy
- **Multi-company (multi-tenant) from day one.** Every company's data is isolated from every other's.
- **Vertex Media is company number 1** and the design partner: it uses each phase before the next one is detailed.

### Three layers
1. **Permanent accounting core,** present for every company: chart of accounts, double-entry journal entries, currencies with stored rates, analytical dimensions, period close, financial statements.
2. **Optional business modules,** switched on per company: sales, purchases, inventory, cash boxes, expenses, fixed assets, installments.
3. **Integration layer:** a public API and connectors to other systems.

**One source of truth per document type per company.** When a connected system issues a document type for a company (for example Vertex Food issues sales), Mizan's module for that type is switched off for that company, and the connected system posts the accounting entries through the API.

### Four phases
Only the phase about to be built is detailed. Each phase is built, tested and used by Vertex Media before the next is detailed (`docs/product/vision-and-phases.md`).

1. **The core and the posting API,** serving Vertex Media through Vertex Hub.
2. **Cash boxes and banks, expenses, suppliers, financial statements, period close.**
3. **Sales and customers, purchases, inventory with serial numbers (IMEI), installment sales;** then the first stand-alone sale (for example to a phone shop).
4. **The commercial product:** self sign-up, subscriptions and payment, onboarding, support.

### Integration with Vertex Hub
- **Hub is the operational system** (invoices, payments, expenses, payroll); **Mizan is the ledger.**
- **Delivery:** Hub writes each financial event to an outbox in the change's transaction; its worker posts it to Mizan's **versioned API** with an **idempotency key taken from the Hub event**, so a resend never posts twice.
- **If Mizan is down,** Hub keeps working and retries later.
- **Closed periods:** a period closed in Mizan blocks Hub from any change dated inside it.
- **A daily reconciliation report** shows any event that did not arrive or did not post.
- **Dimensions:** journal lines carry the dimensions client, project, department and service, so profitability is read from Mizan.
- **Purchases made for clients** post to their own accounts; their margin stays outside the profit of the service project.
- **Money rules are compatible with Hub ADR 0006:** integer minor units, a currency code and a stored rate; SYP is the new Syrian pound with 2 decimals. Hub's side of the integration is Hub ADR 0035.

### Other Vertex products
- **Vertex Food and Vertex Shifa** connect later as an **optional add-on at a bundle price,** never a requirement, once each is complete, in their own sessions. Nothing changes in them now.
- `D:\vertex-hub`, `D:\vertex-digital`, `D:\vertex-food` and `D:\vertex-shifa` may be read for patterns and contracts, never edited (owner, 2026-10-20). Nothing is imported across repositories.

## Consequences
- Tenant isolation, the ledger invariants and the money module are designed before any feature, in the technical ADRs of step 4 (stack, tenancy, money and currencies, ledger invariants, the Hub API contract).
- Phase 1 has no screens for business documents: its users are Hub (through the API) and Vertex Media's accountant (chart of accounts, manual entries, reports).
- Hub's accounting feature (Hub V2, F18) starts once Mizan's posting API, chart of accounts and cash boxes are stable (Hub ADR 0035). Cash boxes are phase 2 here; the order between the two tracks is agreed when phase 2 is detailed.
- Turning a business module off for a company must never leave entries without a source: the module switch is a per-company setting that the API checks on every posting.
- Selling to other companies needs the open legal and naming checks of `market-syria.md` §9 (trademark searches, the tax authority's approved-programs list and its "الميزان" entry) before phase 3 ends.
