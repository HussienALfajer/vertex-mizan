-- The guards and grants of S07's periods and close (0040), as packages/db/CLAUDE.md and the
-- /db-migration skill write them (ADR 0003, ADR 0005, ADR 0008, ADR 0016):
-- - forced RLS with the one company_isolation policy on period_events;
-- - period_events are append-only: SELECT, INSERT for the app role, refuse_change() for every role;
--   an event is inserted at its transaction's time, with the ledger head's sequence, from a state
--   its kind leaves (a close from open or reopened, a reopen from closed), at most one per period
--   and transaction;
-- - a period changes only its state, `open → closed`, `closed → reopened` or `reopened → closed`:
--   a close only once every earlier month of the company has its row and is closed, a reopen only
--   of the latest closed month (S07 rules 2, 3); a period is not made before the company's first
--   while a month is closed (rule 4); period_rules() is replaced in place, with its new pin;
-- - a period's state is its latest event's, or open without one, at commit, checked from both
--   tables (deferred), so no transition happens without its event and no event without its
--   transition;
-- - an entry posts into an open or reopened period, never a closed one (S07 rule 1):
--   journal_entry_rules() is replaced in place, with its new pin.
-- No existing row changes: every period is open and has no event. Every trigger is ENABLE ALWAYS
-- (ADR 0008); every guard function is pinned in test/conventions.ts and names its tables with the
-- schema. Locks follow one order: the ledger head, then the period. Nothing is granted to
-- mizan_jobs, mizan_queue or PUBLIC; no function is SECURITY DEFINER.
ALTER TABLE period_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE period_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON period_events
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON period_events FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON period_events TO mizan_app;
--> statement-breakpoint
CREATE TRIGGER period_events_refuse_change BEFORE UPDATE OR DELETE ON period_events
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER period_events_refuse_truncate BEFORE TRUNCATE ON period_events
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE period_events ENABLE ALWAYS TRIGGER period_events_refuse_change;
--> statement-breakpoint
ALTER TABLE period_events ENABLE ALWAYS TRIGGER period_events_refuse_truncate;
--> statement-breakpoint
-- A period event as it is inserted (S07 rules 2, 3, 9): at its transaction's time, with the ledger
-- head's sequence, from a state its kind leaves, and the only event of its period in its
-- transaction.
CREATE FUNCTION period_event_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  period_state text;
  head_sequence bigint;
BEGIN
  SELECT p.state INTO period_state
  FROM public.periods p
  WHERE p.company_id = NEW.company_id AND p.id = NEW.period_id;
  SELECT h.entry_count INTO head_sequence
  FROM public.ledger_heads h
  WHERE h.company_id = NEW.company_id;
  IF period_state IS NULL OR head_sequence IS NULL
    OR NEW.head_sequence IS DISTINCT FROM head_sequence
    OR NEW.created_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'period_events: an event of a period at its transaction time and head'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.kind = 'closed' AND period_state NOT IN ('open', 'reopened'))
    OR (NEW.kind = 'reopened' AND period_state <> 'closed') THEN
    RAISE EXCEPTION 'period_events: a % event from a period that is %', NEW.kind, period_state
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.period_events e
    WHERE e.company_id = NEW.company_id AND e.period_id = NEW.period_id
      AND e.created_at = now()
  ) THEN
    RAISE EXCEPTION 'period_events: one event of a period per transaction'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER period_event_rules BEFORE INSERT ON period_events
  FOR EACH ROW EXECUTE FUNCTION period_event_rules();
