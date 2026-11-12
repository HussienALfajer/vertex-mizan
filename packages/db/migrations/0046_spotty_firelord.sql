CREATE TABLE "service_departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"service_value_id" uuid NOT NULL,
	"department_value_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"source" text NOT NULL,
	"inbound_event_id" uuid,
	"recorded_by_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_departments_id_is_uuidv7" CHECK ((uuid_extract_version("service_departments"."id") = 7) is true),
	CONSTRAINT "service_departments_source" CHECK ("service_departments"."source" in ('hub', 'manual')),
	CONSTRAINT "service_departments_source_actor" CHECK (("service_departments"."source" = 'hub' and "service_departments"."inbound_event_id" is not null and "service_departments"."recorded_by_user_id" is null)
        or ("service_departments"."source" = 'manual' and "service_departments"."recorded_by_user_id" is not null
          and "service_departments"."inbound_event_id" is null and "service_departments"."reason" is not null)),
	CONSTRAINT "service_departments_reason_length" CHECK ("service_departments"."reason" is null or char_length("service_departments"."reason") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "service_departments" ADD CONSTRAINT "service_departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_departments" ADD CONSTRAINT "service_departments_service_fk" FOREIGN KEY ("company_id","service_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_departments" ADD CONSTRAINT "service_departments_department_fk" FOREIGN KEY ("company_id","department_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_departments" ADD CONSTRAINT "service_departments_inbound_event_fk" FOREIGN KEY ("company_id","inbound_event_id") REFERENCES "public"."inbound_events"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_departments_company_service_idx" ON "service_departments" USING btree ("company_id","service_value_id","effective_from","created_at");--> statement-breakpoint
CREATE INDEX "service_departments_company_department_idx" ON "service_departments" USING btree ("company_id","department_value_id");--> statement-breakpoint
CREATE INDEX "service_departments_company_inbound_event_idx" ON "service_departments" USING btree ("company_id","inbound_event_id");