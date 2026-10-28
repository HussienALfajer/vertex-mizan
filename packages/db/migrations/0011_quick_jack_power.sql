CREATE TABLE "dimension_set_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"set_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"value_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dimension_set_values_type_key" UNIQUE("company_id","set_id","type_id"),
	CONSTRAINT "dimension_set_values_id_is_uuidv7" CHECK ((uuid_extract_version("dimension_set_values"."id") = 7) is true)
);
--> statement-breakpoint
CREATE TABLE "dimension_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dimension_sets_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "dimension_sets_key" UNIQUE("company_id","key"),
	CONSTRAINT "dimension_sets_id_is_uuidv7" CHECK ((uuid_extract_version("dimension_sets"."id") = 7) is true),
	CONSTRAINT "dimension_sets_key_shape" CHECK ("dimension_sets"."key" ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})*)?$')
);
--> statement-breakpoint
CREATE TABLE "entry_number_counters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"fiscal_year" smallint NOT NULL,
	"last_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_number_counters_year_key" UNIQUE("company_id","fiscal_year"),
	CONSTRAINT "entry_number_counters_id_is_uuidv7" CHECK ((uuid_extract_version("entry_number_counters"."id") = 7) is true),
	CONSTRAINT "entry_number_counters_fiscal_year" CHECK ("entry_number_counters"."fiscal_year" between 2000 and 9999),
	CONSTRAINT "entry_number_counters_last_number" CHECK ("entry_number_counters"."last_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"fiscal_year" smallint NOT NULL,
	"number" integer NOT NULL,
	"entry_date" date NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"hub_document" jsonb,
	"description" text NOT NULL,
	"reference" text,
	"reverses_entry_id" uuid,
	"draft_id" uuid,
	"prepared_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"posted_by_user_id" uuid,
	"posted_by_client_id" uuid,
	"line_count" smallint NOT NULL,
	"previous_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "journal_entries_number_key" UNIQUE("company_id","fiscal_year","number"),
	CONSTRAINT "journal_entries_reverses_key" UNIQUE("company_id","reverses_entry_id"),
	CONSTRAINT "journal_entries_request_key" UNIQUE("company_id","request_id"),
	CONSTRAINT "journal_entries_hash_key" UNIQUE("company_id","hash"),
	CONSTRAINT "journal_entries_sequence_key" UNIQUE("company_id","sequence"),
	CONSTRAINT "journal_entries_previous_hash_key" UNIQUE NULLS NOT DISTINCT("company_id","previous_hash"),
	CONSTRAINT "journal_entries_id_is_uuidv7" CHECK ((uuid_extract_version("journal_entries"."id") = 7) is true),
	CONSTRAINT "journal_entries_source" CHECK ("journal_entries"."source" in ('manual', 'hub_event', 'opening', 'revaluation', 'revenue_release')),
	CONSTRAINT "journal_entries_sequence" CHECK ("journal_entries"."sequence" >= 1),
	CONSTRAINT "journal_entries_number" CHECK ("journal_entries"."number" >= 1),
	CONSTRAINT "journal_entries_fiscal_year" CHECK ("journal_entries"."fiscal_year" between 2000 and 9999),
	CONSTRAINT "journal_entries_line_count" CHECK ("journal_entries"."line_count" >= 2),
	CONSTRAINT "journal_entries_description_length" CHECK (char_length("journal_entries"."description") between 1 and 500),
	CONSTRAINT "journal_entries_reference_length" CHECK ("journal_entries"."reference" is null or char_length("journal_entries"."reference") between 1 and 100),
	CONSTRAINT "journal_entries_source_ref_length" CHECK ("journal_entries"."source_ref" is null or char_length("journal_entries"."source_ref") between 1 and 200),
	CONSTRAINT "journal_entries_not_self_reversal" CHECK ("journal_entries"."reverses_entry_id" <> "journal_entries"."id"),
	CONSTRAINT "journal_entries_posted_by" CHECK (("journal_entries"."posted_by_user_id" is null or "journal_entries"."posted_by_client_id" is null)
        and ("journal_entries"."source" <> 'manual' or "journal_entries"."posted_by_user_id" is not null)),
	CONSTRAINT "journal_entries_hashes" CHECK ("journal_entries"."hash" ~ '^[0-9a-f]{64}$'
        and ("journal_entries"."previous_hash" is null or "journal_entries"."previous_hash" ~ '^[0-9a-f]{64}$')
        and ("journal_entries"."sequence" = 1) = ("journal_entries"."previous_hash" is null))
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"account_id" uuid NOT NULL,
	"dimension_set_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ledger" text,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"book_minor" bigint NOT NULL,
	"parallel_minor" bigint,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_lines_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "journal_lines_line_no_key" UNIQUE("company_id","entry_id","line_no"),
	CONSTRAINT "journal_lines_id_is_uuidv7" CHECK ((uuid_extract_version("journal_lines"."id") = 7) is true),
	CONSTRAINT "journal_lines_line_no" CHECK ("journal_lines"."line_no" >= 1),
	CONSTRAINT "journal_lines_kind" CHECK ("journal_lines"."kind" in ('measured', 'carried', 'difference', 'rounding')),
	CONSTRAINT "journal_lines_ledger" CHECK (("journal_lines"."ledger" is not null) = ("journal_lines"."kind" in ('difference', 'rounding'))
        and ("journal_lines"."ledger" is null or "journal_lines"."ledger" in ('book', 'parallel'))),
	CONSTRAINT "journal_lines_one_ledger" CHECK ("journal_lines"."ledger" is null
        or ("journal_lines"."ledger" = 'book' and coalesce("journal_lines"."parallel_minor", 0) = 0)
        or ("journal_lines"."ledger" = 'parallel' and "journal_lines"."book_minor" = 0 and "journal_lines"."parallel_minor" is not null)),
	CONSTRAINT "journal_lines_currency" CHECK ("journal_lines"."currency" in ('USD', 'SYP', 'TRY', 'EUR')),
	CONSTRAINT "journal_lines_memo_length" CHECK ("journal_lines"."memo" is null or char_length("journal_lines"."memo") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "ledger_heads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_count" bigint NOT NULL,
	"last_entry_id" uuid,
	"last_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_heads_company_id_key" UNIQUE("company_id"),
	CONSTRAINT "ledger_heads_id_is_uuidv7" CHECK ((uuid_extract_version("ledger_heads"."id") = 7) is true),
	CONSTRAINT "ledger_heads_state" CHECK ("ledger_heads"."entry_count" >= 0
        and ("ledger_heads"."entry_count" = 0) = ("ledger_heads"."last_entry_id" is null)
        and ("ledger_heads"."entry_count" = 0) = ("ledger_heads"."last_hash" is null)
        and ("ledger_heads"."last_hash" is null or "ledger_heads"."last_hash" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
CREATE TABLE "line_conversions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"ledger" text NOT NULL,
	"basis" text NOT NULL,
	"quote_no" smallint NOT NULL,
	"rate_id" uuid,
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" numeric(22, 10) NOT NULL,
	"rate_type" text NOT NULL,
	"rate_source" text NOT NULL,
	"effective_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_conversions_quote_key" UNIQUE("company_id","line_id","ledger","quote_no"),
	CONSTRAINT "line_conversions_id_is_uuidv7" CHECK ((uuid_extract_version("line_conversions"."id") = 7) is true),
	CONSTRAINT "line_conversions_ledger" CHECK ("line_conversions"."ledger" in ('book', 'parallel')),
	CONSTRAINT "line_conversions_basis" CHECK ("line_conversions"."basis" in ('policy', 'transaction')
        and ("line_conversions"."rate_id" is null) = ("line_conversions"."basis" = 'transaction')
        and ("line_conversions"."basis" = 'policy' or "line_conversions"."quote_no" = 1)),
	CONSTRAINT "line_conversions_quote_no" CHECK ("line_conversions"."quote_no" in (1, 2)),
	CONSTRAINT "line_conversions_rate_positive" CHECK ("line_conversions"."rate" > 0),
	CONSTRAINT "line_conversions_currencies" CHECK ("line_conversions"."base" <> "line_conversions"."quote"
        and "line_conversions"."base" in ('USD', 'SYP', 'TRY', 'EUR')
        and "line_conversions"."quote" in ('USD', 'SYP', 'TRY', 'EUR')),
	CONSTRAINT "line_conversions_rate_type" CHECK ("line_conversions"."rate_type" in ('market', 'bulletin')),
	CONSTRAINT "line_conversions_rate_source" CHECK ("line_conversions"."rate_source" in ('hub', 'manual', 'import'))
);
--> statement-breakpoint
CREATE TABLE "period_balances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"dimension_set_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"debit_minor" bigint NOT NULL,
	"credit_minor" bigint NOT NULL,
	"book_debit_minor" bigint NOT NULL,
	"book_credit_minor" bigint NOT NULL,
	"parallel_debit_minor" bigint,
	"parallel_credit_minor" bigint,
	"line_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_balances_key" UNIQUE("company_id","period_id","account_id","dimension_set_id","currency"),
	CONSTRAINT "period_balances_id_is_uuidv7" CHECK ((uuid_extract_version("period_balances"."id") = 7) is true),
	CONSTRAINT "period_balances_totals" CHECK ("period_balances"."debit_minor" >= 0 and "period_balances"."credit_minor" >= 0
        and "period_balances"."book_debit_minor" >= 0 and "period_balances"."book_credit_minor" >= 0
        and ("period_balances"."parallel_debit_minor" is null) = ("period_balances"."parallel_credit_minor" is null)
        and coalesce("period_balances"."parallel_debit_minor", 0) >= 0 and coalesce("period_balances"."parallel_credit_minor", 0) >= 0
        and "period_balances"."line_count" >= 1),
	CONSTRAINT "period_balances_currency" CHECK ("period_balances"."currency" in ('USD', 'SYP', 'TRY', 'EUR'))
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"period" text NOT NULL,
	"fiscal_year" smallint NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "periods_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "periods_period_key" UNIQUE("company_id","period"),
	CONSTRAINT "periods_id_is_uuidv7" CHECK ((uuid_extract_version("periods"."id") = 7) is true),
	CONSTRAINT "periods_period_shape" CHECK ("periods"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "periods_fiscal_year" CHECK ("periods"."fiscal_year" between 2000 and 9999),
	CONSTRAINT "periods_state" CHECK ("periods"."state" in ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "posting_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"client" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posting_requests_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "posting_requests_key" UNIQUE("company_id","client","idempotency_key"),
	CONSTRAINT "posting_requests_id_is_uuidv7" CHECK ((uuid_extract_version("posting_requests"."id") = 7) is true),
	CONSTRAINT "posting_requests_client" CHECK ("posting_requests"."client" in ('manual', 'system') or "posting_requests"."client" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "posting_requests_key_length" CHECK (char_length("posting_requests"."idempotency_key") between 1 and 200),
	CONSTRAINT "posting_requests_payload_hash" CHECK ("posting_requests"."payload_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "dimension_set_values" ADD CONSTRAINT "dimension_set_values_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension_set_values" ADD CONSTRAINT "dimension_set_values_set_fk" FOREIGN KEY ("company_id","set_id") REFERENCES "public"."dimension_sets"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension_set_values" ADD CONSTRAINT "dimension_set_values_value_fk" FOREIGN KEY ("company_id","value_id","type_id") REFERENCES "public"."dimension_values"("company_id","id","type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension_sets" ADD CONSTRAINT "dimension_sets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_number_counters" ADD CONSTRAINT "entry_number_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_request_fk" FOREIGN KEY ("company_id","request_id") REFERENCES "public"."posting_requests"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reverses_fk" FOREIGN KEY ("company_id","reverses_entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_fk" FOREIGN KEY ("company_id","entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."chart_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_dimension_set_fk" FOREIGN KEY ("company_id","dimension_set_id") REFERENCES "public"."dimension_sets"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_heads" ADD CONSTRAINT "ledger_heads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_heads" ADD CONSTRAINT "ledger_heads_last_entry_fk" FOREIGN KEY ("company_id","last_entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_conversions" ADD CONSTRAINT "line_conversions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_conversions" ADD CONSTRAINT "line_conversions_line_fk" FOREIGN KEY ("company_id","line_id") REFERENCES "public"."journal_lines"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_conversions" ADD CONSTRAINT "line_conversions_rate_fk" FOREIGN KEY ("company_id","rate_id") REFERENCES "public"."exchange_rates"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_balances" ADD CONSTRAINT "period_balances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_balances" ADD CONSTRAINT "period_balances_period_fk" FOREIGN KEY ("company_id","period_id") REFERENCES "public"."periods"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_balances" ADD CONSTRAINT "period_balances_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."chart_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_balances" ADD CONSTRAINT "period_balances_dimension_set_fk" FOREIGN KEY ("company_id","dimension_set_id") REFERENCES "public"."dimension_sets"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_requests" ADD CONSTRAINT "posting_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dimension_set_values_company_value_idx" ON "dimension_set_values" USING btree ("company_id","value_id","type_id");--> statement-breakpoint
CREATE INDEX "journal_entries_company_date_idx" ON "journal_entries" USING btree ("company_id","entry_date","number");--> statement-breakpoint
CREATE INDEX "journal_lines_company_account_idx" ON "journal_lines" USING btree ("company_id","account_id","entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_company_dimension_set_idx" ON "journal_lines" USING btree ("company_id","dimension_set_id");--> statement-breakpoint
CREATE INDEX "ledger_heads_company_last_entry_idx" ON "ledger_heads" USING btree ("company_id","last_entry_id");--> statement-breakpoint
CREATE INDEX "line_conversions_company_rate_idx" ON "line_conversions" USING btree ("company_id","rate_id");--> statement-breakpoint
CREATE INDEX "period_balances_company_account_idx" ON "period_balances" USING btree ("company_id","account_id","period_id");--> statement-breakpoint
CREATE INDEX "period_balances_company_dimension_set_idx" ON "period_balances" USING btree ("company_id","dimension_set_id");