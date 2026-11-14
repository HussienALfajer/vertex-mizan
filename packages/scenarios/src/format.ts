import {
  accountClassOfCode,
  accountCodeLevel,
  type CompanyLedgers,
  type CurrencyCode,
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
import { bookChart } from './agency-chart.js';
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
  const chart = bookChart(company.template);
  if (chart === undefined) {
    const message = 'Accounts are added to a known chart template';
    context.addIssue({ code: 'custom', message, path: ['accounts'] });
    return;
  }
  const templateId = chart.id;
  const template = chart.accounts;
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
 * A step is told apart by its one key: `manual`, `reversal` or `rate`; S07's `revalue` (rules
 * 10–18), `block` (S02 rule 5),
 * `close` and `reopen` (rules 2–9), and a manual entry saved as a `draft` and its `discard` (S03
 * rules 4 and 11), which S07's checklist reads (`no_drafts`); and S09's `service_department`, a
 * manual service's dated department (rule 34); and S10's `opening` (rules 10–23) and its
 * `reverse_opening` (rule 25); and S11's `voucher` (rules 9–14), a cash voucher posted from its
 * draft.
 */
export const STEP_KINDS = [
  'manual',
  'reversal',
  'rate',
  'revalue',
  'block',
  'close',
  'reopen',
  'draft',
  'discard',
  'service_department',
  'opening',
  'reverse_opening',
  'voucher',
] as const;

export type StepKind = (typeof STEP_KINDS)[number];

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

/** The written reason an action keeps: a block, a close, a reopen, a discard. */
const actionReasonSchema = z.string().trim().min(1).max(500);

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

/**
 * A cash voucher (S11 rules 9–14): what it records, its date and the request as the voucher form
 * sends it, a draft with its voucher header (`voucher: { kind, cash_account, counter_cash_account?,
 * party_name?, counted? }`) and its lines, posted from that draft. A transfer's dealt rate is the
 * system's to derive from its amounts (rule 12), so its payload states none.
 */
const voucherStepSchema = z
  .strictObject({
    kind: z.literal('voucher'),
    voucher: z.string().trim().min(1),
    accounting_date: dateSchema,
    payload: payloadSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    description: step.voucher,
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
 * The owner's posting of the opening from its preview (S10 rules 14–23): the draft saved with the
 * step's lines, then posted with the preview's fingerprint on the books start. A refused post (`OPENING_CHECKS_FAILED`, the failing
 * checks in rule 21's order) leaves the draft saved.
 */
const openingStepSchema = z
  .strictObject({
    kind: z.literal('opening'),
    opening: z.string().trim().min(1),
    records: z
      .strictObject({ lines: z.array(openingLineSchema).default([]) })
      .default({ lines: [] }),
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    description: step.opening,
    lines: step.records.lines,
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
      manualStepSchema,
      reversalStepSchema,
      rateStepSchema,
      revalueStepSchema,
      blockStepSchema,
      closeStepSchema,
      reopenStepSchema,
      draftStepSchema,
      discardStepSchema,
      serviceDepartmentStepSchema,
      openingStepSchema,
      reverseOpeningStepSchema,
      voucherStepSchema,
    ],
    {
      error:
        'Expected a step with one of the keys manual, reversal, rate, revalue, block, close, ' +
        'reopen, draft, discard, service_department, opening, reverse_opening or voucher',
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

/**
 * A cash voucher the company holds (S11 rules 9–14): its kind and its number in that kind and its
 * fiscal year, its date and cash account, the entry it posted (posting order; `null` only for a
 * count that matched), a count's expected and counted amounts, and the reversal that cancelled it.
 */
const voucherSchema = z
  .strictObject({
    kind: z.enum(['receipt', 'payment', 'transfer', 'count']),
    number: countSchema(1),
    date: dateSchema,
    cash_account: accountSchema,
    entry: countSchema(1).nullable(),
    expected: amountSchema.optional(),
    counted: amountSchema.optional(),
    cancelled_by: countSchema(1).optional(),
  })
  .superRefine((voucher, context) => {
    const issue = (message: string, path: PropertyKey[]) =>
      context.addIssue({ code: 'custom', message, path });
    const count = voucher.kind === 'count';
    for (const field of ['expected', 'counted'] as const) {
      const amount = voucher[field];
      if ((amount !== undefined) !== count) {
        issue(count ? `A count states its ${field} amount` : `Only a count has ${field}`, [field]);
      } else if (amount !== undefined && amount < 0n) {
        issue('A box is never below zero, nor is the cash counted in it', [field]);
      }
    }
    // Rule 13: a count posts an entry exactly when it finds a difference; every other voucher posts.
    const matches = count && voucher.expected === voucher.counted;
    if (matches && voucher.entry !== null) issue('A count that matches posts no entry', ['entry']);
    if (!matches && voucher.entry === null) {
      issue('Only a count that matches has no entry', ['entry']);
    }
    // Rule 14: a voucher is cancelled by reversing its entry, so one without an entry cannot be.
    if (voucher.cancelled_by !== undefined && voucher.entry === null) {
      issue('A voucher with no entry cannot be cancelled', ['cancelled_by']);
    }
  })
  .transform(({ cash_account, cancelled_by, ...voucher }) => ({
    ...voucher,
    cashAccount: cash_account,
    expected: voucher.expected ?? null,
    counted: voucher.counted ?? null,
    cancelledBy: cancelled_by ?? null,
  }));

export type ExpectedVoucher = z.output<typeof voucherSchema>;

const expectSchema = z
  .strictObject({
    entries: z.array(entrySchema),
    balances: z.array(balanceSchema).default([]),
    open_items: z.array(openItemSchema).default([]),
    corrections: z.array(correctionSchema).default([]),
    vouchers: z.array(voucherSchema).optional(),
    reports: z.array(expectedReportSchema).default([]),
    outcome: outcomeSchema.optional(),
  })
  .transform(({ open_items, ...expect }) => ({
    ...expect,
    openItems: open_items,
    vouchers: expect.vouchers ?? null,
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

    const numbered = new Set<string>();
    const posted = new Set<number>();
    for (const [v, voucher] of (scenarioCase.expect.vouchers ?? []).entries()) {
      const path = ['expect', 'vouchers', v];
      const key = JSON.stringify([voucher.kind, voucher.date.slice(0, 4), voucher.number]);
      if (numbered.has(key)) issue(`${voucher.kind} ${voucher.number} is stated twice`, path);
      numbered.add(key);
      if (voucher.entry !== null) {
        if (voucher.entry > entries.length) {
          issue(`Entry ${voucher.entry} is not an expected entry`, [...path, 'entry']);
        } else if (entries[voucher.entry - 1]?.date !== voucher.date) {
          issue(`Entry ${voucher.entry} is not dated ${voucher.date}`, [...path, 'entry']);
        }
        if (posted.has(voucher.entry)) {
          issue(`Entry ${voucher.entry} is another voucher's`, [...path, 'entry']);
        }
        posted.add(voucher.entry);
      }
      const { cancelledBy } = voucher;
      if (cancelledBy !== null) {
        const reversal = entries[cancelledBy - 1];
        if (reversal?.source !== 'reversal' || cancelledBy <= (voucher.entry ?? 0)) {
          issue(`Entry ${cancelledBy} is not a later expected reversal`, [...path, 'cancelled_by']);
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
