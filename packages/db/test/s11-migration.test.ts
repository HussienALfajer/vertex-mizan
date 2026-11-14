import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createCompanyBooks, createDatabase, users, withCompany } from '../src/index.js';

// S11 PR 1 (ADR 0022) over a company that holds data from before it: migrated up to 0061, a
// control account with no required dimension and five custom dimension types make 0063 refuse,
// naming the company; with one type archived, the migration gives the company the built-in
// supplier and worker types (audited by the system) and its control account the counterparty type
// `client` with the client required. Every other test database proves the migrations on an empty
// one. All values are synthetic.

const migrations = fileURLToPath(new URL('../migrations', import.meta.url));
const LAST_BEFORE_S11 = 61;

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
const name = `mizan_s11_migration_${Date.now()}`;
const at = (url: string) => {
  const target = new URL(url);
  target.pathname = `/${name}`;
  return target.href;
};

let admin: pg.Client;
let folder: string;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: ownerUrl.href });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8'`);
  folder = migrationsThrough(LAST_BEFORE_S11);
});

afterAll(async () => {
  rmSync(folder, { recursive: true, force: true });
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND usename = current_user AND pid <> pg_backend_pid()`,
    [name],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.end();
});

/** Migrates the database as the owner, with one connection, through the given folder. */
async function migrateWith(migrationsFolder: string) {
  const pool = new pg.Pool({ connectionString: at(ownerUrl.href), max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

/** Runs `work` as the owner in the company's context, in one transaction. */
async function asOwner<T>(companyId: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: at(ownerUrl.href) });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.company_id', $1, true)`, [companyId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } finally {
    await client.end();
  }
}

describe('migrations 0062–0064 over an existing company (S11, ADR 0022)', () => {
  it('refuses a company over four custom types, then backfills the types and counterparties', async () => {
    await migrateWith(folder);
    const app = createDatabase(at(inject('appUrl')));
    const companyId = uuidv7();
    try {
      const [person] = await app
        .insert(users)
        .values({ email: 's11.migration@example.test', name: 'محاسب تجريبي' })
        .returning({ id: users.id });
      if (!person) throw new Error('no user inserted');
      await withCompany(app, companyId, (tx) =>
        createCompanyBooks(
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
            requestId: 'request-s11-migration',
            ipAddress: null,
            userAgent: null,
          },
        ),
      );
    } finally {
      await app.$client.end();
    }
    // A control account made before S11 with no required dimension, and five custom types.
    await asOwner(companyId, async (client) => {
      const parent = async (code: string) =>
        (
          await client.query<{ id: string }>(
            `SELECT id FROM public.chart_accounts WHERE code = $1`,
            [code],
          )
        ).rows[0]?.id;
      await client.query(
        `INSERT INTO public.chart_accounts
           (id, company_id, code, level, parent_id, kind, class, name, normal_balance)
         VALUES (public.new_uuidv7(), $1, '11', 2, $2, 'header', 'asset', 'متداولة', 'debit')`,
        [companyId, await parent('1')],
      );
      await client.query(
        `INSERT INTO public.chart_accounts
           (id, company_id, code, level, parent_id, kind, class, name, normal_balance)
         VALUES (public.new_uuidv7(), $1, '112', 3, $2, 'header', 'asset', 'ذمم', 'debit')`,
        [companyId, await parent('11')],
      );
      await client.query(
        `INSERT INTO public.chart_accounts
           (id, company_id, code, level, parent_id, kind, class, name, normal_balance,
            statement_line, is_control, item_kind, is_monetary)
         VALUES (public.new_uuidv7(), $1, '112001', 4, $2, 'postable', 'asset', 'ذمم عملاء',
           'debit', 'bs.trade_receivables', true, 'document', true)`,
        [companyId, await parent('112')],
      );
      for (const index of [1, 2, 3, 4, 5]) {
        await client.query(
          `INSERT INTO public.dimension_types (id, company_id, code, builtin, name, position)
           VALUES (public.new_uuidv7(), $1, $2, false, 'نوع تجريبي', $3)`,
          [companyId, `custom_${index}`, 4 + index],
        );
      }
    });

    await expect(migrateWith(migrations)).rejects.toThrow();
    const refusal = await asOwner(companyId, async (client) => {
      const sqlText = readFileSync(join(migrations, '0063_s11_counterparty_guards.sql'), 'utf8');
      return client.query(sqlText.split('--> statement-breakpoint')[0] as string).then(
        () => '',
        (error: Error) => error.message,
      );
    }).catch((error: Error) => error.message);
    expect(refusal).toBe(
      `S11: company ${companyId} has 5 active custom dimension types; archive all but four first`,
    );

    await asOwner(companyId, (client) =>
      client.query(`UPDATE public.dimension_types SET archived_at = now() WHERE code = 'custom_5'`),
    );
    await migrateWith(migrations);
    const after = await asOwner(companyId, async (client) => ({
      types: (
        await client.query<{ code: string; position: number }>(
          `SELECT code, position FROM public.dimension_types WHERE builtin ORDER BY position`,
        )
      ).rows,
      audit: (
        await client.query<{ action: string; actor_kind: string; code: string }>(
          `SELECT action, actor_kind, after ->> 'code' AS code FROM public.audit_entries
           WHERE entity_type = 'dimension_type' ORDER BY after ->> 'code'`,
        )
      ).rows,
      account: (
        await client.query<{ counterparty_type: string; required: string[] }>(
          `SELECT a.counterparty_type::text,
             array(SELECT t.code FROM public.account_required_dimensions d
               JOIN public.dimension_types t ON t.company_id = d.company_id AND t.id = d.dimension_type_id
               WHERE d.company_id = a.company_id AND d.account_id = a.id AND d.archived_at IS NULL) AS required
           FROM public.chart_accounts a WHERE a.code = '112001'`,
        )
      ).rows[0],
    }));
    expect(after.types).toEqual([
      { code: 'client', position: 1 },
      { code: 'contract', position: 2 },
      { code: 'department', position: 3 },
      { code: 'service', position: 4 },
      { code: 'supplier', position: 5 },
      { code: 'worker', position: 6 },
    ]);
    expect(after.audit).toEqual([
      { action: 'dimension_type.created', actor_kind: 'system', code: 'supplier' },
      { action: 'dimension_type.created', actor_kind: 'system', code: 'worker' },
    ]);
    expect(after.account).toEqual({ counterparty_type: 'client', required: ['client'] });
  });
});
