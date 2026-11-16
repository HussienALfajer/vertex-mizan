# S12 — Project costs

Status: Approved (owner, 2026-11-16) · Date: 2026-11-16 · Features: `docs/product/phase-1-scope.md` "Added by ADR 0021" (N2, N3, N4), F02, F03, F06, F13 · ADRs: 0003, 0005, 0007, 0008, 0011, 0012, 0013, 0016, 0018, 0021, 0022, 0023

## Summary
The contracting client needs each construction project's income and costs in detail: materials item by item with their quantities, the wages of workers and craftsmen, subcontractors, and the client's progress billings with their retentions and advances. S12 adds **project documents**, each a manual entry prepared as a draft and numbered per kind and fiscal year (ADR 0023): the project purchase invoice (N2, N4), the wage sheet (N3), the client's progress billing, the subcontractor's billing and the retention release. It adds a materials catalogue and quantities on cost lines, each project's terms and budget, the application of advances at their carrying amount (IFRIC 22), and the project report: costs by kind against the budget, materials, wages, subcontracts and billings.

It answers Q19 (materials go straight to the project) and Q20 (contract revenue is recognised over time by certified progress billings, the output method).

## The owner's answers (interview, 2026-11-16)
1. **Materials (Q19):** bought for a project and charged to it at once; no store and no inventory valuation. A store (IAS 2) is a later spec if the client needs one.
2. **Wages (N3):** a wage sheet per project and period accrues each worker's wage (Dr `511002` / Cr `211007`); payment is a payment voucher (S11). No payroll calculation and no tax.
3. **Contract revenue (Q20):** recognised over time by the output method, each certified progress billing being the survey of work performed (IFRS 15.35(b), 15.B15). At month end the accountant may post a manual entry for work done and not yet billed (`113001`) or billed in excess (`212001`).
4. **Project expenses (N2):** a numbered project purchase invoice: the supplier, the project, cost lines with their kind, material, quantity and unit price, credited to the supplier's running balance.
5. **Client's progress billing:** a numbered document with retention (`113002`) and advance recovery (`212002`, at the advance's carrying amount, IFRIC 22), the net on `112001`, revenue `411001` at the gross amount; printed in Arabic.
6. **Advances are applied only in their own currency:** a USD advance against a USD document only.
7. **Materials catalogue:** required on every line of `511001` (material, quantity, unit), so the quantities per project are complete and agree with the books.
8. **Project data:** the contract value and a budget per cost kind, shown against the actuals; no accounting effect.
9. **Subcontractor's billing:** the mirror of the client's: retention payable (`211006`) and advance recovery (`114002`, at its carrying amount).
10. **Client retention release:** a numbered document moves a retention from `113002` to `112001` when it becomes unconditional (IFRS 15.108): the retention cleared at its carrying amount, the receivable measured new, the residual a realised exchange difference (IAS 21.28).
11. **Wage sheet:** one currency, a period within one month, dated its last day; a line is days × a daily rate, or a lump sum with a description (piece work); no deductions: a worker's advance is netted in the worker's running balance on `211007`.
12. **Quantity × unit price:** the quantity has up to 3 decimals, the unit price up to 4; the line amount is their product rounded half away from zero to the currency's minor unit through the money module, per line; the document's total is the sum of its lines; a supplier's discount is its own negative line.
13. **Retention and recovery rates:** from the project's terms (and each subcontract's), computed on the period's work, rounded half away from zero; the accountant may change the amount on the document. A recovery never exceeds the advance's balance for the project.
14. **Billings are cumulative:** the accountant enters the cumulative certified value to date; the previous billings' cumulative is subtracted; the difference is the period's revenue. In the contract's currency.
15. **Contract value and budget** are in the contract's currency; the report compares the budget with the actual costs in the book ledger when the contract's currency is the book currency, and shows the budget without a variance otherwise.
16. **Subcontractor retention release:** the mirror of 10: Dr `211006` at its average carrying amount / Cr `211002` measured new; the residual realised.

## In scope / out of scope
- In:
  - five project document kinds, each a manual entry through S03's drafts, approval and posting, numbered per kind and fiscal year, printed in Arabic, cancelled by reversal (ADR 0023): `purchase` (فاتورة مشتريات المشروع), `wage_sheet` (كشف أجور), `progress_billing` (مستخلص), `subcontract_billing` (مستخلص مقاول باطن), `retention_release` (إفراج عن محتجزات, client or supplier side);
  - the materials catalogue (code, name, unit) and quantities on cost lines; an account flag `requires_material` (`511001` in `contracting@1`);
  - project terms (contract currency, contract value, retention and advance-recovery rates), the project budget per direct-cost account, and subcontracts (project × supplier, with their own rates);
  - the application of an advance (`212002`, `114002`) at its carrying amount in a billing or a purchase invoice (IFRIC 22.8–9; owner, 2026-11-14);
  - the project report, the material quantities report and their exports;
  - Q19 and Q20 answered.
- Out:
  - a store, stock and issues to projects (IAS 2; a later spec if needed);
  - payroll: taxes, social insurance, deductions, overtime rules (wages are amounts the accountant types);
  - revenue by the input method or any estimate of total costs (IFRS 15.B18–B19); onerous contracts (IAS 37.66–69): a manual entry if ever needed;
  - an automatic month-end accrual of unbilled work: a manual entry the accountant reverses by hand (auto-reversing entries are out, scope §8);
  - overhead allocation to projects (S09 rule 20: a direct contribution margin);
  - selling prices of materials and resale (Q18 is phase 2–3);
  - purchase orders, goods received notes, supplier credit notes as their own document (a negative purchase line or a reversal covers them);
  - a cashier or site-engineer role (phase 2).

## Access
No new permission key.

| Action | Surface | Who (permission) |
|---|---|---|
| Read projects, their terms, budgets, subcontracts, materials, documents and reports; print and export them | Web | Every role (`reports.read`; the terms and catalogue also `dimensions.read`); prints and exports are audited |
| Edit a project's terms and budget, subcontracts and the materials catalogue | Web | Owner, accountant (`dimensions.manage`) |
| Prepare a project document | Web | Owner, accountant (`drafts.manage`) |
| Post a project document, or submit it when approval is on | Web | Owner, accountant (`entries.post`); an approver approves (`entries.approve`, S03 rule 8) |
| Cancel a project document (reverse its entry) | Web | As a manual reversal (S03 rule 9), with rule 22's order for billings |
| Set `requires_material` on an account | Web | Owner, accountant (`accounts.manage`, S02) |

