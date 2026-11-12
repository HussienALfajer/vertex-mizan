-- The guards and grants of S10's opening balances (0052), as packages/db/CLAUDE.md and the
-- /db-migration skill write them (ADR 0003, ADR 0005, ADR 0008, ADR 0019):
-- - forced RLS with the one company_isolation policy on the four opening tables;
-- - opening_snapshots, opening_lines and opening_record_figures are append-only: SELECT, INSERT
--   for the app role, refuse_change() for every role; openings is a draft: SELECT, INSERT, UPDATE,
--   refuse_delete() for every role, its states held by opening_rules();
-- - a snapshot is as of the eve of the books start, and none arrives once the opening is posted
--   (opening_snapshot_rules(), S10 rules 5, 8);
-- - an opening's lines and figures are written only by the save of their version, while it is a
--   draft (opening_version_rules());
-- - the books start: the first day of a month (a check in 0052), locked once the company has an
--   entry, a snapshot or an opening, never cleared (company_settings_books_start(), rule 2);
-- - nothing but the opening posts, and no month closes, until the opening is posted; nothing is
--   dated before the books start, and no period is made before it (journal_entry_opening_rules(),
--   period_rules(), rules 3–4); an opening entry has its opening at commit
--   (journal_entry_opening_recorded(), deferred);
-- - a stated line only on an entry whose source is opening (journal_line_rules(), ADR 0019);
-- - a schedule from an opening, and before_opening movements only on one
--   (recognition_schedule_rules(), recognition_movement_rules(), rule 13);
-- - a document item's reference unique on its account among the items standing, since 0054 keeps
--   an opening's items unique per opening entry (open_item_reference_rules(), rule 25);
-- - the role pre_opening_result on an equity account (account_role_rules(), chart_account_rules());
-- - an opening item the accountant opened, with no Hub document, moved by a manual entry as a
--   manual item, not adjusted (open_item_movement_rules(), rule 12; opening/opening-entry.md).
-- Every trigger is ENABLE ALWAYS (ADR 0008); every guard function is pinned in test/conventions.ts
-- and names its tables with the schema. Nothing is granted to mizan_jobs, mizan_queue or PUBLIC; no
-- function is SECURITY DEFINER. No ledger row, rate or audit row changes. The template account
-- 312002 with its role reaches existing companies at the worker's start
-- (addPreOpeningResultAccount()), since the role added to account_role in 0052 cannot be used in
-- the migrations' transaction.
ALTER TABLE opening_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE opening_snapshots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON opening_snapshots
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE openings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE openings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON openings
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE opening_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE opening_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON opening_lines
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE opening_record_figures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE opening_record_figures FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON opening_record_figures
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON opening_snapshots, openings, opening_lines, opening_record_figures FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON opening_snapshots, opening_lines, opening_record_figures TO mizan_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON openings TO mizan_app;
--> statement-breakpoint
CREATE TRIGGER opening_snapshots_refuse_change BEFORE UPDATE OR DELETE
  ON opening_snapshots FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER opening_snapshots_refuse_truncate BEFORE TRUNCATE ON opening_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE opening_snapshots ENABLE ALWAYS TRIGGER opening_snapshots_refuse_change;
--> statement-breakpoint
ALTER TABLE opening_snapshots ENABLE ALWAYS TRIGGER opening_snapshots_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER opening_lines_refuse_change BEFORE UPDATE OR DELETE
  ON opening_lines FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER opening_lines_refuse_truncate BEFORE TRUNCATE ON opening_lines
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE opening_lines ENABLE ALWAYS TRIGGER opening_lines_refuse_change;
--> statement-breakpoint
ALTER TABLE opening_lines ENABLE ALWAYS TRIGGER opening_lines_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER opening_record_figures_refuse_change BEFORE UPDATE OR DELETE
  ON opening_record_figures FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER opening_record_figures_refuse_truncate BEFORE TRUNCATE ON opening_record_figures
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE opening_record_figures ENABLE ALWAYS TRIGGER opening_record_figures_refuse_change;
--> statement-breakpoint
ALTER TABLE opening_record_figures ENABLE ALWAYS TRIGGER opening_record_figures_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER openings_refuse_delete BEFORE DELETE ON openings
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER openings_refuse_truncate BEFORE TRUNCATE ON openings
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE openings ENABLE ALWAYS TRIGGER openings_refuse_delete;
--> statement-breakpoint
ALTER TABLE openings ENABLE ALWAYS TRIGGER openings_refuse_truncate;
--> statement-breakpoint
-- The books start changes only while the company has no entry, no snapshot and no opening, and is
-- never cleared once set (S10 rule 2).
CREATE FUNCTION company_settings_books_start() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.books_start IS DISTINCT FROM OLD.books_start AND (
    NEW.books_start IS NULL
    OR OLD.books_started_at IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM public.opening_snapshots s WHERE s.company_id = OLD.company_id
    )
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
CREATE TRIGGER company_settings_books_start BEFORE UPDATE ON company_settings
  FOR EACH ROW EXECUTE FUNCTION company_settings_books_start();
