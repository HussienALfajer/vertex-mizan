CREATE TYPE "public"."project_document_kind" AS ENUM('purchase', 'wage_sheet', 'progress_billing', 'subcontract_billing', 'retention_release');--> statement-breakpoint
CREATE TYPE "public"."retention_side" AS ENUM('client', 'supplier');--> statement-breakpoint
CREATE TABLE "advance_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"advance_line_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"book_minor" bigint NOT NULL,
	"parallel_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advance_applications_line_key" UNIQUE("company_id","line_id"),
	CONSTRAINT "advance_applications_id_is_uuidv7" CHECK ((uuid_extract_version("advance_applications"."id") = 7) is true),
	CONSTRAINT "advance_applications_amount" CHECK ("advance_applications"."amount_minor" <> 0),
	CONSTRAINT "advance_applications_lines" CHECK ("advance_applications"."advance_line_id" <> "advance_applications"."line_id")
);
--> statement-breakpoint
CREATE TABLE "line_quantities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"material_id" uuid,
	"unit" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(18, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_quantities_line_key" UNIQUE("company_id","line_id"),
	CONSTRAINT "line_quantities_id_is_uuidv7" CHECK ((uuid_extract_version("line_quantities"."id") = 7) is true),
	CONSTRAINT "line_quantities_unit_length" CHECK (char_length("line_quantities"."unit") between 1 and 20),
	CONSTRAINT "line_quantities_unit_price" CHECK (("line_quantities"."unit_price" is null) = ("line_quantities"."quantity" = 0)
        and ("line_quantities"."unit_price" is null or "line_quantities"."unit_price" >= 0)
        and ("line_quantities"."quantity" <> 0 or "line_quantities"."material_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "project_document_sequences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "project_document_kind" NOT NULL,
	"fiscal_year" smallint NOT NULL,
	"last_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_document_sequences_key" UNIQUE("company_id","kind","fiscal_year"),
	CONSTRAINT "project_document_sequences_id_is_uuidv7" CHECK ((uuid_extract_version("project_document_sequences"."id") = 7) is true),
	CONSTRAINT "project_document_sequences_fiscal_year" CHECK ("project_document_sequences"."fiscal_year" between 2000 and 9999),
	CONSTRAINT "project_document_sequences_last_number" CHECK ("project_document_sequences"."last_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "project_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "project_document_kind" NOT NULL,
	"fiscal_year" smallint NOT NULL,
	"number" integer NOT NULL,
	"project_sequence" integer,
	"document_date" date NOT NULL,
	"entry_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"contract_value_id" uuid NOT NULL,
	"counterparty_value_id" uuid,
	"side" "retention_side",
	"currency" text NOT NULL,
	"period_from" date,
	"period_to" date,
	"total_minor" bigint NOT NULL,
	"cumulative_minor" bigint,
	"previous_minor" bigint,
	"retention_minor" bigint,
	"advance_minor" bigint,
	"supplier_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_documents_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "project_documents_number_key" UNIQUE("company_id","kind","fiscal_year","number"),
	CONSTRAINT "project_documents_entry_key" UNIQUE("company_id","entry_id"),
	CONSTRAINT "project_documents_draft_key" UNIQUE("company_id","draft_id"),
	CONSTRAINT "project_documents_id_is_uuidv7" CHECK ((uuid_extract_version("project_documents"."id") = 7) is true),
	CONSTRAINT "project_documents_fiscal_year" CHECK ("project_documents"."fiscal_year" between 2000 and 9999),
	CONSTRAINT "project_documents_number" CHECK ("project_documents"."number" >= 1),
	CONSTRAINT "project_documents_project_sequence" CHECK (("project_documents"."project_sequence" is not null)
        = ("project_documents"."kind" in ('progress_billing', 'subcontract_billing'))
        and ("project_documents"."project_sequence" is null or "project_documents"."project_sequence" >= 1)),
	CONSTRAINT "project_documents_currency" CHECK ("project_documents"."currency" in ('USD', 'SYP', 'TRY', 'EUR')),
	CONSTRAINT "project_documents_kind_fields" CHECK (("project_documents"."kind" <> 'wage_sheet' or "project_documents"."counterparty_value_id" is null)
        and ("project_documents"."kind" not in ('purchase', 'subcontract_billing') or "project_documents"."counterparty_value_id" is not null)
        and (("project_documents"."period_from" is not null) = ("project_documents"."kind" = 'wage_sheet'))
        and (("project_documents"."period_to" is not null) = ("project_documents"."kind" = 'wage_sheet'))
        and ("project_documents"."period_from" is null or ("project_documents"."period_from" <= "project_documents"."period_to"
          and date_trunc('month', "project_documents"."period_from") = date_trunc('month', "project_documents"."period_to")
          and "project_documents"."period_to" = "project_documents"."document_date"))
        and (("project_documents"."cumulative_minor" is not null)
          = ("project_documents"."kind" in ('progress_billing', 'subcontract_billing')))
        and (("project_documents"."previous_minor" is not null) = ("project_documents"."cumulative_minor" is not null))
        and (("project_documents"."side" is not null) = ("project_documents"."kind" = 'retention_release'))
        and ("project_documents"."side" is distinct from 'supplier' or "project_documents"."counterparty_value_id" is not null)
        and ("project_documents"."supplier_reference" is null or ("project_documents"."kind" = 'purchase'
          and char_length("project_documents"."supplier_reference") between 1 and 60))),
	CONSTRAINT "project_documents_amounts" CHECK ("project_documents"."total_minor" >= 0
        and ("project_documents"."retention_minor" is null or "project_documents"."retention_minor" >= 0)
        and ("project_documents"."advance_minor" is null or "project_documents"."advance_minor" >= 0)
        and ("project_documents"."cumulative_minor" is null or "project_documents"."cumulative_minor" > "project_documents"."previous_minor"))
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_latin" text,
	"unit" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "materials_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "materials_code_key" UNIQUE("company_id","code"),
	CONSTRAINT "materials_id_is_uuidv7" CHECK ((uuid_extract_version("materials"."id") = 7) is true),
	CONSTRAINT "materials_code_length" CHECK (char_length("materials"."code") between 1 and 30),
	CONSTRAINT "materials_name_length" CHECK (char_length("materials"."name") between 1 and 200),
	CONSTRAINT "materials_name_latin_length" CHECK ("materials"."name_latin" is null or char_length("materials"."name_latin") between 1 and 200),
	CONSTRAINT "materials_unit_length" CHECK (char_length("materials"."unit") between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "project_budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_value_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "project_budgets_key" UNIQUE("company_id","contract_value_id","account_id"),
	CONSTRAINT "project_budgets_id_is_uuidv7" CHECK ((uuid_extract_version("project_budgets"."id") = 7) is true),
	CONSTRAINT "project_budgets_amount" CHECK ("project_budgets"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_terms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_value_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"contract_value_minor" bigint NOT NULL,
	"retention_bp" integer NOT NULL,
	"advance_recovery_bp" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "project_terms_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "project_terms_contract_key" UNIQUE("company_id","contract_value_id"),
	CONSTRAINT "project_terms_id_is_uuidv7" CHECK ((uuid_extract_version("project_terms"."id") = 7) is true),
	CONSTRAINT "project_terms_currency" CHECK ("project_terms"."currency" in ('USD', 'SYP', 'TRY', 'EUR')),
	CONSTRAINT "project_terms_contract_value" CHECK ("project_terms"."contract_value_minor" >= 0),
	CONSTRAINT "project_terms_rates" CHECK ("project_terms"."retention_bp" between 0 and 10000 and "project_terms"."advance_recovery_bp" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "subcontracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_value_id" uuid NOT NULL,
	"supplier_value_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"value_minor" bigint,
	"retention_bp" integer NOT NULL,
	"advance_recovery_bp" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "subcontracts_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "subcontracts_key" UNIQUE("company_id","contract_value_id","supplier_value_id"),
	CONSTRAINT "subcontracts_id_is_uuidv7" CHECK ((uuid_extract_version("subcontracts"."id") = 7) is true),
	CONSTRAINT "subcontracts_currency" CHECK ("subcontracts"."currency" in ('USD', 'SYP', 'TRY', 'EUR')),
	CONSTRAINT "subcontracts_value" CHECK ("subcontracts"."value_minor" is null or "subcontracts"."value_minor" >= 0),
	CONSTRAINT "subcontracts_rates" CHECK ("subcontracts"."retention_bp" between 0 and 10000 and "subcontracts"."advance_recovery_bp" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "chart_accounts" ADD COLUMN "requires_material" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "entry_draft_lines" ADD COLUMN "material_id" uuid;--> statement-breakpoint
ALTER TABLE "entry_draft_lines" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "entry_draft_lines" ADD COLUMN "quantity" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "entry_draft_lines" ADD COLUMN "unit_price" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "entry_draft_lines" ADD COLUMN "advance_minor" bigint;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD COLUMN "project_document_kind" "project_document_kind";--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD COLUMN "contract_value_id" uuid;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD COLUMN "counterparty_value_id" uuid;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD COLUMN "document_currency" text;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD COLUMN "side" "retention_side";--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD COLUMN "period_from" date;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD COLUMN "period_to" date;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD COLUMN "cumulative_minor" bigint;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD COLUMN "retention_minor" bigint;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD COLUMN "advance_minor" bigint;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD COLUMN "supplier_reference" text;--> statement-breakpoint
ALTER TABLE "advance_applications" ADD CONSTRAINT "advance_applications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_applications" ADD CONSTRAINT "advance_applications_entry_fk" FOREIGN KEY ("company_id","entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_applications" ADD CONSTRAINT "advance_applications_advance_line_fk" FOREIGN KEY ("company_id","advance_line_id") REFERENCES "public"."journal_lines"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_applications" ADD CONSTRAINT "advance_applications_line_fk" FOREIGN KEY ("company_id","line_id") REFERENCES "public"."journal_lines"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_quantities" ADD CONSTRAINT "line_quantities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_quantities" ADD CONSTRAINT "line_quantities_line_fk" FOREIGN KEY ("company_id","line_id") REFERENCES "public"."journal_lines"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_quantities" ADD CONSTRAINT "line_quantities_entry_fk" FOREIGN KEY ("company_id","entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_quantities" ADD CONSTRAINT "line_quantities_material_fk" FOREIGN KEY ("company_id","material_id") REFERENCES "public"."materials"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_document_sequences" ADD CONSTRAINT "project_document_sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_entry_fk" FOREIGN KEY ("company_id","entry_id") REFERENCES "public"."journal_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_draft_fk" FOREIGN KEY ("company_id","draft_id") REFERENCES "public"."entry_drafts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_contract_value_fk" FOREIGN KEY ("company_id","contract_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_counterparty_value_fk" FOREIGN KEY ("company_id","counterparty_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_terms_fk" FOREIGN KEY ("company_id","contract_value_id") REFERENCES "public"."project_terms"("company_id","contract_value_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."chart_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_terms" ADD CONSTRAINT "project_terms_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_terms" ADD CONSTRAINT "project_terms_contract_value_fk" FOREIGN KEY ("company_id","contract_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_contract_value_fk" FOREIGN KEY ("company_id","contract_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_supplier_value_fk" FOREIGN KEY ("company_id","supplier_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advance_applications_company_entry_idx" ON "advance_applications" USING btree ("company_id","entry_id");--> statement-breakpoint
CREATE INDEX "advance_applications_company_advance_line_idx" ON "advance_applications" USING btree ("company_id","advance_line_id");--> statement-breakpoint
CREATE INDEX "line_quantities_company_entry_idx" ON "line_quantities" USING btree ("company_id","entry_id");--> statement-breakpoint
CREATE INDEX "line_quantities_company_material_idx" ON "line_quantities" USING btree ("company_id","material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_documents_project_sequence_key" ON "project_documents" USING btree ("company_id","contract_value_id","counterparty_value_id","kind","project_sequence") WHERE "project_documents"."project_sequence" is not null;--> statement-breakpoint
CREATE INDEX "project_documents_company_contract_idx" ON "project_documents" USING btree ("company_id","contract_value_id","document_date");--> statement-breakpoint
CREATE INDEX "project_documents_company_counterparty_idx" ON "project_documents" USING btree ("company_id","counterparty_value_id");--> statement-breakpoint
CREATE INDEX "project_documents_company_date_idx" ON "project_documents" USING btree ("company_id","document_date","id");--> statement-breakpoint
CREATE INDEX "project_budgets_company_account_idx" ON "project_budgets" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE INDEX "subcontracts_company_supplier_idx" ON "subcontracts" USING btree ("company_id","supplier_value_id");--> statement-breakpoint
ALTER TABLE "entry_draft_lines" ADD CONSTRAINT "entry_draft_lines_material_fk" FOREIGN KEY ("company_id","material_id") REFERENCES "public"."materials"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD CONSTRAINT "entry_drafts_contract_value_fk" FOREIGN KEY ("company_id","contract_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD CONSTRAINT "entry_drafts_counterparty_value_fk" FOREIGN KEY ("company_id","counterparty_value_id") REFERENCES "public"."dimension_values"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_draft_lines_company_material_idx" ON "entry_draft_lines" USING btree ("company_id","material_id");--> statement-breakpoint
CREATE INDEX "entry_drafts_company_contract_value_idx" ON "entry_drafts" USING btree ("company_id","contract_value_id");--> statement-breakpoint
CREATE INDEX "entry_drafts_company_counterparty_value_idx" ON "entry_drafts" USING btree ("company_id","counterparty_value_id");--> statement-breakpoint
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_requires_material" CHECK (not "chart_accounts"."requires_material" or ("chart_accounts"."kind" = 'postable' and "chart_accounts"."class" = 'expense'));--> statement-breakpoint
ALTER TABLE "entry_draft_lines" ADD CONSTRAINT "entry_draft_lines_quantity" CHECK (("entry_draft_lines"."quantity" is not null or ("entry_draft_lines"."material_id" is null and "entry_draft_lines"."unit" is null
          and "entry_draft_lines"."unit_price" is null))
        and ("entry_draft_lines"."unit" is null or char_length("entry_draft_lines"."unit") between 1 and 20)
        and ("entry_draft_lines"."unit_price" is null or "entry_draft_lines"."unit_price" >= 0)
        and ("entry_draft_lines"."advance_minor" is null or "entry_draft_lines"."advance_minor" > 0));--> statement-breakpoint
ALTER TABLE "entry_drafts" ADD CONSTRAINT "entry_drafts_project_document" CHECK (("entry_drafts"."project_document_kind" is null) = ("entry_drafts"."contract_value_id" is null)
        and ("entry_drafts"."project_document_kind" is null or ("entry_drafts"."voucher_kind" is null and "entry_drafts"."reverses_entry_id" is null))
        and ("entry_drafts"."project_document_kind" is not null or ("entry_drafts"."counterparty_value_id" is null
          and "entry_drafts"."document_currency" is null and "entry_drafts"."side" is null and "entry_drafts"."period_from" is null
          and "entry_drafts"."period_to" is null and "entry_drafts"."cumulative_minor" is null and "entry_drafts"."retention_minor" is null
          and "entry_drafts"."advance_minor" is null and "entry_drafts"."supplier_reference" is null))
        and ("entry_drafts"."document_currency" is null or "entry_drafts"."document_currency" in ('USD', 'SYP', 'TRY', 'EUR'))
        and ("entry_drafts"."retention_minor" is null or "entry_drafts"."retention_minor" >= 0)
        and ("entry_drafts"."advance_minor" is null or "entry_drafts"."advance_minor" >= 0)
        and ("entry_drafts"."period_from" is null or "entry_drafts"."period_to" is null or "entry_drafts"."period_from" <= "entry_drafts"."period_to")
        and ("entry_drafts"."supplier_reference" is null or char_length("entry_drafts"."supplier_reference") between 1 and 60));