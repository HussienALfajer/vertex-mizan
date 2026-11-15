-- S11 PR 1 (owner, 2026-11-15, after the accounting review; `opening/opening-entry.md`, the case
-- "Contracting: advances opened as non-monetary running items"): a non-monetary running control
-- account (`212002` advances from clients, `114002` advances to suppliers) opens its counterparty's
-- item in the opening entry on a `stated` line, its book and parallel amounts the records' (IAS 21.23(b),
-- IFRIC 22). So an `add` movement of a running item may sit on a `stated` line of an entry whose
-- source is `opening` (the opening and its whole reversal), and nowhere else; every other movement
-- keeps its line's kind. Every other rule is 0063's.
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
    i.hub_document, i.counterparty_value_id
    INTO item
  FROM public.open_items i
  WHERE i.company_id = NEW.company_id AND i.id = NEW.item_id;
  IF line.entry_id IS NULL OR entry.entry_date IS NULL OR item.account_id IS NULL
    OR NEW.entry_id <> line.entry_id OR NEW.entry_date <> entry.entry_date
    OR (line.account_id, line.currency) IS DISTINCT FROM (item.account_id, item.currency)
    OR (item.kind = 'document' AND line.dimension_set_id IS DISTINCT FROM item.dimension_set_id)
    OR (item.kind = 'running' AND line.dimension_set_id IS DISTINCT FROM item.dimension_set_id
      AND NOT EXISTS (
        SELECT 1 FROM public.dimension_set_values v
        WHERE v.company_id = NEW.company_id AND v.set_id = line.dimension_set_id
          AND v.value_id = item.counterparty_value_id
      ))
    OR (NEW.amount_minor, NEW.book_minor, NEW.parallel_minor)
      IS DISTINCT FROM (line.amount_minor, line.book_minor, line.parallel_minor) THEN
    RAISE EXCEPTION 'open_item_movements: a movement is its line''s, on its line''s item'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (
    (item.kind = 'document' AND NEW.kind IN ('open', 'clear', 'revaluation'))
    OR (item.kind = 'running' AND NEW.kind IN ('add', 'clear', 'difference', 'revaluation'))
  ) OR (line.kind IS DISTINCT FROM (CASE NEW.kind
      WHEN 'open' THEN 'measured' WHEN 'add' THEN 'measured'
      WHEN 'clear' THEN 'carried' WHEN 'difference' THEN 'difference'
      WHEN 'revaluation' THEN 'difference' END)
      AND NOT (NEW.kind = 'add' AND line.kind = 'stated' AND entry.source = 'opening'))
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
