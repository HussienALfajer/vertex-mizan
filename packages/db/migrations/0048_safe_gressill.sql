CREATE TABLE "journal_book_prints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"report_file_id" uuid NOT NULL,
	"fiscal_year" smallint NOT NULL,
	"from_period_id" uuid NOT NULL,
	"to_period_id" uuid NOT NULL,
	"first_page" integer,
	"last_page" integer,
	"entry_count" integer NOT NULL,
	"line_count" integer NOT NULL,
	"debit_total_minor" bigint NOT NULL,
	"credit_total_minor" bigint NOT NULL,
	"content_sha256" text NOT NULL,
	"file_sha256" text NOT NULL,
	"printed_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_book_prints_report_file_key" UNIQUE("company_id","report_file_id"),
	CONSTRAINT "journal_book_prints_id_is_uuidv7" CHECK ((uuid_extract_version("journal_book_prints"."id") = 7) is true),
	CONSTRAINT "journal_book_prints_fiscal_year" CHECK ("journal_book_prints"."fiscal_year" between 2000 and 9999),
	CONSTRAINT "journal_book_prints_pages" CHECK (("journal_book_prints"."first_page" is null) = ("journal_book_prints"."last_page" is null)
        and ("journal_book_prints"."first_page" is null) = ("journal_book_prints"."entry_count" = 0)
        and ("journal_book_prints"."first_page" is null or ("journal_book_prints"."first_page" >= 1 and "journal_book_prints"."first_page" <= "journal_book_prints"."last_page"))),
	CONSTRAINT "journal_book_prints_counts" CHECK ("journal_book_prints"."entry_count" >= 0 and "journal_book_prints"."line_count" >= "journal_book_prints"."entry_count"
        and ("journal_book_prints"."entry_count" = 0) = ("journal_book_prints"."line_count" = 0)),
	CONSTRAINT "journal_book_prints_totals" CHECK ("journal_book_prints"."debit_total_minor" = "journal_book_prints"."credit_total_minor" and "journal_book_prints"."debit_total_minor" >= 0),
	CONSTRAINT "journal_book_prints_content_sha256" CHECK ("journal_book_prints"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "journal_book_prints_file_sha256" CHECK ("journal_book_prints"."file_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "report_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"report" text NOT NULL,
	"params" jsonb NOT NULL,
	"format" text DEFAULT 'pdf' NOT NULL,
	"official" boolean DEFAULT false NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"storage_key" text,
	"size_bytes" bigint,
	"sha256" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"ready_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_files_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "report_files_id_is_uuidv7" CHECK ((uuid_extract_version("report_files"."id") = 7) is true),
	CONSTRAINT "report_files_report" CHECK ("report_files"."report" in ('trial_balance', 'general_ledger', 'account_statement', 'journal_book', 'income_statement', 'balance_sheet', 'profitability', 'contract_position', 'revenue_schedule', 'ageing', 'client_statement', 'chart')),
	CONSTRAINT "report_files_format" CHECK ("report_files"."format" = 'pdf'),
	CONSTRAINT "report_files_official" CHECK (not "report_files"."official" or "report_files"."report" = 'journal_book'),
	CONSTRAINT "report_files_params" CHECK (jsonb_typeof("report_files"."params") = 'object'),
	CONSTRAINT "report_files_state" CHECK ("report_files"."state" in ('queued', 'ready', 'failed', 'expired')),
	CONSTRAINT "report_files_ready_fields" CHECK (("report_files"."state" in ('ready', 'expired')) = ("report_files"."storage_key" is not null)
        and ("report_files"."storage_key" is null) = ("report_files"."size_bytes" is null)
        and ("report_files"."storage_key" is null) = ("report_files"."sha256" is null)
        and ("report_files"."storage_key" is null) = ("report_files"."ready_at" is null)
        and (("report_files"."storage_key" is not null and not "report_files"."official") = ("report_files"."expires_at" is not null))
        and ("report_files"."state" = 'failed') = ("report_files"."error" is not null)),
	CONSTRAINT "report_files_official_kept" CHECK (not ("report_files"."official" and "report_files"."state" = 'expired')),
	CONSTRAINT "report_files_storage_key" CHECK ("report_files"."storage_key" is null or "report_files"."storage_key" = "report_files"."company_id"::text || '/' || "report_files"."id"::text),
	CONSTRAINT "report_files_size" CHECK ("report_files"."size_bytes" is null or "report_files"."size_bytes" > 0),
	CONSTRAINT "report_files_attempts" CHECK ("report_files"."attempts" >= 0),
	CONSTRAINT "report_files_sha256" CHECK ("report_files"."sha256" is null or "report_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "report_files_error_length" CHECK ("report_files"."error" is null or char_length("report_files"."error") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "journal_book_prints" ADD CONSTRAINT "journal_book_prints_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_book_prints" ADD CONSTRAINT "journal_book_prints_report_file_fk" FOREIGN KEY ("company_id","report_file_id") REFERENCES "public"."report_files"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_book_prints" ADD CONSTRAINT "journal_book_prints_from_period_fk" FOREIGN KEY ("company_id","from_period_id") REFERENCES "public"."periods"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_book_prints" ADD CONSTRAINT "journal_book_prints_to_period_fk" FOREIGN KEY ("company_id","to_period_id") REFERENCES "public"."periods"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_files" ADD CONSTRAINT "report_files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_book_prints_company_year_idx" ON "journal_book_prints" USING btree ("company_id","fiscal_year","created_at");--> statement-breakpoint
CREATE INDEX "journal_book_prints_company_from_period_idx" ON "journal_book_prints" USING btree ("company_id","from_period_id");--> statement-breakpoint
CREATE INDEX "journal_book_prints_company_to_period_idx" ON "journal_book_prints" USING btree ("company_id","to_period_id");--> statement-breakpoint
CREATE INDEX "report_files_company_requester_idx" ON "report_files" USING btree ("company_id","requested_by_user_id","created_at");--> statement-breakpoint
CREATE INDEX "report_files_company_state_idx" ON "report_files" USING btree ("company_id","state","created_at");