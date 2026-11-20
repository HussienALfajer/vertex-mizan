import { randomInt, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  booksStartSchema,
  type CreateCompany,
  chartTemplateIdSchema,
  createCompanySchema,
  emailSchema,
  personNameSchema,
  reasonSchema,
} from '@vertex-mizan/contracts';
import {
  accounts,
  createCompanyBooks,
  type Database,
  invitations,
  memberships,
  sessions,
  twoFactors,
  users,
  verifications,
  withCompany,
} from '@vertex-mizan/db';
import { and, eq, gt, isNull, like, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  type AuditActor,
  SYSTEM_NAME,
  writeCompanyAudit,
  writePlatformAudit,
} from '../core/audit/audit.js';
import { queueEmail } from '../core/email/outbox.js';
import { hashPassword } from '../modules/auth/password.js';
import { dropWaitingAuthenticator } from '../modules/auth/two-factor.js';
import { createInvitation } from '../modules/invitations/invitations.service.js';

// The server commands of S01 (rule 9, rule 21): run by Vertex on the server, as the app role, never
// the owner (ADR 0008). Each is audited as the system.

/** The system as the actor of a command, with a request ID of its own. */
export function commandActor(command: string): AuditActor {
  return {
    kind: 'system',
    name: SYSTEM_NAME,
    requestId: `command-${randomUUID()}`,
    ipAddress: null,
    userAgent: command,
  };
}

export interface CreateCompanyCommand {
  company: CreateCompany;
  ownerEmail: string;
  /** The books start (S10 rule 1), or null for a company without an opening. */
  booksStart: string | null;
}

/** The options of a company that both commands take (S01 rules 9–10). */
const COMPANY_OPTIONS = {
  name: { type: 'string' },
  'name-latin': { type: 'string' },
  'book-currency': { type: 'string', default: 'SYP' },
  'book-rate-type': { type: 'string', default: 'bulletin' },
  'book-accepts-transaction-rate': { type: 'boolean' },
  'no-book-accepts-transaction-rate': { type: 'boolean' },
  'parallel-currency': { type: 'string', default: 'USD' },
  'parallel-rate-type': { type: 'string', default: 'market' },
  'parallel-accepts-transaction-rate': { type: 'boolean' },
  'no-parallel-accepts-transaction-rate': { type: 'boolean' },
  'no-parallel': { type: 'boolean', default: false },
  'fiscal-year-start-month': { type: 'string', default: '1' },
  'policy-note': { type: 'string' },
  template: { type: 'string', default: 'general' },
  'books-start': { type: 'string' },
} as const;

/**
 * A command's company: Vertex Media's shape by default (S01 rule 10): SYP books at bulletin, USD
 * parallel at market, January, and the general chart (S02 rule 1, ADR 0021); `--template
 * contracting` the contracting chart (S11, N5), `--template none` the five roots alone;
 * `--books-start YYYY-MM-DD` (the first day of a month) gives it a books start, so it posts nothing
 * before its opening (S10 rules 1, 3). A ledger accepts the transaction's rate by default only at
 * `market`, the one policy that may (S01 edge case 8); `--no-…-accepts-transaction-rate` refuses it.
 */
function companyOf(values: Record<string, string | boolean | undefined>): {
  company: CreateCompany;
  booksStart: string | null;
} {
  const accepts = (ledger: 'book' | 'parallel') => {
    if (values[`no-${ledger}-accepts-transaction-rate`] === true) return false;
    if (values[`${ledger}-accepts-transaction-rate`] === true) return true;
    return values[`${ledger}-rate-type`] === 'market';
  };
  const company = createCompanySchema.parse({
    name: values.name,
    nameLatin: values['name-latin'] ?? null,
    ledgers: {
      book: {
        currency: values['book-currency'],
        ratePolicy: { rateType: values['book-rate-type'], acceptsTransactionRate: accepts('book') },
      },
      parallel: values['no-parallel']
        ? null
        : {
            currency: values['parallel-currency'],
            ratePolicy: {
              rateType: values['parallel-rate-type'],
              acceptsTransactionRate: accepts('parallel'),
            },
          },
    },
    fiscalYearStartMonth: Number(values['fiscal-year-start-month']),
    policyNote: values['policy-note'],
    template: values.template === 'none' ? null : chartTemplateIdSchema.parse(values.template),
  });
  const booksStart = values['books-start'];
  return {
    company,
    booksStart: booksStart === undefined ? null : booksStartSchema.parse(booksStart),
  };
}

