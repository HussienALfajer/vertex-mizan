import { createDatabase } from '@vertex-mizan/db';
import { todayInDamascus } from '../core/clock/today.js';
import { loadConfig } from '../core/config/config.js';
import { runMonth } from '../jobs/revenue/release-month.job.js';

// `pnpm --filter @vertex-mizan/worker revenue:run-release --month YYYY-MM` (S06 "Acceptance"),
// after `pnpm build`: one ended month's releases in every company, as the job posts them, with the
// root `.env`. The month must have ended in Damascus; a second run posts nothing.
const args = process.argv.slice(2);
const index = args.indexOf('--month');
const month = index === -1 ? undefined : args[index + 1];
if (month === undefined) throw new RangeError('Expected --month YYYY-MM');
const config = loadConfig(process.env);
const db = createDatabase(config.appDatabaseUrl);
const jobs = createDatabase(config.jobsDatabaseUrl);
try {
  const run = await runMonth(jobs, db, month, todayInDamascus());
  process.stdout.write(
    `${month}: ${run.posted} release entries posted in ${run.companies} companies, ${run.refused} left missing.\n`,
  );
} finally {
  await Promise.all([db.$client.end(), jobs.$client.end()]);
}