Every company write carries `X-Mizan-Company` and is refused on an archived company (S01).

## Data
All tables are company tables: `company_id`, forced RLS with `company_isolation`, `unique (company_id, id)`, composite company foreign keys, UUIDv7 ids, registered in `registry.ts` (ADR 0003). Money columns are `bigint` minor units with a currency (ADR 0007). Quantities and unit prices are `numeric`, never floats.

### Master data (business: edited and audited, archived rather than deleted)
| Table | Fields | Keys and checks |
|---|---|---|
| `materials` | `id`, `company_id`, `code` (text 1–30), `name` (text 1–200), `name_latin` (null), `unit` (text 1–20: طن، م³، كيس، قطعة…), `archived_at` (null), `created_at`, `updated_at` | unique `(company_id, code)`; `unit` locked after the material's first posted line (`MATERIAL_LOCKED`) |
| `project_terms` | `company_id`, `contract_value_id` → dimension values (a contract value of kind `project` with a client), `currency`, `contract_value_minor` (≥ 0), `retention_bp` and `advance_recovery_bp` (int 0–10000, basis points), `updated_at` | primary key `(company_id, contract_value_id)`; `currency` locked after the project's first posted billing (`PROJECT_TERMS_LOCKED`) |
| `project_budgets` | `company_id`, `contract_value_id`, `account_id` → chart accounts (postable, statement line `is.direct_costs`), `amount_minor` (≥ 0, in the terms' currency) | primary key `(company_id, contract_value_id, account_id)`; requires the project's terms |
| `subcontracts` | `id`, `company_id`, `contract_value_id`, `supplier_value_id` → dimension values (type `supplier`), `currency`, `value_minor` (null), `retention_bp`, `advance_recovery_bp`, `archived_at` (null) | unique `(company_id, contract_value_id, supplier_value_id)`; `currency` locked after the first posted subcontract billing |

### The chart (`chart_accounts`, S02)
| Field | Type | Rule |
|---|---|---|
| `requires_material` | boolean, default false | Only on a postable expense account (class 5). Joins S02 check 5's lock after first use. `contracting@1` sets it on `511001`; the migration sets it on `511001` of every company made from `contracting@1`. |

### Ledger additions (append-only, written only by `post()` in the posting transaction)
| Table | Fields | Keys and checks |
|---|---|---|
| `line_quantities` | `company_id`, `line_id` → journal lines, `material_id` (null) → materials, `unit` (text 1–20), `quantity` (`numeric(14,3)`), `unit_price` (`numeric(18,4)`, ≥ 0, null exactly when `quantity` is 0: a price adjustment) | primary key `(company_id, line_id)`; checks: when `quantity` ≠ 0, the line's `amount_minor` = round half away from zero of `quantity × unit_price × 10^minor units` (rule 6); a quantity of 0 only with a material; `material_id` set exactly when the line's account `requires_material`; with a material, `unit` is the material's |
| `advance_applications` | `company_id`, `entry_id`, `advance_line_id` → journal lines (the clearing line on `212002` or `114002`), `line_id` → journal lines (the revenue or cost line it measures), `amount_minor`, `book_minor`, `parallel_minor` (null without a parallel ledger) | primary key `(company_id, line_id)`; deferred guard (rule 12): per advance line, the sums of the three amounts equal the negation of that line's; both lines in the same entry and currency; each covered amount at most its line's |
| `project_documents` | `id`, `company_id`, `kind` (enum `project_document_kind`: `purchase` · `wage_sheet` · `progress_billing` · `subcontract_billing` · `retention_release`), `fiscal_year`, `number` (int ≥ 1), `project_sequence` (int, null: a billing's number within its project or subcontract), `document_date`, `entry_id` → journal entries, `draft_id` → drafts, `contract_value_id`, `counterparty_value_id` (null: the supplier, or the client of a billing), `side` (`client` · `supplier`, null: a retention release's), `currency`, `period_from`, `period_to` (null: a wage sheet's), `cumulative_minor`, `previous_minor`, `retention_minor`, `advance_minor` (null outside billings), `supplier_reference` (null, text 1–60), `created_at` | unique `(company_id, kind, fiscal_year, number)`; unique `(company_id, entry_id)`; unique `(company_id, draft_id)`; unique `(company_id, contract_value_id, counterparty_value_id, kind, project_sequence)` where `project_sequence` is not null; checks per kind on which fields are set |
| `project_document_sequences` | `company_id`, `kind`, `fiscal_year`, `last_number` | primary key `(company_id, kind, fiscal_year)`; ledger-state, updated only by the posting function |

`refuse_update()`, `refuse_delete()` and the `TRUNCATE` refusal on `line_quantities`, `advance_applications` and `project_documents`; all guards `ENABLE ALWAYS` and pinned in `GUARDS`. A document is never changed: a cancelled document is one whose entry is reversed.

**The integrity chain:** a line's quantity row and advance application join the hashed value of `chainEntryValue()` only when the line has one, as S04 did for the item id, so every entry posted before S12 hashes the same (S03 rule 18). Project documents are not hashed; the entry's description and reference carry the document's number.

### Drafts (S03)
`entry_drafts` gains the document's header: `project_document_kind` (null), `contract_value_id`, `counterparty_value_id`, `side`, `period_from`, `period_to`, `cumulative_minor`, `retention_minor`, `advance_minor`, `supplier_reference` (all null). A draft has at most one of `voucher_kind` and `project_document_kind` (a check). `entry_draft_lines` gains `material_id`, `unit`, `quantity`, `unit_price` (null; set together) and `advance_minor` (null: the covered amount the accountant typed on a purchase line, rule 12).

A **project document draft** holds the document as typed. `buildProjectDocument()` in `packages/ledger`, a pure function, derives the entry's lines from it at preview and at posting; `post()` derives them again and checks them (rules 3–21).

## States and rules

### Projects and master data
1. A **project** is a value of the built-in `contract` dimension of kind `project` with its client (S02). Its **terms** (currency, contract value, retention and advance-recovery rates) are required before its first billing (`PROJECT_TERMS_MISSING`). The currency is locked after the first posted billing; the value, the rates and the budget may change at any time, audited with before and after.
2. A **subcontract** pairs a project and a supplier value with a currency, an optional value and its rates; required before that supplier's first subcontract billing on that project (`PROJECT_TERMS_MISSING`).
3. A **material** has a code, a name and a unit. An archived material is refused on new lines (`MATERIAL_REQUIRED`, naming it); its lines stay readable. Its unit is locked after first use (`MATERIAL_LOCKED`).

### Quantities (N4)
4. Every line on an account with `requires_material` names a material and a quantity, in any document, manual entry or voucher (S11 payment vouchers included); otherwise `MATERIAL_REQUIRED`, naming the line. Reversals, revaluations and the opening carry no new quantities: a reversal's lines carry the negated quantities of the lines they reverse, the others none. Every line of a wage sheet carries a quantity of days, or none for a lump sum.
5. A quantity's sign is the line's: a debit is a quantity in, a credit (a return to the supplier) a quantity out. A supplier's discount or extra charge on a material is a line naming that material with the quantity 0.000 (rule 6).
6. **Line amount.** With a quantity ≠ 0, the line amount is `round_half_away_from_zero(quantity × unit_price)` in the currency's minor units, computed by the money module (`lineAmount()`), never typed. A line on a material account with quantity 0 is a **price adjustment** (a discount or an additional charge on that material): the accountant types its amount, the unit price is null, and the quantity report counts its amount but no quantity. The document's total is the sum of its lines.

### Project purchase invoice (N2)
7. A `purchase` names the project, the supplier (a `supplier` value), its date, an optional supplier's reference, and one or more cost lines: each on a postable expense account, with the project's contract dimension set by the document, and its material, quantity and unit price where rule 4 applies. All lines are in the document's currency. It posts the cost lines (Dr, new measurements) and one credit line on `211001` for the supplier (its running item, rule 3 of S04), the document's total less any advance applied.
8. A purchase may apply the supplier's advance on `114002` in the document's currency (rule 12). A second purchase with the same supplier and supplier's reference is not refused; the preview warns of it.
9. A cash purchase is a payment voucher (S11) whose counter lines are the cost lines with their quantities; rule 4 applies to it.

### Wage sheet (N3)
10. A `wage_sheet` names the project, a currency, a period (`period_from`–`period_to`, both in one calendar month) and is dated `period_to`. Each line names a worker (a `worker` value) and either days (quantity, up to 1 decimal place used, unit "يوم") × a daily rate, or a lump sum with a description (piece work, "مقطوعية"). A worker may appear on several lines. It posts, per line, Dr `511002` with the project and the worker on the line, new measurement; and per worker, Cr `211007`, the worker's running item, with the project on the line. A worker's debit balance on `211007` (an advance paid earlier) is netted by S04 rule 3: the credit clears it at its average carrying amount and the excess is a new measurement; the residual is realised (S04 rule 10).
11. Payment of wages is a payment voucher (S11) on `211007` per worker.

### Advances applied at their carrying amount (IFRIC 22)
12. **Application.** A billing's advance recovery, or a purchase's or subcontract billing's applied advance, is a clearing line on the advance's running item (`212002` for the client, `114002` for the supplier) in the document's currency (`ADVANCE_CURRENCY_MISMATCH` for another currency, owner answer 6), at most the advance's balance carried for this project (the item's lines with this contract) and at most the item's balance (`RELEASE_EXCEEDS_BALANCE`). It clears at the average carrying amount of the project's share of the item, the item's lines with this contract (S04 rule 3 applied to that share; owner, 2026-11-16), so an advance received for another project never measures this one's revenue or cost (IFRIC 22.9). The **covered part** of the revenue or cost line it pays for takes exactly those carried book and parallel amounts; the rest of the line is a new measurement at the date's policy rate. So no exchange difference arises on the advance (IFRIC 22.8–9). An `advance_applications` row records each covered part. A line partly covered has one line in the entry: its book amount is the covered carried amount plus the converted rest, and the preview and the print show both parts. In a purchase the accountant gives the covered amount per cost line (default: allocated across the lines in proportion to their amounts with cumulative rounding, ADR 0007); each ledger's carried amounts are allocated across the covered lines the same way.
13. An application never crosses the item's zero: a recovery larger than the balance is refused (rule 12), never split into an `add`.

### Client's progress billing
14. A `progress_billing` names the project and is dated in an open period, in the project's terms' currency. The accountant enters the **cumulative certified value** to date. The **previous** value is the cumulative of the project's latest posted, uncancelled billing (0 for the first). The **period's value** = cumulative − previous, which must be greater than zero (`BILLING_NOT_INCREASING`); a cumulative above the contract value is allowed with a warning (variations).
15. **Deductions:** retention = `round_half_away_from_zero(period's value × retention_bp / 10000)`; advance recovery = the same with `advance_recovery_bp`, capped at the project's advance balance (rule 12); both amounts may be changed by the accountant, each ≥ 0. **Net** = period's value − retention − recovery, ≥ 0 (`VALIDATION_FAILED` otherwise).
16. It posts: Dr `112001` a new document item (reference: the billing's printed number) for the net with client and project, when the net is not zero; Dr `113002` a new document item for the retention, when not zero; Dr `212002` the recovery (clearing, rule 12); Cr `411001` the period's value with client and project, its covered part at the advance's carrying amounts and the rest a new measurement. The billing's `project_sequence` is the project's next billing number.
17. **Month-end adjustments** (owner answer 3): work done and not certified at month end is a manual entry Dr `113001` (a document item) / Cr `411001`; a billing in excess of work done is Dr `411001` / Cr `212001`. The accountant reverses them on the first day of the next month (S03 rule 9). They are not project documents.

### Subcontractor's billing
18. A `subcontract_billing` names the project and the supplier (its subcontract, rule 2), in the subcontract's currency, cumulative as rule 14 per subcontract, deductions as rule 15 with the subcontract's rates and its advance on `114002`. It posts: Dr `511003` the period's value with the project and the supplier, its covered part at the advance's carrying amounts; Cr `211006` the retention (the supplier's running item, with the project on the line), new measurement; Cr `114002` the recovery (clearing); Cr `211002` the net (the supplier's running item), new measurement.

### Retention release
19. **Client side** (`side = client`): names the project and one or more retention items on `113002` of the project, each with the amount released (≤ its open amount). It posts Cr each item (cleared in proportion to what remains, S04 rule 4), Dr `112001` one new document item for their sum with the client and the project (reference `إفراج <fiscal year>/<number>`, since a billing of the same year and number names its own item on `112001` `<fiscal year>/<number>`; owner, 2026-11-16), new measurement; each ledger's residual is a realised exchange difference (S04 rule 10; IAS 21.28; IFRS 15.108).
20. **Supplier side** (`side = supplier`): names the project and the supplier and the amount released, at most the supplier's retention balance carried for the project on `211006` (the running item's lines with this project, `RELEASE_EXCEEDS_BALANCE`). It posts Dr `211006` with the project, cleared at the average carrying amount of the project's share of the item (S04 rule 3 applied to that share, as rule 12; owner, 2026-11-16) / Cr `211002`, the supplier's running item with the project on the line (new measurement); the residual realised.

### All documents
21. A project document follows S03 rules 4–11: saved as typed, submitted when approval is on, posted by `post()`, refused whole on any failure. At posting, in the same transaction, the function takes the next number of the document's kind and fiscal year (the fiscal year of the document date), and for a billing the next `project_sequence`, writes `project_documents`, `line_quantities` and `advance_applications`, and sets the entry's reference to the printed number when left empty. A refusal consumes no number. Every line follows S02 rule 8 (accounts, currencies, dimensions), S03 rules 12–16, S04 and S07, and S11 rule 8 (a box never negative) where a cash line appears.
22. **Cancelling** a document is reversing its entry (S03 rule 9); it keeps its number and prints "ملغى" with the reversal's number. A billing (client or subcontract) is cancelled only while it is the latest uncancelled billing of its project or subcontract (`PROJECT_DOCUMENT_NOT_LATEST`), so the cumulative chain stays true; a billing whose `112001` item has a receipt is refused (`OPEN_ITEM_HAS_SETTLEMENTS`, S04) until the receipt is reversed. Reversing a recovery puts the advance back at exactly what it cleared (S04 rule 13: a reversal with the balance posts no difference entry).

## Accounting treatment

| Operation | Entry | Basis |
|---|---|---|
| Project purchase invoice | Dr `511001`–`511006` (project; material and quantity on `511001`), new measurement / Cr `211001` supplier's running item, new measurement (or clearing a debit balance at its average, the residual realised) | IAS 1.102 (by nature); IAS 21.21–22; S04 rule 3 |
| Purchase applying a supplier's advance | as above, with Cr `114002` cleared at the project's share's average carrying amount and the covered cost at those amounts | IFRIC 22.8–9; IAS 21.23(b) |
| Wage sheet | Dr `511002` (project, worker), new measurement / Cr `211007` per worker, running | IAS 19.11 (short-term benefits as an expense when the service is rendered); S04 rule 3 |
| Client's progress billing | Dr `112001` net (new item), Dr `113002` retention (new item), Dr `212002` recovery (cleared at the project's share's average) / Cr `411001` period's value: covered part at the advance's carrying amount, rest new | IFRS 15.35(b), 15.B15 (output method); IFRS 15.105–108 (contract asset, receivable, contract liability); IFRIC 22.8 |
| Month-end work done, not billed · billed in excess | Manual: Dr `113001` / Cr `411001` · Dr `411001` / Cr `212001`; reversed next month by hand | IFRS 15.105–107 |
| Subcontractor's billing | Dr `511003` period's value (covered part at the advance's carrying amount) / Cr `211006` retention (new), Cr `114002` recovery (cleared), Cr `211002` net (new) | IAS 1.102; IFRIC 22.8; S04 rule 3 |
| Client retention release | Dr `112001` new item / Cr `113002` item(s) cleared in proportion; residual realised | IFRS 15.108; IAS 21.28; S04 rule 10 |
| Subcontractor retention release | Dr `211006` cleared at the project's share's average / Cr `211002` new; residual realised | IAS 21.28 |
| Cancellation | The exact reversal; items and advances reopen at their earlier carrying amounts | S03 rule 9; S04 rule 13 |

**Revaluation** (S07, unchanged): `112001`, `113001`, `113002`, `211001`, `211002`, `211006`, `211007` are monetary and revalued at month end per counterparty or item and currency; the advances `114002` and `212002` are non-monetary and never revalued (IAS 21.16, IFRIC 22). A billing's revenue and a cost's carried part therefore stay at the advance's historical rate.

**Example** (the client's shape: USD book at market accepting dealt rates, SYP parallel at the bulletin; project P1 of client C1, terms USD, contract value 100,000.00, retention 10%, advance recovery 20%):

Advance receipt, Monday 2 November 2026, bulletin 115.0000 SYP per USD: 20,000.00 USD into the USD bank, Cr `212002` C1 (P1 on the line): carried 20,000.00 USD and 2,300,000.00 SYP.

Progress billing 1, Thursday 31 December 2026, bulletin 120.0000: cumulative 30,000.00 USD, previous 0, period's value 30,000.00; retention 3,000.00; recovery 6,000.00; net 21,000.00.

| Account | Currency | Amount | Book (USD) | Parallel (SYP) |
|---|---|---|---|---|
| 112001 C1, P1, item "مستخلص 2026/1" | USD | 21,000.00 | 21,000.00 | 2,520,000.00 (× 120) |
| 113002 C1, P1, retention item | USD | 3,000.00 | 3,000.00 | 360,000.00 (× 120) |
| 212002 C1 (P1), cleared 6,000 of 20,000 at the average | USD | 6,000.00 | 6,000.00 | 690,000.00 (6/20 × 2,300,000) |
| 411001 C1, P1 (covered 6,000 at the advance's carrying amount; 24,000 at 120) | USD | −30,000.00 | −30,000.00 | −3,570,000.00 (690,000 + 2,880,000) |

No difference line: the revenue's parallel amount is 3,570,000.00, not 3,600,000.00, because the part paid in advance stays at 2 November's rate (IFRIC 22.8).

Project purchase invoice, Thursday 3 December 2026, market 34.0000 TRY per USD, bulletin 3.5000 SYP per TRY, supplier S1, P1:

| Account | Currency | Amount | Book (USD) | Parallel (SYP) |
|---|---|---|---|---|
| 511001 P1, cement, 12.500 طن × 3,150.0000 | TRY | 39,375.00 | 1,158.09 (÷ 34) | 137,812.50 (× 3.5) |
| 511001 P1, reinforcing steel, 2.000 طن × 23,800.0000 | TRY | 47,600.00 | 1,400.00 | 166,600.00 |
| 211001 S1 (P1 on the line) | TRY | −86,975.00 | −2,558.09 | −304,412.50 |

Wage sheet, 1–15 December 2026, dated Tuesday 15 December, bulletin 120.0000, P1: worker W1 6 days × 25.00 USD = 150.00; craftsman W2 a lump sum of 400.00 USD ("نجارة قوالب الطابق الأول"): Dr `511002` (P1, W1) 150.00 USD / 18,000.00 SYP and (P1, W2) 400.00 USD / 48,000.00 SYP; Cr `211007` W1 150.00 and W2 400.00 with the same amounts.

These numbers are confirmed in the scenarios below before any code (`/posting-rule`).

## Currencies, rates and rounding
- Every new measurement converts per ledger at the policy rate in force on the document date (S02 rule 16), or at a dealt rate for the book ledger that accepts it (S03 rule 13). A missing rate refuses the posting with `RATE_MISSING`; the draft stays.
- Carried amounts (an advance cleared, a retention cleared, a running item's debit balance cleared) read no rate (ADR 0007).
- **Line amounts** from quantities are computed once, per line, rounded half away from zero (rule 6); a document's total is the sum of its lines, never recomputed from a total.
- **Retention and recovery** are each rounded half away from zero from the period's value; the net takes the remainder, so the parts sum exactly.
- **An applied advance's covered amounts** are the clearing line's carried amounts; across several covered lines of a purchase they are allocated with cumulative rounding in each ledger separately (ADR 0007), so they sum exactly to the clearing line.
- **Residuals:** an entry with a carried line posts each ledger's residual as a realised difference (S04 rule 10). A billing or purchase whose only carried line is an applied advance has no residual from it, since the covered part takes its amounts; a residual can still come from conversion rounding of the new measurements in a ledger whose currency is not the document's, and posts as S04 rule 10 says.
- The four shapes: `usd-syp` with TRY is the client's and the scenarios' main shape; the scenarios also run a billing with an advance in `syp` (a USD contract, a book that moves) and in `syp-usd`.

## Periods
- A document's date follows S03 rule 6; a closed period refuses it (`PERIOD_CLOSED`). A wage sheet's period lies in one calendar month and the document is dated its last day, so the month of the wage is the month of the cost.
- Project document drafts are drafts: S07's checklist item "no drafts or unapproved entries" counts them. No new checklist item.
- A billing's previous cumulative reads posted billings regardless of their dates; billings of one project are numbered in posting order, and a billing dated before the project's latest billing is refused (`VALIDATION_FAILED`), so the cumulative chain follows the dates.
- Document numbers restart each fiscal year by document date; `project_sequence` runs through the project's life across years.
- A back-dated cost into an open, revalued month makes that month's revaluation stale only when it touches a monetary item revalued there (S07).

## API
All under `/api`, with `X-Mizan-Company`; lists are cursor-paged (S01 pattern). Schemas in `packages/contracts/src/projects.ts` (new), and `chart.ts`, `entries.ts`, `reports.ts`.

| Method and path | Access | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/materials` · `POST` · `PATCH /api/materials/:id` · `POST /api/materials/:id/archive` | `dimensions.read` · `dimensions.manage` | code, name, nameLatin, unit; `q`, `archived` | the material(s) | `VALIDATION_FAILED`, `DIMENSION_CODE_TAKEN`, `MATERIAL_LOCKED` |
| `GET /api/projects/:valueId/terms` · `PUT` | `dimensions.read` · `dimensions.manage` | currency, contractValueMinor, retentionBp, advanceRecoveryBp, budget `[{ accountId, amountMinor }]` | the terms and budget | `NOT_FOUND`, `VALIDATION_FAILED`, `PROJECT_TERMS_LOCKED` |
| `GET /api/subcontracts` · `POST` · `PATCH /api/subcontracts/:id` | `dimensions.read` · `dimensions.manage` | contract, supplier, currency, valueMinor, retentionBp, advanceRecoveryBp | the subcontract(s) | `VALIDATION_FAILED`, `PROJECT_TERMS_LOCKED` |
| `PUT /api/chart/accounts/:id` (S02) | `accounts.manage` | gains `requiresMaterial` | the account | S02's |
| `POST /api/drafts` · `PUT /api/drafts/:id` (S03) | `drafts.manage` | gains `projectDocument: { kind, contractValueId, counterpartyValueId?, side?, periodFrom?, periodTo?, cumulativeMinor?, retentionMinor?, advanceMinor?, supplierReference?, retentionItems? }`; lines gain `materialId`, `unit`, `quantity`, `unitPrice`, `advanceMinor` | the draft with its document | S03's, `PROJECT_TERMS_MISSING`, `MATERIAL_REQUIRED` |
| `POST /api/drafts/:id/preview` · `/submit` · `/post` · `/approve` (S03) | as S03 | as S03 | as S03, plus the document's kind, the derived lines, the previous cumulative and deductions, each covered part, the warnings (duplicate supplier reference, cumulative above contract value); after posting, its number | S03's, S04's, S11's `CASH_BOX_NEGATIVE`, `PROJECT_TERMS_MISSING`, `MATERIAL_REQUIRED`, `ADVANCE_CURRENCY_MISMATCH`, `BILLING_NOT_INCREASING`, `RELEASE_EXCEEDS_BALANCE` |
| `POST /api/entries/:id/reverse` (S03) | `entries.post` | as S03 | as S03 | S03's, `PROJECT_DOCUMENT_NOT_LATEST` |
| `GET /api/project-documents` | `reports.read` | `kind`, `contract`, `counterparty`, `from`, `to`, `state` (`posted` · `cancelled`), cursor | documents with number, date, project, counterparty, total, entry and state | — |
| `GET /api/project-documents/:id` | `reports.read` | — | the document with its entry, quantities and applications | `NOT_FOUND` |
| `GET /api/projects` | `reports.read` | `asOf`, `ledger`, `archived` | each project: contract value, cumulative billed and its share of the value, revenue, direct costs, contribution, retention receivable, advance balance, budget total | — |
| `GET /api/projects/:valueId/report` | `reports.read` | `from`, `to`, `ledger` | the project report (Reports section) | `NOT_FOUND`, `VALIDATION_FAILED` |
| `GET /api/reports/material-quantities` | `reports.read` | `from`, `to`, `contract?`, `material?`, `ledger` | per project and material: quantity in, quantity out, net, amount, average unit cost in the transaction currency and the ledger's amount | `VALIDATION_FAILED` |
| `GET /api/projects/:valueId/report/export` · `GET /api/reports/material-quantities/export` | `reports.read` | as above, `format=xlsx` | the workbook, audited `export.project_report` · `export.material_quantities` | as above, `REPORT_TOO_LARGE` |
| `POST /api/reports/files` (S09) | `reports.read` | `report`: `project_report`, `material_quantities` or `project_document` (`document`) | the PDF queued (S09) | S09's, `NOT_FOUND` |
| `GET /api/reports/lines` (S09) | `reports.read` | gains `material` | the lines behind a figure | as S09 |

New error codes, appended to the registry:

| Code | Status | When |
|---|---|---|
| `PROJECT_TERMS_MISSING` | 422 | A billing on a project without terms, or a subcontract billing without its subcontract (rules 1–2) |
| `PROJECT_TERMS_LOCKED` | 409 | A project's or subcontract's currency changed after its first posted billing (rule 1) |
| `MATERIAL_REQUIRED` | 422 | A line on an account that requires a material lacks one or its quantity, or names an archived material (rules 3–4) |
| `MATERIAL_LOCKED` | 409 | A material's unit changed after its first use (rule 3) |
| `ADVANCE_CURRENCY_MISMATCH` | 422 | An advance applied in another currency than the document's (rule 12) |
| `BILLING_NOT_INCREASING` | 422 | A billing's cumulative is not above the previous cumulative (rule 14) |
| `PROJECT_DOCUMENT_NOT_LATEST` | 409 | A billing cancelled while a later uncancelled billing of its project or subcontract exists (rule 22) |

Posting stays idempotent by the draft id (S03); one document per draft (`unique (company_id, draft_id)`).

## Jobs and events
- No job. No event is received or emitted. Document PDFs and the project report's PDF are rendered by the worker's existing PDF printing (S09), on request.

## Screens
Design-system components only (ADR 0010). New general components in `packages/ui` first, built for accounting work and tested: `QuantityCell` (a quantity with its unit and up to 3 decimals, Latin digits, LTR-isolated like `Amount`), `MaterialPicker` (code or name search, unit shown, `Alt+↓`), `BillingSummary` (cumulative, previous, period's value, retention, recovery, net, each through `Amount`), and `BudgetVarianceBar` (budget, actual, variance and its share, a negative variance in the negative colour).

| Route | Purpose and content | Actions | States | Roles |
|---|---|---|---|---|
| `/projects` | The projects (`GET /api/projects`): one row per project with its client, contract value, billed to date and its share, costs, contribution, retention receivable and advance balance | Open a project; new document from the toolbar; export | Empty: "لا توجد مشاريع" with a link to `/dimensions`; loading; archived projects hidden by default | Every role reads; owner and accountant act |
| `/projects/:valueId` | The project report (Reports section) in tabs: الملخص، التكاليف والموازنة، المواد، الأجور، مقاولو الباطن، المستخلصات، المستندات | Range, ledger, export Excel or PDF; every figure drills to its lines (`/reports/lines`), every document opens | Without terms: a notice with the link to the terms | As above |
| `/projects/:valueId/terms` | The terms, the budget per direct-cost account and the project's subcontracts | Save; add or edit a subcontract | Locked currency shown as locked | Owner and accountant edit; others read |
| `/projects/documents` | The register of project documents by kind, project, counterparty, date and state | Open, print, cancel (reverse) | Empty, loading | As above |
| `/projects/documents/new/:kind`, `/drafts/:id` (S03) | The document form: the header (project, counterparty, date, period, cumulative), then its lines. A purchase uses S03's fast line editor with `MaterialPicker` and `QuantityCell` (amount computed); a wage sheet has a row per worker (days and daily rate, or lump sum and description); a billing shows `BillingSummary` with editable deductions; a release lists the open retentions | Save, submit or post, discard, print after posting | The preview shows every derived line in both ledgers, each covered part and the warnings; a refusal names the line | Owner and accountant prepare and post; approvers approve |
| `/materials` | The materials catalogue | Add, edit, archive | Empty, loading; locked unit shown | Owner and accountant edit; others read |
| `/reports/material-quantities` | Rule-free report of quantities per project and material | Filters, export | As S09 | Every role |
| `/chart` (S02) | The account sheet gains "يتطلب مادة" on an eligible account | As S02 | Locked after first use | As S02 |

The command palette gains "فاتورة مشتريات مشروع"، "كشف أجور"، "مستخلص"، "مستخلص مقاول باطن"، "إفراج عن محتجزات"، "تقرير مشروع…" and "دليل المواد". Every screen is RTL and works from 360 px; on a phone the document lines stack as cards.

## Reports
- **The project report** for a project, a range and a ledger (book by default):
  - **Summary:** contract value and currency; cumulative certified to date and its share of the contract value; revenue in the range (`is.revenue` lines with the project); direct costs in the range (`is.direct_costs` lines with the project); contribution and margin (S09 rule 20); retentions receivable and the client's advance balance for the project at `to`; the subcontractors' retentions payable and advances paid for the project at `to`.
  - **Costs and budget:** per direct-cost account, the range's cost and the cost to date against the budget, with the variance when the contract's currency is the book currency and the ledger is the book (owner answer 15); otherwise the budget without a variance.
  - **Materials:** per material, quantity, amount in the transaction currency and in the ledger, average unit cost; price adjustments counted in the amount only.
  - **Wages:** per worker, days, lump sums and amount; the worker's running balance at `to`.
  - **Subcontracts:** per supplier, the subcontract value, cumulative billed, retention held, advance balance, paid (the running item's clearing movements in the range).
  - **Billings:** each billing with its cumulative, previous, period's value, deductions, net, state and settlement.
- **Reconciliation to the ledger:** the summary's revenue and direct costs equal S09's profitability by contract for the same range and ledger; costs by account sum to the direct costs; the materials' amounts equal the `511001` lines of the project; each billing's period's value equals its `411001` line; the retentions and advances equal the item balances per contract. Each is a test, and every figure drills to the lines that make it (S09 rule 6).
- **Material quantities** across projects: per project and material; its amounts equal the `requires_material` accounts' lines in the range.
- S09's income statement, balance sheet, contract-position netting (rule 17) and profitability read the new entries with no change.

## Printing and legal books
All A4 portrait unless stated, Arabic, RTL, from the worker's PDF printing, with the company's name, the document's kind and number (`2026/15`), its date, the project and its client, amounts through the money module, Latin digits, SYP labelled "الليرة السورية الجديدة", the entry number, the preparer and the approver, and "ملغى" with the reversal's number when cancelled.
- **Progress billing (مستخلص):** "المستخلص رقم n" of the project as well as its company number; the contract value; cumulative certified to date, previous, the period's value; retention and its rate; advance recovery and its rate; the net due, in figures and in words (`amountInWords()`, S11); signature lines (المهندس المشرف، مدير المشروع، المحاسب، المدير).
- **Subcontractor's billing:** the same layout, with the supplier and the subcontract.
- **Project purchase invoice (A5):** the supplier and the supplier's reference, each line with account, material, quantity and unit, unit price and amount, the total in figures and words, any advance applied.
- **Wage sheet (A4 landscape):** the period, one row per line with the worker, days, daily rate or the lump sum's description, the amount, and a signature column "توقيع العامل"; totals per worker and for the sheet in words.
- **Retention release:** the retentions released with their billings, the amount in figures and words.
- **Project report** and **material quantities:** as S09's statements, with page numbers.

## Volume and performance
- The contractor: up to 10 active projects; 200 purchase lines, 8 wage sheets of up to 40 lines, 4 billings and 4 subcontract billings a month a company; 300 materials; 100 counterparties.
- The project report reads the period balances per month and dimension set for whole months and the lines of at most two partial months, by the index `(company_id, entry_date)` on the lines (S03); the materials and wages tabs read the project's lines with their quantities by a new index `(company_id, line_id)` on `line_quantities` and the dimension sets of the project: ≤ 2 s for a project's life of 3 years.
- A billing reads the project's latest billing by `(company_id, contract_value_id, counterparty_value_id, kind, project_sequence)` and the advance's per-contract balance from the item's movements: under S03's posting target.

## Migration and compatibility
- **`packages/contracts`:** `projects.ts` (materials, terms, budgets, subcontracts, documents, the project report and material quantities); drafts gain the document header and line quantities; `chart.ts` gains `requiresMaterial`; `REPORTS` gains `project_report`, `material_quantities`, `project_document`; the error codes and audit actions appended; `contracting@1`'s `511001` gains `requiresMaterial` (the template's version stays 1, since no company of it is in production and the migration sets the flag on companies made from it; owner, 2026-11-16).
- **`packages/db` (`/db-migration`):** the enum `project_document_kind`; `materials`, `project_terms`, `project_budgets`, `subcontracts`; `chart_accounts.requires_material` with its check and lock; `line_quantities`, `advance_applications`, `project_documents`, `project_document_sequences` with grants, RLS, guards and registry entries; the drafts' columns; `post()` gains the document numbering, the quantity rows, the advance applications and the guard of rule 12; `chainEntryValue()` gains the quantity and application only when present. No guard is weakened; existing entries hash the same.
- **`packages/ledger`:** `buildProjectDocument()` (the five kinds, deductions, the cumulative chain, the allocation of covered amounts), `lineAmount()`, and the IFRIC 22 measurement of a covered line, pure functions with property tests.
- **`apps/api`, `apps/web`, `apps/worker`:** the endpoints, screens and prints above.
- **The scenario book:** the step `project_document` (a document as typed, with its kind and header), the expectations `project_documents` and `quantities`, and the reports expectation `project_report`, read by the runner; executors come with the slice.

## Arabic strings and number formats
- New i18n namespace `projects` (the document kinds: فاتورة مشتريات المشروع، كشف أجور، مستخلص، مستخلص مقاول باطن، إفراج عن محتجزات; التراكمي حتى تاريخه، السابق، قيمة الفترة، المحتجزات، استرداد الدفعة المقدمة، الصافي المستحق، الجزء المغطى بالدفعة المقدمة; قيمة العقد، الموازنة، الفعلي، الانحراف; أيام، الأجر اليومي، مقطوعية; ملغى), and `materials` (دليل المواد، الرمز، الاسم، الوحدة، الكمية، سعر الوحدة، متوسط تكلفة الوحدة، تعديل سعر).
- Quantities print with up to 3 decimals, unit prices with up to 4, Latin digits; percentages from basis points with up to 2 decimals; document numbers `<year>/<number>`; dates `YYYY-MM-DD`.
- Glossary rows: project document, project purchase invoice, wage sheet, daily rate, piece work, cumulative billing, period's value, advance recovery, advance application, covered part, retention release, subcontract, materials catalogue, quantity, unit price, price adjustment, project terms, contract value, project budget, output method.

## Audit
In the same transaction (S01 rule 23): `material.created`, `material.updated`, `material.archived`; `project_terms.updated` and `subcontract.created` / `.updated` with before and after (the budget included); `account.updated` with `requires_material`; a document's posting, submission, approval and reversal as S03's entry actions with the document's kind and number; `export.project_report`, `export.material_quantities` and `export.project_document` for each export or print.

## Abuse and failure cases
- **Double submit or replay:** posting is idempotent by the draft; one document per draft.
- **Two billings of one project at once:** both lock the project's latest billing row (`FOR UPDATE` on the sequence of its project) after the head lock; the second reads the first's cumulative and is refused if not increasing.
- **An advance recovered twice:** the advance's item balance is read `FOR UPDATE` (S04 rule 4); the second recovery beyond the balance is refused.
- **A cancelled billing in the middle of the chain:** refused by rule 22.
- **Editing a posted document or its quantities:** refused by the table guards; a correction is a reversal and a new document.
- **Quantities that do not match amounts:** the check on `line_quantities` refuses any row whose amount is not the rounded product.
- **Race with a close:** S07's period lock serialises posting and close.
- **Cross-company access:** RLS on the new tables, composite foreign keys (the material, the project, the supplier, the lines), every endpoint tested as another company's member; the isolation property test covers the new tables.
- **A stolen session:** documents need `entries.post`; approval, when on, needs a second person (S03 rule 8).
- **Back-dated documents:** a billing before the project's latest is refused; other documents follow S03 rule 6 and S11 rule 8.

## Edge cases
1. A purchase line with quantity 0 on `511001` and no typed amount: refused (`VALIDATION_FAILED`); with an amount, a price adjustment (rule 6).
2. A quantity × price giving half a minor unit (0.125 × 0.0300 USD = 0.00375 → 0.00): a line of zero is refused (`VALIDATION_FAILED`, S03 edge case 3).
3. A purchase on a project archived since the draft was saved: refused (`DIMENSION_VALUE_ARCHIVED`).
4. A purchase in USD applying a TRY advance: `ADVANCE_CURRENCY_MISMATCH`.
5. A recovery equal to the advance's whole balance: clears it to zero in both ledgers (S04 rule 4).
6. A client advance received for P1 and P2 in one running item: a P1 billing recovers at most P1's share (its lines with P1), cleared at the average of that share, never the item's (rule 12; owner, 2026-11-16).
7. A first billing with cumulative 0 or negative: `BILLING_NOT_INCREASING`.
8. A billing whose deductions equal the period's value: no `112001` line; the net is zero.
9. A billing above the contract value: posted, with the warning.
10. Cancelling billing 2 of 3: `PROJECT_DOCUMENT_NOT_LATEST`; cancel 3, then 2.
11. Cancelling a paid billing: `OPEN_ITEM_HAS_SETTLEMENTS`; reverse the receipt first.
12. A wage sheet from 25 December to 5 January: refused (`VALIDATION_FAILED`, one calendar month).
13. A worker with a debit balance of 100.00 (an advance) and a wage of 150.00: the credit clears 100.00 at its average and adds 50.00 new; the residual realised.
14. A wage sheet in TRY in the USD book: new measurements at market; the parallel at the bulletin.
15. A missing TRY/SYP bulletin on the document date: `RATE_MISSING`, the draft stays (S02 rule 16; Q10).
16. `syp` (one ledger) with a USD contract and a USD advance received at 115 SYP: the billing at 120 takes the covered revenue at 115; no difference line.
17. `syp-usd`: the same in both ledgers; the USD parallel ledger has no effect on a USD advance.
18. A retention release in USD in the USD book: the book residual is zero; the parallel residual is realised at the bulletin's change since the billing.
19. A supplier retention release larger than the supplier's retention for the project: `RELEASE_EXCEEDS_BALANCE`.
20. A material archived with lines in an open month: its lines and quantities stay in the reports; new lines refuse it.
21. A project's currency changed before its first billing: allowed; after it: `PROJECT_TERMS_LOCKED`.
22. A budget on an account that is not a direct cost: `VALIDATION_FAILED`.
23. A manual entry on `511001` without a material: `MATERIAL_REQUIRED` (rule 4).
24. A payment voucher buying cement for cash: its `511001` line carries the material and quantity; the box rule of S11 applies.
25. A billing dated before the project's previous billing: `VALIDATION_FAILED`.
26. A month-end accrual on `113001` reversed on the 1st, then the billing that certifies the work: the revenue of the two months sums to the billing's period's value.

## Scenarios
Accounting rules this spec introduces, each written and approved through `/posting-rule` before its code, in the `usd-syp` shape with TRY unless stated:
- **`docs/scenarios/projects/purchase-invoice.md`:** the TRY purchase of the example with quantities; a purchase with a price adjustment line; a purchase applying a TRY advance on `114002` paid at an earlier market and bulletin rate (the covered cost at the advance's carrying amounts, allocated across two lines with cumulative rounding, no difference); a purchase clearing a supplier's debit balance on `211001` (the residual realised); a cash purchase through a payment voucher; refusals: a missing material, an advance in another currency, a recovery beyond the balance; the cancellation that puts the advance back.
- **`docs/scenarios/projects/wage-sheet.md`:** the example's sheet (days and a lump sum); its payment by payment vouchers; a worker with an earlier advance netted in the sheet; a TRY sheet; a sheet across two months refused; the cancellation.
- **`docs/scenarios/projects/progress-billing.md`:** the example's advance and first billing (IFRIC 22 in the parallel ledger); a second cumulative billing with its previous; a receipt of the net; the month-end accrual on `113001` and its reversal; a billing in excess on `212001`; refusals: not increasing, cancelling a billing that is not the latest; the cancellation of the latest that restores the advance; the same billing in `syp` and `syp-usd`.
- **`docs/scenarios/projects/subcontract-billing.md`:** an advance to a subcontractor on `114002` in TRY, then a cumulative subcontract billing with retention and recovery (the covered cost at the advance's carrying amounts), then its payment; a second billing.
- **`docs/scenarios/projects/retention-release.md`:** the client's retentions of two billings released into one receivable after the bulletin moved (a parallel realised difference), then received; a supplier's retention released into `211002` and paid; a release beyond the balance refused.
- **`docs/scenarios/reports/project-report.md`:** the project report of P1 after the cases above: its summary, costs against the budget, materials, wages, subcontracts and billings, and its agreement with S09's profitability by contract and the balance sheet's contract positions.

## Open questions
- **Q10 (unchanged, UNVERIFIED):** the TRY bulletin is assumed daily; checked before the client's first company.
- **Q1 (unchanged, UNVERIFIED):** the tax authority's acceptance of statutory books kept as the SYP parallel ledger.
- **A store for materials** (Q19's other branch): not needed now (owner, 2026-11-16); a later spec under IAS 2 if the client keeps stock.
- None blocks S12.

## Acceptance
- **The owner's end-to-end check** (the test company of S11's acceptance, "شركة مقاولات تجريبية"):
  1. Record the bulletin for 2 November (115.0000 SYP per USD) and 1–31 December (120.0000 SYP per USD, 3.5000 SYP per TRY) and the market for 3 December (34.0000 TRY per USD).
  2. In `/materials`, add "أسمنت بورتلاندي" (طن) and "حديد تسليح" (طن). Open the project "مشروع البناء التجريبي": set its terms (USD, 100,000.00, retention 10%, recovery 20%) and a budget of 40,000.00 on `511001` and 15,000.00 on `511002`.
  3. Post a receipt voucher of 20,000.00 USD into the USD bank on 2 November, Cr `212002` for the client and project.
  4. Post the project purchase invoice of the example on 3 December: the project report's materials tab shows 12.500 طن of cement for 1,158.09 USD and 2.000 طن of steel for 1,400.00 USD; costs against the budget show 2,558.09 of 40,000.00.
  5. Post the wage sheet of 1–15 December: W1 6 days × 25.00, W2 400.00 lump; the wages tab shows both; pay W1 with a payment voucher and see W1's balance at zero.
  6. Post progress billing 1 on 31 December (cumulative 30,000.00): the preview shows retention 3,000.00, recovery 6,000.00 and net 21,000.00, and in the parallel ledger revenue of 3,570,000.00 SYP with its covered part; print it and read the net in words.
  7. Try billing 2 with a cumulative of 25,000.00: refused (`BILLING_NOT_INCREASING`).
  8. Open `/reports/profitability` by contract for December: the project's revenue and direct costs equal the project report's.
  9. Cancel billing 1: the advance balance returns to 20,000.00 USD and 2,300,000.00 SYP.
- **Tests:**
  - API: success, 401, 403, another company and an idempotent replay per endpoint;
  - unit and property tests: `lineAmount()`; `buildProjectDocument()` for each kind (deductions sum to the period's value; the net never negative; the cumulative chain); the IFRIC 22 covered amounts (they sum to the clearing line in every ledger under any split; the entry balances with no residual from the advance); the cancellation order; quantities in the reports equal the lines;
  - database tests as `mizan_app`: the guards on the new append-only tables, the `line_quantities` amount check, the `advance_applications` guard, the `requires_material` check and lock, gapless numbers per kind and year under concurrent postings, isolation;
  - the scenario book: the six files above;
  - E2E with RTL screenshots at 360 px and desktop: the projects list, a project report, a purchase invoice with quantities, a wage sheet, a billing with its print, the materials catalogue.
