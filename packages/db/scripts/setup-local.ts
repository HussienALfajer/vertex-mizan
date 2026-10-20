// Prepares a local PostgreSQL 17 for Vertex Mizan: creates or updates the four roles, then the
// development database owned by the owner role (ADR 0003, ADR 0008; packages/db/CLAUDE.md, Roles):
// - mizan_owner: runs migrations and owns every object; may create the throwaway test databases;
// - mizan_app: what the API and the worker connect as; cannot bypass RLS;
// - mizan_jobs: the worker's cross-company jobs; cannot bypass RLS, every statement it runs is
//   logged without its values;
// - mizan_queue: pg-boss, in its own schema only.
// No role is a member of another: the script stops if it finds a membership. It is safe to run
// again: it only creates what is missing and resets the roles' passwords and attributes. It never
// drops anything and does not migrate (`pnpm db:migrate` does).
// Run from the repository root: `pnpm db:setup-local`, with the five URLs of .env.example in .env
// or the environment. Local machines and CI only: servers get their roles from the deployment.
import pg from 'pg';

const ROLES = {
  DATABASE_OWNER_URL: {
    name: 'mizan_owner',
    attributes: 'NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOREPLICATION CREATEDB',
  },
  DATABASE_APP_URL: {
    name: 'mizan_app',
    attributes: 'NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOREPLICATION NOCREATEDB NOINHERIT',
  },
  DATABASE_JOBS_URL: {
    name: 'mizan_jobs',
    attributes: 'NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOREPLICATION NOCREATEDB NOINHERIT',
  },
  DATABASE_QUEUE_URL: {
    name: 'mizan_queue',
    attributes: 'NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOREPLICATION NOCREATEDB NOINHERIT',
  },
} as const;

function url(name: string): URL {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: copy .env.example to .env and fill it in`);
  return new URL(value);
}

const admin = url('DATABASE_ADMIN_URL');
const roles = Object.entries(ROLES).map(([variable, role]) => ({
  ...role,
  variable,
  url: url(variable),
}));
const database = decodeURIComponent(url('DATABASE_OWNER_URL').pathname.slice(1));

if (!database) throw new Error('DATABASE_OWNER_URL must name the database');
for (const role of roles) {
  if (decodeURIComponent(role.url.username) !== role.name) {
    throw new Error(`${role.variable} must use the role ${role.name}`);
  }
  if (decodeURIComponent(role.url.pathname.slice(1)) !== database) {
    throw new Error('The owner, app, jobs and queue URLs must name the same database');
  }
}

const client = new pg.Client({ connectionString: admin.href });
await client.connect();
try {
  const { rows } = await client.query<{ version: number }>(
    "select current_setting('server_version_num')::int as version",
  );
  // The servers run PostgreSQL 17 (ADR 0008); the local database matches them.
  if (Math.floor((rows[0]?.version ?? 0) / 10_000) !== 17) {
    throw new Error('PostgreSQL 17 is required (docker compose up -d starts it)');
  }

  for (const role of roles) {
    const exists = await client.query('select 1 from pg_roles where rolname = $1', [role.name]);
    const verb = exists.rowCount ? 'ALTER' : 'CREATE';
    await client.query(
      `${verb} ROLE ${client.escapeIdentifier(role.name)} WITH LOGIN ${role.attributes} PASSWORD ${client.escapeLiteral(decodeURIComponent(role.url.password))}`,
    );
    process.stdout.write(`${verb === 'CREATE' ? 'created' : 'updated'} role ${role.name}\n`);
  }

  // No role is a member of another (ADR 0003), so none can switch to a role with more rights.
  const memberships = await client.query<{ member: string; role: string }>(
    `select pg_get_userbyid(member) as member, pg_get_userbyid(roleid) as role
     from pg_auth_members
     where pg_get_userbyid(member) = any($1) or pg_get_userbyid(roleid) = any($1)`,
    [roles.map((role) => role.name)],
  );
  if (memberships.rowCount) {
    const list = memberships.rows.map((m) => `${m.member} in ${m.role}`).join(', ');
    throw new Error(`No role may be a member of another (ADR 0003); revoke: ${list}`);
  }

  // The audit of the jobs role (ADR 0003): every statement it runs goes to the server log, without
  // its parameter values, which carry company data. Only a superuser may change either setting, so
  // its sessions cannot turn this off.
  await client.query(`ALTER ROLE ${ROLES.DATABASE_JOBS_URL.name} SET log_statement = 'all'`);
  await client.query(`ALTER ROLE ${ROLES.DATABASE_JOBS_URL.name} SET log_parameter_max_length = 0`);

  const existing = await client.query<{ owner: string }>(
    'select pg_get_userbyid(datdba) as owner from pg_database where datname = $1',
    [database],
  );
  const owner = ROLES.DATABASE_OWNER_URL.name;
  const current = existing.rows[0];
  if (!current) {
    await client.query(
      `CREATE DATABASE ${client.escapeIdentifier(database)} OWNER ${owner} ENCODING 'UTF8' TEMPLATE template0`,
    );
    process.stdout.write(`created database ${database}\n`);
  } else if (current.owner !== owner) {
    throw new Error(`Database ${database} exists and belongs to ${current.owner}, not ${owner}`);
  } else {
    process.stdout.write(`database ${database} exists\n`);
  }
} finally {
  await client.end();
}
