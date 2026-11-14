-- migration-guard: allow drop-cascade (ADR 0021)
DROP TABLE "api_client_keys" CASCADE;--> statement-breakpoint
-- migration-guard: allow drop-cascade (ADR 0021)
DROP TABLE "api_clients" CASCADE;--> statement-breakpoint
-- migration-guard: allow drop-cascade (ADR 0021)
DROP TABLE "document_sources" CASCADE;--> statement-breakpoint
-- migration-guard: allow drop-cascade (ADR 0021)
DROP TABLE "inbound_event_actions" CASCADE;--> statement-breakpoint
-- migration-guard: allow drop-cascade (ADR 0021)
DROP TABLE "inbound_event_states" CASCADE;--> statement-breakpoint
-- migration-guard: allow drop-cascade (ADR 0021)
DROP TABLE "inbound_events" CASCADE;--> statement-breakpoint
-- migration-guard: allow drop-cascade (ADR 0021)
DROP TABLE "posting_rule_accounts" CASCADE;--> statement-breakpoint
-- migration-guard: allow drop-cascade (ADR 0021)
DROP TABLE "recognition_movements" CASCADE;--> statement-breakpoint
-- migration-guard: allow drop-cascade (ADR 0021)
DROP TABLE "recognition_schedules" CASCADE;--> statement-breakpoint
-- migration-guard: allow drop-cascade (ADR 0021)
DROP TABLE "reconciliation_report_events" CASCADE;--> statement-breakpoint
-- migration-guard: allow drop-cascade (ADR 0021)
DROP TABLE "reconciliation_reports" CASCADE;--> statement-breakpoint
-- migration-guard: allow drop-cascade (ADR 0021)
DROP TABLE "opening_record_figures" CASCADE;--> statement-breakpoint
-- migration-guard: allow drop-cascade (ADR 0021)
DROP TABLE "opening_snapshots" CASCADE;--> statement-breakpoint
DROP TYPE "public"."posting_slot";