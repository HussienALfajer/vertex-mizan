// Posts one event of every type to a running API as Hub would (S05 "API"), dated today in
// Damascus or `--date YYYY-MM-DD`, then (S08) the daily report of that date listing them, and
// prints each answer: `MIZAN_API_KEY=<a client's key> pnpm --filter @vertex-mizan/contracts
// post:hub-examples [--date YYYY-MM-DD] [--no-report]` after `pnpm build`, against `MIZAN_API_URL`
// (default the local API, http://127.0.0.1:3300). The report needs the key's
// `reconciliation:write`; `--no-report` skips it. The key comes from the environment only, never
// an argument, so it stays out of the shell history. For a development database: its events post.
// S10: `--opening [--books-start YYYY-MM-DD]` first posts the example opening snapshot as of the
// eve of the books start (2026-10-01 by default) to `POST /v1/opening/snapshot`, with the key's
// `opening:write`; until the opening posts, the events then answer `503 OPENING_NOT_POSTED`.
import { parseArgs } from 'node:util';
import {
  eventExamplesV1,
  openingSnapshotExampleV1,
  openingSnapshotKeyV1,
  reconciliationExampleV1,
} from '../dist/index.js';

const { values: options } = parseArgs({
  options: {
    date: { type: 'string' },
    'no-report': { type: 'boolean', default: false },
    opening: { type: 'boolean', default: false },
    'books-start': { type: 'string', default: '2026-10-01' },
  },
});

const url = process.env.MIZAN_API_URL ?? 'http://127.0.0.1:3300';
const key = process.env.MIZAN_API_KEY;
if (!key) {
  process.stderr.write('Set MIZAN_API_KEY to an API client key of the company to post to.\n');
  process.exit(1);
}
const today =
  options.date ??
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
  process.stderr.write('--date takes a date as YYYY-MM-DD.\n');
  process.exit(1);
}
let failed = false;
if (options.opening) {
  const booksStart = options['books-start'];
  if (!/^\d{4}-\d{2}-01$/.test(booksStart)) {
    process.stderr.write('--books-start takes the first day of a month as YYYY-MM-DD.
');
    process.exit(1);
  }
  const response = await fetch(`${url}/v1/opening/snapshot`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'idempotency-key': openingSnapshotKeyV1(booksStart),
    },
    body: JSON.stringify(openingSnapshotExampleV1(booksStart)),
  });
  const body = await response.json();
  const summary = body.snapshot_id
    ? `${body.replayed ? 'replayed' : 'stored'} as of ${body.as_of}`
    : body.code;
  process.stdout.write(`${response.status} opening snapshot: ${summary}
`);
  if (response.status >= 400) failed = true;
}
for (const event of eventExamplesV1(today)) {
  const response = await fetch(`${url}/v1/events`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'idempotency-key': event.id,
    },
    body: JSON.stringify(event),
  });
  const body = await response.json();
  const summary = body.status === 'held' ? `held ${body.reason}` : (body.status ?? body.code);
  process.stdout.write(`${response.status} ${event.type}: ${summary}\n`);
  if (response.status >= 400) failed = true;
}
if (!options['no-report']) {
  const report = reconciliationExampleV1(today);
  const response = await fetch(`${url}/v1/reconciliation/daily`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'idempotency-key': report.id,
    },
    body: JSON.stringify(report),
  });
  const body = await response.json();
  const summary = body.status ? `${body.status}, ${body.gaps} gaps` : body.code;
  process.stdout.write(`${response.status} reconciliation report ${today}: ${summary}\n`);
  if (response.status >= 400) failed = true;
}
process.exit(failed ? 1 : 0);
