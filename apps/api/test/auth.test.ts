import type { INestApplication } from '@nestjs/common';
import {
  type Database,
  emailOutbox,
  platformAuditEntries,
  sessions,
  twoFactors,
  users,
} from '@vertex-mizan/db';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { Browser } from './browser.js';
import {
  createPerson,
  enrol,
  freshCode,
  reauthenticate,
  signedInPerson,
  signIn,
  testDatabase,
} from './people.js';

// Sign-in, two-factor, sessions and the account routes (S01 rules 1–8). All people are synthetic.

let app: INestApplication;
let db: Database;

beforeAll(async () => {
  app = await createTestApp();
  db = testDatabase();
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

async function actions(userId: string): Promise<string[]> {
  const rows = await db
    .select({ action: platformAuditEntries.action })
    .from(platformAuditEntries)
    .where(eq(platformAuditEntries.actorUserId, userId))
    .orderBy(platformAuditEntries.createdAt, platformAuditEntries.id);
  return rows.map((row) => row.action);
}

describe('sign-in', () => {
  it('gives a person not yet enrolled a session that reaches enrolment only', async () => {
    const person = await createPerson(db);
    const browser = new Browser(app);
    const first = await browser.post('/api/auth/sign-in/email', {
      email: person.email.toUpperCase(),
      password: person.password,
    });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ twoFactorRequired: false });
    // The token lives only in the cookie: __Host-, Secure, HttpOnly, SameSite=Strict.
    const cookie = (first.headers['set-cookie'] as unknown as string[]).find((line) =>
      line.startsWith('__Host-mizan.session_token='),
    );
    expect(cookie).toMatch(/; Path=\//);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; SameSite=Strict/i);
    expect(cookie).not.toMatch(/Domain=/i);

    const me = await browser.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.person).toMatchObject({ id: person.id, twoFactorEnabled: false });
    expect((await browser.get('/api/me/sign-ins')).body.code).toBe('TWO_FACTOR_REQUIRED');
    const create = await browser.post('/api/companies', {});
    expect(create.status).toBe(403);
    expect(create.body.code).toBe('TWO_FACTOR_REQUIRED');
  });

  it('asks an enrolled person for a code before any session exists', async () => {
    const { person } = await signedInPerson(app, db);
    const browser = new Browser(app);
    const first = await browser.post('/api/auth/sign-in/email', {
      email: person.email,
      password: person.password,
    });
    expect(first.body).toEqual({ twoFactorRequired: true });
    expect((await browser.get('/api/me')).body.code).toBe('UNAUTHENTICATED');
    const wrong = await browser.post('/api/auth/two-factor/verify-totp', { code: '000000' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_TWO_FACTOR_CODE');
    const right = await browser.post('/api/auth/two-factor/verify-totp', {
      code: await freshCode(person),
    });
    expect(right.status).toBe(204);
    expect(right.text).toBe('');
    expect((await browser.get('/api/me')).body.person.twoFactorEnabled).toBe(true);
    expect(await actions(person.id)).toEqual(
      expect.arrayContaining(['user.two_factor_enrolled', 'user.sign_in_failed', 'user.signed_in']),
    );
  });

  it('answers a wrong password, an unknown email and an archived person alike', async () => {
    const person = await createPerson(db);
    const archived = await createPerson(db);
    await db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, archived.id));
    const browser = new Browser(app);
    for (const attempt of [
      { email: person.email, password: 'wrong password!' },
      { email: 'nobody@example.test', password: person.password },
      { email: archived.email, password: archived.password },
    ]) {
      const response = await browser.post('/api/auth/sign-in/email', attempt);
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
    }
    const failed = await db
      .select({ email: platformAuditEntries.email })
      .from(platformAuditEntries)
      .where(eq(platformAuditEntries.action, 'user.sign_in_failed'));
    expect(failed.map((row) => row.email)).toEqual(
      expect.arrayContaining([person.email, 'nobody@example.test', archived.email]),
    );
  });

  it('locks an email after 10 failures, even for the right password', async () => {
    const person = await createPerson(db);
    for (let attempt = 0; attempt < 10; attempt++) {
      // A new address each time: the per-IP limit is not what locks it.
      const response = await new Browser(app).post('/api/auth/sign-in/email', {
        email: person.email,
        password: 'wrong password!',
      });
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    }
    const right = await new Browser(app).post('/api/auth/sign-in/email', {
      email: person.email,
      password: person.password,
    });
    expect(right.status).toBe(401);
    expect(right.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('allows 20 sign-in attempts per address per minute', async () => {
    const browser = new Browser(app);
    const answers: number[] = [];
    for (let attempt = 0; attempt < 21; attempt++) {
      const response = await browser.post('/api/auth/sign-in/email', {
        email: `guess.${attempt}@example.test`,
        password: 'wrong password!',
      });
      answers.push(response.status);
    }
    expect(answers.slice(0, 20).every((status) => status === 401)).toBe(true);
    const last = await browser.post('/api/auth/sign-in/email', {
      email: 'guess.last@example.test',
      password: 'wrong password!',
    });
    expect(last.status).toBe(429);
    expect(last.body.code).toBe('RATE_LIMITED');
  });

  it('locks the second step after 5 wrong codes', async () => {
    const { person } = await signedInPerson(app, db);
    const browser = new Browser(app);
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt === 0 || attempt === 4) {
        await browser.post('/api/auth/sign-in/email', {
          email: person.email,
          password: person.password,
        });
      }
      await browser.post('/api/auth/two-factor/verify-totp', { code: '000000' });
    }
    await browser.post('/api/auth/sign-in/email', {
      email: person.email,
      password: person.password,
    });
    const locked = await browser.post('/api/auth/two-factor/verify-totp', {
      code: await freshCode(person),
    });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('RATE_LIMITED');
    const [row] = await db
      .select({ lockedUntil: twoFactors.lockedUntil })
      .from(twoFactors)
      .where(eq(twoFactors.userId, person.id));
    expect(row?.lockedUntil?.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  });

  it('accepts an authenticator code once', async () => {
    const { person } = await signedInPerson(app, db);
    const code = await freshCode(person);
    const first = new Browser(app);
    await first.post('/api/auth/sign-in/email', { email: person.email, password: person.password });
    expect((await first.post('/api/auth/two-factor/verify-totp', { code })).status).toBe(204);
    const second = new Browser(app);
    await second.post('/api/auth/sign-in/email', {
      email: person.email,
      password: person.password,
    });
    const replay = await second.post('/api/auth/two-factor/verify-totp', { code });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('INVALID_TWO_FACTOR_CODE');
  });

  it('signs in with a backup code once, and records its use', async () => {
    const { person } = await signedInPerson(app, db);
    const [code] = person.backupCodes;
    if (!code) throw new Error('no backup code');
    const browser = new Browser(app);
    await browser.post('/api/auth/sign-in/email', {
      email: person.email,
      password: person.password,
    });
    expect((await browser.post('/api/auth/two-factor/verify-backup-code', { code })).status).toBe(
      204,
    );
    const again = new Browser(app);
    await again.post('/api/auth/sign-in/email', { email: person.email, password: person.password });
    const reused = await again.post('/api/auth/two-factor/verify-backup-code', { code });
    expect(reused.body.code).toBe('INVALID_TWO_FACTOR_CODE');
    expect(await actions(person.id)).toContain('user.backup_code_used');
  });

  it('offers no other Better Auth route', async () => {
    const browser = new Browser(app);
    for (const path of [
      '/api/auth/sign-up/email',
      '/api/auth/two-factor/disable',
      '/api/auth/list-sessions',
      '/api/auth/get-session',
    ]) {
      const response = await browser.post(path, {});
      expect(response.status, path).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    }
  });

  it('refuses a write from another origin', async () => {
    const response = await new Browser(app).post(
      '/api/auth/sign-in/email',
      { email: 'a@example.test', password: 'x' },
      { origin: 'https://evil.example.test' },
    );
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('answers 422 with the failed fields for a malformed body', async () => {
    const response = await new Browser(app).post('/api/auth/sign-in/email', { email: 'nope' });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.issues.map((issue: { path: string[] }) => issue.path[0])).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });
});

describe('sessions', () => {
  it('end after 30 minutes without a request', async () => {
    const { browser, person } = await signedInPerson(app, db);
    await db
      .update(sessions)
      .set({ lastActiveAt: new Date(Date.now() - 31 * 60 * 1000) })
      .where(eq(sessions.userId, person.id));
    expect((await browser.get('/api/me')).body.code).toBe('UNAUTHENTICATED');
    expect(await db.select().from(sessions).where(eq(sessions.userId, person.id))).toEqual([]);
  });

  it('end 12 hours after sign-in, without renewal', async () => {
    const { person } = await signedInPerson(app, db);
    const [session] = await db
      .select({ createdAt: sessions.createdAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.userId, person.id));
    if (!session) throw new Error('no session');
    const lifetime = session.expiresAt.getTime() - session.createdAt.getTime();
    expect(Math.abs(lifetime - 12 * 60 * 60 * 1000)).toBeLessThan(5_000);
  });

  it('end at sign-out', async () => {
    const { browser, person } = await signedInPerson(app, db);
    expect((await browser.post('/api/auth/sign-out')).status).toBe(204);
    expect((await browser.get('/api/me')).status).toBe(401);
    expect(await actions(person.id)).toContain('user.signed_out');
  });

  it('open sensitive actions for 5 minutes after a fresh code', async () => {
    const { browser, person } = await signedInPerson(app, db);
    await db
      .update(sessions)
      .set({ reauthenticatedAt: new Date(Date.now() - 6 * 60 * 1000) })
      .where(eq(sessions.userId, person.id));
    const stale = await browser.post('/api/auth/two-factor/generate-backup-codes');
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe('REAUTHENTICATION_REQUIRED');
    const wrong = await browser.post('/api/auth/reauthenticate', { code: '000000' });
    expect(wrong.body.code).toBe('INVALID_TWO_FACTOR_CODE');
    await reauthenticate(browser, person);
    const fresh = await browser.post('/api/auth/two-factor/generate-backup-codes');
    expect(fresh.status).toBe(200);
    expect(fresh.body.backupCodes).toHaveLength(10);
    expect(fresh.body.backupCodes).not.toEqual(person.backupCodes);
    expect(await actions(person.id)).toContain('user.backup_codes_regenerated');
  });

  it('re-authenticate with a backup code too, once', async () => {
    const { browser, person } = await signedInPerson(app, db);
    const [code] = person.backupCodes;
    if (!code) throw new Error('no backup code');
    expect((await browser.post('/api/auth/reauthenticate', { code })).status).toBe(204);
    expect((await browser.post('/api/auth/reauthenticate', { code })).body.code).toBe(
      'INVALID_TWO_FACTOR_CODE',
    );
  });
});

describe('passwords', () => {
  it('change with the current one and a fresh code, ending every session', async () => {
    const { browser, person } = await signedInPerson(app, db);
    const other = new Browser(app);
    await signIn(other, person);
    await reauthenticate(browser, person);
    const wrong = await browser.post('/api/me/password', {
      currentPassword: 'not the password',
      newPassword: 'a brand new password',
    });
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    const asEmail = await browser.post('/api/me/password', {
      currentPassword: person.password,
      newPassword: person.email,
    });
    expect(asEmail.body.code).toBe('VALIDATION_FAILED');
    const changed = await browser.post('/api/me/password', {
      currentPassword: person.password,
      newPassword: 'a brand new password',
    });
    expect(changed.status).toBe(204);
    expect((await other.get('/api/me')).status).toBe(401);
    person.password = 'a brand new password';
    await signIn(new Browser(app), person);
    expect(await actions(person.id)).toContain('user.password_changed');
  });

  it('reset by an emailed link, used once, without bypassing two-factor', async () => {
    const { browser, person } = await signedInPerson(app, db);
    const asked = await new Browser(app).post('/api/auth/request-password-reset', {
      email: person.email.toUpperCase(),
    });
    expect(asked.status).toBe(204);
    const [email] = await db
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.recipient, person.email), eq(emailOutbox.kind, 'password_reset')))
      .orderBy(desc(emailOutbox.createdAt));
    if (!email) throw new Error('no reset email');
    const link = (email.data as { link: string }).link;
    expect(link).toMatch(/^http:\/\/mizan\.test\/reset-password#token=/);
    const token = new URL(link).hash.slice('#token='.length);

    const reset = await new Browser(app).post('/api/auth/reset-password', {
      token,
      password: 'a password from the link',
    });
    expect(reset.status).toBe(204);
    expect((await browser.get('/api/me')).status).toBe(401);
    const again = await new Browser(app).post('/api/auth/reset-password', {
      token,
      password: 'another password here',
    });
    expect(again.status).toBe(410);
    expect(again.body.code).toBe('LINK_INVALID');
    const next = await new Browser(app).post('/api/auth/sign-in/email', {
      email: person.email,
      password: 'a password from the link',
    });
    expect(next.body).toEqual({ twoFactorRequired: true });
  });

  it('answer a reset request alike for an unknown email, at most 3 per address an hour', async () => {
    const browser = new Browser(app);
    const email = 'unknown.reset@example.test';
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await browser.post('/api/auth/request-password-reset', { email })).status).toBe(204);
    }
    const fourth = await new Browser(app).post('/api/auth/request-password-reset', { email });
    expect(fourth.status).toBe(429);
    expect(fourth.body.code).toBe('RATE_LIMITED');
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.recipient, email))).toEqual([]);
  });

  it('refuse an unknown reset token', async () => {
    const response = await new Browser(app).post('/api/auth/reset-password', {
      token: 'A'.repeat(43),
      password: 'a long enough password',
    });
    expect(response.body.code).toBe('LINK_INVALID');
  });
});

