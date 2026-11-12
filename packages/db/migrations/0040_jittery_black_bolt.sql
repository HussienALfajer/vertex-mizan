CREATE TABLE "period_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"user_id" uuid NOT NULL,
	"checklist" jsonb,
	"head_sequence" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_events_id_is_uuidv7" CHECK ((uuid_extract_version("period_events"."id") = 7) is true),
	CONSTRAINT "period_events_kind" CHECK ("period_events"."kind" in ('closed', 'reopened')),
	CONSTRAINT "period_events_reason" CHECK (char_length("period_events"."reason") between 1 and 500),
	CONSTRAINT "period_events_checklist" CHECK (("period_events"."kind" = 'closed') = ("period_events"."checklist" is not null)
        and ("period_events"."checklist" is null or jsonb_typeof("period_events"."checklist") = 'array')),
	CONSTRAINT "period_events_head_sequence" CHECK ("period_events"."head_sequence" >= 0)
);
--> statement-breakpoint
ALTER TABLE "periods" DROP CONSTRAINT "periods_state";--> statement-breakpoint
ALTER TABLE "period_events" ADD CONSTRAINT "period_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_events" ADD CONSTRAINT "period_events_period_fk" FOREIGN KEY ("company_id","period_id") REFERENCES "public"."periods"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "period_events_company_period_idx" ON "period_events" USING btree ("company_id","period_id","created_at");--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_state" CHECK ("periods"."state" in ('open', 'closed', 'reopened'));