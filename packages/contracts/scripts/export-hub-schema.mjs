// The contracts of Hub's API as JSON Schema for Hub's developers (S05 "API"):
// `pnpm --filter @vertex-mizan/contracts export:hub-schema` after `pnpm build` writes
// `dist/hub-schema/events-v1.schema.json` (the envelope with every payload, the answer and the
// periods' status) and `dist/hub-schema/examples-v1.json` (one event of every type, in the order
// they post). Both come from the Zod schemas the API validates with, so they never drift.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  eventEnvelopeSchema,
  eventExamplesV1,
  eventOutcomeSchema,
  periodStatusQuerySchema,
  periodStatusSchema,
} from '../dist/index.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'hub-schema');
const options = { target: 'draft-2020-12', unrepresentable: 'throw' };
const bundle = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Vertex Mizan /v1 for Vertex Hub',
  description:
    'POST /v1/events takes an EventEnvelope with Idempotency-Key equal to its id and answers an EventOutcome (201 posted or recorded, 202 held); GET /v1/periods/status takes a PeriodStatusQuery and answers PeriodStatus items. A client accepts a status, reason or detail it does not know (ADR 0006).',
  request: z.toJSONSchema(eventEnvelopeSchema, { ...options, io: 'input' }),
  answer: z.toJSONSchema(eventOutcomeSchema, { ...options, io: 'output' }),
  periodStatusQuery: z.toJSONSchema(periodStatusQuerySchema, { ...options, io: 'input' }),
  periodStatus: z.toJSONSchema(z.array(periodStatusSchema), { ...options, io: 'output' }),
};
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'events-v1.schema.json'), `${JSON.stringify(bundle, null, 2)}\n`);
writeFileSync(
  join(out, 'examples-v1.json'),
  `${JSON.stringify(eventExamplesV1('2026-11-02'), null, 2)}\n`,
);
process.stdout.write(`Wrote ${join(out, 'events-v1.schema.json')} and examples-v1.json\n`);