--> statement-breakpoint
ALTER TABLE company_settings ENABLE ALWAYS TRIGGER company_settings_books_start;
--> statement-breakpoint
-- A snapshot is as of the eve of the company's books start, and none arrives once its opening is
-- posted (S10 rules 5, 8). The settings row is read FOR SHARE, so the books start cannot move under
-- it.
CREATE FUNCTION opening_snapshot_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  books_start date;
BEGIN
  SELECT s.books_start INTO books_start
  FROM public.company_settings s
  WHERE s.company_id = NEW.company_id
  FOR SHARE;
  IF books_start IS NULL OR NEW.as_of <> books_start - 1 THEN
    RAISE EXCEPTION 'opening_snapshots: a snapshot is as of the eve of the books start'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.openings o
    WHERE o.company_id = NEW.company_id AND o.state = 'posted'
  ) THEN
    RAISE EXCEPTION 'opening_snapshots: no snapshot once the opening is posted: OPENING_POSTED'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER opening_snapshot_rules BEFORE INSERT ON opening_snapshots
  FOR EACH ROW EXECUTE FUNCTION opening_snapshot_rules();
--> statement-breakpoint
ALTER TABLE opening_snapshots ENABLE ALWAYS TRIGGER opening_snapshot_rules;
--> statement-breakpoint
-- An opening's states (S10 rules 10, 16, 23, 25): made a draft at version 1 in a company with a
-- books start; a save adds one to its version; `draft → posted` names the opening entry posted in
-- this transaction, dated on the books start, and the latest snapshot when one exists;
-- `posted → reversed` names that entry's reversal, posted in this transaction while the two are the
-- company's only entries. Nothing else changes; `updated_at` is the time of its transaction, which
-- the lines of its version read.
CREATE FUNCTION opening_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  books_start date;
  entry record;
  latest uuid;
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
    IF NEW.state <> 'draft' OR NEW.version <> 1 OR NEW.snapshot_id IS NOT NULL THEN
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
    SELECT s.id INTO latest
    FROM public.opening_snapshots s
    WHERE s.company_id = NEW.company_id
    ORDER BY s.received_at DESC, s.id DESC
    LIMIT 1;
    IF NEW.version <> OLD.version OR NEW.prepared_by_user_id <> OLD.prepared_by_user_id
      OR entry.source IS DISTINCT FROM 'opening' OR entry.reverses_entry_id IS NOT NULL
      OR entry.entry_date <> books_start OR entry.created_at <> now()
      OR NEW.snapshot_id IS DISTINCT FROM latest THEN
      RAISE EXCEPTION 'openings: opening % is posted as the opening entry of this transaction, with the latest snapshot',
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
      OR (NEW.version, NEW.snapshot_id, NEW.entry_id, NEW.prepared_by_user_id, NEW.posted_by_user_id,
        NEW.posted_at, NEW.fingerprint)
        IS DISTINCT FROM (OLD.version, OLD.snapshot_id, OLD.entry_id, OLD.prepared_by_user_id,
          OLD.posted_by_user_id, OLD.posted_at, OLD.fingerprint)
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
--> statement-breakpoint
CREATE TRIGGER opening_rules BEFORE INSERT OR UPDATE ON openings
  FOR EACH ROW EXECUTE FUNCTION opening_rules();
