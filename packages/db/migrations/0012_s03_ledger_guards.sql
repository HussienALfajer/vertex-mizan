-- The guards and grants of S03's ledger tables (0010 and 0011), as packages/db/CLAUDE.md and the
-- /db-migration skill write them (ADR 0005, ADR 0008, ADR 0012):
-- - forced RLS with the one company_isolation policy on every table;
-- - the append-only ledger (posting requests, entries, lines, conversions, dimension sets and
--   their values): SELECT, INSERT for the app role, refuse_change() for every role;
-- - the ledger state (the head, the number counters, the periods, the period balances): SELECT,
--   INSERT, UPDATE for the app role, refuse_delete() for every role, and a guard before INSERT and
--   UPDATE that allows only the change an append makes;
-- - the entry's guards: its place in the chain and its number, its fiscal year, its posting time
--   and its open period (on insert); its balance in both ledgers, the head moved past it, and an
--   exact reversal (deferred to commit);
-- - the line's guards: a postable account marked as used, its currency restriction, no SYP before
--   the new pound, the required dimensions (on insert); the period balances it adds to;
-- - a dimension set's key equal to its values (deferred);
-- - the ledger head of every company, made with its settings and backfilled for the existing
--   (test) companies.
-- Every trigger is ENABLE ALWAYS (ADR 0008); every guard function is pinned in test/conventions.ts
-- and names its tables with the schema. Locks follow one order: the ledger head, then the period.
-- Nothing is granted to mizan_jobs, mizan_queue or PUBLIC; no function is SECURITY DEFINER.
--> statement-breakpoint
ALTER TABLE posting_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE posting_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON posting_requests
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON journal_entries
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE journal_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON journal_lines
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE line_conversions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE line_conversions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON line_conversions
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE dimension_sets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dimension_sets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON dimension_sets
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE dimension_set_values ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dimension_set_values FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON dimension_set_values
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE ledger_heads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ledger_heads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON ledger_heads
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE entry_number_counters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE entry_number_counters FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON entry_number_counters
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE periods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE periods FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON periods
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE period_balances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE period_balances FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON period_balances
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON posting_requests, journal_entries, journal_lines, line_conversions, dimension_sets,
  dimension_set_values, ledger_heads, entry_number_counters, periods, period_balances FROM PUBLIC;
--> statement-breakpoint
-- The append-only ledger: the app role reads and adds only (ADR 0005 invariant 2).
GRANT SELECT, INSERT ON posting_requests, journal_entries, journal_lines, line_conversions,
  dimension_sets, dimension_set_values TO mizan_app;
--> statement-breakpoint
-- The ledger state: the app role reads, adds and moves it, never deletes (ADR 0012).
GRANT SELECT, INSERT, UPDATE ON ledger_heads, entry_number_counters, periods, period_balances
  TO mizan_app;
