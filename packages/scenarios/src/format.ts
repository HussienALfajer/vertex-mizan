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

/** A whole number the YAML reads as `bigint` (an ISO weekday, a step or entry number). */
const countSchema = (min: number, max = Number.MAX_SAFE_INTEGER) =>
  z
    .bigint({ error: 'Expected a whole number' })
    .refine((value) => value >= BigInt(min) && value <= BigInt(max), {
      message: `Expected a whole number from ${min} to ${max}`,
    })
    .transform(Number);

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
  // The bulletin publication calendar (S02 rules 16–17): ISO weekdays off (Friday and Saturday by
  // default) and the holidays the accountant has marked.
  bulletin_days_off: z
    .array(countSchema(1, 7))
    .refine((days) => new Set(days).size === days.length, 'A day off is stated twice')
    .default([5, 6]),
  bulletin_holidays: z
    .array(dateSchema)
    .refine((days) => new Set(days).size === days.length, 'A holiday is stated twice')
    .default([]),
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
    calendar: { daysOff: company.bulletin_days_off, holidays: company.bulletin_holidays },
  }));

export type CaseCompany = z.output<typeof companySchema>;

const rateFields = {
  date: dateSchema,
  base: currencyCodeSchema,
  quote: currencyCodeSchema,
  rate: quotedRateSchema,
  type: rateTypeSchema,
  source: rateSourceSchema.default('manual'),
};

/** A row of the company rate table; `source` defaults to `manual` (entered by the accountant). */
const rateSchema = z
  .strictObject(rateFields)
  .transform(({ date, ...rate }) => ({ effectiveOn: date, ...rate }))
  .pipe(exchangeRateSchema);

/**
 * A step's request as the system receives it, checked by the step's executor against the real
 * contract. Here only one thing is refused: a YAML decimal number anywhere in it, which would reach
 * the system as a float (integers are already `bigint`).
 */
const payloadSchema = z.record(z.string(), z.unknown()).superRefine((payload, context) => {
  const walk = (value: unknown, path: PropertyKey[]): void => {
    if (typeof value === 'number') {
      const message = 'A decimal number: amounts are whole minor units and rates are in quotes';
      context.addIssue({ code: 'custom', message, path });
    } else if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) walk(item, [...path, index]);
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, item] of Object.entries(value)) walk(item, [...path, key]);
    }
  };
  walk(payload, []);
});

/** A step is told apart by its one key: `event`, `manual`, `reversal`, `job` or `rate`. */
export const STEP_KINDS = ['event', 'manual', 'reversal', 'job', 'rate'] as const;

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

/** The reversal of an entry the case posted, by its number in posting order (ADR 0005). */
const reversalStepSchema = z
  .strictObject({
    kind: z.literal('reversal'),
    reversal: countSchema(1),
    accounting_date: dateSchema,
  })
  .transform((step) => ({
    kind: step.kind,
    entry: step.reversal,
    accountingDate: step.accounting_date,
  }));

/**
 * A rate row recorded at this point of the case, as the accountant records it (S02 rule 14). A
 * row for a pair, type and date that already has one is a correction and carries its reason
 * (S02 rule 15).
 */
const rateStepSchema = z
  .strictObject({
    kind: z.literal('rate'),
    rate: z.strictObject({ ...rateFields, reason: z.string().trim().min(1).max(500).optional() }),
  })
  .transform(({ kind, rate: { reason, date, ...rate } }, context) => {
    const parsed = exchangeRateSchema.safeParse({ effectiveOn: date, ...rate });
    for (const issue of parsed.error?.issues ?? []) {
      context.addIssue({ code: 'custom', message: issue.message, path: ['rate', ...issue.path] });
    }
    return parsed.success ? { kind, rate: parsed.data, reason: reason ?? null } : z.NEVER;
  });

const jobStepSchema = z
  .strictObject({ kind: z.literal('job'), job: jobNameSchema, period: periodSchema })
  .transform((step) => ({ kind: step.kind, name: step.job, period: step.period }));

const stepSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    const kind = STEP_KINDS.find((key) => key in value);
    return kind ? { kind, ...value } : value;
  },
  z.discriminatedUnion(
    'kind',
    [eventStepSchema, manualStepSchema, reversalStepSchema, jobStepSchema, rateStepSchema],
    { error: 'Expected a step with one of the keys event, manual, reversal, job or rate' },
  ),
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

/**
 * An account balance, as the reports read it. `dims` filters: the balance of every dimension set
 * holding the stated pairs, so no `dims` is the whole account. With a currency, only that
 * currency's lines, and its transaction amount may be stated too.
 */
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

/**
 * An open item (ADR 0008): one document (`item`, such as an invoice number) on its control
 * account, with its dimensions, its currency and what remains of it in each amount; 0 when cleared.
 */
