import { createDatabase } from '@vertex-mizan/db';
import { loadConfig } from '../core/config/config.js';
import { createAccountWithCompany, parseCreateAccount } from './commands.js';

// `pnpm --filter @vertex-mizan/api admin:create-account --email … --person-name … --name …
// --policy-note …` (S01 rules 2 and 9, owner 2026-11-16): an exempt person with a generated
// password, their company and their owner membership, with no invitation. The password is printed
// here once, for Vertex to hand to the client; nothing else keeps it.
const config = loadConfig(process.env);
const db = createDatabase(config.databaseUrl);
try {
  const created = await createAccountWithCompany(db, parseCreateAccount(process.argv.slice(2)));
  process.stdout.write(
    [
      `Company ${created.companyId} created, owned by person ${created.personId}.`,
      'Sign-in: email and password, no two-factor until the person enrols.',
      `Password (shown once): ${created.password}`,
      '',
    ].join('\n'),
  );
} finally {
  await db.$client.end();
}
