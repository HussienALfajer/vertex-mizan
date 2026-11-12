import {
  accountClassOfCode,
  accountCodeLevel,
  CHART_TEMPLATE_IDS,
  type CompanyLedgers,
  type CurrencyCode,
  chartTemplate,
  companyLedgersSchema,
  currencyCodeSchema,
  exchangeRateSchema,
  minorAmountSchema,
  rateSourceSchema,
  rateTypeSchema,
  rateValueSchema,
  statementLineFits,
} from '@vertex-mizan/contracts';
import { z } from 'zod';
import {
  BOOKS_START_MARKS,
  expectedReportSchema,
  reportEntries,
  reportLedger,
} from './report-format.js';

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

/** An event type (`invoice.issued`), a job (`revenue_release_month`), `manual`, `revaluation` or `reversal`. */
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
  .regex(/^[a-z][a-z0-9_]*$/, 'Expected a job name such as revenue_release_month');

/** The currency shapes of ADR 0007 and ADR 0008: the book and parallel currency of each. */
export const SHAPES = {
  syp: { book: 'SYP', parallel: null },
  'syp-usd': { book: 'SYP', parallel: 'USD' },
  'usd-syp': { book: 'USD', parallel: 'SYP' },
  third: { book: 'SYP', parallel: 'USD' },
} as const satisfies Record<string, { book: CurrencyCode; parallel: CurrencyCode | null }>;

export type Shape = keyof typeof SHAPES;

/**
 * A postable account the case adds to its template, as the accountant adds one in the chart (S02),
 * for a case that needs an account the template lacks (a TRY cash account, for instance).
 */
const addedAccountSchema = z
  .strictObject({
    code: accountSchema,
    name: z.string().trim().min(1),
    name_latin: z.string().trim().min(1).optional(),
    statement_line: z.string().min(1),
    currency: currencyCodeSchema.optional(),
    monetary: z.boolean().default(false),
  })
  .transform((account) => ({
    code: account.code,
    name: account.name,
    nameLatin: account.name_latin ?? null,
    statementLine: account.statement_line,
    currency: account.currency ?? null,
    isMonetary: account.monetary,
  }));

export type AddedAccount = z.output<typeof addedAccountSchema>;

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
  accounts: z.array(addedAccountSchema).default([]),
  closed_periods: z.array(periodSchema).default([]),
  // The contract values the case's manual lines name, with the kind and client a contract needs
  // (S02); a contract an event names is made by the event (S09).
  contracts: z
    .array(
      z.strictObject({
        code: z.string().min(1),
        kind: z.enum(['project', 'retainer']),
        client: z.string().min(1),
      }),
    )
    .refine(
      (contracts) => new Set(contracts.map((contract) => contract.code)).size === contracts.length,
      'A contract is stated twice',
    )
    .default([]),
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
  // The books start (S10 rule 1): the first day of a month. Nothing posts until an `opening` step
  // posts (rule 3), and the months before it are closed (rule 4).
  books_start: dateSchema
    .refine((date) => date.endsWith('-01'), 'Expected the first day of a month')
    .optional(),
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

/**
 * Each added account fits the template as S02 would place it: a postable code under one of the
 * template's headers, not already in it, stated once, with a statement line of its class.
 */
