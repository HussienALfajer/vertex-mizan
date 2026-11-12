-- S07's period guards (0041) lock the company's ledger head before they read the other periods
-- (ADR 0008's lock order, S07 rule 5): a close, a reopen, an event or a new period checked against
-- the company's other periods is serialised with every other one, so two writes at once never
-- both pass on rows the other has not committed (a reopen of November and a close of December, a
-- period made before the first while the first closes). The posting function and the period
-- service lock the head first already, so this changes nothing for them; a writer that did not is
-- now serialised behind them. period_rules() and period_event_rules() are replaced in place, each
-- with its new pin; nothing else changes. No existing row changes.
CREATE OR REPLACE FUNCTION period_event_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  period_state text;
  head_sequence bigint;
BEGIN
  SELECT h.entry_count INTO head_sequence
  FROM public.ledger_heads h
  WHERE h.company_id = NEW.company_id
  FOR UPDATE;
  SELECT p.state INTO period_state
  FROM public.periods p
  WHERE p.company_id = NEW.company_id AND p.id = NEW.period_id;
  IF period_state IS NULL OR head_sequence IS NULL
    OR NEW.head_sequence IS DISTINCT FROM head_sequence
    OR NEW.created_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'period_events: an event of a period at its transaction time and head'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.kind = 'closed' AND period_state NOT IN ('open', 'reopened'))
    OR (NEW.kind = 'reopened' AND period_state <> 'closed') THEN
    RAISE EXCEPTION 'period_events: a % event from a period that is %', NEW.kind, period_state
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.period_events e
    WHERE e.company_id = NEW.company_id AND e.period_id = NEW.period_id
      AND e.created_at = now()
  ) THEN
    RAISE EXCEPTION 'period_events: one event of a period per transaction'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION period_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  start_month smallint;
  first_period text;
  earlier integer;
BEGIN
  PERFORM 1
  FROM public.ledger_heads h
  WHERE h.company_id = NEW.company_id
  FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.company_id, NEW.period, NEW.fiscal_year, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.period, OLD.fiscal_year, OLD.created_at)
      OR (OLD.state, NEW.state) NOT IN (('open', 'closed'), ('closed', 'reopened'),
        ('reopened', 'closed')) THEN
      RAISE EXCEPTION 'periods: period % changes only its state, from % to closed or reopened',
        OLD.period, OLD.state
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state = 'closed' THEN
      SELECT min(p.period), count(*) INTO first_period, earlier
      FROM public.periods p
      WHERE p.company_id = NEW.company_id AND p.period < NEW.period;
      IF earlier > 0 AND (
        earlier <> (left(NEW.period, 4)::integer * 12 + right(NEW.period, 2)::integer)
          - (left(first_period, 4)::integer * 12 + right(first_period, 2)::integer)
        OR EXISTS (
          SELECT 1 FROM public.periods p
          WHERE p.company_id = NEW.company_id AND p.period < NEW.period AND p.state <> 'closed'
        )) THEN
        RAISE EXCEPTION 'periods: period % closes after every earlier month', NEW.period
          USING ERRCODE = 'restrict_violation';
      END IF;
    ELSIF EXISTS (
      SELECT 1 FROM public.periods p
      WHERE p.company_id = NEW.company_id AND p.period > NEW.period AND p.state = 'closed'
    ) THEN
      RAISE EXCEPTION 'periods: period % reopens only as the latest closed month', NEW.period
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
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
  IF EXISTS (
    SELECT 1 FROM public.periods p
    WHERE p.company_id = NEW.company_id AND p.state = 'closed'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.periods p
    WHERE p.company_id = NEW.company_id AND p.period < NEW.period
  ) THEN
    RAISE EXCEPTION 'periods: period % is before the first period while a month is closed',
      NEW.period
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
