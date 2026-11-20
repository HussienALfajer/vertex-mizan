import { createDatabase } from '@vertex-mizan/db';
import { loadConfig } from '../core/config/config.js';
import { changeEmailByVertex, parseChangeEmail } from './commands.js';

// `pnpm --filter @vertex-mizan/api admin:change-email --from … --to … --reason …` (S01, owner
// 2026-11-20): a person's sign-in email, their books untouched.
const config = loadConfig(process.env);
const db = createDatabase(config.databaseUrl);
try {
  await changeEmailByVertex(db, parseChangeEmail(process.argv.slice(2)));
  process.stdout.write('Email changed; sessions ended; the password is unchanged.\n');
} finally {
  await db.$client.end();
}
