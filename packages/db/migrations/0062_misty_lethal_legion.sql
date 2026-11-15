CREATE TYPE "public"."cash_kind" AS ENUM('box', 'bank');--> statement-breakpoint
CREATE TYPE "public"."counterparty_type" AS ENUM('client', 'supplier', 'worker');--> statement-breakpoint
-- migration-guard: allow append-only-rewrite (ADR 0022)
ALTER TABLE "open_items" RENAME COLUMN "client_value_id" TO "counterparty_value_id";--> statement-breakpoint
ALTER TABLE "dimension_types" DROP CONSTRAINT "dimension_types_builtin_codes";--> statement-breakpoint
ALTER TABLE "open_items" DROP CONSTRAINT "open_items_running_client";--> statement-breakpoint
ALTER TABLE "open_items" DROP CONSTRAINT "open_items_client_fk";
--> statement-breakpoint
DROP INDEX "open_items_company_client_idx";--> statement-breakpoint
DROP INDEX "open_items_running_key";--> statement-breakpoint
DROP INDEX "open_items_company_account_idx";--> statement-breakpoint
ALTER TABLE "chart_accounts" ADD COLUMN "counterparty_type" "counterparty_type";--> statement-breakpoint
ALTER TABLE "chart_accounts" ADD COLUMN "cash_kind" "cash_kind";--> statement-breakpoint
ALTER TABLE "open_items" ADD CONSTRAINT "open_items_counterparty_fk" FOREIGN KEY ("company_id","counterparty_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "open_items_company_counterparty_idx" ON "open_items" USING btree ("company_id","counterparty_value_id");--> statement-breakpoint
CREATE UNIQUE INDEX "open_items_running_key" ON "open_items" USING btree ("company_id","account_id","counterparty_value_id","currency") WHERE "open_items"."kind" = 'running';--> statement-breakpoint
CREATE INDEX "open_items_company_account_idx" ON "open_items" USING btree ("company_id","account_id","counterparty_value_id");--> statement-breakpoint
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_cash_kind" CHECK ("chart_accounts"."cash_kind" is null or ("chart_accounts"."kind" = 'postable' and "chart_accounts"."class" = 'asset'
        and "chart_accounts"."level" = 4 and left("chart_accounts"."code", 3) = '111' and "chart_accounts"."currency" is not null
        and "chart_accounts"."is_monetary" and not "chart_accounts"."is_control" and "chart_accounts"."statement_line" = 'bs.cash'));--> statement-breakpoint
ALTER TABLE "dimension_types" ADD CONSTRAINT "dimension_types_builtin_codes" CHECK (not "dimension_types"."builtin" or "dimension_types"."code" in ('client', 'contract', 'department', 'service', 'supplier', 'worker'));--> statement-breakpoint
ALTER TABLE "open_items" ADD CONSTRAINT "open_items_running_counterparty" CHECK ("open_items"."kind" = 'document' or "open_items"."counterparty_value_id" is not null);