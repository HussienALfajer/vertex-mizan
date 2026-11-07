-- The guards and grants of S05's company tables (0024), as packages/db/CLAUDE.md and the
-- /db-migration skill write them (ADR 0003, ADR 0005, ADR 0008, ADR 0014):
-- - forced RLS with the one company_isolation policy on every table;
-- - the mapping of the posting rules (business): SELECT, INSERT, UPDATE for the app role, never
--   deleted (refuse_delete());
-- - the events as received and their actions (append-only): SELECT, INSERT for the app role,
--   refuse_change() for every role;
-- - each event's state (queue): SELECT, INSERT, UPDATE for the app role, never deleted, and a
--   guard: an event is stored held, posted or recorded, only a held event changes, its event and
--   company never do, and a resolved event names a posted manual entry (S05 rules 15–17);
-- - the jobs role finds the companies with held events (S05 "Jobs"): SELECT of two columns of
--   the states, through a policy of its own on held rows only;
-- - the service-agency template's default mapping, filled for every existing company whose chart
--   holds every code of it (S05 "Mapping slots"), each in its own company context.
-- Every trigger is ENABLE ALWAYS (ADR 0008); the guard function is pinned in test/conventions.ts
-- and names its tables with the schema. Nothing is granted to mizan_queue or PUBLIC; no function is
-- SECURITY DEFINER.
ALTER TABLE posting_rule_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE posting_rule_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON posting_rule_accounts
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE inbound_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE inbound_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON inbound_events
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE inbound_event_states ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE inbound_event_states FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON inbound_event_states
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
ALTER TABLE inbound_event_actions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE inbound_event_actions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON inbound_event_actions
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON posting_rule_accounts, inbound_events, inbound_event_states, inbound_event_actions
  FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON posting_rule_accounts, inbound_event_states TO mizan_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON inbound_events, inbound_event_actions TO mizan_app;
--> statement-breakpoint
-- The mapping is changed, never deleted.
CREATE TRIGGER posting_rule_accounts_refuse_delete BEFORE DELETE ON posting_rule_accounts
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER posting_rule_accounts_refuse_truncate BEFORE TRUNCATE ON posting_rule_accounts
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE posting_rule_accounts ENABLE ALWAYS TRIGGER posting_rule_accounts_refuse_delete;
--> statement-breakpoint
ALTER TABLE posting_rule_accounts ENABLE ALWAYS TRIGGER posting_rule_accounts_refuse_truncate;
--> statement-breakpoint
-- refuse_change() on the append-only tables: no UPDATE, DELETE or TRUNCATE for any role.
CREATE TRIGGER inbound_events_refuse_change BEFORE UPDATE OR DELETE ON inbound_events
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER inbound_events_refuse_truncate BEFORE TRUNCATE ON inbound_events
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE inbound_events ENABLE ALWAYS TRIGGER inbound_events_refuse_change;
--> statement-breakpoint
ALTER TABLE inbound_events ENABLE ALWAYS TRIGGER inbound_events_refuse_truncate;
--> statement-breakpoint
CREATE TRIGGER inbound_event_actions_refuse_change BEFORE UPDATE OR DELETE ON inbound_event_actions
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER inbound_event_actions_refuse_truncate BEFORE TRUNCATE ON inbound_event_actions
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE inbound_event_actions ENABLE ALWAYS TRIGGER inbound_event_actions_refuse_change;
--> statement-breakpoint
ALTER TABLE inbound_event_actions ENABLE ALWAYS TRIGGER inbound_event_actions_refuse_truncate;
--> statement-breakpoint
-- The states are never deleted: an event keeps its outcome for S08's reconciliation.
CREATE TRIGGER inbound_event_states_refuse_delete BEFORE DELETE ON inbound_event_states
  FOR EACH ROW EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
