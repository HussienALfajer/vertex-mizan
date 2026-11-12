import { z } from 'zod';
import { lineKindSchema } from './entries.js';
import {
  checkIssuedInvoice,
  hubContractRefSchema,
  hubCurrencySchema,
  hubDateSchema,
  hubDocumentIdSchema,
  hubValueRefSchema,
  invoiceIssuedFieldsV1,
  invoiceLineSchema,
  positiveMinorSchema,
  sypPerUsdSchema,
} from './events.js';
import { currencyCodeSchema } from './money.js';
import { openingStateSchema } from './opening-states.js';
import { entryNumberSchema, minorUnitsSchema } from './wire.js';

// The opening balances (S10, ADR 0019): Hub's snapshot of its open documents as of the eve of the
// books start (`POST /v1/opening/snapshot`, rules 5–9), the accountant's draft (rules 14–16) and
// the names of its states and checks (rule 21). Hub's names are snake_case and its amounts JSON
// integers in minor units, as in `events.ts`; the internal `/api` sends amounts as `MinorUnits`.

// The states live in `opening-states.ts`, which `companies.ts` reads without the snapshot's
// schemas.
export * from './opening-states.js';

/** The checks that must all pass to post (S10 rule 21), in the order a refusal lists them. */
export const OPENING_CHECKS = [
  'snapshot',
  'records_agree',
  'rates',
  'mappings',
  'schedules',
  'lines',
] as const;

export const openingCheckSchema = z.enum(OPENING_CHECKS).meta({ id: 'OpeningCheck' });

export type OpeningCheck = z.infer<typeof openingCheckSchema>;

/** The records' figures per client and currency (S10 rule 15): receivables and client ad funds. */
export const OPENING_FIGURE_SLOTS = ['receivable', 'ad_funds'] as const;

export const openingFigureSlotSchema = z
  .enum(OPENING_FIGURE_SLOTS)
  .meta({ id: 'OpeningFigureSlot' });

export type OpeningFigureSlot = z.infer<typeof openingFigureSlotSchema>;

/** The largest snapshot body the API reads (S10 rule 6). */
export const OPENING_SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;

/** The most entries in one list of a snapshot: 5,000 open invoices fit (S10 "Volume"). */
export const OPENING_SNAPSHOT_LIST_LIMIT = 20_000;

/** The most lines and figures the accountant saves in one draft. */
export const OPENING_LINE_LIMIT = 1000;

const signedHubMinorSchema = z.int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const nonNegativeHubMinorSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/**
 * An invoice open at the eve (S10 rule 5): `invoice.issued`'s payload with its `total` and what
 * was still `outstanding` at the eve (payments dated on or before it and not voided by then).
 */
export const openingInvoiceSchema = z
  .object({
    ...invoiceIssuedFieldsV1,
    total: nonNegativeHubMinorSchema,
    outstanding: nonNegativeHubMinorSchema,
  })
  .superRefine((invoice, context) => {
    checkIssuedInvoice(invoice, context);
    const sum = invoice.lines.reduce((total, line) => total + BigInt(line.amount), 0n);
    if (sum !== BigInt(invoice.total)) {
      context.addIssue({ code: 'custom', path: ['total'], message: 'The lines do not sum to it' });
    }
    if (invoice.outstanding > invoice.total) {
      context.addIssue({ code: 'custom', path: ['outstanding'], message: 'More than the total' });
    }
  })
  .meta({ id: 'OpeningInvoice' });

export type OpeningInvoice = z.infer<typeof openingInvoiceSchema>;

/**
 * A retainer credit line issued on or before the eve on an invoice not in `invoices`, for a cycle
 * of a line in `invoices` (S10 rule 5), with its invoice's number, date and rate.
 */
export const openingCreditSchema = z
  .object({
    invoice: hubDocumentIdSchema,
    client: hubValueRefSchema,
    contract: hubContractRefSchema,
    currency: hubCurrencySchema,
    syp_per_usd: sypPerUsdSchema,
    issued_on: hubDateSchema,
    line: invoiceLineSchema,
  })
  .superRefine((credit, context) => {
    const line = credit.line;
    if (
      line.source !== 'retainer_charge' ||
      line.charge_kind !== 'credit' ||
      line.cycle_start === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['line'],
        message: 'A retainer credit with its cycle start',
      });
    }
  })
  .meta({ id: 'OpeningCredit' });

export type OpeningCredit = z.infer<typeof openingCreditSchema>;

