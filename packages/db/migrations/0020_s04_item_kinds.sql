-- The item kind of the control accounts (S04 "Data", ADR 0013), between the generated column
-- (0019) and its check (0021):
-- - every existing control account gets its kind, each company in its own company context, set
--   for this transaction only, then cleared: `running` for 213001, the service-agency template's
--   client ad funds held, `document` for the others (synthetic companies only, before production;
--   no ledger line was ever on a control account, since S03 refused them, so none is locked);
-- - the lock after first use (S02 rule 5) covers the item kind, like the account's other flags.
DO $$
DECLARE
  company record;
BEGIN
  FOR company IN SELECT c.id FROM public.companies c LOOP
    PERFORM set_config('app.company_id', company.id::text, true);
    UPDATE public.chart_accounts
    SET item_kind = CASE WHEN code = '213001' THEN 'running' ELSE 'document' END,
        updated_at = now()
    WHERE is_control AND item_kind IS NULL;
  END LOOP;
  PERFORM set_config('app.company_id', '', true);
END
$$;
--> statement-breakpoint
-- The lock after first use of 0009, with the item kind among the locked fields.
CREATE OR REPLACE FUNCTION chart_account_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  parent record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'chart_accounts: an account keeps its id and company'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.level = 1 AND (
      (NEW.code, NEW.level, NEW.parent_id, NEW.kind, NEW.class, NEW.normal_balance)
        IS DISTINCT FROM (OLD.code, OLD.level, OLD.parent_id, OLD.kind, OLD.class, OLD.normal_balance)
      OR NEW.archived_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'chart_accounts: root account % is only renamed', OLD.code
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF (OLD.first_posted_at IS NOT NULL OR (OLD.kind = 'header' AND EXISTS (
          SELECT 1 FROM public.chart_accounts c
          WHERE c.company_id = OLD.company_id AND c.parent_id = OLD.id)))
      AND (
        (NEW.code, NEW.parent_id, NEW.level, NEW.kind, NEW.class, NEW.normal_balance,
          NEW.currency, NEW.is_control, NEW.item_kind, NEW.is_monetary)
          IS DISTINCT FROM (OLD.code, OLD.parent_id, OLD.level, OLD.kind, OLD.class,
            OLD.normal_balance, OLD.currency, OLD.is_control, OLD.item_kind, OLD.is_monetary)
        OR (OLD.first_posted_at IS NOT NULL
          AND NEW.first_posted_at IS DISTINCT FROM OLD.first_posted_at)
      ) THEN
      RAISE EXCEPTION 'chart_accounts: account % is locked since its first use', OLD.code
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW.level > 1 THEN
    SELECT p.code, p.level, p.kind, p.archived_at INTO parent
    FROM public.chart_accounts p
    WHERE p.company_id = NEW.company_id AND p.id = NEW.parent_id
    FOR SHARE;
    IF NOT FOUND OR parent.kind <> 'header' OR parent.level <> NEW.level - 1
      OR left(NEW.code, char_length(parent.code)) <> parent.code
      OR (NEW.archived_at IS NULL AND parent.archived_at IS NOT NULL) THEN
      RAISE EXCEPTION 'chart_accounts: account % needs an unarchived header parent of the level above whose code it extends', NEW.code
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW.archived_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chart_accounts c
    WHERE c.company_id = NEW.company_id AND c.parent_id = NEW.id AND c.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'chart_accounts: account % has unarchived children', NEW.code
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.account_roles r
    WHERE r.company_id = NEW.company_id AND r.account_id = NEW.id AND r.archived_at IS NULL
      AND NOT (
        NEW.kind = 'postable' AND NEW.blocked_at IS NULL AND NEW.archived_at IS NULL
        AND CASE r.role
          WHEN 'conversion_rounding' THEN NEW.class IN ('revenue', 'expense')
          WHEN 'fx_realised_gain' THEN NEW.class = 'revenue'
          WHEN 'fx_unrealised_gain' THEN NEW.class = 'revenue'
          WHEN 'fx_realised_loss' THEN NEW.class = 'expense'
          WHEN 'fx_unrealised_loss' THEN NEW.class = 'expense'
          WHEN 'retained_earnings' THEN NEW.class = 'equity'
          ELSE false
        END
      )
  ) THEN
    RAISE EXCEPTION 'chart_accounts: account % holds an account role it would no longer fit', NEW.code
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.kind <> 'postable' AND EXISTS (
    SELECT 1 FROM public.account_required_dimensions d
    WHERE d.company_id = NEW.company_id AND d.account_id = NEW.id AND d.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'chart_accounts: header account % requires no dimension', NEW.code
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
