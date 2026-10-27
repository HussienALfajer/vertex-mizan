import {
  ACCOUNT_ROLES,
  BUILTIN_DIMENSION_TYPES,
  CONTRACT_KINDS,
  DIMENSION_EXTERNAL_SOURCES,
  RATE_SOURCES,
  ROOT_ACCOUNTS,
  STATEMENT_LINES,
} from '@vertex-mizan/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  accountRequiredDimensions,
  accountRole,
  accountRoles,
  bulletinHolidays,
  CHART_STATEMENT_LINES,
  chartAccounts,
  companies,
  companySettings,
  type Database,
  dimensionTypes,
  dimensionValues,
  exchangeRates,
  RATE_ROW_SOURCES,
  ratePairs,
  type Transaction,
  users,
  VALUE_CONTRACT_KINDS,
  VALUE_EXTERNAL_SOURCES,
  withCompany,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// S02's tables on the migrated database (0007–0009): the roots and built-in types of every
// company, the chart's checks, tree and lock after first use as the app role, account roles,
// dimensions, the append-only rate table and its corrections, and no deletion for any role. All
// values are synthetic.

const { app, owner } = connect();
const GUARD =
  /restrict_violation|chart_accounts:|account_roles:|account_required_dimensions:|dimension_types:|dimension_values:|exchange_rates:|rate_pairs:/;
const CHECK = /violates check constraint/;
const UNIQUE = /duplicate key value violates unique constraint/;

let personId = '';
let companyA = '';
let companyB = '';

async function company(): Promise<string> {
  const [row] = await app
    .insert(companies)
    .values({ name: 'شركة اختبار', createdByUserId: personId })
    .returning({ id: companies.id });
  if (!row) throw new Error('no company inserted');
  await withCompany(app, row.id, (tx) =>
    tx.insert(companySettings).values({
      companyId: row.id,
      bookCurrency: 'SYP',
      bookRateType: 'bulletin',
      bookAcceptsTransactionRate: false,
      parallelCurrency: 'USD',
      parallelRateType: 'market',
      parallelAcceptsTransactionRate: true,
      policyNote: 'مذكرة سياسة تجريبية.',
    }),
  );
  return row.id;
}

const inA = <T>(work: (tx: Transaction) => Promise<T>, db: Database = app) =>
  withCompany(db, companyA, work);

async function accountByCode(code: string, companyId = companyA) {
  return withCompany(app, companyId, async (tx) => {
    const [row] = await tx.select().from(chartAccounts).where(eq(chartAccounts.code, code));
    if (!row) throw new Error(`no account ${code}`);
    return row;
  });
}

async function typeByCode(code: string) {
  return inA(async (tx) => {
    const [row] = await tx.select().from(dimensionTypes).where(eq(dimensionTypes.code, code));
    if (!row) throw new Error(`no type ${code}`);
    return row;
  });
}

type NewAccount = typeof chartAccounts.$inferInsert;

/** Adds an account under `parentCode` in company A. */
async function addAccount(parentCode: string, values: Partial<NewAccount> & { code: string }) {
  const parent = await accountByCode(parentCode);
  const postable = values.kind !== 'header';
  return inA(async (tx) => {
    const [row] = await tx
      .insert(chartAccounts)
      .values({
        companyId: companyA,
        parentId: parent.id,
        level: values.code.length === 6 ? 4 : values.code.length,
        kind: postable ? 'postable' : 'header',
        class: parent.class,
        name: 'حساب تجريبي',
        normalBalance: parent.normalBalance,
        statementLine: postable ? (parent.class === 'asset' ? 'bs.cash' : null) : null,
        ...values,
      })
      .returning();
    if (!row) throw new Error('no account inserted');
    return row;
  });
}

const updateAccount = (code: string, change: Partial<NewAccount>) =>
  inA((tx) => tx.update(chartAccounts).set(change).where(eq(chartAccounts.code, code)));

