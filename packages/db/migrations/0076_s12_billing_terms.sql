-- S12 PR 3 (0075's columns): a billing keeps the contract value and the retention and recovery
-- rates it was posted under, so its print never shows terms changed after it. Replaced in place
-- with its new pin (`test/conventions.ts`):
-- - `project_document_rules()`: as 0073, and a billing's `contract_value_minor`, `retention_bp` and
--   `advance_recovery_bp` are those of its project's terms (a progress billing) or of its
--   subcontract (a subcontractor's billing) when it posts, the rates never null. A billing posted
--   before 0075 keeps none; the table is append-only, so nothing backfills it.
CREATE OR REPLACE FUNCTION project_document_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  draft record;
  given integer;
  entry record;
  client uuid;
  latest record;
  next_sequence integer;
  terms record;
BEGIN
  SELECT d.state, d.archived_at, d.entry_date, d.project_document_kind, d.contract_value_id,
    d.counterparty_value_id, d.side, d.period_from, d.period_to, d.supplier_reference,
    d.document_currency, d.cumulative_minor, d.retention_minor, d.advance_minor
  INTO draft
  FROM public.entry_drafts d
  WHERE d.company_id = NEW.company_id AND d.id = NEW.draft_id
  FOR SHARE;
  -- A progress billing and a client's release name the project's client as their counterparty.
  SELECT v.parent_value_id INTO client
  FROM public.dimension_values v
  WHERE v.company_id = NEW.company_id AND v.id = NEW.contract_value_id;
  IF NOT FOUND OR draft.state = 'posted' OR draft.archived_at IS NOT NULL
    OR draft.project_document_kind IS DISTINCT FROM NEW.kind
    OR draft.entry_date IS DISTINCT FROM NEW.document_date
    OR (draft.contract_value_id, draft.side, draft.period_from, draft.period_to,
      draft.supplier_reference)
      IS DISTINCT FROM (NEW.contract_value_id, NEW.side, NEW.period_from, NEW.period_to,
        NEW.supplier_reference)
    OR (CASE
      WHEN NEW.kind = 'progress_billing'
        OR (NEW.kind = 'retention_release' AND NEW.side = 'client')
        THEN draft.counterparty_value_id IS NOT NULL OR client IS NULL
          OR NEW.counterparty_value_id IS DISTINCT FROM client
      ELSE draft.counterparty_value_id IS DISTINCT FROM NEW.counterparty_value_id
    END)
    OR (draft.document_currency IS NOT NULL AND draft.document_currency <> NEW.currency)
    OR (NEW.cumulative_minor IS NOT NULL AND NEW.cumulative_minor IS DISTINCT FROM draft.cumulative_minor)
    OR (NEW.kind IN ('progress_billing', 'subcontract_billing')
      AND ((draft.retention_minor IS NOT NULL AND draft.retention_minor <> NEW.retention_minor)
        OR (draft.advance_minor IS NOT NULL AND draft.advance_minor <> NEW.advance_minor)))
    OR (NEW.kind = 'retention_release' AND NEW.side = 'supplier'
      AND draft.retention_minor IS DISTINCT FROM NEW.retention_minor) THEN
    RAISE EXCEPTION 'project_documents: a document is its own project document draft''s, as prepared'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT s.last_number INTO given
  FROM public.project_document_sequences s
  WHERE s.company_id = NEW.company_id AND s.kind = NEW.kind AND s.fiscal_year = NEW.fiscal_year;
  IF given IS DISTINCT FROM NEW.number THEN
    RAISE EXCEPTION 'project_documents: a document takes the number its sequence just gave'
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- A billing (S12 rules 14, 16): the next number within its project or subcontract, its previous
  -- the cumulative of the latest uncancelled billing there, dated on or after it. The ledger head,
  -- locked first, serialises two billings of one project.
  IF NEW.kind IN ('progress_billing', 'subcontract_billing') THEN
    PERFORM 1 FROM public.ledger_heads h WHERE h.company_id = NEW.company_id FOR UPDATE;
    SELECT coalesce(max(d.project_sequence), 0) + 1 INTO next_sequence
    FROM public.project_documents d
    WHERE d.company_id = NEW.company_id AND d.kind = NEW.kind
      AND d.contract_value_id = NEW.contract_value_id
      AND (NEW.kind = 'progress_billing' OR d.counterparty_value_id = NEW.counterparty_value_id);
    SELECT d.cumulative_minor, d.document_date INTO latest
    FROM public.project_documents d
    WHERE d.company_id = NEW.company_id AND d.kind = NEW.kind
      AND d.contract_value_id = NEW.contract_value_id
      AND (NEW.kind = 'progress_billing' OR d.counterparty_value_id = NEW.counterparty_value_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries r
        WHERE r.company_id = d.company_id AND r.reverses_entry_id = d.entry_id)
    ORDER BY d.project_sequence DESC
    LIMIT 1;
    IF NEW.project_sequence IS DISTINCT FROM next_sequence
      OR NEW.previous_minor IS DISTINCT FROM coalesce(latest.cumulative_minor, 0)
      OR NEW.document_date < latest.document_date THEN
      RAISE EXCEPTION 'project_documents: a billing follows the latest billing of its project'
        USING ERRCODE = 'restrict_violation';
    END IF;
    -- 0075: a billing keeps the contract value and rates of its project's terms, or of its
    -- subcontract, as they stand when it posts.
    IF NEW.kind = 'progress_billing' THEN
      SELECT t.contract_value_minor AS value_minor, t.retention_bp, t.advance_recovery_bp
      INTO terms
      FROM public.project_terms t
      WHERE t.company_id = NEW.company_id AND t.contract_value_id = NEW.contract_value_id;
    ELSE
      SELECT s.value_minor, s.retention_bp, s.advance_recovery_bp INTO terms
      FROM public.subcontracts s
      WHERE s.company_id = NEW.company_id AND s.contract_value_id = NEW.contract_value_id
        AND s.supplier_value_id = NEW.counterparty_value_id AND s.archived_at IS NULL;
    END IF;
    IF NOT FOUND OR NEW.retention_bp IS NULL OR NEW.advance_recovery_bp IS NULL
      OR (NEW.contract_value_minor, NEW.retention_bp, NEW.advance_recovery_bp)
        IS DISTINCT FROM (terms.value_minor, terms.retention_bp, terms.advance_recovery_bp) THEN
      RAISE EXCEPTION 'project_documents: a billing keeps the terms it is posted under'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  SELECT e.draft_id, e.entry_date, e.fiscal_year, e.source, e.reverses_entry_id INTO entry
  FROM public.journal_entries e
  WHERE e.company_id = NEW.company_id AND e.id = NEW.entry_id;
  IF NOT FOUND OR entry.draft_id IS DISTINCT FROM NEW.draft_id
    OR entry.entry_date <> NEW.document_date OR entry.fiscal_year <> NEW.fiscal_year
    OR entry.source <> 'manual' OR entry.reverses_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'project_documents: a document''s entry is posted from its draft, on its date'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
