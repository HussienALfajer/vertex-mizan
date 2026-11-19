-- S13 (ADR 0024): project movements, their numbers and cancellations, a project's details and the
-- company's branding.
-- - `project_details` and `company_branding` are business data: the app role reads, adds and changes
--   them, never deletes them.
-- - `project_movements` and `project_movement_cancellations` are append-only;
--   `project_movement_sequences` is ledger state: made at 1, moved by one, every number taken by a
--   movement by commit (gapless).
-- - A movement takes the number its sequence just gave; its entry is the one its draft posted, on
--   its date in its fiscal year, reversing nothing; it is on a project (a contract value of kind
--   `project`) unless it is a deposit; a client's movement names the project's client.
-- - A cancellation's entry reverses its movement's entry, and every reversal of a movement's entry
--   is that movement's cancellation by commit, so the ledger and a movement's state never disagree.
ALTER TABLE project_movement_sequences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_movement_sequences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON project_movement_sequences
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE project_movements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_movements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON project_movements
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE project_movement_cancellations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_movement_cancellations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON project_movement_cancellations
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE project_details ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_details FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON project_details
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE company_branding ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_branding FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON company_branding
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON project_movement_sequences, project_movements, project_movement_cancellations,
  project_details, company_branding FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON project_movement_sequences, project_details, company_branding
  TO mizan_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON project_movements, project_movement_cancellations TO mizan_app;
--> statement-breakpoint
CREATE TRIGGER project_movements_refuse_change BEFORE UPDATE OR DELETE ON project_movements
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER project_movements_refuse_truncate BEFORE TRUNCATE ON project_movements
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE project_movements ENABLE ALWAYS TRIGGER project_movements_refuse_change;
--> statement-breakpoint
ALTER TABLE project_movements ENABLE ALWAYS TRIGGER project_movements_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER project_movement_cancellations_refuse_change BEFORE UPDATE OR DELETE
  ON project_movement_cancellations
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER project_movement_cancellations_refuse_truncate BEFORE TRUNCATE
  ON project_movement_cancellations
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE project_movement_cancellations
  ENABLE ALWAYS TRIGGER project_movement_cancellations_refuse_change;
--> statement-breakpoint
ALTER TABLE project_movement_cancellations
  ENABLE ALWAYS TRIGGER project_movement_cancellations_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER project_movement_sequences_refuse_delete BEFORE DELETE
  ON project_movement_sequences
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER project_movement_sequences_refuse_truncate BEFORE TRUNCATE
  ON project_movement_sequences
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE project_movement_sequences
  ENABLE ALWAYS TRIGGER project_movement_sequences_refuse_delete;
--> statement-breakpoint
ALTER TABLE project_movement_sequences
  ENABLE ALWAYS TRIGGER project_movement_sequences_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER project_details_refuse_delete BEFORE DELETE ON project_details
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER project_details_refuse_truncate BEFORE TRUNCATE ON project_details
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE project_details ENABLE ALWAYS TRIGGER project_details_refuse_delete;
--> statement-breakpoint
ALTER TABLE project_details ENABLE ALWAYS TRIGGER project_details_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER company_branding_refuse_delete BEFORE DELETE ON company_branding
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER company_branding_refuse_truncate BEFORE TRUNCATE ON company_branding
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE company_branding ENABLE ALWAYS TRIGGER company_branding_refuse_delete;
--> statement-breakpoint
ALTER TABLE company_branding ENABLE ALWAYS TRIGGER company_branding_refuse_truncate;
--> statement-breakpoint
-- A fiscal year's movement numbers start at 1 and move by one at a time (S13 rule 1).
CREATE FUNCTION project_movement_sequence_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.last_number <> 1 THEN
      RAISE EXCEPTION 'project_movement_sequences: a fiscal year''s numbers start at 1'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.fiscal_year, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.fiscal_year, OLD.created_at)
    OR NEW.last_number IS DISTINCT FROM OLD.last_number + 1 THEN
    RAISE EXCEPTION 'project_movement_sequences: a sequence moves by one number at a time'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER project_movement_sequence_rules BEFORE INSERT OR UPDATE
  ON project_movement_sequences
  FOR EACH ROW EXECUTE FUNCTION project_movement_sequence_rules();
