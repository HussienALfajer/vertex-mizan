import { z } from 'zod';

/** An opening's states (S10 "Data"): one live opening per company, `draft` then `posted`. */
export const OPENING_STATES = ['draft', 'posted', 'reversed'] as const;

export const openingStateSchema = z.enum(OPENING_STATES).meta({ id: 'OpeningState' });

export type OpeningState = z.infer<typeof openingStateSchema>;
