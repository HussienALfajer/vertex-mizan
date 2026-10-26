CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"recipient" text NOT NULL,
	"data" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_id_is_uuidv7" CHECK ((uuid_extract_version("email_outbox"."id") = 7) is true),
	CONSTRAINT "email_outbox_kind" CHECK ("email_outbox"."kind" in ('invitation', 'password_reset', 'two_factor_reset')),
	CONSTRAINT "email_outbox_recipient_shape" CHECK ("email_outbox"."recipient" = lower("email_outbox"."recipient") and char_length("email_outbox"."recipient") <= 254),
	CONSTRAINT "email_outbox_attempts_not_negative" CHECK ("email_outbox"."attempts" >= 0),
	CONSTRAINT "email_outbox_last_error_code_length" CHECK ("email_outbox"."last_error_code" is null or char_length("email_outbox"."last_error_code") between 1 and 100)
);
--> statement-breakpoint
CREATE INDEX "email_outbox_send_after_idx" ON "email_outbox" USING btree ("send_after");