beforeAll(async () => {
  const [row] = await app
    .insert(users)
    .values({ email: 'chart.person@example.test', name: 'شخص تجريبي' })
    .returning({ id: users.id });
  if (!row) throw new Error('no user inserted');
  personId = row.id;
  companyA = await company();
  companyB = await company();
  // A small tree in company A: 1 → 11 → 111 (header) → 111001 (postable, USD, monetary).
  await addAccount('1', { code: '11', kind: 'header' });
  await addAccount('11', { code: '111', kind: 'header' });
  await addAccount('111', { code: '111001', currency: 'USD', isMonetary: true });
});

describe('the database lists', () => {
  it('match the contracts: roles, statement lines, contract kinds, sources', () => {
    expect(accountRole.enumValues).toEqual(ACCOUNT_ROLES);
    expect([
      ...CHART_STATEMENT_LINES.balance_sheet,
      ...CHART_STATEMENT_LINES.income_statement,
    ]).toEqual(STATEMENT_LINES.map((line) => line.code));
    expect(CHART_STATEMENT_LINES.balance_sheet).toEqual(
      STATEMENT_LINES.filter((line) => line.statement === 'balance_sheet').map((line) => line.code),
    );
    expect(VALUE_CONTRACT_KINDS).toEqual(CONTRACT_KINDS);
    expect(VALUE_EXTERNAL_SOURCES).toEqual(DIMENSION_EXTERNAL_SOURCES);
    expect(RATE_ROW_SOURCES).toEqual(RATE_SOURCES);
  });
});

describe('a new company', () => {
  it('has the five roots and the four built-in dimension types, made in its creation transaction', async () => {
    for (const companyId of [companyA, companyB]) {
      const [roots, types] = await withCompany(app, companyId, async (tx) => [
        await tx.select().from(chartAccounts).where(eq(chartAccounts.level, 1)),
        await tx.select().from(dimensionTypes),
      ]);
      expect(
        roots.map((root) => [root.code, root.class, root.kind, root.name, root.nameLatin]).sort(),
      ).toEqual(
        ROOT_ACCOUNTS.map((root) => [root.code, root.class, 'header', root.name, root.nameLatin]),
      );
      expect(
        types
          .sort((a, b) => a.position - b.position)
          .map((type) => [type.code, type.builtin, type.name, type.nameLatin, type.position]),
      ).toEqual(
        BUILTIN_DIMENSION_TYPES.map((type) => [
          type.code,
          true,
          type.name,
          type.nameLatin,
          type.position,
        ]),
      );
      const client = types.find((type) => type.code === 'client');
      expect(types.find((type) => type.code === 'contract')?.parentTypeId).toBe(client?.id);
    }
  });

  it('defaults the bulletin days off to Friday and Saturday, and keeps one publication day', async () => {
    const settings = await inA(async (tx) => (await tx.select().from(companySettings))[0]);
    expect(settings?.bulletinDaysOff).toEqual([5, 6]);
    expect(
      await refusal(
        inA((tx) => tx.update(companySettings).set({ bulletinDaysOff: [1, 2, 3, 4, 5, 6, 7] })),
      ),
    ).toMatch(CHECK);
    expect(
      await refusal(inA((tx) => tx.update(companySettings).set({ bulletinDaysOff: [8] }))),
    ).toMatch(CHECK);
    await inA((tx) => tx.update(companySettings).set({ bulletinDaysOff: [5] }));
    await inA((tx) => tx.update(companySettings).set({ bulletinDaysOff: [5, 6] }));
  });
});