--> statement-breakpoint
ALTER TABLE openings ENABLE ALWAYS TRIGGER opening_rules;
--> statement-breakpoint
-- An opening's lines and figures are written by the save that makes their version: the opening is
-- a draft, at that version, changed in this transaction (S10 rule 16).
CREATE FUNCTION opening_version_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  opening record;
BEGIN
  SELECT o.state, o.version, o.updated_at INTO opening
  FROM public.openings o
  WHERE o.company_id = NEW.company_id AND o.id = NEW.opening_id
  FOR SHARE;
  IF NOT FOUND OR opening.state <> 'draft' OR opening.version <> NEW.version
    OR opening.updated_at <> now() THEN
    RAISE EXCEPTION '%: a row is written by the save of its draft opening''s version', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER opening_lines_version BEFORE INSERT ON opening_lines
  FOR EACH ROW EXECUTE FUNCTION opening_version_rules();
--> statement-breakpoint
ALTER TABLE opening_lines ENABLE ALWAYS TRIGGER opening_lines_version;
--> statement-breakpoint
CREATE TRIGGER opening_record_figures_version BEFORE INSERT ON opening_record_figures
  FOR EACH ROW EXECUTE FUNCTION opening_version_rules();
--> statement-breakpoint
ALTER TABLE opening_record_figures ENABLE ALWAYS TRIGGER opening_record_figures_version;
--> statement-breakpoint
-- Before the opening is posted, in a company with a books start, only the opening posts (S10 rule
-- 3); nothing is dated before the books start (rule 4); an opening entry, or its reversal, is
-- dated on the books start.
CREATE FUNCTION journal_entry_opening_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  books_start date;
BEGIN
  SELECT s.books_start INTO books_start
  FROM public.company_settings s
  WHERE s.company_id = NEW.company_id;
  IF NEW.source = 'opening' AND (books_start IS NULL OR NEW.entry_date <> books_start) THEN
    RAISE EXCEPTION 'journal_entries: an opening entry is dated on the books start'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF books_start IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.entry_date < books_start THEN
    RAISE EXCEPTION 'journal_entries: an entry dated % is before the books start %', NEW.entry_date,
      books_start
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.source <> 'opening' AND NOT EXISTS (
    SELECT 1 FROM public.openings o
    WHERE o.company_id = NEW.company_id AND o.state = 'posted'
  ) THEN
    RAISE EXCEPTION 'journal_entries: nothing posts before the opening: OPENING_NOT_POSTED'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entry_opening_rules BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entry_opening_rules();
--> statement-breakpoint
ALTER TABLE journal_entries ENABLE ALWAYS TRIGGER journal_entry_opening_rules;
--> statement-breakpoint
-- An opening entry has its opening at commit: posted (or reversed later) with it as its entry; its
-- reversal has the opening reversed with it as its reversal entry (S10 rules 23, 25).
CREATE FUNCTION journal_entry_opening_recorded() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.source <> 'opening' THEN
    RETURN NULL;
  END IF;
  IF NEW.reverses_entry_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.openings o
    WHERE o.company_id = NEW.company_id AND o.entry_id = NEW.id AND o.state IN ('posted', 'reversed')
  ) OR NEW.reverses_entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.openings o
    WHERE o.company_id = NEW.company_id AND o.reversal_entry_id = NEW.id
      AND o.entry_id = NEW.reverses_entry_id AND o.state = 'reversed'
  ) THEN
    RAISE EXCEPTION 'journal entry % is an opening entry without its opening', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_opening_recorded AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_opening_recorded();
--> statement-breakpoint
ALTER TABLE journal_entries ENABLE ALWAYS TRIGGER journal_entries_opening_recorded;
--> statement-breakpoint
-- A line as posted (S02 rule 8, S03), and a stated line only on an entry whose source is opening
-- (ADR 0019).
CREATE OR REPLACE FUNCTION journal_line_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  account record;
  entry record;
  settings record;
