import type { CompanyLedgers, CurrencyCode } from '@vertex-mizan/contracts';
import { chainEntryValue, verifyChain } from '@vertex-mizan/ledger';
import { eq, sql } from 'drizzle-orm';
import fc from 'fast-check';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  chartAccounts,
  createCompanyBooks,
  dimensionTypes,
  dimensionValues,
  type ManualLineSpec,
  openItemBalances,
  openItems,
  type PersonActor,
  post,
  readChain,
  recordRate,
  users,
  withCompany,
} from '../src/index.js';
import { connect } from './connections.js';

// S04's properties of the posting function on the real database (ADR 0013, invariant 9): after any
// sequence of invoices, partial receipts in USD or SYP, offsets against ad funds, deposits and
// spends of ad funds and voids of any of them, each control account equals the sum of its items
// in every ledger and currency, every document item keeps the sign of its opening, every item at
// zero is zero in every ledger, and the chain verifies with its items. All values are synthetic.

const { app } = connect();

let personId = '';

const actor = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'محاسب مولّد',
  sessionId: null,
  requestId: 'request-item-properties',
  ipAddress: null,
  userAgent: null,
});

const SYP_USD: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

/** Working days of November 2026, each with a bulletin and a market rate. */
const DAYS = ['2026-11-03', '2026-11-10', '2026-11-19', '2026-11-25'] as const;

const rateValue = fc
  .integer({ min: 1_150_000, max: 1_300_000 })
  .map((units) => `${Math.floor(units / 10_000)}.${String(units % 10_000).padStart(4, '0')}`);

const day = fc.nat(DAYS.length - 1);
const amount = fc.bigInt({ min: 1n, max: 5_000_000n });

const operation = fc.oneof(
  fc.record({ kind: fc.constant('invoice' as const), day, amount }),
  fc.record({
    kind: fc.constant('receipt' as const),
    day,
    pick: fc.nat(),
    percent: fc.bigInt({ min: 1n, max: 100n }),
    cash: fc.constantFrom<CurrencyCode>('USD', 'SYP'),
  }),
  fc.record({ kind: fc.constant('deposit' as const), day, amount }),
  fc.record({ kind: fc.constant('spend' as const), day, amount }),
  fc.record({
    kind: fc.constant('offset' as const),
    day,
    pick: fc.nat(),
    percent: fc.bigInt({ min: 1n, max: 100n }),
  }),
  fc.record({ kind: fc.constant('void' as const), day, pick: fc.nat() }),
);

interface Company {
  readonly id: string;
  readonly accounts: Map<string, string>;
  readonly client: string;
  readonly service: string;
}

async function newCompany(rates: readonly (readonly [string, string])[]): Promise<Company> {
  const id = uuidv7();
  await withCompany(app, id, (tx) =>
    createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة مولّدة',
        nameLatin: null,
        ledgers: SYP_USD,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة مولّدة.',
        template: 'service-agency',
        createdByUserId: personId,
      },
      actor(),
    ),
  );
  return withCompany(app, id, async (tx) => {
    for (const [index, on] of DAYS.entries()) {
      const [bulletin, market] = rates[index] as readonly [string, string];
      for (const [type, value] of [
        ['bulletin', bulletin],
        ['market', market],
      ] as const) {
        await recordRate(tx, id, actor(), {
          effectiveOn: on,
          base: 'USD',
          quote: 'SYP',
          rate: value,
          type,
          source: 'manual',
        });
      }
    }
    const types = await tx.select().from(dimensionTypes);
    const typeId = (code: string) => types.find((type) => type.code === code)?.id as string;
    const [client] = await tx
      .insert(dimensionValues)
      .values({ companyId: id, typeId: typeId('client'), code: 'C1', name: 'عميل مولّد' })
      .returning({ id: dimensionValues.id });
    const [service] = await tx
      .insert(dimensionValues)
      .values({ companyId: id, typeId: typeId('service'), code: 'S1', name: 'خدمة مولّدة' })
      .returning({ id: dimensionValues.id });
    const accounts = await tx
      .select({ id: chartAccounts.id, code: chartAccounts.code })
      .from(chartAccounts);
    return {
      id,
      accounts: new Map(accounts.map((row) => [row.code, row.id])),
      client: client?.id as string,
      service: service?.id as string,
    };
  });
}

