import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  type CreateCompany,
  chartTemplateIdSchema,
  createCompanySchema,
  emailSchema,
  reasonSchema,
} from '@vertex-mizan/contracts';
import {
  companies,
  companySettings,
  type Database,
  sessions,
  twoFactors,
  users,
  withCompany,
} from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { type AuditActor, SYSTEM_NAME, writePlatformAudit } from '../core/audit/audit.js';
import { queueEmail } from '../core/email/outbox.js';
import { dropWaitingAuthenticator } from '../modules/auth/two-factor.js';
import { applyChartTemplate } from '../modules/chart/chart-shape.js';
import { ledgerColumns } from '../modules/companies/company-shape.js';
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
}

/**
 * `admin:create-company` arguments: the company, its ledgers and the first owner's email. Vertex
 * Media's shape is the default (S01 rule 10): SYP books at bulletin, USD parallel at market
 * accepting the transaction's rate, January, and the service-agency chart (S02 rule 1);
 * `--template none` keeps the five roots alone.
 */
export function parseCreateCompany(argv: string[]): CreateCompanyCommand {
  const { values } = parseArgs({
    args: argv,
    options: {
      name: { type: 'string' },
      'name-latin': { type: 'string' },
      'book-currency': { type: 'string', default: 'SYP' },
      'book-rate-type': { type: 'string', default: 'bulletin' },
      'book-accepts-transaction-rate': { type: 'boolean', default: false },
      'parallel-currency': { type: 'string', default: 'USD' },
      'parallel-rate-type': { type: 'string', default: 'market' },
      'parallel-accepts-transaction-rate': { type: 'boolean', default: true },
      'no-parallel': { type: 'boolean', default: false },
      'fiscal-year-start-month': { type: 'string', default: '1' },
      'policy-note': { type: 'string' },
      'owner-email': { type: 'string' },
      template: { type: 'string', default: 'service-agency' },
    },
    strict: true,
  });
  const company = createCompanySchema.parse({
    name: values.name,
    nameLatin: values['name-latin'] ?? null,
    ledgers: {
      book: {
        currency: values['book-currency'],
        ratePolicy: {
          rateType: values['book-rate-type'],
          acceptsTransactionRate: values['book-accepts-transaction-rate'],
        },
      },
      parallel: values['no-parallel']
        ? null
        : {
            currency: values['parallel-currency'],
            ratePolicy: {
              rateType: values['parallel-rate-type'],
              acceptsTransactionRate: values['parallel-accepts-transaction-rate'],
            },
          },
    },
    fiscalYearStartMonth: Number(values['fiscal-year-start-month']),
    policyNote: values['policy-note'],
    template:
      values.template === 'none' ? null : chartTemplateIdSchema.parse(values.template),
  });
  return { company, ownerEmail: emailSchema.parse(values['owner-email']) };
}

/**
 * Creates a company with no creator and invites its first owner by email (S01 rule 9): the
 * company, its settings, its chart template (S02 rule 1), the invitation with its email, and the
 * audit rows, in one transaction.
 */
export async function createCompanyWithOwner(
  db: Database,
  appUrl: string,
  input: CreateCompanyCommand,
  actor = commandActor('admin:create-company'),
): Promise<{ companyId: string; invitationId: string }> {
  const companyId = uuidv7();
  return withCompany(db, companyId, async (tx) => {
    await tx.insert(companies).values({
      id: companyId,
      name: input.company.name,
      nameLatin: input.company.nameLatin,
      createdByUserId: null,
    });
    await tx.insert(companySettings).values({
      companyId,
      ...ledgerColumns(input.company.ledgers),
      fiscalYearStartMonth: input.company.fiscalYearStartMonth,
      policyNote: input.company.policyNote,
    });
    await writePlatformAudit(tx, {
      action: 'company.created',
      actor,
      subjectCompanyId: companyId,
    });
    if (input.company.template !== null) {
      await applyChartTemplate(tx, companyId, input.company.template, actor);
    }
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
