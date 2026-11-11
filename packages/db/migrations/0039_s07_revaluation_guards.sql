-- The guards and grants of S07's month-end revaluation (0038), as packages/db/CLAUDE.md and the
-- /db-migration skill write them (ADR 0003, ADR 0005, ADR 0007, ADR 0008, ADR 0016):
-- - forced RLS with the one company_isolation policy on revaluations;
-- - revaluations are append-only: SELECT, INSERT for the app role, refuse_change() for every role;
-- - a revaluation names its entry (a revaluation entry, not a reversal, dated on its period's last
--   day, of difference lines in its ledger only) and that entry's reversal (dated on the next
--   month's first day), is adjusting exactly when an earlier one of its period and ledger stands,
--   and is its entry's poster's, on insert;
-- - every revaluation entry and reversal has its revaluation row, at commit;
-- - an item's `revaluation` movement is a difference line of a revaluation entry or its reversal
--   with a transaction amount of zero, on insert; the items' balances keep their carrying amounts
--   without revaluations and the revaluations apart, and invariant 9 reads the carrying amounts
--   (S07 "Data"): open_item_movement_rules(), open_item_movement_balance() and
--   open_item_balance_holds() are replaced in place, each with its new pin.
-- No existing row changes: no item has a revaluation movement yet, and the two balance columns
-- added in 0038 are zero on every row. Every trigger is ENABLE ALWAYS (ADR 0008); every guard
-- function is pinned in test/conventions.ts and names its tables with the schema. Locks follow one
-- order: the ledger head, then the period, then an item's balance row. Nothing is granted to
-- mizan_jobs, mizan_queue or PUBLIC; no function is SECURITY DEFINER.
ALTER TABLE revaluations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE revaluations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON revaluations
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON revaluations FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON revaluations TO mizan_app;
--> statement-breakpoint
CREATE TRIGGER revaluations_refuse_change BEFORE UPDATE OR DELETE ON revaluations
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER revaluations_refuse_truncate BEFORE TRUNCATE ON revaluations
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE revaluations ENABLE ALWAYS TRIGGER revaluations_refuse_change;
--> statement-breakpoint
ALTER TABLE revaluations ENABLE ALWAYS TRIGGER revaluations_refuse_truncate;
--> statement-breakpoint
-- A revaluation as it is inserted (S07 rules 13, 14, 17): its entry is a revaluation entry of its
-- company that is not a reversal, dated on the last day of its period, whose lines are all
-- difference lines in its ledger; its reversal reverses that entry on the next month's first day;
-- `adjusting` exactly when another revaluation of its period and ledger stands; its person is the
-- entry's poster.
CREATE FUNCTION revaluation_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  period text;
  entry record;
  reversal record;
  last_day date;
