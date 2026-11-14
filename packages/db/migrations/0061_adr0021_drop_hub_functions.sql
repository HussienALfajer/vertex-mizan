-- ADR 0021: the guard functions of Hub's tables, dropped with them in 0060, and the btree_gin
-- extension, which only the inbox's `order_keys` index used (0034).
DROP FUNCTION public.inbound_event_state_rules();
--> statement-breakpoint
DROP FUNCTION public.api_client_rules();
--> statement-breakpoint
DROP FUNCTION public.api_client_key_rules();
--> statement-breakpoint
DROP FUNCTION public.document_source_rules();
--> statement-breakpoint
DROP FUNCTION public.recognition_schedule_rules();
--> statement-breakpoint
DROP FUNCTION public.recognition_movement_rules();
--> statement-breakpoint
DROP FUNCTION public.recognition_schedule_remaining();
--> statement-breakpoint
DROP FUNCTION public.reconciliation_report_complete();
--> statement-breakpoint
DROP FUNCTION public.api_client_reconcile_from_rules();
--> statement-breakpoint
DROP FUNCTION public.opening_snapshot_rules();
--> statement-breakpoint
DROP EXTENSION btree_gin;
