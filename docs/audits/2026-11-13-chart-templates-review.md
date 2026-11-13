# Review of the chart templates, 2026-11-13 (Q3)

The owner decided on 2026-11-13 that the chart templates are approved on Claude Code's review instead of Syrian accountants' (open question Q3, answered: "أراجعها وأعتمدها وحدي … أوافق"). This is that review, of `service-agency@2` and `general@2` in `packages/contracts/src/chart-templates.ts`, made by the `accountant-reviewer` against ADR 0011, `STATEMENT_LINES`, `checkAccountShape` and `accountRoleFits` in `packages/contracts/src/chart.ts`, S02 ("Templates"), S05–S07, `docs/product/phase-1-scope.md` and `docs/research/market-syria.md` §4. Its changes become `service-agency@3` and `general@3`.

## Verdict

The structure is sound:
- every code fits ADR 0011, and every postable account is a level-3 or level-4 leaf;
- every statement line fits its class, and the seven roles sit on accounts of the right class in both templates;
- the 17 posting-slot mappings pass `slotAccountFits`;
- the monetary flags follow IAS 21.16 (prepaid expenses, contract liabilities, equipment and equity non-monetary; cash, receivables, contract assets as scope §6 decides, payables, the expense clearing account, client ad funds, taxes and accruals monetary);
- contract assets and liabilities both carry `contract`, so the position nets per contract (IFRS 15.105);
- exchange differences: realised and unrealised gains and losses on separate accounts, presented net (IAS 21.52(a)), and conversion rounding on its own account;
- client ad funds are a liability, never revenue.

No account has a wrong class, normal balance, monetary or control flag, item kind, currency restriction or role.

## Owner's decisions (2026-11-13)

- **Vertex Media is a sole proprietorship.** `313001` "جاري المالك" stays in equity (the owner's drawings) in `service-agency`, and that template gets no legal reserve. The accounts a company with legal personality needs (partners' current accounts as a monetary liability, IAS 32.11 and 32.16; the legal reserve) go into `general@3` only.
- **Version 3 is the full one**: the additions below with the new statement lines they need (a database migration of the statement-line check, the readers, i18n and the print sheets), in one PR.

## Findings

### Presentation errors

| # | Finding | Fix in version 3 |
|---|---|---|
| E1 | `214002` (consumption fee), `214003` (stamp duty) and `214004` (payroll tax withheld) sit on `bs.tax_liabilities`, the IAS 1.54(n) line for current tax under IAS 12. They are not income taxes of the entity: a balance sheet would show them as current tax liabilities. | New line `bs.other_taxes_payable` ("ضرائب ورسوم أخرى مستحقة", current liabilities, IAS 1.55); the three accounts and `214005` use it. |
| E2 | The Latin names of `214002`–`214004` end in "(UNVERIFIED)", which prints on Latin exports. | Drop the mark from the names; keep the labels in this review and S02. |

(For a company with legal personality, `313001` in equity would be an error, IAS 32.11/32.16 with IAS 21.23(a): a withdrawable balance is a monetary liability. It is not one for Vertex Media, a sole proprietorship; `general@3` handles it below.)

### Accounts to add (`service-agency@3`; `general@3` follows unless noted)