describe('the chart checks (S02 checks 1–4, 6)', () => {
  it('refuses a code that breaks its level’s shape or its class', async () => {
    expect(await refusal(addAccount('111', { code: '111000' }))).toMatch(CHECK);
    // A seven-digit code reaches the tree trigger, which runs before the checks.
    expect(await refusal(addAccount('111', { code: '1110071' }))).toMatch(
      /check constraint|chart_accounts:/,
    );
    expect(await refusal(addAccount('111', { code: '111002', class: 'liability' }))).toMatch(CHECK);
  });

  it('refuses a postable account at level 2, and a header with a statement line or flags', async () => {
    expect(
      await refusal(addAccount('1', { code: '12', kind: 'postable', statementLine: 'bs.cash' })),
    ).toMatch(CHECK);
    expect(
      await refusal(
        addAccount('111', { code: '111002', kind: 'header', statementLine: 'bs.cash' }),
      ),
    ).toMatch(CHECK);
    expect(
      await refusal(addAccount('111', { code: '111002', kind: 'header', currency: 'USD' })),
    ).toMatch(CHECK);
  });

  it('needs a statement line on a postable account that fits its class', async () => {
    expect(await refusal(addAccount('111', { code: '111002', statementLine: null }))).toMatch(
      CHECK,
    );
    expect(
      await refusal(addAccount('111', { code: '111002', statementLine: 'is.revenue' })),
    ).toMatch(CHECK);
    expect(
      await refusal(addAccount('111', { code: '111002', statementLine: 'bs.unknown' })),
    ).toMatch(CHECK);
  });

  it('keeps the monetary and control flags on assets and liabilities', async () => {
    await addAccount('4', { code: '41', kind: 'header' });
    await addAccount('41', { code: '411', kind: 'header' });
    expect(
      await refusal(
        addAccount('411', { code: '411001', statementLine: 'is.revenue', isMonetary: true }),
      ),
    ).toMatch(CHECK);
  });

  it('needs a reason with blocking and archiving, and blocks only postable accounts', async () => {
    expect(
      await refusal(updateAccount('111001', { blockedAt: new Date(), blockedReason: null })),
    ).toMatch(CHECK);
    expect(
      await refusal(updateAccount('111', { blockedAt: new Date(), blockedReason: 'سبب' })),
    ).toMatch(CHECK);
  });

  it('keeps codes unique in a company and free across companies', async () => {
    expect(await refusal(addAccount('111', { code: '111001' }))).toMatch(UNIQUE);
    const rootB = await accountByCode('1', companyB);
    await withCompany(app, companyB, (tx) =>
      tx.insert(chartAccounts).values({
        companyId: companyB,
        parentId: rootB.id,
        code: '11',
        level: 2,
        kind: 'header',
        class: 'asset',
        name: 'حساب تجريبي',
        normalBalance: 'debit',
      }),
    );
  });
});

describe('the chart tree (S02 rules 2–3)', () => {
  it('refuses a child under a postable account, a code not extending its parent, and a skipped level', async () => {
    expect(await refusal(addAccount('111001', { code: '111002' }))).toMatch(GUARD);
    expect(await refusal(addAccount('111', { code: '112001' }))).toMatch(GUARD);
    expect(await refusal(addAccount('11', { code: '111002' }))).toMatch(GUARD);
  });

  it('refuses a parent of another company (composite key)', async () => {
    const rootB = await accountByCode('1', companyB);
    expect(
      await refusal(
        inA((tx) =>
          tx.insert(chartAccounts).values({
            companyId: companyA,
            parentId: rootB.id,
            code: '12',
            level: 2,
            kind: 'header',
            class: 'asset',
            name: 'حساب تجريبي',
            normalBalance: 'debit',
          }),
        ),
      ),
    ).toMatch(/violates foreign key constraint|chart_accounts:/);
  });

  it('only renames a root', async () => {
    await updateAccount('5', { name: 'المصاريف التشغيلية' });
    await updateAccount('5', { name: 'المصاريف' });
    expect(await refusal(updateAccount('5', { normalBalance: 'credit' }))).toMatch(GUARD);
    expect(
      await refusal(updateAccount('5', { archivedAt: new Date(), archivedReason: 'سبب' })),
    ).toMatch(GUARD);
  });

  it('moves an unused leaf with a valid code, and turns an unused childless postable account into a header', async () => {
    await addAccount('11', { code: '112', kind: 'header' });
    await addAccount('111', { code: '111005' });
    const target = await accountByCode('112');
    await updateAccount('111005', { parentId: target.id, code: '112005' });
    await updateAccount('112005', { kind: 'header', statementLine: null });
    await updateAccount('112005', { kind: 'postable', statementLine: 'bs.trade_receivables' });
  });

  it('locks a header with children: it never becomes postable or moves', async () => {
    expect(
      await refusal(updateAccount('111', { kind: 'postable', statementLine: 'bs.cash' })),
    ).toMatch(GUARD);
    expect(await refusal(updateAccount('111', { normalBalance: 'credit' }))).toMatch(GUARD);
    await updateAccount('111', { name: 'النقد', nameLatin: 'Cash' });
  });

  it('archives an account only without unarchived children, and refuses children under an archived header', async () => {
    expect(
      await refusal(updateAccount('111', { archivedAt: new Date(), archivedReason: 'سبب' })),
    ).toMatch(GUARD);
    await addAccount('11', { code: '113', kind: 'header' });
    await updateAccount('113', { archivedAt: new Date(), archivedReason: 'سبب تجريبي' });
    expect(await refusal(addAccount('113', { code: '113001' }))).toMatch(GUARD);
    await updateAccount('113', { archivedAt: null, archivedReason: null });
    await addAccount('113', { code: '113001' });
  });
});

