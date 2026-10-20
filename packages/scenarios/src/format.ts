import {
  type CompanyLedgers,
  type CurrencyCode,
  companyLedgersSchema,
  currencyCodeSchema,
  exchangeRateSchema,
  minorAmountSchema,
  rateSourceSchema,
  rateTypeSchema,
  rateValueSchema,
} from '@vertex-mizan/contracts';
import { z } from 'zod';

/**
 * The YAML of one scenario case, as `docs/scenarios/README.md` documents it (ADR 0005, ADR 0008).
 * The keys are the README's snake_case; the parsed case is camelCase. Every object is strict, so a
 * misspelt key fails instead of being ignored. Amounts are `bigint` minor units: the book is read
 * with integers as `bigint` (`book.ts`), so a decimal amount is refused, never rounded.
 */

/** A check across fields runs only when the fields themselves are valid (and transformed). */
const WHEN_VALID = {
  when: (payload: { issues: readonly unknown[] }) => payload.issues.length === 0,
};

const dateSchema = z.iso.date();

const periodSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'Expected a period YYYY-MM');

const accountSchema = z
  .string({ error: 'Expected an account code in quotes ("1210")' })
  .regex(/^\S+$/, 'Expected an account code');

/** Whole minor units: YAML reads `100.5` as a float, which is refused, never rounded. */
const amountSchema = z
  .bigint({ error: 'Expected an amount in whole minor units' })
  .pipe(minorAmountSchema);

/** A rate in quotes, exactly as quoted (`"120.0000"`), never a YAML number. */
const quotedRateSchema = z
  .string({ error: 'Expected the rate as a decimal in quotes ("120.0000")' })
  .pipe(rateValueSchema);

const dimensionsSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]*$/, 'Expected a dimension name in snake_case'),
  z.string().min(1),
);

/** An event type (`invoice.issued`), a job (`month_end_revaluation`) or `manual`. */
const sourceSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/, 'Expected an event type, a job or manual');

const eventTypeSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/,
    'Expected an event type such as invoice.issued',
  );

const jobNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'Expected a job name such as month_end_revaluation');

/** The currency shapes of ADR 0007 and ADR 0008: the book and parallel currency of each. */
export const SHAPES = {
  syp: { book: 'SYP', parallel: null },
  'syp-usd': { book: 'SYP', parallel: 'USD' },
  'usd-syp': { book: 'USD', parallel: 'SYP' },
  third: { book: 'SYP', parallel: 'USD' },
} as const satisfies Record<string, { book: CurrencyCode; parallel: CurrencyCode | null }>;

export type Shape = keyof typeof SHAPES;

const rawCompanySchema = z.strictObject({
  shape: z.enum(Object.keys(SHAPES) as [Shape, ...Shape[]]),
  book: currencyCodeSchema,
  parallel: currencyCodeSchema.optional(),
  rate_policy: z.strictObject({
    book: rateTypeSchema,
    book_accepts_transaction_rate: z.boolean().default(false),
    parallel: rateTypeSchema.optional(),
    parallel_accepts_transaction_rate: z.boolean().optional(),
  }),
  template: z.string().min(1).optional(),
  closed_periods: z.array(periodSchema).default([]),
});

type RawCompany = z.output<typeof rawCompanySchema>;

function ledgersOf(company: RawCompany): CompanyLedgers {
  const policy = company.rate_policy;
  return {
    book: {
      currency: company.book,
      ratePolicy: {
        rateType: policy.book,
        acceptsTransactionRate: policy.book_accepts_transaction_rate,
      },
    },
    parallel:
      company.parallel && policy.parallel
        ? {
            currency: company.parallel,
            ratePolicy: {
              rateType: policy.parallel,
              acceptsTransactionRate: policy.parallel_accepts_transaction_rate ?? false,
            },
          }
        : null,
  };
}