| # | Code | Arabic / English | Statement line | Flags | Basis and label |
|---|---|---|---|---|---|
| A1 | `211004` | اشتراكات التأمينات الاجتماعية المستحقة / Social insurance contributions payable | `bs.trade_payables` | monetary | Obligation REPORTED (Decree 92/1959 as amended by Law 78/2001, `market-syria.md` §4.6); rates and ceilings UNVERIFIED. |
| A2 | `521003` | حصة صاحب العمل من التأمينات الاجتماعية / Employer's social insurance contributions | `is.employee_benefits` | requires `department` in service-agency | As A1. |
| A3 | `214005` | ضريبة غير المقيمين المقتطعة / Non-resident tax withheld | `bs.other_taxes_payable` | monetary | Income Tax Law 24/2003 art. 61(b): CONFIRMED on the 2003 text; later amendments and its reach to online ad platforms UNVERIFIED. |
| A4 | `532005` | ضريبة غير المقيمين المتحمَّلة / Non-resident tax borne | `is.other_expenses` | | When the agency bears it instead of withholding; not IAS 12 income tax. UNVERIFIED as A3. |
| A5 | `112003` | سلف الموظفين / Employee advances | `bs.trade_receivables` | monetary | No legal rule. |
| A6 | `114002` | دفعات مقدمة للموردين / Advances to suppliers | `bs.other_current_assets` | non-monetary (IAS 21.16) | |
| A7 | `114003` | تأمينات مستردة / Refundable deposits | `bs.other_current_assets` | monetary | |
| A8 | `112009` | مخصص الخسائر الائتمانية المتوقعة / Allowance for expected credit losses | `bs.trade_receivables` | credit balance, monetary, requires `client` | IFRS 9.5.5.15 (simplified approach, IFRS 15.107). |
| A9 | `532006` | خسائر انخفاض قيمة الذمم المدينة وأصول العقود / Impairment losses on receivables and contract assets | new line `is.impairment_losses` (operating) | | IAS 1.82(ba): a separate line. |
| A10 | `122`, `122001`, `122002` | الأصول غير الملموسة · البرمجيات والمواقع الإلكترونية / Software and websites · مجمع الإطفاء / Accumulated amortisation | new line `bs.intangible_assets` (non-current, IAS 1.54(c)) | non-monetary; `122002` credit balance | |
| A11 | `533003` | إطفاء الأصول غير الملموسة / Amortisation | `is.depreciation` | | The line's name becomes "الاستهلاك والإطفاء" / "Depreciation and amortisation" (its code unchanged). |
| A12 | `56`, `561`, `561001` | تكاليف التمويل · فوائد القروض والسحب على المكشوف / Interest on loans and overdrafts | `is.finance_costs` (exists, unused) | | IAS 1.82(b); IFRS 18 financing. |
| A13 | `216`, `216001` | القروض والسلف قصيرة الأجل / Short-term borrowings | new line `bs.borrowings` (current, IAS 1.54(m)) | monetary | Also a bank overdraft. |
| A14 | `211005` | مبالغ مستردة مستحقة للعملاء / Refund liabilities to clients | `bs.trade_payables` | monetary, requires `client` | IFRS 15.55. The slot `cancelled_project_refund` moves to it from `211003`. |
| A15 | `217`, `217001` | جاري الشركاء / Partners' current accounts | `bs.trade_payables` | credit balance, monetary | `general@3` only (IAS 32.11/32.16). |
| A16 | `314`, `314001` | الاحتياطيات · الاحتياطي القانوني / Legal reserve | new line `bs.reserves` (equity, IAS 1.54(r), 1.78(e)) | | `general@3` only. The Companies Law 29/2011 rule (10% of profit until 25% of capital) is UNVERIFIED: no checked source. |

### Optional, left for later
- `211001` (ad platforms payable) requires `client` without being a control account: one platform payment has to be split by client. A `platform` dimension may suit better; decide with Hub's integration.
- IFRS 16: `531001` Rent fits only leases of 12 months or less.
- Gains and losses on disposal of equipment, cash in transit, deferred tax (once the 2027 tax law is known).
- `general`: a sales revenue line without a required client, inventories (IAS 2, `bs.inventories`) and a supplier control account, before a trading company (phase 3).

## Not verified
- Syrian social-insurance rates and ceilings; whether the 2003 non-resident withholding still applies to online ad platforms; the 2026 salary-tax brackets; whether the consumption fee applies to an advertising agency; an advertising fee to a state body; end-of-service obligations under the Labour Law. The accounts above carry no rule: they only give such amounts a place. No posting rule may depend on these points without a written owner decision (`AGENTS.md`).
- How S06 holds a deferred manual invoice line without a contract, since `212001` and `113001` require `contract` (an S06 check, not a template error).
