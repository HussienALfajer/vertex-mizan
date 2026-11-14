import { z } from 'zod';
import { chartTemplateIdSchema } from './chart.js';
import { companyLedgersSchema } from './money.js';
import { openingStateSchema } from './opening-states.js';

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

/**
 * `PATCH /api/company`: the names, the policy note and the approval of manual entries (S03 rule 8),
 * all outside the settings lock; at least one of them.
 */
export const updateCompanyProfileSchema = z
  .object({
    name: companyNameSchema.optional(),
    nameLatin: companyNameSchema.nullable().optional(),
    policyNote: policyNoteSchema.optional(),
    manualEntryApproval: z.boolean().optional(),
  })
  .refine((change) => Object.values(change).some((value) => value !== undefined), {
    message: 'Nothing to change',
  })
  .meta({ id: 'UpdateCompanyProfile' });

export type UpdateCompanyProfile = z.infer<typeof updateCompanyProfileSchema>;

/**
 * A company's books start (S10 rule 1): the first day of a month, on or after 2026-01-01, the
 * first day its ledger keeps; the opening entry is dated on it.
 */
export const booksStartSchema = z.iso
  .date()
  .refine((date) => date.endsWith('-01') && date >= '2026-01-01', {
    message: 'The first day of a month, on or after 2026-01-01',
  })
  .meta({ id: 'BooksStart' });

/**
 * `PUT /api/company/ledgers`: refused once the books started (`COMPANY_SETTINGS_LOCKED`). S10:
 * `booksStart`, left as it is when omitted, changes only while the company has no posted entry, no
 * snapshot and no opening, and is never cleared once set (`BOOKS_START_LOCKED`, rule 2).
 */
export const updateCompanyLedgersSchema = z
  .object({
    ledgers: companyLedgersSchema,
    fiscalYearStartMonth: fiscalYearStartMonthSchema,
    booksStart: booksStartSchema.nullable().optional(),
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
    /** The books start (S10 rule 1), or null for a company that starts without an opening. */
    booksStart: booksStartSchema.nullable(),
    /** Its latest opening's state (S10), or null before the first save of one. */
    openingState: openingStateSchema.nullable(),
    /** Manual entries and reversals are submitted and approved before they post (S03 rule 8). */
    manualEntryApproval: z.boolean(),
    archived: z.object({ at: z.iso.datetime({ offset: true }), reason: z.string() }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Company' });

export type Company = z.infer<typeof companySchema>;
