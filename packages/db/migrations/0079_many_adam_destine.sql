CREATE TYPE "public"."movement_kind" AS ENUM('received', 'expense', 'wages', 'owed_by_us', 'owed_to_us', 'debt_paid', 'debt_collected', 'deposit');--> statement-breakpoint
CREATE TYPE "public"."project_state" AS ENUM('active', 'finished');--> statement-breakpoint
CREATE TABLE "company_branding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"logo_storage_key" text,
	"logo_content_type" text,
	"logo_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "company_branding_company_key" UNIQUE("company_id"),
	CONSTRAINT "company_branding_id_is_uuidv7" CHECK ((uuid_extract_version("company_branding"."id") = 7) is true),
	CONSTRAINT "company_branding_display_name" CHECK (char_length("company_branding"."display_name") between 1 and 200),
	CONSTRAINT "company_branding_logo" CHECK (("company_branding"."logo_storage_key" is null) = ("company_branding"."logo_content_type" is null)
        and ("company_branding"."logo_storage_key" is null) = ("company_branding"."logo_sha256" is null)
        and ("company_branding"."logo_content_type" is null or "company_branding"."logo_content_type" in ('image/png', 'image/jpeg'))
        and ("company_branding"."logo_sha256" is null or "company_branding"."logo_sha256" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
CREATE TABLE "project_details" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_value_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"state" "project_state" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "project_details_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "project_details_contract_key" UNIQUE("company_id","contract_value_id"),
	CONSTRAINT "project_details_id_is_uuidv7" CHECK ((uuid_extract_version("project_details"."id") = 7) is true)
);
--> statement-breakpoint
CREATE TABLE "project_movement_cancellations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"reversal_entry_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_movement_cancellations_movement_key" UNIQUE("company_id","movement_id"),
	CONSTRAINT "project_movement_cancellations_reversal_key" UNIQUE("company_id","reversal_entry_id"),
	CONSTRAINT "project_movement_cancellations_id_is_uuidv7" CHECK ((uuid_extract_version("project_movement_cancellations"."id") = 7) is true),
	CONSTRAINT "project_movement_cancellations_reason" CHECK (char_length("project_movement_cancellations"."reason") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "project_movement_sequences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"fiscal_year" smallint NOT NULL,
	"last_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_movement_sequences_key" UNIQUE("company_id","fiscal_year"),
	CONSTRAINT "project_movement_sequences_id_is_uuidv7" CHECK ((uuid_extract_version("project_movement_sequences"."id") = 7) is true),
	CONSTRAINT "project_movement_sequences_fiscal_year" CHECK ("project_movement_sequences"."fiscal_year" between 2000 and 9999),
	CONSTRAINT "project_movement_sequences_last_number" CHECK ("project_movement_sequences"."last_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "project_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "movement_kind" NOT NULL,
	"fiscal_year" smallint NOT NULL,
	"number" integer NOT NULL,
	"movement_date" date NOT NULL,
	"contract_value_id" uuid,
	"counterparty_value_id" uuid,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"description" text NOT NULL,
	"material_id" uuid,
	"entry_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_movements_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "project_movements_number_key" UNIQUE("company_id","fiscal_year","number"),
	CONSTRAINT "project_movements_entry_key" UNIQUE("company_id","entry_id"),
	CONSTRAINT "project_movements_draft_key" UNIQUE("company_id","draft_id"),
	CONSTRAINT "project_movements_request_key" UNIQUE("company_id","request_key"),
	CONSTRAINT "project_movements_id_is_uuidv7" CHECK ((uuid_extract_version("project_movements"."id") = 7) is true),
	CONSTRAINT "project_movements_fiscal_year" CHECK ("project_movements"."fiscal_year" between 2000 and 9999),
	CONSTRAINT "project_movements_number" CHECK ("project_movements"."number" >= 1),
	CONSTRAINT "project_movements_currency" CHECK ("project_movements"."currency" in ('USD', 'SYP', 'TRY', 'EUR')),
	CONSTRAINT "project_movements_amount" CHECK ("project_movements"."amount_minor" > 0),
	CONSTRAINT "project_movements_description" CHECK (char_length("project_movements"."description") between 1 and 500),
	CONSTRAINT "project_movements_request" CHECK (char_length("project_movements"."request_key") between 1 and 100 and "project_movements"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "project_movements_kind_fields" CHECK ((("project_movements"."contract_value_id" is null) = ("project_movements"."kind" = 'deposit'))
        and (("project_movements"."counterparty_value_id" is null)
          = ("project_movements"."kind" in ('expense', 'wages', 'deposit')))
        and ("project_movements"."material_id" is null or "project_movements"."kind" in ('expense', 'owed_by_us')))
);
--> statement-breakpoint
ALTER TABLE "company_branding" ADD CONSTRAINT "company_branding_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_details" ADD CONSTRAINT "project_details_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_details" ADD CONSTRAINT "project_details_contract_value_fk" FOREIGN KEY ("company_id","contract_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_movement_cancellations" ADD CONSTRAINT "project_movement_cancellations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_movement_cancellations" ADD CONSTRAINT "project_movement_cancellations_movement_fk" FOREIGN KEY ("company_id","movement_id") REFERENCES "public"."project_movements"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_movement_cancellations" ADD CONSTRAINT "project_movement_cancellations_reversal_fk" FOREIGN KEY ("company_id","reversal_entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_movement_sequences" ADD CONSTRAINT "project_movement_sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_movements" ADD CONSTRAINT "project_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_movements" ADD CONSTRAINT "project_movements_entry_fk" FOREIGN KEY ("company_id","entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_movements" ADD CONSTRAINT "project_movements_draft_fk" FOREIGN KEY ("company_id","draft_id") REFERENCES "public"."entry_drafts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_movements" ADD CONSTRAINT "project_movements_contract_value_fk" FOREIGN KEY ("company_id","contract_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_movements" ADD CONSTRAINT "project_movements_counterparty_value_fk" FOREIGN KEY ("company_id","counterparty_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_movements" ADD CONSTRAINT "project_movements_material_fk" FOREIGN KEY ("company_id","material_id") REFERENCES "public"."materials"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_movements_company_contract_idx" ON "project_movements" USING btree ("company_id","contract_value_id","movement_date");--> statement-breakpoint
CREATE INDEX "project_movements_company_counterparty_idx" ON "project_movements" USING btree ("company_id","counterparty_value_id");--> statement-breakpoint
CREATE INDEX "project_movements_company_material_idx" ON "project_movements" USING btree ("company_id","material_id");--> statement-breakpoint
CREATE INDEX "project_movements_company_date_idx" ON "project_movements" USING btree ("company_id","movement_date","id");