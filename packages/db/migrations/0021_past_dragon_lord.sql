CREATE TABLE "open_item_balances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"open_minor" bigint NOT NULL,
	"book_minor" bigint NOT NULL,
	"parallel_minor" bigint,
	"movement_count" integer NOT NULL,
	"last_movement_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "open_item_balances_item_key" UNIQUE("company_id","item_id"),
	CONSTRAINT "open_item_balances_id_is_uuidv7" CHECK ((uuid_extract_version("open_item_balances"."id") = 7) is true),
	CONSTRAINT "open_item_balances_movement_count" CHECK ("open_item_balances"."movement_count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "open_item_due_dates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"effective_on" date NOT NULL,
	"set_by" text NOT NULL,
	"user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "open_item_due_dates_id_is_uuidv7" CHECK ((uuid_extract_version("open_item_due_dates"."id") = 7) is true),
	CONSTRAINT "open_item_due_dates_set_by" CHECK ("open_item_due_dates"."set_by" in ('opening', 'user', 'hub_event')),
	CONSTRAINT "open_item_due_dates_user" CHECK (("open_item_due_dates"."set_by" = 'user') = ("open_item_due_dates"."user_id" is not null)
        and ("open_item_due_dates"."set_by" <> 'user' or "open_item_due_dates"."reason" is not null)),
	CONSTRAINT "open_item_due_dates_reason_length" CHECK ("open_item_due_dates"."reason" is null or char_length("open_item_due_dates"."reason") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "open_item_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"kind" text NOT NULL,
	"adjusted" boolean NOT NULL,
	"amount_minor" bigint NOT NULL,
	"book_minor" bigint NOT NULL,
	"parallel_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "open_item_movements_line_key" UNIQUE("company_id","line_id"),
	CONSTRAINT "open_item_movements_id_is_uuidv7" CHECK ((uuid_extract_version("open_item_movements"."id") = 7) is true),
	CONSTRAINT "open_item_movements_kind" CHECK ("open_item_movements"."kind" in ('open', 'add', 'clear', 'difference'))
);
--> statement-breakpoint
CREATE TABLE "open_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"source" text NOT NULL,
	"hub_document" jsonb,
	"dimension_set_id" uuid NOT NULL,
	"client_value_id" uuid,
	"currency" text NOT NULL,
	"document_date" date NOT NULL,
	"opened_by_entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "open_items_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "open_items_id_is_uuidv7" CHECK ((uuid_extract_version("open_items"."id") = 7) is true),
	CONSTRAINT "open_items_kind" CHECK ("open_items"."kind" in ('document', 'running')),
	CONSTRAINT "open_items_source" CHECK ("open_items"."source" in ('manual', 'hub_event', 'opening')),
	CONSTRAINT "open_items_reference_length" CHECK (char_length("open_items"."reference") between 1 and 100),
	CONSTRAINT "open_items_currency" CHECK ("open_items"."currency" in ('USD', 'SYP', 'TRY', 'EUR')),
	CONSTRAINT "open_items_running_client" CHECK ("open_items"."kind" = 'document' or "open_items"."client_value_id" is not null),
	CONSTRAINT "open_items_hub_document" CHECK ("open_items"."hub_document" is null
        or ("open_items"."source" in ('hub_event', 'opening') and jsonb_typeof("open_items"."hub_document") = 'object'))
);
--> statement-breakpoint
ALTER TABLE "open_item_balances" ADD CONSTRAINT "open_item_balances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_item_balances" ADD CONSTRAINT "open_item_balances_item_fk" FOREIGN KEY ("company_id","item_id") REFERENCES "public"."open_items"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_item_due_dates" ADD CONSTRAINT "open_item_due_dates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_item_due_dates" ADD CONSTRAINT "open_item_due_dates_item_fk" FOREIGN KEY ("company_id","item_id") REFERENCES "public"."open_items"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_item_movements" ADD CONSTRAINT "open_item_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_item_movements" ADD CONSTRAINT "open_item_movements_item_fk" FOREIGN KEY ("company_id","item_id") REFERENCES "public"."open_items"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_item_movements" ADD CONSTRAINT "open_item_movements_line_fk" FOREIGN KEY ("company_id","line_id") REFERENCES "public"."journal_lines"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_item_movements" ADD CONSTRAINT "open_item_movements_entry_fk" FOREIGN KEY ("company_id","entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_items" ADD CONSTRAINT "open_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_items" ADD CONSTRAINT "open_items_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."chart_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_items" ADD CONSTRAINT "open_items_dimension_set_fk" FOREIGN KEY ("company_id","dimension_set_id") REFERENCES "public"."dimension_sets"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_items" ADD CONSTRAINT "open_items_client_fk" FOREIGN KEY ("company_id","client_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_items" ADD CONSTRAINT "open_items_opened_by_entry_fk" FOREIGN KEY ("company_id","opened_by_entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "open_item_due_dates_company_item_idx" ON "open_item_due_dates" USING btree ("company_id","item_id","effective_on","created_at");--> statement-breakpoint
CREATE INDEX "open_item_movements_company_item_idx" ON "open_item_movements" USING btree ("company_id","item_id","entry_date");--> statement-breakpoint
CREATE INDEX "open_item_movements_company_entry_idx" ON "open_item_movements" USING btree ("company_id","entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "open_items_document_reference_key" ON "open_items" USING btree ("company_id","account_id","reference") WHERE "open_items"."kind" = 'document';--> statement-breakpoint
CREATE UNIQUE INDEX "open_items_running_key" ON "open_items" USING btree ("company_id","account_id","client_value_id","currency") WHERE "open_items"."kind" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "open_items_hub_document_key" ON "open_items" USING btree ("company_id","account_id",("hub_document" ->> 'type'),("hub_document" ->> 'id')) WHERE "open_items"."hub_document" is not null;--> statement-breakpoint
CREATE INDEX "open_items_company_account_idx" ON "open_items" USING btree ("company_id","account_id","client_value_id");--> statement-breakpoint
CREATE INDEX "open_items_company_dimension_set_idx" ON "open_items" USING btree ("company_id","dimension_set_id");--> statement-breakpoint
CREATE INDEX "open_items_company_client_idx" ON "open_items" USING btree ("company_id","client_value_id");--> statement-breakpoint
CREATE INDEX "open_items_company_opened_by_entry_idx" ON "open_items" USING btree ("company_id","opened_by_entry_id");--> statement-breakpoint
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_item_kind" CHECK (("chart_accounts"."is_control" = ("chart_accounts"."item_kind" is not null))
        and ("chart_accounts"."item_kind" is null or "chart_accounts"."item_kind" in ('document', 'running')));