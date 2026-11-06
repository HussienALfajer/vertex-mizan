import { z } from 'zod';

/**
 * Open items behind the control accounts (S04, ADR 0013): the item kind of a control account,
 * where an item comes from, the kinds of its movements and who set a due date. The item tables are
 * `packages/db`'s `open-items` module; the item lines are `packages/ledger`'s `itemLines()`.
 */

/**
 * The item kind of a control account (ADR 0013): `document`, one item per invoice or document,
 * opened once and cleared toward zero; `running`, one item per client and currency, carried at
 * its average and allowed to cross zero (ADR 0007).
 */
export const ITEM_KINDS = ['document', 'running'] as const;

export const itemKindSchema = z.enum(ITEM_KINDS).meta({ id: 'ItemKind' });

export type ItemKind = z.infer<typeof itemKindSchema>;

/** Where an item comes from: a manual line, a Hub event (S05) or the opening balances (S10). */
export const ITEM_SOURCES = ['manual', 'hub_event', 'opening'] as const;

export type ItemSource = (typeof ITEM_SOURCES)[number];

/**
 * The kinds of an item's movement: `open`, a document item's opening; `add`, a new measurement on
 * a running item; `clear`, a carried clearing; `difference`, a running void's exchange difference
 * (S04 rule 13). S07 appends `revaluation`.
 */
export const MOVEMENT_KINDS = ['open', 'add', 'clear', 'difference'] as const;

export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/** Who set a document item's due date: the opening, a person (S04 rule 15) or a Hub event (S05). */
export const DUE_DATE_SETTERS = ['opening', 'user', 'hub_event'] as const;

export type DueDateSetter = (typeof DUE_DATE_SETTERS)[number];

/** A manual item's reference, or Hub's document number: 1–100 characters after trimming. */
export const itemReferenceSchema = z.string().trim().min(1).max(100);