--> statement-breakpoint
-- refuse_change() on the append-only ledger: no UPDATE, DELETE or TRUNCATE for any role.
CREATE TRIGGER posting_requests_refuse_change BEFORE UPDATE OR DELETE ON posting_requests
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER posting_requests_refuse_truncate BEFORE TRUNCATE ON posting_requests
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE posting_requests ENABLE ALWAYS TRIGGER posting_requests_refuse_change;
--> statement-breakpoint
ALTER TABLE posting_requests ENABLE ALWAYS TRIGGER posting_requests_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER journal_entries_refuse_change BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER journal_entries_refuse_truncate BEFORE TRUNCATE ON journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE journal_entries ENABLE ALWAYS TRIGGER journal_entries_refuse_change;
--> statement-breakpoint
ALTER TABLE journal_entries ENABLE ALWAYS TRIGGER journal_entries_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER journal_lines_refuse_change BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER journal_lines_refuse_truncate BEFORE TRUNCATE ON journal_lines
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE journal_lines ENABLE ALWAYS TRIGGER journal_lines_refuse_change;
--> statement-breakpoint
ALTER TABLE journal_lines ENABLE ALWAYS TRIGGER journal_lines_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER line_conversions_refuse_change BEFORE UPDATE OR DELETE ON line_conversions
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER line_conversions_refuse_truncate BEFORE TRUNCATE ON line_conversions
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE line_conversions ENABLE ALWAYS TRIGGER line_conversions_refuse_change;
--> statement-breakpoint
ALTER TABLE line_conversions ENABLE ALWAYS TRIGGER line_conversions_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER dimension_sets_refuse_change BEFORE UPDATE OR DELETE ON dimension_sets
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER dimension_sets_refuse_truncate BEFORE TRUNCATE ON dimension_sets
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE dimension_sets ENABLE ALWAYS TRIGGER dimension_sets_refuse_change;
--> statement-breakpoint
ALTER TABLE dimension_sets ENABLE ALWAYS TRIGGER dimension_sets_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER dimension_set_values_refuse_change BEFORE UPDATE OR DELETE ON dimension_set_values
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER dimension_set_values_refuse_truncate BEFORE TRUNCATE ON dimension_set_values
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE dimension_set_values ENABLE ALWAYS TRIGGER dimension_set_values_refuse_change;
--> statement-breakpoint
ALTER TABLE dimension_set_values ENABLE ALWAYS TRIGGER dimension_set_values_refuse_truncate;
--> statement-breakpoint
-- refuse_delete() on the ledger state: no DELETE or TRUNCATE for any role (ADR 0012).
CREATE TRIGGER ledger_heads_refuse_delete BEFORE DELETE ON ledger_heads
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER ledger_heads_refuse_truncate BEFORE TRUNCATE ON ledger_heads
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE ledger_heads ENABLE ALWAYS TRIGGER ledger_heads_refuse_delete;
--> statement-breakpoint
ALTER TABLE ledger_heads ENABLE ALWAYS TRIGGER ledger_heads_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER entry_number_counters_refuse_delete BEFORE DELETE ON entry_number_counters
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER entry_number_counters_refuse_truncate BEFORE TRUNCATE ON entry_number_counters
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE entry_number_counters ENABLE ALWAYS TRIGGER entry_number_counters_refuse_delete;
--> statement-breakpoint
ALTER TABLE entry_number_counters ENABLE ALWAYS TRIGGER entry_number_counters_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER periods_refuse_delete BEFORE DELETE ON periods
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER periods_refuse_truncate BEFORE TRUNCATE ON periods
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE periods ENABLE ALWAYS TRIGGER periods_refuse_delete;
--> statement-breakpoint
ALTER TABLE periods ENABLE ALWAYS TRIGGER periods_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER period_balances_refuse_delete BEFORE DELETE ON period_balances
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER period_balances_refuse_truncate BEFORE TRUNCATE ON period_balances
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE period_balances ENABLE ALWAYS TRIGGER period_balances_refuse_delete;
--> statement-breakpoint
ALTER TABLE period_balances ENABLE ALWAYS TRIGGER period_balances_refuse_truncate;
--> statement-breakpoint
-- The ledger head (ADR 0012): made with count 0 and no entry; it then moves by exactly one entry
-- at a time, to an entry already inserted in this transaction that follows the old head: its
-- sequence is the new count and its previous hash the old head's hash. Its company, id and
-- creation time never change.
CREATE FUNCTION ledger_head_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.entry_count <> 0 OR NEW.last_entry_id IS NOT NULL OR NEW.last_hash IS NOT NULL THEN
      RAISE EXCEPTION 'ledger_heads: a head starts with no entry'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.created_at)
    OR NEW.entry_count IS DISTINCT FROM OLD.entry_count + 1
    OR NOT EXISTS (
      SELECT 1 FROM public.journal_entries e
      WHERE e.company_id = NEW.company_id AND e.id = NEW.last_entry_id
        AND e.hash = NEW.last_hash AND e.sequence = NEW.entry_count
        AND e.previous_hash IS NOT DISTINCT FROM OLD.last_hash
    ) THEN
    RAISE EXCEPTION 'ledger_heads: the head of company % moves by one entry that follows it',
      OLD.company_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_head_rules BEFORE INSERT OR UPDATE ON ledger_heads
  FOR EACH ROW EXECUTE FUNCTION ledger_head_rules();
