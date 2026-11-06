-- The guards and grants of S04's open-item tables (0021), as packages/db/CLAUDE.md and the
-- /db-migration skill write them (ADR 0005, ADR 0008, ADR 0012, ADR 0013):
-- - forced RLS with the one company_isolation policy on every table;
-- - the append-only items, movements and due dates: SELECT, INSERT for the app role,
--   refuse_change() for every role;
-- - the items' balances (ledger state): SELECT, INSERT, UPDATE for the app role, refuse_delete()
--   for every role, written only by the trigger on movements;
-- - an item's account, kind, client and currency (on insert); a movement agrees with its line and
--   its item, and an opening is reversed only once its item's other movements are (on insert);
-- - every item is opened by a movement of its opening entry, every line on a control account has
--   its one movement, a reversal moves its original's items back exactly, and invariant 9 holds on
--   every item (deferred to commit);
-- - a due date only on a document item, a person's only on a manual item (on insert).
-- Every trigger is ENABLE ALWAYS (ADR 0008); every guard function is pinned in test/conventions.ts
-- and names its tables with the schema. Locks follow one order: the ledger head, then the period,
-- then an item's balance row. Nothing is granted to mizan_jobs, mizan_queue or PUBLIC; no function
-- is SECURITY DEFINER.
ALTER TABLE open_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE open_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON open_items
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE open_item_movements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE open_item_movements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON open_item_movements
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE open_item_due_dates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE open_item_due_dates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON open_item_due_dates
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE open_item_balances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE open_item_balances FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON open_item_balances
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON open_items, open_item_movements, open_item_due_dates, open_item_balances FROM PUBLIC;
--> statement-breakpoint
-- The append-only items, movements and due dates: the app role reads and adds only (ADR 0005).
GRANT SELECT, INSERT ON open_items, open_item_movements, open_item_due_dates TO mizan_app;
--> statement-breakpoint
-- The items' balances: the app role reads, adds and moves them, never deletes (ADR 0012).
GRANT SELECT, INSERT, UPDATE ON open_item_balances TO mizan_app;
--> statement-breakpoint
-- refuse_change() on the append-only tables: no UPDATE, DELETE or TRUNCATE for any role.
CREATE TRIGGER open_items_refuse_change BEFORE UPDATE OR DELETE ON open_items
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER open_items_refuse_truncate BEFORE TRUNCATE ON open_items
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE open_items ENABLE ALWAYS TRIGGER open_items_refuse_change;
--> statement-breakpoint
ALTER TABLE open_items ENABLE ALWAYS TRIGGER open_items_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER open_item_movements_refuse_change BEFORE UPDATE OR DELETE ON open_item_movements
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER open_item_movements_refuse_truncate BEFORE TRUNCATE ON open_item_movements
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE open_item_movements ENABLE ALWAYS TRIGGER open_item_movements_refuse_change;
--> statement-breakpoint
ALTER TABLE open_item_movements ENABLE ALWAYS TRIGGER open_item_movements_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER open_item_due_dates_refuse_change BEFORE UPDATE OR DELETE ON open_item_due_dates
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER open_item_due_dates_refuse_truncate BEFORE TRUNCATE ON open_item_due_dates
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE open_item_due_dates ENABLE ALWAYS TRIGGER open_item_due_dates_refuse_change;
--> statement-breakpoint
ALTER TABLE open_item_due_dates ENABLE ALWAYS TRIGGER open_item_due_dates_refuse_truncate;
--> statement-breakpoint
-- refuse_delete() on the items' balances: no DELETE or TRUNCATE for any role (ADR 0012).
CREATE TRIGGER open_item_balances_refuse_delete BEFORE DELETE ON open_item_balances
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER open_item_balances_refuse_truncate BEFORE TRUNCATE ON open_item_balances
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE open_item_balances ENABLE ALWAYS TRIGGER open_item_balances_refuse_delete;
--> statement-breakpoint
ALTER TABLE open_item_balances ENABLE ALWAYS TRIGGER open_item_balances_refuse_truncate;
--> statement-breakpoint
-- An item as it is inserted (S04 "Data", ADR 0013): on a postable control account of its kind,
-- read FOR SHARE so the account cannot change meanwhile; in the account's currency restriction;
-- its client is its dimension set's client value (none when the set has none), and a running item
-- has one; opened by an entry of its company.
CREATE FUNCTION open_item_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  account record;
  set_client uuid;
