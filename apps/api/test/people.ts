import { randomUUID } from 'node:crypto';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import type { INestApplication } from '@nestjs/common';
import type { Company, CreateCompany, Role } from '@vertex-mizan/contracts';
import { accounts, createDatabase, type Database, memberships, users } from '@vertex-mizan/db';
import { expect, inject } from 'vitest';
import { hashPassword } from '../src/modules/auth/password.js';
import { Browser } from './browser.js';

/** The app role's database of this run, for seeding and checking what the API wrote. */
export function testDatabase(): Database {
  return createDatabase(inject('databaseUrl'));
}

/** A synthetic person; `secret` is their authenticator's once enrolled. */
export interface TestPerson {
  id: string;
  email: string;
  name: string;
  password: string;
  secret: string | null;
  backupCodes: string[];
}

/** A person with a password and no two-factor yet, as an accepted invitation leaves them. */
export async function createPerson(
  db: Database,
  values: { email?: string; name?: string; password?: string } = {},
): Promise<TestPerson> {
  const email = values.email ?? `person.${randomUUID()}@example.test`;
  const name = values.name ?? 'شخص تجريبي';
  const password = values.password ?? 'correct horse battery staple';
  const [user] = await db
    .insert(users)
    .values({ email, name, emailVerified: true })
    .returning({ id: users.id });
  if (!user) throw new Error('no person inserted');
  await db.insert(accounts).values({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await hashPassword(password),
  });
  return { id: user.id, email, name, password, secret: null, backupCodes: [] };
}

/** Codes already typed per secret: the API accepts each code once (S01 "Code replay"). */
const usedCodes = new Map<string, Set<string>>();

/**
 * A code the authenticator would show that has not been used: this step's, or the next or the
 * previous one (±1 step is accepted). When all three are used, it waits for the next step.
 */
export async function freshCode(person: TestPerson): Promise<string> {
  const secret = person.secret;
  if (!secret) throw new Error('The person has not enrolled');
  const used = usedCodes.get(secret) ?? new Set<string>();
  usedCodes.set(secret, used);
  const otp = createOTP(secret, { digits: 6, period: 30 });
  for (;;) {
    const step = Math.floor(Date.now() / 30_000);
    for (const offset of [0, 1, -1]) {
      const code = await otp.hotp(step + offset);
      if (!used.has(code)) {
        used.add(code);
        return code;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000 - (Date.now() % 30_000) + 50));
  }
}

/** The authenticator secret in an `otpauth://` URI, as the plugin's TOTP takes it. */
export function secretOfUri(totpURI: string): string {
  const encoded = new URL(totpURI).searchParams.get('secret') ?? '';
  return new TextDecoder().decode(base32.decode(encoded));
}

/** Email and password; then the second step when the person has enrolled. */
export async function signIn(browser: Browser, person: TestPerson): Promise<void> {
  const first = await browser.post('/api/auth/sign-in/email', {
    email: person.email,
    password: person.password,
  });
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  if (first.body.twoFactorRequired) {
    const second = await browser.post('/api/auth/two-factor/verify-totp', {
      code: await freshCode(person),
    });
    expect(second.status, JSON.stringify(second.body)).toBe(204);
  }
}

/** Enrols a signed-in person's authenticator and keeps its secret and backup codes. */
export async function enrol(browser: Browser, person: TestPerson): Promise<void> {
  const enabled = await browser.post('/api/auth/two-factor/enable', { password: person.password });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
  person.secret = secretOfUri(enabled.body.totpURI);
  person.backupCodes = enabled.body.backupCodes;
  const verified = await browser.post('/api/auth/two-factor/verify-totp', {
    code: await freshCode(person),
  });
  expect(verified.status, JSON.stringify(verified.body)).toBe(204);
}

/** A fresh code for the sensitive actions of the next 5 minutes. */
export async function reauthenticate(browser: Browser, person: TestPerson): Promise<void> {
  const response = await browser.post('/api/auth/reauthenticate', {
    code: await freshCode(person),
  });
  expect(response.status, JSON.stringify(response.body)).toBe(204);
}

/** A new person, signed in with both steps and enrolled, in their own browser. */
export async function signedInPerson(
  app: INestApplication,
  db: Database,
  values: { email?: string; name?: string } = {},
): Promise<{ browser: Browser; person: TestPerson }> {
  const person = await createPerson(db, values);
  const browser = new Browser(app);
  await signIn(browser, person);
  await enrol(browser, person);
  return { browser, person };
}

/** Vertex Media's shape (S01 rule 10): SYP books at bulletin, USD parallel at market. */
export function companyInput(values: Partial<CreateCompany> = {}): CreateCompany {
  return {
    name: 'شركة اختبار',
    nameLatin: 'Test Company',
    ledgers: {
      book: {
        currency: 'SYP',
        ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
      },
      parallel: {
        currency: 'USD',
        ratePolicy: { rateType: 'market', acceptsTransactionRate: true },
      },
    },
    fiscalYearStartMonth: 1,
    policyNote: 'العملة الوظيفية الليرة السورية (IAS 21.9–12).',
    ...values,
  };
}

/** Creates a company as the browser's person and enters it. */
export async function newCompany(
  browser: Browser,
  values: Partial<CreateCompany> = {},
): Promise<Company> {
  const created = await browser.post('/api/companies', companyInput(values));
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const entered = await browser.post('/api/session/company', { companyId: created.body.id });
  expect(entered.status, JSON.stringify(entered.body)).toBe(200);
  browser.companyId = created.body.id;
  return created.body as Company;
}

/** A new person with `role` in the company, signed in and in it, as an accepted invitation leaves them. */
export async function joinCompany(
  app: INestApplication,
  db: Database,
  companyId: string,
  role: Role,
  canClosePeriods = false,
): Promise<{ browser: Browser; person: TestPerson; membershipId: string }> {
  const joined = await signedInPerson(app, db);
  const [membership] = await db
    .insert(memberships)
    .values({ userId: joined.person.id, scopeCompanyId: companyId, role, canClosePeriods })
    .returning({ id: memberships.id });
  if (!membership) throw new Error('no membership inserted');
  const entered = await joined.browser.post('/api/session/company', { companyId });
  expect(entered.status, JSON.stringify(entered.body)).toBe(200);
  joined.browser.companyId = companyId;
  return { ...joined, membershipId: membership.id };
}