function checkAddedAccounts(company: RawCompany, context: z.RefinementCtx): void {
  if (company.accounts.length === 0) return;
  const templateId = CHART_TEMPLATE_IDS.find((id) => id === company.template);
  if (templateId === undefined) {
    const message = 'Accounts are added to a known chart template';
    context.addIssue({ code: 'custom', message, path: ['accounts'] });
    return;
  }
  const template = chartTemplate(templateId).accounts;
  const issue = (index: number, message: string) =>
    context.addIssue({ code: 'custom', message, path: ['accounts', index] });
  for (const [index, account] of company.accounts.entries()) {
    const { code } = account;
    if (company.accounts.slice(0, index).some((other) => other.code === code)) {
      issue(index, `Account ${code} is added twice`);
    } else if (accountCodeLevel(code) !== 4) {
      issue(index, `Account ${code} is not the code of a postable account`);
    } else if (template.some((existing) => existing.code === code)) {
      issue(index, `Account ${code} is already in the ${templateId} template`);
    } else if (
      !template.some((existing) => existing.code === code.slice(0, 3) && existing.kind === 'header')
    ) {
      issue(
        index,
        `Account ${code} has no header ${code.slice(0, 3)} in the ${templateId} template`,
      );
    } else if (!statementLineFits(account.statementLine, accountClassOfCode(code))) {
      issue(index, `Statement line ${account.statementLine} does not fit account ${code}`);
    }
  }
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
    checkAddedAccounts(company, context);
    const ledgers = companyLedgersSchema.safeParse(ledgersOf(company));
    for (const issue of ledgers.error?.issues ?? []) {
      context.addIssue({ code: 'custom', message: issue.message, path: ['rate_policy'] });
    }
  }, WHEN_VALID)
  .transform((company) => ({
    shape: company.shape,
    ledgers: ledgersOf(company),
    template: company.template ?? null,
    accounts: company.accounts,
    closedPeriods: company.closed_periods,
    contracts: company.contracts,
    calendar: { daysOff: company.bulletin_days_off, holidays: company.bulletin_holidays },
    booksStart: company.books_start ?? null,
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

/**
 * A step's answer when it is not posted: held (ADR 0008 and 0014 hold reasons) or refused, with
 * the reason and, when stated, its detail (S05 rule 9: `payment_gap_beyond_tolerance`). An unstated
 * detail is not compared. A detail is one code with an optional value (`period:2026-10`, S07 rule
 * 2), or several comma-separated: a failed checklist's items in its order (S07 rule 8).
 */
const outcomeSchema = z
  .strictObject({
    status: z.enum(['held', 'refused']),
    reason: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'Expected a reason code'),
    detail: z
      .string()
      .regex(
        /^[a-z][a-z0-9_]*(:[A-Za-z0-9_.-]+)?(,[a-z][a-z0-9_]*(:[A-Za-z0-9_.-]+)?)*$/,
        'Expected a detail code',
      )
      .optional(),
  })
  .transform((outcome) => ({ ...outcome, detail: outcome.detail ?? null }));

export type Outcome = z.output<typeof outcomeSchema>;

/**
 * Any step may state its answer when it is received (S05): an event held at receipt that a later
 * step frees posts then, and its entry is expected in posting order.
 */
const stepOutcome = { outcome: outcomeSchema.optional() };

/**
 * A step is told apart by its one key: `event`, `manual`, `reversal`, `job` or `rate`, or one of
 * the accountant's actions on a held event (S05 rules 15–17): `retry`, `move`, `resolve`, `dismiss`;
 * S06's `recognise` and `split` (rule 16); S07's `revalue` (rules 10–18), `block` (S02 rule 5),
 * `close` and `reopen` (rules 2–9), and a manual entry saved as a `draft` and its `discard` (S03
 * rules 4 and 11), which S07's checklist reads (`no_drafts`); and S09's `service_department`, a
 * manual service's dated department (rule 34); and S10's `opening` (rules 10–23) and its
 * `reverse_opening` (rule 25).
 */
export const STEP_KINDS = [
  'event',
  'manual',
  'reversal',
  'job',
  'rate',
  'retry',
  'move',
  'resolve',
  'dismiss',
  'recognise',
  'split',
  'revalue',
  'block',
  'close',
  'reopen',
  'draft',
  'discard',
  'service_department',
  'opening',
  'reverse_opening',
] as const;

export type StepKind = (typeof STEP_KINDS)[number];

const eventStepSchema = z
  .strictObject({
    kind: z.literal('event'),
    event: eventTypeSchema,
    accounting_date: dateSchema,
    payload: payloadSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    type: step.event,
    accountingDate: step.accounting_date,
    payload: step.payload,
    outcome: step.outcome ?? null,
  }));

/** A manual entry: what it records, and the request as the manual-entry form sends it (S03). */
const manualStepSchema = z
  .strictObject({
    kind: z.literal('manual'),
    manual: z.string().trim().min(1),
    accounting_date: dateSchema,
    payload: payloadSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    description: step.manual,
    accountingDate: step.accounting_date,
    payload: step.payload,
    outcome: step.outcome ?? null,
  }));