BEGIN
  SELECT a.kind, a.currency, a.first_posted_at INTO account
  FROM public.chart_accounts a
  WHERE a.company_id = NEW.company_id AND a.id = NEW.account_id
  FOR SHARE;
  IF NOT FOUND OR account.kind <> 'postable' OR account.first_posted_at IS NULL THEN
    RAISE EXCEPTION 'journal_lines: a line posts to a postable account marked as used'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF account.currency IS NOT NULL AND account.currency <> NEW.currency THEN
    RAISE EXCEPTION 'journal_lines: account % takes % lines, not %', NEW.account_id,
      account.currency, NEW.currency
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT e.entry_date, e.reverses_entry_id, e.source INTO entry
  FROM public.journal_entries e
  WHERE e.company_id = NEW.company_id AND e.id = NEW.entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal_lines: a line belongs to an entry of its company'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.kind = 'stated' AND entry.source <> 'opening' THEN
    RAISE EXCEPTION 'journal_lines: a stated line is only on an opening entry'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT s.book_currency, s.parallel_currency INTO settings
  FROM public.company_settings s
  WHERE s.company_id = NEW.company_id;
  IF entry.entry_date < date '2026-01-01'
    AND 'SYP' IN (NEW.currency, settings.book_currency, coalesce(settings.parallel_currency, '')) THEN
    RAISE EXCEPTION 'journal_lines: no SYP amount is dated before 2026-01-01'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF entry.reverses_entry_id IS NULL AND EXISTS (
    SELECT 1 FROM public.account_required_dimensions r
    WHERE r.company_id = NEW.company_id AND r.account_id = NEW.account_id
      AND r.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.dimension_set_values v
        WHERE v.company_id = NEW.company_id AND v.set_id = NEW.dimension_set_id
          AND v.type_id = r.dimension_type_id
      )
  ) THEN
    RAISE EXCEPTION 'journal_lines: a line carries every dimension its account % requires',
      NEW.account_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- A schedule is opened by an invoice.issued event, or by an opening being posted (S10 rule 13),
-- deferred to a postable liability account.
CREATE OR REPLACE FUNCTION recognition_schedule_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  account record;
BEGIN
  IF NEW.event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.inbound_events e
    WHERE e.company_id = NEW.company_id AND e.id = NEW.event_id AND e.type = 'invoice.issued'
  ) THEN
    RAISE EXCEPTION 'recognition_schedules: a schedule is opened by an invoice.issued event'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.opening_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.openings o
    WHERE o.company_id = NEW.company_id AND o.id = NEW.opening_id AND o.state = 'draft'
  ) THEN
    RAISE EXCEPTION 'recognition_schedules: a schedule is opened by its opening being posted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT a.kind, a.class, a.is_control INTO account
  FROM public.chart_accounts a
  WHERE a.company_id = NEW.company_id AND a.id = NEW.liability_account_id
  FOR SHARE;
  IF NOT FOUND OR account.kind <> 'postable' OR account.class <> 'liability' OR account.is_control THEN
    RAISE EXCEPTION 'recognition_schedules: a schedule is deferred to a postable liability account'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- A movement as it is inserted (S06): its entry posted in this transaction, a schedule's first
-- movement its one deferred movement; a before_opening movement only on a schedule the opening
-- opened, describing the opening entry (S10 rule 13).
CREATE OR REPLACE FUNCTION recognition_movement_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  earlier integer;
BEGIN
  IF NEW.entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.company_id = NEW.company_id AND e.id = NEW.entry_id AND e.created_at = now()
  ) THEN
    RAISE EXCEPTION 'recognition_movements: a movement describes an entry of its transaction'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT count(*) INTO earlier
  FROM public.recognition_movements m
  WHERE m.company_id = NEW.company_id AND m.schedule_id = NEW.schedule_id;
  IF (earlier = 0) <> (NEW.kind = 'deferred') THEN
    RAISE EXCEPTION 'recognition_movements: a schedule opens with its one deferred movement'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.kind = 'before_opening' AND NOT EXISTS (
    SELECT 1 FROM public.recognition_schedules s
    JOIN public.journal_entries e ON e.company_id = s.company_id AND e.id = NEW.entry_id
    WHERE s.company_id = NEW.company_id AND s.id = NEW.schedule_id AND s.opening_id IS NOT NULL
      AND e.source = 'opening' AND e.reverses_entry_id IS NULL
  ) THEN
    RAISE EXCEPTION 'recognition_movements: a before_opening movement is on an opening schedule, on its opening entry'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- The periods (S07), and in a company with a books start (S10 rules 3–4): no period is made before
