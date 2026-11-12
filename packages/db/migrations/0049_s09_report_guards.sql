-- The guards and grants of S09's reports module (0048), as packages/db/CLAUDE.md and the
-- /db-migration skill write them (ADR 0003, ADR 0005, ADR 0008):
-- - forced RLS with the one company_isolation policy on both tables, for every role;
-- - report_files is a queue (as company_exports): requested queued, then ready or failed once, a
--   ready one expired once past its time, an official print never; the app role inserts and
--   updates only the state columns, inside the company's context (the API asks, the worker
--   renders); what was asked and by whom never changes;
-- - journal_book_prints is append-only: SELECT, INSERT for the app role, refuse_change() for every
--   role; journal_book_print_rules(): a print is of an official journal-book file by its
--   requester, of a range of one fiscal year whose every month is closed (read FOR SHARE, so a
--   reopen waits for the print or the print for the reopen), and its counts and totals are the
--   book ledger's for those months (S09 rules 26–28);
-- - report_file_print_agrees(), deferred on both tables: an official file is ready exactly when it
--   has its print, whose file digest is the file's (rule 28: one transaction);
-- - the jobs role finds the files to expire, and the ones left queued, across companies; the app
--   role works each in its company's context (as company_exports).
-- Every trigger is ENABLE ALWAYS (ADR 0008); every guard function is pinned in test/conventions.ts
-- and names its tables with the schema. Nothing is granted to mizan_queue or PUBLIC; no function is
-- SECURITY DEFINER. No ledger row, rate or audit row changes.
ALTER TABLE report_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE report_files FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON report_files
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE journal_book_prints ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE journal_book_prints FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON journal_book_prints
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON report_files, journal_book_prints FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON report_files TO mizan_app;
--> statement-breakpoint
GRANT UPDATE (state, storage_key, size_bytes, sha256, error, attempts, ready_at, expires_at,
  updated_at) ON report_files TO mizan_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON journal_book_prints TO mizan_app;