/**
 * A milestone of a project whose invoices are in `invoices`, or one done on or before the eve and
 * not invoiced by then, a contract asset (S10 rule 5). `done_on` only when done on or before the
 * eve; `invoiced_on` the issue date of the invoice that bills it, when on or before the eve.
 */
export const openingMilestoneSchema = z
  .object({
    milestone: hubDocumentIdSchema,
    client: hubValueRefSchema,
    project: hubContractRefSchema,
    currency: hubCurrencySchema,
    amount: positiveMinorSchema,
    service: hubValueRefSchema.optional(),
    done_on: hubDateSchema.optional(),
    invoiced_on: hubDateSchema.optional(),
  })
  .meta({ id: 'OpeningMilestone' });

export type OpeningMilestone = z.infer<typeof openingMilestoneSchema>;

/** A client's ad wallet in USD at the eve, funds held positive; negative when spent beyond. */
export const openingWalletSchema = z
  .object({
    client: hubValueRefSchema,
    balance: signedHubMinorSchema.refine((balance) => balance !== 0, 'Only a wallet not at zero'),
  })
  .meta({ id: 'OpeningWallet' });

export type OpeningWallet = z.infer<typeof openingWalletSchema>;

const listOf = <T extends z.ZodType>(item: T) =>
  z.array(item).max(OPENING_SNAPSHOT_LIST_LIMIT).default([]);

/**
 * The register of every Hub document dated on or before the eve (S10 rules 5, 28), by type, each
 * with what a later event needs to find it.
 */
export const priorDocumentsSchema = z
  .object({
    invoices: listOf(z.object({ invoice: hubDocumentIdSchema, issued_on: hubDateSchema })),
    payments: listOf(
      z.object({
        payment: hubDocumentIdSchema,
        invoice: hubDocumentIdSchema,
        paid_on: hubDateSchema,
      }),
    ),
    wallet_entries: listOf(
      z.object({
        entry: hubDocumentIdSchema,
        client: hubValueRefSchema,
        entered_on: hubDateSchema,
      }),
    ),
    spend_updates: listOf(
      z.object({
        update: hubDocumentIdSchema,
        campaign: hubDocumentIdSchema,
        client: hubValueRefSchema,
        period_to: hubDateSchema,
      }),
    ),
    project_expenses: listOf(z.object({ expense: hubDocumentIdSchema, spent_on: hubDateSchema })),
    milestone_dones: listOf(z.object({ milestone: hubDocumentIdSchema, done_on: hubDateSchema })),
  })
  .meta({ id: 'OpeningPriorDocuments' });

export type PriorDocuments = z.infer<typeof priorDocumentsSchema>;

/** The register's document of each list: its id, and the date it is dated on. */
export const PRIOR_DOCUMENT_LISTS = {
  invoices: (row) => ({ id: row.invoice.id, on: row.issued_on }),
  payments: (row) => ({ id: row.payment.id, on: row.paid_on }),
  wallet_entries: (row) => ({ id: row.entry.id, on: row.entered_on }),
  spend_updates: (row) => ({ id: row.update.id, on: row.period_to }),
  project_expenses: (row) => ({ id: row.expense.id, on: row.spent_on }),
  milestone_dones: (row) => ({ id: row.milestone.id, on: row.done_on }),
} as const satisfies {
  readonly [List in keyof PriorDocuments]: (row: PriorDocuments[List][number]) => {
    id: string;
    on: string;
  };
};

const snapshotFieldsSchema = z.object({
  as_of: hubDateSchema,
  generated_at: z.iso.datetime({ offset: true }),
  invoices: listOf(openingInvoiceSchema),
  credits: listOf(openingCreditSchema),
  milestones: listOf(openingMilestoneSchema),
  wallets: listOf(openingWalletSchema),
  prior_documents: priorDocumentsSchema.default({
    invoices: [],
    payments: [],
    wallet_entries: [],
    spend_updates: [],
    project_expenses: [],
    milestone_dones: [],
  }),
});

export type OpeningSnapshot = z.infer<typeof snapshotFieldsSchema>;

/** Whether a cycle's line takes a retainer credit: a monthly charge or an addition. */
function isCycleLine(line: OpeningInvoice['lines'][number]): boolean {
  return (
    line.source === 'retainer_charge' &&
    (line.charge_kind === 'monthly' || line.charge_kind === 'addition') &&
    line.cycle_start !== undefined
  );
}

