# 0023 — Project documents, quantities and the application of advances

Status: Accepted (owner, 2026-11-16, in the S12 interview) · Date: 2026-11-16 · Amends [0007](0007-book-and-parallel-currency-ledgers.md) (a line measured partly at an advance's carrying amount) and [0022](0022-counterparties-cash-accounts-and-vouchers.md) (a second family of numbered documents) · Spec: `docs/specs/S12-project-costs.md`

## Context
The contracting client (ADR 0021) keeps each project's costs and income in detail: materials item by item with quantities, workers' wages, subcontractors, and the client's progress billings with retentions and advances. S11 gave the chart, the counterparties and cash vouchers. Mizan's lines carry money only; nothing holds a quantity, a billing's cumulative chain or the terms of a project, and an advance cleared against revenue or a cost would post an exchange difference that IFRIC 22 does not allow.

## Decision
1. **Project documents.** A purchase invoice, a wage sheet, a client's progress billing, a subcontractor's billing and a retention release are manual entries prepared as drafts, with S03's approval and posting. A pure function in `packages/ledger` derives the entry from the document as typed; `post()` derives it again, numbers the document per kind and fiscal year in the posting transaction, gaplessly, and writes an append-only document row. A billing also takes the next number of its project or subcontract. A document is cancelled by reversing its entry; a billing only while it is the latest of its project or subcontract.
2. **Revenue by certified progress billings.** A project's revenue is recognised over time by the output method, each certified billing measuring the work performed (IFRS 15.35(b), 15.B15). Billings are cumulative; the period's value is the cumulative less the previous billing's. Work done and not billed, or billed in excess, is a manual month-end entry.
3. **Quantities.** A materials catalogue per company; an account may require a material, and every line on it carries a material and a quantity, its amount the rounded product of quantity and unit price. Quantities are stored beside the line, append-only, and join the entry hash only when present.
4. **Advances applied at their carrying amount (IFRIC 22.8–9).** An advance (`212002`, `114002`) is applied only in its own currency, cleared at the average carrying amount of the project's share of the advance (its lines with that contract; owner, 2026-11-16), and the part of the revenue or cost line it pays for takes exactly those carried amounts; the rest of the line is a new measurement. An append-only row records each covered part, and a deferred guard requires the covered parts to equal the clearing line in every amount. No exchange difference arises on the advance.
5. **Project terms and budgets are management data.** The contract value, currency, rates of retention and advance recovery, and the budget per cost account have no accounting effect; a billing's deductions default from them and can be changed.

## Consequences
- S03's drafts gain the document header and line quantities; `post()` gains the document numbering, the quantity rows and the advance applications with their guard.
- `contracting@1`'s `511001` requires a material.
- No store or inventory valuation: a store is IAS 2 and its own spec (Q19, owner, 2026-11-16).
- No input-method revenue and no estimate of total costs (Q20, owner, 2026-11-16).