--> statement-breakpoint
ALTER TABLE period_events ENABLE ALWAYS TRIGGER period_event_rules;
--> statement-breakpoint
-- A period (ADR 0005 invariant 4, S07 rules 1–4): made open, in the fiscal year of its month under
-- the company's fiscal year start, and not before the company's first period while a month is
-- closed; then only its state changes, in the transitions S07 allows: a close once every earlier
-- month has its row and is closed, a reopen of the latest closed month only.
CREATE OR REPLACE FUNCTION period_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  start_month smallint;
  first_period text;
  earlier integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.company_id, NEW.period, NEW.fiscal_year, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.period, OLD.fiscal_year, OLD.created_at)
      OR (OLD.state, NEW.state) NOT IN (('open', 'closed'), ('closed', 'reopened'),
        ('reopened', 'closed')) THEN
      RAISE EXCEPTION 'periods: period % changes only its state, from % to closed or reopened',
        OLD.period, OLD.state
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state = 'closed' THEN
      SELECT min(p.period), count(*) INTO first_period, earlier
      FROM public.periods p
      WHERE p.company_id = NEW.company_id AND p.period < NEW.period;
      IF earlier > 0 AND (
        earlier <> (left(NEW.period, 4)::integer * 12 + right(NEW.period, 2)::integer)
          - (left(first_period, 4)::integer * 12 + right(first_period, 2)::integer)
        OR EXISTS (
          SELECT 1 FROM public.periods p
          WHERE p.company_id = NEW.company_id AND p.period < NEW.period AND p.state <> 'closed'
        )) THEN
        RAISE EXCEPTION 'periods: period % closes after every earlier month', NEW.period
          USING ERRCODE = 'restrict_violation';
      END IF;
    ELSIF EXISTS (
      SELECT 1 FROM public.periods p
      WHERE p.company_id = NEW.company_id AND p.period > NEW.period AND p.state = 'closed'
    ) THEN
      RAISE EXCEPTION 'periods: period % reopens only as the latest closed month', NEW.period
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT s.fiscal_year_start_month INTO start_month
  FROM public.company_settings s
  WHERE s.company_id = NEW.company_id;
  IF NOT FOUND OR NEW.state <> 'open'
    OR NEW.fiscal_year <> left(NEW.period, 4)::integer
      - (CASE WHEN right(NEW.period, 2)::integer >= start_month THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'periods: period % is made open, in the fiscal year of its month', NEW.period
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.periods p
    WHERE p.company_id = NEW.company_id AND p.state = 'closed'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.periods p
    WHERE p.company_id = NEW.company_id AND p.period < NEW.period
  ) THEN
    RAISE EXCEPTION 'periods: period % is before the first period while a month is closed',
      NEW.period
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- A period's state is its latest event's, or open without one, when its transaction commits
-- (S07 "Data"): checked after every change of a period and every event, so a transition needs its
-- event and an event its transition.
CREATE FUNCTION period_history_agrees() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  target uuid;
  period_state text;
  latest text;
BEGIN
  IF TG_TABLE_NAME = 'periods' THEN
    target := NEW.id;
  ELSE
    target := NEW.period_id;
  END IF;
  SELECT p.state INTO period_state
  FROM public.periods p
  WHERE p.company_id = NEW.company_id AND p.id = target;
  SELECT e.kind INTO latest
  FROM public.period_events e
  WHERE e.company_id = NEW.company_id AND e.period_id = target
  ORDER BY e.created_at DESC
  LIMIT 1;
  IF period_state IS NULL
    OR (latest IS NULL AND period_state <> 'open')
    OR (latest IS NOT NULL AND latest IS DISTINCT FROM period_state) THEN
    RAISE EXCEPTION 'periods: a period''s state is its latest event''s'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER periods_history_agrees AFTER UPDATE ON periods
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION period_history_agrees();
--> statement-breakpoint
ALTER TABLE periods ENABLE ALWAYS TRIGGER periods_history_agrees;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER period_events_history_agrees AFTER INSERT ON period_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION period_history_agrees();
--> statement-breakpoint
ALTER TABLE period_events ENABLE ALWAYS TRIGGER period_events_history_agrees;
--> statement-breakpoint
-- An entry as it is inserted (ADR 0005 invariants 4 and 6, ADR 0008, ADR 0012), as 0012 wrote it,
-- with S07's reopened period posting as an open one: its date is in a period that is not closed,
-- read FOR SHARE, so a close waits for the posting or the posting for the close.
CREATE OR REPLACE FUNCTION journal_entry_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  head record;
  settings record;
  period_state text;
BEGIN
  SELECT h.entry_count, h.last_hash INTO head
  FROM public.ledger_heads h
  WHERE h.company_id = NEW.company_id;
  IF NOT FOUND OR NEW.sequence IS DISTINCT FROM head.entry_count + 1
    OR NEW.previous_hash IS DISTINCT FROM head.last_hash THEN
    RAISE EXCEPTION 'journal_entries: an entry follows the head of its company''s chain'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.entry_number_counters c
    WHERE c.company_id = NEW.company_id AND c.fiscal_year = NEW.fiscal_year
      AND c.last_number = NEW.number
  ) THEN
    RAISE EXCEPTION 'journal_entries: entry % takes the number its counter has just given',
      NEW.number
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT s.fiscal_year_start_month, s.books_started_at INTO settings
  FROM public.company_settings s
  WHERE s.company_id = NEW.company_id;
  IF NOT FOUND OR settings.books_started_at IS NULL
    OR NEW.fiscal_year <> extract(year FROM NEW.entry_date)::integer
      - (CASE WHEN extract(month FROM NEW.entry_date) >= settings.fiscal_year_start_month
          THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'journal_entries: an entry is numbered in the fiscal year of its date, in started books'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.posted_at IS DISTINCT FROM date_trunc('milliseconds', now()) THEN
    RAISE EXCEPTION 'journal_entries: an entry is posted at its transaction time'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT p.state INTO period_state
  FROM public.periods p
  WHERE p.company_id = NEW.company_id AND p.period = to_char(NEW.entry_date, 'YYYY-MM')
  FOR SHARE;
  IF NOT FOUND OR period_state NOT IN ('open', 'reopened') THEN
    RAISE EXCEPTION 'journal_entries: an entry dated % is in an open period', NEW.entry_date
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
