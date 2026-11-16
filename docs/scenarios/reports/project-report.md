# The project report

Status: Approved (owner, 2026-11-16)

The project report reads what S12's documents posted; it posts nothing. The figures of the four cases were approved by the owner on 2026-11-16, with five readings of S12 "Reports": the billings are every billing of the project up to `to`, each with what remains of its receivable; a worker's balance and a subcontractor's payments are the counterparty's running item, every project's, since a payment carries no project; materials are one row per material and transaction currency; the share of the budget used is the cost to date over the budget; and the variance shows only in the book ledger when the terms are in the book currency (S12 answer 15), not in a parallel ledger in the terms' currency. S12's third PR brought the project report's reader and switched the cases to `Approved` with no expected value changed. Its accounting review added a fifth case, the revaluation of a subcontractor's retentions shared over its projects (owner's decision, 2026-11-16), whose figures the owner approved the same day.

## Rule

The project report presents one project for a range and a ledger (book by default), from the ledger's stored amounts, with nothing converted and nothing rounded except its percentages:
- **Summary:** the contract value and the cumulative certified to `to` (the latest posted, uncancelled billing dated on or before it) in the terms' currency, and the cumulative's share of the contract value; the range's revenue (`is.revenue` lines with the project), direct costs (`is.direct_costs` lines with the project), contribution and margin, exactly as S09's profitability by contract; and at `to`, the balances carried for the project of the client's retentions (`113002`), the client's advance (`212002`), the subcontractors' retentions (`211006`) and the advances paid to suppliers and subcontractors (`114002`), each positive on its own side. A subcontractor's retentions are one running item over all its projects, and the month-end revaluation posts on the supplier alone: what the item carries with no project is shared over its projects in proportion to each project's balance in the item's currency on the item's side, with cumulative rounding (owner, 2026-11-16), so each project's retention is at the item's carrying amounts.
- **Costs and budget:** each direct-cost account with a budget or a line of the project, its cost in the range and to `to`, and its budget; the variance (budget less cost to date) and the share of the budget used only when the terms' currency is the book currency and the ledger is the book (S12 answer 15), otherwise the budget alone.
- **Materials:** per material and transaction currency, the range's lines of the project on an account that requires a material: the net quantity, the amount in the transaction currency and in the ledger, and the average unit cost; a price adjustment counts in the amounts and not in the quantity.
- **Wages:** per worker with a wage-sheet line on the project in the range: the days, the lump sums and the amount, and the worker's running balance at `to`.
- **Subcontracts:** each subcontract of the project: its value and the cumulative certified to `to` in its currency, the retention held (with its share of the item's revaluation, as in the summary) and the advance carried for the project at `to`, and the supplier's payments in the range: the clearing movements of its running payable, a reversed payment netting out with its reversal and a project document's movements left out.
- **Billings:** every billing of the project dated on or before `to`, with its cumulative, previous, period's value, retention, recovery, net, state and what remains of its receivable at `to`.

Its revenue and direct costs equal S09's profitability by contract for the same range and ledger, and its contract balances are the parts of the balance sheet's contract position for the project (S09 rule 17).

## Basis

- **Management reporting, outside IFRS:** the project's contribution is a direct contribution margin with no allocation of overheads (S09 rules 20–21; S12 "Out"); the budget is management data with no accounting effect (S12 answer 8).
- **IFRS 15.35(b), 15.B15:** the revenue it reads is the certified billings' (the output method, S12 answer 3); **IFRS 15.105–108:** the retention receivable is a contract asset, the client's advance a contract liability, and the balance sheet nets them per contract (S09 rule 17; ADR 0007).
- **IAS 21.23:** a subcontractor's retention is a monetary item, carried at the closing rate after the month-end revaluation; its share per project follows the project's balance in the item's currency.
- **IFRIC 22.8–9:** in a ledger whose currency is not the advance's, the revenue and cost a recovered advance paid for stay at the advance's rate, so the report's parallel revenue is not the cumulative times the day's rate.
- **IAS 1.102:** direct costs by nature, one line per direct-cost account.
- **Company policy:** S12 "Reports" and answers 8, 15 (owner, 2026-11-16); the revaluation of a subcontractor's retentions shared over its projects (owner, 2026-11-16, after the accounting review of S12's third PR); S09 rules 4, 6, 8, 17, 20 and 21 (the marks, drill-down, agreement with the ledger, contract positions, profitability and its margin); ADR 0007 (the report's ledger amounts as stored).
- **Syrian rules:** the bulletin for the parallel ledger, UNVERIFIED (Q1), adopted by the owner as the company's policy; a daily TRY/SYP bulletin, UNVERIFIED (Q10), assumed by the owner (S11); Friday and Saturday as days without a bulletin, UNVERIFIED, a company setting.

## Cases

The first two cases use the contracting client's shape: `usd-syp`, the USD book at `market` accepting dealt rates, the SYP parallel ledger at the bulletin, TRY as a third currency, and the chart `contracting@1` (S11 "Templates"). The third and fourth run the report in `syp` and in `syp-usd`; the fifth shares a subcontractor's revalued retentions over two projects in `syp-usd`. Project P1 belongs to client C1; its terms state the currency, the contract value, the rates in basis points and the budget per direct-cost account (`budget`, in the terms' currency). S1 is a supplier, S2 a subcontractor, W1 and W2 workers. Every rate and amount is synthetic.

Each case's documents are those the `projects/` scenarios approved, and their entries are stated here as those files compute them; the explanation of each lies there. Monday 2 November, Thursday 3, Thursday 10, Tuesday 15, Thursday 17 and Thursday 31 December 2026, Thursday 7, Tuesday 12 and Sunday 31 January 2027 are publication days.

`project_report` states (`docs/scenarios/README.md`, "Reports"): its `marks`; `summary`; `costs` and `costs_totals`; `materials`, `wages`, `subcontracts` and `billings`, each the exact set. Amounts are minor units of the report's ledger, except the contract value, cumulatives, budgets and billings, which are in the terms' or the subcontract's currency, and a material's `amount` in its transaction currency. Percentages are strings with one decimal, rounded half away from zero; `null` where none is shown.

The cases leave out what other scenarios own: each document's own entries and refusals (`projects/`); the revaluation the parallel ledger's mark points to (`currency/month-end-revaluation.md`); the release of retentions (`projects/retention-release.md`); the rest of S09's statements (`reports/statement-presentation.md`).

### December: the project in both ledgers, with profitability and the balance sheet

On 2 November client C1 pays a 20,000.00 USD advance on P1 into the USD bank, and the bank pays S2 a 5,000.00 USD advance on P1, both at the bulletin of 115. In December:
- S1 invoices the S12 example's cement and steel in TRY on the 3rd;
- S1 invoices 5.000 t of cement at 95.00 USD less a 25.00 USD discount on the 10th;
- the wage sheet of 1–15 December posts on the 15th: W1 6 days × 25.00, W2 a 400.00 lump sum;
- W1 is paid in full on the 15th and W2 300.00 on the 17th, at 121;
- S2's first billing of its 50,000.00 USD subcontract certifies 12,000.00 on the 31st: retention 1,200.00, recovery 2,400.00, net 8,400.00, of which the bank pays 5,000.00 the same day;
- the client's billing 1 certifies 30,000.00 on the 31st.

In the USD book the report shows revenue of 30,000.00 against direct costs of 15,558.09, with each cost account against its budget. In the SYP parallel ledger the revenue is 3,570,000.00 and S2's cost 1,428,000.00, since each covered part keeps its advance's rate of 115 (IFRIC 22.8). The budget there shows no variance, being in USD. TRY at 34 on 31 December leaves nothing to revalue in the book; the bank and the box in USD do in the parallel ledger. Profitability by contract gives the same revenue and costs, and the balance sheet nets P1's retention against its advance in contract liabilities.

```yaml
case: P1 in December in the USD book and the SYP parallel; materials in TRY and USD, wages, S2's billing, billing 1; profitability and the balance sheet agree
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: USD, value: 10000000, retention_bp: 1000, advance_recovery_bp: 2000,
                                  budget: [{ account: "511001", amount: 4000000 },
                                           { account: "511002", amount: 1500000 },
                                           { account: "511003", amount: 3500000 }] } }],
           materials: [{ code: CEM, name: "أسمنت بورتلاندي", unit: "طن" },
                       { code: STL, name: "حديد تسليح", unit: "طن" }],
           subcontracts: [{ contract: P1, supplier: S2, currency: USD, value: 5000000,
                            retention_bp: 1000, advance_recovery_bp: 2000 }] }
rates:
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-15, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-17, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-31, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
steps:
  - voucher: client C1 pays an advance on P1 into the USD bank
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111004", party_name: "العميل" },
               lines: [{ account: "111004", currency: USD, amount: 2000000 },
                       { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000 }] }
  - voucher: an advance of 5,000.00 USD paid to S2 for P1 from the USD bank
    accounting_date: 2026-11-02
    payload: { voucher: { kind: payment, cash_account: "111004", party_name: "مقاول الباطن" },
               lines: [{ account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 500000 },
                       { account: "111004", currency: USD, amount: -500000 }] }
  - project_document: S1's invoice F-1024 for P1 in TRY
    accounting_date: 2026-12-03
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: TRY, supplier_reference: "F-1024" },
               lines: [{ account: "511001", material: CEM, quantity: "12.500", unit_price: "3150.0000" },
                       { account: "511001", material: STL, quantity: "2.000", unit_price: "23800.0000" }] }
  - project_document: S1's invoice F-1088 for P1 in USD, with a discount
    accounting_date: 2026-12-10
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: USD, supplier_reference: "F-1088" },
               lines: [{ account: "511001", material: CEM, quantity: "5.000", unit_price: "95.0000" },
                       { account: "511001", material: CEM, quantity: "0.000", amount: -2500 }] }
  - project_document: the wage sheet of P1 for 1–15 December
    accounting_date: 2026-12-15
    payload: { document: { kind: wage_sheet, contract: P1, currency: USD, period_from: 2026-12-01, period_to: 2026-12-15 },
               lines: [{ worker: W1, days: "6.0", daily_rate: "25.0000" },
                       { worker: W2, amount: 40000, description: "نجارة قوالب الطابق الأول" }] }
  - voucher: the owner pays 1,000.00 USD into the USD box
    accounting_date: 2026-12-15
    payload: { voucher: { kind: receipt, cash_account: "111002", party_name: "المالك" },
               lines: [{ account: "111002", currency: USD, amount: 100000 },
                       { account: "313001", currency: USD, amount: -100000 }] }
  - voucher: W1's wages paid in full
    accounting_date: 2026-12-15
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "العامل" },
               lines: [{ account: "211007", dims: { worker: W1 }, currency: USD, amount: 15000 },
                       { account: "111002", currency: USD, amount: -15000 }] }
  - voucher: 300.00 USD paid to W2 on account
    accounting_date: 2026-12-17
    payload: { voucher: { kind: payment, cash_account: "111002", party_name: "الحرفي" },
               lines: [{ account: "211007", dims: { worker: W2 }, currency: USD, amount: 30000 },
                       { account: "111002", currency: USD, amount: -30000 }] }
  - project_document: S2's billing 1 on P1
    accounting_date: 2026-12-31
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 1200000 } }
  - voucher: 5,000.00 USD of S2's net paid from the USD bank
    accounting_date: 2026-12-31
    payload: { voucher: { kind: payment, cash_account: "111004", party_name: "مقاول الباطن" },
               lines: [{ account: "211002", dims: { supplier: S2 }, currency: USD, amount: 500000 },
                       { account: "111004", currency: USD, amount: -500000 }] }
  - project_document: progress billing 1 of P1
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 3000000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        # parallel: 20,000.00 USD × 115 = 2,300,000.00 SYP
        - { account: "111004", currency: USD, amount: 2000000, book: 2000000, parallel: 230000000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000, book: -2000000, parallel: -230000000 }
    - source: manual
      date: 2026-11-02
      lines:
        # 5,000.00 USD × 115 = 575,000.00 SYP; a new running item for S2, all of it P1's
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: 500000, book: 500000, parallel: 57500000 }
        - { account: "111004", currency: USD, amount: -500000, book: -500000, parallel: -57500000 }
    - source: manual
      date: 2026-12-03
      lines:
        # 12.500 × 3,150.0000 = 39,375.00 TRY; / 34 = 1,158.0882… → 1,158.09 USD; × 3.5 = 137,812.50 SYP
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 3937500, book: 115809, parallel: 13781250 }
        # 2.000 × 23,800.0000 = 47,600.00 TRY; / 34 = 1,400.00 USD; × 3.5 = 166,600.00 SYP
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 4760000, book: 140000, parallel: 16660000 }
        # 86,975.00 TRY; / 34 = 2,558.0882… → 2,558.09 USD; × 3.5 = 304,412.50 SYP
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: -8697500, book: -255809, parallel: -30441250 }
    - source: manual
      date: 2026-12-10
      lines:
        # 5.000 × 95.0000 = 475.00 USD; × 120 = 57,000.00 SYP
        - { account: "511001", dims: { contract: P1 }, currency: USD, amount: 47500, book: 47500, parallel: 5700000 }
        # the discount typed, a price adjustment: −25.00 USD; × 120 = −3,000.00 SYP
        - { account: "511001", dims: { contract: P1 }, currency: USD, amount: -2500, book: -2500, parallel: -300000 }
        # 475.00 − 25.00 = 450.00 USD, S1's running item in USD; × 120 = 54,000.00 SYP
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: USD, amount: -45000, book: -45000, parallel: -5400000 }
    - source: manual
      date: 2026-12-15
      lines:
        # 6.0 days × 25.0000 = 150.00 USD; × 120 = 18,000.00 SYP
        - { account: "511002", dims: { contract: P1, worker: W1 }, currency: USD, amount: 15000, book: 15000, parallel: 1800000 }
        # the lump sum: 400.00 USD; × 120 = 48,000.00 SYP
        - { account: "511002", dims: { contract: P1, worker: W2 }, currency: USD, amount: 40000, book: 40000, parallel: 4800000 }
        - { account: "211007", dims: { worker: W1, contract: P1 }, currency: USD, amount: -15000, book: -15000, parallel: -1800000 }
        - { account: "211007", dims: { worker: W2, contract: P1 }, currency: USD, amount: -40000, book: -40000, parallel: -4800000 }
    - source: manual
      date: 2026-12-15
      lines:
        - { account: "111002", currency: USD, amount: 100000, book: 100000, parallel: 12000000 }
        - { account: "313001", currency: USD, amount: -100000, book: -100000, parallel: -12000000 }
    - source: manual
      date: 2026-12-15
      lines:
        - { account: "211007", dims: { worker: W1 }, currency: USD, amount: 15000, book: 15000, parallel: 1800000 }
        - { account: "111002", currency: USD, amount: -15000, book: -15000, parallel: -1800000 }
    - source: manual
      date: 2026-12-17
      lines:
        # 300 of W2's 400 at the average: 4,800,000 × 300 / 400 = 3,600,000; the box at 121: 3,630,000
        - { account: "211007", dims: { worker: W2 }, currency: USD, amount: 30000, book: 30000, parallel: 3600000 }
        - { account: "111002", currency: USD, amount: -30000, book: -30000, parallel: -3630000 }
        # parallel residual: 3,600,000 − 3,630,000 = −30,000 → realised loss 300.00 SYP (outside the project's costs)
        - { account: "541001", currency: SYP, amount: 30000, book: 0, parallel: 30000 }
    - source: manual
      date: 2026-12-31
      lines:
        # period: 12,000.00 − 0; retention 10% = 1,200.00; recovery 20% = 2,400.00 (≤ P1's 5,000.00); net 8,400.00
        # covered 2,400.00 at the advance's average: 57,500,000 × 2,400 / 5,000 = 27,600,000
        # the other 9,600.00 × 120 = 115,200,000 → 142,800,000 (1,428,000.00 SYP)
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: USD, amount: 1200000, book: 1200000, parallel: 142800000 }
        # 1,200.00 × 120 = 144,000.00 SYP
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -120000, book: -120000, parallel: -14400000 }
        - { account: "114002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -240000, book: -240000, parallel: -27600000 }
        # 8,400.00 × 120 = 1,008,000.00 SYP
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -840000, book: -840000, parallel: -100800000 }
        # parallel: 142,800,000 − 14,400,000 − 27,600,000 − 100,800,000 = 0: no difference line
    - source: manual
      date: 2026-12-31
      lines:
        # 5,000 of S2's 8,400 at the average: 100,800,000 × 5,000 / 8,400 = 60,000,000 = 5,000.00 × 120: no difference
        - { account: "211002", dims: { supplier: S2 }, currency: USD, amount: 500000, book: 500000, parallel: 60000000 }
        - { account: "111004", currency: USD, amount: -500000, book: -500000, parallel: -60000000 }
    - source: manual
      date: 2026-12-31
      lines:
        # as projects/progress-billing.md's first case: net 21,000.00, retention 3,000.00, recovery 6,000.00
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2100000, book: 2100000, parallel: 252000000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 300000, parallel: 36000000 }
        # 230,000,000 × 6,000 / 20,000 = 69,000,000
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: 600000, book: 600000, parallel: 69000000 }
        # covered 69,000,000 + 24,000.00 × 120 = 288,000,000 → 357,000,000 (3,570,000.00 SYP)
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -3000000, book: -3000000, parallel: -357000000 }
  project_documents:
    - { kind: purchase, number: 1, date: 2026-12-03, contract: P1, client: C1, supplier: S1, entry: 3,
        currency: TRY, reference: "F-1024" }
    - { kind: purchase, number: 2, date: 2026-12-10, contract: P1, client: C1, supplier: S1, entry: 4,
        currency: USD, reference: "F-1088" }
    - { kind: wage_sheet, number: 1, date: 2026-12-15, contract: P1, client: C1, entry: 5, currency: USD,
        period_from: 2026-12-01, period_to: 2026-12-15 }
    - { kind: subcontract_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, supplier: S2,
        sequence: 1, entry: 9, currency: USD, cumulative: 1200000, previous: 0, retention: 120000, advance: 240000 }
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 11,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 600000 }
  reports:
    # TRY at the closing market of 34: S1's 86,975.00 TRY is carried at its closing amount, 2,558.09 USD;
    #   nothing else in the book is in another currency, so the book's December revaluation is current
    - report: project_report
      params: { contract: P1, from: 2026-12-01, to: 2026-12-31, ledger: book }
      marks: [period_open]
      # cumulative 30,000.00 of 100,000.00 = 30.0%
      # direct costs: materials 1,158.09 + 1,400.00 + 475.00 − 25.00 = 3,008.09; wages 550.00;
      #   S2 12,000.00 → 15,558.09; contribution 30,000.00 − 15,558.09 = 14,441.91; margin 48.139…% → 48.1
      # at 31 December: retention 3,000.00; C1's advance for P1 20,000 − 6,000 = 14,000.00;
      #   S2's retention 1,200.00; S2's advance for P1 5,000 − 2,400 = 2,600.00
      summary: { currency: USD, contract_value: 10000000, cumulative: 3000000, billed: "30.0",
                 revenue: 3000000, direct_costs: 1555809, contribution: 1444191, margin: "48.1",
                 retention_receivable: 300000, client_advance: 1400000,
                 subcontract_retention: 120000, subcontract_advance: 260000 }
      costs:
        # variance = budget − cost to date; used = cost to date / budget: 3,008.09 / 40,000.00 = 7.52% → 7.5
        - { account: "511001", in_range: 300809, to_date: 300809, budget: 4000000, variance: 3699191, used: "7.5" }
        # 550.00 / 15,000.00 = 3.666…% → 3.7
        - { account: "511002", in_range: 55000, to_date: 55000, budget: 1500000, variance: 1445000, used: "3.7" }
        # 12,000.00 / 35,000.00 = 34.285…% → 34.3
        - { account: "511003", in_range: 1200000, to_date: 1200000, budget: 3500000, variance: 2300000, used: "34.3" }
      # 15,558.09 / 90,000.00 = 17.286…% → 17.3; variance 90,000.00 − 15,558.09 = 74,441.91
      costs_totals: { in_range: 1555809, to_date: 1555809, budget: 9000000, variance: 7444191, used: "17.3" }
      materials:
        # 39,375.00 TRY / 12.500 = 3,150.0000 TRY a tonne
        - { material: CEM, currency: TRY, quantity: "12.500", amount: 3937500, ledger_amount: 115809, average: "3150.0000" }
        # 475.00 − 25.00 = 450.00 USD for 5.000 t (the discount in the amount only) = 90.0000 USD a tonne
        - { material: CEM, currency: USD, quantity: "5.000", amount: 45000, ledger_amount: 45000, average: "90.0000" }
        - { material: STL, currency: TRY, quantity: "2.000", amount: 4760000, ledger_amount: 140000, average: "23800.0000" }
        # ledger amounts: 1,158.09 + 450.00 + 1,400.00 = 3,008.09 = 511001's cost
      wages:
        # each worker's running item at 31 December, positive when owed to the worker: W1 paid in full, W2 owed 100.00
        - { worker: W1, days: "6.000", lump_sum: 0, amount: 15000, balance: 0 }
        - { worker: W2, days: "0.000", lump_sum: 40000, amount: 40000, balance: 10000 }
      subcontracts:
        # value and cumulative in the subcontract's USD; retention and advance carried for P1; paid in December
        - { supplier: S2, currency: USD, value: 5000000, cumulative: 1200000, retention: 120000, advance: 260000, paid: 500000 }
      billings:
        # in the terms' USD; outstanding: billing 1's receivable "مستخلص 2026/1" on 112001 at 31 December
        - { sequence: 1, number: "2026/1", date: 2026-12-31, cumulative: 3000000, previous: 0, period: 3000000,
            retention: 300000, advance: 600000, net: 2100000, state: posted, outstanding: 2100000 }
    # the bank's 10,000.00 USD is carried at 112,500,000 (230,000,000 − 57,500,000 − 60,000,000), not 120,000,000,
    #   and the box's 550.00 USD at 6,570,000, not 6,600,000: the parallel ledger's December revaluation is to post
    - report: project_report
      params: { contract: P1, from: 2026-12-01, to: 2026-12-31, ledger: parallel }
      marks: [period_open, before_revaluation]
      # direct costs: materials 13,781,250 + 16,660,000 + 5,700,000 − 300,000 = 35,841,250; wages 6,600,000;
      #   S2 142,800,000 → 185,241,250; contribution 357,000,000 − 185,241,250 = 171,758,750; margin 48.111…% → 48.1
      # S2's advance for P1: 57,500,000 − 27,600,000 = 29,900,000
      summary: { currency: USD, contract_value: 10000000, cumulative: 3000000, billed: "30.0",
                 revenue: 357000000, direct_costs: 185241250, contribution: 171758750, margin: "48.1",
                 retention_receivable: 36000000, client_advance: 161000000,
                 subcontract_retention: 14400000, subcontract_advance: 29900000 }
      costs:
        # the budget is in USD and the ledger is SYP: the budget alone (S12 answer 15)
        - { account: "511001", in_range: 35841250, to_date: 35841250, budget: 4000000, variance: null, used: null }
        - { account: "511002", in_range: 6600000, to_date: 6600000, budget: 1500000, variance: null, used: null }
        - { account: "511003", in_range: 142800000, to_date: 142800000, budget: 3500000, variance: null, used: null }
      costs_totals: { in_range: 185241250, to_date: 185241250, budget: 9000000, variance: null, used: null }
      materials:
        - { material: CEM, currency: TRY, quantity: "12.500", amount: 3937500, ledger_amount: 13781250, average: "3150.0000" }
        # 5,700,000 − 300,000
        - { material: CEM, currency: USD, quantity: "5.000", amount: 45000, ledger_amount: 5400000, average: "90.0000" }
        - { material: STL, currency: TRY, quantity: "2.000", amount: 4760000, ledger_amount: 16660000, average: "23800.0000" }
      wages:
        # W2's item: 4,800,000 − 3,600,000 = 1,200,000
        - { worker: W1, days: "6.000", lump_sum: 0, amount: 1800000, balance: 0 }
        - { worker: W2, days: "0.000", lump_sum: 4800000, amount: 4800000, balance: 1200000 }
      subcontracts:
        - { supplier: S2, currency: USD, value: 5000000, cumulative: 1200000, retention: 14400000, advance: 29900000, paid: 60000000 }
      billings:
        - { sequence: 1, number: "2026/1", date: 2026-12-31, cumulative: 3000000, previous: 0, period: 3000000,
            retention: 300000, advance: 600000, net: 2100000, state: posted, outstanding: 2100000 }
    # the project report's revenue and direct costs, contract by contract (S09 rule 20; S12 "Reconciliation")
    - report: profitability
      params: { by: contract, from: 2026-12-01, to: 2026-12-31, ledger: book }
      marks: [period_open]
      rows:
        - { value: P1, revenue: 3000000, direct_costs: 1555809, contribution: 1444191, margin: "48.1" }
      totals: { revenue: 3000000, direct_costs: 1555809, contribution: 1444191, margin: "48.1" }
    - report: profitability
      params: { by: contract, from: 2026-12-01, to: 2026-12-31, ledger: parallel }
      marks: [period_open, before_revaluation]
      rows:
        - { value: P1, revenue: 357000000, direct_costs: 185241250, contribution: 171758750, margin: "48.1" }
      totals: { revenue: 357000000, direct_costs: 185241250, contribution: 171758750, margin: "48.1" }
    - report: balance_sheet
      params: { as_of: 2026-12-31, ledger: book }
      marks: [period_open]
      lines:
        # the box 1,000.00 − 150.00 − 300.00 = 550.00; the bank 20,000.00 − 5,000.00 − 5,000.00 = 10,000.00
        - { line: bs.cash, amount: 1055000,
            parts: [{ account: "111002", amount: 55000 }, { account: "111004", amount: 1000000 }] }
        - { line: bs.trade_receivables, amount: 2100000,
            parts: [{ account: "112001", dims: { client: C1 }, amount: 2100000 }] }
        # the summary's advance to S2 for P1
        - { line: bs.other_current_assets, amount: 260000,
            parts: [{ account: "114002", dims: { supplier: S2 }, amount: 260000 }] }
        # S1: 2,558.09 + 450.00; S2's payable 8,400.00 − 5,000.00 and its retention; W2 owed 100.00 (W1 at zero)
        - { line: bs.trade_payables, amount: 770809,
            parts: [{ account: "211001", dims: { supplier: S1 }, amount: 300809 },
                    { account: "211002", dims: { supplier: S2 }, amount: 340000 },
                    { account: "211006", dims: { supplier: S2 }, amount: 120000 },
                    { account: "211007", dims: { worker: W2 }, amount: 10000 }] }
        # P1 netted (S09 rule 17): the summary's advance 14,000.00 less its retention 3,000.00 = 11,000.00
        - { line: bs.contract_liabilities, amount: 1100000,
            parts: [{ account: "212002", dims: { client: C1, contract: P1 }, amount: 1400000 },
                    { account: "113002", dims: { client: C1, contract: P1 }, amount: -300000 }] }
        - { line: bs.owner_current, amount: 100000,
            parts: [{ account: "313001", amount: 100000 }] }
      # the project's contribution: the book has no exchange difference
      year_result: 1444191
      # assets: 1,055,000 + 2,100,000 + 260,000 = 3,415,000; liabilities: 770,809 + 1,100,000 = 1,870,809
      # equity: 100,000 + 1,444,191 = 1,544,191
      totals: { assets: 3415000, liabilities: 1870809, equity: 1544191, liabilities_and_equity: 3415000 }
```

### January: the range against the cost to date, a cancelled purchase and the billings' chain

The first case's advance, S1's two invoices and billing 1, without the wages and S2. In January the client pays billing 1's net on the 7th, at 122. On the 12th the accountant cancels S1's USD invoice (purchase 2) by reversing its entry, which negates its quantities. Billing 2 certifies 75,000.00 cumulative on the 31st, at 125, with the recovery raised to 10,000.00 (`projects/progress-billing.md`).

January's report reads the range alone for revenue, costs and materials: the cancellation makes January's materials −450.00 USD and −5.000 t of cement. It reads everything to 31 January for the cost to date against the budget, the balances and the billings: billing 1 settled, billing 2 open. With costs negative in the range, the contribution exceeds revenue and the margin is 101.0%. Accounts with a budget and no cost show it whole.

```yaml
case: P1 in January in the USD book; purchase 2 cancelled, billing 1 received, billing 2 posted; the range against the cost to date
company: { shape: usd-syp, book: USD, parallel: SYP, template: contracting,
           rate_policy: { book: market, book_accepts_transaction_rate: true, parallel: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: USD, value: 10000000, retention_bp: 1000, advance_recovery_bp: 2000,
                                  budget: [{ account: "511001", amount: 4000000 },
                                           { account: "511002", amount: 1500000 },
                                           { account: "511003", amount: 3500000 }] } }],
           materials: [{ code: CEM, name: "أسمنت بورتلاندي", unit: "طن" },
                       { code: STL, name: "حديد تسليح", unit: "طن" }] }
rates:
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-12-03, base: TRY, quote: SYP, rate: "3.5000", type: bulletin }
  - { date: 2026-12-03, base: USD, quote: TRY, rate: "34.0000", type: market }
  - { date: 2026-12-10, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2027-01-07, base: USD, quote: SYP, rate: "122.0000", type: bulletin }
  - { date: 2027-01-31, base: USD, quote: SYP, rate: "125.0000", type: bulletin }
steps:
  - voucher: client C1 pays an advance on P1 into the USD bank
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111004", party_name: "العميل" },
               lines: [{ account: "111004", currency: USD, amount: 2000000 },
                       { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000 }] }
  - project_document: S1's invoice F-1024 for P1 in TRY
    accounting_date: 2026-12-03
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: TRY, supplier_reference: "F-1024" },
               lines: [{ account: "511001", material: CEM, quantity: "12.500", unit_price: "3150.0000" },
                       { account: "511001", material: STL, quantity: "2.000", unit_price: "23800.0000" }] }
  - project_document: S1's invoice F-1088 for P1 in USD, with a discount
    accounting_date: 2026-12-10
    payload: { document: { kind: purchase, contract: P1, supplier: S1, currency: USD, supplier_reference: "F-1088" },
               lines: [{ account: "511001", material: CEM, quantity: "5.000", unit_price: "95.0000" },
                       { account: "511001", material: CEM, quantity: "0.000", amount: -2500 }] }
  - project_document: progress billing 1 of P1
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 3000000 } }
  - voucher: the client pays the net of billing 1
    accounting_date: 2027-01-07
    payload: { voucher: { kind: receipt, cash_account: "111004", party_name: "العميل" },
               lines: [{ account: "111004", currency: USD, amount: 2100000 },
                       { account: "112001", currency: USD, amount: -2100000, item: "مستخلص 2026/1" }] }
  - reversal: 3
    accounting_date: 2027-01-12
  - project_document: progress billing 2 of P1, the recovery raised to 10,000.00
    accounting_date: 2027-01-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 7500000, advance: 1000000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        - { account: "111004", currency: USD, amount: 2000000, book: 2000000, parallel: 230000000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000, book: -2000000, parallel: -230000000 }
    - source: manual
      date: 2026-12-03
      lines:
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 3937500, book: 115809, parallel: 13781250 }
        - { account: "511001", dims: { contract: P1 }, currency: TRY, amount: 4760000, book: 140000, parallel: 16660000 }
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: TRY, amount: -8697500, book: -255809, parallel: -30441250 }
    - source: manual
      date: 2026-12-10
      lines:
        - { account: "511001", dims: { contract: P1 }, currency: USD, amount: 47500, book: 47500, parallel: 5700000 }
        - { account: "511001", dims: { contract: P1 }, currency: USD, amount: -2500, book: -2500, parallel: -300000 }
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: USD, amount: -45000, book: -45000, parallel: -5400000 }
    - source: manual
      date: 2026-12-31
      lines:
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2100000, book: 2100000, parallel: 252000000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 300000, parallel: 36000000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: 600000, book: 600000, parallel: 69000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -3000000, book: -3000000, parallel: -357000000 }
    - source: manual
      date: 2027-01-07
      lines:
        # 21,000.00 USD × 122 = 2,562,000.00 SYP; the item at what it carries, 2,520,000.00 SYP
        - { account: "111004", currency: USD, amount: 2100000, book: 2100000, parallel: 256200000 }
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: -2100000, book: -2100000, parallel: -252000000 }
        # parallel residual 4,200,000 → realised gain 42,000.00 SYP (outside the project's contribution)
        - { account: "421001", currency: SYP, amount: -4200000, book: 0, parallel: -4200000 }
    - source: reversal
      date: 2027-01-12
      lines:
        # purchase 2 negated at its amounts; S1's USD item back to zero with no difference (S04 rule 13)
        - { account: "511001", dims: { contract: P1 }, currency: USD, amount: -47500, book: -47500, parallel: -5700000 }
        - { account: "511001", dims: { contract: P1 }, currency: USD, amount: 2500, book: 2500, parallel: 300000 }
        - { account: "211001", dims: { supplier: S1, contract: P1 }, currency: USD, amount: 45000, book: 45000, parallel: 5400000 }
    - source: manual
      date: 2027-01-31
      lines:
        # as projects/progress-billing.md's second case: period 45,000.00; retention 4,500.00; recovery typed 10,000.00
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 3050000, book: 3050000, parallel: 381250000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 450000, book: 450000, parallel: 56250000 }
        # 161,000,000 × 10,000 / 14,000 = 115,000,000
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: 1000000, book: 1000000, parallel: 115000000 }
        # 115,000,000 + 35,000.00 × 125 = 552,500,000
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -4500000, book: -4500000, parallel: -552500000 }
  project_documents:
    - { kind: purchase, number: 1, date: 2026-12-03, contract: P1, client: C1, supplier: S1, entry: 2,
        currency: TRY, reference: "F-1024" }
    - { kind: purchase, number: 2, date: 2026-12-10, contract: P1, client: C1, supplier: S1, entry: 3,
        currency: USD, reference: "F-1088", cancelled_by: 6 }
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 4,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 600000 }
    - { kind: progress_billing, number: 1, date: 2027-01-31, contract: P1, client: C1, sequence: 2, entry: 7,
        currency: USD, cumulative: 7500000, previous: 3000000, retention: 450000, advance: 1000000 }
  reports:
    # S1's TRY item at the closing market of 34 is carried at its closing amount: the book's January revaluation is current
    - report: project_report
      params: { contract: P1, from: 2027-01-01, to: 2027-01-31, ledger: book }
      marks: [period_open]
      # cumulative 75,000.00 of 100,000.00 = 75.0%; January's revenue: billing 2's period, 45,000.00
      # direct costs: the cancelled purchase, −450.00; contribution 45,000.00 + 450.00 = 45,450.00; margin 101.0%
      # at 31 January: retentions 3,000.00 + 4,500.00; C1's advance 20,000 − 6,000 − 10,000 = 4,000.00
      summary: { currency: USD, contract_value: 10000000, cumulative: 7500000, billed: "75.0",
                 revenue: 4500000, direct_costs: -45000, contribution: 4545000, margin: "101.0",
                 retention_receivable: 750000, client_advance: 400000,
                 subcontract_retention: 0, subcontract_advance: 0 }
      costs:
        # to date: 1,158.09 + 1,400.00 = 2,558.09 (purchase 2 and its reversal net to zero); 2,558.09 / 40,000.00 = 6.395…% → 6.4
        - { account: "511001", in_range: -45000, to_date: 255809, budget: 4000000, variance: 3744191, used: "6.4" }
        # a budget with no cost
        - { account: "511002", in_range: 0, to_date: 0, budget: 1500000, variance: 1500000, used: "0.0" }
        - { account: "511003", in_range: 0, to_date: 0, budget: 3500000, variance: 3500000, used: "0.0" }
      # 2,558.09 / 90,000.00 = 2.842…% → 2.8; variance 90,000.00 − 2,558.09 = 87,441.91
      costs_totals: { in_range: -45000, to_date: 255809, budget: 9000000, variance: 8744191, used: "2.8" }
      materials:
        # January's lines: the reversal's −5.000 t at 95.0000 and the discount's reversal +25.00:
        #   −450.00 USD for −5.000 t = 90.0000 USD a tonne
        - { material: CEM, currency: USD, quantity: "-5.000", amount: -45000, ledger_amount: -45000, average: "90.0000" }
      wages: []
      subcontracts: []
      billings:
        # billing 1 received in full on 7 January
        - { sequence: 1, number: "2026/1", date: 2026-12-31, cumulative: 3000000, previous: 0, period: 3000000,
            retention: 300000, advance: 600000, net: 2100000, state: posted, outstanding: 0 }
        # 45,000.00 − 4,500.00 − 10,000.00 = 30,500.00, all of it open
        - { sequence: 2, number: "2027/1", date: 2027-01-31, cumulative: 7500000, previous: 3000000, period: 4500000,
            retention: 450000, advance: 1000000, net: 3050000, state: posted, outstanding: 3050000 }
    - report: profitability
      params: { by: contract, from: 2027-01-01, to: 2027-01-31, ledger: book }
      marks: [period_open]
      rows:
        - { value: P1, revenue: 4500000, direct_costs: -45000, contribution: 4545000, margin: "101.0" }
      totals: { revenue: 4500000, direct_costs: -45000, contribution: 4545000, margin: "101.0" }
```

### syp: a project in SYP, compared with its budget in the book

A company with SYP books and no parallel ledger runs P1 in SYP: a contract value of 5,000,000.00 SYP and a wages budget of 200,000.00 SYP. The SYP wage sheet of `projects/wage-sheet.md` posts on 15 December and is not yet paid. Billing 1 certifies 1,000,000.00 SYP on 31 December: retention 100,000.00. No advance was received, so the computed recovery is capped at zero, and the net is 900,000.00. The terms' currency is the book currency, so the budget shows its variance. Nothing is in another currency: no rate is read, and the month's revaluation is current.

```yaml
case: syp; P1 in SYP with a wages budget; the SYP sheet and billing 1 with no advance; the variance in the book
company: { shape: syp, book: SYP, template: contracting, rate_policy: { book: bulletin },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: SYP, value: 500000000, retention_bp: 1000, advance_recovery_bp: 2000,
                                  budget: [{ account: "511002", amount: 20000000 }] } }] }
steps:
  - project_document: the SYP wage sheet of P1 for 1–15 December
    accounting_date: 2026-12-15
    payload: { document: { kind: wage_sheet, contract: P1, currency: SYP, period_from: 2026-12-01, period_to: 2026-12-15 },
               lines: [{ worker: W1, days: "6.0", daily_rate: "3000.0000" },
                       { worker: W2, amount: 4800000, description: "نجارة قوالب الطابق الأول" }] }
  - project_document: progress billing 1 of P1
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 100000000 } }
expect:
  entries:
    - source: manual
      date: 2026-12-15
      lines:
        # 6.0 × 3,000.0000 = 18,000.00 SYP
        - { account: "511002", dims: { contract: P1, worker: W1 }, currency: SYP, amount: 1800000, book: 1800000 }
        - { account: "511002", dims: { contract: P1, worker: W2 }, currency: SYP, amount: 4800000, book: 4800000 }
        - { account: "211007", dims: { worker: W1, contract: P1 }, currency: SYP, amount: -1800000, book: -1800000 }
        - { account: "211007", dims: { worker: W2, contract: P1 }, currency: SYP, amount: -4800000, book: -4800000 }
    - source: manual
      date: 2026-12-31
      lines:
        # period 1,000,000.00; retention 10% = 100,000.00; recovery 20% = 200,000.00 capped at the advance's 0
        # net: 1,000,000.00 − 100,000.00 = 900,000.00
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: SYP, amount: 90000000, book: 90000000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: SYP, amount: 10000000, book: 10000000 }
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: SYP, amount: -100000000, book: -100000000 }
  project_documents:
    - { kind: wage_sheet, number: 1, date: 2026-12-15, contract: P1, client: C1, entry: 1, currency: SYP,
        period_from: 2026-12-01, period_to: 2026-12-15 }
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 2,
        currency: SYP, cumulative: 100000000, previous: 0, retention: 10000000, advance: 0 }
  reports:
    - report: project_report
      params: { contract: P1, from: 2026-12-01, to: 2026-12-31, ledger: book }
      marks: [period_open]
      # 1,000,000.00 of 5,000,000.00 = 20.0%; contribution 1,000,000.00 − 66,000.00 = 934,000.00; margin 93.4%
      summary: { currency: SYP, contract_value: 500000000, cumulative: 100000000, billed: "20.0",
                 revenue: 100000000, direct_costs: 6600000, contribution: 93400000, margin: "93.4",
                 retention_receivable: 10000000, client_advance: 0,
                 subcontract_retention: 0, subcontract_advance: 0 }
      costs:
        # 200,000.00 − 66,000.00 = 134,000.00; 66,000.00 / 200,000.00 = 33.0%
        - { account: "511002", in_range: 6600000, to_date: 6600000, budget: 20000000, variance: 13400000, used: "33.0" }
      costs_totals: { in_range: 6600000, to_date: 6600000, budget: 20000000, variance: 13400000, used: "33.0" }
      materials: []
      wages:
        # neither worker paid yet
        - { worker: W1, days: "6.000", lump_sum: 0, amount: 1800000, balance: 1800000 }
        - { worker: W2, days: "0.000", lump_sum: 4800000, amount: 4800000, balance: 4800000 }
      subcontracts: []
      billings:
        - { sequence: 1, number: "2026/1", date: 2026-12-31, cumulative: 100000000, previous: 0, period: 100000000,
            retention: 10000000, advance: 0, net: 90000000, state: posted, outstanding: 90000000 }
```

### syp-usd: a USD project in SYP books, its budget without a variance in either ledger

Vertex Media's shape: SYP books at the bulletin and a USD parallel ledger. P1's terms are in USD, with a wages budget of 15,000.00 USD. The client's advance and billing 1 are `projects/progress-billing.md`'s `syp-usd` case. W1's 6 days × 25.00 USD are on a wage sheet on 15 December, at 120, not yet paid. The book's revenue is 3,570,000.00 SYP, with the covered part at the advance's 115. The parallel ledger takes every USD amount as it is. The terms' currency is not the book currency, so neither ledger shows a variance (S12 answer 15), even the USD parallel ledger. The book's USD bank is carried at 115 against a closing 120, so the book's December revaluation is to post. The parallel ledger holds nothing in another currency.

```yaml
case: syp-usd; P1 in USD with a wages budget; W1's sheet and billing 1 with the advance; the budget alone in both ledgers
company: { shape: syp-usd, book: SYP, parallel: USD, template: contracting,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: USD, value: 10000000, retention_bp: 1000, advance_recovery_bp: 2000,
                                  budget: [{ account: "511002", amount: 1500000 }] } }] }
rates:
  - { date: 2026-11-02, base: USD, quote: SYP, rate: "115.0000", type: bulletin }
  - { date: 2026-12-15, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - voucher: client C1 pays an advance on P1 into the USD bank
    accounting_date: 2026-11-02
    payload: { voucher: { kind: receipt, cash_account: "111004", party_name: "العميل" },
               lines: [{ account: "111004", currency: USD, amount: 2000000 },
                       { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000 }] }
  - project_document: W1's wage sheet of P1 for 1–15 December
    accounting_date: 2026-12-15
    payload: { document: { kind: wage_sheet, contract: P1, currency: USD, period_from: 2026-12-01, period_to: 2026-12-15 },
               lines: [{ worker: W1, days: "6.0", daily_rate: "25.0000" }] }
  - project_document: progress billing 1 of P1
    accounting_date: 2026-12-31
    payload: { document: { kind: progress_billing, contract: P1, cumulative: 3000000 } }
expect:
  entries:
    - source: manual
      date: 2026-11-02
      lines:
        # book: 20,000.00 USD × 115 = 2,300,000.00 SYP; parallel: USD as is
        - { account: "111004", currency: USD, amount: 2000000, book: 230000000, parallel: 2000000 }
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: -2000000, book: -230000000, parallel: -2000000 }
    - source: manual
      date: 2026-12-15
      lines:
        # 6.0 × 25.0000 = 150.00 USD; book × 120 = 18,000.00 SYP
        - { account: "511002", dims: { contract: P1, worker: W1 }, currency: USD, amount: 15000, book: 1800000, parallel: 15000 }
        - { account: "211007", dims: { worker: W1, contract: P1 }, currency: USD, amount: -15000, book: -1800000, parallel: -15000 }
    - source: manual
      date: 2026-12-31
      lines:
        # as projects/progress-billing.md's syp-usd case
        - { account: "112001", dims: { client: C1, contract: P1 }, currency: USD, amount: 2100000, book: 252000000, parallel: 2100000 }
        - { account: "113002", dims: { client: C1, contract: P1 }, currency: USD, amount: 300000, book: 36000000, parallel: 300000 }
        # 230,000,000 × 6,000 / 20,000 = 69,000,000
        - { account: "212002", dims: { client: C1, contract: P1 }, currency: USD, amount: 600000, book: 69000000, parallel: 600000 }
        # 69,000,000 + 24,000.00 × 120 = 357,000,000
        - { account: "411001", dims: { client: C1, contract: P1 }, currency: USD, amount: -3000000, book: -357000000, parallel: -3000000 }
  project_documents:
    - { kind: wage_sheet, number: 1, date: 2026-12-15, contract: P1, client: C1, entry: 2, currency: USD,
        period_from: 2026-12-01, period_to: 2026-12-15 }
    - { kind: progress_billing, number: 1, date: 2026-12-31, contract: P1, client: C1, sequence: 1, entry: 3,
        currency: USD, cumulative: 3000000, previous: 0, retention: 300000, advance: 600000 }
  reports:
    # the bank's 20,000.00 USD is carried at 230,000,000, not 240,000,000 at the closing 120
    - report: project_report
      params: { contract: P1, from: 2026-12-01, to: 2026-12-31, ledger: book }
      marks: [period_open, before_revaluation]
      # contribution 357,000,000 − 1,800,000 = 355,200,000; margin 99.495…% → 99.5
      # C1's advance for P1: 230,000,000 − 69,000,000 = 161,000,000
      summary: { currency: USD, contract_value: 10000000, cumulative: 3000000, billed: "30.0",
                 revenue: 357000000, direct_costs: 1800000, contribution: 355200000, margin: "99.5",
                 retention_receivable: 36000000, client_advance: 161000000,
                 subcontract_retention: 0, subcontract_advance: 0 }
      costs:
        # the budget in USD, the ledger in SYP: the budget alone
        - { account: "511002", in_range: 1800000, to_date: 1800000, budget: 1500000, variance: null, used: null }
      costs_totals: { in_range: 1800000, to_date: 1800000, budget: 1500000, variance: null, used: null }
      materials: []
      wages:
        - { worker: W1, days: "6.000", lump_sum: 0, amount: 1800000, balance: 1800000 }
      subcontracts: []
      billings:
        - { sequence: 1, number: "2026/1", date: 2026-12-31, cumulative: 3000000, previous: 0, period: 3000000,
            retention: 300000, advance: 600000, net: 2100000, state: posted, outstanding: 2100000 }
    # every balance of the USD parallel ledger is in USD: its December revaluation is current
    - report: project_report
      params: { contract: P1, from: 2026-12-01, to: 2026-12-31, ledger: parallel }
      marks: [period_open]
      # contribution 30,000.00 − 150.00 = 29,850.00; margin 99.5%
      summary: { currency: USD, contract_value: 10000000, cumulative: 3000000, billed: "30.0",
                 revenue: 3000000, direct_costs: 15000, contribution: 2985000, margin: "99.5",
                 retention_receivable: 300000, client_advance: 1400000,
                 subcontract_retention: 0, subcontract_advance: 0 }
      costs:
        # the parallel ledger is in USD, but the variance is the book's only (S12 answer 15)
        - { account: "511002", in_range: 15000, to_date: 15000, budget: 1500000, variance: null, used: null }
      costs_totals: { in_range: 15000, to_date: 15000, budget: 1500000, variance: null, used: null }
      materials: []
      wages:
        - { worker: W1, days: "6.000", lump_sum: 0, amount: 15000, balance: 15000 }
      subcontracts: []
      billings:
        - { sequence: 1, number: "2026/1", date: 2026-12-31, cumulative: 3000000, previous: 0, period: 3000000,
            retention: 300000, advance: 600000, net: 2100000, state: posted, outstanding: 2100000 }
```

### syp-usd: a subcontractor's retentions on two projects, revalued at the month end

The accounting review of S12's third PR found that a subcontractor's retentions on `211006` are one running item per supplier and currency over all its projects, and that the month-end revaluation posts on the supplier alone, with no project. The owner decided on 2026-11-16 that the project report shares what the item carries with no project over its projects, in proportion to each project's balance in the item's currency, with cumulative rounding, so each project's retention is at the closing rate and the projects' retentions add up to the item (IAS 21.23).

Vertex Media's shape: SYP books at the bulletin and a USD parallel ledger. S2 holds a USD subcontract on P1 and another on P2, each retaining 10% with no advance. On 17 December, at 121, S2's first billing on P1 certifies 12,000.00 USD and its first on P2 5,000.00 USD. The book is revalued for December at the closing bulletin of 120: S2's retentions of 1,700.00 USD, carried at 20,570,000.00 SYP, are brought to 20,400,000.00, and its payable of 15,300.00 USD from 185,130,000.00 to 183,600,000.00. The revaluation's 170,000 on the retentions carries no project; P1 takes 1,200.00 / 1,700.00 of it and P2 the rest, so each project's retention is its USD balance at 120. The USD parallel ledger holds nothing in another currency.

```yaml
case: syp-usd; S2's retentions on P1 and P2 revalued at the month end, shared over the projects by their USD balances
company: { shape: syp-usd, book: SYP, parallel: USD, template: contracting,
           rate_policy: { book: bulletin, parallel: market, parallel_accepts_transaction_rate: true },
           contracts: [{ code: P1, kind: project, client: C1,
                         terms: { currency: USD, value: 10000000, retention_bp: 1000, advance_recovery_bp: 2000 } },
                       { code: P2, kind: project, client: C1,
                         terms: { currency: USD, value: 4000000, retention_bp: 1000, advance_recovery_bp: 2000 } }],
           subcontracts: [{ contract: P1, supplier: S2, currency: USD, value: 5000000,
                            retention_bp: 1000, advance_recovery_bp: 0 },
                          { contract: P2, supplier: S2, currency: USD, value: 2000000,
                            retention_bp: 1000, advance_recovery_bp: 0 }] }
rates:
  - { date: 2026-12-17, base: USD, quote: SYP, rate: "121.0000", type: bulletin }
  - { date: 2026-12-31, base: USD, quote: SYP, rate: "120.0000", type: bulletin }
steps:
  - project_document: S2's billing 1 on P1
    accounting_date: 2026-12-17
    payload: { document: { kind: subcontract_billing, contract: P1, supplier: S2, cumulative: 1200000 } }
  - project_document: S2's billing 1 on P2
    accounting_date: 2026-12-17
    payload: { document: { kind: subcontract_billing, contract: P2, supplier: S2, cumulative: 500000 } }
  - revalue: book
    period: 2026-12
expect:
  entries:
    - source: manual
      date: 2026-12-17
      lines:
        # 12,000.00 USD × 121 = 1,452,000.00 SYP; retention 10% = 1,200.00; no advance; net 10,800.00
        - { account: "511003", dims: { contract: P1, supplier: S2 }, currency: USD, amount: 1200000, book: 145200000, parallel: 1200000 }
        - { account: "211006", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -120000, book: -14520000, parallel: -120000 }
        - { account: "211002", dims: { supplier: S2, contract: P1 }, currency: USD, amount: -1080000, book: -130680000, parallel: -1080000 }
    - source: manual
      date: 2026-12-17
      lines:
        # 5,000.00 USD × 121 = 605,000.00 SYP; retention 500.00; net 4,500.00
        - { account: "511003", dims: { contract: P2, supplier: S2 }, currency: USD, amount: 500000, book: 60500000, parallel: 500000 }
        - { account: "211006", dims: { supplier: S2, contract: P2 }, currency: USD, amount: -50000, book: -6050000, parallel: -50000 }
        - { account: "211002", dims: { supplier: S2, contract: P2 }, currency: USD, amount: -450000, book: -54450000, parallel: -450000 }
    - source: revaluation
      date: 2026-12-31
      lines:
        # S2's retentions: 1,700.00 USD × 120 = 20,400,000.00; carried 20,570,000.00; +1,700.00 SYP to the item
        - { account: "211006", dims: { supplier: S2 }, currency: USD, amount: 0, book: 170000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -170000, book: -170000, parallel: 0 }
        # S2's payable: 15,300.00 USD × 120 = 183,600,000.00; carried 185,130,000.00; +15,300.00 SYP
        - { account: "211002", dims: { supplier: S2 }, currency: USD, amount: 0, book: 1530000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: -1530000, book: -1530000, parallel: 0 }
    - source: reversal
      date: 2027-01-01
      lines:
        - { account: "211006", dims: { supplier: S2 }, currency: USD, amount: 0, book: -170000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 170000, book: 170000, parallel: 0 }
        - { account: "211002", dims: { supplier: S2 }, currency: USD, amount: 0, book: -1530000, parallel: 0 }
        - { account: "421002", currency: SYP, amount: 1530000, book: 1530000, parallel: 0 }
  project_documents:
    - { kind: subcontract_billing, number: 1, date: 2026-12-17, contract: P1, client: C1, supplier: S2,
        sequence: 1, entry: 1, currency: USD, cumulative: 1200000, previous: 0, retention: 120000, advance: 0 }
    - { kind: subcontract_billing, number: 2, date: 2026-12-17, contract: P2, client: C1, supplier: S2,
        sequence: 1, entry: 2, currency: USD, cumulative: 500000, previous: 0, retention: 50000, advance: 0 }
  reports:
    # the book's December revaluation is posted and current
    - report: project_report
      params: { contract: P1, from: 2026-12-01, to: 2026-12-31, ledger: book }
      marks: [period_open]
      # P1's own retention 14,520,000 and its share of the revaluation, 170,000 × 1,200 / 1,700 = 120,000:
      #   14,400,000.00 SYP = 1,200.00 × 120
      summary: { currency: USD, contract_value: 10000000, cumulative: 0, billed: "0.0",
                 revenue: 0, direct_costs: 145200000, contribution: -145200000, margin: null,
                 retention_receivable: 0, client_advance: 0,
                 subcontract_retention: 14400000, subcontract_advance: 0 }
      costs:
        # the terms are in USD and the book in SYP: no budget and no variance
        - { account: "511003", in_range: 145200000, to_date: 145200000, budget: 0, variance: null, used: null }
      costs_totals: { in_range: 145200000, to_date: 145200000, budget: 0, variance: null, used: null }
      materials: []
      wages: []
      subcontracts:
        - { supplier: S2, currency: USD, value: 5000000, cumulative: 1200000, retention: 14400000, advance: 0, paid: 0 }
      billings: []
    - report: project_report
      params: { contract: P2, from: 2026-12-01, to: 2026-12-31, ledger: book }
      marks: [period_open]
      # P2's 6,050,000 and the rest of the revaluation, 50,000: 6,000,000.00 SYP = 500.00 × 120;
      #   with P1's, 20,400,000.00, S2's retentions in the book
      summary: { currency: USD, contract_value: 4000000, cumulative: 0, billed: "0.0",
                 revenue: 0, direct_costs: 60500000, contribution: -60500000, margin: null,
                 retention_receivable: 0, client_advance: 0,
                 subcontract_retention: 6000000, subcontract_advance: 0 }
      costs:
        - { account: "511003", in_range: 60500000, to_date: 60500000, budget: 0, variance: null, used: null }
      costs_totals: { in_range: 60500000, to_date: 60500000, budget: 0, variance: null, used: null }
      materials: []
      wages: []
      subcontracts:
        - { supplier: S2, currency: USD, value: 2000000, cumulative: 500000, retention: 6000000, advance: 0, paid: 0 }
      billings: []
```
