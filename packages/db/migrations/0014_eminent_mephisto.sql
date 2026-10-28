CREATE TABLE "entry_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"draft_id" uuid,
	"entry_id" uuid,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_reason" text,
	CONSTRAINT "entry_attachments_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "entry_attachments_id_is_uuidv7" CHECK ((uuid_extract_version("entry_attachments"."id") = 7) is true),
	CONSTRAINT "entry_attachments_owner" CHECK ("entry_attachments"."draft_id" is not null or "entry_attachments"."entry_id" is not null),
	CONSTRAINT "entry_attachments_type" CHECK ("entry_attachments"."content_type" in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "entry_attachments_size" CHECK ("entry_attachments"."size_bytes" between 1 and 10485760),
	CONSTRAINT "entry_attachments_sha256" CHECK ("entry_attachments"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "entry_attachments_storage_key" CHECK ("entry_attachments"."storage_key" = "entry_attachments"."company_id"::text || '/' || "entry_attachments"."id"::text),
	CONSTRAINT "entry_attachments_file_name" CHECK (char_length("entry_attachments"."file_name") between 1 and 255),
	CONSTRAINT "entry_attachments_archived" CHECK (("entry_attachments"."archived_at" is not null or "entry_attachments"."archived_reason" is null)
        and ("entry_attachments"."archived_reason" is null or char_length("entry_attachments"."archived_reason") between 1 and 1000))
);
--> statement-breakpoint
CREATE TABLE "entry_draft_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"account_id" uuid,
	"dimension_value_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"currency" text,
	"amount_minor" bigint,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "entry_draft_lines_line_no_key" UNIQUE("company_id","draft_id","line_no"),
	CONSTRAINT "entry_draft_lines_id_is_uuidv7" CHECK ((uuid_extract_version("entry_draft_lines"."id") = 7) is true),
	CONSTRAINT "entry_draft_lines_line_no" CHECK ("entry_draft_lines"."line_no" between 1 and 500),
	CONSTRAINT "entry_draft_lines_amount" CHECK ("entry_draft_lines"."amount_minor" is null or "entry_draft_lines"."amount_minor" <> 0),
	CONSTRAINT "entry_draft_lines_currency" CHECK ("entry_draft_lines"."currency" is null or "entry_draft_lines"."currency" in ('USD', 'SYP', 'TRY', 'EUR')),
	CONSTRAINT "entry_draft_lines_dimensions" CHECK (cardinality("entry_draft_lines"."dimension_value_ids") <= 10
        and array_position("entry_draft_lines"."dimension_value_ids", null) is null),
	CONSTRAINT "entry_draft_lines_memo_length" CHECK ("entry_draft_lines"."memo" is null or char_length("entry_draft_lines"."memo") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "entry_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"state" text NOT NULL,
	"entry_date" date NOT NULL,
	"description" text,
	"reference" text,
	"dealt_rates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reverses_entry_id" uuid,
	"copied_from_entry_id" uuid,
	"prepared_by_user_id" uuid NOT NULL,
	"submitted_by_user_id" uuid,
	"submitted_at" timestamp with time zone,
	"rejected_by_user_id" uuid,
	"rejected_reason" text,
	"rejected_at" timestamp with time zone,
	"posted_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_reason" text,
	CONSTRAINT "entry_drafts_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "entry_drafts_posted_entry_key" UNIQUE("company_id","posted_entry_id"),
	CONSTRAINT "entry_drafts_id_is_uuidv7" CHECK ((uuid_extract_version("entry_drafts"."id") = 7) is true),
	CONSTRAINT "entry_drafts_state" CHECK ("entry_drafts"."state" in ('draft', 'submitted', 'posted')),
	CONSTRAINT "entry_drafts_posted" CHECK (("entry_drafts"."posted_entry_id" is not null) = ("entry_drafts"."state" = 'posted')),
	CONSTRAINT "entry_drafts_description_length" CHECK ("entry_drafts"."description" is null or char_length("entry_drafts"."description") between 1 and 500),
	CONSTRAINT "entry_drafts_reference_length" CHECK ("entry_drafts"."reference" is null or char_length("entry_drafts"."reference") between 1 and 100),
	CONSTRAINT "entry_drafts_dealt_rates" CHECK (jsonb_typeof("entry_drafts"."dealt_rates") = 'array'),
	CONSTRAINT "entry_drafts_submitted" CHECK (("entry_drafts"."submitted_by_user_id" is null) = ("entry_drafts"."submitted_at" is null)
        and ("entry_drafts"."state" <> 'submitted' or "entry_drafts"."submitted_by_user_id" is not null)),
	CONSTRAINT "entry_drafts_rejected" CHECK (("entry_drafts"."rejected_by_user_id" is null) = ("entry_drafts"."rejected_reason" is null)
        and ("entry_drafts"."rejected_reason" is null) = ("entry_drafts"."rejected_at" is null)
        and ("entry_drafts"."rejected_reason" is null or char_length("entry_drafts"."rejected_reason") between 1 and 1000)),
	CONSTRAINT "entry_drafts_archived" CHECK (("entry_drafts"."archived_at" is null or "entry_drafts"."state" = 'draft')
        and ("entry_drafts"."archived_at" is not null or "entry_drafts"."archived_reason" is null)
        and ("entry_drafts"."archived_reason" is null or char_length("entry_drafts"."archived_reason") between 1 and 1000))
);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "manual_entry_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "entry_attachments" ADD CONSTRAINT "entry_attachments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_attachments" ADD CONSTRAINT "entry_attachments_draft_fk" FOREIGN KEY ("company_id","draft_id") REFERENCES "public"."entry_drafts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_attachments" ADD CONSTRAINT "entry_attachments_entry_fk" FOREIGN KEY ("company_id","entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_draft_lines" ADD CONSTRAINT "entry_draft_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_draft_lines" ADD CONSTRAINT "entry_draft_lines_draft_fk" FOREIGN KEY ("company_id","draft_id") REFERENCES "public"."entry_drafts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_draft_lines" ADD CONSTRAINT "entry_draft_lines_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."chart_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD CONSTRAINT "entry_drafts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD CONSTRAINT "entry_drafts_reverses_fk" FOREIGN KEY ("company_id","reverses_entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD CONSTRAINT "entry_drafts_copied_from_fk" FOREIGN KEY ("company_id","copied_from_entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD CONSTRAINT "entry_drafts_posted_entry_fk" FOREIGN KEY ("company_id","posted_entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_attachments_company_draft_idx" ON "entry_attachments" USING btree ("company_id","draft_id");--> statement-breakpoint
CREATE INDEX "entry_attachments_company_entry_idx" ON "entry_attachments" USING btree ("company_id","entry_id");--> statement-breakpoint
CREATE INDEX "entry_draft_lines_company_account_idx" ON "entry_draft_lines" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE INDEX "entry_drafts_company_state_idx" ON "entry_drafts" USING btree ("company_id","state","updated_at");--> statement-breakpoint
CREATE INDEX "entry_drafts_company_reverses_idx" ON "entry_drafts" USING btree ("company_id","reverses_entry_id");--> statement-breakpoint
CREATE INDEX "entry_drafts_company_copied_from_idx" ON "entry_drafts" USING btree ("company_id","copied_from_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_drafts_open_reversal_key" ON "entry_drafts" USING btree ("company_id","reverses_entry_id") WHERE "entry_drafts"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_draft_fk" FOREIGN KEY ("company_id","draft_id") REFERENCES "public"."entry_drafts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_draft_key" UNIQUE("company_id","draft_id");--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_approver_not_preparer" CHECK ("journal_entries"."approved_by_user_id" is null or "journal_entries"."approved_by_user_id" <> "journal_entries"."prepared_by_user_id");