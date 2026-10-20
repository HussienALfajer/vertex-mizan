---
name: db-migration
description: Change the database schema safely in packages/db — edit the Drizzle schema, add RLS policies and ledger guards, generate the migration, review its SQL for backward compatibility, isolation and ledger integrity, and test it. Use whenever a table, column, index, enum, constraint, policy, trigger, function or grant is added, changed or removed.
argument-hint: <what changes>
effort: high
---

Schema change: **$ARGUMENTS**. Rules: `packages/db/CLAUDE.md` (when it exists), ADR 0003 (tenancy), ADR 0007 (money columns), ADR 0005 and ADR 0008 (ledger invariants).

1. **Edit** `packages/db/src/schema/<module>.ts` with the shared column helpers.
   - Export a new schema file from `schema/index.ts`.
   - Register every new table with its owning module, its scope (company or platform) and its kind (business, append-only, queue, draft).
   - Index every foreign key. A foreign key between company tables is composite, `(company_id, x_id) → (company_id, id)`, with `unique (company_id, id)` on the parent.
   - Idempotency keys, external references and entry numbers get unique indexes.
2. **Company tables:**
   - `company_id` is not null, and indexes start with it;
   - the custom migration enables and forces RLS and creates the `company_isolation` policy against `current_company_id()`;
   - the app role gets only the privileges it needs: never `TRUNCATE`, `TRIGGER` or `REFERENCES`, and no `DELETE` on business tables.
3. **Money columns:** `bigint` minor units beside a currency column checked against the currency table; ledger lines carry the transaction, book and parallel amounts; rates as `numeric` with their base, quote and type. Never a float.
4. **Append-only and ledger tables** (entries, lines, line dimensions, open-item movements, posting requests, rates, period events, audit):
   - no `updated_at` or `archived_at`;
   - `refuse_change()` triggers that refuse `UPDATE`, `DELETE` and `TRUNCATE` for every role, created `ENABLE ALWAYS` (ADR 0008);
   - `SELECT, INSERT` only for the app role.

   Invariants that span rows (balance in both ledgers, exact reversal, open items never flipping sign) are deferred `AFTER … FOR EACH ROW` constraint triggers, `ENABLE ALWAYS`, that check the whole entry idempotently. Locks are taken in one order: the company ledger head, then the period. Work queues (the event inbox, outbox) are not append-only, but their payloads never change.
5. **Generate:** `pnpm db:generate`. Read the new `.sql` file in `packages/db/migrations/` (never `meta/`).
6. **Review the SQL.** The previous release must keep working against the migrated database. Stop and redesign as expand, then contract, if you see:
   - `DROP TABLE`, `DROP COLUMN`, or a `RENAME` of anything code still uses;
   - `ALTER COLUMN ... TYPE` that rewrites or narrows data;
   - `SET NOT NULL`, or a new `NOT NULL` column without a default, on a table that has rows;
   - a removed or renamed enum value;
   - **anything that updates or deletes posted ledger rows, rates or audit rows, or disables, drops or weakens a ledger trigger, constraint or grant.** Historical corrections are reversal entries posted through the posting function, never SQL;
   - a company table without forced RLS;
   - a change of owner, or anything the application would have to run as `mizan_owner`.

   The CI migration check refuses guard-weakening SQL (ADR 0008).

   Contract steps ship in a later release. Data backfills go in a custom migration and never touch append-only rows.
7. **Test:** run the `db` package tests (migrations, the convention test, the invariant tests as each role), then the tests of every package that uses the tables, through the `checker` subagent.
8. **Confirm no drift:** running `pnpm db:generate` again reports nothing to migrate.
9. **Dev database:** `pnpm db:migrate` changes the owner's local data, so ask before running it.

Never use `drizzle-kit push`, never edit a generated migration, and commit the schema and its migration together.
