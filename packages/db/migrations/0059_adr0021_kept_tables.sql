ALTER TABLE "company_settings" DROP CONSTRAINT "company_settings_payment_tolerance";--> statement-breakpoint
ALTER TABLE "entry_draft_lines" DROP CONSTRAINT "entry_draft_lines_schedule";--> statement-breakpoint
ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_kind";--> statement-breakpoint
ALTER TABLE "openings" DROP CONSTRAINT "openings_posted_fields";--> statement-breakpoint
ALTER TABLE "service_departments" DROP CONSTRAINT "service_departments_inbound_event_fk";
--> statement-breakpoint
ALTER TABLE "entry_draft_lines" DROP CONSTRAINT "entry_draft_lines_schedule_fk";
--> statement-breakpoint
ALTER TABLE "openings" DROP CONSTRAINT "openings_snapshot_fk";
--> statement-breakpoint
DROP INDEX "service_departments_company_inbound_event_idx";--> statement-breakpoint
DROP INDEX "entry_draft_lines_company_schedule_idx";--> statement-breakpoint
DROP INDEX "openings_company_snapshot_idx";--> statement-breakpoint
ALTER TABLE "company_settings" DROP COLUMN "payment_tolerance_syp_minor";--> statement-breakpoint
ALTER TABLE "company_settings" DROP COLUMN "payment_tolerance_usd_minor";--> statement-breakpoint
ALTER TABLE "entry_draft_lines" DROP COLUMN "schedule_id";--> statement-breakpoint
ALTER TABLE "openings" DROP COLUMN "snapshot_id";--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_kind" CHECK ("email_outbox"."kind" in ('invitation', 'password_reset', 'two_factor_reset', 'daily_anchor', 'export_ready'));--> statement-breakpoint
ALTER TABLE "openings" ADD CONSTRAINT "openings_posted_fields" CHECK (("openings"."state" = 'draft') = ("openings"."entry_id" is null)
        and ("openings"."entry_id" is null) = ("openings"."posted_by_user_id" is null)
        and ("openings"."entry_id" is null) = ("openings"."posted_at" is null)
        and ("openings"."entry_id" is null) = ("openings"."fingerprint" is null));