BEGIN
  SELECT a.kind, a.is_control, a.item_kind, a.currency INTO account
  FROM public.chart_accounts a
  WHERE a.company_id = NEW.company_id AND a.id = NEW.account_id
  FOR SHARE;
  IF NOT FOUND OR account.kind <> 'postable' OR NOT account.is_control
    OR account.item_kind IS DISTINCT FROM NEW.kind THEN
    RAISE EXCEPTION 'open_items: an item is on a control account of its kind'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF account.currency IS NOT NULL AND account.currency <> NEW.currency THEN
    RAISE EXCEPTION 'open_items: account % takes % items, not %', NEW.account_id,
      account.currency, NEW.currency
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT v.value_id INTO set_client
  FROM public.dimension_set_values v
  JOIN public.dimension_types t ON t.company_id = v.company_id AND t.id = v.type_id
  WHERE v.company_id = NEW.company_id AND v.set_id = NEW.dimension_set_id AND t.code = 'client';
  IF set_client IS DISTINCT FROM NEW.client_value_id THEN
    RAISE EXCEPTION 'open_items: an item''s client is its dimension set''s'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.company_id = NEW.company_id AND e.id = NEW.opened_by_entry_id
  ) THEN
    RAISE EXCEPTION 'open_items: an item is opened by an entry of its company'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER open_item_rules BEFORE INSERT ON open_items
  FOR EACH ROW EXECUTE FUNCTION open_item_rules();
--> statement-breakpoint
ALTER TABLE open_items ENABLE ALWAYS TRIGGER open_item_rules;
--> statement-breakpoint
-- A movement as it is inserted (S04 "Data", rules 2–13; the posting function checks the same
-- first, with clear codes):
-- - it is its line's: the line's entry and its date, the line's three amounts; the line's account,
--   dimension set and currency are the item's;
-- - its kind fits the item and the line: a document item opens (a measured line) and clears (a
--   carried one); a running item adds (measured), clears (carried) and takes a void's difference
--   (a difference line); an item opens only in the entry that opened it, once, with its account's
--   normal balance (a receivable as a debit, so an advance is never a credit item on it; ADR 0013,
--   OPEN_ITEM_DIRECTION), or in that entry's reversal;
-- - `adjusted` exactly when a manual entry moves an item whose source is not manual (rule 8);
-- - the reversal of an opening waits for every other movement of the item to be reversed, by an
--   earlier entry or by that same one (OPEN_ITEM_HAS_SETTLEMENTS, rule 13; owner, 2026-11-06).
CREATE FUNCTION open_item_movement_rules() RETURNS trigger
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
    (item.kind = 'document' AND NEW.kind IN ('open', 'clear'))
    OR (item.kind = 'running' AND NEW.kind IN ('add', 'clear', 'difference'))
  ) OR line.kind IS DISTINCT FROM (CASE NEW.kind
      WHEN 'open' THEN 'measured' WHEN 'add' THEN 'measured'
      WHEN 'clear' THEN 'carried' WHEN 'difference' THEN 'difference' END) THEN
    RAISE EXCEPTION 'open_item_movements: a % movement does not fit a % item on a % line',
      NEW.kind, item.kind, line.kind
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
CREATE TRIGGER open_item_movement_rules BEFORE INSERT ON open_item_movements
  FOR EACH ROW EXECUTE FUNCTION open_item_movement_rules();
--> statement-breakpoint
ALTER TABLE open_item_movements ENABLE ALWAYS TRIGGER open_item_movement_rules;
--> statement-breakpoint
-- Every item is opened by a movement of the entry that opened it, at commit (S04 rules 2 and 3): a
-- document item's `open`, a running item's first `add`; that entry is not a reversal, and a manual
-- item's document date is its date (rule 6). An item made without its posting, by any role, fails
-- here: an old entry gains no line, and a line moves one item only.
CREATE FUNCTION open_item_opened() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  opening record;
BEGIN
  SELECT e.entry_date, e.reverses_entry_id INTO opening
  FROM public.journal_entries e
  WHERE e.company_id = NEW.company_id AND e.id = NEW.opened_by_entry_id;
  IF opening.entry_date IS NULL OR opening.reverses_entry_id IS NOT NULL
    OR (NEW.source = 'manual' AND opening.entry_date <> NEW.document_date)
    OR NOT EXISTS (
      SELECT 1 FROM public.open_item_movements m
      WHERE m.company_id = NEW.company_id AND m.item_id = NEW.id
        AND m.entry_id = NEW.opened_by_entry_id
        AND m.kind = (CASE NEW.kind WHEN 'document' THEN 'open' ELSE 'add' END)
    ) THEN
    RAISE EXCEPTION 'open item % is not opened by a movement of its opening entry', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER open_items_opened AFTER INSERT ON open_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION open_item_opened();