--> statement-breakpoint
ALTER TABLE ledger_heads ENABLE ALWAYS TRIGGER ledger_head_rules;
--> statement-breakpoint
-- An entry-number counter (ADR 0005 invariant 6, ADR 0012): made at 1 for a fiscal year, then moved
-- by exactly one; its company, year, id and creation time never change.
CREATE FUNCTION entry_number_counter_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.last_number <> 1 THEN
      RAISE EXCEPTION 'entry_number_counters: a fiscal year''s numbers start at 1'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.fiscal_year, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.fiscal_year, OLD.created_at)
    OR NEW.last_number IS DISTINCT FROM OLD.last_number + 1 THEN
    RAISE EXCEPTION 'entry_number_counters: a counter moves by one number at a time'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER entry_number_counter_rules BEFORE INSERT OR UPDATE ON entry_number_counters
  FOR EACH ROW EXECUTE FUNCTION entry_number_counter_rules();
--> statement-breakpoint
ALTER TABLE entry_number_counters ENABLE ALWAYS TRIGGER entry_number_counter_rules;
--> statement-breakpoint
-- Every number a counter gives is taken by an entry of that fiscal year by commit, so no number is
-- skipped (ADR 0005 invariant 6). Deferred: the entry is inserted after its counter moves.
CREATE FUNCTION entry_number_counter_used() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.company_id = NEW.company_id AND e.fiscal_year = NEW.fiscal_year
      AND e.number = NEW.last_number
  ) THEN
    RAISE EXCEPTION 'entry number % of fiscal year % was given but no entry took it',
      NEW.last_number, NEW.fiscal_year
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER entry_number_counter_used AFTER INSERT OR UPDATE
  ON entry_number_counters DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION entry_number_counter_used();
--> statement-breakpoint
ALTER TABLE entry_number_counters ENABLE ALWAYS TRIGGER entry_number_counter_used;
--> statement-breakpoint
-- A period (ADR 0005 invariant 4): made open, in the fiscal year of its month under the company's
-- fiscal year start. Its state changes only through S07's close, which brings its own guarded
-- transition; until then every update is refused.
CREATE FUNCTION period_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  start_month smallint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'periods: period % changes only through the close (S07)', OLD.period
      USING ERRCODE = 'restrict_violation';
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
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER period_rules BEFORE INSERT OR UPDATE ON periods
  FOR EACH ROW EXECUTE FUNCTION period_rules();
