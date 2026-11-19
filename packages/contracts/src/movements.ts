import { z } from 'zod';
import { dealtRateSchema } from './entries.js';
import { currencyCodeSchema, quantitySchema, rateValueSchema, unitPriceSchema } from './money.js';
import { minorUnitsSchema } from './wire.js';

/**
 * S13's project movements (ADR 0024): one person records simple movements on a project, each
 * posted at once through an existing path, and reads each project's figures, the dashboard, the
 * parties' debts and the materials' costs. Amounts are minor units as integer strings (S03).
 */

/**
 * The kinds of movement (S13 "Data"), stored in the `movement_kind` enum: a value is never renamed,
 * a new one appended. `packages/db`'s `PROJECT_MOVEMENT_KINDS` equals it (a test).
 */
export const PROJECT_MOVEMENT_KINDS = [
  'received',
  'expense',
  'wages',
  'owed_by_us',
  'owed_to_us',
  'debt_paid',
  'debt_collected',
  'deposit',
] as const;

export const projectMovementKindSchema = z
  .enum(PROJECT_MOVEMENT_KINDS)
  .meta({ id: 'ProjectMovementKind' });

export type ProjectMovementKind = z.infer<typeof projectMovementKindSchema>;

/** The kinds whose party is the project's client. */
export const CLIENT_MOVEMENT_KINDS = ['received', 'owed_to_us', 'debt_collected'] as const;

/** The kinds whose party is a supplier. */
export const SUPPLIER_MOVEMENT_KINDS = ['owed_by_us', 'debt_paid'] as const;

/** The kinds that may name a material, with its quantity and unit price. */
export const MATERIAL_MOVEMENT_KINDS = ['expense', 'owed_by_us'] as const;

const includes = (list: readonly string[], kind: ProjectMovementKind) => list.includes(kind);

/** A project's state (S13 rule 9): a finished project takes no new movement. */
export const PROJECT_STATES = ['active', 'finished'] as const;

export const projectStateSchema = z.enum(PROJECT_STATES).meta({ id: 'ProjectState' });

export type ProjectState = z.infer<typeof projectStateSchema>;

const descriptionSchema = z.string().trim().min(1).max(500);
const nameSchema = z.string().trim().min(1).max(200);
const positiveMinorSchema = minorUnitsSchema.refine(
  (text) => !text.startsWith('-') && text !== '0',
  'Above zero',
);

/** A movement's material as typed: the material, the quantity and the unit price. */
export const movementMaterialInputSchema = z
  .object({ materialId: z.uuid(), quantity: quantitySchema, unitPrice: unitPriceSchema })
  .meta({ id: 'MovementMaterialInput' });

/**
 * `POST /api/movements` (S13 rule 1): the kind, the date, the project (none for a deposit), the
 * party (the client is the project's own; a supplier for owed by us and debt paid), the currency,
 * the amount, or a material with its quantity and unit price (the amount is then their product), a
 * description (the kind's name when left out), a rate dealt for it, and the client's key, unique
 * per request: the same key and request answer the first movement.
 */
export const recordMovementSchema = z
  .object({
    requestKey: z.string().trim().min(1).max(100),
    kind: projectMovementKindSchema,
    date: z.iso.date(),
    projectId: z.uuid().nullable().default(null),
    supplierId: z.uuid().nullable().default(null),
    currency: currencyCodeSchema,
    amountMinor: positiveMinorSchema.nullable().default(null),
    material: movementMaterialInputSchema.nullable().default(null),
    description: descriptionSchema,
    dealtRate: dealtRateSchema.nullable().default(null),
  })
  .superRefine((input, context) => {
    if ((input.projectId === null) !== (input.kind === 'deposit')) {
      context.addIssue({
        code: 'custom',
        message: 'Every movement but a deposit is on a project',
        path: ['projectId'],
      });
    }
    if ((input.supplierId !== null) !== includes(SUPPLIER_MOVEMENT_KINDS, input.kind)) {
      context.addIssue({
        code: 'custom',
        message: 'A supplier, and only on owed by us and debt paid',
        path: ['supplierId'],
      });
    }
    if (input.material !== null && !includes(MATERIAL_MOVEMENT_KINDS, input.kind)) {
      context.addIssue({
        code: 'custom',
        message: 'A material only on an expense or owed by us',
        path: ['material'],
      });
    }
    if ((input.amountMinor === null) === (input.material === null)) {
      context.addIssue({
        code: 'custom',
        message: 'An amount, or a material with its quantity and unit price',
        path: ['amountMinor'],
      });
    }
  })
  .meta({ id: 'RecordMovement' });

export type RecordMovement = z.infer<typeof recordMovementSchema>;

/** `POST /api/movements/:id/cancel` (S13 rule 8): the reason, kept with the cancellation. */
export const cancelMovementSchema = z
  .object({ reason: descriptionSchema })
  .meta({ id: 'CancelMovement' });

export type CancelMovement = z.infer<typeof cancelMovementSchema>;

/** A value named on a movement or a project: its id and name. */
export const namedRefSchema = z.object({ id: z.uuid(), name: z.string() }).meta({ id: 'NamedRef' });