--> statement-breakpoint
ALTER TABLE open_items ENABLE ALWAYS TRIGGER open_items_opened;
--> statement-breakpoint
-- An item's balance (ADR 0012, S04): each movement adds its three amounts to its item's row, made
-- at the item's first movement; the parallel amount stays null without a parallel ledger. This is
-- its only writer (open_item_balance_rules refuses a write that does not come from a trigger).
CREATE FUNCTION open_item_movement_balance() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  INSERT INTO public.open_item_balances AS b (
    id, company_id, item_id, open_minor, book_minor, parallel_minor, movement_count,
    last_movement_on
  ) VALUES (
    public.new_uuidv7(), NEW.company_id, NEW.item_id, NEW.amount_minor, NEW.book_minor,
    NEW.parallel_minor, 1, NEW.entry_date
  )
  ON CONFLICT (company_id, item_id) DO UPDATE SET
    open_minor = b.open_minor + excluded.open_minor,
    book_minor = b.book_minor + excluded.book_minor,
    parallel_minor = b.parallel_minor + excluded.parallel_minor,
    movement_count = b.movement_count + 1,
    last_movement_on = greatest(b.last_movement_on, excluded.last_movement_on),
    updated_at = now();
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER open_item_movement_balance AFTER INSERT ON open_item_movements
  FOR EACH ROW EXECUTE FUNCTION open_item_movement_balance();
--> statement-breakpoint
ALTER TABLE open_item_movements ENABLE ALWAYS TRIGGER open_item_movement_balance;
--> statement-breakpoint
-- An item's balance is written only by open_item_movement_balance(), a trigger on movement inserts:
-- a write at trigger depth 1 comes from a statement, not from a movement, and is refused for every
-- role. It is made at one movement; its key and creation never change, each update adds exactly
-- one movement, its parallel amount stays set or null, and its last movement date never goes back.
CREATE FUNCTION open_item_balance_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'open_item_balances: written only by the trigger on open_item_movements'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.movement_count <> 1 THEN
    RAISE EXCEPTION 'open_item_balances: an item''s balance is made at its first movement'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    (NEW.id, NEW.company_id, NEW.item_id, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.item_id, OLD.created_at)
    OR NEW.movement_count <> OLD.movement_count + 1
    OR (NEW.parallel_minor IS NULL) <> (OLD.parallel_minor IS NULL)
    OR NEW.last_movement_on < OLD.last_movement_on
  ) THEN
    RAISE EXCEPTION 'open_item_balances: an item''s balance keeps its key and moves by one movement'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER open_item_balance_rules BEFORE INSERT OR UPDATE ON open_item_balances
  FOR EACH ROW EXECUTE FUNCTION open_item_balance_rules();
--> statement-breakpoint
ALTER TABLE open_item_balances ENABLE ALWAYS TRIGGER open_item_balance_rules;
--> statement-breakpoint
-- Invariant 9 (ADR 0008, ADR 0013), at commit, on each item a transaction moved: its balance row,
-- read again so every firing judges the item as it stands, is the sum of its movements; a document
-- item's open amount never has the opposite sign of its opening; and an item whose open amount is
-- zero is zero in the book and parallel amounts too (S07 will leave out its revaluations, which
-- reverse). An item the check cannot see fails.
CREATE FUNCTION open_item_balance_holds() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  balance record;
  totals record;
  item_kind text;
  opening bigint;
BEGIN
  SELECT b.open_minor, b.book_minor, b.parallel_minor, b.movement_count INTO balance
  FROM public.open_item_balances b
  WHERE b.company_id = NEW.company_id AND b.item_id = NEW.item_id;
  SELECT count(*) AS movements, coalesce(sum(m.amount_minor), 0) AS amount,
         coalesce(sum(m.book_minor), 0) AS book, count(m.parallel_minor) AS parallel_movements,
         coalesce(sum(m.parallel_minor), 0) AS parallel
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
    OR totals.parallel <> coalesce(balance.parallel_minor, 0) THEN
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
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER open_item_balances_hold AFTER INSERT OR UPDATE ON open_item_balances
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION open_item_balance_holds();
--> statement-breakpoint
ALTER TABLE open_item_balances ENABLE ALWAYS TRIGGER open_item_balances_hold;
--> statement-breakpoint
-- Every line on a control account moves its item by exactly one movement, and no other line moves
-- one (S04 "Data"), when its transaction commits: the movements follow the lines. With the unique
-- line of a movement and its insert rules, a line and its movement agree in account, dimension
-- set, currency and every amount.
CREATE FUNCTION journal_line_moves_item() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  is_control boolean;
  movements integer;
