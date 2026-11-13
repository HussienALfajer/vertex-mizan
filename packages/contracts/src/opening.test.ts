import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  isContractAsset,
  OPENING_CHECKS,
  type OpeningSnapshot,
  openingSnapshotResultSchema,
  openingSnapshotSchema,
  openingSnapshotTotals,
  saveOpeningSchema,
} from './opening.js';
import {
  openingEntryResultSchema,
  openingExportQuerySchema,
  openingViewSchema,
  reverseOpeningSchema,
} from './opening-view.js';

// Synthetic ids and amounts only (AGENTS.md: public repository).
const id = (n: number) => `01934b6e-0000-7000-8000-${String(n).padStart(12, '0')}`;
const client = { external_id: 'C1', name: 'Client one' };
const retainer = {
  external_id: 'R1',
  name: 'Retainer one',
  kind: 'retainer' as const,
  client_external_id: 'C1',
};
const service = { external_id: 'S1', name: 'Service one' };

const invoice = {
  invoice: { id: id(1), number: 'INV-1' },
  client,
  contract: retainer,
  currency: 'USD',
  syp_per_usd: '117.0000',
  issued_on: '2026-09-10',
  due_on: '2026-09-25',
  total: 30_000,
  outstanding: 30_000,
  lines: [
    {
      id: id(2),
      amount: 30_000,
      service,
      source: 'retainer_charge',
      charge_kind: 'monthly',
      cycle_start: '2026-09-16',
      cycle_end: '2026-10-15',
    },
  ],
};

const snapshot = {
  as_of: '2026-09-30',
  generated_at: '2026-10-25T08:00:00+03:00',
  invoices: [invoice],
  credits: [
    {
      invoice: { id: id(3), number: 'INV-2' },
      client,
      contract: retainer,
      currency: 'USD',
      syp_per_usd: '117.5000',
      issued_on: '2026-09-24',
      line: {
        id: id(4),
        amount: -6_000,
        service,
        source: 'retainer_charge',
        charge_kind: 'credit',
        cycle_start: '2026-09-16',
      },
    },
  ],
  milestones: [
    {
      milestone: { id: id(5), number: 'MS-1' },
      client,
      project: { ...retainer, external_id: 'P1', kind: 'project' },
      currency: 'USD',
      amount: 40_000,
      done_on: '2026-09-25',
    },
  ],
  wallets: [{ client, balance: -12_000 }],
  prior_documents: {
    invoices: [{ invoice: invoice.invoice, issued_on: '2026-09-10' }],
    payments: [
      { payment: { id: id(6), number: 'R-1' }, invoice: invoice.invoice, paid_on: '2026-09-21' },
    ],
  },
};

