import { createHash, randomBytes } from 'node:crypto';
import {
  API_KEY_PREFIX,
  API_KEY_SECRET_LENGTH,
  API_KEY_SHOWN_LENGTH,
} from '@vertex-mizan/contracts';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** The SHA-256 of a whole key, as `api_client_keys.secret_hash` keeps it. */
export const secretHashOf = (key: string): string =>
  createHash('sha256').update(key, 'utf8').digest('hex');

/**
 * A new key (S05 "Data"): `mzn_` and 40 base62 characters from the CSPRNG (238 bits), each byte
 * kept only below 248 (4 × 62), so every character is equally likely. Only the hash and the prefix
 * are stored; the key itself is answered once.
 */
export function newApiKey(): { key: string; prefix: string; secretHash: string } {
  let secret = '';
  while (secret.length < API_KEY_SECRET_LENGTH) {
    for (const byte of randomBytes(API_KEY_SECRET_LENGTH)) {
      if (byte < 248 && secret.length < API_KEY_SECRET_LENGTH) secret += BASE62[byte % 62];
    }
  }
  const key = `${API_KEY_PREFIX}${secret}`;
  return {
    key,
    prefix: key.slice(0, API_KEY_PREFIX.length + API_KEY_SHOWN_LENGTH),
    secretHash: secretHashOf(key),
  };
}

/** A client address as PostgreSQL's `inet` compares it: an IPv4-mapped IPv6 address as IPv4. */
export function clientAddress(ip: string | null): string | null {
  if (!ip) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return mapped?.[1] ?? ip;
}
