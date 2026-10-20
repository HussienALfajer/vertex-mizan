-- The foundation of company isolation and of the ledger guards (ADR 0003, ADR 0005, ADR 0008): the
-- function every company policy calls, the trigger function of every append-only table, and the
-- schema of pg-boss. The roles mizan_owner (runs migrations, owns everything), mizan_app (the API
-- and the worker), mizan_jobs (the worker's cross-company jobs) and mizan_queue (pg-boss) exist
-- before the first migration: `pnpm db:setup-local` locally, the deployment on servers
-- (packages/db/CLAUDE.md). Tables arrive with their specs, each with its policy, triggers and
-- grants in a custom migration.

-- The company of the current transaction, set by withCompany(); NULL when none is set, so a policy
-- comparing with it matches nothing. It reads only the transaction setting, with no fallback. Every
-- company policy uses it; the convention test pins its body.
CREATE FUNCTION current_company_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;
--> statement-breakpoint

-- Refuses UPDATE, DELETE and TRUNCATE on append-only tables, for every role including the owner:
-- each append-only table gets a row trigger before UPDATE OR DELETE and a statement trigger before
-- TRUNCATE, both ENABLE ALWAYS so that session_replication_role = replica cannot skip them
-- (ADR 0008). The convention test pins its body.
CREATE FUNCTION refuse_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
--> statement-breakpoint

-- The schema of pg-boss, the worker's job queue (ADR 0002, ADR 0003). pg-boss runs as the queue
-- role mizan_queue, which reaches no other schema. It installs, migrates and owns its own tables
-- here at start (with createSchema off, so it needs no database-level CREATE); they are not
-- Drizzle's. The owner role keeps the schema itself.
CREATE SCHEMA pgboss;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA pgboss TO mizan_queue;
