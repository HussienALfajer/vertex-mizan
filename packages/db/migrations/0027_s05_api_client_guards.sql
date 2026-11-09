-- The guards and grants of S05's API clients (0026), as packages/db/CLAUDE.md and the
-- /db-migration skill write them (ADR 0003, ADR 0006, ADR 0008):
-- - the clients and their keys (platform, business): SELECT, INSERT, UPDATE for the app role,
--   never deleted (refuse_delete()), so a revoked key is kept;
-- - a client never moves to another company or system (api_client_rules());
-- - a key is created active, for a client that is not archived of a company that is not archived
--   (S01 rule 12), at most two active per client (S05 rule 19, API_KEY_LIMIT; the client's row is
--   locked first, so two keys created at once cannot both pass); afterwards it changes only by its
--   use and its revocation, and a revoked key never changes again (api_client_key_rules());
-- - the document sources (company, business): forced RLS with the one company_isolation policy,
--   SELECT, INSERT, UPDATE for the app role, never deleted; a source names a client of its own
--   company, an active source a client that is not archived, and its type never changes
--   (document_source_rules()).
-- Every trigger is ENABLE ALWAYS (ADR 0008); the guard functions are pinned in
-- test/conventions.ts and name their tables with the schema. Nothing is granted to mizan_jobs,
-- mizan_queue or PUBLIC; no function is SECURITY DEFINER. No row exists yet: the document sources
-- arrive with a company's first client (S05 "Migration and compatibility").
REVOKE ALL ON api_clients, api_client_keys, document_sources FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON api_clients, api_client_keys, document_sources TO mizan_app;
--> statement-breakpoint
ALTER TABLE document_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE document_sources FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON document_sources
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
-- Clients, keys and sources are archived or revoked, never deleted.
CREATE TRIGGER api_clients_refuse_delete BEFORE DELETE ON api_clients
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER api_clients_refuse_truncate BEFORE TRUNCATE ON api_clients
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE api_clients ENABLE ALWAYS TRIGGER api_clients_refuse_delete;
--> statement-breakpoint
ALTER TABLE api_clients ENABLE ALWAYS TRIGGER api_clients_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER api_client_keys_refuse_delete BEFORE DELETE ON api_client_keys
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER api_client_keys_refuse_truncate BEFORE TRUNCATE ON api_client_keys
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE api_client_keys ENABLE ALWAYS TRIGGER api_client_keys_refuse_delete;
--> statement-breakpoint
ALTER TABLE api_client_keys ENABLE ALWAYS TRIGGER api_client_keys_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER document_sources_refuse_delete BEFORE DELETE ON document_sources
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER document_sources_refuse_truncate BEFORE TRUNCATE ON document_sources
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE document_sources ENABLE ALWAYS TRIGGER document_sources_refuse_delete;
--> statement-breakpoint
ALTER TABLE document_sources ENABLE ALWAYS TRIGGER document_sources_refuse_truncate;
--> statement-breakpoint
-- A client belongs to one company and one system for good: its keys and the company's document
-- sources name it.
CREATE FUNCTION api_client_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.id, NEW.scope_company_id, NEW.system, NEW.created_by_user_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.scope_company_id, OLD.system, OLD.created_by_user_id,
      OLD.created_at) THEN
    RAISE EXCEPTION 'api_clients: a client never moves to another company or system'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER api_client_rules BEFORE UPDATE ON api_clients
  FOR EACH ROW EXECUTE FUNCTION api_client_rules();
--> statement-breakpoint
ALTER TABLE api_clients ENABLE ALWAYS TRIGGER api_client_rules;
--> statement-breakpoint
-- A key (S05 rules 19–20, S01 rule 12): created active for a client that is not archived, of a
-- company that is not archived, at most two active per client; its secret, prefix, client and
-- creation never change; a revoked key never changes again.
CREATE FUNCTION api_client_key_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  client record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.api_client_id, NEW.scope_company_id, NEW.prefix, NEW.secret_hash,
        NEW.created_by_user_id, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.api_client_id, OLD.scope_company_id, OLD.prefix,
        OLD.secret_hash, OLD.created_by_user_id, OLD.created_at) THEN
      RAISE EXCEPTION 'api_client_keys: a key changes only by its use and its revocation'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.revoked_at IS NOT NULL
      AND (NEW.revoked_at, NEW.revoked_by_user_id, NEW.revoke_reason, NEW.last_used_at,
        NEW.last_used_ip, NEW.archived_at)
      IS DISTINCT FROM (OLD.revoked_at, OLD.revoked_by_user_id, OLD.revoke_reason,
        OLD.last_used_at, OLD.last_used_ip, OLD.archived_at) THEN
      RAISE EXCEPTION 'api_client_keys: key % is revoked and never changes again', OLD.prefix
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.revoked_at IS NOT NULL OR NEW.last_used_at IS NOT NULL THEN
    RAISE EXCEPTION 'api_client_keys: a key is created active and unused'
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- The client's row first, so two keys created at once count each other.
  SELECT c.archived_at, co.archived_at AS company_archived_at INTO client
  FROM public.api_clients c
  JOIN public.companies co ON co.id = c.scope_company_id
  WHERE c.id = NEW.api_client_id AND c.scope_company_id = NEW.scope_company_id
  FOR UPDATE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'api_client_keys: a key belongs to a client of its company'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF client.archived_at IS NOT NULL OR client.company_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'api_client_keys: an archived client or company gets no key'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (SELECT count(*) FROM public.api_client_keys k
      WHERE k.scope_company_id = NEW.scope_company_id AND k.api_client_id = NEW.api_client_id
        AND k.revoked_at IS NULL) >= 2 THEN
    RAISE EXCEPTION 'api_client_keys: a client has at most two active keys'
      USING ERRCODE = 'restrict_violation', HINT = 'API_KEY_LIMIT';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER api_client_key_rules BEFORE INSERT OR UPDATE ON api_client_keys
  FOR EACH ROW EXECUTE FUNCTION api_client_key_rules();
--> statement-breakpoint
ALTER TABLE api_client_keys ENABLE ALWAYS TRIGGER api_client_key_rules;
--> statement-breakpoint
-- A document type's source (S05 rule 21): a client of the source's own company, one that is not
-- archived while the source is active; a source moves to another client or to none (archived),
-- never to another type or company.
CREATE FUNCTION document_source_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  client record;
BEGIN
  IF TG_OP = 'UPDATE'
    AND (NEW.id, NEW.company_id, NEW.document_type, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.document_type, OLD.created_at) THEN
    RAISE EXCEPTION 'document_sources: a source moves to another client, not to another type'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT c.archived_at INTO client
  FROM public.api_clients c
  WHERE c.id = NEW.api_client_id AND c.scope_company_id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_sources: a source is a client of its company'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.archived_at IS NULL AND client.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'document_sources: an archived client is no source'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER document_source_rules BEFORE INSERT OR UPDATE ON document_sources
  FOR EACH ROW EXECUTE FUNCTION document_source_rules();
--> statement-breakpoint
ALTER TABLE document_sources ENABLE ALWAYS TRIGGER document_source_rules;
