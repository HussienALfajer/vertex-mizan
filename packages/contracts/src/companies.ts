import { z } from 'zod';
import { chartTemplateIdSchema } from './chart.js';
import { companyLedgersSchema } from './money.js';

/** A company's Arabic name, or its optional Latin name: 1–200 characters after trimming. */
const companyNameSchema = z.string().trim().min(1).max(200);

/**
 * The IAS 21.9–12 basis of the book currency (ADR 0007), in the company's words; editable after
 * the settings lock, with before and after in the audit log.
 */
export const policyNoteSchema = z.string().trim().min(1).max(4000).meta({ id: 'PolicyNote' });

/**
 * The month the fiscal year starts in, 1–12. January by default: Income Tax Law 24/2003 uses the
 * calendar year (CONFIRMED). Locked with the ledgers at the first posted entry.
 */
export const fiscalYearStartMonthSchema = z
  .int()
  .min(1)
  .max(12)
  .meta({ id: 'FiscalYearStartMonth' });

/** A written reason: archiving, restoring, removing a member, resetting two-factor. */
export const reasonSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .meta({ id: 'Reason' });

export type Reason = z.infer<typeof reasonSchema>;

/**
 * `POST /api/companies`: a new company, whose creator becomes its owner. `template` is the chart
 * template applied over the five roots in the creation transaction (S02 rule 1); null keeps the
 * roots alone, to which a template can be applied later.
 */
export const createCompanySchema = z
  .object({
    name: companyNameSchema,
    nameLatin: companyNameSchema.nullable(),
    ledgers: companyLedgersSchema,
    fiscalYearStartMonth: fiscalYearStartMonthSchema,
    policyNote: policyNoteSchema,
    template: chartTemplateIdSchema.nullable().default(null),
  })
  .meta({ id: 'CreateCompany', description: 'A new company with its ledger settings' });

export type CreateCompany = z.infer<typeof createCompanySchema>;

/** `PATCH /api/company`: the names and the policy note; at least one of them. */
export const updateCompanyProfileSchema = z
  .object({
    name: companyNameSchema.optional(),
    nameLatin: companyNameSchema.nullable().optional(),
    policyNote: policyNoteSchema.optional(),
  })
  .refine((change) => Object.values(change).some((value) => value !== undefined), {
    message: 'Nothing to change',
  })
  .meta({ id: 'UpdateCompanyProfile' });

export type UpdateCompanyProfile = z.infer<typeof updateCompanyProfileSchema>;

/** `PUT /api/company/ledgers`: refused once the books started (`COMPANY_SETTINGS_LOCKED`). */
export const updateCompanyLedgersSchema = z
  .object({
    ledgers: companyLedgersSchema,
    fiscalYearStartMonth: fiscalYearStartMonthSchema,
  })
  .meta({ id: 'UpdateCompanyLedgers' });

export type UpdateCompanyLedgers = z.infer<typeof updateCompanyLedgersSchema>;

/** A company as the API returns it: profile, ledger settings and state. */
export const companySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    nameLatin: z.string().nullable(),
    ledgers: companyLedgersSchema,
    fiscalYearStartMonth: fiscalYearStartMonthSchema,
    policyNote: z.string(),
    /** Whether the first entry posted: the ledger settings are then locked. */
    booksStarted: z.boolean(),
    archived: z.object({ at: z.iso.datetime({ offset: true }), reason: z.string() }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Company' });

export type Company = z.infer<typeof companySchema>;
