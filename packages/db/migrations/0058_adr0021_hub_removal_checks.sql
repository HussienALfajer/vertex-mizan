-- ADR 0021: Mizan without Hub. Hub's tables are dropped in 0060 only while they hold no row
-- (owner, 2026-11-13); this migration refuses to run otherwise, so a company's Hub data is never
-- lost by a deploy. The company tables are counted in each company's context, since forced RLS
-- hides their rows from the owner outside it (ADR 0003). The previous release does not run on the
-- migrated database (owner, 2026-11-13: the removal in one release; docs/deployment.md).
DO $$
DECLARE
  company uuid;
  hub_table text;
  found bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM public.api_clients) OR EXISTS (SELECT 1 FROM public.api_client_keys) THEN
    RAISE EXCEPTION 'ADR 0021: api_clients or api_client_keys hold rows; Hub''s tables are dropped only while empty'
      USING ERRCODE = 'restrict_violation';
  END IF;
  FOR company IN SELECT c.id FROM public.companies c ORDER BY c.id LOOP
    PERFORM set_config('app.company_id', company::text, true);
    FOREACH hub_table IN ARRAY ARRAY[
      'posting_rule_accounts',
      'inbound_events',
      'inbound_event_states',
      'inbound_event_actions',
      'recognition_schedules',
      'recognition_movements',
      'document_sources',
      'reconciliation_reports',
      'reconciliation_report_events',
      'opening_snapshots',
      'opening_record_figures'
    ] LOOP
      EXECUTE format('SELECT count(*) FROM public.%I', hub_table) INTO found;
      IF found > 0 THEN
        RAISE EXCEPTION 'ADR 0021: % holds % rows of company %; Hub''s tables are dropped only while empty',
          hub_table, found, company
          USING ERRCODE = 'restrict_violation';
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.company_id', '', true);
END
$$;
--> statement-breakpoint

-- The held events' digest (S05) left with the inbox: an email still queued is never sent, so the
-- outbox's check can drop its kind (0059).
DELETE FROM public.email_outbox WHERE kind = 'held_digest';
--> statement-breakpoint

-- S10's guards without Hub's snapshot: the books start is locked once the company has an entry or
-- an opening, and an opening posts and reverses without a snapshot (pinned in `GUARDS`).
CREATE OR REPLACE FUNCTION public.company_settings_books_start() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.books_start IS DISTINCT FROM OLD.books_start AND (
    NEW.books_start IS NULL
    OR OLD.books_started_at IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM public.openings o WHERE o.company_id = OLD.company_id
    )
  ) THEN
    RAISE EXCEPTION 'company_settings: the books start of company % is locked: BOOKS_START_LOCKED',
      OLD.company_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.opening_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  books_start date;
  entry record;
BEGIN
  SELECT s.books_start INTO books_start
  FROM public.company_settings s
  WHERE s.company_id = NEW.company_id
  FOR SHARE;
  IF books_start IS NULL THEN
    RAISE EXCEPTION 'openings: an opening is made in a company with a books start: NO_BOOKS_START'
      USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'openings: an opening is made a draft at its first version'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.created_at)
  THEN
    RAISE EXCEPTION 'openings: an opening keeps its id, company and creation'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.state = 'draft' AND NEW.state = 'draft' THEN
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'openings: a save adds one to the version of opening %', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'draft' AND NEW.state = 'posted' THEN
    SELECT e.source, e.reverses_entry_id, e.entry_date, e.created_at INTO entry
    FROM public.journal_entries e
    WHERE e.company_id = NEW.company_id AND e.id = NEW.entry_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'openings: opening % is posted with its entry', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.version <> OLD.version OR NEW.prepared_by_user_id <> OLD.prepared_by_user_id
      OR entry.source IS DISTINCT FROM 'opening' OR entry.reverses_entry_id IS NOT NULL
      OR entry.entry_date <> books_start OR entry.created_at <> now() THEN
      RAISE EXCEPTION 'openings: opening % is posted as the opening entry of this transaction',
        OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'posted' AND NEW.state = 'reversed' THEN
    SELECT e.reverses_entry_id, e.created_at INTO entry
    FROM public.journal_entries e
    WHERE e.company_id = NEW.company_id AND e.id = NEW.reversal_entry_id;
    IF NOT FOUND
      OR (NEW.version, NEW.entry_id, NEW.prepared_by_user_id, NEW.posted_by_user_id, NEW.posted_at,
        NEW.fingerprint)
        IS DISTINCT FROM (OLD.version, OLD.entry_id, OLD.prepared_by_user_id, OLD.posted_by_user_id,
          OLD.posted_at, OLD.fingerprint)
      OR entry.reverses_entry_id IS DISTINCT FROM OLD.entry_id OR entry.created_at <> now()
      OR EXISTS (
        SELECT 1 FROM public.journal_entries e
        WHERE e.company_id = NEW.company_id AND e.id NOT IN (OLD.entry_id, NEW.reversal_entry_id)
      ) THEN
      RAISE EXCEPTION 'openings: opening % is reversed whole while its entry is the only one: OPENING_NOT_REVERSIBLE',
        OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'openings: opening % does not go from % to %', OLD.id, OLD.state, NEW.state
    USING ERRCODE = 'restrict_violation';
END
$$;