/** The reversal of an entry the case posted, by its number in posting order (ADR 0005). */
const reversalStepSchema = z
  .strictObject({
    kind: z.literal('reversal'),
    reversal: countSchema(1),
    accounting_date: dateSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    entry: step.reversal,
    accountingDate: step.accounting_date,
    outcome: step.outcome ?? null,
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
    ...stepOutcome,
  })
  .transform(({ kind, rate: { reason, date, ...rate }, outcome }, context) => {
    const parsed = exchangeRateSchema.safeParse({ effectiveOn: date, ...rate });
    for (const issue of parsed.error?.issues ?? []) {
      context.addIssue({ code: 'custom', message: issue.message, path: ['rate', ...issue.path] });
    }
    return parsed.success
      ? { kind, rate: parsed.data, reason: reason ?? null, outcome: outcome ?? null }
      : z.NEVER;
  });

const jobStepSchema = z
  .strictObject({
    kind: z.literal('job'),
    job: jobNameSchema,
    period: periodSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    name: step.job,
    period: step.period,
    outcome: step.outcome ?? null,
  }));

/** The written reason an action keeps (S05 rules 15, 17). */
const actionReasonSchema = z.string().trim().min(1).max(500);

/** Retry a held event now, by its step number (S05 rule 15). */
const retryStepSchema = z
  .strictObject({ kind: z.literal('retry'), retry: countSchema(1), ...stepOutcome })
  .transform((step) => ({ kind: step.kind, step: step.retry, outcome: step.outcome ?? null }));

/**
 * Post an event held `PERIOD_CLOSED` on the first day of the first open period after its
 * accounting date, with a reason (S05 rule 15).
 */
const moveStepSchema = z
  .strictObject({
    kind: z.literal('move'),
    move: countSchema(1),
    reason: actionReasonSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    step: step.move,
    reason: step.reason,
    outcome: step.outcome ?? null,
  }));

/**
 * Resolve an event held `NEEDS_DECISION` by a posted manual entry of the case, by its number in
 * posting order, with a reason (S05 rule 15).
 */
const resolveStepSchema = z
  .strictObject({
    kind: z.literal('resolve'),
    resolve: z.strictObject({ step: countSchema(1), entry: countSchema(1) }),
    reason: actionReasonSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    step: step.resolve.step,
    entry: step.resolve.entry,
    reason: step.reason,
    outcome: step.outcome ?? null,
  }));

/** Dismiss a held event, by the owner, with a reason: it never posts (S05 rule 17). */
const dismissStepSchema = z
  .strictObject({
    kind: z.literal('dismiss'),
    dismiss: countSchema(1),
    reason: actionReasonSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    step: step.dismiss,
    reason: step.reason,
    outcome: step.outcome ?? null,
  }));

/**
 * Recognise the elapsed parts of an event held `SERVICE_PERIOD_CLOSED` in the first open period
 * after them, each measured at its own month's rates, with a reason (S06 rule 16).
 */
const recogniseStepSchema = z
  .strictObject({
    kind: z.literal('recognise'),
    recognise: countSchema(1),
    reason: actionReasonSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    step: step.recognise,
    reason: step.reason,
    outcome: step.outcome ?? null,
  }));

/**
 * Split the remainder of a cancelled project held `NEEDS_DECISION` (`cancelled_project_remainder`,
 * or an invoice's `invoiced_after_cancellation`):
 * `revenue`, the transaction amount to revenue in the project's currency, and the rest to the
 * refund payable, with a reason (S06 rules 15–16). Any whole amount is read, so a case can state
 * the inbox's refusal of one outside zero to the remainder.
 */
const splitStepSchema = z
  .strictObject({
    kind: z.literal('split'),
    split: z.strictObject({ step: countSchema(1), revenue: amountSchema }),
    reason: actionReasonSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    step: step.split.step,
    revenueMinor: step.split.revenue,
    reason: step.reason,
    outcome: step.outcome ?? null,
  }));

