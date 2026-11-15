import {
  accountClassOfCode,
  accountCodeLevel,
  BUILTIN_DIMENSION_TYPES,
  type BuiltinDimensionType,
  type CompanyLedgers,
  type CurrencyCode,
  chartTemplate,
  chartTemplateIdSchema,
  companyLedgersSchema,
  counterpartyTypeSchema,
  currencies,
  currencyCodeSchema,
  divideHalfAwayFromZero,
  exchangeRateSchema,
  itemKindSchema,
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

/** The currency shapes of ADR 0007 and ADR 0008: the book and parallel currency of each. */
export const SHAPES = {
  syp: { book: 'SYP', parallel: null },
  'syp-usd': { book: 'SYP', parallel: 'USD' },
  'usd-syp': { book: 'USD', parallel: 'SYP' },
  third: { book: 'SYP', parallel: 'USD' },
} as const satisfies Record<string, { book: CurrencyCode; parallel: CurrencyCode | null }>;

export type Shape = keyof typeof SHAPES;

const builtinDimensionTypeSchema = z.enum(
  BUILTIN_DIMENSION_TYPES.map((type) => type.code) as [
    BuiltinDimensionType,
    ...BuiltinDimensionType[],
  ],
);

/**
 * An account the case adds to its template, as the accountant adds one in the chart (S02), for a
 * case that needs an account the template lacks (a TRY cash account, for instance). A header
 * (level 3) holds the postable accounts added under it; a postable account carries its statement
 * line and may be a control account with its item kind and counterparty type (S04, S11 rule 5)
 * and name the dimension types it requires (S02). The services check the account's shape.
 */
const addedAccountSchema = z
  .strictObject({
    code: accountSchema,
    kind: z.enum(['header', 'postable']).default('postable'),
    name: z.string().trim().min(1),
    name_latin: z.string().trim().min(1).optional(),
    statement_line: z.string().min(1).optional(),
    currency: currencyCodeSchema.optional(),
    monetary: z.boolean().default(false),
    control: itemKindSchema.optional(),
    counterparty_type: counterpartyTypeSchema.optional(),
    required: z
      .array(builtinDimensionTypeSchema)
      .refine((types) => new Set(types).size === types.length, 'A dimension type is stated twice')
      .default([]),
  })
  .refine(
    (account) => (account.kind === 'postable') === (account.statement_line !== undefined),
    'A postable account, and only a postable account, has a statement line',
  )
  .refine(
    (account) => (account.control === undefined) === (account.counterparty_type === undefined),
    'A control account, and only a control account, has a counterparty type',
  )
  .transform((account) => ({
    code: account.code,
    kind: account.kind,
    name: account.name,
    nameLatin: account.name_latin ?? null,
    statementLine: account.statement_line ?? null,
    currency: account.currency ?? null,
    isMonetary: account.monetary,
    itemKind: account.control ?? null,
    counterpartyType: account.counterparty_type ?? null,
    requiredDimensions: account.required,
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
  template: chartTemplateIdSchema.optional(),
  accounts: z.array(addedAccountSchema).default([]),
  closed_periods: z.array(periodSchema).default([]),
  // The contract values the case's manual lines name, with the kind and client a contract needs
  // (S02); a contract an event names is made by the event (S09). A project's terms (S12 rule 1):
  // its currency, contract value and retention and advance-recovery rates in basis points.
  contracts: z
    .array(
      z
        .strictObject({
          code: z.string().min(1),
          kind: z.enum(['project', 'retainer']),
          client: z.string().min(1),
          terms: z
            .strictObject({
              currency: currencyCodeSchema,
              value: amountSchema.refine(
                (value) => value >= 0n,
                'A contract value is never negative',
              ),
              retention_bp: countSchema(0, 10000),
              advance_recovery_bp: countSchema(0, 10000),
            })
            .optional(),
        })
        .refine((contract) => contract.terms === undefined || contract.kind === 'project', {
          message: 'Only a project has terms',
          path: ['terms'],
        })
        .transform(({ terms, ...contract }) => ({
          ...contract,
          terms:
            terms === undefined
              ? null
              : {
                  currency: terms.currency,
                  value: terms.value,
                  retentionBp: terms.retention_bp,
                  advanceRecoveryBp: terms.advance_recovery_bp,
                },
        })),
    )
    .refine(
      (contracts) => new Set(contracts.map((contract) => contract.code)).size === contracts.length,
      'A contract is stated twice',
    )
    .default([]),
  // The materials catalogue the case's lines name (S12 rule 3): a code, a name and a unit.
  materials: z
    .array(
      z.strictObject({
        code: z.string().min(1).max(30),
        name: z.string().trim().min(1).max(200),
        unit: z.string().trim().min(1).max(20),
      }),
    )
    .refine(
      (materials) => new Set(materials.map((material) => material.code)).size === materials.length,
      'A material is stated twice',
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
 * Each added account fits the template as S02 would place it: a code not already in it, stated
 * once; a header at level 3 under one of the template's level-2 headers; a postable account under
 * one of its headers or an earlier added header, with a statement line of its class.
 */
function checkAddedAccounts(company: RawCompany, context: z.RefinementCtx): void {
  if (company.accounts.length === 0) return;
  if (company.template === undefined) {
    const message = 'Accounts are added to a chart template';
    context.addIssue({ code: 'custom', message, path: ['accounts'] });
    return;
  }
  const templateId = company.template;
  const template = chartTemplate(templateId).accounts;
  const isHeader = (code: string, before: number) =>
    template.some((existing) => existing.code === code && existing.kind === 'header') ||
    company.accounts
      .slice(0, before)
      .some((added) => added.code === code && added.kind === 'header');
  const issue = (index: number, message: string) =>
    context.addIssue({ code: 'custom', message, path: ['accounts', index] });
  for (const [index, account] of company.accounts.entries()) {
    const { code } = account;
    const level = accountCodeLevel(code);
    if (company.accounts.slice(0, index).some((other) => other.code === code)) {
      issue(index, `Account ${code} is added twice`);
    } else if (template.some((existing) => existing.code === code)) {
      issue(index, `Account ${code} is already in the ${templateId} template`);
    } else if (account.kind === 'header') {
      if (level !== 3) {
        issue(index, `Header ${code} is not the code of a level-3 header`);
      } else if (!isHeader(code.slice(0, 2), index)) {
        issue(
          index,
          `Header ${code} has no header ${code.slice(0, 2)} in the ${templateId} template`,
        );
      }
    } else if (level !== 4) {
      issue(index, `Account ${code} is not the code of a postable account`);
    } else if (!isHeader(code.slice(0, 3), index)) {
      issue(
        index,
        `Account ${code} has no header ${code.slice(0, 3)} in the ${templateId} template`,
      );
    } else if (
      account.statementLine === null ||
      !statementLineFits(account.statementLine, accountClassOfCode(code))
    ) {
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
    materials: company.materials,
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
 * draft; and S12's `project_document` (rules 7–22), a project document posted from its draft.
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
  'project_document',
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
 * party_name?, counted?, expected? }`) and its lines (none on a count), posted from that draft. A transfer's dealt rate is the
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

/**
 * A project document (S12 rules 7–22): what it records, its date and the document as the form
 * sends it (`document: { kind, contract, cumulative?, retention?, advance?, … }` and, for a
 * purchase or a wage sheet, its lines), saved as a draft and posted from it. The posting derives
 * its entry (`buildProjectDocument()`), so the payload is the executor's to read.
 */
const projectDocumentStepSchema = z
  .strictObject({
    kind: z.literal('project_document'),
    project_document: z.string().trim().min(1),
    accounting_date: dateSchema,
    payload: payloadSchema,
    ...stepOutcome,
  })
  .transform((step) => ({
    kind: step.kind,
    description: step.project_document,
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
      projectDocumentStepSchema,
    ],
    {
      error:
        'Expected a step with one of the keys manual, reversal, rate, revalue, block, close, ' +
        'reopen, draft, discard, service_department, opening, reverse_opening, voucher or ' +
        'project_document',
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
 * fiscal year, its date and cash account, a transfer's destination, the entry it posted (posting order; `null` only for a
 * count that matched), a count's expected and counted amounts, and the reversal that cancelled it.
 */
const voucherSchema = z
  .strictObject({
    kind: z.enum(['receipt', 'payment', 'transfer', 'count']),
    number: countSchema(1),
    date: dateSchema,
    cash_account: accountSchema,
    counter_cash_account: accountSchema.optional(),
    entry: countSchema(1).nullable(),
    expected: amountSchema.optional(),
    counted: amountSchema.optional(),
    cancelled_by: countSchema(1).optional(),
  })
  .superRefine((voucher, context) => {
    const issue = (message: string, path: PropertyKey[]) =>
      context.addIssue({ code: 'custom', message, path });
    const count = voucher.kind === 'count';
    const transfer = voucher.kind === 'transfer';
    if ((voucher.counter_cash_account !== undefined) !== transfer) {
      const message = transfer
        ? 'A transfer states its destination, counter_cash_account'
        : 'Only a transfer has counter_cash_account';
      issue(message, ['counter_cash_account']);
    } else if (transfer && voucher.counter_cash_account === voucher.cash_account) {
      issue('A transfer moves cash between two cash accounts', ['counter_cash_account']);
    }
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
  .transform(({ cash_account, counter_cash_account, cancelled_by, ...voucher }) => ({
    ...voucher,
    cashAccount: cash_account,
    counterCashAccount: counter_cash_account ?? null,
    expected: voucher.expected ?? null,
    counted: voucher.counted ?? null,
    cancelledBy: cancelled_by ?? null,
  }));

export type ExpectedVoucher = z.output<typeof voucherSchema>;

/**
 * A client's progress billing the company holds (S12 rules 14–16, 21): its kind and its number in
 * that kind and its fiscal year, its date, project and client, its number within its project
 * (`sequence`), the entry it posted and the reversal that cancelled it (posting order, rule 22),
 * and its currency, cumulative, previous, retention and advance recovery (rules 14–15).
 */
const progressBillingSchema = z
  .strictObject({
    kind: z.literal('progress_billing'),
    number: countSchema(1),
    date: dateSchema,
    contract: z.string().min(1),
    client: z.string().min(1),
    sequence: countSchema(1),
    entry: countSchema(1),
    currency: currencyCodeSchema,
    cumulative: amountSchema,
    previous: amountSchema,
    retention: amountSchema,
    advance: amountSchema,
    cancelled_by: countSchema(1).optional(),
  })
  .superRefine((document, context) => {
    const issue = (message: string, path: PropertyKey[]) =>
      context.addIssue({ code: 'custom', message, path });
    // Rule 14: the period's value is above zero; rule 15: each deduction is not negative, and
    // neither is the net, the period's value less both.
    const period = document.cumulative - document.previous;
    if (document.previous < 0n) issue('The previous cumulative is never negative', ['previous']);
    if (period <= 0n) issue("A billing's cumulative is above the previous", ['cumulative']);
    if (document.retention < 0n) issue('A retention is never negative', ['retention']);
    if (document.advance < 0n) issue('An advance recovery is never negative', ['advance']);
    if (period - document.retention - document.advance < 0n) {
      issue("A billing's net is never negative", ['advance']);
    }
  })
  .transform(({ cancelled_by, ...document }) => ({
    ...document,
    cancelledBy: cancelled_by ?? null,
  }));

/**
 * A project purchase invoice the company holds (S12 rules 7–8, 21): its number in its kind and
 * fiscal year, its date, project and the project's client, the supplier, the entry it posted and
 * the reversal that cancelled it (posting order, rule 22), its currency and the supplier's
 * reference when it has one.
 */
const purchaseSchema = z
  .strictObject({
    kind: z.literal('purchase'),
    number: countSchema(1),
    date: dateSchema,
    contract: z.string().min(1),
    client: z.string().min(1),
    supplier: z.string().min(1),
    entry: countSchema(1),
    currency: currencyCodeSchema,
    reference: z.string().trim().min(1).max(60).optional(),
    cancelled_by: countSchema(1).optional(),
  })
  .transform(({ cancelled_by, reference, ...document }) => ({
    ...document,
    reference: reference ?? null,
    cancelledBy: cancelled_by ?? null,
  }));

/**
 * A wage sheet the company holds (S12 rules 10, 21): its number in its kind and fiscal year, its
 * date, project and the project's client, the entry it posted and the reversal that cancelled it
 * (posting order, rule 22), its currency and its period, within one calendar month and ending on
 * the sheet's date.
 */
const wageSheetSchema = z
  .strictObject({
    kind: z.literal('wage_sheet'),
    number: countSchema(1),
    date: dateSchema,
    contract: z.string().min(1),
    client: z.string().min(1),
    entry: countSchema(1),
    currency: currencyCodeSchema,
    period_from: dateSchema,
    period_to: dateSchema,
    cancelled_by: countSchema(1).optional(),
  })
  .superRefine((document, context) => {
    const issue = (message: string, path: PropertyKey[]) =>
      context.addIssue({ code: 'custom', message, path });
    if (document.period_from > document.period_to) {
      issue("A wage sheet's period starts before it ends", ['period_from']);
    } else if (document.period_from.slice(0, 7) !== document.period_to.slice(0, 7)) {
      issue("A wage sheet's period lies within one calendar month", ['period_from']);
    }
    if (document.date !== document.period_to) {
      issue("A wage sheet is dated its period's last day", ['date']);
    }
  })
  .transform(({ cancelled_by, period_from, period_to, ...document }) => ({
    ...document,
    periodFrom: period_from,
    periodTo: period_to,
    cancelledBy: cancelled_by ?? null,
  }));

/** A project document the company holds (S12 rule 21), by its kind. */
const projectDocumentSchema = z.discriminatedUnion('kind', [
  progressBillingSchema,
  purchaseSchema,
  wageSheetSchema,
]);

export type ExpectedProjectDocument = z.output<typeof projectDocumentSchema>;

/** A quantity as typed: up to 3 decimals, always written with 3 (`"12.500"`, `"-2.500"`). */
const quantityTextSchema = z
  .string({ error: 'Expected the quantity in quotes ("12.500")' })
  .regex(/^-?\d{1,11}\.\d{3}$/, 'Expected a quantity with 3 decimals ("12.500")')
  .refine((quantity) => quantity !== '-0.000', 'A zero quantity has no sign');

/** A unit price as typed: up to 4 decimals, always written with 4 (`"3150.0000"`), never negative. */
const unitPriceTextSchema = z
  .string({ error: 'Expected the unit price in quotes ("3150.0000")' })
  .regex(/^\d{1,14}\.\d{4}$/, 'Expected a unit price with 4 decimals ("3150.0000")');

/** A decimal written with a fixed number of places, as a whole number of those places. */
const scaled = (text: string) => BigInt(text.replace('.', ''));

/**
 * `lineAmount()` (S12 rule 6): a quantity times a unit price, rounded half away from zero to the
 * currency's minor units.
 */
export function lineAmountOf(quantity: string, unitPrice: string, currency: CurrencyCode): bigint {
  const minor = 10n ** BigInt(currencies[currency].exponent);
  return divideHalfAwayFromZero(scaled(quantity) * scaled(unitPrice) * minor, 10n ** 7n);
}

/**
 * A line's quantity the company holds (S12 rules 4–6, `line_quantities`): the entry (posting
 * order) and the line by its account, currency and amount; its material, unit and quantity, and its
 * unit price, none on a price adjustment (quantity 0).
 */
const quantitySchema = z
  .strictObject({
    entry: countSchema(1),
    account: accountSchema,
    currency: currencyCodeSchema,
    amount: amountSchema,
    material: z.string().min(1).optional(),
    unit: z.string().trim().min(1).max(20),
    quantity: quantityTextSchema,
    unit_price: unitPriceTextSchema.optional(),
  })
  .superRefine((row, context) => {
    const issue = (message: string, path: PropertyKey[]) =>
      context.addIssue({ code: 'custom', message, path });
    const zero = scaled(row.quantity) === 0n;
    // Rule 6: a price adjustment is a quantity 0 on a material, with the amount typed and no price.
    if (zero && row.unit_price !== undefined) {
      issue('A price adjustment (quantity 0) has no unit price', ['unit_price']);
    } else if (!zero && row.unit_price === undefined) {
      issue('A quantity has its unit price', ['unit_price']);
    } else if (row.unit_price !== undefined) {
      const amount = lineAmountOf(row.quantity, row.unit_price, row.currency);
      if (amount !== row.amount) {
        issue(`${row.quantity} × ${row.unit_price} is ${amount} minor units`, ['amount']);
      }
    }
    if (zero && row.material === undefined) {
      issue('A quantity 0 is a price adjustment on a material', ['material']);
    }
  })
  .transform(({ unit_price, material, ...row }) => ({
    ...row,
    material: material ?? null,
    unitPrice: unit_price ?? null,
  }));

export type ExpectedQuantity = z.output<typeof quantitySchema>;

const expectSchema = z
  .strictObject({
    entries: z.array(entrySchema),
    balances: z.array(balanceSchema).default([]),
    open_items: z.array(openItemSchema).default([]),
    corrections: z.array(correctionSchema).default([]),
    vouchers: z.array(voucherSchema).optional(),
    project_documents: z.array(projectDocumentSchema).optional(),
    quantities: z.array(quantitySchema).optional(),
    reports: z.array(expectedReportSchema).default([]),
    outcome: outcomeSchema.optional(),
  })
  .transform(({ open_items, project_documents, ...expect }) => ({
    ...expect,
    openItems: open_items,
    vouchers: expect.vouchers ?? null,
    projectDocuments: project_documents ?? null,
    quantities: expect.quantities ?? null,
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

    // S12 rules 1, 7, 14, 21 and 22: a document names a stated project with its client, and a
    // billing the project's terms, in the terms' currency; its number is unique in its kind and
    // fiscal year and a billing's sequence within its project; its entry is an expected entry of its
    // date posted by no other document, and its cancelling reversal a later expected reversal.
    const documentNumbers = new Set<string>();
    const sequences = new Set<string>();
    const documentEntries = new Set<number>();
    const { contracts } = scenarioCase.company;
    for (const [d, document] of (scenarioCase.expect.projectDocuments ?? []).entries()) {
      const path = ['expect', 'project_documents', d];
      const contract = contracts.find((candidate) => candidate.code === document.contract);
      if (contract?.kind !== 'project') {
        issue(`${document.contract} is not a project in company.contracts`, [...path, 'contract']);
      } else if (contract.client !== document.client) {
        issue(`${document.contract} is ${contract.client}'s project`, [...path, 'client']);
      } else if (document.kind !== 'progress_billing') {
        // A purchase or a wage sheet needs no terms, and may be in any currency (rules 7, 10).
      } else if (contract.terms === null) {
        issue(`A billing needs the terms of ${document.contract}`, [...path, 'contract']);
      } else if (contract.terms.currency !== document.currency) {
        const message = `${document.contract}'s terms are in ${contract.terms.currency}`;
        issue(message, [...path, 'currency']);
      }
      const number = JSON.stringify([document.kind, document.date.slice(0, 4), document.number]);
      if (documentNumbers.has(number)) {
        issue(`${document.kind} ${document.number} is stated twice`, [...path, 'number']);
      }
      documentNumbers.add(number);
      if (document.kind === 'progress_billing') {
        const sequence = JSON.stringify([document.kind, document.contract, document.sequence]);
        if (sequences.has(sequence)) {
          const message = `Billing ${document.sequence} of ${document.contract} is stated twice`;
          issue(message, [...path, 'sequence']);
        }
        sequences.add(sequence);
      }
      if (document.entry > entries.length) {
        issue(`Entry ${document.entry} is not an expected entry`, [...path, 'entry']);
      } else if (entries[document.entry - 1]?.date !== document.date) {
        issue(`Entry ${document.entry} is not dated ${document.date}`, [...path, 'entry']);
      }
      if (documentEntries.has(document.entry)) {
        issue(`Entry ${document.entry} is another document's`, [...path, 'entry']);
      }
      documentEntries.add(document.entry);
      const { cancelledBy } = document;
      if (cancelledBy !== null) {
        const reversal = entries[cancelledBy - 1];
        if (reversal?.source !== 'reversal' || cancelledBy <= document.entry) {
          issue(`Entry ${cancelledBy} is not a later expected reversal`, [...path, 'cancelled_by']);
        }
      }
    }

    // S12 rules 3–6: a quantity is on a line of an expected entry with its account, currency and
    // amount, and names a stated material in that material's unit.
    const { materials } = scenarioCase.company;
    for (const [q, row] of (scenarioCase.expect.quantities ?? []).entries()) {
      const path = ['expect', 'quantities', q];
      const entry = entries[row.entry - 1];
      if (entry === undefined) {
        issue(`Entry ${row.entry} is not an expected entry`, [...path, 'entry']);
      } else if (
        !entry.lines.some(
          (line) =>
            line.account === row.account &&
            line.currency === row.currency &&
            line.amount === row.amount,
        )
      ) {
        const message = `Entry ${row.entry} has no ${row.account} line of ${row.amount} ${row.currency}`;
        issue(message, [...path, 'amount']);
      }
      if (row.material !== null) {
        const material = materials.find((candidate) => candidate.code === row.material);
        if (material === undefined) {
          issue(`${row.material} is not a material in company.materials`, [...path, 'material']);
        } else if (material.unit !== row.unit) {
          issue(`${row.material} is counted in ${material.unit}`, [...path, 'unit']);
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
