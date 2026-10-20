import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { describeForLog } from './describe-for-log.js';
import * as schema from './schema/index.js';

/**
 * The roles the application connects as (ADR 0003, ADR 0008): `mizan_app` for the API and the
 * worker, `mizan_jobs` for the worker's cross-company jobs. The owner role only runs migrations: it
 * owns the tables, so it could disable their triggers. pg-boss connects as `mizan_queue` with its
 * own pool, never through this one.
 */
export const RUNTIME_ROLES = ['mizan_app', 'mizan_jobs'] as const;

export type RuntimeRole = (typeof RUNTIME_ROLES)[number];

/**
 * The deadlines of every pooled connection, in milliseconds. A connection that does not open in
 * time fails; the session settings are sent at connection start, so they bind whichever role the
 * URL names: a statement is cancelled (57014), a lock wait gives up (55P03) and a transaction left
 * idle is ended by the server. Each error rolls the transaction back.
 */
export const DATABASE_DEADLINES = {
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  lock_timeout: 5_000,
  idle_in_transaction_session_timeout: 30_000,
} as const;

/** The runtime role a connection URL names, or an error for any other role. */
function runtimeRole(connectionString: string): RuntimeRole {
  const url = new URL(connectionString);
  // node-postgres lets a `user` query parameter override the URL's user.
  if (url.searchParams.has('user')) {
    throw new Error('The connection URL names its role as its user, not in a query parameter');
  }
  const user = decodeURIComponent(url.username);
  const role = RUNTIME_ROLES.find((name) => name === user);
  if (!role) {
    throw new Error(
      `The application connects as ${RUNTIME_ROLES.join(' or ')}, never as ` +
        `${user ? `"${user}"` : 'an unnamed role'} (ADR 0008)`,
    );
  }
  return role;
}

/**
 * A Drizzle database over a node-postgres pool for one runtime role, named by the URL's user:
 * `mizan_app` or `mizan_jobs`; any other role, the owner included, is refused. Neither can bypass
 * row-level security, so company data is reached only through `withCompany`.
 */
export function createDatabase(connectionString: string) {
  runtimeRole(connectionString);
  const pool = new pg.Pool({ connectionString, ...DATABASE_DEADLINES });
  // A connection can be lost while idle in the pool or while checked out between two queries of
  // a transaction (a server restart, an administrator's termination, the idle-in-transaction
  // deadline). Either way the client emits `error`; unheard, it would end the process. So every
  // client gets a listener for its whole life: a held client's next query then fails, which rolls
  // its transaction back, and the pool drops it and opens a new one. The message can quote
  // values, so only its code is logged.
  pool.on('connect', (client) => {
    client.on('error', (error) => {
      console.error(`Database connection lost: ${describeForLog(error)}`);
    });
  });
  // The pool re-emits an idle client's error, already logged by the client's own listener.
  pool.on('error', () => {});
  return drizzle({ client: pool, schema, casing: 'snake_case' });
}

export type Database = ReturnType<typeof createDatabase>;

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