--> statement-breakpoint
CREATE TRIGGER journal_book_prints_refuse_change BEFORE UPDATE OR DELETE
  ON journal_book_prints FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER journal_book_prints_refuse_truncate BEFORE TRUNCATE ON journal_book_prints
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE journal_book_prints ENABLE ALWAYS TRIGGER journal_book_prints_refuse_change;
--> statement-breakpoint
ALTER TABLE journal_book_prints ENABLE ALWAYS TRIGGER journal_book_prints_refuse_truncate;
--> statement-breakpoint
-- A file (S09 rule 36) is requested `queued`. It becomes `ready` with its file or `failed` with its
-- error, once; a ready one that is not an official print becomes `expired` once past its time,
-- keeping its key, size and digest as a record. What was asked, by whom and when never changes.
CREATE FUNCTION report_file_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'queued' OR NEW.attempts <> 0 THEN
      RAISE EXCEPTION 'report_files: a file is requested queued'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.report, NEW.params, NEW.format, NEW.official,
      NEW.requested_by_user_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.report, OLD.params, OLD.format, OLD.official,
      OLD.requested_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'report_files: a file keeps what was asked'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.state, NEW.state) NOT IN (('queued', 'queued'), ('queued', 'ready'),
                                    ('queued', 'failed'), ('ready', 'expired')) THEN
    RAISE EXCEPTION 'report_files: % to % refused', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'report_files: attempts only grow'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'ready' AND (
    (NEW.storage_key, NEW.size_bytes, NEW.sha256, NEW.ready_at, NEW.expires_at)
      IS DISTINCT FROM (OLD.storage_key, OLD.size_bytes, OLD.sha256, OLD.ready_at, OLD.expires_at)
    OR OLD.official OR OLD.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'report_files: a ready file expires only past its time, as it was'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER report_files_rules BEFORE INSERT OR UPDATE ON report_files
  FOR EACH ROW EXECUTE FUNCTION report_file_rules();
--> statement-breakpoint
ALTER TABLE report_files ENABLE ALWAYS TRIGGER report_files_rules;
--> statement-breakpoint
-- An official print (S09 rules 26–28): of an official journal-book file not yet failed, by the
-- person who asked for it; its months are one fiscal year's, from before to, every one closed in
-- this transaction's snapshot and share-locked; its counts and book totals are those of the posted
-- entries dated in them, as the journal book reads them (every line, debit when positive).
CREATE FUNCTION journal_book_print_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  file record;
  first_month record;
  last_month record;
  month_count integer;
  closed_count integer;
  range_start date;
  range_end date;
  totals record;
BEGIN
  SELECT f.report, f.official, f.state, f.requested_by_user_id INTO file
  FROM public.report_files f
  WHERE f.company_id = NEW.company_id AND f.id = NEW.report_file_id;
  IF NOT FOUND OR file.report <> 'journal_book' OR NOT file.official
     OR file.state NOT IN ('queued', 'ready') THEN
    RAISE EXCEPTION 'journal_book_prints: a print is of an official journal-book file'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.printed_by_user_id <> file.requested_by_user_id THEN
    RAISE EXCEPTION 'journal_book_prints: a print is its requester''s'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT p.period, p.fiscal_year INTO first_month
  FROM public.periods p WHERE p.company_id = NEW.company_id AND p.id = NEW.from_period_id;
  SELECT p.period, p.fiscal_year INTO last_month
  FROM public.periods p WHERE p.company_id = NEW.company_id AND p.id = NEW.to_period_id;
  IF first_month.fiscal_year IS DISTINCT FROM NEW.fiscal_year
     OR last_month.fiscal_year IS DISTINCT FROM NEW.fiscal_year
     OR first_month.period > last_month.period THEN
    RAISE EXCEPTION 'journal_book_prints: a print is of months of its fiscal year, in order'
      USING ERRCODE = 'check_violation';
  END IF;
  range_start := to_date(first_month.period || '-01', 'YYYY-MM-DD');
  range_end := (to_date(last_month.period || '-01', 'YYYY-MM-DD') + interval '1 month')::date - 1;
  month_count := (extract(year FROM range_end)::integer * 12 + extract(month FROM range_end)::integer)
    - (extract(year FROM range_start)::integer * 12 + extract(month FROM range_start)::integer) + 1;
  SELECT count(*) INTO closed_count
  FROM (
    SELECT 1 FROM public.periods p
    WHERE p.company_id = NEW.company_id
      AND p.period BETWEEN first_month.period AND last_month.period
      AND p.state = 'closed'
    FOR SHARE
  ) closed_months;
  IF closed_count <> month_count THEN
    RAISE EXCEPTION 'journal_book_prints: PERIOD_NOT_CLOSED: every month of a print is closed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT count(DISTINCT e.id)::integer AS entries, count(l.id)::integer AS lines,
         coalesce(sum(greatest(l.book_minor, 0)), 0)::bigint AS debits,
         coalesce(sum(greatest(-l.book_minor, 0)), 0)::bigint AS credits
  INTO totals
  FROM public.journal_entries e
  JOIN public.journal_lines l ON l.company_id = e.company_id AND l.entry_id = e.id
  WHERE e.company_id = NEW.company_id AND e.fiscal_year = NEW.fiscal_year
    AND e.entry_date BETWEEN range_start AND range_end;
  IF (NEW.entry_count, NEW.line_count, NEW.debit_total_minor, NEW.credit_total_minor)
     IS DISTINCT FROM (totals.entries, totals.lines, totals.debits, totals.credits) THEN
    RAISE EXCEPTION 'journal_book_prints: a print''s counts and totals are its months'' entries'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_book_print_rules BEFORE INSERT ON journal_book_prints
  FOR EACH ROW EXECUTE FUNCTION journal_book_print_rules();
--> statement-breakpoint
ALTER TABLE journal_book_prints ENABLE ALWAYS TRIGGER journal_book_print_rules;
--> statement-breakpoint
-- At commit (S09 rule 28): an official file is ready exactly when its print row stands, and the
-- print's file digest is the file's, so the file, its register row and the audit row are one
-- transaction. A file the check cannot see fails.
CREATE FUNCTION report_file_print_agrees() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  file_id uuid;
  file record;
  printed record;
  has_print boolean;
BEGIN
  IF TG_TABLE_NAME = 'report_files' THEN
    file_id := NEW.id;
  ELSE
    file_id := NEW.report_file_id;
  END IF;
  SELECT f.official, f.state, f.sha256 INTO file
  FROM public.report_files f
  WHERE f.company_id = NEW.company_id AND f.id = file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_files: a print''s file is not visible'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT file.official THEN
    RETURN NULL;
  END IF;
  SELECT p.file_sha256 INTO printed
  FROM public.journal_book_prints p
  WHERE p.company_id = NEW.company_id AND p.report_file_id = file_id;
  has_print := FOUND;
  IF (file.state = 'ready') <> has_print
     OR (has_print AND printed.file_sha256 IS DISTINCT FROM file.sha256) THEN
    RAISE EXCEPTION 'report_files: an official file is ready with its print, in one transaction'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER report_files_print_agrees AFTER INSERT OR UPDATE ON report_files
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION report_file_print_agrees();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_book_prints_agree AFTER INSERT ON journal_book_prints
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION report_file_print_agrees();
--> statement-breakpoint
ALTER TABLE report_files ENABLE ALWAYS TRIGGER report_files_print_agrees;
--> statement-breakpoint
ALTER TABLE journal_book_prints ENABLE ALWAYS TRIGGER journal_book_prints_agree;
--> statement-breakpoint
-- The jobs role (ADR 0003): the hourly job finds the ready files past their time and the files
-- left queued, across companies; the app role works each in its company's context.
GRANT SELECT (company_id, id, state, expires_at, created_at) ON report_files TO mizan_jobs;
--> statement-breakpoint
CREATE POLICY jobs_find_report_files ON report_files FOR SELECT TO mizan_jobs USING (true);
