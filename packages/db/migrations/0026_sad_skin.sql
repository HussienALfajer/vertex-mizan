CREATE TABLE "api_client_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"api_client_id" uuid NOT NULL,
	"scope_company_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_ip" "inet",
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"revoke_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "api_client_keys_secret_hash_key" UNIQUE("secret_hash"),
	CONSTRAINT "api_client_keys_prefix_key" UNIQUE("prefix"),
	CONSTRAINT "api_client_keys_id_is_uuidv7" CHECK ((uuid_extract_version("api_client_keys"."id") = 7) is true),
	CONSTRAINT "api_client_keys_prefix" CHECK ("api_client_keys"."prefix" ~ '^mzn_[0-9A-Za-z]{8}$'),
	CONSTRAINT "api_client_keys_secret_hash" CHECK ("api_client_keys"."secret_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "api_client_keys_last_use" CHECK (("api_client_keys"."last_used_at" is null) = ("api_client_keys"."last_used_ip" is null)),
	CONSTRAINT "api_client_keys_revocation" CHECK (("api_client_keys"."revoked_at" is null) = ("api_client_keys"."revoke_reason" is null)
        and ("api_client_keys"."revoked_at" is null) = ("api_client_keys"."revoked_by_user_id" is null)
        and ("api_client_keys"."revoke_reason" is null or char_length("api_client_keys"."revoke_reason") between 1 and 500)),
	CONSTRAINT "api_client_keys_never_archived" CHECK ("api_client_keys"."archived_at" is null)
);
--> statement-breakpoint
CREATE TABLE "api_clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope_company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"system" text NOT NULL,
	"scopes" text[] NOT NULL,
	"ip_allow_list" "cidr"[] DEFAULT '{}' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "api_clients_name_key" UNIQUE("scope_company_id","name"),
	CONSTRAINT "api_clients_scope_company_id_id_key" UNIQUE("scope_company_id","id"),
	CONSTRAINT "api_clients_id_is_uuidv7" CHECK ((uuid_extract_version("api_clients"."id") = 7) is true),
	CONSTRAINT "api_clients_name" CHECK (char_length("api_clients"."name") between 1 and 100),
	CONSTRAINT "api_clients_system" CHECK ("api_clients"."system" in ('hub')),
	CONSTRAINT "api_clients_scopes" CHECK (cardinality("api_clients"."scopes") between 1 and 3
        and "api_clients"."scopes" <@ array['events:write', 'periods:read', 'reconciliation:write']::text[]
        and array_position("api_clients"."scopes", null) is null),
	CONSTRAINT "api_clients_ip_allow_list" CHECK (cardinality("api_clients"."ip_allow_list") <= 50 and array_position("api_clients"."ip_allow_list", null) is null)
);
--> statement-breakpoint
CREATE TABLE "document_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"api_client_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "document_sources_document_type_key" UNIQUE("company_id","document_type"),
	CONSTRAINT "document_sources_id_is_uuidv7" CHECK ((uuid_extract_version("document_sources"."id") = 7) is true),
	CONSTRAINT "document_sources_document_type" CHECK ("document_sources"."document_type" in ('invoice', 'payment', 'project_expense', 'ad_wallet_entry', 'ad_spend', 'milestone', 'project', 'rate'))
);
--> statement-breakpoint
ALTER TABLE "api_client_keys" ADD CONSTRAINT "api_client_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_client_keys" ADD CONSTRAINT "api_client_keys_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_client_keys" ADD CONSTRAINT "api_client_keys_client_fk" FOREIGN KEY ("scope_company_id","api_client_id") REFERENCES "public"."api_clients"("scope_company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_scope_company_id_companies_id_fk" FOREIGN KEY ("scope_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sources" ADD CONSTRAINT "document_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_client_keys_client_idx" ON "api_client_keys" USING btree ("scope_company_id","api_client_id");--> statement-breakpoint
CREATE INDEX "api_client_keys_created_by_user_id_idx" ON "api_client_keys" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "api_client_keys_revoked_by_user_id_idx" ON "api_client_keys" USING btree ("revoked_by_user_id");--> statement-breakpoint
CREATE INDEX "api_clients_created_by_user_id_idx" ON "api_clients" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "document_sources_company_client_idx" ON "document_sources" USING btree ("company_id","api_client_id");