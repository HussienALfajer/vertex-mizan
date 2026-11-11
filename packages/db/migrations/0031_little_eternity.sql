ALTER TYPE "public"."posting_slot" ADD VALUE 'contract_liability';--> statement-breakpoint
ALTER TYPE "public"."posting_slot" ADD VALUE 'contract_asset';--> statement-breakpoint
ALTER TYPE "public"."posting_slot" ADD VALUE 'released_revenue';--> statement-breakpoint
ALTER TYPE "public"."posting_slot" ADD VALUE 'cancelled_project_refund';--> statement-breakpoint
CREATE TABLE "recognition_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"month" date,
	"entry_id" uuid NOT NULL,
	"transaction_minor" bigint NOT NULL,
	"book_minor" bigint NOT NULL,
	"parallel_minor" bigint,
	"service_value_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recognition_movements_id_is_uuidv7" CHECK ((uuid_extract_version("recognition_movements"."id") = 7) is true),
	CONSTRAINT "recognition_movements_kind" CHECK ("recognition_movements"."kind" in ('deferred', 'elapsed', 'released', 'credited', 'reclassified', 'reversed', 'remainder_released', 'remainder_refunded')),
	CONSTRAINT "recognition_movements_month" CHECK (("recognition_movements"."month" is null or extract(day from "recognition_movements"."month") = 1)
        and ("recognition_movements"."kind" not in ('elapsed') or "recognition_movements"."month" is not null)),
	CONSTRAINT "recognition_movements_service" CHECK (("recognition_movements"."kind" = 'reclassified') = ("recognition_movements"."service_value_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "recognition_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"invoice_document_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"line_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"line_source" text NOT NULL,
	"charge_kind" text,
	"service_from" date,
	"service_to" date,
	"milestone_id" uuid,
	"cycle_key" text,
	"reissue_of_schedule_id" uuid,
	"client_value_id" uuid NOT NULL,
	"contract_value_id" uuid,
	"service_value_id" uuid NOT NULL,
	"liability_account_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recognition_schedules_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "recognition_schedules_line_key" UNIQUE("company_id","event_id","line_id"),
	CONSTRAINT "recognition_schedules_id_is_uuidv7" CHECK ((uuid_extract_version("recognition_schedules"."id") = 7) is true),
	CONSTRAINT "recognition_schedules_pattern" CHECK ("recognition_schedules"."pattern" in ('over_time', 'point_in_time')),
	CONSTRAINT "recognition_schedules_line_source" CHECK ("recognition_schedules"."line_source" in ('retainer_charge', 'deposit', 'milestone', 'extra_work', 'manual')),
	CONSTRAINT "recognition_schedules_charge_kind" CHECK (("recognition_schedules"."line_source" = 'retainer_charge') = ("recognition_schedules"."charge_kind" is not null)
        and ("recognition_schedules"."charge_kind" is null or "recognition_schedules"."charge_kind" in ('monthly', 'addition'))),
	CONSTRAINT "recognition_schedules_pattern_fields" CHECK (("recognition_schedules"."pattern" = 'over_time'
          and "recognition_schedules"."service_from" is not null and "recognition_schedules"."service_to" is not null
          and "recognition_schedules"."service_to" >= "recognition_schedules"."service_from" and "recognition_schedules"."milestone_id" is null
          and "recognition_schedules"."line_source" in ('retainer_charge', 'manual'))
        or ("recognition_schedules"."pattern" = 'point_in_time'
          and "recognition_schedules"."service_from" is null and "recognition_schedules"."service_to" is null and "recognition_schedules"."milestone_id" is not null
          and "recognition_schedules"."line_source" in ('deposit', 'milestone'))),
	CONSTRAINT "recognition_schedules_cycle_key" CHECK ("recognition_schedules"."cycle_key" is null
        or ("recognition_schedules"."line_source" = 'retainer_charge' and char_length("recognition_schedules"."cycle_key") between 1 and 200)),
	CONSTRAINT "recognition_schedules_invoice_number" CHECK (char_length("recognition_schedules"."invoice_number") between 1 and 100),
	CONSTRAINT "recognition_schedules_currency" CHECK ("recognition_schedules"."currency" in ('USD', 'SYP', 'TRY', 'EUR')),
	CONSTRAINT "recognition_schedules_not_self_reissue" CHECK ("recognition_schedules"."reissue_of_schedule_id" <> "recognition_schedules"."id")
);
--> statement-breakpoint
ALTER TABLE "inbound_event_actions" DROP CONSTRAINT "inbound_event_actions_action";--> statement-breakpoint
ALTER TABLE "inbound_event_actions" DROP CONSTRAINT "inbound_event_actions_reason";--> statement-breakpoint
DROP INDEX "open_items_hub_document_key";--> statement-breakpoint
ALTER TABLE "recognition_movements" ADD CONSTRAINT "recognition_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_movements" ADD CONSTRAINT "recognition_movements_schedule_fk" FOREIGN KEY ("company_id","schedule_id") REFERENCES "public"."recognition_schedules"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_movements" ADD CONSTRAINT "recognition_movements_entry_fk" FOREIGN KEY ("company_id","entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_movements" ADD CONSTRAINT "recognition_movements_service_fk" FOREIGN KEY ("company_id","service_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_schedules" ADD CONSTRAINT "recognition_schedules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_schedules" ADD CONSTRAINT "recognition_schedules_event_fk" FOREIGN KEY ("company_id","event_id") REFERENCES "public"."inbound_events"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_schedules" ADD CONSTRAINT "recognition_schedules_reissue_fk" FOREIGN KEY ("company_id","reissue_of_schedule_id") REFERENCES "public"."recognition_schedules"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_schedules" ADD CONSTRAINT "recognition_schedules_client_fk" FOREIGN KEY ("company_id","client_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_schedules" ADD CONSTRAINT "recognition_schedules_contract_fk" FOREIGN KEY ("company_id","contract_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_schedules" ADD CONSTRAINT "recognition_schedules_service_fk" FOREIGN KEY ("company_id","service_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_schedules" ADD CONSTRAINT "recognition_schedules_liability_fk" FOREIGN KEY ("company_id","liability_account_id") REFERENCES "public"."chart_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recognition_movements_released_month_key" ON "recognition_movements" USING btree ("company_id","schedule_id","month") WHERE "recognition_movements"."kind" = 'released' and "recognition_movements"."month" is not null;--> statement-breakpoint
CREATE INDEX "recognition_movements_company_schedule_idx" ON "recognition_movements" USING btree ("company_id","schedule_id","created_at");--> statement-breakpoint
CREATE INDEX "recognition_movements_company_entry_idx" ON "recognition_movements" USING btree ("company_id","entry_id");--> statement-breakpoint
CREATE INDEX "recognition_movements_company_service_idx" ON "recognition_movements" USING btree ("company_id","service_value_id");--> statement-breakpoint
CREATE INDEX "recognition_schedules_company_cycle_idx" ON "recognition_schedules" USING btree ("company_id","cycle_key");--> statement-breakpoint
CREATE INDEX "recognition_schedules_company_milestone_idx" ON "recognition_schedules" USING btree ("company_id","milestone_id");--> statement-breakpoint
CREATE INDEX "recognition_schedules_company_contract_idx" ON "recognition_schedules" USING btree ("company_id","contract_value_id");--> statement-breakpoint
CREATE INDEX "recognition_schedules_company_invoice_idx" ON "recognition_schedules" USING btree ("company_id","invoice_document_id");--> statement-breakpoint
CREATE INDEX "recognition_schedules_company_reissue_idx" ON "recognition_schedules" USING btree ("company_id","reissue_of_schedule_id");--> statement-breakpoint
CREATE INDEX "recognition_schedules_company_client_idx" ON "recognition_schedules" USING btree ("company_id","client_value_id");--> statement-breakpoint
CREATE INDEX "recognition_schedules_company_service_idx" ON "recognition_schedules" USING btree ("company_id","service_value_id");--> statement-breakpoint
CREATE INDEX "recognition_schedules_company_liability_idx" ON "recognition_schedules" USING btree ("company_id","liability_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "open_items_hub_document_key" ON "open_items" USING btree ("company_id","account_id",("hub_document" ->> 'type'),("hub_document" ->> 'id'),"reference") WHERE "open_items"."hub_document" is not null;--> statement-breakpoint
ALTER TABLE "inbound_event_actions" ADD CONSTRAINT "inbound_event_actions_action" CHECK ("inbound_event_actions"."action" in ('received', 'replayed', 'attempted', 'held', 'posted', 'recorded', 'retried', 'moved_to_open_period', 'resolved', 'dismissed', 'recognised_in_open_period', 'remainder_split'));--> statement-breakpoint
ALTER TABLE "inbound_event_actions" ADD CONSTRAINT "inbound_event_actions_reason" CHECK (("inbound_event_actions"."reason" is null or char_length("inbound_event_actions"."reason") between 1 and 500)
        and ("inbound_event_actions"."action" not in ('moved_to_open_period', 'resolved', 'dismissed', 'recognised_in_open_period', 'remainder_split') or "inbound_event_actions"."reason" is not null));