--> statement-breakpoint
ALTER TABLE project_movement_sequences ENABLE ALWAYS TRIGGER project_movement_sequence_rules;
--> statement-breakpoint
-- Every number a sequence gives is taken by a movement of its fiscal year by commit, so no number
-- is skipped. Deferred: the movement is inserted after its sequence moves and its entry posts.
CREATE FUNCTION project_movement_sequence_used() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.project_movements m
    WHERE m.company_id = NEW.company_id AND m.fiscal_year = NEW.fiscal_year
      AND m.number = NEW.last_number
  ) THEN
    RAISE EXCEPTION 'movement number % of fiscal year % was given but no movement took it',
      NEW.last_number, NEW.fiscal_year
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER project_movement_sequence_used AFTER INSERT OR UPDATE
  ON project_movement_sequences DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION project_movement_sequence_used();
--> statement-breakpoint
ALTER TABLE project_movement_sequences ENABLE ALWAYS TRIGGER project_movement_sequence_used;
--> statement-breakpoint
-- A movement (S13 "Data", rule 1): the number its fiscal year's sequence just gave; its entry posted
-- from its draft on its date in its fiscal year, reversing nothing; a project (a contract value of
-- kind `project`) unless it is a deposit; and for the client's kinds, the project's client.
CREATE FUNCTION project_movement_rules() RETURNS trigger
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
--> statement-breakpoint
CREATE TRIGGER project_movement_rules BEFORE INSERT ON project_movements
  FOR EACH ROW EXECUTE FUNCTION project_movement_rules();
--> statement-breakpoint
ALTER TABLE project_movements ENABLE ALWAYS TRIGGER project_movement_rules;
--> statement-breakpoint
-- A cancellation (S13 rule 8): its entry reverses exactly its movement's entry.
CREATE FUNCTION project_movement_cancellation_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  original uuid;
  reversed uuid;
BEGIN
  SELECT m.entry_id INTO original
  FROM public.project_movements m
  WHERE m.company_id = NEW.company_id AND m.id = NEW.movement_id;
  SELECT e.reverses_entry_id INTO reversed
  FROM public.journal_entries e
  WHERE e.company_id = NEW.company_id AND e.id = NEW.reversal_entry_id;
  IF original IS NULL OR reversed IS DISTINCT FROM original THEN
    RAISE EXCEPTION 'project_movement_cancellations: its entry reverses its movement''s entry'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER project_movement_cancellation_rules BEFORE INSERT
  ON project_movement_cancellations
  FOR EACH ROW EXECUTE FUNCTION project_movement_cancellation_rules();
--> statement-breakpoint
ALTER TABLE project_movement_cancellations
  ENABLE ALWAYS TRIGGER project_movement_cancellation_rules;
--> statement-breakpoint
-- Every reversal of a movement's entry is that movement's cancellation by commit (S13 rule 8), so
-- no route reverses a movement's entry without its cancellation row. Deferred: the cancellation is
-- written after its reversal posts.
CREATE FUNCTION journal_entry_movement_cancelled() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.reverses_entry_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.project_movements m
      WHERE m.company_id = NEW.company_id AND m.entry_id = NEW.reverses_entry_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.project_movement_cancellations c
      WHERE c.company_id = NEW.company_id AND c.reversal_entry_id = NEW.id
    ) THEN
    RAISE EXCEPTION 'journal_entries: reversal % of a movement''s entry is its cancellation', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entry_movement_cancelled AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_movement_cancelled();
--> statement-breakpoint
ALTER TABLE journal_entries ENABLE ALWAYS TRIGGER journal_entry_movement_cancelled;
