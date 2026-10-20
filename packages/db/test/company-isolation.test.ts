import { inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { type Database, type Transaction, withCompany } from '../src/index.js';
import * as schema from '../src/schema/index.js';
import { connect, refusal } from './connections.js';
import { fixtureDocuments, fixtureEntries } from './fixtures/schema.js';

// Two companies on the shared database (ADR 0003), seen through the app role the API and the
// worker use, on the fixture tables.

const { owner, app, jobs } = connect();
// One connection only, so a leaked setting would reach the next transaction.
const single: Database = drizzle({
  client: new pg.Pool({ connectionString: inject('appUrl'), max: 1 }),
  schema,
  casing: 'snake_case',
});
afterAll(() => single.$client.end());

const companyA = uuidv7();
const companyB = uuidv7();
const RLS_REFUSAL = /new row violates row-level security policy/;

const document = (companyId: string, title = 'Synthetic') => ({
  companyId,
  title,
  amountMinor: 1000n,
  currency: 'USD',
});

async function currentCompany(db: Database | Transaction) {
  const result = await db.execute<{ company: string | null }>(
    sql`select current_company_id() as company`,
  );
  return result.rows[0]?.company;
}

describe('withCompany', () => {
  it('refuses a company id that is not a UUID', async () => {
    for (const companyId of ['', 'company-a', `${companyA}' or true --`]) {
      await expect(withCompany(app, companyId, async () => 1)).rejects.toThrow(/UUID/);
    }
  });

  it('reads and writes only the rows of its company', async () => {
    await withCompany(app, companyA, (tx) =>
      tx.insert(fixtureDocuments).values(document(companyA)),
    );
    await withCompany(app, companyB, (tx) =>
      tx.insert(fixtureDocuments).values(document(companyB)),
    );

    for (const company of [companyA, companyB]) {
      const seen = await withCompany(app, company, (tx) =>
        tx
          .select({ companyId: fixtureDocuments.companyId })
          .from(fixtureDocuments)
          .where(inArray(fixtureDocuments.companyId, [companyA, companyB])),
      );
      expect(seen).toEqual([{ companyId: company }]);
    }
  });

  it("refuses to write another company's row", async () => {
    expect(
      await refusal(
        withCompany(app, companyA, (tx) => tx.insert(fixtureDocuments).values(document(companyB))),
      ),
    ).toMatch(RLS_REFUSAL);
  });

  it("cannot move a row to another company or touch another company's row", async () => {
    expect(
      await refusal(
        withCompany(app, companyA, (tx) =>
          tx.update(fixtureDocuments).set({ companyId: companyB }),
        ),
      ),
    ).toMatch(RLS_REFUSAL);
    const changed = await withCompany(app, companyA, (tx) =>
      tx
        .update(fixtureDocuments)
        .set({ title: 'Changed' })
        .where(inArray(fixtureDocuments.companyId, [companyB]))
        .returning({ id: fixtureDocuments.id }),
    );
    expect(changed).toEqual([]);
  });

  it("refuses a composite key to another company's row, though its id exists", async () => {
    const [theirs] = await withCompany(app, companyB, (tx) =>
      tx.insert(fixtureDocuments).values(document(companyB)).returning({ id: fixtureDocuments.id }),
    );
    if (!theirs) throw new Error('no document inserted');
    const message = await refusal(
      withCompany(app, companyA, (tx) =>
        tx
          .insert(fixtureEntries)
          .values({ companyId: companyA, documentId: theirs.id, lineCount: 2 }),
      ),
    );
    expect(message).toMatch(/violates foreign key constraint "fixture_entries_document_fk"/);
  });

  it('sees nothing and writes nothing outside a company transaction', async () => {
    expect(await currentCompany(app)).toBeNull();
    expect(await app.select().from(fixtureDocuments)).toEqual([]);
    expect(await refusal(app.insert(fixtureDocuments).values(document(companyA)))).toMatch(
      RLS_REFUSAL,
    );
  });

  it('sees nothing once the setting is emptied inside the transaction', async () => {
    const seen = await withCompany(app, companyA, async (tx) => {
      await tx.execute(sql`select set_config('app.company_id', '', true)`);
      return tx.select().from(fixtureDocuments);
    });
    expect(seen).toEqual([]);
  });

  it('never leaks its company to the next use of the pooled connection', async () => {
    expect(await withCompany(single, companyA, (tx) => currentCompany(tx))).toBe(companyA);
    expect(await currentCompany(single)).toBeNull();
    expect(await single.select().from(fixtureDocuments)).toEqual([]);

    await expect(
      withCompany(single, companyB, async (tx) => {
        await currentCompany(tx);
        throw new Error('work failed');
      }),
    ).rejects.toThrow('work failed');
    expect(await currentCompany(single)).toBeNull();
    expect(await single.select().from(fixtureDocuments)).toEqual([]);
  });

  it('binds the owner role too: forced RLS leaves it no way around the policy', async () => {
    expect(
      await owner
        .select()
        .from(fixtureDocuments)
        .where(inArray(fixtureDocuments.companyId, [companyA])),
    ).toEqual([]);
    const seen = await withCompany(owner, companyB, (tx) =>
      tx
        .selectDistinct({ companyId: fixtureDocuments.companyId })
        .from(fixtureDocuments)
        .where(inArray(fixtureDocuments.companyId, [companyA, companyB])),
    );
    expect(seen).toEqual([{ companyId: companyB }]);
  });
});

describe('the jobs role', () => {
  it('reaches no company table: it has no grant yet, and no policy of its own', async () => {
    expect(
      await refusal(withCompany(jobs, companyA, (tx) => tx.select().from(fixtureDocuments))),
    ).toMatch(/permission denied for table fixture_documents/);
  });
});
