-- S09 rule 29 (review of PR 2): a print is superseded by a reopen of one of its months after it,
-- whichever of the two transactions committed first. Their `created_at` are their transactions'
-- start times, which cannot tell: a reopen that started first and waited for its locks commits
-- after the print and would read as earlier. So each print records the reopens of its months its
-- snapshot saw, under its share locks of the closed months (0050's `reopens_seen`), and the
-- register reads a print as superseded once its months have more. journal_book_print_rules() is
-- replaced in place, as 0020 replaced a pinned guard, with its new pin in test/conventions.ts; it
-- only adds a check. No row exists to backfill: the table is new in this release.
CREATE OR REPLACE FUNCTION journal_book_print_rules() RETURNS trigger
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
  reopens integer;
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
  SELECT count(*)::integer INTO reopens
  FROM public.period_events e
  JOIN public.periods p ON p.company_id = e.company_id AND p.id = e.period_id
  WHERE e.company_id = NEW.company_id AND e.kind = 'reopened'
    AND p.period BETWEEN first_month.period AND last_month.period;
  IF NEW.reopens_seen IS DISTINCT FROM reopens THEN
    RAISE EXCEPTION 'journal_book_prints: a print records the reopens of its months it saw'
      USING ERRCODE = 'check_violation';
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
