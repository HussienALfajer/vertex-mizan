CREATE TYPE "public"."account_role" AS ENUM('conversion_rounding', 'fx_realised_gain', 'fx_realised_loss', 'fx_unrealised_gain', 'fx_unrealised_loss', 'retained_earnings');--> statement-breakpoint
CREATE TABLE "account_required_dimensions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"dimension_type_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "account_required_dimensions_id_is_uuidv7" CHECK ((uuid_extract_version("account_required_dimensions"."id") = 7) is true)
);
--> statement-breakpoint
CREATE TABLE "account_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"role" "account_role" NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "account_roles_id_is_uuidv7" CHECK ((uuid_extract_version("account_roles"."id") = 7) is true)
);
--> statement-breakpoint
CREATE TABLE "chart_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"level" smallint NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"class" text NOT NULL,
	"name" text NOT NULL,
	"name_latin" text,
	"normal_balance" text NOT NULL,
	"statement_line" text,
	"currency" text,
	"is_control" boolean DEFAULT false NOT NULL,
	"is_monetary" boolean DEFAULT false NOT NULL,
	"blocked_at" timestamp with time zone,
	"blocked_reason" text,
	"first_posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_reason" text,
	CONSTRAINT "chart_accounts_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "chart_accounts_company_id_code_key" UNIQUE("company_id","code"),
	CONSTRAINT "chart_accounts_id_is_uuidv7" CHECK ((uuid_extract_version("chart_accounts"."id") = 7) is true),
	CONSTRAINT "chart_accounts_kind" CHECK ("chart_accounts"."kind" in ('header', 'postable')),
	CONSTRAINT "chart_accounts_class" CHECK ("chart_accounts"."class" in ('asset', 'liability', 'equity', 'revenue', 'expense')),
	CONSTRAINT "chart_accounts_normal_balance" CHECK ("chart_accounts"."normal_balance" in ('debit', 'credit')),
	CONSTRAINT "chart_accounts_code_shape" CHECK (("chart_accounts"."level" = 1 and "chart_accounts"."code" ~ '^[1-5]$')
        or ("chart_accounts"."level" = 2 and "chart_accounts"."code" ~ '^[1-5][1-9]$')
        or ("chart_accounts"."level" = 3 and "chart_accounts"."code" ~ '^[1-5][1-9][1-9]$')
        or ("chart_accounts"."level" = 4 and "chart_accounts"."code" ~ '^[1-5][1-9][1-9][0-9]{3}$' and right("chart_accounts"."code", 3) <> '000')),
	CONSTRAINT "chart_accounts_class_of_code" CHECK (("chart_accounts"."class" = case left("chart_accounts"."code", 1) when '1' then 'asset' when '2' then 'liability'
        when '3' then 'equity' when '4' then 'revenue' when '5' then 'expense' end) is true),
	CONSTRAINT "chart_accounts_parent_by_level" CHECK (("chart_accounts"."level" = 1) = ("chart_accounts"."parent_id" is null)),
	CONSTRAINT "chart_accounts_postable_level" CHECK ("chart_accounts"."kind" = 'header' or "chart_accounts"."level" >= 3),
	CONSTRAINT "chart_accounts_statement_line" CHECK (("chart_accounts"."kind" = 'postable') = ("chart_accounts"."statement_line" is not null)
        and ("chart_accounts"."statement_line" is null
          or ("chart_accounts"."class" in ('asset', 'liability', 'equity')
            and "chart_accounts"."statement_line" in ('bs.cash', 'bs.trade_receivables', 'bs.contract_assets', 'bs.other_current_assets', 'bs.ppe', 'bs.trade_payables', 'bs.contract_liabilities', 'bs.client_money', 'bs.tax_liabilities', 'bs.accruals', 'bs.share_capital', 'bs.retained_earnings', 'bs.owner_current'))
          or ("chart_accounts"."class" in ('revenue', 'expense')
            and "chart_accounts"."statement_line" in ('is.revenue', 'is.other_income', 'is.direct_costs', 'is.employee_benefits', 'is.depreciation', 'is.other_expenses', 'is.fx_differences', 'is.finance_costs', 'is.income_tax')))),
	CONSTRAINT "chart_accounts_flags" CHECK ((not ("chart_accounts"."is_control" or "chart_accounts"."is_monetary") or "chart_accounts"."class" in ('asset', 'liability'))
        and ("chart_accounts"."kind" = 'postable' or (not "chart_accounts"."is_control" and not "chart_accounts"."is_monetary" and "chart_accounts"."currency" is null))),
	CONSTRAINT "chart_accounts_currency" CHECK ("chart_accounts"."currency" is null or "chart_accounts"."currency" in ('USD', 'SYP', 'TRY', 'EUR')),
	CONSTRAINT "chart_accounts_name_length" CHECK (char_length("chart_accounts"."name") between 1 and 200),
	CONSTRAINT "chart_accounts_name_latin_length" CHECK ("chart_accounts"."name_latin" is null or char_length("chart_accounts"."name_latin") between 1 and 200),
	CONSTRAINT "chart_accounts_blocked_with_reason" CHECK (("chart_accounts"."blocked_at" is null) = ("chart_accounts"."blocked_reason" is null)
        and ("chart_accounts"."blocked_reason" is null or char_length("chart_accounts"."blocked_reason") between 1 and 1000)),
	CONSTRAINT "chart_accounts_archived_with_reason" CHECK (("chart_accounts"."archived_at" is null) = ("chart_accounts"."archived_reason" is null)
        and ("chart_accounts"."archived_reason" is null or char_length("chart_accounts"."archived_reason") between 1 and 1000))
);
--> statement-breakpoint
CREATE TABLE "dimension_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"builtin" boolean NOT NULL,
	"parent_type_id" uuid,
	"name" text NOT NULL,
	"name_latin" text,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "dimension_types_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "dimension_types_company_id_code_key" UNIQUE("company_id","code"),
	CONSTRAINT "dimension_types_id_is_uuidv7" CHECK ((uuid_extract_version("dimension_types"."id") = 7) is true),
	CONSTRAINT "dimension_types_code_shape" CHECK ("dimension_types"."code" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "dimension_types_name_length" CHECK (char_length("dimension_types"."name") between 1 and 100),
	CONSTRAINT "dimension_types_name_latin_length" CHECK ("dimension_types"."name_latin" is null or char_length("dimension_types"."name_latin") between 1 and 100),
	CONSTRAINT "dimension_types_position" CHECK ("dimension_types"."position" between 1 and 100),
	CONSTRAINT "dimension_types_custom_no_parent" CHECK ("dimension_types"."builtin" or "dimension_types"."parent_type_id" is null),
	CONSTRAINT "dimension_types_builtin_active" CHECK (not "dimension_types"."builtin" or "dimension_types"."archived_at" is null)
);
--> statement-breakpoint
CREATE TABLE "dimension_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"name_latin" text,
	"contract_kind" text,
	"parent_value_id" uuid,
	"external_source" text,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "dimension_values_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "dimension_values_id_is_uuidv7" CHECK ((uuid_extract_version("dimension_values"."id") = 7) is true),
	CONSTRAINT "dimension_values_name_length" CHECK (char_length("dimension_values"."name") between 1 and 200),
	CONSTRAINT "dimension_values_name_latin_length" CHECK ("dimension_values"."name_latin" is null or char_length("dimension_values"."name_latin") between 1 and 200),
	CONSTRAINT "dimension_values_code_length" CHECK ("dimension_values"."code" is null or char_length("dimension_values"."code") between 1 and 40),
	CONSTRAINT "dimension_values_contract_kind" CHECK ("dimension_values"."contract_kind" is null or "dimension_values"."contract_kind" in ('project', 'retainer')),
	CONSTRAINT "dimension_values_external" CHECK (("dimension_values"."external_source" is null) = ("dimension_values"."external_id" is null)
        and ("dimension_values"."external_source" is null or "dimension_values"."external_source" in ('hub'))
        and ("dimension_values"."external_id" is null or char_length("dimension_values"."external_id") between 1 and 100))
);
--> statement-breakpoint
CREATE TABLE "bulletin_holidays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"holiday_on" date NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "bulletin_holidays_id_is_uuidv7" CHECK ((uuid_extract_version("bulletin_holidays"."id") = 7) is true),
	CONSTRAINT "bulletin_holidays_note_length" CHECK (char_length("bulletin_holidays"."note") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"effective_on" date NOT NULL,
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" numeric(22, 10) NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"supersedes_rate_id" uuid,
	"reason" text,
	"recorded_by_user_id" uuid,
	"recorded_by_api_client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "exchange_rates_id_is_uuidv7" CHECK ((uuid_extract_version("exchange_rates"."id") = 7) is true),
	CONSTRAINT "exchange_rates_rate_positive" CHECK ("exchange_rates"."rate" > 0),
	CONSTRAINT "exchange_rates_type" CHECK ("exchange_rates"."type" in ('market', 'bulletin')),
	CONSTRAINT "exchange_rates_source" CHECK ("exchange_rates"."source" in ('hub', 'manual', 'import')),
	CONSTRAINT "exchange_rates_correction_reason" CHECK (("exchange_rates"."supersedes_rate_id" is null) = ("exchange_rates"."reason" is null)
        and ("exchange_rates"."reason" is null or char_length("exchange_rates"."reason") between 1 and 500)),
	CONSTRAINT "exchange_rates_one_recorder" CHECK (("exchange_rates"."recorded_by_user_id" is null) <> ("exchange_rates"."recorded_by_api_client_id" is null)),
	CONSTRAINT "exchange_rates_syp_redenominated" CHECK ('SYP' not in ("exchange_rates"."base", "exchange_rates"."quote") or "exchange_rates"."effective_on" >= date '2026-01-01')
);
--> statement-breakpoint
CREATE TABLE "rate_pairs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "rate_pairs_company_base_quote_key" UNIQUE("company_id","base","quote"),
	CONSTRAINT "rate_pairs_id_is_uuidv7" CHECK ((uuid_extract_version("rate_pairs"."id") = 7) is true),
	CONSTRAINT "rate_pairs_two_currencies" CHECK ("rate_pairs"."base" <> "rate_pairs"."quote"),
	CONSTRAINT "rate_pairs_currencies" CHECK ("rate_pairs"."base" in ('USD', 'SYP', 'TRY', 'EUR') and "rate_pairs"."quote" in ('USD', 'SYP', 'TRY', 'EUR'))
);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "bulletin_days_off" smallint[] DEFAULT '{5,6}' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_required_dimensions" ADD CONSTRAINT "account_required_dimensions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_required_dimensions" ADD CONSTRAINT "account_required_dimensions_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."chart_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_required_dimensions" ADD CONSTRAINT "account_required_dimensions_type_fk" FOREIGN KEY ("company_id","dimension_type_id") REFERENCES "public"."dimension_types"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_roles" ADD CONSTRAINT "account_roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_roles" ADD CONSTRAINT "account_roles_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."chart_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_parent_fk" FOREIGN KEY ("company_id","parent_id") REFERENCES "public"."chart_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension_types" ADD CONSTRAINT "dimension_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension_types" ADD CONSTRAINT "dimension_types_parent_fk" FOREIGN KEY ("company_id","parent_type_id") REFERENCES "public"."dimension_types"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension_values" ADD CONSTRAINT "dimension_values_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension_values" ADD CONSTRAINT "dimension_values_type_fk" FOREIGN KEY ("company_id","type_id") REFERENCES "public"."dimension_types"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension_values" ADD CONSTRAINT "dimension_values_parent_fk" FOREIGN KEY ("company_id","parent_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulletin_holidays" ADD CONSTRAINT "bulletin_holidays_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_pair_fk" FOREIGN KEY ("company_id","base","quote") REFERENCES "public"."rate_pairs"("company_id","base","quote") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_supersedes_fk" FOREIGN KEY ("company_id","supersedes_rate_id") REFERENCES "public"."exchange_rates"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_pairs" ADD CONSTRAINT "rate_pairs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_required_dimensions_company_account_idx" ON "account_required_dimensions" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE INDEX "account_required_dimensions_company_type_idx" ON "account_required_dimensions" USING btree ("company_id","dimension_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_required_dimensions_active_key" ON "account_required_dimensions" USING btree ("company_id","account_id","dimension_type_id") WHERE "account_required_dimensions"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "account_roles_company_account_idx" ON "account_roles" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_roles_active_key" ON "account_roles" USING btree ("company_id","role") WHERE "account_roles"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "chart_accounts_company_parent_idx" ON "chart_accounts" USING btree ("company_id","parent_id");--> statement-breakpoint
CREATE INDEX "dimension_types_company_parent_idx" ON "dimension_types" USING btree ("company_id","parent_type_id");--> statement-breakpoint
CREATE INDEX "dimension_values_company_type_name_idx" ON "dimension_values" USING btree ("company_id","type_id","name");--> statement-breakpoint
CREATE INDEX "dimension_values_company_parent_idx" ON "dimension_values" USING btree ("company_id","parent_value_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dimension_values_code_key" ON "dimension_values" USING btree ("company_id","type_id","code") WHERE "dimension_values"."code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "dimension_values_external_key" ON "dimension_values" USING btree ("company_id","type_id","external_source","external_id") WHERE "dimension_values"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "bulletin_holidays_active_key" ON "bulletin_holidays" USING btree ("company_id","holiday_on") WHERE "bulletin_holidays"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "bulletin_holidays_company_on_idx" ON "bulletin_holidays" USING btree ("company_id","holiday_on");--> statement-breakpoint
CREATE INDEX "exchange_rates_lookup_idx" ON "exchange_rates" USING btree ("company_id","type","base","quote","effective_on","created_at");--> statement-breakpoint
CREATE INDEX "exchange_rates_company_pair_idx" ON "exchange_rates" USING btree ("company_id","base","quote","effective_on");--> statement-breakpoint
CREATE INDEX "exchange_rates_company_supersedes_idx" ON "exchange_rates" USING btree ("company_id","supersedes_rate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_pairs_company_currencies_key" ON "rate_pairs" USING btree ("company_id",least("base", "quote"),greatest("base", "quote"));--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_bulletin_days_off" CHECK ("company_settings"."bulletin_days_off" <@ '{1,2,3,4,5,6,7}'::smallint[]
        and cardinality("company_settings"."bulletin_days_off") <= 6
        and array_position("company_settings"."bulletin_days_off", null) is null);