/** `admin:create-company` arguments: the company, its ledgers and the first owner's email. */
export function parseCreateCompany(argv: string[]): CreateCompanyCommand {
  const { values } = parseArgs({
    args: argv,
    options: { ...COMPANY_OPTIONS, 'owner-email': { type: 'string' } },
    strict: true,
  });
  return { ...companyOf(values), ownerEmail: emailSchema.parse(values['owner-email']) };
}

/**
 * Creates a company with no creator and invites its first owner by email (S01 rule 9): the
 * company's books (`createCompanyBooks`: its settings and chart template, S02 rule 1), the
 * invitation with its email, and the audit rows, in one transaction.
 */
export async function createCompanyWithOwner(
  db: Database,
  appUrl: string,
  input: CreateCompanyCommand,
  actor = commandActor('admin:create-company'),
): Promise<{ companyId: string; invitationId: string }> {
  const companyId = uuidv7();
  return withCompany(db, companyId, async (tx) => {
    await createCompanyBooks(
      tx,
      companyId,
      { ...input.company, createdByUserId: null, booksStart: input.booksStart },
      actor,
    );
    const invitation = await createInvitation(tx, appUrl, actor, {
      companyId,
      companyName: input.company.name,
      email: input.ownerEmail,
      role: 'owner',
      canClosePeriods: false,
      invitedBy: null,
    });
    return { companyId, invitationId: invitation.id };
  });
}

/** `admin:create-account` arguments (S01 rule 9, owner 2026-11-16): a company, its owner's email and name. */
export interface CreateAccountCommand {
  company: CreateCompany;
  booksStart: string | null;
  email: string;
  personName: string;
}

export function parseCreateAccount(argv: string[]): CreateAccountCommand {
  const { values } = parseArgs({
    args: argv,
    options: {
      ...COMPANY_OPTIONS,
      email: { type: 'string' },
      'person-name': { type: 'string' },
    },
    strict: true,
  });
  return {
    ...companyOf(values),
    email: emailSchema.parse(values.email),
    personName: personNameSchema.parse(values['person-name']),
  };
}

/** The characters from `first` to `last`, by code point. */
function charRange(first: string, last: string): string[] {
  const from = first.charCodeAt(0);
  return Array.from({ length: last.charCodeAt(0) - from + 1 }, (_, i) =>
    String.fromCharCode(from + i),
  );
}

/** Letters and digits without the look-alikes (0 O o, 1 I l): 56 characters. */
const PASSWORD_ALPHABET = [...charRange('A', 'Z'), ...charRange('a', 'z'), ...charRange('2', '9')]
  .filter((character) => !'IOlo'.includes(character))
  .join('');

/** A password of 24 characters drawn without bias: about 139 bits (S01 rule 9). */
export function generatePassword(length = 24): string {
  let password = '';
  for (let i = 0; i < length; i += 1) {
    password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return password;
}

/**
 * Creates an exempt person with a generated password, a company and the person's owner
 * membership, in one transaction, with no invitation (S01 rules 2 and 9, owner 2026-11-16). An
 * email that already belongs to a person is refused before anything is written. The password is
 * returned once, for the command to print; it is never logged or audited.
 */
export async function createAccountWithCompany(
  db: Database,
  input: CreateAccountCommand,
  actor = commandActor('admin:create-account'),
): Promise<{ personId: string; companyId: string; password: string }> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email));
  if (existing) throw new Error('A person with that email exists: use admin:create-company');
  const password = generatePassword();
  const hash = await hashPassword(password);
  const companyId = uuidv7();
  const personId = await withCompany(db, companyId, async (tx) => {
    const [person] = await tx
      .insert(users)
      .values({
        email: input.email,
        name: input.personName,
        emailVerified: true,
        twoFactorExempt: true,
      })
      .returning({ id: users.id });
    if (!person) throw new Error('The person was not created');
    await tx.insert(accounts).values({
      userId: person.id,
      providerId: 'credential',
      accountId: person.id,
      password: hash,
    });
    await writePlatformAudit(tx, {
      action: 'user.created',
      actor,
      email: input.email,
      details: { twoFactorExempt: true },
    });
    await createCompanyBooks(
      tx,
      companyId,
      { ...input.company, createdByUserId: null, booksStart: input.booksStart },
      actor,
    );
    const [membership] = await tx
      .insert(memberships)
      .values({ userId: person.id, scopeCompanyId: companyId, role: 'owner' })
      .returning();
    if (!membership) throw new Error('The membership was not created');
    await writeCompanyAudit(tx, companyId, actor, {
      action: 'membership.created',
      entityType: 'membership',
      entityId: membership.id,
      after: {
        userId: person.id,
        role: membership.role,
        canClosePeriods: membership.canClosePeriods,
      },
    });
    return person.id;
  });
  return { personId, companyId, password };
}

