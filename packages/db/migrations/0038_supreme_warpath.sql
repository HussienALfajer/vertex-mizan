CREATE TABLE "revaluations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"ledger" text NOT NULL,
	"entry_id" uuid NOT NULL,
	"reversal_entry_id" uuid NOT NULL,
	"adjusting" boolean NOT NULL,
	"fingerprint" text NOT NULL,
	"rates" jsonb NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revaluations_entry_key" UNIQUE("company_id","entry_id"),
	CONSTRAINT "revaluations_reversal_entry_key" UNIQUE("company_id","reversal_entry_id"),
	CONSTRAINT "revaluations_fingerprint_key" UNIQUE("company_id","period_id","ledger","fingerprint"),
	CONSTRAINT "revaluations_id_is_uuidv7" CHECK ((uuid_extract_version("revaluations"."id") = 7) is true),
	CONSTRAINT "revaluations_ledger" CHECK ("revaluations"."ledger" in ('book', 'parallel')),
	CONSTRAINT "revaluations_fingerprint" CHECK ("revaluations"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "revaluations_rates" CHECK (jsonb_typeof("revaluations"."rates") = 'array')
);
--> statement-breakpoint
ALTER TABLE "open_item_movements" DROP CONSTRAINT "open_item_movements_kind";--> statement-breakpoint
ALTER TABLE "open_item_balances" ADD COLUMN "revaluation_book_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "open_item_balances" ADD COLUMN "revaluation_parallel_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "revaluations" ADD CONSTRAINT "revaluations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revaluations" ADD CONSTRAINT "revaluations_period_fk" FOREIGN KEY ("company_id","period_id") REFERENCES "public"."periods"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revaluations" ADD CONSTRAINT "revaluations_entry_fk" FOREIGN KEY ("company_id","entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revaluations" ADD CONSTRAINT "revaluations_reversal_entry_fk" FOREIGN KEY ("company_id","reversal_entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "revaluations_company_period_idx" ON "revaluations" USING btree ("company_id","period_id","ledger");--> statement-breakpoint
ALTER TABLE "open_item_movements" ADD CONSTRAINT "open_item_movements_kind" CHECK ("open_item_movements"."kind" in ('open', 'add', 'clear', 'difference', 'revaluation'));