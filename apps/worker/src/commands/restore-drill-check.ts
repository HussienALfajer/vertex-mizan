import { createDatabase } from '@vertex-mizan/db';
import { loadConfig } from '../core/config/config.js';
import { checkRestore } from '../core/drill/restore-check.js';

// `pnpm --filter @vertex-mizan/worker drill:check --restored-port <port> --restored-at <ISO time>`
// (ADR 0020, `docs/operations/restore-drills.md`), after `pnpm build`, run by
// `deploy/bin/mizan-restore-drill` with production's `.env`: the restore in the temporary cluster on
// `<port>` (the same roles and passwords, restored with it) checked company by company against
// production. One line per company, then `restore drill: ok` or `restore drill: FAILED`; the exit
// code is 1 on any problem. Read-only on both sides.
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const port = option('--restored-port');
const at = option('--restored-at');
const maxAgeHours = Number(option('--max-age-hours') ?? '26');
if (port === undefined || !/^\d{2,5}$/.test(port)) throw new RangeError('Expected --restored-port');
if (at === undefined || Number.isNaN(Date.parse(at)))
  throw new RangeError('Expected --restored-at');

const config = loadConfig(process.env);
const onPort = (url: string) => {
  const restored = new URL(url);
  restored.port = port;
  return restored.href;
};
const databases = {
  production: createDatabase(config.appDatabaseUrl),
  productionJobs: createDatabase(config.jobsDatabaseUrl),
  restored: createDatabase(onPort(config.appDatabaseUrl)),
  restoredJobs: createDatabase(onPort(config.jobsDatabaseUrl)),
};
try {
  const result = await checkRestore(databases, new Date(at), new Date(), maxAgeHours * 3_600_000);
  for (const company of result.companies) {
    const status = company.problems.length === 0 ? 'ok' : 'FAILED';
    process.stdout.write(
      `${status} company ${company.companyId}: ${company.entryCount} entries, head ${company.headSequence ?? 'none'}\n`,
    );
    for (const problem of company.problems) process.stdout.write(`  ${problem}\n`);
  }
  for (const problem of result.problems) process.stdout.write(`FAILED ${problem}\n`);
  process.stdout.write(`restore drill: ${result.ok ? 'ok' : 'FAILED'}\n`);
  process.exitCode = result.ok ? 0 : 1;
} finally {
  await Promise.all(Object.values(databases).map((db) => db.$client.end()));
}
