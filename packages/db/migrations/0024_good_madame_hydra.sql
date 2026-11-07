CREATE TYPE "public"."posting_slot" AS ENUM('receivable', 'revenue_at_issue', 'termination_fee_revenue', 'payment_method.cash', 'payment_method.bank_transfer', 'payment_method.e_wallet', 'ad_funds', 'ad_platforms_payable', 'project_cost', 'project_expense_awaiting_payment');--> statement-breakpoint
CREATE TABLE "inbound_event_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"action" text NOT NULL,
	"hold_reason" text,
	"hold_detail" text,
	"entry_ids" uuid[] DEFAULT '{}' NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"actor_api_client_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_event_actions_id_is_uuidv7" CHECK ((uuid_extract_version("inbound_event_actions"."id") = 7) is true),
	CONSTRAINT "inbound_event_actions_action" CHECK ("inbound_event_actions"."action" in ('received', 'replayed', 'attempted', 'held', 'posted', 'recorded', 'retried', 'moved_to_open_period', 'resolved', 'dismissed')),
	CONSTRAINT "inbound_event_actions_hold" CHECK (("inbound_event_actions"."hold_reason" is null or "inbound_event_actions"."hold_reason" in ('PERIOD_CLOSED', 'SERVICE_PERIOD_CLOSED', 'UNKNOWN_REFERENCE', 'NO_MAPPING', 'RATE_MISSING', 'NEEDS_DECISION', 'OPEN_ITEM_HAS_SETTLEMENTS', 'WAITING_FOR_EARLIER_EVENT'))
        and ("inbound_event_actions"."hold_detail" is null or "inbound_event_actions"."hold_reason" is not null)),
	CONSTRAINT "inbound_event_actions_actor" CHECK (("inbound_event_actions"."actor_kind" = 'person' and "inbound_event_actions"."actor_user_id" is not null and "inbound_event_actions"."actor_api_client_id" is null)
        or ("inbound_event_actions"."actor_kind" = 'api_client' and "inbound_event_actions"."actor_api_client_id" is not null and "inbound_event_actions"."actor_user_id" is null)
        or ("inbound_event_actions"."actor_kind" = 'system' and "inbound_event_actions"."actor_user_id" is null and "inbound_event_actions"."actor_api_client_id" is null)),
	CONSTRAINT "inbound_event_actions_reason" CHECK (("inbound_event_actions"."reason" is null or char_length("inbound_event_actions"."reason") between 1 and 500)
        and ("inbound_event_actions"."action" not in ('moved_to_open_period', 'resolved', 'dismissed') or "inbound_event_actions"."reason" is not null)),
	CONSTRAINT "inbound_event_actions_entries" CHECK (array_position("inbound_event_actions"."entry_ids", null) is null)
);
--> statement-breakpoint
CREATE TABLE "inbound_event_states" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"state" text NOT NULL,
	"hold_reason" text,
	"hold_detail" text,
	"waiting_for_event_id" uuid,
	"posted_on" date,
	"resolved_by_entry_id" uuid,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_event_states_event_key" UNIQUE("company_id","event_id"),
	CONSTRAINT "inbound_event_states_id_is_uuidv7" CHECK ((uuid_extract_version("inbound_event_states"."id") = 7) is true),
	CONSTRAINT "inbound_event_states_state" CHECK ("inbound_event_states"."state" in ('held', 'posted', 'recorded', 'resolved', 'dismissed')),
	CONSTRAINT "inbound_event_states_hold" CHECK (("inbound_event_states"."state" = 'held') = ("inbound_event_states"."hold_reason" is not null)
        and ("inbound_event_states"."hold_reason" is null or "inbound_event_states"."hold_reason" in ('PERIOD_CLOSED', 'SERVICE_PERIOD_CLOSED', 'UNKNOWN_REFERENCE', 'NO_MAPPING', 'RATE_MISSING', 'NEEDS_DECISION', 'OPEN_ITEM_HAS_SETTLEMENTS', 'WAITING_FOR_EARLIER_EVENT'))
        and ("inbound_event_states"."hold_detail" is null or ("inbound_event_states"."hold_reason" is not null
          and "inbound_event_states"."hold_detail" ~ '^[a-z][a-z0-9_]*(:[A-Za-z0-9_.-]{1,60})?$'))
        and ("inbound_event_states"."hold_reason" = 'WAITING_FOR_EARLIER_EVENT') = ("inbound_event_states"."waiting_for_event_id" is not null)
        and ("inbound_event_states"."waiting_for_event_id" is null or "inbound_event_states"."waiting_for_event_id" <> "inbound_event_states"."event_id")),
	CONSTRAINT "inbound_event_states_outcome" CHECK (("inbound_event_states"."state" = 'resolved') = ("inbound_event_states"."resolved_by_entry_id" is not null)
        and ("inbound_event_states"."posted_on" is null or "inbound_event_states"."state" = 'posted')),
	CONSTRAINT "inbound_event_states_attempts" CHECK ("inbound_event_states"."attempts" >= 1)
);
--> statement-breakpoint
CREATE TABLE "inbound_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"api_client_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"type" text NOT NULL,
	"version" smallint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"accounting_date" date NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"document_type" text NOT NULL,
	"document_id" text NOT NULL,
	"document_number" text,
	"item_key" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_events_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "inbound_events_event_key" UNIQUE("company_id","api_client_id","event_id"),
	CONSTRAINT "inbound_events_id_is_uuidv7" CHECK ((uuid_extract_version("inbound_events"."id") = 7) is true),
	CONSTRAINT "inbound_events_version" CHECK ("inbound_events"."version" >= 1),
	CONSTRAINT "inbound_events_type" CHECK ("inbound_events"."type" ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
	CONSTRAINT "inbound_events_payload_hash" CHECK ("inbound_events"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "inbound_events_payload" CHECK (jsonb_typeof("inbound_events"."payload") = 'object'),
	CONSTRAINT "inbound_events_document" CHECK (char_length("inbound_events"."document_type") between 1 and 40
        and char_length("inbound_events"."document_id") between 1 and 100
        and ("inbound_events"."document_number" is null or char_length("inbound_events"."document_number") between 1 and 100)
        and ("inbound_events"."item_key" is null or char_length("inbound_events"."item_key") between 1 and 200)),
	CONSTRAINT "inbound_events_request_id" CHECK (char_length("inbound_events"."request_id") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "posting_rule_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"slot" "posting_slot" NOT NULL,
	"currency" text,
	"account_id" uuid NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "posting_rule_accounts_slot_key" UNIQUE NULLS NOT DISTINCT("company_id","slot","currency"),
	CONSTRAINT "posting_rule_accounts_id_is_uuidv7" CHECK ((uuid_extract_version("posting_rule_accounts"."id") = 7) is true),
	CONSTRAINT "posting_rule_accounts_currency" CHECK (("posting_rule_accounts"."slot"::text like 'payment_method.%') = ("posting_rule_accounts"."currency" is not null)
        and ("posting_rule_accounts"."currency" is null or "posting_rule_accounts"."currency" in ('SYP', 'USD')))
);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "payment_tolerance_syp_minor" bigint DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "payment_tolerance_usd_minor" bigint DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_event_actions" ADD CONSTRAINT "inbound_event_actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_event_actions" ADD CONSTRAINT "inbound_event_actions_event_fk" FOREIGN KEY ("company_id","event_id") REFERENCES "public"."inbound_events"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_event_states" ADD CONSTRAINT "inbound_event_states_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_event_states" ADD CONSTRAINT "inbound_event_states_event_fk" FOREIGN KEY ("company_id","event_id") REFERENCES "public"."inbound_events"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_event_states" ADD CONSTRAINT "inbound_event_states_waiting_fk" FOREIGN KEY ("company_id","waiting_for_event_id") REFERENCES "public"."inbound_events"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_event_states" ADD CONSTRAINT "inbound_event_states_resolved_by_fk" FOREIGN KEY ("company_id","resolved_by_entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_rule_accounts" ADD CONSTRAINT "posting_rule_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_rule_accounts" ADD CONSTRAINT "posting_rule_accounts_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."chart_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_event_actions_company_event_idx" ON "inbound_event_actions" USING btree ("company_id","event_id","created_at");--> statement-breakpoint
CREATE INDEX "inbound_event_states_company_waiting_idx" ON "inbound_event_states" USING btree ("company_id","waiting_for_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_event_states_resolved_by_key" ON "inbound_event_states" USING btree ("company_id","resolved_by_entry_id") WHERE "inbound_event_states"."resolved_by_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "inbound_event_states_company_resolved_by_idx" ON "inbound_event_states" USING btree ("company_id","resolved_by_entry_id");--> statement-breakpoint
CREATE INDEX "inbound_event_states_company_state_idx" ON "inbound_event_states" USING btree ("company_id","state","hold_reason");--> statement-breakpoint
CREATE INDEX "inbound_events_company_item_idx" ON "inbound_events" USING btree ("company_id","item_key","received_at");--> statement-breakpoint
CREATE INDEX "inbound_events_company_document_idx" ON "inbound_events" USING btree ("company_id","document_type","document_id");--> statement-breakpoint
CREATE INDEX "inbound_events_company_date_idx" ON "inbound_events" USING btree ("company_id","accounting_date");--> statement-breakpoint
CREATE INDEX "posting_rule_accounts_company_account_idx" ON "posting_rule_accounts" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE INDEX "journal_entries_company_hub_document_idx" ON "journal_entries" USING btree ("company_id",("hub_document" ->> 'type'),("hub_document" ->> 'id')) WHERE "journal_entries"."hub_document" is not null;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_payment_tolerance" CHECK ("company_settings"."payment_tolerance_syp_minor" >= 0 and "company_settings"."payment_tolerance_usd_minor" >= 0);