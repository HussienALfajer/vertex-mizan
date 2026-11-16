import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createCompanyBooks, createDatabase, type Transaction, withCompany } from '../src/index.js';

// ADR 0021: Hub's tables are dropped only while they hold no row (0058). A database migrated up to
// the release before the removal (0057) with one Hub row refuses the removal's migrations, and
// keeps its tables; every other test database proves the migrations on an empty one.

const migrations = fileURLToPath(new URL('../migrations', import.meta.url));
const LAST_BEFORE_REMOVAL = 57;

/** The migrations folder up to `last`, in a temporary folder: its SQL files and journal. */
function migrationsThrough(last: number): string {
  const folder = mkdtempSync(join(tmpdir(), 'mizan-migrations-'));
  cpSync(migrations, folder, { recursive: true });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number }[];
  };
  journal.entries = journal.entries.filter((entry) => entry.idx <= last);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

const ownerUrl = new URL(inject('ownerUrl'));
const stamp = Date.now();
/** The run's two databases: one with a Hub row, one with only a template's slot mapping. */
const names = [`mizan_hub_removal_${stamp}`, `mizan_hub_mapping_${stamp}`] as const;
const at = (url: string, name: string) => {
  const target = new URL(url);
  target.pathname = `/${name}`;
  return target.href;
};

let admin: pg.Client;
let folder: string;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: ownerUrl.href });
  await admin.connect();
  for (const name of names) {
    await admin.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8'`);
  }
  folder = migrationsThrough(LAST_BEFORE_REMOVAL);
});

afterAll(async () => {
  rmSync(folder, { recursive: true, force: true });
  for (const name of names) {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND usename = current_user AND pid <> pg_backend_pid()`,
      [name],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  }
  await admin.end();
});

/** Migrates the database as the owner, with one connection, through the given folder. */
async function migrateWith(name: string, migrationsFolder: string) {
  const pool = new pg.Pool({ connectionString: at(ownerUrl.href, name), max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

/** A company with no template on the database, as the app makes it; `extra` runs in its context. */
async function companyWith(
  name: string,
  email: string,
  extra: (tx: Transaction, companyId: string) => Promise<unknown>,
) {
  const app = createDatabase(at(inject('appUrl'), name));
  const companyId = uuidv7();
  try {
    // Named columns only: the database is migrated to an earlier version than the schema.
    const {
      rows: [person],
    } = await app.execute<{ id: string }>(
      sql`INSERT INTO public.users (id, email, name) VALUES (${uuidv7()}, ${email}, 'محاسب تجريبي') RETURNING id`,
    );
    if (!person) throw new Error('no user inserted');
    await withCompany(app, companyId, async (tx) => {
      await createCompanyBooks(
        tx,
        companyId,
        {
          name: 'شركة تجريبية',
          nameLatin: null,
          ledgers: {
            book: {
              currency: 'SYP',
              ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
            },
            parallel: null,
          },
          fiscalYearStartMonth: 1,
          policyNote: 'مذكرة سياسة تجريبية.',
          template: null,
          createdByUserId: person.id,
        },
        {
          kind: 'person',
          userId: person.id,
          name: 'محاسب تجريبي',
          sessionId: null,
          requestId: 'request-hub-removal',
          ipAddress: null,
          userAgent: null,
        },
      );
      await extra(tx, companyId);
    });
  } finally {
    await app.$client.end();
  }
  return companyId;
}

/** The table's name if it still exists in the database, else null. */
async function tableIn(name: string, table: string) {
  const owner = new pg.Client({ connectionString: at(ownerUrl.href, name) });
  await owner.connect();
  try {
    const { rows } = await owner.query<{ table: string | null }>(
      'SELECT to_regclass($1)::text AS table',
      [`public.${table}`],
    );
    return rows[0]?.table ?? null;
  } finally {
    await owner.end();
  }
}

describe('the removal of Hub (ADR 0021)', () => {
  it('refuses to drop a Hub table that holds a row, and keeps it', async () => {
    const name = names[0];
    await migrateWith(name, folder);
    const companyId = await companyWith(name, 'hub.removal@example.test', (tx, id) =>
      // A report of no events, as Hub sent one before the removal (synthetic).
      tx.execute(sql`
        INSERT INTO public.reconciliation_reports
          (id, company_id, api_client_id, report_id, report_date, generated_at, payload,
           payload_hash, event_count, request_id, status_at_receipt, gaps_at_receipt)
        VALUES (${uuidv7()}, ${id}, ${uuidv7()}, ${uuidv7()}, '2026-10-01', now(), '{}',
          ${'0'.repeat(64)}, 0, 'request-1', 'matched', 0)`),
    );

    await expect(migrateWith(name, migrations)).rejects.toThrow();
    expect(await tableIn(name, 'reconciliation_reports')).toBe('reconciliation_reports');
    const owner = new pg.Client({ connectionString: at(ownerUrl.href, name) });
    await owner.connect();
    try {
      // The refusal names the table, the count and the company.
      const refusal = await owner
        .query(
          `BEGIN; ${readFileSync(join(migrations, '0058_adr0021_hub_removal_checks.sql'), 'utf8').split('--> statement-breakpoint')[0]}`,
        )
        .then(
          () => '',
          (error: Error) => error.message,
        );
      expect(refusal).toBe(
        `ADR 0021: reconciliation_reports holds 1 rows of company ${companyId}; Hub's tables are dropped only while empty`,
      );
    } finally {
      await owner.query('ROLLBACK').catch(() => undefined);
      await owner.end();
    }
  });

  it('drops a template slot mapping with its table (owner, 2026-11-16)', async () => {
    const name = names[1];
    await migrateWith(name, folder);
    // A company made from a template before the removal holds its slots' mapping, which Hub never
    // sent and which posts nothing: one row stands for those a template writes.
    let mapped: unknown;
    await companyWith(name, 'hub.mapping@example.test', async (tx, id) => {
      await tx.execute(sql`
        INSERT INTO public.posting_rule_accounts (id, company_id, slot, currency, account_id)
        SELECT ${uuidv7()}, ${id}, 'receivable', NULL, a.id
        FROM public.chart_accounts a ORDER BY a.code LIMIT 1`);
      const { rows } = await tx.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM public.posting_rule_accounts`,
      );
      mapped = rows[0]?.count;
    });
    expect(mapped).toBe(1);

    await migrateWith(name, migrations);
    expect(await tableIn(name, 'posting_rule_accounts')).toBeNull();
    expect(await tableIn(name, 'reconciliation_reports')).toBeNull();
  });
});
