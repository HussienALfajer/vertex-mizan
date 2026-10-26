import { createDatabase } from '@vertex-mizan/db';
import { loadConfig } from '../core/config/config.js';
import { parseResetTwoFactor, resetTwoFactorByVertex } from './commands.js';

// `pnpm --filter @vertex-mizan/api admin:reset-two-factor --email … --reason …` (S01 rule 21).
const config = loadConfig(process.env);
const db = createDatabase(config.databaseUrl);
try {
  await resetTwoFactorByVertex(db, parseResetTwoFactor(process.argv.slice(2)));
  process.stdout.write('Two-factor reset; sessions ended; the person was emailed.\n');
} finally {
  await db.$client.end();
}
