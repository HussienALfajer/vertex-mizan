import { createDatabase } from '@vertex-mizan/db';
import { loadConfig } from '../core/config/config.js';
import { createCompanyWithOwner, parseCreateCompany } from './commands.js';

// `pnpm --filter @vertex-mizan/api admin:create-company --name … --policy-note … --owner-email …`
// (S01 rule 9): a company and the invitation of its first owner, emailed through the outbox.
const config = loadConfig(process.env);
const db = createDatabase(config.databaseUrl);
try {
  const created = await createCompanyWithOwner(
    db,
    config.appUrl,
    parseCreateCompany(process.argv.slice(2)),
  );
  process.stdout.write(
    `Company ${created.companyId} created; invitation ${created.invitationId} queued.\n`,
  );
} finally {
  await db.$client.end();
}
