CREATE TABLE "reconciliation_report_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"type" text NOT NULL,
	"currency" text,
	"amount_minor" bigint,
	"delivery" text NOT NULL,
	"refusal_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_report_events_event_key" UNIQUE("company_id","report_id","event_id"),
	CONSTRAINT "reconciliation_report_events_id_is_uuidv7" CHECK ((uuid_extract_version("reconciliation_report_events"."id") = 7) is true),
	CONSTRAINT "reconciliation_report_events_type" CHECK ("reconciliation_report_events"."type" ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
	CONSTRAINT "reconciliation_report_events_amount" CHECK (("reconciliation_report_events"."currency" is null) = ("reconciliation_report_events"."amount_minor" is null)
        and ("reconciliation_report_events"."currency" is null or "reconciliation_report_events"."currency" in ('SYP', 'USD'))),
	CONSTRAINT "reconciliation_report_events_delivery" CHECK ("reconciliation_report_events"."delivery" in ('pending', 'delivered', 'refused')
        and ("reconciliation_report_events"."refusal_code" is null or ("reconciliation_report_events"."delivery" = 'refused'
          and "reconciliation_report_events"."refusal_code" ~ '^[A-Z][A-Z0-9_]{0,63}$')))
);
--> statement-breakpoint
CREATE TABLE "reconciliation_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"api_client_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"report_date" date NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"event_count" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text NOT NULL,
	"status_at_receipt" text NOT NULL,
	"gaps_at_receipt" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_reports_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "reconciliation_reports_report_key" UNIQUE("company_id","api_client_id","report_id"),
	CONSTRAINT "reconciliation_reports_id_is_uuidv7" CHECK ((uuid_extract_version("reconciliation_reports"."id") = 7) is true),
	CONSTRAINT "reconciliation_reports_payload_hash" CHECK ("reconciliation_reports"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "reconciliation_reports_payload" CHECK (jsonb_typeof("reconciliation_reports"."payload") = 'object'),
	CONSTRAINT "reconciliation_reports_event_count" CHECK ("reconciliation_reports"."event_count" between 0 and 5000),
	CONSTRAINT "reconciliation_reports_request_id" CHECK (char_length("reconciliation_reports"."request_id") between 1 and 200),
	CONSTRAINT "reconciliation_reports_status_at_receipt" CHECK ("reconciliation_reports"."status_at_receipt" in ('matched', 'differences')),
	CONSTRAINT "reconciliation_reports_gaps_at_receipt" CHECK ("reconciliation_reports"."gaps_at_receipt" >= 0
        and ("reconciliation_reports"."status_at_receipt" = 'matched') = ("reconciliation_reports"."gaps_at_receipt" = 0))
);
--> statement-breakpoint
ALTER TABLE "api_clients" ADD COLUMN "reconcile_from" date;--> statement-breakpoint
ALTER TABLE "reconciliation_report_events" ADD CONSTRAINT "reconciliation_report_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_report_events" ADD CONSTRAINT "reconciliation_report_events_report_fk" FOREIGN KEY ("company_id","report_id") REFERENCES "public"."reconciliation_reports"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_reports" ADD CONSTRAINT "reconciliation_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reconciliation_report_events_company_event_idx" ON "reconciliation_report_events" USING btree ("company_id","event_id");--> statement-breakpoint
CREATE INDEX "reconciliation_reports_latest_idx" ON "reconciliation_reports" USING btree ("company_id","api_client_id","report_date","generated_at" DESC NULLS LAST,"received_at" DESC NULLS LAST);