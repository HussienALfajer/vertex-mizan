import { CURRENCY_CODES } from '@vertex-mizan/contracts';
import { inArray } from 'drizzle-orm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  auditEntries,
  companies,
  companySettings,
  tableRegistry,
  users,
  withCompany,
} from '../src/index.js';
import { connect } from './connections.js';

// ADR 0003's property: two companies with generated data, and no read of one ever includes the
// other's rows. Run on every company table of the registry (S01: the settings and the audit log);
// a later spec that adds a company table adds its rows here, and the first test fails until it
// does.

const { app } = connect();
const COVERED = ['company_settings', 'audit_entries'];

const auditRow = fc.record({
  action: fc.constantFrom('company.updated', 'membership.created', 'session.company_entered'),
  entityType: fc.constantFrom('company', 'membership', 'session'),
  reason: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
  // Plain objects: Drizzle cannot read a null-prototype one, which fc.dictionary makes by default.
  after: fc.option(
    fc.dictionary(fc.string({ maxLength: 8 }), fc.integer(), { noNullPrototype: true }),
    { nil: null },
  ),
});

const companyData = fc.record({
  bookCurrency: fc.constantFrom(...CURRENCY_CODES),
  fiscalYearStartMonth: fc.integer({ min: 1, max: 12 }),
  policyNote: fc.string({ minLength: 1, maxLength: 80 }).filter((note) => note.trim() !== ''),
  audit: fc.array(auditRow, { maxLength: 6 }),
});

type CompanyData = typeof companyData extends fc.Arbitrary<infer T> ? T : never;

async function seed(userId: string, data: CompanyData): Promise<string> {
  const [row] = await app
    .insert(companies)
    .values({ name: 'شركة مولّدة', createdByUserId: userId })
    .returning({ id: companies.id });
  if (!row) throw new Error('no company inserted');
  await withCompany(app, row.id, async (tx) => {
    await tx.insert(companySettings).values({
      companyId: row.id,
      bookCurrency: data.bookCurrency,
      bookRateType: 'market',
      bookAcceptsTransactionRate: false,
      fiscalYearStartMonth: data.fiscalYearStartMonth,
      policyNote: data.policyNote,
    });
    for (const entry of data.audit) {
      await tx.insert(auditEntries).values({
        companyId: row.id,
        actorKind: 'person',
        actorUserId: userId,
        actorName: 'شخص مولّد',
        requestId: 'request-generated',
        entityId: row.id,
        ...entry,
      });
    }
  });
  return row.id;
}

describe('company isolation, as a property', () => {
  it('covers every company table of the registry', () => {
    const company = Object.entries(tableRegistry)
      .filter(([, info]) => info.scope === 'company')
      .map(([name]) => name);
    expect(company.sort()).toEqual([...COVERED].sort());
  });

  it("never shows one company the other's settings or audit entries", async () => {
    const [user] = await app
      .insert(users)
      .values({ email: 'generated@example.test', name: 'شخص مولّد' })
      .returning({ id: users.id });
    if (!user) throw new Error('no user inserted');

    await fc.assert(
      fc.asyncProperty(companyData, companyData, async (first, second) => {
        const ids = [await seed(user.id, first), await seed(user.id, second)];
        for (const [index, id] of ids.entries()) {
          const data = index === 0 ? first : second;
          const seen = await withCompany(app, id, async (tx) => ({
            settings: await tx
              .select({ companyId: companySettings.companyId, note: companySettings.policyNote })
              .from(companySettings)
              .where(inArray(companySettings.companyId, ids)),
            audit: await tx
              .select({ companyId: auditEntries.companyId })
              .from(auditEntries)
              .where(inArray(auditEntries.companyId, ids)),
          }));
          expect(seen.settings).toEqual([{ companyId: id, note: data.policyNote }]);
          expect(seen.audit).toHaveLength(data.audit.length);
          for (const row of seen.audit) expect(row.companyId).toBe(id);
        }
      }),
      { numRuns: 25, includeErrorInReport: true },
    );
  });
});
