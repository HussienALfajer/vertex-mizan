# Vertex Mizan — vision and phases

- **Date:** 2026-10-20 · **Status:** approved by the owner (2026-10-20). The order of phases 2 and 3 is reviewed when phase 2 is detailed (open question Q6).
- **Decisions:** ADR 0001. **Evidence:** `docs/research/market-syria.md`.

## 1. Vision

**A ledger that companies and their accountants can trust, built for how Syrian businesses really deal: in the new pound and in dollars, across several companies, with the operational systems they already use.**

Vertex Mizan is a cloud accounting system, Arabic first, for several companies under one login. Its core is a double-entry ledger whose rules the database itself guarantees: every entry balances, a posted entry is never changed but reversed, a closed period stays closed, and every action is in an audit log nobody can edit. Around that core, business modules are switched on per company, and an API lets other systems (Vertex Hub first, then Vertex Food, Vertex Shifa and third parties) post to the ledger exactly once.

## 2. Who it serves

| User | What they need |
|---|---|
| **Vertex Media** (company 1, design partner) | Real books for an agency that bills in SYP and USD: Hub's invoices, payments, expenses and payroll posted automatically; profit by client, project, department and service; closed months that Hub cannot change. |
| **Groups of companies** (Vertex itself) | Several companies under one login, each with its own books, and a view across them. |
| **Accounting offices** | Many client companies in one place, the people who choose the software in Syria. |
| **Businesses with an operational system** | Their POS, clinic or agency system posts to Mizan; Mizan does not duplicate it (one source of truth per document type). |
| **Stand-alone businesses** (from phase 3) | Sales, purchases, stock, cash and installments in Mizan itself; the first target is phone shops (IMEI, installments, SYP/USD). |

## 3. What makes it different

From `market-syria.md` §8; each item becomes a requirement only through a phase scope.

1. A ledger guaranteed by the database, not by screens.
2. Correct dual currency: SYP (new) and USD, every amount with its currency and the rate actually used, dated rates from the Central Bank bulletin and the market, revaluation, reports in either currency.
3. Native support for the 2026 redenomination of the Syrian pound.
4. Real multi-company under one login, with consolidation.
5. An integration-first API: versioned, idempotent, aware of closed periods.
6. Profitability by dimension for service businesses.
7. Tax rules as dated, versioned configuration, ready for the reform expected in 2027.
8. Works in Syrian conditions: light pages, no lost work on a dropped connection, full export.

## 4. The three layers

1. **Permanent core:** chart of accounts, double-entry journal entries, currencies with stored rates, analytical dimensions, period close, financial statements.
2. **Optional modules,** switched on per company: sales, purchases, inventory, cash boxes, expenses, fixed assets, installments.
3. **Integration:** the API and connectors.

For each company and each document type there is one source of truth. If a connected system issues that document type, Mizan's module for it is off for that company.

## 5. Phases

Only the next phase is detailed. Each is built, tested and used by Vertex Media before the next one is detailed.

### Phase 1 — The core and the posting API
**Goal:** Vertex Media's books are kept in Mizan, fed by Vertex Hub.
- The permanent core for any number of companies: statutory books with an optional parallel currency ledger, IFRS 15 revenue recognition and month-end revaluation in each ledger.
- The versioned posting API with idempotency and closed-period refusal, and the daily reconciliation with Hub.
- What Vertex Media's accountant needs to use the core: chart of accounts, manual entries, trial balance and ledgers.
- **Scope:** `docs/product/phase-1-scope.md`.
- **Done when:** Hub posts its financial events to Mizan in production, the reconciliation is clean, and Vertex Media's accountant closes a real month in Mizan.

### Phase 2 — Cash, expenses, suppliers, statements, close
**Goal:** Mizan covers everything Vertex Media does with money that is not a client document in Hub.
- Cash boxes and banks: person wallets, transfers, currency exchange.
- General and recurring expenses.
- Suppliers and payables.
- Full financial statements (cash flow, notes) and year-end close. (Basic statements, exchange differences and month-end revaluation are in phase 1.)
- Detailed after phase 1 is in use.

### Phase 3 — Trading modules and the first stand-alone sale
**Goal:** a business without another operational system can run on Mizan.
- Sales and customers, purchases, inventory with serial numbers (IMEI), installment sales.
- Tax invoices as the law requires them (the tax authority's approval and QR linkage, `market-syria.md` §4.4).
- The first sale to a company outside Vertex, for example a phone shop.
- Detailed after phase 2 is in use.

### Phase 4 — The commercial product
**Goal:** companies sign up, pay and start without Vertex doing it for them.
- Self sign-up, subscriptions and local payment (bank transfer, local wallets, agents: `market-syria.md` §6).
- Onboarding: chart-of-accounts templates, opening balances, import from Al-Ameen and Excel.
- Support.
- Optional bundles with Vertex Food and Vertex Shifa.
- Detailed after phase 3 is in use.

## 6. Out of scope until a phase says otherwise
- Payroll calculation: Hub computes payroll; Mizan posts it.
- Full offline mode.
- Mobile apps.
- Selling outside Syria (name risk in the Gulf, `market-syria.md` §7).
