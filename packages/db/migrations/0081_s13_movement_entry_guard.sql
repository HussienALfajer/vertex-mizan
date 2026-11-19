-- S13 review: a movement records the entry posted just before it, in its currency, never reversed.
-- `project_movement_rules()` replaced in place (pinned): as `0080`, and the movement's entry is the
-- ledger head's latest entry (the one its posting transaction just wrote), has a line in the
-- movement's currency, and has no reversal, so no movement is attached to an older or cancelled
-- entry and the ledger and a movement's state never disagree.
CREATE OR REPLACE FUNCTION project_movement_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  given integer;
  entry record;
  project record;
BEGIN
  SELECT s.last_number INTO given
  FROM public.project_movement_sequences s
  WHERE s.company_id = NEW.company_id AND s.fiscal_year = NEW.fiscal_year;
  IF given IS DISTINCT FROM NEW.number THEN
    RAISE EXCEPTION 'project_movements: a movement takes the number its sequence just gave'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT e.draft_id, e.entry_date, e.fiscal_year, e.source, e.reverses_entry_id INTO entry
  FROM public.journal_entries e
  WHERE e.company_id = NEW.company_id AND e.id = NEW.entry_id;
  IF NOT FOUND OR entry.draft_id IS DISTINCT FROM NEW.draft_id
    OR entry.entry_date <> NEW.movement_date OR entry.fiscal_year <> NEW.fiscal_year
    OR entry.source <> 'manual' OR entry.reverses_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'project_movements: a movement''s entry is posted from its draft, on its date'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_heads h
    WHERE h.company_id = NEW.company_id AND h.last_entry_id = NEW.entry_id
  ) THEN
    RAISE EXCEPTION 'project_movements: a movement records the entry posted just before it'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.journal_lines l
    WHERE l.company_id = NEW.company_id AND l.entry_id = NEW.entry_id
      AND l.currency = NEW.currency
  ) OR EXISTS (
    SELECT 1 FROM public.journal_entries r
    WHERE r.company_id = NEW.company_id AND r.reverses_entry_id = NEW.entry_id
  ) THEN
    RAISE EXCEPTION 'project_movements: a movement''s entry is in its currency and not reversed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.contract_value_id IS NOT NULL THEN
    SELECT v.contract_kind, v.parent_value_id INTO project
    FROM public.dimension_values v
    WHERE v.company_id = NEW.company_id AND v.id = NEW.contract_value_id;
    IF NOT FOUND OR project.contract_kind IS DISTINCT FROM 'project' THEN
      RAISE EXCEPTION 'project_movements: a movement is on a project'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.kind IN ('received', 'owed_to_us', 'debt_collected')
      AND NEW.counterparty_value_id IS DISTINCT FROM project.parent_value_id THEN
      RAISE EXCEPTION 'project_movements: a client''s movement names the project''s client'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
