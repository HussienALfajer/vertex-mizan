-- S12 PR 1, review: a line's quantity reads its material `FOR SHARE` (S12 rule 3). Without the lock,
-- a unit changed by another transaction while a line naming the material is being posted would
-- commit beside it: neither guard sees the other's uncommitted row. With it, the unit's change
-- waits for the posting, and `material_rules()` then sees the line and refuses. Replaced in place
-- with its new pin (`test/conventions.ts`).
CREATE OR REPLACE FUNCTION line_quantity_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  line record;
  material_unit text;
  original record;
BEGIN
  SELECT l.entry_id, l.line_no, l.kind, l.currency, l.amount_minor, a.requires_material,
    e.sequence, e.reverses_entry_id, h.entry_count
  INTO line
  FROM public.journal_lines l
  JOIN public.journal_entries e ON e.company_id = l.company_id AND e.id = l.entry_id
  JOIN public.ledger_heads h ON h.company_id = e.company_id
  JOIN public.chart_accounts a ON a.company_id = l.company_id AND a.id = l.account_id
  WHERE l.company_id = NEW.company_id AND l.id = NEW.line_id;
  IF NOT FOUND OR line.entry_id <> NEW.entry_id OR line.kind <> 'measured'
    OR line.sequence <> line.entry_count + 1 THEN
    RAISE EXCEPTION 'line_quantities: a quantity is added only to a measured line of the entry being posted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.material_id IS NOT NULL) <> line.requires_material THEN
    RAISE EXCEPTION 'line_quantities: a line names a material exactly when its account requires one'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.material_id IS NOT NULL THEN
    SELECT m.unit INTO material_unit
    FROM public.materials m
    WHERE m.company_id = NEW.company_id AND m.id = NEW.material_id
    FOR SHARE;
    IF material_unit IS DISTINCT FROM NEW.unit THEN
      RAISE EXCEPTION 'line_quantities: a material''s line is in the material''s unit'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW.quantity <> 0 AND line.amount_minor
    <> round(NEW.quantity * NEW.unit_price * power(10::numeric, public.currency_exponent(line.currency)))
  THEN
    RAISE EXCEPTION 'line_quantities: a line''s amount is its quantity times its unit price, rounded'
      USING ERRCODE = 'check_violation';
  END IF;
  IF line.reverses_entry_id IS NOT NULL THEN
    SELECT q.material_id, q.unit, q.quantity, q.unit_price INTO original
    FROM public.journal_lines o
    JOIN public.line_quantities q ON q.company_id = o.company_id AND q.line_id = o.id
    WHERE o.company_id = NEW.company_id AND o.entry_id = line.reverses_entry_id
      AND o.line_no = line.line_no;
    IF NOT FOUND OR (original.material_id, original.unit, -original.quantity, original.unit_price)
      IS DISTINCT FROM (NEW.material_id, NEW.unit, NEW.quantity, NEW.unit_price) THEN
      RAISE EXCEPTION 'line_quantities: a reversal''s line carries its original''s quantity negated'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
