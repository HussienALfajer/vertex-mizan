// Posts one event of every type to a running API as Hub would (S05 "API"), dated today in
// Damascus, and prints each answer: `MIZAN_API_KEY=<a client's key> pnpm --filter
// @vertex-mizan/contracts post:hub-examples` after `pnpm build`, against `MIZAN_API_URL`
// (default the local API, http://127.0.0.1:3300). The key comes from the environment only, never
// an argument, so it stays out of the shell history. For a development database: its events post.
import { eventExamplesV1 } from '../dist/index.js';

const url = process.env.MIZAN_API_URL ?? 'http://127.0.0.1:3300';
const key = process.env.MIZAN_API_KEY;
if (!key) {
  process.stderr.write('Set MIZAN_API_KEY to an API client key of the company to post to.\n');
  process.exit(1);
}
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(new Date());
let failed = false;
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
process.exit(failed ? 1 : 0);
