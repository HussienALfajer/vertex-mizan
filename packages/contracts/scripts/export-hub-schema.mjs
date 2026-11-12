// The contracts of Hub's API as JSON Schema for Hub's developers (S05 "API"):
// `pnpm --filter @vertex-mizan/contracts export:hub-schema` after `pnpm build` writes
// `dist/hub-schema/events-v1.schema.json` (the envelope with every payload, the answer and the
// periods' status; S08: the daily report, its answer and the received events), `dist/hub-schema/
// examples-v1.json` (one event of every type, in the order they post) and `dist/hub-schema/
// reconciliation-example-v1.json` (the daily report listing those examples); S10: the opening
// snapshot and its answer in the bundle, and `dist/hub-schema/opening-snapshot-example-v1.json`
// (the example snapshot for a books start on 2026-10-01). All come from the
// Zod schemas the API validates with, so they never drift.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  eventEnvelopeSchema,
  eventExamplesV1,
  eventOutcomeSchema,
  openingSnapshotExampleV1,
  openingSnapshotResultSchema,
  openingSnapshotSchema,
  periodStatusQuerySchema,
  periodStatusSchema,
  receivedEventsPageSchema,
  receivedEventsQuerySchema,
  reconciliationExampleV1,
  reconciliationReportSchema,
  reconciliationResultSchema,
} from '../dist/index.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'hub-schema');
const options = { target: 'draft-2020-12', unrepresentable: 'throw' };
const bundle = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Vertex Mizan /v1 for Vertex Hub',
  description:
    'POST /v1/events takes an EventEnvelope with Idempotency-Key equal to its id and answers an EventOutcome (201 posted or recorded, 202 held); GET /v1/periods/status takes a PeriodStatusQuery and answers PeriodStatus items. POST /v1/reconciliation/daily takes a ReconciliationReport with Idempotency-Key equal to its id and answers a ReconciliationResult (201 stored, 200 a replay); GET /v1/events takes a ReceivedEventsQuery and answers a ReceivedEventsPage (S08). POST /v1/opening/snapshot takes an OpeningSnapshot as of the eve of the books start with Idempotency-Key as its key and answers an OpeningSnapshotResult (201 stored, 200 a replay); before the opening posts, POST /v1/events answers 503 OPENING_NOT_POSTED with Retry-After (S10). A client accepts a status, reason, detail or kind it does not know (ADR 0006).',
  request: z.toJSONSchema(eventEnvelopeSchema, { ...options, io: 'input' }),
  answer: z.toJSONSchema(eventOutcomeSchema, { ...options, io: 'output' }),
  periodStatusQuery: z.toJSONSchema(periodStatusQuerySchema, { ...options, io: 'input' }),
  periodStatus: z.toJSONSchema(z.array(periodStatusSchema), { ...options, io: 'output' }),
  reconciliationReport: z.toJSONSchema(reconciliationReportSchema, { ...options, io: 'input' }),
  reconciliationResult: z.toJSONSchema(reconciliationResultSchema, { ...options, io: 'output' }),
  receivedEventsQuery: z.toJSONSchema(receivedEventsQuerySchema, { ...options, io: 'input' }),
  receivedEventsPage: z.toJSONSchema(receivedEventsPageSchema, { ...options, io: 'output' }),
  openingSnapshot: z.toJSONSchema(openingSnapshotSchema, { ...options, io: 'input' }),
  openingSnapshotResult: z.toJSONSchema(openingSnapshotResultSchema, { ...options, io: 'output' }),
};
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'events-v1.schema.json'), `${JSON.stringify(bundle, null, 2)}\n`);
writeFileSync(
  join(out, 'examples-v1.json'),
  `${JSON.stringify(eventExamplesV1('2026-11-02'), null, 2)}\n`,
);
writeFileSync(
  join(out, 'reconciliation-example-v1.json'),
  `${JSON.stringify(reconciliationExampleV1('2026-11-02'), null, 2)}\n`,
);
writeFileSync(
  join(out, 'opening-snapshot-example-v1.json'),
  `${JSON.stringify(openingSnapshotExampleV1('2026-10-01'), null, 2)}\n`,
);
process.stdout.write(
  `Wrote ${join(out, 'events-v1.schema.json')}, examples-v1.json, reconciliation-example-v1.json and opening-snapshot-example-v1.json\n`,
);