describe('the lock after first use (S02 check 5) as the app role', () => {
  // 111008 is a plain asset account (no currency, no flags), so each change below is otherwise
  // valid and only the lock refuses it.
  const LOCK = /locked since its first use/;
  let otherHeader = '';
  const locked = (): [string, Partial<NewAccount>][] => [
    ['code', { code: '111009' }],
    ['parent (a move with a valid code)', { parentId: otherHeader, code: '112008' }],
    ['kind', { kind: 'header', statementLine: null }],
    ['normal balance', { normalBalance: 'credit' }],
    ['currency', { currency: 'SYP' }],
    ['control flag', { isControl: true }],
    ['monetary flag', { isMonetary: true }],
    ['first use', { firstPostedAt: new Date('2026-11-05T09:00:00Z') }],
  ];

  beforeAll(async () => {
    await addAccount('111', { code: '111008' });
    otherHeader = (await accountByCode('112')).id;
    // Set as the posting function will at the first posted line (S03).
    await updateAccount('111008', { firstPostedAt: new Date('2026-11-04T09:00:00Z') });
  });

  it('refuses a change of each locked field by the lock itself', async () => {
    for (const [field, change] of locked()) {
      expect(await refusal(updateAccount('111008', change)), field).toMatch(LOCK);
    }
  });

  it('accepts the same changes on an unused account', async () => {
    await addAccount('111', { code: '111010' });
    const changes: [Partial<NewAccount>, Partial<NewAccount>][] = [
      [{ code: '111011' }, { code: '111010' }],
      [
        { kind: 'header', statementLine: null },
        { kind: 'postable', statementLine: 'bs.cash' },
      ],
      [{ normalBalance: 'credit' }, { normalBalance: 'debit' }],
      [{ currency: 'SYP' }, { currency: null }],
      [{ isControl: true }, { isControl: false }],
      [{ isMonetary: true }, { isMonetary: false }],
    ];
    for (const [change, undo] of changes) {
      await updateAccount('111010', change);
      await updateAccount(change.code ?? '111010', undo);
    }
  });

  it('refuses a change of the level or class, which the code fixes, from the checks or the lock', async () => {
    for (const change of [
      { level: 3 },
      { class: 'liability', statementLine: 'bs.trade_payables' },
    ]) {
      expect(await refusal(updateAccount('111008', change))).toMatch(
        /locked since its first use|violates check constraint/,
      );
    }
  });

  it('keeps the names, the statement line and blocking editable', async () => {
    await updateAccount('111008', {
      name: 'اسم جديد',
      nameLatin: 'New name',
      statementLine: 'bs.other_current_assets',
    });
    await updateAccount('111008', { blockedAt: new Date(), blockedReason: 'سبب تجريبي' });
    await updateAccount('111008', { blockedAt: null, blockedReason: null });
    const row = await accountByCode('111008');
    expect(row).toMatchObject({ name: 'اسم جديد', statementLine: 'bs.other_current_assets' });
  });

  it('refuses the same changes from the owner role', async () => {
    expect(
      await refusal(
        withCompany(owner, companyA, (tx) =>
          tx.update(chartAccounts).set({ currency: 'EUR' }).where(eq(chartAccounts.code, '111008')),
        ),
      ),
    ).toMatch(/locked since its first use/);
  });
});

