-- S11 PR 1 (owner, 2026-11-14, ADR 0022 "Consequences"): a running item's dimension set holds its
-- counterparty alone, while the lines the accountant types on its account carry every dimension
-- the account requires (a contract on `114002`, `211006`, `212002`). The lines the posting function
-- builds itself to remeasure a running item carry the item's set: a month-end revaluation's
-- (S07 rule 13) and the difference entry that follows a reversal across or against its balance
-- (S04 rule 13). Like a reversal's, they are not held to the account's required dimensions, but
-- the counterparty's: the line is on a running control account, its set holds a value of the
-- account's counterparty type, and its entry is a revaluation or that difference entry (the
-- posting request `<key>:difference`, never a draft's). Every other rule is 0053's.
CREATE OR REPLACE FUNCTION journal_line_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  account record;
  entry record;
  settings record;
  remeasures boolean;
BEGIN
  SELECT a.kind, a.class, a.currency, a.first_posted_at, a.item_kind, a.counterparty_type
    INTO account
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
  SELECT e.entry_date, e.reverses_entry_id, e.source, e.request_id, e.draft_id INTO entry
  FROM public.journal_entries e
  WHERE e.company_id = NEW.company_id AND e.id = NEW.entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal_lines: a line belongs to an entry of its company'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.kind = 'stated' AND entry.source <> 'opening' THEN
    RAISE EXCEPTION 'journal_lines: a stated line is only on an opening entry'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF entry.source = 'opening' AND account.class IN ('revenue', 'expense') THEN
    RAISE EXCEPTION 'journal_lines: an opening entry holds the balance sheet only, not account %',
      NEW.account_id
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
  -- Never NULL, so a line off a running account is checked as before.
  remeasures := coalesce(account.item_kind = 'running', false)
    AND EXISTS (
      SELECT 1 FROM public.dimension_set_values v
      JOIN public.dimension_types t ON t.company_id = v.company_id AND t.id = v.type_id
      WHERE v.company_id = NEW.company_id AND v.set_id = NEW.dimension_set_id
        AND t.builtin AND t.code = account.counterparty_type::text
    )
    AND (
      entry.source = 'revaluation'
      OR (entry.draft_id IS NULL AND EXISTS (
        SELECT 1 FROM public.posting_requests p
        WHERE p.company_id = NEW.company_id AND p.id = entry.request_id
          AND p.idempotency_key LIKE '%:difference'
      ))
    );
  IF entry.reverses_entry_id IS NULL AND EXISTS (
    SELECT 1 FROM public.account_required_dimensions r
    JOIN public.dimension_types t ON t.company_id = r.company_id AND t.id = r.dimension_type_id
    WHERE r.company_id = NEW.company_id AND r.account_id = NEW.account_id
      AND r.archived_at IS NULL
      AND NOT (remeasures AND NOT (t.builtin AND t.code = account.counterparty_type::text))
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