--> statement-breakpoint
ALTER TABLE periods ENABLE ALWAYS TRIGGER period_rules;
--> statement-breakpoint
-- An entry as it is inserted (ADR 0005 invariants 4 and 6, ADR 0008, ADR 0012):
-- - it follows the company's chain head, which this transaction locked: its sequence is the next
--   one and its previous hash the head's hash (the head moves after it, ledger_head_rules);
-- - its number is the one its fiscal year's counter has just given;
-- - its fiscal year is that of its date under the company's fiscal year start, in books whose
--   start the posting has marked (books_started_at, the settings lock of S01 rule 11);
-- - its posting time is its transaction's, to the millisecond its hash records;
-- - its date is in an open period, read FOR SHARE, so a close (S07) waits for the posting or the
--   posting for the close.
CREATE FUNCTION journal_entry_rules() RETURNS trigger
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
  IF NOT FOUND OR period_state <> 'open' THEN
    RAISE EXCEPTION 'journal_entries: an entry dated % is in an open period', NEW.entry_date
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entry_rules BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entry_rules();
--> statement-breakpoint
ALTER TABLE journal_entries ENABLE ALWAYS TRIGGER journal_entry_rules;
--> statement-breakpoint
-- An entry is complete and balances when its transaction commits (ADR 0005 invariant 1, ADR 0008):
-- it has the lines it states, at least two, so no later transaction can add any; its book amounts
-- sum to zero; its parallel amounts are set on every line exactly when the company keeps a
-- parallel ledger, and then sum to zero; and the chain head has moved past it. A deferred
-- AFTER … FOR EACH ROW constraint trigger on the entry and on each line checks the whole entry, so
-- firing once per row gives the same answer each time; an entry it cannot see fails.
CREATE FUNCTION journal_entry_balances() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  target uuid;
  entry record;
  totals record;
  keeps_parallel boolean;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    target := NEW.id;
  ELSE
    target := NEW.entry_id;
  END IF;
  SELECT e.line_count, e.sequence INTO entry
  FROM public.journal_entries e
  WHERE e.company_id = NEW.company_id AND e.id = target;
  SELECT count(*) AS lines, coalesce(sum(l.book_minor), 0) AS book,
         count(l.parallel_minor) AS parallel_lines, coalesce(sum(l.parallel_minor), 0) AS parallel
    INTO totals
  FROM public.journal_lines l
  WHERE l.company_id = NEW.company_id AND l.entry_id = target;
  SELECT s.parallel_currency IS NOT NULL INTO keeps_parallel
  FROM public.company_settings s
  WHERE s.company_id = NEW.company_id;
  IF entry.line_count IS NULL OR keeps_parallel IS NULL OR totals.lines < 2
    OR totals.lines <> entry.line_count OR totals.book <> 0
    OR totals.parallel_lines <> (CASE WHEN keeps_parallel THEN totals.lines ELSE 0 END)
    OR totals.parallel <> 0 THEN
    RAISE EXCEPTION 'journal entry % does not balance: % lines of %, book %, parallel %',
      target, totals.lines, entry.line_count, totals.book, totals.parallel
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_heads h
    WHERE h.company_id = NEW.company_id AND h.entry_count >= entry.sequence
  ) THEN
    RAISE EXCEPTION 'journal entry %: the chain head did not move past it', target
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_balance AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balances();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balance AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balances();
--> statement-breakpoint
ALTER TABLE journal_entries ENABLE ALWAYS TRIGGER journal_entries_balance;
--> statement-breakpoint
ALTER TABLE journal_lines ENABLE ALWAYS TRIGGER journal_lines_balance;
--> statement-breakpoint
-- A reversal (ADR 0005 invariant 3, S03 rule 9): its original is not itself a reversal and is dated
-- on or before it; it has as many lines as the original, and every line negates one original line
-- exactly: account, dimension set, kind, ledger, currency and every amount. With the balance check
-- (each entry has exactly its stated lines), the two multisets are equal. The unique key on
-- reverses_entry_id lets an entry be reversed once. Deferred: the lines follow the entry.
CREATE FUNCTION journal_entry_reverses() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  original record;
BEGIN
  IF NEW.reverses_entry_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT o.reverses_entry_id, o.entry_date, o.line_count INTO original
  FROM public.journal_entries o
  WHERE o.company_id = NEW.company_id AND o.id = NEW.reverses_entry_id;
  IF NOT FOUND OR original.reverses_entry_id IS NOT NULL OR original.entry_date > NEW.entry_date
    OR original.line_count <> NEW.line_count OR EXISTS (
      SELECT l.account_id, l.dimension_set_id, l.kind, l.ledger, l.currency,
             -l.amount_minor, -l.book_minor, -l.parallel_minor
      FROM public.journal_lines l
      WHERE l.company_id = NEW.company_id AND l.entry_id = NEW.reverses_entry_id
      EXCEPT ALL
      SELECT r.account_id, r.dimension_set_id, r.kind, r.ledger, r.currency,
             r.amount_minor, r.book_minor, r.parallel_minor
      FROM public.journal_lines r
      WHERE r.company_id = NEW.company_id AND r.entry_id = NEW.id
    ) THEN
    RAISE EXCEPTION 'journal entry % does not reverse entry % exactly', NEW.id, NEW.reverses_entry_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_reversal AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_reverses();