CREATE TRIGGER inbound_event_states_refuse_truncate BEFORE TRUNCATE ON inbound_event_states
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_delete();
--> statement-breakpoint
ALTER TABLE inbound_event_states ENABLE ALWAYS TRIGGER inbound_event_states_refuse_delete;
--> statement-breakpoint
ALTER TABLE inbound_event_states ENABLE ALWAYS TRIGGER inbound_event_states_refuse_truncate;
--> statement-breakpoint
-- An event's state (S05 rules 6–7, 15–17; ADR 0014): stored held, posted or recorded after its
-- first attempt; afterwards only a held event changes, so a posted, recorded, resolved or dismissed
-- event never returns to held; its event, company and creation never change and its attempts
-- never fall; a resolved event names a posted manual entry of its company.
CREATE FUNCTION inbound_event_state_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('held', 'posted', 'recorded') OR NEW.attempts <> 1 THEN
      RAISE EXCEPTION 'inbound_event_states: an event is stored held, posted or recorded'
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    IF OLD.state <> 'held' THEN
      RAISE EXCEPTION 'inbound_event_states: event % is % and no longer changes', OLD.event_id,
        OLD.state
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.event_id IS DISTINCT FROM OLD.event_id
      OR NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.attempts < OLD.attempts THEN
      RAISE EXCEPTION 'inbound_event_states: an event''s state changes, not its event'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW.state = 'resolved' AND NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.company_id = NEW.company_id AND e.id = NEW.resolved_by_entry_id
      AND e.source = 'manual'
  ) THEN
    RAISE EXCEPTION 'inbound_event_states: an event is resolved by a posted manual entry'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER inbound_event_state_rules BEFORE INSERT OR UPDATE ON inbound_event_states
  FOR EACH ROW EXECUTE FUNCTION inbound_event_state_rules();
--> statement-breakpoint
ALTER TABLE inbound_event_states ENABLE ALWAYS TRIGGER inbound_event_state_rules;
--> statement-breakpoint
-- The retry sweep and the daily email (S05 "Jobs") find the companies with held events; each
-- company's events are then read and retried as the app role in its company context.
GRANT SELECT (company_id, state) ON inbound_event_states TO mizan_jobs;
--> statement-breakpoint
CREATE POLICY jobs_find_held_events ON inbound_event_states FOR SELECT TO mizan_jobs
  USING (state = 'held');
--> statement-breakpoint
-- The service-agency template's mapping (S05 "Mapping slots") for every existing company whose
-- chart holds all its codes; a company of the general template, or a chart of its own, starts
-- unmapped and holds its events NO_MAPPING until the accountant maps them.
DO $$
DECLARE
  company record;
  mapped integer;
BEGIN
  FOR company IN SELECT c.id FROM public.companies c LOOP
    PERFORM set_config('app.company_id', company.id::text, true);
    WITH defaults (slot, currency, code) AS (
      VALUES
        ('receivable', NULL, '112001'),
        ('revenue_at_issue', NULL, '411001'),
        ('termination_fee_revenue', NULL, '411002'),
        ('payment_method.cash', 'SYP', '111001'),
        ('payment_method.cash', 'USD', '111002'),
        ('payment_method.bank_transfer', 'SYP', '111003'),
        ('payment_method.bank_transfer', 'USD', '111004'),
        ('payment_method.e_wallet', 'SYP', '111005'),
        ('payment_method.e_wallet', 'USD', '111006'),
        ('ad_funds', NULL, '213001'),
        ('ad_platforms_payable', NULL, '211001'),
        ('project_cost', NULL, '511001'),
        ('project_expense_awaiting_payment', NULL, '211002')
    )
    SELECT count(*) INTO mapped
    FROM defaults d
    JOIN public.chart_accounts a ON a.company_id = company.id AND a.code = d.code;
    IF mapped = 13 THEN
      INSERT INTO public.posting_rule_accounts (id, company_id, slot, currency, account_id)
      SELECT new_uuidv7(), company.id, d.slot::posting_slot, d.currency, a.id
      FROM (
        VALUES
          ('receivable', NULL, '112001'),
          ('revenue_at_issue', NULL, '411001'),
          ('termination_fee_revenue', NULL, '411002'),
          ('payment_method.cash', 'SYP', '111001'),
          ('payment_method.cash', 'USD', '111002'),
          ('payment_method.bank_transfer', 'SYP', '111003'),
          ('payment_method.bank_transfer', 'USD', '111004'),
          ('payment_method.e_wallet', 'SYP', '111005'),
          ('payment_method.e_wallet', 'USD', '111006'),
          ('ad_funds', NULL, '213001'),
          ('ad_platforms_payable', NULL, '211001'),
          ('project_cost', NULL, '511001'),
          ('project_expense_awaiting_payment', NULL, '211002')
      ) AS d (slot, currency, code)
      JOIN public.chart_accounts a ON a.company_id = company.id AND a.code = d.code
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  PERFORM set_config('app.company_id', '', true);
END
$$;