/** S10 rule 6: ids unique within their list, dates on or before the eve, references resolvable. */
function checkSnapshot(snapshot: OpeningSnapshot, context: z.core.$RefinementCtx): void {
  const asOf = snapshot.as_of;
  const issue = (path: (string | number)[], message: string) =>
    context.addIssue({ code: 'custom', path, message });
  const unique = (list: string, ids: readonly string[]) => {
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      if (seen.has(id)) issue([list, index], 'Listed twice');
      seen.add(id);
    });
  };
  const notAfter = (path: (string | number)[], date: string | undefined) => {
    if (date !== undefined && date > asOf) issue(path, 'Dated after the eve');
  };

  unique(
    'invoices',
    snapshot.invoices.map((invoice) => invoice.invoice.id),
  );
  unique(
    'credits',
    snapshot.credits.map((credit) => `${credit.invoice.id}:${credit.line.id}`),
  );
  unique(
    'milestones',
    snapshot.milestones.map((milestone) => milestone.milestone.id),
  );
  unique(
    'wallets',
    snapshot.wallets.map((wallet) => wallet.client.external_id),
  );
  for (const list of Object.keys(PRIOR_DOCUMENT_LISTS) as (keyof PriorDocuments)[]) {
    const read = PRIOR_DOCUMENT_LISTS[list] as (row: unknown) => { id: string; on: string };
    const rows = snapshot.prior_documents[list] as readonly unknown[];
    unique(
      `prior_documents.${list}`,
      rows.map((row) => read(row).id),
    );
    rows.forEach((row, index) => {
      notAfter(['prior_documents', list, index], read(row).on);
    });
  }

  const milestones = new Map(
    snapshot.milestones.map((milestone) => [milestone.milestone.id, milestone]),
  );
  const invoiceIds = new Set(snapshot.invoices.map((invoice) => invoice.invoice.id));
  const cycles = new Set<string>();
  snapshot.invoices.forEach((invoice, index) => {
    notAfter(['invoices', index, 'issued_on'], invoice.issued_on);
    invoice.lines.forEach((line, position) => {
      if (line.milestone_id !== undefined && !milestones.has(line.milestone_id)) {
        issue(['invoices', index, 'lines', position, 'milestone_id'], 'Not in milestones');
      }
      if (isCycleLine(line) && invoice.contract !== undefined) {
        cycles.add(`${invoice.contract.external_id}:${line.cycle_start}`);
      }
    });
  });
  snapshot.credits.forEach((credit, index) => {
    notAfter(['credits', index, 'issued_on'], credit.issued_on);
    if (invoiceIds.has(credit.invoice.id)) {
      issue(['credits', index, 'invoice'], 'Its invoice is in invoices');
    }
    if (!cycles.has(`${credit.contract.external_id}:${credit.line.cycle_start}`)) {
      issue(['credits', index, 'line', 'cycle_start'], 'No cycle of an invoice in invoices');
    }
  });
  snapshot.milestones.forEach((milestone, index) => {
    notAfter(['milestones', index, 'done_on'], milestone.done_on);
    notAfter(['milestones', index, 'invoiced_on'], milestone.invoiced_on);
  });
}

/** The body of `POST /v1/opening/snapshot` (S10 rules 5–6); its key is the `Idempotency-Key`. */
export const openingSnapshotSchema = snapshotFieldsSchema.superRefine(checkSnapshot).meta({
  id: 'OpeningSnapshot',
  description: "Hub's open documents as of the eve of the books start",
});

/** A milestone done on or before the eve and not invoiced by then: a contract asset (rule 11). */
export function isContractAsset(milestone: OpeningMilestone): boolean {
  return milestone.done_on !== undefined && milestone.invoiced_on === undefined;
}

/** The lists of a snapshot that hold amounts, in the answer's order (S10 rule 9). */
export const OPENING_SNAPSHOT_TOTAL_LISTS = [
  'invoices',
  'credits',
  'contract_assets',
  'wallets',
] as const;

/**
 * What Mizan read in a snapshot (S10 rule 9): its counts per list, and per list and currency the
 * invoices' outstanding, the credits' amounts, the contract assets' installments and the wallets'
 * balances, so Hub can log it.
 */