const issuesOf = (input: unknown) => {
  const result = openingSnapshotSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('openingSnapshotSchema (S10 rules 5–6)', () => {
  it('reads a snapshot, the register filled with empty lists', () => {
    const parsed = openingSnapshotSchema.parse(snapshot);
    expect(parsed.prior_documents.wallet_entries).toEqual([]);
    expect(parsed.prior_documents.payments).toHaveLength(1);
    expect(
      openingSnapshotSchema.parse({ as_of: '2026-09-30', generated_at: snapshot.generated_at }),
    ).toMatchObject({ invoices: [], credits: [], milestones: [], wallets: [] });
  });

  it('refuses lines that do not sum to the total, and an outstanding above it', () => {
    expect(issuesOf({ ...snapshot, invoices: [{ ...invoice, total: 30_001 }] })).toContain(
      'invoices.0.total',
    );
    expect(issuesOf({ ...snapshot, invoices: [{ ...invoice, outstanding: 30_001 }] })).toContain(
      'invoices.0.outstanding',
    );
  });

  it('refuses an id listed twice and a date after the eve', () => {
    expect(issuesOf({ ...snapshot, invoices: [invoice, invoice] })).toContain('invoices.1');
    expect(
      issuesOf({
        ...snapshot,
        invoices: [{ ...invoice, issued_on: '2026-10-01', due_on: '2026-10-01' }],
      }),
    ).toContain('invoices.0.issued_on');
    expect(
      issuesOf({
        ...snapshot,
        prior_documents: {
          project_expenses: [{ expense: { id: id(7), number: 'E-1' }, spent_on: '2026-10-02' }],
        },
      }),
    ).toContain('prior_documents.project_expenses.0');
  });

  it('refuses a reference it cannot resolve', () => {
    const line = { ...invoice.lines[0], source: 'deposit', milestone_id: id(9) };
    delete (line as { charge_kind?: string }).charge_kind;
    delete (line as { cycle_start?: string }).cycle_start;
    delete (line as { cycle_end?: string }).cycle_end;
    expect(
      issuesOf({ ...snapshot, credits: [], invoices: [{ ...invoice, lines: [line] }] }),
    ).toContain('invoices.0.lines.0.milestone_id');
    const credit = snapshot.credits[0] as (typeof snapshot.credits)[number];
    expect(
      issuesOf({
        ...snapshot,
        credits: [{ ...credit, line: { ...credit.line, cycle_start: '2026-08-16' } }],
      }),
    ).toContain('credits.0.line.cycle_start');
    expect(issuesOf({ ...snapshot, credits: [{ ...credit, invoice: invoice.invoice }] })).toContain(
      'credits.0.invoice',
    );
  });

  it('refuses a wallet at zero and a credit that is not a retainer credit', () => {
    expect(issuesOf({ ...snapshot, wallets: [{ client, balance: 0 }] })).toContain(
      'wallets.0.balance',
    );
    const credit = snapshot.credits[0] as (typeof snapshot.credits)[number];
    expect(
      issuesOf({
        ...snapshot,
        credits: [{ ...credit, line: { ...credit.line, amount: 6_000, charge_kind: 'addition' } }],
      }),
    ).toContain('credits.0.line');
  });

  it('converts to JSON Schema', () => {
    expect(() => z.toJSONSchema(openingSnapshotSchema, { io: 'input' })).not.toThrow();
    expect(() => z.toJSONSchema(openingSnapshotResultSchema)).not.toThrow();
  });
});

describe('openingSnapshotTotals (S10 rule 9)', () => {
  it('counts each list and sums it per currency', () => {
    const parsed: OpeningSnapshot = openingSnapshotSchema.parse(snapshot);
    const [milestone] = parsed.milestones;
    if (milestone === undefined) throw new Error('A milestone');
    expect(isContractAsset(milestone)).toBe(true);
    expect(isContractAsset({ ...milestone, invoiced_on: '2026-09-28' })).toBe(false);
    expect(openingSnapshotTotals(parsed)).toEqual({
      counts: { invoices: 1, credits: 1, milestones: 1, wallets: 1, prior_documents: 2 },
      totals: [
        { list: 'invoices', currency: 'USD', amount: 30_000 },
        { list: 'credits', currency: 'USD', amount: -6_000 },
        { list: 'contract_assets', currency: 'USD', amount: 40_000 },
        { list: 'wallets', currency: 'USD', amount: -12_000 },
      ],
    });
  });
});

describe('saveOpeningSchema (S10 rule 16)', () => {
  it('reads lines with their defaults and refuses a figure listed twice', () => {
    const figure = { slot: 'receivable', clientValueId: id(1), currency: 'USD', amount: '30000' };
    const parsed = saveOpeningSchema.parse({
      version: 0,
      lines: [{ accountId: id(2), currency: 'SYP', amount: '-100' }],
      recordFigures: [figure],
    });
    expect(parsed.lines[0]).toMatchObject({
      book: null,
      parallel: null,
      itemReference: null,
      dimensionValueIds: [],
    });
    expect(
      saveOpeningSchema.safeParse({ version: 1, lines: [], recordFigures: [figure, figure] })
        .success,
    ).toBe(false);
    expect(
      saveOpeningSchema.safeParse({
        version: 1,
        lines: [{ accountId: id(2), currency: 'SYP', amount: '0' }],
        recordFigures: [],
      }).success,
    ).toBe(false);
  });

  it('lists the checks in the order a refusal names them', () => {
    expect(OPENING_CHECKS).toEqual([
      'snapshot',
      'records_agree',
      'rates',
      'mappings',
      'schedules',
      'lines',
    ]);
  });
});

describe('the view of GET /api/opening (S10 rule 20)', () => {
  it('converts to JSON Schema with its ids', () => {
    for (const schema of [openingViewSchema, openingEntryResultSchema, reverseOpeningSchema]) {
      expect(() =>
        z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'throw' }),
      ).not.toThrow();
    }
    expect(reverseOpeningSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(reverseOpeningSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });

  it("takes the export's part, the preview or the agreement", () => {
    expect(openingExportQuerySchema.parse({ part: 'agreement' })).toEqual({ part: 'agreement' });
    expect(openingExportQuerySchema.safeParse({ part: 'snapshot' }).success).toBe(false);
    expect(openingExportQuerySchema.safeParse({}).success).toBe(false);
  });
});