describe('required dimensions and account roles', () => {
  it('requires a dimension of a postable account only, and of an unarchived type', async () => {
    const client = await typeByCode('client');
    const cash = await accountByCode('111001');
    const header = await accountByCode('111');
    await inA((tx) =>
      tx.insert(accountRequiredDimensions).values({
        companyId: companyA,
        accountId: cash.id,
        dimensionTypeId: client.id,
      }),
    );
    expect(
      await refusal(
        inA((tx) =>
          tx.insert(accountRequiredDimensions).values({
            companyId: companyA,
            accountId: cash.id,
            dimensionTypeId: client.id,
          }),
        ),
      ),
    ).toMatch(UNIQUE);
    expect(
      await refusal(
        inA((tx) =>
          tx.insert(accountRequiredDimensions).values({
            companyId: companyA,
            accountId: header.id,
            dimensionTypeId: client.id,
          }),
        ),
      ),
    ).toMatch(GUARD);
    // An account that requires a dimension does not become a header.
    expect(
      await refusal(
        updateAccount('111001', {
          kind: 'header',
          statementLine: null,
          currency: null,
          isMonetary: false,
        }),
      ),
    ).toMatch(GUARD);
  });

  it('sets a role on a postable account that fits it, and keeps that account unblocked and unarchived', async () => {
    await addAccount('4', { code: '42', kind: 'header' });
    await addAccount('42', { code: '421', kind: 'header' });
    const gain = await addAccount('421', { code: '421001', statementLine: 'is.fx_differences' });
    const cash = await accountByCode('111001');
    expect(
      await refusal(
        inA((tx) =>
          tx.insert(accountRoles).values({
            companyId: companyA,
            role: 'fx_realised_gain',
            accountId: cash.id,
          }),
        ),
      ),
    ).toMatch(GUARD);
    expect(
      await refusal(
        inA((tx) =>
          tx.insert(accountRoles).values({
            companyId: companyA,
            role: 'fx_realised_loss',
            accountId: gain.id,
          }),
        ),
      ),
    ).toMatch(GUARD);
    await inA((tx) =>
      tx
        .insert(accountRoles)
        .values({ companyId: companyA, role: 'fx_realised_gain', accountId: gain.id }),
    );
    expect(
      await refusal(
        inA((tx) =>
          tx.insert(accountRoles).values({
            companyId: companyA,
            role: 'fx_realised_gain',
            accountId: gain.id,
          }),
        ),
      ),
    ).toMatch(UNIQUE);
    expect(
      await refusal(updateAccount('421001', { blockedAt: new Date(), blockedReason: 'سبب' })),
    ).toMatch(GUARD);
    // An unused role account moved to an expense code would no longer fit its gain role.
    await addAccount('5', { code: '54', kind: 'header' });
    await addAccount('54', { code: '541', kind: 'header' });
    const lossHeader = await accountByCode('541');
    expect(
      await refusal(
        updateAccount('421001', {
          parentId: lossHeader.id,
          code: '541009',
          class: 'expense',
          normalBalance: 'debit',
        }),
      ),
    ).toMatch(/would no longer fit/);
    expect(
      await refusal(updateAccount('421001', { archivedAt: new Date(), archivedReason: 'سبب' })),
    ).toMatch(GUARD);
    expect(
      await refusal(
        inA((tx) =>
          tx
            .update(accountRoles)
            .set({ role: 'conversion_rounding' })
            .where(eq(accountRoles.accountId, gain.id)),
        ),
      ),
    ).toMatch(GUARD);
  });
});