BEGIN
  SELECT a.is_control INTO is_control
  FROM public.chart_accounts a
  WHERE a.company_id = NEW.company_id AND a.id = NEW.account_id;
  SELECT count(*) INTO movements
  FROM public.open_item_movements m
  WHERE m.company_id = NEW.company_id AND m.line_id = NEW.id;
  IF is_control IS NULL OR movements <> (CASE WHEN is_control THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION 'journal line %: % item movements on an account that is % control account',
      NEW.id, movements, CASE WHEN is_control THEN 'a' ELSE 'not a' END
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_move_items AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_line_moves_item();
--> statement-breakpoint
ALTER TABLE journal_lines ENABLE ALWAYS TRIGGER journal_lines_move_items;
--> statement-breakpoint
-- A reversal moves its original's items back exactly (ADR 0005 invariant 3, S04 rule 13): its
-- movements negate the original's, item by item and kind by kind, as its lines negate the
-- original's lines. Deferred: the movements follow the entry.
CREATE FUNCTION journal_entry_reverses_items() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.reverses_entry_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF (SELECT count(*) FROM public.open_item_movements m
      WHERE m.company_id = NEW.company_id AND m.entry_id = NEW.reverses_entry_id)
    <> (SELECT count(*) FROM public.open_item_movements m
      WHERE m.company_id = NEW.company_id AND m.entry_id = NEW.id)
    OR EXISTS (
      SELECT m.item_id, m.kind, -m.amount_minor, -m.book_minor, -m.parallel_minor
      FROM public.open_item_movements m
      WHERE m.company_id = NEW.company_id AND m.entry_id = NEW.reverses_entry_id
      EXCEPT ALL
      SELECT r.item_id, r.kind, r.amount_minor, r.book_minor, r.parallel_minor
      FROM public.open_item_movements r
      WHERE r.company_id = NEW.company_id AND r.entry_id = NEW.id
    ) THEN
    RAISE EXCEPTION 'journal entry % does not move the items of entry % back exactly', NEW.id,
      NEW.reverses_entry_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_reverse_items AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_reverses_items();
--> statement-breakpoint
ALTER TABLE journal_entries ENABLE ALWAYS TRIGGER journal_entries_reverse_items;
--> statement-breakpoint
-- A due date as it is set (S04 rules 6, 14, 15): on a document item only; at the opening, the
-- item's first, effective on its document date and not before it; by a person, only on a manual
-- item (a Hub item's due date comes from Hub, OPEN_ITEM_FROM_HUB), with a reason, effective on the
-- day of the change in Damascus; from a Hub event, only on a Hub item.
CREATE FUNCTION open_item_due_date_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  item record;
BEGIN
  SELECT i.kind, i.source, i.document_date INTO item
  FROM public.open_items i
  WHERE i.company_id = NEW.company_id AND i.id = NEW.item_id;
  IF NOT FOUND OR item.kind <> 'document' THEN
    RAISE EXCEPTION 'open_item_due_dates: a due date is a document item''s'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.set_by = 'opening' AND (
    NEW.effective_on <> item.document_date OR NEW.due_on < item.document_date
    OR EXISTS (
      SELECT 1 FROM public.open_item_due_dates d
      WHERE d.company_id = NEW.company_id AND d.item_id = NEW.item_id
    )
  ) THEN
    RAISE EXCEPTION 'open_item_due_dates: an opening due date is the item''s first, from its document date'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.set_by = 'user' AND (
    item.source <> 'manual'
    OR NEW.effective_on <> (now() AT TIME ZONE 'Asia/Damascus')::date
  ) THEN
    RAISE EXCEPTION 'open_item_due_dates: OPEN_ITEM_FROM_HUB: a person changes a manual item''s due date, from the day of the change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.set_by = 'hub_event' AND item.source <> 'hub_event' THEN
    RAISE EXCEPTION 'open_item_due_dates: a Hub event sets a Hub item''s due date'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER open_item_due_date_rules BEFORE INSERT ON open_item_due_dates
  FOR EACH ROW EXECUTE FUNCTION open_item_due_date_rules();
--> statement-breakpoint
ALTER TABLE open_item_due_dates ENABLE ALWAYS TRIGGER open_item_due_date_rules;
