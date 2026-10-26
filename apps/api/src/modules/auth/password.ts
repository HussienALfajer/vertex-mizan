import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

/** Argon2id at the OWASP minimum (S01 rule 4): 19 MiB, 2 passes, 1 lane, 32-byte tag. */
export const ARGON2_PARAMETERS = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };

interface Parameters {
  memory: number;
  passes: number;
  parallelism: number;
  tagLength: number;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

async function derive(password: string, salt: Buffer, parameters: Parameters): Promise<Buffer> {
  return argon2Async('argon2id', {
    message: Buffer.from(password, 'utf8'),
    nonce: salt,
    ...parameters,
  });
}

/** The PHC string of a new password: `$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, ARGON2_PARAMETERS);
  const { memory, passes, parallelism } = ARGON2_PARAMETERS;
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${b64(salt)}$${b64(hash)}`;
}

/** Whether `password` matches a stored PHC string, in constant time; false for a malformed one. */
export async function verifyPassword(input: { hash: string; password: string }): Promise<boolean> {
  const match = PHC.exec(input.hash);
  if (!match) return false;
  const [, memory, passes, parallelism, salt, expected] = match;
  const want = Buffer.from(expected ?? '', 'base64');
  const got = await derive(input.password, Buffer.from(salt ?? '', 'base64'), {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: want.length,
  });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A hash no password matches: checked when there is no account, so every answer costs the same. */
const DECOY = hashPassword(randomBytes(32).toString('base64url'));

/**
 * Spends the cost of one password check without an account: an unknown, locked or archived
 * account answers like a wrong password, after the same work (S01 rule 8).
 */
export async function verifyDecoy(password: string): Promise<false> {
  await verifyPassword({ hash: await DECOY, password });
  return false;
}