describe('dimension types and values', () => {
  it('never archives a built-in type, nor changes a type’s code', async () => {
    const service = await typeByCode('service');
    expect(
      await refusal(
        inA((tx) =>
          tx
            .update(dimensionTypes)
            .set({ archivedAt: new Date() })
            .where(eq(dimensionTypes.id, service.id)),
        ),
      ),
    ).toMatch(CHECK);
    expect(
      await refusal(
        inA((tx) =>
          tx
            .update(dimensionTypes)
            .set({ code: 'services' })
            .where(eq(dimensionTypes.id, service.id)),
        ),
      ),
    ).toMatch(GUARD);
    expect(
      await refusal(
        inA((tx) =>
          tx.insert(dimensionTypes).values({
            companyId: companyA,
            code: 'region',
            builtin: true,
            name: 'منطقة',
            position: 5,
          }),
        ),
      ),
    ).toMatch(CHECK);
  });

  it('keeps at most 10 active types, and archives a type no account requires', async () => {
    const added: string[] = [];
    for (let index = 1; index <= 6; index += 1) {
      const [row] = await inA((tx) =>
        tx
          .insert(dimensionTypes)
          .values({
            companyId: companyA,
            code: `custom_${index}`,
            builtin: false,
            name: `نوع ${index}`,
            position: 4 + index,
          })
          .returning({ id: dimensionTypes.id }),
      );
      if (row) added.push(row.id);
    }
    expect(
      await refusal(
        inA((tx) =>
          tx.insert(dimensionTypes).values({
            companyId: companyA,
            code: 'custom_7',
            builtin: false,
            name: 'نوع 7',
            position: 11,
          }),
        ),
      ),
    ).toMatch(/at most 10 active types/);
    const [first] = added;
    await inA((tx) =>
      tx
        .update(dimensionTypes)
        .set({ archivedAt: new Date() })
        .where(eq(dimensionTypes.id, first as string)),
    );
    // A type an account requires is not archived.
    const second = added[1] as string;
    const cash = await accountByCode('111001');
    await inA((tx) =>
      tx.insert(accountRequiredDimensions).values({
        companyId: companyA,
        accountId: cash.id,
        dimensionTypeId: second,
      }),
    );
    expect(
      await refusal(
        inA((tx) =>
          tx
            .update(dimensionTypes)
            .set({ archivedAt: new Date() })
            .where(eq(dimensionTypes.id, second)),
        ),
      ),
    ).toMatch(GUARD);
    // With the archived one's place taken, restoring it would make 11 active types.
    await inA((tx) =>
      tx.insert(dimensionTypes).values({
        companyId: companyA,
        code: 'custom_7',
        builtin: false,
        name: 'نوع 7',
        position: 11,
      }),
    );
    expect(
      await refusal(
        inA((tx) =>
          tx
            .update(dimensionTypes)
            .set({ archivedAt: null })
            .where(eq(dimensionTypes.id, first as string)),
        ),
      ),
    ).toMatch(/at most 10 active types/);
  });

  it('holds contract values to their kind and client, and other values to neither', async () => {
    const client = await typeByCode('client');
    const contract = await typeByCode('contract');
    const department = await typeByCode('department');
    const [clientValue] = await inA((tx) =>
      tx
        .insert(dimensionValues)
        .values({ companyId: companyA, typeId: client.id, name: 'عميل تجريبي' })
        .returning(),
    );
    if (!clientValue) throw new Error('no client value');
    await inA((tx) =>
      tx.insert(dimensionValues).values({
        companyId: companyA,
        typeId: contract.id,
        name: 'عقد تجريبي',
        contractKind: 'project',
        parentValueId: clientValue.id,
      }),
    );
    // A manual contract may lack its client; a Hub contract may not.
    await inA((tx) =>
      tx.insert(dimensionValues).values({
        companyId: companyA,
        typeId: contract.id,
        name: 'عقد يدوي',
        contractKind: 'retainer',
      }),
    );
    expect(
      await refusal(
        inA((tx) =>
          tx.insert(dimensionValues).values({
            companyId: companyA,
            typeId: contract.id,
            name: 'عقد من Hub',
            contractKind: 'project',
            externalSource: 'hub',
            externalId: 'synthetic-contract-1',
          }),
        ),
      ),
    ).toMatch(GUARD);
    expect(
      await refusal(
        inA((tx) =>
          tx
            .insert(dimensionValues)
            .values({ companyId: companyA, typeId: contract.id, name: 'بلا نوع' }),
        ),
      ),
    ).toMatch(GUARD);
    expect(
      await refusal(
        inA((tx) =>
          tx.insert(dimensionValues).values({
            companyId: companyA,
            typeId: department.id,
            name: 'قسم',
            contractKind: 'project',
          }),
        ),
      ),
    ).toMatch(GUARD);
    expect(
      await refusal(
        inA((tx) =>
          tx.insert(dimensionValues).values({
            companyId: companyA,
            typeId: department.id,
            name: 'قسم',
            parentValueId: clientValue.id,
          }),
        ),
      ),
    ).toMatch(GUARD);
  });

  it('links a value to a Hub ID once, unique within its type', async () => {
    const client = await typeByCode('client');
    const [value] = await inA((tx) =>
      tx
        .insert(dimensionValues)
        .values({ companyId: companyA, typeId: client.id, name: 'عميل للربط', code: 'C-1' })
        .returning(),
    );
    if (!value) throw new Error('no value');
    const link = (externalId: string | null, id = value.id) =>
      inA((tx) =>
        tx
          .update(dimensionValues)
          .set({ externalSource: externalId === null ? null : 'hub', externalId })
          .where(eq(dimensionValues.id, id)),
      );
    await link('synthetic-client-1');
    expect(await refusal(link('synthetic-client-2'))).toMatch(GUARD);
    expect(await refusal(link(null))).toMatch(GUARD);
    const [other] = await inA((tx) =>
      tx
        .insert(dimensionValues)
        .values({ companyId: companyA, typeId: client.id, name: 'عميل آخر' })
        .returning(),
    );
    expect(await refusal(link('synthetic-client-1', other?.id))).toMatch(UNIQUE);
    expect(
      await refusal(
        inA((tx) =>
          tx
            .insert(dimensionValues)
            .values({ companyId: companyA, typeId: client.id, name: 'رمز مكرر', code: 'C-1' }),
        ),
      ),
    ).toMatch(UNIQUE);
  });
});