const openItemSchema = z
  .strictObject({
    item: z.string({ error: 'Expected the document reference in quotes' }).trim().min(1),
    account: accountSchema,
    dims: dimensionsSchema.default({}),
    currency: currencyCodeSchema,
    amount: amountSchema,
    book: amountSchema,
    parallel: amountSchema.optional(),
  })
  .transform((item) => ({ ...item, parallel: item.parallel ?? null }));

export type ExpectedOpenItem = z.output<typeof openItemSchema>;

/** The last step's result when it is not posted: held (ADR 0008 hold reasons) or refused. */
const outcomeSchema = z.strictObject({
  status: z.enum(['held', 'refused']),
  reason: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'Expected a reason code'),
});

export type Outcome = z.output<typeof outcomeSchema>;

/**
 * A rate correction's answer (S02 rule 15): the entries it lists as converted at the superseded
 * row, by their number in posting order.
 */
const correctionSchema = z
  .strictObject({ step: countSchema(1), used_by: z.array(countSchema(1)) })
  .transform(({ step, used_by }) => ({ step, usedBy: used_by }));

export type ExpectedCorrection = z.output<typeof correctionSchema>;

const expectSchema = z
  .strictObject({
    entries: z.array(entrySchema),
    balances: z.array(balanceSchema).default([]),
    open_items: z.array(openItemSchema).default([]),
    corrections: z.array(correctionSchema).default([]),
    outcome: outcomeSchema.optional(),
  })
  .transform(({ open_items, ...expect }) => ({
    ...expect,
    openItems: open_items,
    outcome: expect.outcome ?? null,
  }));

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
    const issue = (message: string, path: PropertyKey[]) =>
      context.addIssue({ code: 'custom', message, path });

    // ADR 0007: in a ledger's own currency, the ledger amount is the transaction amount.
    type Amounts = {
      currency: string | null;
      amount: bigint | null;
      book: bigint;
      parallel: bigint | null;
    };
    const ownCurrency = (row: Amounts, path: PropertyKey[]) => {
      if (row.amount === null) return;
      if (row.currency === book.currency && row.book !== row.amount) {
        issue(`In ${book.currency}, the book amount is the transaction amount`, [...path, 'book']);
      }
      if (row.currency === parallel?.currency && row.parallel !== row.amount) {
        const message = `In ${parallel.currency}, the parallel amount is the transaction amount`;
        issue(message, [...path, 'parallel']);
      }
    };

    for (const [e, entry] of scenarioCase.expect.entries.entries()) {
      let bookTotal = 0n;
      let parallelTotal = 0n;
      for (const [l, line] of entry.lines.entries()) {
        bookTotal += line.book;
        parallelTotal += line.parallel ?? 0n;
        const path = ['expect', 'entries', e, 'lines', l];
        if (!kept(line.parallel)) issue(ledgerMessage, [...path, 'parallel']);
        ownCurrency(line, path);
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
      const path = ['expect', 'balances', b];
      if (!kept(balance.parallel)) issue(ledgerMessage, [...path, 'parallel']);
      ownCurrency(balance, path);
    }
    const items = new Set<string>();
    for (const [o, openItem] of scenarioCase.expect.openItems.entries()) {
      const path = ['expect', 'open_items', o];
      if (!kept(openItem.parallel)) issue(ledgerMessage, [...path, 'parallel']);
      ownCurrency(openItem, path);
      const key = JSON.stringify([openItem.item, openItem.account]);
      if (items.has(key)) issue(`${openItem.item} on ${openItem.account} is stated twice`, path);
      items.add(key);
    }

    const { steps } = scenarioCase;
    const { entries } = scenarioCase.expect;
    for (const [s, step] of steps.entries()) {
      if (step.kind === 'reversal' && step.entry > entries.length) {
        issue(`Entry ${step.entry} is not an expected entry`, ['steps', s, 'reversal']);
      }
    }
    const corrected = new Set<number>();
    for (const [c, correction] of scenarioCase.expect.corrections.entries()) {
      const path = ['expect', 'corrections', c];
      const step = steps[correction.step - 1];
      if (step?.kind !== 'rate' || step.reason === null) {
        issue(`Step ${correction.step} is not a rate step with a reason`, [...path, 'step']);
      }
      if (corrected.has(correction.step)) issue(`Step ${correction.step} is stated twice`, path);
      corrected.add(correction.step);
      for (const [u, entry] of correction.usedBy.entries()) {
        if (entry > entries.length) {
          issue(`Entry ${entry} is not an expected entry`, [...path, 'used_by', u]);
        }
      }
    }

    if (scenarioCase.company.shape === 'third') {
      const ledgerCurrencies = new Set([book.currency, parallel?.currency]);
      const currencies = [
        ...scenarioCase.expect.entries.flatMap((entry) => entry.lines.map((line) => line.currency)),
        ...scenarioCase.rates.flatMap((rate) => [rate.base, rate.quote]),
        ...steps.flatMap((step) => (step.kind === 'rate' ? [step.rate.base, step.rate.quote] : [])),
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
