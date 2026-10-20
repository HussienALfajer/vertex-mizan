import { eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Database, type Transaction, withCompany } from '../src/index.js';
import { connect, refusal } from './connections.js';
import { fixtureDocuments, fixtureEntries, fixtureLines } from './fixtures/schema.js';

// The ledger guards of ADR 0005 and ADR 0008 on the fixture tables, tried as each role: the app
// role (what the API and the worker run as), the owner (who owns the tables) and a superuser in a
// replica session. An append-only row never changes; an entry that does not balance never commits.

const { app, owner, superuser } = connect();
const company = uuidv7();
const DENIED = /permission denied for table/;
const UNBALANCED = /fixture entry does not balance/;

/** A document, an entry for it and its lines, written as the app role in one transaction. */
async function post(tx: Transaction, amounts: bigint[]) {
  const [document] = await tx
    .insert(fixtureDocuments)
    .values({ companyId: company, title: 'Synthetic', amountMinor: 1000n, currency: 'USD' })
    .returning({ id: fixtureDocuments.id });
  if (!document) throw new Error('no document inserted');
  const [entry] = await tx
    .insert(fixtureEntries)
    .values({ companyId: company, documentId: document.id })
    .returning({ id: fixtureEntries.id });
  if (!entry) throw new Error('no entry inserted');
  // One statement per line: the entry is out of balance between them, which is allowed until commit.
  for (const amountMinor of amounts) {
    await tx.insert(fixtureLines).values({ companyId: company, entryId: entry.id, amountMinor });
  }
  return entry.id;
}

let entryId = '';

beforeAll(async () => {
  entryId = await withCompany(app, company, (tx) => post(tx, [1000n, -1000n]));
});

const lines = (db: Database) =>
  withCompany(db, company, (tx) =>
    tx
      .select({ amountMinor: fixtureLines.amountMinor })
      .from(fixtureLines)
      .where(eq(fixtureLines.entryId, entryId))
      .orderBy(fixtureLines.amountMinor),
  );

/** Runs `statements` as a superuser in a replica session, inside a transaction rolled back. */
async function asReplica(statements: string[], before: string[] = []): Promise<string[]> {
  const client: pg.PoolClient = await superuser.connect();
  const messages: string[] = [];
  try {
    await client.query('begin');
    for (const statement of before) await client.query(statement);
    await client.query("set local session_replication_role = 'replica'");
    for (const statement of statements) {
      await client.query('savepoint attempt');
      try {
        await client.query(statement);
        messages.push('done');
      } catch (error) {
        messages.push(error instanceof Error ? error.message : String(error));
      }
      await client.query('rollback to savepoint attempt');
    }
    return messages;
  } finally {
    await client.query('rollback');
    client.release();
  }
}