describe('my sign-ins', () => {
  it('list my own platform events, newest first', async () => {
    const { browser } = await signedInPerson(app, db);
    const response = await browser.get('/api/me/sign-ins');
    expect(response.status).toBe(200);
    expect(response.body.entries.map((entry: { action: string }) => entry.action)).toEqual(
      expect.arrayContaining(['user.signed_in', 'user.two_factor_enrolled']),
    );
    expect(response.body.entries[0]).toMatchObject({ ipAddress: browser.address });
    expect(response.body.nextCursor).toBeNull();
    const bad = await browser.get('/api/me/sign-ins', { cursor: 'not-a-cursor' });
    expect(bad.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('re-enrolment', () => {
  it('replaces the authenticator after a fresh code; the old one stops working', async () => {
    const { browser, person } = await signedInPerson(app, db);
    const oldSecret = person.secret;
    await reauthenticate(browser, person);
    await enrol(browser, person);
    expect(person.secret).not.toBe(oldSecret);
    await signIn(new Browser(app), person);
  });
});

describe('re-enrolment needs a fresh code, keyed on the person', () => {
  it('refuses a new authenticator without one, and keeps the old one after a wrong password', async () => {
    const { browser, person } = await signedInPerson(app, db);
    await db
      .update(sessions)
      .set({ reauthenticatedAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(sessions.userId, person.id));
    const stale = await browser.post('/api/auth/two-factor/enable', { password: person.password });
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe('REAUTHENTICATION_REQUIRED');
    await reauthenticate(browser, person);
    const wrong = await browser.post('/api/auth/two-factor/enable', {
      password: 'not the password',
    });
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    await signIn(new Browser(app), person);
  });

  it('still asks for a fresh code after an abandoned re-enrolment', async () => {
    const { browser, person } = await signedInPerson(app, db);
    await reauthenticate(browser, person);
    const started = await browser.post('/api/auth/two-factor/enable', {
      password: person.password,
    });
    expect(started.status).toBe(200);
    const newBackupCodes: string[] = started.body.backupCodes;
    // The person walks away without typing the new authenticator's first code.
    await db
      .update(sessions)
      .set({ reauthenticatedAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(sessions.userId, person.id));
    const again = await browser.post('/api/auth/two-factor/enable', { password: person.password });
    expect(again.body.code).toBe('REAUTHENTICATION_REQUIRED');
    // The old authenticator still works: re-authenticating ends the abandoned re-enrolment.
    await reauthenticate(browser, person);
    const [unconfirmed] = newBackupCodes;
    const refused = await new Browser(app).post('/api/auth/reauthenticate', { code: unconfirmed });
    expect(refused.status).toBe(401);
  });

  it('brings the old authenticator back at the next sign-in after an abandoned re-enrolment', async () => {
    const { browser, person } = await signedInPerson(app, db);
    await reauthenticate(browser, person);
    expect(
      (await browser.post('/api/auth/two-factor/enable', { password: person.password })).status,
    ).toBe(200);
    await signIn(new Browser(app), person);
    const [code] = person.backupCodes;
    const backup = new Browser(app);
    await backup.post('/api/auth/sign-in/email', {
      email: person.email,
      password: person.password,
    });
    expect((await backup.post('/api/auth/two-factor/verify-backup-code', { code })).status).toBe(
      204,
    );
  });

  it('keeps the new authenticator once its first code verifies', async () => {
    const { browser, person } = await signedInPerson(app, db);
    const oldSecret = person.secret;
    await reauthenticate(browser, person);
    await enrol(browser, person);
    expect(person.secret).not.toBe(oldSecret);
    await signIn(new Browser(app), person);
  });
});
