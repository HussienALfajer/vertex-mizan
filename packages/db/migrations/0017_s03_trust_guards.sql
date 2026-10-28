-- The guards and grants of S03's trust module (0016), as packages/db/CLAUDE.md and the
-- /db-migration skill write them (ADR 0003, ADR 0005, ADR 0008):
-- - forced RLS with the one company_isolation policy on both tables, for every role;
-- - chain_anchors is append-only: refuse_change() for every role; an anchor is the company's chain
--   head at the end of a day in Damascus, as the chain stores it;
-- - company_exports is a queue: queued, then ready or failed; a ready one expires once past its
--   time; its file, size and digest never change; the app role never deletes;
-- - the jobs role's first grants and policies (ADR 0003: its own policies, on the few tables a
--   migration grants it, SELECT and INSERT only, by column where it reads): to anchor every
--   company's chain each day and email the owners in one transaction (the head columns of
--   journal_entries, the anchors, the owners' memberships, their email addresses and company
--   names, and the email outbox), and to find the exports to build or expire across companies,
--   which the app role then works inside each company's context. The convention test pins them.
-- Every trigger is ENABLE ALWAYS (ADR 0008); every guard function is pinned in test/conventions.ts
-- and names its tables with the schema. Nothing is granted to mizan_queue or PUBLIC; no function is
-- SECURITY DEFINER.
ALTER TABLE chain_anchors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chain_anchors FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON chain_anchors
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE company_exports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_exports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON company_exports
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON chain_anchors, company_exports FROM PUBLIC;
--> statement-breakpoint
-- The app role reads the anchors (the integrity check) and works the exports of its company.
GRANT SELECT ON chain_anchors TO mizan_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON company_exports TO mizan_app;
--> statement-breakpoint
CREATE TRIGGER chain_anchors_refuse_change BEFORE UPDATE OR DELETE ON chain_anchors
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER chain_anchors_refuse_truncate BEFORE TRUNCATE ON chain_anchors
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE chain_anchors ENABLE ALWAYS TRIGGER chain_anchors_refuse_change;
--> statement-breakpoint
ALTER TABLE chain_anchors ENABLE ALWAYS TRIGGER chain_anchors_refuse_truncate;
--> statement-breakpoint
-- An anchor (S03 rule 20) is the head of its company's chain at the end of a day in Damascus, not
-- a later one: its entry is the one at its count, with its hash, posted before the day's end, and no
-- later entry of the chain was posted before then. The job anchors only days that have ended, so
-- no entry can still be posted on them; posted entries never change, so it stays true.
CREATE FUNCTION chain_anchor_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  day_end timestamptz := (NEW.anchored_on + 1)::timestamp AT TIME ZONE 'Asia/Damascus';
BEGIN
  IF NEW.anchored_on > (now() AT TIME ZONE 'Asia/Damascus')::date THEN
    RAISE EXCEPTION 'chain_anchors: the day % has not begun in Damascus', NEW.anchored_on
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.company_id = NEW.company_id AND e.id = NEW.head_entry_id
      AND e.sequence = NEW.entry_count AND e.hash = NEW.head_hash AND e.posted_at < day_end
  ) OR EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.company_id = NEW.company_id AND e.sequence > NEW.entry_count
      AND e.posted_at < day_end
  ) THEN
    RAISE EXCEPTION 'chain_anchors: not the head of the chain at the end of %', NEW.anchored_on
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER chain_anchors_rules BEFORE INSERT ON chain_anchors
  FOR EACH ROW EXECUTE FUNCTION chain_anchor_rules();
--> statement-breakpoint
ALTER TABLE chain_anchors ENABLE ALWAYS TRIGGER chain_anchors_rules;
--> statement-breakpoint
-- An export (S03 rule 21) is requested `queued`. It becomes `ready` with its file or `failed` with
-- its error, once; a ready one becomes `expired` once past its time, keeping its file's key, size
-- and digest as a record. Failed and expired ones never change; who asked and when never change.
CREATE FUNCTION company_export_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'queued' THEN
      RAISE EXCEPTION 'company_exports: an export is requested queued'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.requested_by_user_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.requested_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'company_exports: an export keeps its identity'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.state, NEW.state) NOT IN (('queued', 'queued'), ('queued', 'ready'),
                                    ('queued', 'failed'), ('ready', 'expired')) THEN
    RAISE EXCEPTION 'company_exports: % to % refused', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'ready' AND (
    (NEW.storage_key, NEW.size_bytes, NEW.sha256, NEW.expires_at)
      IS DISTINCT FROM (OLD.storage_key, OLD.size_bytes, OLD.sha256, OLD.expires_at)
    OR OLD.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'company_exports: a ready export expires only past its time, as it was'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER company_exports_rules BEFORE INSERT OR UPDATE ON company_exports
  FOR EACH ROW EXECUTE FUNCTION company_export_rules();
--> statement-breakpoint
ALTER TABLE company_exports ENABLE ALWAYS TRIGGER company_exports_rules;
--> statement-breakpoint
-- The jobs role (ADR 0003): the daily anchor reads each company's chain head and owners and writes
-- the anchors and the owners' emails in one transaction.
GRANT SELECT (company_id, id, sequence, hash, posted_at) ON journal_entries TO mizan_jobs;
--> statement-breakpoint
CREATE POLICY jobs_find_heads ON journal_entries FOR SELECT TO mizan_jobs USING (true);
--> statement-breakpoint
GRANT SELECT (company_id, anchored_on) ON chain_anchors TO mizan_jobs;
--> statement-breakpoint
GRANT INSERT ON chain_anchors TO mizan_jobs;
--> statement-breakpoint
CREATE POLICY jobs_find_anchors ON chain_anchors FOR SELECT TO mizan_jobs USING (true);
--> statement-breakpoint
CREATE POLICY jobs_write_anchors ON chain_anchors FOR INSERT TO mizan_jobs WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT (id, name) ON companies TO mizan_jobs;
--> statement-breakpoint
GRANT SELECT (user_id, scope_company_id, role, archived_at) ON memberships TO mizan_jobs;
--> statement-breakpoint
GRANT SELECT (id, email, archived_at) ON users TO mizan_jobs;
--> statement-breakpoint
GRANT INSERT (id, kind, recipient, data) ON email_outbox TO mizan_jobs;
--> statement-breakpoint
-- The export jobs find the exports to build or expire; the app role works each in its company.
GRANT SELECT (company_id, id, state, expires_at) ON company_exports TO mizan_jobs;
--> statement-breakpoint
CREATE POLICY jobs_find_exports ON company_exports FOR SELECT TO mizan_jobs USING (true);