/** `admin:reset-two-factor` arguments: the person's email and the written reason. */
export function parseResetTwoFactor(argv: string[]): { email: string; reason: string } {
  const { values } = parseArgs({
    args: argv,
    options: { email: { type: 'string' }, reason: { type: 'string' } },
    strict: true,
  });
  return {
    email: emailSchema.parse(values.email),
    reason: reasonSchema.parse({ reason: values.reason }).reason,
  };
}

/**
 * Resets a person's two-factor by Vertex (S01 rule 21), for a person who lost both their
 * authenticator and backup codes and has no owner who may reset it: removes the authenticator and
 * backup codes, ends every session, emails the notice, and writes the platform audit log.
 */
export async function resetTwoFactorByVertex(
  db: Database,
  input: { email: string; reason: string },
  actor = commandActor('admin:reset-two-factor'),
): Promise<void> {
  await db.transaction(async (tx) => {
    const [person] = await tx
      .select({ id: users.id, twoFactorEnabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.email, input.email))
      // The person's lock, as every two-factor change takes it (`lockTwoFactorOf`).
      .for('update');
    if (!person) throw new Error('No person with that email');
    await tx.delete(twoFactors).where(eq(twoFactors.userId, person.id));
    await dropWaitingAuthenticator(tx, person.id);
    await tx.update(users).set({ twoFactorEnabled: false }).where(eq(users.id, person.id));
    await tx.delete(sessions).where(eq(sessions.userId, person.id));
    await queueEmail(tx, 'two_factor_reset', input.email, { companyName: null });
    await writePlatformAudit(tx, {
      action: 'user.two_factor_reset',
      actor,
      email: input.email,
      details: { reason: input.reason, twoFactorWasEnabled: person.twoFactorEnabled },
    });
  });
}

/** `admin:change-email` arguments: the person's current email, the new one and the reason. */
export function parseChangeEmail(argv: string[]): { from: string; to: string; reason: string } {
  const { values } = parseArgs({
    args: argv,
    options: { from: { type: 'string' }, to: { type: 'string' }, reason: { type: 'string' } },
    strict: true,
  });
  return {
    from: emailSchema.parse(values.from),
    to: emailSchema.parse(values.to),
    reason: reasonSchema.parse({ reason: values.reason }).reason,
  };
}

/**
 * Changes a person's sign-in email by Vertex (S01 "Out": a server command only; owner,
 * 2026-11-20). The person, their memberships and every company's books keep their ids, so nothing
 * else changes; the password stays. Refuses an unknown email, one that already belongs to a
 * person, and the change while a live invitation is addressed to the old email (accepting it
 * would make another person with that address: an owner revokes it first). Ends every session and
 * deletes the person's password-reset links, which name the person and not the address, so
 * nothing sent to the old mailbox still opens the account; then writes the platform audit log
 * with both addresses and the reason.
 */
export async function changeEmailByVertex(
  db: Database,
  input: { from: string; to: string; reason: string },
  actor = commandActor('admin:change-email'),
): Promise<void> {
  if (input.from === input.to) throw new Error('The new email is the current one');
  await db.transaction(async (tx) => {
    const [person] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.from))
      .for('update');
    if (!person) throw new Error('No person with that email');
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.to));
    if (taken) throw new Error('A person with the new email exists');
    const [invited] = await tx
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.email, input.from),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, sql`now()`),
        ),
      )
      .limit(1);
    if (invited) {
      throw new Error('An invitation to the old email is pending: revoke it first');
    }
    await tx
      .update(users)
      // Vertex sets the address, as `admin:create-account` does: it counts as verified.
      .set({ email: input.to, emailVerified: true, updatedAt: new Date() })
      .where(eq(users.id, person.id));
    await tx.delete(sessions).where(eq(sessions.userId, person.id));
    await tx
      .delete(verifications)
      .where(and(eq(verifications.value, person.id), like(verifications.identifier, 'reset:%')));
    await writePlatformAudit(tx, {
      action: 'user.email_changed',
      actor,
      email: input.to,
      details: { personId: person.id, from: input.from, to: input.to, reason: input.reason },
    });
  });
}