export function openingSnapshotTotals(snapshot: OpeningSnapshot): {
  counts: {
    invoices: number;
    credits: number;
    milestones: number;
    wallets: number;
    prior_documents: number;
  };
  totals: {
    list: (typeof OPENING_SNAPSHOT_TOTAL_LISTS)[number];
    currency: 'SYP' | 'USD';
    amount: number;
  }[];
} {
  const sums = new Map<string, bigint>();
  const add = (list: string, currency: string, amount: number) => {
    const key = `${list}:${currency}`;
    sums.set(key, (sums.get(key) ?? 0n) + BigInt(amount));
  };
  for (const invoice of snapshot.invoices) add('invoices', invoice.currency, invoice.outstanding);
  for (const credit of snapshot.credits) add('credits', credit.currency, credit.line.amount);
  for (const milestone of snapshot.milestones) {
    if (isContractAsset(milestone)) add('contract_assets', milestone.currency, milestone.amount);
  }
  for (const wallet of snapshot.wallets) add('wallets', 'USD', wallet.balance);
  const totals: ReturnType<typeof openingSnapshotTotals>['totals'] = [];
  for (const list of OPENING_SNAPSHOT_TOTAL_LISTS) {
    for (const currency of ['SYP', 'USD'] as const) {
      const sum = sums.get(`${list}:${currency}`);
      if (sum !== undefined) totals.push({ list, currency, amount: Number(sum) });
    }
  }
  const prior = snapshot.prior_documents;
  return {
    counts: {
      invoices: snapshot.invoices.length,
      credits: snapshot.credits.length,
      milestones: snapshot.milestones.length,
      wallets: snapshot.wallets.length,
      prior_documents: Object.values(prior).reduce(
        (count: number, rows: readonly unknown[]) => count + rows.length,
        0,
      ),
    },
    totals,
  };
}

/** The answer of `POST /v1/opening/snapshot` (S10 rule 9). */
export const openingSnapshotResultSchema = z
  .object({
    snapshot_id: z.uuid(),
    as_of: hubDateSchema,
    received_at: z.iso.datetime({ offset: true }),
    replayed: z.boolean(),
    counts: z.object({
      invoices: z.int().min(0),
      credits: z.int().min(0),
      milestones: z.int().min(0),
      wallets: z.int().min(0),
      prior_documents: z.int().min(0),
    }),
    totals: z.array(
      z.object({
        list: z.enum(OPENING_SNAPSHOT_TOTAL_LISTS),
        currency: hubCurrencySchema,
        amount: signedHubMinorSchema,
      }),
    ),
  })
  .meta({ id: 'OpeningSnapshotResult' });

export type OpeningSnapshotResult = z.infer<typeof openingSnapshotResultSchema>;

const memoSchema = z.string().trim().min(1).max(300);

/**
 * A line of the accountant (S10 rules 14, 17): the account, its dimension values, the currency and
 * the amount, debit positive. `book` and `parallel` only on a stated line (non-monetary or
 * equity), each omitted in its ledger's own currency, where the amount is itself. An item on a
 * control account names its reference and its optional due date (S04 rule 6).
 */
export const openingLineInputSchema = z
  .object({
    accountId: z.uuid(),
    dimensionValueIds: z.array(z.uuid()).max(20).default([]),
    currency: currencyCodeSchema,
    amount: minorUnitsSchema.refine((text) => text !== '0', 'Not zero'),
    book: minorUnitsSchema.nullable().default(null),
    parallel: minorUnitsSchema.nullable().default(null),
    itemReference: z.string().trim().min(1).max(100).nullable().default(null),
    itemDueOn: z.iso.date().nullable().default(null),
    memo: memoSchema.nullable().default(null),
  })
  .refine((line) => line.itemDueOn === null || line.itemReference !== null, {
    path: ['itemDueOn'],
    message: 'A due date only on an item',
  })
  .meta({ id: 'OpeningLineInput' });

export type OpeningLineInput = z.infer<typeof openingLineInputSchema>;

/** The records' figure of a client and currency, signed as the account's natural balance (rule 15). */
export const openingFigureInputSchema = z
  .object({
    slot: openingFigureSlotSchema,
    clientValueId: z.uuid(),
    currency: currencyCodeSchema,
    amount: minorUnitsSchema,
  })
  .meta({ id: 'OpeningFigureInput' });

export type OpeningFigureInput = z.infer<typeof openingFigureInputSchema>;

/**
 * `PUT /api/opening`: the accountant's lines and the records' figures, replacing the draft's as one
 * write against its `version` (0 before the first save; S10 rule 16).
 */