/**
 * The accountant's month-end revaluation of one ledger (S07 rules 10–18): the preview's
 * differences, dated on the month's last day, with their reversal on the next month's first day;
 * nothing when every difference is zero.
 */
const revalueStepSchema = z
  .strictObject({
    kind: z.literal('revalue'),
    revalue: z.enum(['book', 'parallel'], { error: 'Expected the ledger: book or parallel' }),
    period: periodSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    ledger: step.revalue,
    period: step.period,
    outcome: step.outcome ?? null,
  }));

/** Block an account with a reason, as the accountant does in the chart (S02 rule 5). */
const blockStepSchema = z
  .strictObject({
    kind: z.literal('block'),
    block: accountSchema,
    reason: actionReasonSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    account: step.block,
    reason: step.reason,
    outcome: step.outcome ?? null,
  }));

/**
 * Close a month with a reason (S07 rules 2, 5, 7–9), on the case's clock: refused with the first
 * failing rule, a failed checklist as `CHECKLIST_FAILED` with the failing items as its detail.
 */
const closeStepSchema = z
  .strictObject({
    kind: z.literal('close'),
    close: periodSchema,
    reason: actionReasonSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    period: step.close,
    reason: step.reason,
    outcome: step.outcome ?? null,
  }));

/** Reopen the latest closed month with a reason (S07 rules 3, 6); its held events are retried. */
const reopenStepSchema = z
  .strictObject({
    kind: z.literal('reopen'),
    reopen: periodSchema,
    reason: actionReasonSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    period: step.reopen,
    reason: step.reason,
    outcome: step.outcome ?? null,
  }));

/**
 * A manual entry saved as a draft and not posted (S03 rule 4): what it records, its date and the
 * request as the manual-entry form saves it. It posts nothing; S07's checklist reads it.
 */
const draftStepSchema = z
  .strictObject({
    kind: z.literal('draft'),
    draft: z.string().trim().min(1),
    accounting_date: dateSchema,
    payload: payloadSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    description: step.draft,
    accountingDate: step.accounting_date,
    payload: step.payload,
    outcome: step.outcome ?? null,
  }));

/** Discard a draft the case saved, by its step number, with a reason (S03 rule 11). */
const discardStepSchema = z
  .strictObject({
    kind: z.literal('discard'),
    discard: countSchema(1),
    reason: actionReasonSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    step: step.discard,
    reason: step.reason,
    outcome: step.outcome ?? null,
  }));

/**
 * The accountant's dated department of a manual service, with a reason (S09 rule 34): from
 * `effective_from`, the service's revenue is that department's.
 */
const serviceDepartmentStepSchema = z
  .strictObject({
    kind: z.literal('service_department'),
    service_department: z.strictObject({
      service: z.string().min(1),
      department: z.string().min(1),
      effective_from: dateSchema,
    }),
    reason: actionReasonSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    service: step.service_department.service,
    department: step.service_department.department,
    effectiveFrom: step.service_department.effective_from,
    reason: step.reason,
    outcome: step.outcome ?? null,
  }));

/**
 * One of the accountant's opening lines (S10 rule 14), as a manual line with, on a stated line
 * (non-monetary or equity, rule 17), its book and parallel amounts from the records; the amount in
 * a ledger's own currency is the line's own and is not stated.
 */
const openingLineSchema = z
  .strictObject({
    account: accountSchema,
    dims: dimensionsSchema.default({}),
    currency: currencyCodeSchema,
    amount: amountSchema,
    book: amountSchema.optional(),
    parallel: amountSchema.optional(),
    open_item: z
      .strictObject({ ref: z.string().trim().min(1).max(100), due: dateSchema.optional() })
      .optional(),
    memo: z.string().trim().min(1).max(300).optional(),
  })
  .transform((line) => ({
    account: line.account,
    dims: line.dims,
    currency: line.currency,
    amount: line.amount,
    book: line.book ?? null,
    parallel: line.parallel ?? null,
    openItem: line.open_item ? { ref: line.open_item.ref, due: line.open_item.due ?? null } : null,
    memo: line.memo ?? null,
  }));

