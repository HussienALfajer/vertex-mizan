CREATE TYPE "public"."membership_role" AS ENUM('owner', 'accountant', 'approver', 'viewer', 'auditor');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "accounts_id_is_uuidv7" CHECK ((uuid_extract_version("accounts"."id") = 7) is true),
	CONSTRAINT "accounts_credential_only" CHECK ("accounts"."provider_id" = 'credential' and "accounts"."password" is not null
        and "accounts"."access_token" is null and "accounts"."refresh_token" is null and "accounts"."id_token" is null
        and "accounts"."access_token_expires_at" is null and "accounts"."refresh_token_expires_at" is null
        and "accounts"."scope" is null)
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope_company_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"can_close_periods" boolean DEFAULT false NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"verification_identifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_id_is_uuidv7" CHECK ((uuid_extract_version("invitations"."id") = 7) is true),
	CONSTRAINT "invitations_email_shape" CHECK ("invitations"."email" = lower("invitations"."email") and char_length("invitations"."email") <= 254),
	CONSTRAINT "invitations_period_permission_accountant_only" CHECK (not "invitations"."can_close_periods" or "invitations"."role" = 'accountant'),
	CONSTRAINT "invitations_accepted_by_someone" CHECK (("invitations"."accepted_at" is null) = ("invitations"."accepted_by_user_id" is null)),
	CONSTRAINT "invitations_accepted_or_revoked" CHECK ("invitations"."accepted_at" is null or "invitations"."revoked_at" is null)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"scope_company_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"can_close_periods" boolean DEFAULT false NOT NULL,
	"invited_by_user_id" uuid,
	"archived_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "memberships_id_is_uuidv7" CHECK ((uuid_extract_version("memberships"."id") = 7) is true),
	CONSTRAINT "memberships_period_permission_accountant_only" CHECK (not "memberships"."can_close_periods" or "memberships"."role" = 'accountant'),
	CONSTRAINT "memberships_archived_with_reason" CHECK (("memberships"."archived_at" is null) = ("memberships"."archived_reason" is null)
        and ("memberships"."archived_reason" is null or char_length("memberships"."archived_reason") between 1 and 1000))
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limits_id_is_uuidv7" CHECK ((uuid_extract_version("rate_limits"."id") = 7) is true)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"active_company_id" uuid,
	"two_factor_verified_at" timestamp with time zone,
	"reauthenticated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_id_is_uuidv7" CHECK ((uuid_extract_version("sessions"."id") = 7) is true)
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "two_factors_id_is_uuidv7" CHECK ((uuid_extract_version("two_factors"."id") = 7) is true),
	CONSTRAINT "two_factors_failures_not_negative" CHECK ("two_factors"."failed_verification_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "users_id_is_uuidv7" CHECK ((uuid_extract_version("users"."id") = 7) is true),
	CONSTRAINT "users_email_shape" CHECK ("users"."email" = lower("users"."email") and char_length("users"."email") <= 254),
	CONSTRAINT "users_name_length" CHECK (char_length("users"."name") between 1 and 120),
	CONSTRAINT "users_image_unused" CHECK ("users"."image" is null)
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verifications_id_is_uuidv7" CHECK ((uuid_extract_version("verifications"."id") = 7) is true)
);
--> statement-breakpoint
CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"actor_api_client_id" uuid,
	"actor_name" text NOT NULL,
	"session_id" uuid,
	"request_id" text NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	CONSTRAINT "audit_entries_id_is_uuidv7" CHECK ((uuid_extract_version("audit_entries"."id") = 7) is true),
	CONSTRAINT "audit_entries_actor" CHECK (("audit_entries"."actor_kind" = 'person' and "audit_entries"."actor_user_id" is not null and "audit_entries"."actor_api_client_id" is null)
        or ("audit_entries"."actor_kind" = 'api_client' and "audit_entries"."actor_api_client_id" is not null and "audit_entries"."actor_user_id" is null)
        or ("audit_entries"."actor_kind" = 'system' and "audit_entries"."actor_user_id" is null and "audit_entries"."actor_api_client_id" is null)),
	CONSTRAINT "audit_entries_action_shape" CHECK ("audit_entries"."action" ~ '^[a-z]+(_[a-z]+)*\.[a-z]+(_[a-z]+)*$'),
	CONSTRAINT "audit_entries_actor_name_length" CHECK (char_length("audit_entries"."actor_name") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "platform_audit_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"subject_company_id" uuid,
	"action" text NOT NULL,
	"email" text,
	"session_id" uuid,
	"request_id" text NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"details" jsonb,
	CONSTRAINT "platform_audit_entries_id_is_uuidv7" CHECK ((uuid_extract_version("platform_audit_entries"."id") = 7) is true),
	CONSTRAINT "platform_audit_entries_actor" CHECK ("platform_audit_entries"."actor_kind" = 'person' or ("platform_audit_entries"."actor_kind" = 'system' and "platform_audit_entries"."actor_user_id" is null)),
	CONSTRAINT "platform_audit_entries_action_shape" CHECK ("platform_audit_entries"."action" ~ '^[a-z]+(_[a-z]+)*\.[a-z]+(_[a-z]+)*$'),
	CONSTRAINT "platform_audit_entries_email_shape" CHECK ("platform_audit_entries"."email" is null or ("platform_audit_entries"."email" = lower("platform_audit_entries"."email") and char_length("platform_audit_entries"."email") <= 254))
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_latin" text,
	"data_location" text DEFAULT 'pool' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"archived_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "companies_id_is_uuidv7" CHECK ((uuid_extract_version("companies"."id") = 7) is true),
	CONSTRAINT "companies_name_length" CHECK (char_length("companies"."name") between 1 and 200),
	CONSTRAINT "companies_name_latin_length" CHECK ("companies"."name_latin" is null or char_length("companies"."name_latin") between 1 and 200),
	CONSTRAINT "companies_data_location" CHECK ("companies"."data_location" in ('pool', 'silo')),
	CONSTRAINT "companies_archived_with_reason" CHECK (("companies"."archived_at" is null) = ("companies"."archived_reason" is null)
        and ("companies"."archived_reason" is null or char_length("companies"."archived_reason") between 1 and 1000))
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"book_currency" text NOT NULL,
	"book_rate_type" text NOT NULL,
	"book_accepts_transaction_rate" boolean NOT NULL,
	"parallel_currency" text,
	"parallel_rate_type" text,
	"parallel_accepts_transaction_rate" boolean,
	"fiscal_year_start_month" smallint DEFAULT 1 NOT NULL,
	"policy_note" text NOT NULL,
	"books_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "company_settings_company_id_key" UNIQUE("company_id"),
	CONSTRAINT "company_settings_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "company_settings_id_is_uuidv7" CHECK ((uuid_extract_version("company_settings"."id") = 7) is true),
	CONSTRAINT "company_settings_currencies" CHECK ("company_settings"."book_currency" in ('USD', 'SYP', 'TRY', 'EUR')
        and ("company_settings"."parallel_currency" is null or "company_settings"."parallel_currency" in ('USD', 'SYP', 'TRY', 'EUR'))),
	CONSTRAINT "company_settings_rate_types" CHECK ("company_settings"."book_rate_type" in ('market', 'bulletin')
        and ("company_settings"."parallel_rate_type" is null or "company_settings"."parallel_rate_type" in ('market', 'bulletin'))),
	CONSTRAINT "company_settings_parallel_complete" CHECK (("company_settings"."parallel_currency" is null) = ("company_settings"."parallel_rate_type" is null)
        and ("company_settings"."parallel_currency" is null) = ("company_settings"."parallel_accepts_transaction_rate" is null)),
	CONSTRAINT "company_settings_parallel_differs" CHECK ("company_settings"."parallel_currency" is null or "company_settings"."parallel_currency" <> "company_settings"."book_currency"),
	CONSTRAINT "company_settings_transaction_rate_market_only" CHECK ((not "company_settings"."book_accepts_transaction_rate" or "company_settings"."book_rate_type" = 'market')
        and ("company_settings"."parallel_accepts_transaction_rate" is not true or "company_settings"."parallel_rate_type" = 'market')),
	CONSTRAINT "company_settings_fiscal_year_start_month" CHECK ("company_settings"."fiscal_year_start_month" between 1 and 12),
	CONSTRAINT "company_settings_policy_note_length" CHECK (char_length("company_settings"."policy_note") between 1 and 4000)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_scope_company_id_companies_id_fk" FOREIGN KEY ("scope_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_scope_company_id_companies_id_fk" FOREIGN KEY ("scope_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_company_id_companies_id_fk" FOREIGN KEY ("active_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_entries" ADD CONSTRAINT "platform_audit_entries_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_entries" ADD CONSTRAINT "platform_audit_entries_subject_company_id_companies_id_fk" FOREIGN KEY ("subject_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_key" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_key" ON "invitations" USING btree ("scope_company_id","email") WHERE "invitations"."accepted_at" is null and "invitations"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_verification_identifier_key" ON "invitations" USING btree ("verification_identifier");--> statement-breakpoint
CREATE INDEX "invitations_scope_company_id_idx" ON "invitations" USING btree ("scope_company_id");--> statement-breakpoint
CREATE INDEX "invitations_invited_by_user_id_idx" ON "invitations" USING btree ("invited_by_user_id");--> statement-breakpoint
CREATE INDEX "invitations_accepted_by_user_id_idx" ON "invitations" USING btree ("accepted_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_active_key" ON "memberships" USING btree ("user_id","scope_company_id") WHERE "memberships"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_scope_company_id_idx" ON "memberships" USING btree ("scope_company_id");--> statement-breakpoint
CREATE INDEX "memberships_invited_by_user_id_idx" ON "memberships" USING btree ("invited_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limits_key_key" ON "rate_limits" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_active_company_id_idx" ON "sessions" USING btree ("active_company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "two_factors_user_id_key" ON "two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "verifications_identifier_key" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "audit_entries_company_created_idx" ON "audit_entries" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_entries_company_entity_idx" ON "audit_entries" USING btree ("company_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_entries_company_actor_idx" ON "audit_entries" USING btree ("company_id","actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_entries_actor_idx" ON "platform_audit_entries" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_entries_subject_company_idx" ON "platform_audit_entries" USING btree ("subject_company_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_entries_email_idx" ON "platform_audit_entries" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "companies_created_by_user_id_idx" ON "companies" USING btree ("created_by_user_id");