export const saveOpeningSchema = z
  .object({
    version: z.int().min(0),
    lines: z.array(openingLineInputSchema).max(OPENING_LINE_LIMIT),
    recordFigures: z.array(openingFigureInputSchema).max(OPENING_LINE_LIMIT),
  })
  .superRefine((draft, context) => {
    const seen = new Set<string>();
    draft.recordFigures.forEach((figure, index) => {
      const key = `${figure.slot}:${figure.clientValueId}:${figure.currency}`;
      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['recordFigures', index],
          message: 'Listed twice',
        });
      }
      seen.add(key);
    });
  })
  .meta({ id: 'SaveOpening' });

export type SaveOpening = z.infer<typeof saveOpeningSchema>;

/** `POST /api/opening/post`: the preview's fingerprint (S10 rule 23). */
export const postOpeningSchema = z
  .object({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/) })
  .meta({ id: 'PostOpening' });

export type PostOpening = z.infer<typeof postOpeningSchema>;

// The view of `GET /api/opening` (S10 rule 20); amounts as `MinorUnits` (S03).

const viewDateSchema = z.iso.date();
const instantSchema = z.iso.datetime({ offset: true });
const ledgerAmountsSchema = z.object({
  transactionMinor: minorUnitsSchema,
  bookMinor: minorUnitsSchema,
  parallelMinor: minorUnitsSchema.nullable(),
});
const hubPartySchema = z.object({
  externalId: z.string(),
  code: z.string().nullable(),
  name: z.string(),
});
/** A check's failing item: what fails it, as plain values (a rate, a client, a line, a slot). */
const checkFailureSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

/** The slots of Hub's part, in the opening entry's order (rule 23). */
export const OPENING_HUB_SLOTS = ['receivable', 'contract_asset', 'ad_funds'] as const;

/** Where a line of the preview comes from (rule 20). */
export const OPENING_LINE_SOURCES = ['hub', 'schedule', 'records', 'balancing'] as const;

/** An item of Hub's part (rule 11), measured at the eve. */
export const openingHubItemSchema = z
  .object({
    slot: z.enum(OPENING_HUB_SLOTS),
    /** Hub's invoice or milestone number, or the client's code (an ad funds item). */
    reference: z.string(),
    document: z
      .object({ type: z.enum(['invoice', 'milestone']), id: z.string(), number: z.string() })
      .nullable(),
    client: hubPartySchema,
    contract: hubPartySchema.nullable(),
    dueOn: viewDateSchema.nullable(),
    documentDate: viewDateSchema,
    amounts: ledgerAmountsSchema,
    currency: currencyCodeSchema,
  })
  .meta({ id: 'OpeningHubItem' });

/** A schedule of Hub's part (rule 13): what it deferred, what S06 took off it, what remains. */
export const openingScheduleSchema = z
  .object({
    invoice: z.object({ id: z.string(), number: z.string() }),
    issuedOn: viewDateSchema,
    lineId: z.string(),
    /** The line's place on its invoice, from 1. */
    position: z.int().min(1),
    pattern: z.enum(['over_time', 'point_in_time']),
    serviceFrom: viewDateSchema.nullable(),
    serviceTo: viewDateSchema.nullable(),
    milestoneId: z.string().nullable(),
    client: hubPartySchema,
    contract: hubPartySchema.nullable(),
    service: hubPartySchema,
    currency: currencyCodeSchema,
    deferred: ledgerAmountsSchema,
    beforeOpening: ledgerAmountsSchema,
    remaining: ledgerAmountsSchema,
    releasedMonths: z.array(z.string()),
  })
  .meta({ id: 'OpeningSchedule' });

/** A line of the accountant as saved (rule 14). */
export const openingRecordLineSchema = z
  .object({
    lineNo: z.int().min(1),
    accountId: z.uuid(),
    dimensionValueIds: z.array(z.uuid()),
    currency: currencyCodeSchema,
    amountMinor: minorUnitsSchema,
    bookMinor: minorUnitsSchema.nullable(),
    parallelMinor: minorUnitsSchema.nullable(),
    itemReference: z.string().nullable(),
    itemDueOn: viewDateSchema.nullable(),
    memo: z.string().nullable(),
  })
  .meta({ id: 'OpeningRecordLine' });

/** A records' figure as saved (rule 15). */
export const openingRecordFigureSchema = z
  .object({
    slot: openingFigureSlotSchema,
    clientValueId: z.uuid(),
    currency: currencyCodeSchema,
    amountMinor: minorUnitsSchema,
  })
  .meta({ id: 'OpeningRecordFigure' });

/**
 * A client and currency whose records and Hub disagree (check `records_agree`): Hub's items and
 * the records' figure (null when not entered). `client` is the client's value id, or
 * `hub:<external id>` for a Hub client not yet linked.
 */