const companySchema = rawCompanySchema
  .superRefine((company, context) => {
    const shape = SHAPES[company.shape];
    if (company.book !== shape.book) {
      context.addIssue({
        code: 'custom',
        message: `The ${company.shape} shape keeps its books in ${shape.book}`,
        path: ['book'],
      });
    }
    if ((company.parallel ?? null) !== shape.parallel) {
      context.addIssue({
        code: 'custom',
        message: shape.parallel
          ? `The ${company.shape} shape keeps a ${shape.parallel} parallel ledger`
          : `The ${company.shape} shape has no parallel ledger`,
        path: ['parallel'],
      });
    }
    const policy = company.rate_policy;
    if ((company.parallel === undefined) !== (policy.parallel === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'A parallel ledger and its rate policy come together',
        path: ['rate_policy', 'parallel'],
      });
    }
    if (policy.parallel === undefined && policy.parallel_accepts_transaction_rate !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'No parallel rate policy to accept a transaction rate',
        path: ['rate_policy', 'parallel_accepts_transaction_rate'],
      });
    }
    const ledgers = companyLedgersSchema.safeParse(ledgersOf(company));
    for (const issue of ledgers.error?.issues ?? []) {
      context.addIssue({ code: 'custom', message: issue.message, path: ['rate_policy'] });
    }
  }, WHEN_VALID)
  .transform((company) => ({
    shape: company.shape,
    ledgers: ledgersOf(company),
    template: company.template ?? null,
    closedPeriods: company.closed_periods,
  }));

export type CaseCompany = z.output<typeof companySchema>;

/** A row of the company rate table; `source` defaults to `manual` (entered by the accountant). */
const rateSchema = z
  .strictObject({
    date: dateSchema,
    base: currencyCodeSchema,
    quote: currencyCodeSchema,
    rate: quotedRateSchema,
    type: rateTypeSchema,
    source: rateSourceSchema.default('manual'),
  })
  .transform(({ date, ...rate }) => ({ effectiveOn: date, ...rate }))
  .pipe(exchangeRateSchema);

const payloadSchema = z.record(z.string(), z.unknown());

/** A step is told apart by its one key: `event`, `manual` or `job`. */
export const STEP_KINDS = ['event', 'manual', 'job'] as const;

export type StepKind = (typeof STEP_KINDS)[number];

const eventStepSchema = z
  .strictObject({
    kind: z.literal('event'),
    event: eventTypeSchema,
    accounting_date: dateSchema,
    payload: payloadSchema,
  })
  .transform((step) => ({
    kind: step.kind,
    type: step.event,
    accountingDate: step.accounting_date,
    payload: step.payload,
  }));

/** A manual entry: what it records, and the request as the manual-entry form sends it (S03). */
const manualStepSchema = z
  .strictObject({
    kind: z.literal('manual'),
    manual: z.string().trim().min(1),
    accounting_date: dateSchema,
    payload: payloadSchema,
  })
  .transform((step) => ({
    kind: step.kind,
    description: step.manual,
    accountingDate: step.accounting_date,
    payload: step.payload,
  }));

const jobStepSchema = z
  .strictObject({ kind: z.literal('job'), job: jobNameSchema, period: periodSchema })
  .transform((step) => ({ kind: step.kind, name: step.job, period: step.period }));

const stepSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    const kind = STEP_KINDS.find((key) => key in value);
    return kind ? { kind, ...value } : value;
  },
  z.discriminatedUnion('kind', [eventStepSchema, manualStepSchema, jobStepSchema], {
    error: 'Expected a step with one of the keys event, manual or job',
  }),
);

export type Step = z.output<typeof stepSchema>;

/** One journal line: positive debit, negative credit, in minor units. */
const lineSchema = z
  .strictObject({
    account: accountSchema,
    dims: dimensionsSchema.default({}),
    currency: currencyCodeSchema,
    amount: amountSchema,
    book: amountSchema,
    parallel: amountSchema.optional(),
  })
  .transform((line) => ({ ...line, parallel: line.parallel ?? null }));

export type ExpectedLine = z.output<typeof lineSchema>;

const entrySchema = z.strictObject({
  source: sourceSchema,
  date: dateSchema,
  lines: z.array(lineSchema).min(2),
});

export type ExpectedEntry = z.output<typeof entrySchema>;