describe('the rate table', () => {
  const rate = (values: Partial<typeof exchangeRates.$inferInsert> = {}) => ({
    companyId: companyA,
    effectiveOn: '2026-11-04',
    base: 'USD',
    quote: 'SYP',
    rate: '120.0000',
    type: 'bulletin',
    source: 'manual',
    recordedByUserId: personId,
    ...values,
  });
  let original = '';

  beforeAll(async () => {
    await inA((tx) =>
      tx.insert(ratePairs).values({ companyId: companyA, base: 'USD', quote: 'SYP' }),
    );
    const [row] = await inA((tx) => tx.insert(exchangeRates).values(rate()).returning());
    original = row?.id ?? '';
  });

  it('keeps one orientation per pair, and the pair’s currencies', async () => {
    expect(
      await refusal(
        inA((tx) =>
          tx.insert(ratePairs).values({ companyId: companyA, base: 'SYP', quote: 'USD' }),
        ),
      ),
    ).toMatch(UNIQUE);
    expect(
      await refusal(
        inA((tx) => tx.insert(exchangeRates).values(rate({ base: 'SYP', quote: 'USD' }))),
      ),
    ).toMatch(/violates foreign key constraint/);
    expect(
      await refusal(
        inA((tx) => tx.update(ratePairs).set({ base: 'EUR' }).where(eq(ratePairs.base, 'USD'))),
      ),
    ).toMatch(GUARD);
  });

  it('stores the rate exactly as quoted, and refuses zero, SYP before 2026 and two recorders', async () => {
    const [row] = await inA((tx) =>
      tx.select().from(exchangeRates).where(eq(exchangeRates.id, original)),
    );
    expect(row?.rate).toBe('120.0000000000');
    expect(
      await refusal(
        inA((tx) =>
          tx.insert(exchangeRates).values(rate({ rate: '0', effectiveOn: '2026-11-05' })),
        ),
      ),
    ).toMatch(CHECK);
    expect(
      await refusal(
        inA((tx) => tx.insert(exchangeRates).values(rate({ effectiveOn: '2025-12-31' }))),
      ),
    ).toMatch(CHECK);
    expect(
      await refusal(
        inA((tx) =>
          tx
            .insert(exchangeRates)
            .values(rate({ effectiveOn: '2026-11-05', recordedByApiClientId: personId })),
        ),
      ),
    ).toMatch(CHECK);
  });

  it('takes a second row of a date only as a correction with a reason, of the same pair, type and date, once', async () => {
    expect(
      await refusal(inA((tx) => tx.insert(exchangeRates).values(rate({ rate: '121.0000' })))),
    ).toMatch(UNIQUE);
    expect(
      await refusal(
        inA((tx) =>
          tx.insert(exchangeRates).values(rate({ rate: '121.0000', supersedesRateId: original })),
        ),
      ),
    ).toMatch(CHECK);
    expect(
      await refusal(
        inA((tx) =>
          tx.insert(exchangeRates).values(
            rate({
              rate: '121.0000',
              type: 'market',
              supersedesRateId: original,
              reason: 'تصحيح',
            }),
          ),
        ),
      ),
    ).toMatch(GUARD);
    await inA((tx) =>
      tx
        .insert(exchangeRates)
        .values(rate({ rate: '121.0000', supersedesRateId: original, reason: 'تصحيح تجريبي' })),
    );
    expect(
      await refusal(
        inA((tx) =>
          tx
            .insert(exchangeRates)
            .values(rate({ rate: '122.0000', supersedesRateId: original, reason: 'تصحيح ثان' })),
        ),
      ),
    ).toMatch(UNIQUE);
  });

  it('refuses UPDATE and DELETE for the app role (no grant) and the owner (refuse_change)', async () => {
    expect(await refusal(inA((tx) => tx.update(exchangeRates).set({ rate: '1' })))).toMatch(
      /permission denied/,
    );
    expect(await refusal(inA((tx) => tx.delete(exchangeRates)))).toMatch(/permission denied/);
    expect(
      await refusal(
        withCompany(owner, companyA, (tx) => tx.update(exchangeRates).set({ rate: '1' })),
      ),
    ).toMatch(/append-only/);
    expect(await refusal(withCompany(owner, companyA, (tx) => tx.delete(exchangeRates)))).toMatch(
      /append-only/,
    );
  });

  it('keeps one active holiday per date', async () => {
    await inA((tx) =>
      tx
        .insert(bulletinHolidays)
        .values({ companyId: companyA, holidayOn: '2026-11-05', note: 'عطلة تجريبية' }),
    );
    expect(
      await refusal(
        inA((tx) =>
          tx
            .insert(bulletinHolidays)
            .values({ companyId: companyA, holidayOn: '2026-11-05', note: 'مكررة' }),
        ),
      ),
    ).toMatch(UNIQUE);
    await inA((tx) =>
      tx
        .update(bulletinHolidays)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(bulletinHolidays.companyId, companyA),
            eq(bulletinHolidays.holidayOn, '2026-11-05'),
          ),
        ),
    );
    await inA((tx) =>
      tx
        .insert(bulletinHolidays)
        .values({ companyId: companyA, holidayOn: '2026-11-05', note: 'من جديد' }),
    );
  });
});

describe('no deletion', () => {
  const tables = [
    'chart_accounts',
    'account_required_dimensions',
    'account_roles',
    'dimension_types',
    'dimension_values',
    'rate_pairs',
    'bulletin_holidays',
  ];

  it.each(tables)('refuses DELETE and TRUNCATE on %s for the owner too', async (table) => {
    expect(
      await refusal(
        withCompany(owner, companyA, (tx) => tx.execute(sql.raw(`delete from ${table}`))),
      ),
    ).toMatch(/is never deleted/);
    expect(
      await refusal(
        withCompany(owner, companyA, (tx) => tx.execute(sql.raw(`truncate ${table} cascade`))),
      ),
    ).toMatch(/is never deleted|cannot truncate/);
    expect(
      await refusal(
        withCompany(app, companyA, (tx) => tx.execute(sql.raw(`delete from ${table}`))),
      ),
    ).toMatch(/permission denied/);
  });
});