export type NamedRef = z.infer<typeof namedRefSchema>;

/** A movement as listed (S13 "Screens"): as typed, with its book amount and its state. */
export const movementSchema = z
  .object({
    id: z.uuid(),
    kind: projectMovementKindSchema,
    fiscalYear: z.int(),
    number: z.int(),
    date: z.iso.date(),
    project: namedRefSchema.nullable(),
    party: namedRefSchema.nullable(),
    currency: currencyCodeSchema,
    amountMinor: minorUnitsSchema,
    /** What the movement is worth in the book currency, from its entry. */
    bookMinor: minorUnitsSchema,
    description: z.string(),
    material: z
      .object({
        id: z.uuid(),
        name: z.string(),
        unit: z.string(),
        quantity: z.string(),
        unitPrice: z.string(),
      })
      .nullable(),
    entryId: z.uuid(),
    cancellation: z
      .object({ reason: z.string(), on: z.iso.date(), reversalEntryId: z.uuid() })
      .nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Movement' });

export type Movement = z.infer<typeof movementSchema>;

/** `GET /api/movements`: filters by project, kind, currency and dates, newest first, by page. */
export const movementQuerySchema = z
  .object({
    project: z.uuid().optional(),
    kind: projectMovementKindSchema.optional(),
    currency: currencyCodeSchema.optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .meta({ id: 'MovementQuery' });

export type MovementQuery = z.infer<typeof movementQuerySchema>;

export const movementPageSchema = z
  .object({ movements: z.array(movementSchema), nextCursor: z.string().nullable() })
  .meta({ id: 'MovementPage' });

export type MovementPage = z.infer<typeof movementPageSchema>;

/** An amount in each currency it is held in, with its book amount. */
export const currencyAmountSchema = z
  .object({
    currency: currencyCodeSchema,
    amountMinor: minorUnitsSchema,
    bookMinor: minorUnitsSchema,
  })
  .meta({ id: 'CurrencyAmount' });

export type CurrencyAmount = z.infer<typeof currencyAmountSchema>;

/**
 * A project's figures (S13 "Reports"), read from the ledger: revenue, costs and profit in the book
 * currency; received, expenses and wages, the same lines by their movement's kind; the project's net
 * cash; and what is owed each way, by currency.
 */
export const projectFiguresSchema = z
  .object({
    bookCurrency: currencyCodeSchema,
    revenueMinor: minorUnitsSchema,
    costsMinor: minorUnitsSchema,
    profitMinor: minorUnitsSchema,
    receivedMinor: minorUnitsSchema,
    expensesMinor: minorUnitsSchema,
    wagesMinor: minorUnitsSchema,
    netCashMinor: minorUnitsSchema,
    owedByUs: z.array(currencyAmountSchema),
    owedToUs: z.array(currencyAmountSchema),
    movementCount: z.int(),
  })
  .meta({ id: 'ProjectFigures' });

export type ProjectFigures = z.infer<typeof projectFiguresSchema>;

/** A project as listed and opened (S13 "Screens"). */
export const projectSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    client: namedRefSchema,
    startDate: z.iso.date(),
    state: projectStateSchema,
    contractValue: z
      .object({ amountMinor: minorUnitsSchema, currency: currencyCodeSchema })
      .nullable(),
    figures: projectFiguresSchema,
  })
  .meta({ id: 'Project' });

export type Project = z.infer<typeof projectSchema>;

/**
 * `POST /api/projects`: the name, the client (an existing one, or a new one by name), the start
 * date, and the contract's value with its currency, optional.
 */
export const createProjectSchema = z
  .object({
    name: nameSchema,
    clientId: z.uuid().nullable().default(null),
    clientName: nameSchema.nullable().default(null),
    startDate: z.iso.date(),
    contractValue: z
      .object({ amountMinor: positiveMinorSchema, currency: currencyCodeSchema })
      .nullable()
      .default(null),
  })
  .refine((input) => (input.clientId === null) !== (input.clientName === null), {
    message: 'An existing client or a new one',
    path: ['clientId'],
  })
  .meta({ id: 'CreateProject' });

export type CreateProject = z.infer<typeof createProjectSchema>;

/** `PATCH /api/projects/:id`: the name, start date or state; left out, unchanged. */
export const updateProjectSchema = z
  .object({
    name: nameSchema.optional(),
    startDate: z.iso.date().optional(),
    state: projectStateSchema.optional(),
  })
  .meta({ id: 'UpdateProject' });

export type UpdateProject = z.infer<typeof updateProjectSchema>;

export const projectQuerySchema = z
  .object({
    state: projectStateSchema.optional(),
    search: z.string().trim().min(1).max(100).optional(),
  })
  .meta({ id: 'ProjectQuery' });

export type ProjectQuery = z.infer<typeof projectQuerySchema>;

/** The kinds of party (S13 "Screens"): clients and suppliers. */
export const PARTY_TYPES = ['client', 'supplier'] as const;

export const partyTypeSchema = z.enum(PARTY_TYPES).meta({ id: 'PartyType' });

export type PartyType = z.infer<typeof partyTypeSchema>;

/** A client or a supplier with what it owes the company or is owed, by currency. */
export const partySchema = z
  .object({
    id: z.uuid(),
    type: partyTypeSchema,
    name: z.string(),
    projectCount: z.int(),
    owedToUs: z.array(currencyAmountSchema),
    owedByUs: z.array(currencyAmountSchema),
  })
  .meta({ id: 'Party' });

export type Party = z.infer<typeof partySchema>;

export const partyQuerySchema = z.object({ type: partyTypeSchema }).meta({ id: 'PartyQuery' });

export const createPartySchema = z
  .object({ type: partyTypeSchema, name: nameSchema })
  .meta({ id: 'CreateParty' });

export type CreateParty = z.infer<typeof createPartySchema>;

/** `GET /api/materials/costs`: over a range, for one project or all. */
export const materialCostQuerySchema = z
  .object({
    project: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .meta({ id: 'MaterialCostQuery' });

export type MaterialCostQuery = z.infer<typeof materialCostQuerySchema>;

/** A material's cost (S13 "Screens"): its quantity and cost in all, and per project. */
export const materialCostSchema = z
  .object({
    material: z.object({ id: z.uuid(), name: z.string(), unit: z.string() }),
    quantity: z.string(),
    bookMinor: minorUnitsSchema,
    byCurrency: z.array(currencyAmountSchema),
    byProject: z.array(
      z.object({ project: namedRefSchema, quantity: z.string(), bookMinor: minorUnitsSchema }),
    ),
  })
  .meta({ id: 'MaterialCost' });

export type MaterialCost = z.infer<typeof materialCostSchema>;

export const materialCostsSchema = z
  .object({
    bookCurrency: currencyCodeSchema,
    materials: z.array(materialCostSchema),
    totalBookMinor: minorUnitsSchema,
  })
  .meta({ id: 'MaterialCosts' });

export type MaterialCosts = z.infer<typeof materialCostsSchema>;

/** The day's rates (S13 "Currencies"): 1 USD in each other currency the company uses. */
export const dayRateSchema = z
  .object({
    base: currencyCodeSchema,
    quote: currencyCodeSchema,
    rate: rateValueSchema.nullable(),
    /** The day the rate in force was recorded for, or null with no rate yet. */
    effectiveOn: z.iso.date().nullable(),
  })
  .meta({ id: 'DayRate' });

export type DayRate = z.infer<typeof dayRateSchema>;

export const dayRatesSchema = z
  .object({ date: z.iso.date(), rates: z.array(dayRateSchema), missing: z.boolean() })
  .meta({ id: 'DayRates' });

export type DayRates = z.infer<typeof dayRatesSchema>;

/** `POST /api/rates/day`: the day's rates for one or more pairs, a correction with its reason. */
export const recordDayRatesSchema = z
  .object({
    date: z.iso.date(),
    rates: z
      .array(
        z.object({ base: currencyCodeSchema, quote: currencyCodeSchema, rate: rateValueSchema }),
      )
      .min(1)
      .max(4),
    reason: descriptionSchema.nullable().default(null),
  })
  .meta({ id: 'RecordDayRates' });

export type RecordDayRates = z.infer<typeof recordDayRatesSchema>;

/** The dashboard (S13 "Screens"): the company's figures, its boxes, today's rates and its lists. */
export const dashboardSchema = z
  .object({
    bookCurrency: currencyCodeSchema,
    projects: z.object({ active: z.int(), finished: z.int() }),
    figures: projectFiguresSchema,
    /** Realised exchange differences, the company's, outside project profit (S13 "Reports"). */
    exchangeDifferencesMinor: minorUnitsSchema,
    boxes: z.array(currencyAmountSchema),
    rates: dayRatesSchema,
    topProjects: z.array(
      z.object({
        project: namedRefSchema,
        profitMinor: minorUnitsSchema,
        netCashMinor: minorUnitsSchema,
      }),
    ),
    latestMovements: z.array(movementSchema),
    topMaterials: z.array(
      z.object({
        material: namedRefSchema,
        unit: z.string(),
        quantity: z.string(),
        bookMinor: minorUnitsSchema,
      }),
    ),
  })
  .meta({ id: 'Dashboard' });

export type Dashboard = z.infer<typeof dashboardSchema>;

/** The company's display name and whether it has a logo (S13 "Data", ADR 0024 §7). */
export const brandingSchema = z
  .object({ displayName: z.string(), hasLogo: z.boolean(), logoVersion: z.string().nullable() })
  .meta({ id: 'Branding' });

export type Branding = z.infer<typeof brandingSchema>;

export const updateBrandingSchema = z
  .object({ displayName: nameSchema })
  .meta({ id: 'UpdateBranding' });

export type UpdateBranding = z.infer<typeof updateBrandingSchema>;

/** The largest logo accepted (S13 "Data"): 1 MB, PNG or JPEG. */
export const LOGO_MAX_BYTES = 1024 * 1024;

export const LOGO_CONTENT_TYPES = ['image/png', 'image/jpeg'] as const;

export const movementParamsSchema = z.object({ id: z.uuid() }).meta({ id: 'MovementParams' });
