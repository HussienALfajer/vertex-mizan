-- The guards of the fixture tables (schema.ts), written as a table's custom migration writes them
-- (packages/db/CLAUDE.md, the /db-migration skill). Applied by the test global setup as the owner
-- role, after the tables; never part of a migration.

-- fixture_documents: company business table; the app role reads, adds and changes, never deletes.
ALTER TABLE fixture_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixture_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON fixture_documents
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
REVOKE ALL ON fixture_documents FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON fixture_documents TO mizan_app;

-- fixture_entries: company append-only table; the app role reads and adds only.
ALTER TABLE fixture_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixture_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON fixture_entries
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
CREATE TRIGGER fixture_entries_refuse_change BEFORE UPDATE OR DELETE ON fixture_entries
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
CREATE TRIGGER fixture_entries_refuse_truncate BEFORE TRUNCATE ON fixture_entries
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
ALTER TABLE fixture_entries ENABLE ALWAYS TRIGGER fixture_entries_refuse_change;
ALTER TABLE fixture_entries ENABLE ALWAYS TRIGGER fixture_entries_refuse_truncate;
REVOKE ALL ON fixture_entries FROM PUBLIC;
GRANT SELECT, INSERT ON fixture_entries TO mizan_app;

-- fixture_lines: company append-only table; the app role reads and adds only.
ALTER TABLE fixture_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixture_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON fixture_lines
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());
CREATE TRIGGER fixture_lines_refuse_change BEFORE UPDATE OR DELETE ON fixture_lines
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
CREATE TRIGGER fixture_lines_refuse_truncate BEFORE TRUNCATE ON fixture_lines
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
ALTER TABLE fixture_lines ENABLE ALWAYS TRIGGER fixture_lines_refuse_change;
ALTER TABLE fixture_lines ENABLE ALWAYS TRIGGER fixture_lines_refuse_truncate;
REVOKE ALL ON fixture_lines FROM PUBLIC;
GRANT SELECT, INSERT ON fixture_lines TO mizan_app;

-- An entry is complete and balances when its transaction commits: it has the lines it states (at
-- least two), so no later transaction can add any, and they sum to zero. A deferred
-- AFTER … FOR EACH ROW constraint trigger on the entry and on each line, ENABLE ALWAYS (ADR 0008),
-- checks the whole entry, so firing once per row gives the same answer each time. It runs as the
-- role that wrote the rows, under the company's RLS, which still holds at commit; an entry it
-- cannot see fails. Tables are named with their schema: a temporary table of the same name would
-- otherwise be read instead (the runtime roles cannot create one either). The convention test pins
-- the function and requires both triggers (fixtureGuards).
CREATE FUNCTION fixture_entry_balances() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  entry uuid;
  expected integer;
  line_count bigint;
  total numeric;
BEGIN
  IF TG_TABLE_NAME = 'fixture_entries' THEN
    entry := NEW.id;
  ELSE
    entry := NEW.entry_id;
  END IF;
  SELECT e.line_count INTO expected
  FROM public.fixture_entries e
  WHERE e.company_id = NEW.company_id AND e.id = entry;
  SELECT count(*), coalesce(sum(l.amount_minor), 0) INTO line_count, total
  FROM public.fixture_lines l
  WHERE l.company_id = NEW.company_id AND l.entry_id = entry;
  IF expected IS NULL OR line_count < 2 OR line_count <> expected OR total <> 0 THEN
    RAISE EXCEPTION 'fixture entry does not balance: % lines of %, total %',
      line_count, expected, total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER fixture_entries_balance AFTER INSERT ON fixture_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fixture_entry_balances();
CREATE CONSTRAINT TRIGGER fixture_lines_balance AFTER INSERT ON fixture_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fixture_entry_balances();
ALTER TABLE fixture_entries ENABLE ALWAYS TRIGGER fixture_entries_balance;
ALTER TABLE fixture_lines ENABLE ALWAYS TRIGGER fixture_lines_balance;

-- fixture_settings: platform business table; the app role reads only.
REVOKE ALL ON fixture_settings FROM PUBLIC;
GRANT SELECT ON fixture_settings TO mizan_app;

-- fixture_tokens: platform ephemeral table; the app role also deletes, as Better Auth does with
-- expired sessions and used tokens.
REVOKE ALL ON fixture_tokens FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON fixture_tokens TO mizan_app;