type Line = readonly [
  code: string,
  currency: CurrencyCode,
  amount: bigint,
  extra?: Partial<ManualLineSpec>,
];

function postLines(company: Company, on: string, lines: readonly Line[]) {
  return withCompany(app, company.id, (tx) =>
    post(tx, {
      client: 'manual',
      idempotencyKey: uuidv7(),
      entryDate: on,
      description: 'قيد مولّد',
      reference: null,
      draftId: null,
      preparedByUserId: personId,
      approvedByUserId: null,
      actor: actor(),
      content: {
        kind: 'manual',
        today: '2026-11-30',
        dealtRates: [],
        lines: lines.map(([code, currency, amountMinor, extra]) => ({
          accountId: company.accounts.get(code) as string,
          dimensionValueIds: [],
          currency,
          amountMinor,
          memo: null,
          ...extra,
        })),
      },
    }),
  );
}

const reverse = (company: Company, entryId: string, on: string) =>
  withCompany(app, company.id, (tx) =>
    post(tx, {
      client: 'manual',
      idempotencyKey: `reversal:${entryId}`,
      entryDate: on,
      description: 'عكس مولّد',
      reference: null,
      draftId: null,
      preparedByUserId: personId,
      approvedByUserId: null,
      actor: actor(),
      content: { kind: 'reversal', entryId, today: '2026-11-30' },
    }),
  );

/** What a document item holds open, read from its balance row. */
const openOf = (company: Company, itemId: string) =>
  withCompany(app, company.id, async (tx) => {
    const [row] = await tx
      .select({ open: openItemBalances.openMinor })
      .from(openItemBalances)
      .where(eq(openItemBalances.itemId, itemId));
    return row?.open ?? 0n;
  });

beforeAll(async () => {
  const [row] = await app
    .insert(users)
    .values({ email: 'item.properties@example.test', name: 'محاسب مولّد' })
    .returning({ id: users.id });
  if (!row) throw new Error('no user inserted');
  personId = row.id;
});