/**
 * The records' figure of a client and currency on one of Hub's slots (S10 rule 15), signed as the
 * account's natural balance: a receivable debit positive, client funds credit positive.
 */
const recordFigureSchema = z.strictObject({
  slot: z.enum(['receivable', 'ad_funds']),
  client: z.string().min(1),
  currency: currencyCodeSchema,
  amount: amountSchema,
});

/** A list of the register whose documents are unique by their `key`. */
const registerList = <Shape extends z.ZodRawShape>(key: keyof Shape & string, shape: Shape) =>
  z
    .array(z.strictObject(shape))
    .refine(
      (documents) =>
        new Set(documents.map((document) => document[key as keyof typeof document])).size ===
        documents.length,
      `A document is listed twice by its ${key}`,
    )
    .default([]);

const documentId = z.string().trim().min(1).max(100);

/**
 * The snapshot's register of prior documents (S10 rules 5 and 28): every Hub document dated on or
 * before the eve, by type, with its date, and what a later event about it needs to be found (a
 * payment's receipt and invoice, a wallet entry's or spend update's client). An event that voids, changes,
 * archives or reopens one of them is held `NEEDS_DECISION` (`before_books_start`).
 */
const priorDocumentsSchema = z.strictObject({
  invoices: registerList('invoice', { invoice: documentId, issued_on: dateSchema }),
  payments: registerList('payment', {
    payment: documentId,
    receipt: documentId,
    invoice: documentId,
    paid_on: dateSchema,
  }),
  wallet_entries: registerList('entry', {
    entry: documentId,
    client: z.string().min(1),
    entered_on: dateSchema,
  }),
  spend_updates: registerList('update', {
    update: documentId,
    campaign: documentId,
    client: z.string().min(1),
    period_to: dateSchema,
  }),
  project_expenses: registerList('expense', { expense: documentId, spent_on: dateSchema }),
  milestone_dones: registerList('milestone', { milestone: documentId, done_on: dateSchema }),
});

/** Each prior document's list and date, for the check that it is on or before the eve. */
const priorDocumentDates = (register: z.infer<typeof priorDocumentsSchema>) =>
  [
    ...register.invoices.map((d) => ['invoices', d.issued_on] as const),
    ...register.payments.map((d) => ['payments', d.paid_on] as const),
    ...register.wallet_entries.map((d) => ['wallet_entries', d.entered_on] as const),
    ...register.spend_updates.map((d) => ['spend_updates', d.period_to] as const),
    ...register.project_expenses.map((d) => ['project_expenses', d.spent_on] as const),
    ...register.milestone_dones.map((d) => ['milestone_dones', d.done_on] as const),
  ] as const;

/**
 * Hub's snapshot as of the eve of the books start (S10 rule 5), in the short form of the event
 * payloads: invoices with their total and outstanding, credit lines of invoices not in `invoices`,
 * milestones, each client's USD wallet balance (funds held positive) and the register of prior
 * documents. Its executor checks it against the snapshot's contract; here a decimal number is
 * refused, as in any payload.
 */
const snapshotSchema = z.strictObject({
  invoices: z.array(payloadSchema).default([]),
  credits: z.array(payloadSchema).default([]),
  milestones: z.array(payloadSchema).default([]),
  wallets: z
    .array(z.strictObject({ client: z.string().min(1), balance: amountSchema }))
    .refine(
      (wallets) => new Set(wallets.map((wallet) => wallet.client)).size === wallets.length,
      'A wallet is stated twice',
    )
    .default([]),
  prior_documents: priorDocumentsSchema.default({
    invoices: [],
    payments: [],
    wallet_entries: [],
    spend_updates: [],
    project_expenses: [],
    milestone_dones: [],
  }),
});

/**
 * The owner's posting of the opening from its preview (S10 rules 10–23): the draft saved with the
 * step's snapshot (none: no Hub client holds `opening:write`), lines and figures, then posted with
 * the preview's fingerprint on the books start. A refused post (`OPENING_CHECKS_FAILED`, the failing
 * checks in rule 21's order) leaves the draft saved.
 */