--> statement-breakpoint
ALTER TABLE journal_entries ENABLE ALWAYS TRIGGER journal_entries_reversal;
--> statement-breakpoint
-- A line as it is inserted (ADR 0005 invariant 8; the posting function checks the same first, with
-- clear codes): its account is a postable account of the company that the posting has marked as
-- used (first_posted_at, the lock after first use of S02 rule 5), read FOR SHARE; its currency is
-- the account's restriction; no SYP amount is dated before the new pound; and, except on a
-- reversal's line, which carries a line accepted when it posted (S02 rule 4), its dimension set
-- holds a value of every type its account requires.
CREATE FUNCTION journal_line_rules() RETURNS trigger
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
  SELECT e.entry_date, e.reverses_entry_id INTO entry
  FROM public.journal_entries e
  WHERE e.company_id = NEW.company_id AND e.id = NEW.entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal_lines: a line belongs to an entry of its company'
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
CREATE TRIGGER journal_line_rules BEFORE INSERT ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_line_rules();
--> statement-breakpoint
ALTER TABLE journal_lines ENABLE ALWAYS TRIGGER journal_line_rules;
--> statement-breakpoint
-- The period balances (ADR 0008, ADR 0012): each line adds to its period's row of its account,
-- dimension set and currency, a debit to the debit total and a credit to the credit total, by the
-- sign of each amount separately; the parallel totals stay null without a parallel ledger. This is
-- their only writer (period_balance_rules refuses a write that does not come from a trigger).
CREATE FUNCTION journal_line_period_balance() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  target_period uuid;
BEGIN
  SELECT p.id INTO target_period
  FROM public.journal_entries e
  JOIN public.periods p ON p.company_id = e.company_id AND p.period = to_char(e.entry_date, 'YYYY-MM')
  WHERE e.company_id = NEW.company_id AND e.id = NEW.entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal_lines: the period of the line''s entry is missing'
      USING ERRCODE = 'restrict_violation';
  END IF;
  INSERT INTO public.period_balances AS b (
    id, company_id, period_id, account_id, dimension_set_id, currency,
    debit_minor, credit_minor, book_debit_minor, book_credit_minor,
    parallel_debit_minor, parallel_credit_minor, line_count
  ) VALUES (
    public.new_uuidv7(), NEW.company_id, target_period, NEW.account_id, NEW.dimension_set_id,
    NEW.currency,
    greatest(NEW.amount_minor, 0), greatest(-NEW.amount_minor, 0),
    greatest(NEW.book_minor, 0), greatest(-NEW.book_minor, 0),
    CASE WHEN NEW.parallel_minor IS NULL THEN NULL ELSE greatest(NEW.parallel_minor, 0) END,
    CASE WHEN NEW.parallel_minor IS NULL THEN NULL ELSE greatest(-NEW.parallel_minor, 0) END,
    1
  )
  ON CONFLICT (company_id, period_id, account_id, dimension_set_id, currency) DO UPDATE SET
    debit_minor = b.debit_minor + excluded.debit_minor,
    credit_minor = b.credit_minor + excluded.credit_minor,
    book_debit_minor = b.book_debit_minor + excluded.book_debit_minor,
    book_credit_minor = b.book_credit_minor + excluded.book_credit_minor,
    parallel_debit_minor = b.parallel_debit_minor + excluded.parallel_debit_minor,
    parallel_credit_minor = b.parallel_credit_minor + excluded.parallel_credit_minor,
    line_count = b.line_count + 1,
    updated_at = now();
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER journal_line_period_balance AFTER INSERT ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_line_period_balance();
--> statement-breakpoint
ALTER TABLE journal_lines ENABLE ALWAYS TRIGGER journal_line_period_balance;
--> statement-breakpoint
-- A period balance is written only by journal_line_period_balance(), a trigger on line inserts: a
-- write at trigger depth 1 comes from a statement, not from a line, and is refused for every role.
-- Its key never changes and its totals and line count only grow.
CREATE FUNCTION period_balance_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'period_balances: written only by the trigger on journal_lines'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    (NEW.id, NEW.company_id, NEW.period_id, NEW.account_id, NEW.dimension_set_id, NEW.currency,
      NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.period_id, OLD.account_id,
        OLD.dimension_set_id, OLD.currency, OLD.created_at)
    OR NEW.debit_minor < OLD.debit_minor OR NEW.credit_minor < OLD.credit_minor
    OR NEW.book_debit_minor < OLD.book_debit_minor OR NEW.book_credit_minor < OLD.book_credit_minor
    OR (NEW.parallel_debit_minor IS NULL) <> (OLD.parallel_debit_minor IS NULL)
    OR NEW.parallel_debit_minor < OLD.parallel_debit_minor
    OR NEW.parallel_credit_minor < OLD.parallel_credit_minor
    OR NEW.line_count <= OLD.line_count
  ) THEN
    RAISE EXCEPTION 'period_balances: a period balance keeps its key and only grows'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER period_balance_rules BEFORE INSERT OR UPDATE ON period_balances
  FOR EACH ROW EXECUTE FUNCTION period_balance_rules();
