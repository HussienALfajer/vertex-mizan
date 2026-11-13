ALTER TABLE "chart_accounts" DROP CONSTRAINT "chart_accounts_statement_line";--> statement-breakpoint
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_statement_line" CHECK (("chart_accounts"."kind" = 'postable') = ("chart_accounts"."statement_line" is not null)
        and ("chart_accounts"."statement_line" is null
          or ("chart_accounts"."class" in ('asset', 'liability', 'equity')
            and "chart_accounts"."statement_line" in ('bs.cash', 'bs.trade_receivables', 'bs.contract_assets', 'bs.other_current_assets', 'bs.ppe', 'bs.trade_payables', 'bs.contract_liabilities', 'bs.client_money', 'bs.tax_liabilities', 'bs.accruals', 'bs.share_capital', 'bs.retained_earnings', 'bs.owner_current', 'bs.other_taxes_payable', 'bs.intangible_assets', 'bs.borrowings', 'bs.reserves'))
          or ("chart_accounts"."class" in ('revenue', 'expense')
            and "chart_accounts"."statement_line" in ('is.revenue', 'is.other_income', 'is.direct_costs', 'is.employee_benefits', 'is.depreciation', 'is.other_expenses', 'is.fx_differences', 'is.finance_costs', 'is.income_tax', 'is.impairment_losses'))));