CREATE TYPE "public"."voucher_kind" AS ENUM('receipt', 'payment', 'transfer', 'count');--> statement-breakpoint
CREATE TABLE "cash_vouchers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "voucher_kind" NOT NULL,
	"fiscal_year" smallint NOT NULL,
	"number" integer NOT NULL,
	"voucher_date" date NOT NULL,
	"entry_id" uuid,
	"draft_id" uuid NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"counter_cash_account_id" uuid,
	"party_name" text,
	"counted_minor" bigint,
	"expected_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_vouchers_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "cash_vouchers_number_key" UNIQUE("company_id","kind","fiscal_year","number"),
	CONSTRAINT "cash_vouchers_entry_key" UNIQUE("company_id","entry_id"),
	CONSTRAINT "cash_vouchers_draft_key" UNIQUE("company_id","draft_id"),
	CONSTRAINT "cash_vouchers_id_is_uuidv7" CHECK ((uuid_extract_version("cash_vouchers"."id") = 7) is true),
	CONSTRAINT "cash_vouchers_fiscal_year" CHECK ("cash_vouchers"."fiscal_year" between 2000 and 9999),
	CONSTRAINT "cash_vouchers_number" CHECK ("cash_vouchers"."number" >= 1),
	CONSTRAINT "cash_vouchers_transfer" CHECK (("cash_vouchers"."counter_cash_account_id" is not null) = ("cash_vouchers"."kind" = 'transfer')
        and ("cash_vouchers"."counter_cash_account_id" is null or "cash_vouchers"."counter_cash_account_id" <> "cash_vouchers"."cash_account_id")),
	CONSTRAINT "cash_vouchers_count" CHECK (("cash_vouchers"."counted_minor" is not null) = ("cash_vouchers"."kind" = 'count')
        and ("cash_vouchers"."expected_minor" is not null) = ("cash_vouchers"."kind" = 'count')
        and ("cash_vouchers"."counted_minor" is null or "cash_vouchers"."counted_minor" >= 0)
        and ("cash_vouchers"."expected_minor" is null or "cash_vouchers"."expected_minor" >= 0)),
	CONSTRAINT "cash_vouchers_entry" CHECK (("cash_vouchers"."entry_id" is null) = ("cash_vouchers"."kind" = 'count' and "cash_vouchers"."counted_minor" = "cash_vouchers"."expected_minor")),
	CONSTRAINT "cash_vouchers_party_name" CHECK ("cash_vouchers"."party_name" is null or char_length("cash_vouchers"."party_name") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "voucher_sequences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "voucher_kind" NOT NULL,
	"fiscal_year" smallint NOT NULL,
	"last_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voucher_sequences_key" UNIQUE("company_id","kind","fiscal_year"),
	CONSTRAINT "voucher_sequences_id_is_uuidv7" CHECK ((uuid_extract_version("voucher_sequences"."id") = 7) is true),
	CONSTRAINT "voucher_sequences_fiscal_year" CHECK ("voucher_sequences"."fiscal_year" between 2000 and 9999),
	CONSTRAINT "voucher_sequences_last_number" CHECK ("voucher_sequences"."last_number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "entry_drafts" DROP CONSTRAINT "entry_drafts_posted";--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD COLUMN "voucher_kind" "voucher_kind";--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD COLUMN "cash_account_id" uuid;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD COLUMN "counter_cash_account_id" uuid;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD COLUMN "party_name" text;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD COLUMN "counted_minor" bigint;--> statement-breakpoint
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_entry_fk" FOREIGN KEY ("company_id","entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_draft_fk" FOREIGN KEY ("company_id","draft_id") REFERENCES "public"."entry_drafts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_cash_account_fk" FOREIGN KEY ("company_id","cash_account_id") REFERENCES "public"."chart_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_counter_cash_account_fk" FOREIGN KEY ("company_id","counter_cash_account_id") REFERENCES "public"."chart_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_sequences" ADD CONSTRAINT "voucher_sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_vouchers_company_cash_account_idx" ON "cash_vouchers" USING btree ("company_id","cash_account_id","voucher_date");--> statement-breakpoint
CREATE INDEX "cash_vouchers_company_counter_cash_account_idx" ON "cash_vouchers" USING btree ("company_id","counter_cash_account_id");--> statement-breakpoint
CREATE INDEX "cash_vouchers_company_date_idx" ON "cash_vouchers" USING btree ("company_id","voucher_date","id");--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD CONSTRAINT "entry_drafts_cash_account_fk" FOREIGN KEY ("company_id","cash_account_id") REFERENCES "public"."chart_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD CONSTRAINT "entry_drafts_counter_cash_account_fk" FOREIGN KEY ("company_id","counter_cash_account_id") REFERENCES "public"."chart_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_drafts_company_cash_account_idx" ON "entry_drafts" USING btree ("company_id","cash_account_id");--> statement-breakpoint
CREATE INDEX "entry_drafts_company_counter_cash_account_idx" ON "entry_drafts" USING btree ("company_id","counter_cash_account_id");--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD CONSTRAINT "entry_drafts_posted_entry" CHECK (("entry_drafts"."posted_entry_id" is null or "entry_drafts"."state" = 'posted')
        and ("entry_drafts"."state" <> 'posted' or "entry_drafts"."posted_entry_id" is not null or "entry_drafts"."voucher_kind" = 'count'));--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD CONSTRAINT "entry_drafts_voucher" CHECK (("entry_drafts"."voucher_kind" is null) = ("entry_drafts"."cash_account_id" is null)
        and ("entry_drafts"."voucher_kind" is null or "entry_drafts"."reverses_entry_id" is null)
        and ("entry_drafts"."counter_cash_account_id" is not null) = ("entry_drafts"."voucher_kind" is not distinct from 'transfer')
        and ("entry_drafts"."counter_cash_account_id" is null or "entry_drafts"."counter_cash_account_id" <> "entry_drafts"."cash_account_id")
        and ("entry_drafts"."counted_minor" is null or ("entry_drafts"."voucher_kind" = 'count' and "entry_drafts"."counted_minor" >= 0))
        and ("entry_drafts"."party_name" is null or ("entry_drafts"."voucher_kind" is not null
          and char_length("entry_drafts"."party_name") between 1 and 200)));