BEGIN
  SELECT p.period INTO period
  FROM public.periods p
  WHERE p.company_id = NEW.company_id AND p.id = NEW.period_id;
  SELECT e.entry_date, e.source, e.reverses_entry_id, e.posted_by_user_id INTO entry
  FROM public.journal_entries e
  WHERE e.company_id = NEW.company_id AND e.id = NEW.entry_id;
  SELECT e.entry_date, e.source, e.reverses_entry_id INTO reversal
  FROM public.journal_entries e
  WHERE e.company_id = NEW.company_id AND e.id = NEW.reversal_entry_id;
  IF period IS NULL OR entry.entry_date IS NULL OR reversal.entry_date IS NULL THEN
    RAISE EXCEPTION 'revaluations: a revaluation names its period, entry and reversal'
      USING ERRCODE = 'restrict_violation';
  END IF;
  last_day := (to_date(period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;
  IF entry.source <> 'revaluation' OR entry.reverses_entry_id IS NOT NULL
    OR entry.entry_date <> last_day
    OR reversal.source <> 'revaluation' OR reversal.reverses_entry_id IS DISTINCT FROM NEW.entry_id
    OR reversal.entry_date <> last_day + 1 THEN
    RAISE EXCEPTION 'revaluations: a revaluation entry on its period''s last day, reversed on the next day'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.journal_lines l
    WHERE l.company_id = NEW.company_id AND l.entry_id = NEW.entry_id
      AND (l.kind <> 'difference' OR l.ledger IS DISTINCT FROM NEW.ledger)
  ) THEN
    RAISE EXCEPTION 'revaluations: a revaluation entry has difference lines in its ledger only'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.adjusting IS DISTINCT FROM EXISTS (
    SELECT 1 FROM public.revaluations r
    WHERE r.company_id = NEW.company_id AND r.period_id = NEW.period_id AND r.ledger = NEW.ledger
  ) THEN
    RAISE EXCEPTION 'revaluations: adjusting exactly when a revaluation of the period and ledger stands'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF entry.posted_by_user_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'revaluations: a revaluation is its entry''s poster''s'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER revaluation_rules BEFORE INSERT ON revaluations
  FOR EACH ROW EXECUTE FUNCTION revaluation_rules();
--> statement-breakpoint
ALTER TABLE revaluations ENABLE ALWAYS TRIGGER revaluation_rules;
--> statement-breakpoint
-- Every revaluation entry, and its reversal, has its revaluation row when its transaction commits
-- (S07 "Data"): a revaluation is posted only by the revaluation service, with its reversal, never
-- alone.
CREATE FUNCTION journal_entry_revaluation_recorded() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.source = 'revaluation' AND NOT EXISTS (
    SELECT 1 FROM public.revaluations r
    WHERE r.company_id = NEW.company_id
      AND (r.entry_id = NEW.id OR r.reversal_entry_id = NEW.id)
  ) THEN
    RAISE EXCEPTION 'journal entry % is a revaluation without its revaluation row', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_revaluation_recorded AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_revaluation_recorded();
--> statement-breakpoint
ALTER TABLE journal_entries ENABLE ALWAYS TRIGGER journal_entries_revaluation_recorded;
--> statement-breakpoint
-- A movement as it is inserted (S04 "Data", rules 2–13; S07 rule 13; the posting function checks the
-- same first, with clear codes):
-- - it is its line's: the line's entry and its date, the line's three amounts; the line's account,
--   dimension set and currency are the item's;
-- - its kind fits the item and the line: a document item opens (a measured line) and clears (a
--   carried one); a running item adds (measured), clears (carried) and takes a void's difference
--   (a difference line); either is revalued (a difference line of a revaluation entry or its
--   reversal, with a transaction amount of zero), and a revaluation entry moves an item by
--   revaluations only; an item opens only in the entry that opened it, once, with its account's
--   normal balance (a receivable as a debit, so an advance is never a credit item on it; ADR 0013,
--   OPEN_ITEM_DIRECTION), or in that entry's reversal;
-- - `adjusted` exactly when a manual entry moves an item whose source is not manual (rule 8);
-- - the reversal of an opening waits for every other movement of the item to be reversed, by an
--   earlier entry or by that same one (OPEN_ITEM_HAS_SETTLEMENTS, rule 13; owner, 2026-11-06).
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
  SELECT i.account_id, i.dimension_set_id, i.currency, i.kind, i.source, i.opened_by_entry_id
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
  IF NEW.adjusted IS DISTINCT FROM (entry.source = 'manual' AND item.source <> 'manual') THEN
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
--> statement-breakpoint
-- An item's balance (ADR 0012, S04, S07): each movement adds its transaction amount to the item's
-- open amount, and its ledger amounts to its carrying amounts, or, a `revaluation` movement, to its
-- revaluation amounts instead (the parallel ones stay null and zero without a parallel ledger); the
-- row is made at the item's first movement, and its last movement date is a carrying movement's.
-- This is its only writer (open_item_balance_rules refuses a write that does not come from a
-- trigger).
CREATE OR REPLACE FUNCTION open_item_movement_balance() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  revalued boolean := NEW.kind = 'revaluation';
BEGIN
  INSERT INTO public.open_item_balances AS b (
    id, company_id, item_id, open_minor, book_minor, parallel_minor, revaluation_book_minor,
    revaluation_parallel_minor, movement_count, last_movement_on
  ) VALUES (
    public.new_uuidv7(), NEW.company_id, NEW.item_id, NEW.amount_minor,
    CASE WHEN revalued THEN 0 ELSE NEW.book_minor END,
    CASE WHEN revalued AND NEW.parallel_minor IS NOT NULL THEN 0 ELSE NEW.parallel_minor END,
    CASE WHEN revalued THEN NEW.book_minor ELSE 0 END,
    CASE WHEN revalued THEN coalesce(NEW.parallel_minor, 0) ELSE 0 END,
    1, NEW.entry_date
  )
  ON CONFLICT (company_id, item_id) DO UPDATE SET
    open_minor = b.open_minor + excluded.open_minor,
    book_minor = b.book_minor + excluded.book_minor,
    parallel_minor = b.parallel_minor + excluded.parallel_minor,
    revaluation_book_minor = b.revaluation_book_minor + excluded.revaluation_book_minor,
    revaluation_parallel_minor = b.revaluation_parallel_minor + excluded.revaluation_parallel_minor,
    movement_count = b.movement_count + 1,
    last_movement_on = CASE WHEN revalued THEN b.last_movement_on
      ELSE greatest(b.last_movement_on, excluded.last_movement_on) END,
    updated_at = now();
  RETURN NULL;
END
$$;
--> statement-breakpoint
-- Invariant 9 (ADR 0008, ADR 0013), at commit, on each item a transaction moved: its balance row,
-- read again so every firing judges the item as it stands, is the sum of its movements, the
-- carrying amounts of all but its revaluations and the revaluation amounts of those (S07); a
-- document item's open amount never has the opposite sign of its opening; and an item whose open
-- amount is zero carries zero in the book and parallel amounts too, its revaluations left out,
-- since they reverse. An item the check cannot see fails.
CREATE OR REPLACE FUNCTION open_item_balance_holds() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  balance record;
  totals record;
  item_kind text;
  opening bigint;
BEGIN
  SELECT b.open_minor, b.book_minor, b.parallel_minor, b.revaluation_book_minor,
         b.revaluation_parallel_minor, b.movement_count INTO balance
  FROM public.open_item_balances b
  WHERE b.company_id = NEW.company_id AND b.item_id = NEW.item_id;
  SELECT count(*) AS movements, coalesce(sum(m.amount_minor), 0) AS amount,
         coalesce(sum(m.book_minor) FILTER (WHERE m.kind <> 'revaluation'), 0) AS book,
         count(m.parallel_minor) AS parallel_movements,
         coalesce(sum(m.parallel_minor) FILTER (WHERE m.kind <> 'revaluation'), 0) AS parallel,
         coalesce(sum(m.book_minor) FILTER (WHERE m.kind = 'revaluation'), 0) AS revaluation_book,
         coalesce(sum(m.parallel_minor) FILTER (WHERE m.kind = 'revaluation'), 0)
           AS revaluation_parallel
    INTO totals
  FROM public.open_item_movements m
  WHERE m.company_id = NEW.company_id AND m.item_id = NEW.item_id;
  SELECT i.kind INTO item_kind
  FROM public.open_items i
  WHERE i.company_id = NEW.company_id AND i.id = NEW.item_id;
  IF balance.movement_count IS NULL OR item_kind IS NULL
    OR totals.movements <> balance.movement_count OR totals.amount <> balance.open_minor
    OR totals.book <> balance.book_minor
    OR totals.parallel_movements <> (CASE WHEN balance.parallel_minor IS NULL THEN 0
      ELSE totals.movements END)
    OR totals.parallel <> coalesce(balance.parallel_minor, 0)
    OR totals.revaluation_book <> balance.revaluation_book_minor
    OR totals.revaluation_parallel <> balance.revaluation_parallel_minor THEN
    RAISE EXCEPTION 'open item % is not the sum of its movements', NEW.item_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF item_kind = 'document' THEN
    SELECT m.amount_minor INTO opening
    FROM public.open_item_movements m
    JOIN public.open_items i ON i.company_id = m.company_id AND i.id = m.item_id
    WHERE m.company_id = NEW.company_id AND m.item_id = NEW.item_id AND m.kind = 'open'
      AND m.entry_id = i.opened_by_entry_id;
    IF opening IS NULL OR sign(balance.open_minor) = -sign(opening) THEN
      RAISE EXCEPTION 'open item % crosses zero against its opening (invariant 9)', NEW.item_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF balance.open_minor = 0 AND (balance.book_minor <> 0 OR coalesce(balance.parallel_minor, 0) <> 0) THEN
    RAISE EXCEPTION 'open item % is settled but not zero in every ledger (invariant 9)', NEW.item_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