--> statement-breakpoint
ALTER TABLE period_balances ENABLE ALWAYS TRIGGER period_balance_rules;
--> statement-breakpoint
-- A dimension set's key is its values' canonical form when its transaction commits: the
-- `type_id:value_id` pairs ordered by type, joined by commas, '' for none. The posting function
-- finds a set by its key, so a key that lied would put lines under other dimensions.
CREATE FUNCTION dimension_set_keys() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  target uuid;
  set_key text;
  values_key text;
BEGIN
  IF TG_TABLE_NAME = 'dimension_sets' THEN
    target := NEW.id;
  ELSE
    target := NEW.set_id;
  END IF;
  SELECT s.key INTO set_key
  FROM public.dimension_sets s
  WHERE s.company_id = NEW.company_id AND s.id = target;
  SELECT coalesce(string_agg(v.type_id::text || ':' || v.value_id::text, ',' ORDER BY v.type_id), '')
    INTO values_key
  FROM public.dimension_set_values v
  WHERE v.company_id = NEW.company_id AND v.set_id = target;
  IF set_key IS NULL OR set_key <> values_key THEN
    RAISE EXCEPTION 'dimension set % does not hold the values its key names', target
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER dimension_sets_key_matches AFTER INSERT ON dimension_sets
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dimension_set_keys();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER dimension_set_values_key_matches AFTER INSERT ON dimension_set_values
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dimension_set_keys();
--> statement-breakpoint
ALTER TABLE dimension_sets ENABLE ALWAYS TRIGGER dimension_sets_key_matches;
--> statement-breakpoint
ALTER TABLE dimension_set_values ENABLE ALWAYS TRIGGER dimension_set_values_key_matches;
--> statement-breakpoint
-- Every company gets its ledger head in its creation transaction, as it gets its chart roots
-- (0009): S01's creation inserts the settings row inside withCompany, and this trigger runs there.
CREATE FUNCTION company_settings_create_ledger_head() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  INSERT INTO public.ledger_heads (id, company_id, entry_count)
  VALUES (public.new_uuidv7(), NEW.company_id, 0);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER company_settings_create_ledger_head AFTER INSERT ON company_settings
  FOR EACH ROW EXECUTE FUNCTION company_settings_create_ledger_head();
--> statement-breakpoint
ALTER TABLE company_settings ENABLE ALWAYS TRIGGER company_settings_create_ledger_head;
--> statement-breakpoint
-- The existing companies (test data only, S03 "Migration and compatibility"): each gets its head
-- in its own company context, set for this transaction only, then cleared.
DO $$
DECLARE
  company record;
BEGIN
  FOR company IN SELECT s.company_id AS id FROM public.company_settings s LOOP
    PERFORM set_config('app.company_id', company.id::text, true);
    INSERT INTO public.ledger_heads (id, company_id, entry_count)
    VALUES (public.new_uuidv7(), company.id, 0);
  END LOOP;
  PERFORM set_config('app.company_id', '', true);
END
$$;
