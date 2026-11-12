ALTER TYPE "public"."account_role" ADD VALUE 'pre_opening_result';--> statement-breakpoint
CREATE TABLE "opening_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"opening_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"line_no" smallint NOT NULL,
	"account_id" uuid NOT NULL,
	"dimension_value_ids" uuid[] DEFAULT '{}' NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"book_minor" bigint,
	"parallel_minor" bigint,
	"item_reference" text,
	"item_due_on" date,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_lines_line_no_key" UNIQUE("company_id","opening_id","version","line_no"),
	CONSTRAINT "opening_lines_id_is_uuidv7" CHECK ((uuid_extract_version("opening_lines"."id") = 7) is true),
	CONSTRAINT "opening_lines_line_no" CHECK ("opening_lines"."line_no" >= 1),
	CONSTRAINT "opening_lines_currency" CHECK ("opening_lines"."currency" in ('USD', 'SYP', 'TRY', 'EUR')),
	CONSTRAINT "opening_lines_amount" CHECK ("opening_lines"."amount_minor" <> 0),
	CONSTRAINT "opening_lines_item" CHECK (("opening_lines"."item_reference" is null or char_length("opening_lines"."item_reference") between 1 and 100)
        and ("opening_lines"."item_due_on" is null or "opening_lines"."item_reference" is not null)),
	CONSTRAINT "opening_lines_memo_length" CHECK ("opening_lines"."memo" is null or char_length("opening_lines"."memo") between 1 and 300),
	CONSTRAINT "opening_lines_dimension_values" CHECK (cardinality("opening_lines"."dimension_value_ids") <= 20
        and array_position("opening_lines"."dimension_value_ids", null) is null)
);
--> statement-breakpoint
CREATE TABLE "opening_record_figures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"opening_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"slot" text NOT NULL,
	"client_value_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_record_figures_key" UNIQUE("company_id","opening_id","version","slot","client_value_id","currency"),
	CONSTRAINT "opening_record_figures_id_is_uuidv7" CHECK ((uuid_extract_version("opening_record_figures"."id") = 7) is true),
	CONSTRAINT "opening_record_figures_slot" CHECK ("opening_record_figures"."slot" in ('receivable', 'ad_funds')),
	CONSTRAINT "opening_record_figures_currency" CHECK ("opening_record_figures"."currency" in ('USD', 'SYP', 'TRY', 'EUR'))
);
--> statement-breakpoint
CREATE TABLE "opening_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"api_client_id" uuid NOT NULL,
	"snapshot_key" text NOT NULL,
	"as_of" date NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"invoice_count" integer NOT NULL,
	"wallet_count" integer NOT NULL,
	"milestone_count" integer NOT NULL,
	"prior_document_count" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_snapshots_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "opening_snapshots_key" UNIQUE("company_id","api_client_id","snapshot_key"),
	CONSTRAINT "opening_snapshots_id_is_uuidv7" CHECK ((uuid_extract_version("opening_snapshots"."id") = 7) is true),
	CONSTRAINT "opening_snapshots_key_length" CHECK (char_length("opening_snapshots"."snapshot_key") between 1 and 100),
	CONSTRAINT "opening_snapshots_payload_hash" CHECK ("opening_snapshots"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "opening_snapshots_payload" CHECK (jsonb_typeof("opening_snapshots"."payload") = 'object'),
	CONSTRAINT "opening_snapshots_counts" CHECK ("opening_snapshots"."invoice_count" >= 0 and "opening_snapshots"."wallet_count" >= 0 and "opening_snapshots"."milestone_count" >= 0
        and "opening_snapshots"."prior_document_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "openings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"snapshot_id" uuid,
	"entry_id" uuid,
	"reversal_entry_id" uuid,
	"prepared_by_user_id" uuid NOT NULL,
	"posted_by_user_id" uuid,
	"posted_at" timestamp with time zone,
	"reversed_by_user_id" uuid,
	"reversed_at" timestamp with time zone,
	"reverse_reason" text,
	"fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "openings_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "openings_entry_key" UNIQUE("company_id","entry_id"),
	CONSTRAINT "openings_reversal_entry_key" UNIQUE("company_id","reversal_entry_id"),
	CONSTRAINT "openings_id_is_uuidv7" CHECK ((uuid_extract_version("openings"."id") = 7) is true),
	CONSTRAINT "openings_state" CHECK ("openings"."state" in ('draft', 'posted', 'reversed')),
	CONSTRAINT "openings_version" CHECK ("openings"."version" >= 1),
	CONSTRAINT "openings_posted_fields" CHECK (("openings"."state" = 'draft') = ("openings"."entry_id" is null)
        and ("openings"."entry_id" is null) = ("openings"."posted_by_user_id" is null)
        and ("openings"."entry_id" is null) = ("openings"."posted_at" is null)
        and ("openings"."entry_id" is null) = ("openings"."fingerprint" is null)
        and ("openings"."entry_id" is not null or "openings"."snapshot_id" is null)),
	CONSTRAINT "openings_reversed_fields" CHECK (("openings"."state" = 'reversed') = ("openings"."reversal_entry_id" is not null)
        and ("openings"."reversal_entry_id" is null) = ("openings"."reversed_by_user_id" is null)
        and ("openings"."reversal_entry_id" is null) = ("openings"."reversed_at" is null)
        and ("openings"."reversal_entry_id" is null) = ("openings"."reverse_reason" is null)
        and ("openings"."reverse_reason" is null or char_length("openings"."reverse_reason") between 1 and 500)),
	CONSTRAINT "openings_fingerprint" CHECK ("openings"."fingerprint" is null or "openings"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "journal_lines" DROP CONSTRAINT "journal_lines_kind";--> statement-breakpoint
ALTER TABLE "recognition_movements" DROP CONSTRAINT "recognition_movements_kind";--> statement-breakpoint
ALTER TABLE "recognition_movements" DROP CONSTRAINT "recognition_movements_credit";--> statement-breakpoint
ALTER TABLE "recognition_schedules" ALTER COLUMN "event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "books_start" date;--> statement-breakpoint
ALTER TABLE "recognition_schedules" ADD COLUMN "opening_id" uuid;--> statement-breakpoint
ALTER TABLE "opening_lines" ADD CONSTRAINT "opening_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_lines" ADD CONSTRAINT "opening_lines_opening_fk" FOREIGN KEY ("company_id","opening_id") REFERENCES "public"."openings"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_lines" ADD CONSTRAINT "opening_lines_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."chart_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_record_figures" ADD CONSTRAINT "opening_record_figures_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_record_figures" ADD CONSTRAINT "opening_record_figures_opening_fk" FOREIGN KEY ("company_id","opening_id") REFERENCES "public"."openings"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_record_figures" ADD CONSTRAINT "opening_record_figures_client_fk" FOREIGN KEY ("company_id","client_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_snapshots" ADD CONSTRAINT "opening_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openings" ADD CONSTRAINT "openings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openings" ADD CONSTRAINT "openings_snapshot_fk" FOREIGN KEY ("company_id","snapshot_id") REFERENCES "public"."opening_snapshots"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openings" ADD CONSTRAINT "openings_entry_fk" FOREIGN KEY ("company_id","entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openings" ADD CONSTRAINT "openings_reversal_entry_fk" FOREIGN KEY ("company_id","reversal_entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opening_lines_company_account_idx" ON "opening_lines" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE INDEX "opening_record_figures_company_client_idx" ON "opening_record_figures" USING btree ("company_id","client_value_id");--> statement-breakpoint
CREATE INDEX "opening_snapshots_company_received_idx" ON "opening_snapshots" USING btree ("company_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "openings_live_key" ON "openings" USING btree ("company_id") WHERE "openings"."state" <> 'reversed';--> statement-breakpoint
CREATE INDEX "openings_company_snapshot_idx" ON "openings" USING btree ("company_id","snapshot_id");--> statement-breakpoint
ALTER TABLE "recognition_schedules" ADD CONSTRAINT "recognition_schedules_opening_fk" FOREIGN KEY ("company_id","opening_id") REFERENCES "public"."openings"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_schedules" ADD CONSTRAINT "recognition_schedules_opening_line_key" UNIQUE("company_id","opening_id","line_id");--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_books_start" CHECK ("company_settings"."books_start" is null
        or (extract(day from "company_settings"."books_start") = 1 and "company_settings"."books_start" >= date '2026-01-01'));--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_kind" CHECK ("journal_lines"."kind" in ('measured', 'carried', 'difference', 'rounding', 'stated'));--> statement-breakpoint
ALTER TABLE "recognition_movements" ADD CONSTRAINT "recognition_movements_kind" CHECK ("recognition_movements"."kind" in ('deferred', 'elapsed', 'released', 'credited', 'reclassified', 'reversed', 'remainder_released', 'remainder_refunded', 'adjusted', 'before_opening'));--> statement-breakpoint
ALTER TABLE "recognition_movements" ADD CONSTRAINT "recognition_movements_credit" CHECK (("recognition_movements"."kind" = 'credited' and "recognition_movements"."credit_minor" is not null and "recognition_movements"."credit_minor" <> 0)
        or ("recognition_movements"."kind" = 'before_opening' and ("recognition_movements"."credit_minor" is null or "recognition_movements"."credit_minor" > 0))
        or ("recognition_movements"."kind" not in ('credited', 'before_opening') and "recognition_movements"."credit_minor" is null));--> statement-breakpoint
ALTER TABLE "recognition_schedules" ADD CONSTRAINT "recognition_schedules_one_source" CHECK (("recognition_schedules"."event_id" is null) <> ("recognition_schedules"."opening_id" is null));