const openingStepSchema = z
  .strictObject({
    kind: z.literal('opening'),
    opening: z.string().trim().min(1),
    snapshot: snapshotSchema.optional(),
    records: z
      .strictObject({
        lines: z.array(openingLineSchema).default([]),
        figures: z
          .array(recordFigureSchema)
          .refine(
            (figures) =>
              new Set(figures.map((f) => JSON.stringify([f.slot, f.client, f.currency]))).size ===
              figures.length,
            'A figure is stated twice for a slot, client and currency',
          )
          .default([]),
      })
      .default({ lines: [], figures: [] }),
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    description: step.opening,
    snapshot: step.snapshot ?? null,
    lines: step.records.lines,
    figures: step.records.figures,
    outcome: step.outcome ?? null,
  }));

/** The owner's whole reversal of the opening, with a reason (S10 rule 25). */
const reverseOpeningStepSchema = z
  .strictObject({
    kind: z.literal('reverse_opening'),
    reverse_opening: actionReasonSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    reason: step.reverse_opening,
    outcome: step.outcome ?? null,
  }));

const stepSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    const kind = STEP_KINDS.find((key) => key in value);
    return kind ? { kind, ...value } : value;
  },
  z.discriminatedUnion(
    'kind',
    [
      eventStepSchema,
      manualStepSchema,
      reversalStepSchema,
      jobStepSchema,
      rateStepSchema,
      retryStepSchema,
      moveStepSchema,
      resolveStepSchema,
      dismissStepSchema,
      recogniseStepSchema,
      splitStepSchema,
      revalueStepSchema,
      blockStepSchema,
      closeStepSchema,
      reopenStepSchema,
      draftStepSchema,
      discardStepSchema,
      serviceDepartmentStepSchema,
      openingStepSchema,
      reverseOpeningStepSchema,
    ],
    {
      error:
        'Expected a step with one of the keys event, manual, reversal, job, rate, retry, move, ' +
        'resolve, dismiss, recognise, split, revalue, block, close, reopen, draft, discard, ' +
        'service_department, opening or reverse_opening',
    },
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
    reports: z.array(expectedReportSchema).default([]),
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
      if (step.kind === 'discard' && (step.step > s || steps[step.step - 1]?.kind !== 'draft')) {
        issue(`Step ${step.step} is not an earlier draft step`, ['steps', s, 'discard']);
      }
      if (step.kind === 'revalue' && step.ledger === 'parallel' && parallel === null) {
        issue('The company keeps no parallel ledger to revalue', ['steps', s, 'revalue']);
      }
      // S05 rules 15–17, S06 rule 16: an action names an earlier event step, and a resolve an
      // expected entry.
      if (
        step.kind === 'retry' ||
        step.kind === 'move' ||
        step.kind === 'resolve' ||
        step.kind === 'dismiss' ||
        step.kind === 'recognise' ||
        step.kind === 'split'
      ) {
        const path =
          step.kind === 'resolve' || step.kind === 'split'
            ? ['steps', s, step.kind, 'step']
            : ['steps', s, step.kind];
        if (step.step > s || steps[step.step - 1]?.kind !== 'event') {
          issue(`Step ${step.step} is not an earlier event step`, path);
        }
        if (step.kind === 'resolve' && step.entry > entries.length) {
          issue(`Entry ${step.entry} is not an expected entry`, ['steps', s, 'resolve', 'entry']);
        }
      }
    }
    // S10 rules 1 and 3: an opening needs a books start, and a company with a books start posts
    // nothing until its opening posts.
    const { booksStart } = scenarioCase.company;
    if (booksStart !== null && !steps.some((step) => step.kind === 'opening')) {
      issue('A company with a books start posts nothing without an opening step', [
        'company',
        'books_start',
      ]);
    }
    for (const [s, step] of steps.entries()) {
      if (step.kind !== 'opening' && step.kind !== 'reverse_opening') continue;
      if (booksStart === null) {
        issue(`An ${step.kind} step needs the company's books_start`, ['steps', s, step.kind]);
      }
      if (step.kind !== 'opening') continue;
      // S10 rule 5: the register lists the documents dated on or before the eve.
      if (booksStart !== null && step.snapshot !== null) {
        const register = step.snapshot.prior_documents;
        const listed = new Map<string, number>();
        for (const [list, date] of priorDocumentDates(register)) {
          const d = listed.get(list) ?? 0;
          listed.set(list, d + 1);
          if (date >= booksStart) {
            const path = ['steps', s, 'snapshot', 'prior_documents', list, d];
            issue(`A prior document is dated on or after the books start ${booksStart}`, path);
          }
        }
      }
      for (const [l, line] of step.lines.entries()) {
        const path = ['steps', s, 'records', 'lines', l];
        if (line.parallel !== null && parallel === null) {
          issue('The company keeps no parallel ledger: state no parallel amount', [
            ...path,
            'parallel',
          ]);
        }
        if (line.book !== null && line.currency === book.currency) {
          issue(`In ${book.currency}, the book amount is the line's amount: state none`, [
            ...path,
            'book',
          ]);
        }
        if (line.parallel !== null && line.currency === parallel?.currency) {
          const message = `In ${parallel.currency}, the parallel amount is the line's amount: state none`;
          issue(message, [...path, 'parallel']);
        }
      }
    }
    if (scenarioCase.expect.outcome && steps.at(-1)?.outcome) {
      const message = "The last step's outcome is stated twice: on the step and in expect";
      issue(message, ['expect', 'outcome']);
    }
    const corrected = new Set<number>();
    for (const [c, correction] of scenarioCase.expect.corrections.entries()) {
      const path = ['expect', 'corrections', c];
      const step = steps[correction.step - 1];
      if (step?.kind !== 'rate' || step.reason === null) {
        issue(`Step ${correction.step} is not a rate step with a reason`, [...path, 'step']);
      }
      // A held or refused step answers no correction, so its stated entries could never be checked.
      const last = correction.step === steps.length;
      if (step?.outcome || (last && scenarioCase.expect.outcome)) {
        issue(`Step ${correction.step} states an outcome, so it lists no entries`, path);
      }
      if (corrected.has(correction.step)) issue(`Step ${correction.step} is stated twice`, path);
      corrected.add(correction.step);
      for (const [u, entry] of correction.usedBy.entries()) {
        if (entry > entries.length) {
          issue(`Entry ${entry} is not an expected entry`, [...path, 'used_by', u]);
        }
      }
    }

    for (const [r, report] of scenarioCase.expect.reports.entries()) {
      const path = ['expect', 'reports', r];
      if (reportLedger(report) === 'parallel' && parallel === null) {
        issue('The company keeps no parallel ledger to report', [...path, 'params', 'ledger']);
      }
      // S10 rules 31–33 present a books start: a company without one has none of it.
      if (scenarioCase.company.booksStart === null) {
        const marks = [
          ...report.marks,
          ...('compareMarks' in report ? (report.compareMarks ?? []) : []),
        ];
        if (marks.some((mark) => BOOKS_START_MARKS.includes(mark))) {
          issue("A books start's mark needs the company's books_start", [...path, 'marks']);
        }
        if (
          report.report === 'balance_sheet' &&
          (report.yearResultPreOpening !== null || report.compareYearResultPreOpening !== null)
        ) {
          issue("The result before the books start needs the company's books_start", path);
        }
      }
      const named = reportEntries(report);
      for (const entry of named) {
        if (entry > entries.length) issue(`Entry ${entry} is not an expected entry`, path);
      }
      // The journal book prints in (entry_date, number) order (ADR 0008; S09 rule 26): by date,
      // then by posting place, so a back-dated entry appears at its date.
      if (report.report === 'journal_book') {
        const key = (entry: number) =>
          `${entries[entry - 1]?.date ?? ''}#${String(entry).padStart(9, '0')}`;
        if (named.some((entry, index) => index > 0 && key(entry) < key(named[index - 1] ?? 0))) {
          issue("The journal book's entries are in (entry_date, number) order", [...path, 'pages']);
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