describe('an append-only table', () => {
  it('stores a UUIDv7 id made by the application, and refuses any other', async () => {
    const [row] = await withCompany(app, company, (tx) =>
      tx
        .select({ version: sql<number>`uuid_extract_version(${fixtureEntries.id})` })
        .from(fixtureEntries)
        .where(eq(fixtureEntries.id, entryId)),
    );
    expect(row?.version).toBe(7);
    expect(
      await refusal(
        withCompany(app, company, (tx) =>
          tx
            .insert(fixtureLines)
            .values({ id: uuidv4(), companyId: company, entryId, amountMinor: 0n }),
        ),
      ),
    ).toMatch(/fixture_lines_id_is_uuidv7/);
  });

  it('refuses UPDATE, DELETE and TRUNCATE by the app role, which has no such privilege', async () => {
    for (const work of [
      (tx: Transaction) => tx.update(fixtureLines).set({ amountMinor: 1n }),
      (tx: Transaction) => tx.delete(fixtureLines),
      (tx: Transaction) => tx.execute(sql`truncate fixture_lines`),
      (tx: Transaction) => tx.update(fixtureEntries).set({ createdAt: new Date() }),
      (tx: Transaction) => tx.delete(fixtureEntries),
      (tx: Transaction) => tx.execute(sql`truncate fixture_entries`),
    ]) {
      expect(await refusal(withCompany(app, company, work))).toMatch(DENIED);
    }
  });

  it('refuses UPDATE, DELETE and TRUNCATE by the owner role, through the triggers', async () => {
    expect(
      await refusal(
        withCompany(owner, company, (tx) => tx.update(fixtureLines).set({ amountMinor: 1n })),
      ),
    ).toBe('fixture_lines is append-only: UPDATE refused');
    expect(await refusal(withCompany(owner, company, (tx) => tx.delete(fixtureLines)))).toBe(
      'fixture_lines is append-only: DELETE refused',
    );
    expect(await refusal(owner.execute(sql`truncate fixture_lines`))).toBe(
      'fixture_lines is append-only: TRUNCATE refused',
    );
  });

  it('keeps refusing in a replica session, because its triggers are ENABLE ALWAYS', async () => {
    expect(
      await asReplica([
        'update fixture_lines set amount_minor = 1',
        'delete from fixture_entries',
        'truncate fixture_lines',
      ]),
    ).toEqual([
      'fixture_lines is append-only: UPDATE refused',
      'fixture_entries is append-only: DELETE refused',
      'fixture_lines is append-only: TRUNCATE refused',
    ]);
  });

  it('would let a replica session through a trigger left at plain ENABLE', async () => {
    // The counterpart of the test above: what ENABLE ALWAYS prevents, shown on a weakened copy.
    expect(
      await asReplica(
        ['update fixture_lines set amount_minor = amount_minor'],
        ['alter table fixture_lines enable trigger fixture_lines_refuse_change'],
      ),
    ).toEqual(['done']);
  });

  it('keeps every line unchanged', async () => {
    expect(await lines(app)).toEqual([{ amountMinor: -1000n }, { amountMinor: 1000n }]);
  });
});

describe('the app role', () => {
  it('cannot set session_replication_role, which only a superuser may', async () => {
    expect(await refusal(app.$client.query("set session_replication_role = 'replica'"))).toMatch(
      /permission denied to set parameter/,
    );
  });
});

describe('a deferred constraint trigger', () => {
  it('lets an entry be out of balance between statements and commits it balanced', async () => {
    const id = await withCompany(app, company, (tx) => post(tx, [700n, -250n, -450n]));
    const [count] = await withCompany(app, company, (tx) =>
      tx
        .select({ lines: sql<number>`count(*)::int` })
        .from(fixtureLines)
        .where(eq(fixtureLines.entryId, id)),
    );
    expect(count?.lines).toBe(3);
  });

  it('refuses at commit an entry that does not balance, and keeps none of it', async () => {
    for (const amounts of [[1000n, -999n], [1000n], [], [1000n, -1000n, 1n]]) {
      let id = '';
      const message = await refusal(
        withCompany(app, company, async (tx) => {
          id = await post(tx, amounts);
        }),
      );
      expect(message, amounts.join(', ')).toMatch(UNBALANCED);
      const kept = await withCompany(app, company, (tx) =>
        tx.select().from(fixtureEntries).where(eq(fixtureEntries.id, id)),
      );
      expect(kept).toEqual([]);
    }
  });

  it('checks the whole entry each time it fires, so the answer does not depend on the order', async () => {
    // A line added in a later statement still counts, whichever row's check fires first.
    const message = await refusal(
      withCompany(app, company, (tx) => post(tx, [-1000n, 400n, 500n])),
    );
    expect(message).toMatch(/does not balance: 3 lines, total -100/);
  });

  it('still fires in a replica session, because it is ENABLE ALWAYS', async () => {
    const client = await superuser.connect();
    try {
      await client.query('begin');
      await client.query("set local session_replication_role = 'replica'");
      await client.query(`select set_config('app.company_id', $1, true)`, [company]);
      const document = uuidv7();
      const entry = uuidv7();
      await client.query(
        `insert into fixture_documents (id, company_id, title, amount_minor, currency)
         values ($1, $2, 'Synthetic', 1000, 'USD')`,
        [document, company],
      );
      await client.query(
        'insert into fixture_entries (id, company_id, document_id) values ($1, $2, $3)',
        [entry, company, document],
      );
      await client.query(
        'insert into fixture_lines (id, company_id, entry_id, amount_minor) values ($1, $2, $3, 5)',
        [uuidv7(), company, entry],
      );
      expect(await refusal(client.query('commit'))).toMatch(UNBALANCED);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
