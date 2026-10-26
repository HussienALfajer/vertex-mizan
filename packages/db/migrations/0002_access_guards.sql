-- The guards and grants of S01's tables (0001_access.sql), as packages/db/CLAUDE.md and the
-- /db-migration skill write them: forced RLS with the one company_isolation policy on the company
-- tables, refuse_change() on both audit logs, the settings lock, and what the app role may do on
-- each table by its kind (src/schema/registry.ts). Nothing is granted to mizan_jobs, mizan_queue
-- or PUBLIC.

-- Platform business tables: the app role reads, adds and changes; it never deletes (archive).
REVOKE ALL ON users, accounts, memberships, companies FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON users, accounts, memberships, companies TO mizan_app;
--> statement-breakpoint

-- invitations: a platform queue; pending rows become accepted or revoked, never deleted.
REVOKE ALL ON invitations FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON invitations TO mizan_app;
--> statement-breakpoint

-- Ephemeral platform tables: Better Auth deletes sessions, one-time tokens, two-factor secrets
-- and rate-limit rows when they end, are used or expire; the daily clean-up deletes the rest. The
-- only DELETE the app role holds (S01, "A new table kind: ephemeral").
REVOKE ALL ON sessions, verifications, two_factors, rate_limits FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, verifications, two_factors, rate_limits
  TO mizan_app;
--> statement-breakpoint

-- platform_audit_entries: platform append-only (ADR 0005 invariant 10); the app role reads and
-- adds only, and refuse_change() refuses UPDATE, DELETE and TRUNCATE for every role.
CREATE TRIGGER platform_audit_entries_refuse_change
  BEFORE UPDATE OR DELETE ON platform_audit_entries
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER platform_audit_entries_refuse_truncate
  BEFORE TRUNCATE ON platform_audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE platform_audit_entries ENABLE ALWAYS TRIGGER platform_audit_entries_refuse_change;
--> statement-breakpoint
ALTER TABLE platform_audit_entries ENABLE ALWAYS TRIGGER platform_audit_entries_refuse_truncate;
--> statement-breakpoint
REVOKE ALL ON platform_audit_entries FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON platform_audit_entries TO mizan_app;
--> statement-breakpoint

-- audit_entries: company append-only, under the company's RLS; the app role reads and adds only.
ALTER TABLE audit_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON audit_entries
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
CREATE TRIGGER audit_entries_refuse_change BEFORE UPDATE OR DELETE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER audit_entries_refuse_truncate BEFORE TRUNCATE ON audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
ALTER TABLE audit_entries ENABLE ALWAYS TRIGGER audit_entries_refuse_change;
--> statement-breakpoint
ALTER TABLE audit_entries ENABLE ALWAYS TRIGGER audit_entries_refuse_truncate;
--> statement-breakpoint
REVOKE ALL ON audit_entries FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_entries TO mizan_app;
--> statement-breakpoint

-- company_settings: company business table, under the company's RLS; never deleted.
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON company_settings
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
--> statement-breakpoint
REVOKE ALL ON company_settings FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON company_settings TO mizan_app;
--> statement-breakpoint

-- The settings lock (S01 rule 11; IAS 21.35–37, ADR 0005): once the company's first entry posts,
-- books_started_at is set (by the posting function, S03) and the currencies, rate policies and
-- fiscal year start never change again, nor does books_started_at; the policy note and the
-- timestamps stay editable. A row trigger before every UPDATE, ENABLE ALWAYS so a replica session
-- cannot skip it (ADR 0008), refuses it for every role, the owner included. The API checks first
-- and answers COMPANY_SETTINGS_LOCKED; this is the database's own guard. The posting function and
-- a settings change both lock the row (S01 edge case 3), so the change lands before the first
-- entry or is refused after it. The convention test pins the function and requires the trigger.
CREATE FUNCTION company_settings_lock() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.books_started_at IS NOT NULL AND (
    NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.book_currency IS DISTINCT FROM OLD.book_currency
    OR NEW.book_rate_type IS DISTINCT FROM OLD.book_rate_type
    OR NEW.book_accepts_transaction_rate IS DISTINCT FROM OLD.book_accepts_transaction_rate
    OR NEW.parallel_currency IS DISTINCT FROM OLD.parallel_currency
    OR NEW.parallel_rate_type IS DISTINCT FROM OLD.parallel_rate_type
    OR NEW.parallel_accepts_transaction_rate IS DISTINCT FROM OLD.parallel_accepts_transaction_rate
    OR NEW.fiscal_year_start_month IS DISTINCT FROM OLD.fiscal_year_start_month
    OR NEW.books_started_at IS DISTINCT FROM OLD.books_started_at
  ) THEN
    RAISE EXCEPTION 'company_settings of company % are locked since its first posted entry',
      OLD.company_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER company_settings_lock BEFORE UPDATE ON company_settings
  FOR EACH ROW EXECUTE FUNCTION company_settings_lock();
--> statement-breakpoint
ALTER TABLE company_settings ENABLE ALWAYS TRIGGER company_settings_lock;