describe('open items, as a property', () => {
  it('keep every control account equal to its items, within sign and zero at zero, through any sequence', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Each day's rate differs from the day before's: the rate table refuses a repeat.
        fc
          .tuple(
            fc.uniqueArray(rateValue, { minLength: DAYS.length, maxLength: DAYS.length }),
            fc.uniqueArray(rateValue, { minLength: DAYS.length, maxLength: DAYS.length }),
          )
          .map(([bulletins, markets]) =>
            bulletins.map((bulletin, index) => [bulletin, markets[index] as string] as const),
          ),
        fc.array(operation, { minLength: 1, maxLength: 10 }),
        async (rates, operations) => {
          const company = await newCompany(rates);
          // Entries that may be voided: manual entries not yet reversed, by their date.
          const voidable: { id: string; on: string; reference: string | null }[] = [];
          const clientDims = { dimensionValueIds: [company.client] };
          for (const [index, step] of operations.entries()) {
            const on = DAYS[step.day] as string;
            const later = (entry: { on: string }) => entry.on <= on;
            if (step.kind === 'invoice') {
              const reference = `M-${index}`;
              const posted = await postLines(company, on, [
                [
                  '112001',
                  'USD',
                  step.amount,
                  { ...clientDims, newItem: { reference, dueOn: null } },
                ],
                [
                  '411001',
                  'USD',
                  -step.amount,
                  { dimensionValueIds: [company.client, company.service] },
                ],
              ]);
              voidable.push({ id: posted.id, on, reference });
              continue;
            }
            if (step.kind === 'deposit' || step.kind === 'spend') {
              const sign = step.kind === 'deposit' ? -1n : 1n;
              const posted = await postLines(company, on, [
                ['213001', 'USD', sign * step.amount, clientDims],
                [
                  step.kind === 'deposit' ? '111004' : '211001',
                  'USD',
                  -sign * step.amount,
                  step.kind === 'spend' ? clientDims : {},
                ],
              ]);
              voidable.push({ id: posted.id, on, reference: null });
              continue;
            }
            if (step.kind === 'void') {
              const candidates = voidable.filter(later);
              const chosen = candidates[step.pick % Math.max(candidates.length, 1)];
              if (chosen === undefined) continue;
              try {
                await reverse(company, chosen.id, on);
                voidable.splice(voidable.indexOf(chosen), 1);
              } catch (error) {
                // An invoice whose receipts stand waits for them (S04 rule 13).
                expect(error).toMatchObject({ code: 'OPEN_ITEM_HAS_SETTLEMENTS' });
              }
              continue;
            }
            const items = await withCompany(app, company.id, (tx) =>
              tx
                .select({ id: openItems.id, reference: openItems.reference })
                .from(openItems)
                .where(eq(openItems.kind, 'document')),
            );
            const open = [];
            for (const item of items) {
              const left = await openOf(company, item.id);
              if (left !== 0n) open.push({ id: item.id, left });
            }
            const chosen = open[step.pick % Math.max(open.length, 1)];
            if (chosen === undefined) continue;
            const part = (chosen.left * step.percent) / 100n;
            if (part === 0n) continue;
            const settle: Line = ['112001', 'USD', -part, { openItemId: chosen.id }];
            const lines: Line[] =
              step.kind === 'offset'
                ? [['213001', 'USD', part, clientDims], settle]
                : step.cash === 'USD'
                  ? [['111004', 'USD', part], settle]
                  : [['111003', 'SYP', part * 120n], settle];
            const posted = await postLines(company, on, lines);
            voidable.push({ id: posted.id, on, reference: null });
          }

          const state = await withCompany(app, company.id, async (tx) => ({
            accounts: await tx.execute<{
              code: string;
              currency: string;
              amount: string;
              book: string;
              parallel: string;
            }>(sql`
              select a.code, b.currency,
                     sum(b.debit_minor - b.credit_minor)::text as amount,
                     sum(b.book_debit_minor - b.book_credit_minor)::text as book,
                     sum(b.parallel_debit_minor - b.parallel_credit_minor)::text as parallel
              from period_balances b
              join chart_accounts a on a.company_id = b.company_id and a.id = b.account_id
              where a.is_control
              group by a.code, b.currency
              order by a.code, b.currency`),
            items: await tx.execute<{
              code: string;
              currency: string;
              amount: string;
              book: string;
              parallel: string;
            }>(sql`
              select a.code, i.currency,
                     sum(b.open_minor)::text as amount, sum(b.book_minor)::text as book,
                     sum(b.parallel_minor)::text as parallel
              from open_item_balances b
              join open_items i on i.company_id = b.company_id and i.id = b.item_id
              join chart_accounts a on a.company_id = i.company_id and a.id = i.account_id
              group by a.code, i.currency
              order by a.code, i.currency`),
            broken: await tx.execute<{ id: string }>(sql`
              select i.id from open_items i
              join open_item_balances b on b.company_id = i.company_id and b.item_id = i.id
              left join open_item_movements m on m.company_id = i.company_id and m.item_id = i.id
                and m.kind = 'open' and m.entry_id = i.opened_by_entry_id
              where (i.kind = 'document' and sign(b.open_minor) = -sign(m.amount_minor))
                 or (b.open_minor = 0 and (b.book_minor <> 0 or coalesce(b.parallel_minor, 0) <> 0))`),
            chain: await readChain(tx),
          }));
          expect(state.items.rows).toEqual(state.accounts.rows);
          expect(state.broken.rows).toEqual([]);
          expect(
            verifyChain(
              state.chain.map((link) => ({
                entry: chainEntryValue(link.entry),
                previousHash: link.previousHash,
                hash: link.hash,
              })),
            ),
          ).toBeNull();
        },
      ),
      { numRuns: 25, includeErrorInReport: true },
    );
  }, 120_000);
});