-- it, and no month closes until the opening is posted.
CREATE OR REPLACE FUNCTION period_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  start_month smallint;
  books_start date;
  first_period text;
  earlier integer;
BEGIN
  PERFORM 1
  FROM public.ledger_heads h
  WHERE h.company_id = NEW.company_id
  FOR UPDATE;
  SELECT s.fiscal_year_start_month, s.books_start INTO start_month, books_start
  FROM public.company_settings s
  WHERE s.company_id = NEW.company_id;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.company_id, NEW.period, NEW.fiscal_year, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.period, OLD.fiscal_year, OLD.created_at)
      OR (OLD.state, NEW.state) NOT IN (('open', 'closed'), ('closed', 'reopened'),
        ('reopened', 'closed')) THEN
      RAISE EXCEPTION 'periods: period % changes only its state, from % to closed or reopened',
        OLD.period, OLD.state
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state = 'closed' AND books_start IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.openings o
      WHERE o.company_id = NEW.company_id AND o.state = 'posted'
    ) THEN
      RAISE EXCEPTION 'periods: no month closes before the opening: OPENING_NOT_POSTED'
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
  IF start_month IS NULL OR NEW.state <> 'open'
    OR NEW.fiscal_year <> left(NEW.period, 4)::integer
      - (CASE WHEN right(NEW.period, 2)::integer >= start_month THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'periods: period % is made open, in the fiscal year of its month', NEW.period
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF books_start IS NOT NULL AND NEW.period < to_char(books_start, 'YYYY-MM') THEN
    RAISE EXCEPTION 'periods: period % is before the books start %', NEW.period, books_start
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
-- A document item's reference is unique on its account among the items standing (S04 rule 6):
-- the unique indexes hold it apart for an opening's items, which the new opening after a whole
-- reversal opens again under Hub's numbers (S10 rule 25, 0054); an item an opening opened stops
-- standing once that opening entry is reversed. Items are made by the posting function only, under
-- the ledger head's lock, so two never race.
CREATE FUNCTION open_item_reference_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.kind = 'document' AND EXISTS (
    SELECT 1 FROM public.open_items i
    WHERE i.company_id = NEW.company_id AND i.kind = 'document'
      AND i.account_id = NEW.account_id AND i.reference = NEW.reference AND i.id <> NEW.id
      AND NOT (i.source = 'opening' AND EXISTS (
        SELECT 1 FROM public.journal_entries r
        WHERE r.company_id = i.company_id AND r.reverses_entry_id = i.opened_by_entry_id
      ))
  ) THEN
    RAISE EXCEPTION 'open_items: reference % stands on account % already', NEW.reference,
      NEW.account_id
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER open_item_reference_rules BEFORE INSERT ON open_items
  FOR EACH ROW EXECUTE FUNCTION open_item_reference_rules();
--> statement-breakpoint
ALTER TABLE open_items ENABLE ALWAYS TRIGGER open_item_reference_rules;
--> statement-breakpoint
-- A role's account (S02 rule 7), and the result of the year before the books start on an equity
-- account (S10 "Data", role `pre_opening_result`).
CREATE OR REPLACE FUNCTION account_role_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.company_id, NEW.role)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.role) THEN
    RAISE EXCEPTION 'account_roles: a row keeps its role'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.archived_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.chart_accounts a
    WHERE a.company_id = NEW.company_id AND a.id = NEW.account_id
      AND a.kind = 'postable' AND a.blocked_at IS NULL AND a.archived_at IS NULL
      AND CASE NEW.role::text
        WHEN 'conversion_rounding' THEN a.class IN ('revenue', 'expense')
        WHEN 'fx_realised_gain' THEN a.class = 'revenue'
        WHEN 'fx_unrealised_gain' THEN a.class = 'revenue'
        WHEN 'fx_realised_loss' THEN a.class = 'expense'
        WHEN 'fx_unrealised_loss' THEN a.class = 'expense'
        WHEN 'retained_earnings' THEN a.class = 'equity'
        WHEN 'pre_opening_result' THEN a.class = 'equity'
        ELSE false
      END
    FOR SHARE
  ) THEN
    RAISE EXCEPTION 'account_roles: the account does not fit role %', NEW.role
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- An account's rules (S02, S04), and an account holding the role `pre_opening_result` keeps
-- fitting it as an equity account (S10 "Data").
CREATE OR REPLACE FUNCTION chart_account_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  parent record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'chart_accounts: an account keeps its id and company'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.level = 1 AND (
      (NEW.code, NEW.level, NEW.parent_id, NEW.kind, NEW.class, NEW.normal_balance)
        IS DISTINCT FROM (OLD.code, OLD.level, OLD.parent_id, OLD.kind, OLD.class, OLD.normal_balance)
      OR NEW.archived_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'chart_accounts: root account % is only renamed', OLD.code
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF (OLD.first_posted_at IS NOT NULL OR (OLD.kind = 'header' AND EXISTS (
          SELECT 1 FROM public.chart_accounts c
          WHERE c.company_id = OLD.company_id AND c.parent_id = OLD.id)))
      AND (
        (NEW.code, NEW.parent_id, NEW.level, NEW.kind, NEW.class, NEW.normal_balance,
          NEW.currency, NEW.is_control, NEW.item_kind, NEW.is_monetary)
          IS DISTINCT FROM (OLD.code, OLD.parent_id, OLD.level, OLD.kind, OLD.class,
            OLD.normal_balance, OLD.currency, OLD.is_control, OLD.item_kind, OLD.is_monetary)
        OR (OLD.first_posted_at IS NOT NULL
          AND NEW.first_posted_at IS DISTINCT FROM OLD.first_posted_at)
      ) THEN
      RAISE EXCEPTION 'chart_accounts: account % is locked since its first use', OLD.code
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW.level > 1 THEN
    SELECT p.code, p.level, p.kind, p.archived_at INTO parent
    FROM public.chart_accounts p
    WHERE p.company_id = NEW.company_id AND p.id = NEW.parent_id
    FOR SHARE;
    IF NOT FOUND OR parent.kind <> 'header' OR parent.level <> NEW.level - 1
      OR left(NEW.code, char_length(parent.code)) <> parent.code
      OR (NEW.archived_at IS NULL AND parent.archived_at IS NOT NULL) THEN
      RAISE EXCEPTION 'chart_accounts: account % needs an unarchived header parent of the level above whose code it extends', NEW.code
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW.archived_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chart_accounts c
    WHERE c.company_id = NEW.company_id AND c.parent_id = NEW.id AND c.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'chart_accounts: account % has unarchived children', NEW.code
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.account_roles r
    WHERE r.company_id = NEW.company_id AND r.account_id = NEW.id AND r.archived_at IS NULL
      AND NOT (
        NEW.kind = 'postable' AND NEW.blocked_at IS NULL AND NEW.archived_at IS NULL
        AND CASE r.role::text
          WHEN 'conversion_rounding' THEN NEW.class IN ('revenue', 'expense')
          WHEN 'fx_realised_gain' THEN NEW.class = 'revenue'
          WHEN 'fx_unrealised_gain' THEN NEW.class = 'revenue'
          WHEN 'fx_realised_loss' THEN NEW.class = 'expense'
          WHEN 'fx_unrealised_loss' THEN NEW.class = 'expense'
          WHEN 'retained_earnings' THEN NEW.class = 'equity'
        WHEN 'pre_opening_result' THEN NEW.class = 'equity'
          ELSE false
        END
      )
  ) THEN
    RAISE EXCEPTION 'chart_accounts: account % holds an account role it would no longer fit', NEW.code
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.kind <> 'postable' AND EXISTS (
    SELECT 1 FROM public.account_required_dimensions d
    WHERE d.company_id = NEW.company_id AND d.account_id = NEW.id AND d.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'chart_accounts: header account % requires no dimension', NEW.code
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- An item movement (S04, S07), and an opening item the accountant opened, with no Hub document,
-- moved by a manual entry as a manual item is: not adjusted (S10 rule 12).
CREATE OR REPLACE FUNCTION open_item_movement_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  line record;
  entry record;
  item record;
BEGIN
  SELECT l.entry_id, l.account_id, l.dimension_set_id, l.currency, l.kind, l.amount_minor,
         l.book_minor, l.parallel_minor INTO line
  FROM public.journal_lines l
  WHERE l.company_id = NEW.company_id AND l.id = NEW.line_id;
  SELECT e.entry_date, e.source, e.reverses_entry_id INTO entry
  FROM public.journal_entries e
  WHERE e.company_id = NEW.company_id AND e.id = line.entry_id;
  SELECT i.account_id, i.dimension_set_id, i.currency, i.kind, i.source, i.opened_by_entry_id,
    i.hub_document
    INTO item
  FROM public.open_items i
  WHERE i.company_id = NEW.company_id AND i.id = NEW.item_id;
  IF line.entry_id IS NULL OR entry.entry_date IS NULL OR item.account_id IS NULL
    OR NEW.entry_id <> line.entry_id OR NEW.entry_date <> entry.entry_date
    OR (line.account_id, line.dimension_set_id, line.currency)
      IS DISTINCT FROM (item.account_id, item.dimension_set_id, item.currency)
    OR (NEW.amount_minor, NEW.book_minor, NEW.parallel_minor)
      IS DISTINCT FROM (line.amount_minor, line.book_minor, line.parallel_minor) THEN
    RAISE EXCEPTION 'open_item_movements: a movement is its line''s, on its line''s item'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (
    (item.kind = 'document' AND NEW.kind IN ('open', 'clear', 'revaluation'))
    OR (item.kind = 'running' AND NEW.kind IN ('add', 'clear', 'difference', 'revaluation'))
  ) OR line.kind IS DISTINCT FROM (CASE NEW.kind
      WHEN 'open' THEN 'measured' WHEN 'add' THEN 'measured'
      WHEN 'clear' THEN 'carried' WHEN 'difference' THEN 'difference'
      WHEN 'revaluation' THEN 'difference' END)
    OR (NEW.kind = 'revaluation') IS DISTINCT FROM (entry.source = 'revaluation')
    OR (NEW.kind = 'revaluation' AND NEW.amount_minor <> 0) THEN
    RAISE EXCEPTION 'open_item_movements: a % movement does not fit a % item on a % line of a % entry',
      NEW.kind, item.kind, line.kind, entry.source
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.kind = 'open' AND NOT (
    (NEW.entry_id = item.opened_by_entry_id AND NOT EXISTS (
      SELECT 1 FROM public.open_item_movements m
      WHERE m.company_id = NEW.company_id AND m.item_id = NEW.item_id
        AND m.entry_id = NEW.entry_id AND m.kind = 'open'))
    OR entry.reverses_entry_id IS NOT DISTINCT FROM item.opened_by_entry_id
  ) THEN
    RAISE EXCEPTION 'open_item_movements: item % opens once, in the entry that opened it', NEW.item_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.kind = 'open' AND entry.reverses_entry_id IS NULL AND sign(NEW.amount_minor) <> (
    SELECT CASE a.normal_balance WHEN 'debit' THEN 1 ELSE -1 END
    FROM public.chart_accounts a
    WHERE a.company_id = NEW.company_id AND a.id = item.account_id
  ) THEN
    RAISE EXCEPTION 'open_item_movements: OPEN_ITEM_DIRECTION: item % opens against its account''s normal balance', NEW.item_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.adjusted IS DISTINCT FROM (entry.source = 'manual' AND item.source <> 'manual'
      AND NOT (item.source = 'opening' AND item.hub_document IS NULL)) THEN
    RAISE EXCEPTION 'open_item_movements: adjusted exactly when a manual entry moves a % item',
      item.source
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.kind = 'open' AND entry.reverses_entry_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.open_item_movements m
    JOIN public.journal_entries e ON e.company_id = m.company_id AND e.id = m.entry_id
    WHERE m.company_id = NEW.company_id AND m.item_id = NEW.item_id AND m.kind <> 'open'
      AND e.reverses_entry_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries r
        WHERE r.company_id = m.company_id AND r.reverses_entry_id = m.entry_id
      )
  ) THEN
    RAISE EXCEPTION 'open_item_movements: OPEN_ITEM_HAS_SETTLEMENTS: item % has movements its opening''s reversal would leave', NEW.item_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