export const openingDifferenceSchema = z
  .object({
    slot: openingFigureSlotSchema,
    client: z.string(),
    currency: currencyCodeSchema,
    hubMinor: minorUnitsSchema,
    recordsMinor: minorUnitsSchema.nullable(),
  })
  .meta({ id: 'OpeningDifference' });

/** A line of the entry the draft would post now (rule 20), with its source. */
export const openingPreviewLineSchema = z
  .object({
    lineNo: z.int().min(1),
    source: z.enum(OPENING_LINE_SOURCES),
    accountId: z.uuid(),
    dimensionValueIds: z.array(z.uuid()),
    kind: lineKindSchema,
    currency: currencyCodeSchema,
    amountMinor: minorUnitsSchema,
    bookMinor: minorUnitsSchema,
    parallelMinor: minorUnitsSchema.nullable(),
    memo: z.string().nullable(),
    /** The rates each ledger measured it at, as quoted; none on a stated line. */
    conversions: z.array(
      z.object({
        ledger: z.enum(['book', 'parallel']),
        base: currencyCodeSchema,
        quote: currencyCodeSchema,
        rate: z.string(),
        effectiveOn: viewDateSchema,
      }),
    ),
    /** The reference of the item it opens, or null. */
    itemReference: z.string().nullable(),
  })
  .meta({ id: 'OpeningPreviewLine' });

/** A check with whether it passes and what fails it (rule 21). */
export const openingCheckResultSchema = z
  .object({
    check: openingCheckSchema,
    passed: z.boolean(),
    failures: z.array(checkFailureSchema),
  })
  .meta({ id: 'OpeningCheckResult' });

const openingEntryRefSchema = z
  .object({ id: z.uuid(), date: viewDateSchema })
  .extend(entryNumberSchema.shape)
  .meta({ id: 'OpeningEntryRef' });

/**
 * `GET /api/opening` (S10 rule 20): the opening's state, the books start and its eve, the latest
 * snapshot's summary (or the one the posted opening used), Hub's items and schedules, the
 * accountant's lines and figures, the records' comparison, the entry it would post with the
 * balancing line, the checks, the fingerprint to post with, the posted entry, and the latest
 * reversed opening.
 */
export const openingViewSchema = z
  .object({
    booksStart: viewDateSchema,
    asOf: viewDateSchema,
    /** Whether the company has a Hub client, so a snapshot is needed (rule 10). */
    hubClient: z.boolean(),
    /** The live opening's state, or null before its first save. */
    state: openingStateSchema.nullable(),
    /** The draft's version to save against: 0 before the first save (rule 16). */
    version: z.int().min(0),
    snapshot: z
      .object({ id: z.uuid(), receivedAt: instantSchema, result: openingSnapshotResultSchema })
      .nullable(),
    hubItems: z.array(openingHubItemSchema),
    schedules: z.array(openingScheduleSchema),
    /** The draft's lines and figures; before a new draft's first save, the reversed one's. */
    recordLines: z.array(openingRecordLineSchema),
    recordFigures: z.array(openingRecordFigureSchema),
    differences: z.array(openingDifferenceSchema),
    /** The entry the draft would post now, in rule 23's order; empty while a check stops it. */
    lines: z.array(openingPreviewLineSchema),
    checks: z.array(openingCheckResultSchema),
    /** What `POST /api/opening/post` sends (rule 23). */
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    /** The posted opening entry, with who posted it and when. */
    posted: z.object({ entry: openingEntryRefSchema, by: z.uuid(), at: instantSchema }).nullable(),
    /** The latest reversed opening: its entry, its reversal and the reason (rule 25). */
    reversed: z
      .object({
        entry: openingEntryRefSchema,
        reversalEntry: openingEntryRefSchema,
        reason: z.string(),
        at: instantSchema,
      })
      .nullable(),
  })
  .meta({ id: 'OpeningView' });

export type OpeningViewAnswer = z.infer<typeof openingViewSchema>;

/** `POST /api/opening/reverse` (rule 25): the reason, 1–500 characters. */
export const reverseOpeningSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .meta({ id: 'ReverseOpening' });

export type ReverseOpening = z.infer<typeof reverseOpeningSchema>;

/** The answer of posting or reversing the opening: the entry it posted. */
export const openingEntryResultSchema = z
  .object({ openingId: z.uuid(), entry: openingEntryRefSchema })
  .meta({ id: 'OpeningEntryResult' });

export type OpeningEntryResult = z.infer<typeof openingEntryResultSchema>;
