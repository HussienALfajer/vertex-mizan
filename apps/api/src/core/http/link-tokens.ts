import { createHash, randomBytes } from 'node:crypto';

/** The purposes of one-time tokens, stored as `<purpose>:<sha256>` in `verifications` (S01). */
export type TokenPurpose = 'invite' | 'reset' | 'totp-used';

/** A new link token: 32 random bytes, base64url (43 characters, `linkTokenSchema`). */
export function newLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The stored key of a token: its purpose and SHA-256, so the token itself is never stored. */
export function tokenIdentifier(purpose: TokenPurpose, token: string): string {
  return `${purpose}:${createHash('sha256').update(token).digest('hex')}`;
}

/** A link to the web app with the token in the fragment, which never reaches a server log. */
export function linkWithToken(appUrl: string, path: string, token: string): string {
  return `${appUrl}${path}#token=${token}`;
}