/** An account balance; with a currency, its transaction amount may be stated too. */
const balanceSchema = z
  .strictObject({
    account: accountSchema,
    dims: dimensionsSchema.default({}),
    currency: currencyCodeSchema.optional(),
    amount: amountSchema.optional(),
    book: amountSchema,
    parallel: amountSchema.optional(),
  })
  .refine((balance) => balance.amount === undefined || balance.currency !== undefined, {
    message: 'A transaction amount needs its currency',
    path: ['amount'],
  })
  .transform((balance) => ({
    account: balance.account,
    dims: balance.dims,
    currency: balance.currency ?? null,
    amount: balance.amount ?? null,
    book: balance.book,
    parallel: balance.parallel ?? null,
  }));

export type ExpectedBalance = z.output<typeof balanceSchema>;

/** The last step's result when it is not posted: held (ADR 0008 hold reasons) or refused. */
const outcomeSchema = z.strictObject({
  status: z.enum(['held', 'refused']),
  reason: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'Expected a reason code'),
});

export type Outcome = z.output<typeof outcomeSchema>;

const expectSchema = z
  .strictObject({
    entries: z.array(entrySchema),
    balances: z.array(balanceSchema).default([]),
    outcome: outcomeSchema.optional(),
  })
  .transform((expect) => ({ ...expect, outcome: expect.outcome ?? null }));

export const caseSchema = z
  .strictObject({
    case: z.string().trim().min(1),
    company: companySchema,
    rates: z.array(rateSchema).default([]),
    steps: z.array(stepSchema).min(1),
    expect: expectSchema,
  })
  .superRefine((scenarioCase, context) => {
    const { book, parallel } = scenarioCase.company.ledgers;
    const kept = (amount: bigint | null) => (amount === null) === (parallel === null);
    const ledgerMessage = parallel
      ? `The company keeps a ${parallel.currency} parallel ledger: state the parallel amount`
      : 'The company keeps no parallel ledger: state no parallel amount';

    for (const [e, entry] of scenarioCase.expect.entries.entries()) {
      let bookTotal = 0n;
      let parallelTotal = 0n;
      for (const [l, line] of entry.lines.entries()) {
        bookTotal += line.book;
        parallelTotal += line.parallel ?? 0n;
        if (!kept(line.parallel)) {
          const path = ['expect', 'entries', e, 'lines', l, 'parallel'];
          context.addIssue({ code: 'custom', message: ledgerMessage, path });
        }
      }
      // ADR 0005, invariant 1: every entry balances in the book and the parallel ledger.
      if (bookTotal !== 0n) {
        const message = `The entry is out of balance by ${bookTotal} in the book ledger`;
        context.addIssue({ code: 'custom', message, path: ['expect', 'entries', e] });
      }
      if (parallelTotal !== 0n) {
        const message = `The entry is out of balance by ${parallelTotal} in the parallel ledger`;
        context.addIssue({ code: 'custom', message, path: ['expect', 'entries', e] });
      }
    }
    for (const [b, balance] of scenarioCase.expect.balances.entries()) {
      if (!kept(balance.parallel)) {
        const path = ['expect', 'balances', b, 'parallel'];
        context.addIssue({ code: 'custom', message: ledgerMessage, path });
      }
    }

    if (scenarioCase.company.shape === 'third') {
      const ledgerCurrencies = new Set([book.currency, parallel?.currency]);
      const currencies = [
        ...scenarioCase.expect.entries.flatMap((entry) => entry.lines.map((line) => line.currency)),
        ...scenarioCase.rates.flatMap((rate) => [rate.base, rate.quote]),
      ];
      if (currencies.every((currency) => ledgerCurrencies.has(currency))) {
        context.addIssue({
          code: 'custom',
          message: 'A third-currency case has a line or a rate in a third currency (TRY or EUR)',
          path: ['company', 'shape'],
        });
      }
    }
  }, WHEN_VALID)
  .transform(({ case: name, ...scenarioCase }) => ({ name, ...scenarioCase }));

export type ScenarioCase = z.output<typeof caseSchema>;
