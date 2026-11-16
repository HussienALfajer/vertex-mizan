ALTER TABLE "project_documents" ADD COLUMN "contract_value_minor" bigint;--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "retention_bp" integer;--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "advance_recovery_bp" integer;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_terms" CHECK (("project_documents"."kind" in ('progress_billing', 'subcontract_billing')
          or ("project_documents"."contract_value_minor" is null and "project_documents"."retention_bp" is null
            and "project_documents"."advance_recovery_bp" is null))
        and ("project_documents"."contract_value_minor" is null or "project_documents"."contract_value_minor" >= 0)
        and ("project_documents"."retention_bp" is null or "project_documents"."retention_bp" between 0 and 10000)
        and ("project_documents"."advance_recovery_bp" is null or "project_documents"."advance_recovery_bp" between 0 and 10000));