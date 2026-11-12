-- The guards and grants of S08's daily reconciliation (0043), as packages/db/CLAUDE.md and the
-- /db-migration skill write them (ADR 0003, ADR 0005, ADR 0008, ADR 0017):
-- - forced RLS with the one company_isolation policy on reconciliation_reports and
--   reconciliation_report_events;
-- - both are append-only: SELECT, INSERT for the app role, refuse_change() for every role;
-- - a report holds exactly the events it counts, at commit: an event added later, or a report
--   stored without its events, fails (reconciliation_report_complete(), deferred);
-- - a client's reconciliation start date is never cleared once set (S08 rule 13,
--   api_client_reconcile_from_rules()); it is backfilled here, for the clients that hold
--   events:write or reconciliation:write, to the date of their creation in Asia/Damascus (S08
--   "Data"), before 0045 adds the check that requires it.
-- Every trigger is ENABLE ALWAYS (ADR 0008); every guard function is pinned in test/conventions.ts
-- and names its tables with the schema. Nothing is granted to mizan_jobs, mizan_queue or PUBLIC; no
-- function is SECURITY DEFINER. No ledger row, rate or audit row changes.
ALTER TABLE reconciliation_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reconciliation_reports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON reconciliation_reports
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE reconciliation_report_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reconciliation_report_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON reconciliation_report_events
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON reconciliation_reports, reconciliation_report_events FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON reconciliation_reports, reconciliation_report_events TO mizan_app;
--> statement-breakpoint
CREATE TRIGGER reconciliation_reports_refuse_change BEFORE UPDATE OR DELETE
  ON reconciliation_reports FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER reconciliation_reports_refuse_truncate BEFORE TRUNCATE ON reconciliation_reports
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE reconciliation_reports ENABLE ALWAYS TRIGGER reconciliation_reports_refuse_change;
--> statement-breakpoint
ALTER TABLE reconciliation_reports ENABLE ALWAYS TRIGGER reconciliation_reports_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER reconciliation_report_events_refuse_change BEFORE UPDATE OR DELETE
  ON reconciliation_report_events FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER reconciliation_report_events_refuse_truncate BEFORE TRUNCATE
  ON reconciliation_report_events FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE reconciliation_report_events
  ENABLE ALWAYS TRIGGER reconciliation_report_events_refuse_change;
--> statement-breakpoint
ALTER TABLE reconciliation_report_events
  ENABLE ALWAYS TRIGGER reconciliation_report_events_refuse_truncate;
--> statement-breakpoint
-- A report holds exactly the events it counts when its transaction commits (S08 rules 1, 4): the
-- comparison reads the stored list, so a report cut short, or an event slipped into a stored
-- report, would hide or invent a gap. Checked from both tables; a report it cannot see fails.
CREATE FUNCTION reconciliation_report_complete() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  report_row_id uuid;
  expected integer;
  listed integer;
BEGIN
  IF TG_TABLE_NAME = 'reconciliation_reports' THEN
    report_row_id := NEW.id;
  ELSE
    report_row_id := NEW.report_id;
  END IF;
  SELECT r.event_count INTO expected
  FROM public.reconciliation_reports r
  WHERE r.company_id = NEW.company_id AND r.id = report_row_id;
  SELECT count(*) INTO listed
  FROM public.reconciliation_report_events e
  WHERE e.company_id = NEW.company_id AND e.report_id = report_row_id;
  IF expected IS NULL OR listed <> expected THEN
    RAISE EXCEPTION 'reconciliation report % lists % events, not the % it counts',
      report_row_id, listed, coalesce(expected::text, 'unknown')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER reconciliation_reports_complete AFTER INSERT ON reconciliation_reports
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconciliation_report_complete();
--> statement-breakpoint
ALTER TABLE reconciliation_reports ENABLE ALWAYS TRIGGER reconciliation_reports_complete;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER reconciliation_report_events_complete
  AFTER INSERT ON reconciliation_report_events
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconciliation_report_complete();
--> statement-breakpoint
ALTER TABLE reconciliation_report_events
  ENABLE ALWAYS TRIGGER reconciliation_report_events_complete;
--> statement-breakpoint
-- S08 "Data": every existing client that posts or reports gets its start date, the day it was
-- created in Damascus (synthetic clients only, before production; Vertex Media's client is created
-- with 2026-10-19, S08 rule 13).
UPDATE public.api_clients
SET reconcile_from = (created_at AT TIME ZONE 'Asia/Damascus')::date,
    updated_at = now()
WHERE reconcile_from IS NULL
  AND scopes && array['events:write', 'reconciliation:write']::text[];
--> statement-breakpoint
-- A start date is never cleared (S08 rule 13): removing a scope does not take a client out of the
-- reconciliation, so the close cannot pass by hiding its days. Moving it is the API's rule
-- (RECONCILIATION_START_LOCKED), under the company's lock that the close takes too.
CREATE FUNCTION api_client_reconcile_from_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.reconcile_from IS NOT NULL AND NEW.reconcile_from IS NULL THEN
    RAISE EXCEPTION 'api_clients: a reconciliation start date is never cleared'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER api_client_reconcile_from_rules BEFORE UPDATE ON api_clients
  FOR EACH ROW EXECUTE FUNCTION api_client_reconcile_from_rules();
--> statement-breakpoint
ALTER TABLE api_clients ENABLE ALWAYS TRIGGER api_client_reconcile_from_rules;
