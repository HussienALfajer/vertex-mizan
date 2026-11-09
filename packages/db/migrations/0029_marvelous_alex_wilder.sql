ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_kind";--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_dedupe_key" ON "email_outbox" USING btree ("dedupe_key");--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_dedupe_key_length" CHECK ("email_outbox"."dedupe_key" is null or char_length("email_outbox"."dedupe_key") between 1 and 200);--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_kind" CHECK ("email_outbox"."kind" in ('invitation', 'password_reset', 'two_factor_reset', 'daily_anchor', 'export_ready', 'held_digest'));