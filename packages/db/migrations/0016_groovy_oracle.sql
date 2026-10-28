CREATE TABLE "chain_anchors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"anchored_on" date NOT NULL,
	"entry_count" bigint NOT NULL,
	"head_entry_id" uuid NOT NULL,
	"head_hash" text NOT NULL,
	"email_outbox_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_anchors_day_key" UNIQUE("company_id","anchored_on"),
	CONSTRAINT "chain_anchors_id_is_uuidv7" CHECK ((uuid_extract_version("chain_anchors"."id") = 7) is true),
	CONSTRAINT "chain_anchors_entry_count" CHECK ("chain_anchors"."entry_count" >= 1),
	CONSTRAINT "chain_anchors_head_hash" CHECK ("chain_anchors"."head_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "company_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"storage_key" text,
	"size_bytes" bigint,
	"sha256" text,
	"error" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_exports_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "company_exports_id_is_uuidv7" CHECK ((uuid_extract_version("company_exports"."id") = 7) is true),
	CONSTRAINT "company_exports_state" CHECK ("company_exports"."state" in ('queued', 'ready', 'failed', 'expired')),
	CONSTRAINT "company_exports_ready_fields" CHECK (("company_exports"."state" in ('ready', 'expired')) = ("company_exports"."storage_key" is not null)
        and ("company_exports"."storage_key" is null) = ("company_exports"."size_bytes" is null)
        and ("company_exports"."storage_key" is null) = ("company_exports"."sha256" is null)
        and ("company_exports"."storage_key" is null) = ("company_exports"."expires_at" is null)
        and ("company_exports"."state" = 'failed') = ("company_exports"."error" is not null)),
	CONSTRAINT "company_exports_storage_key" CHECK ("company_exports"."storage_key" is null or "company_exports"."storage_key" = "company_exports"."company_id"::text || '/' || "company_exports"."id"::text),
	CONSTRAINT "company_exports_size" CHECK ("company_exports"."size_bytes" is null or "company_exports"."size_bytes" > 0),
	CONSTRAINT "company_exports_sha256" CHECK ("company_exports"."sha256" is null or "company_exports"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "company_exports_error_length" CHECK ("company_exports"."error" is null or char_length("company_exports"."error") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_kind";--> statement-breakpoint
ALTER TABLE "chain_anchors" ADD CONSTRAINT "chain_anchors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_anchors" ADD CONSTRAINT "chain_anchors_head_entry_fk" FOREIGN KEY ("company_id","head_entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_exports" ADD CONSTRAINT "company_exports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chain_anchors_company_head_entry_idx" ON "chain_anchors" USING btree ("company_id","head_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_exports_one_queued_key" ON "company_exports" USING btree ("company_id") WHERE "company_exports"."state" = 'queued';--> statement-breakpoint
CREATE INDEX "company_exports_company_created_idx" ON "company_exports" USING btree ("company_id","created_at");--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_kind" CHECK ("email_outbox"."kind" in ('invitation', 'password_reset', 'two_factor_reset', 'daily_anchor', 'export_ready'));
