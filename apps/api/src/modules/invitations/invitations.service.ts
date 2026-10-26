import { Inject, Injectable } from '@nestjs/common';
import type {
  AcceptInvitation,
  CreateInvitation,
  Invitation,
  InvitationLookup,
  MyMembership,
} from '@vertex-mizan/contracts';
import {
  accounts,
  companies,
  type Database,
  invitations,
  memberships,
  type Transaction,
  users,
  verifications,
  withCompany,
} from '@vertex-mizan/db';
import { and, asc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { actorOf, type CompanyRouteAccess, type RequestAccess } from '../../core/access/access.js';
import { type AuditActor, writeCompanyAudit } from '../../core/audit/audit.js';
import type { Config } from '../../core/config/config.js';
import { CONFIG } from '../../core/config/config.module.js';
import { DATABASE } from '../../core/database/database.module.js';
import { queueEmail } from '../../core/email/outbox.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { linkWithToken, newLinkToken, tokenIdentifier } from '../../core/http/link-tokens.js';
import { consumeLimit, LIMITS } from '../../core/limits/limits.js';
import { hashPassword } from '../auth/password.js';

/** An invitation link is valid 7 days (S01 rule 15). */
const INVITATION_DAYS = 7;

type InvitationRow = typeof invitations.$inferSelect;

const pending = and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));

const linkInvalid = () =>
  new CodedException('LINK_INVALID', 'The link is expired, used or revoked');

/** What an invitation sends in the transaction that creates it. */
export interface NewInvitation {
  companyId: string;
  companyName: string;
  email: string;
  role: CreateInvitation['role'];
  canClosePeriods: boolean;
  invitedBy: { id: string; name: string } | null;
}

/**
 * Creates a pending invitation, its one-time token (stored as `invite:<sha256>` only), the email
 * with the link, and its audit row, in `tx` inside the company's context. An expired invitation
 * for the same email still holds the pending key until the clean-up marks it, so it is revoked
 * first; a live one answers `INVITATION_EXISTS`.
 */
export async function createInvitation(
  tx: Transaction,
  appUrl: string,
  actor: AuditActor,
  input: NewInvitation,
): Promise<Invitation> {
  const member = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.scopeCompanyId, input.companyId),
        isNull(memberships.archivedAt),
        eq(users.email, input.email),
      ),
    );
  if (member.length > 0) throw new CodedException('MEMBERSHIP_EXISTS', 'Already a member');
  await tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.scopeCompanyId, input.companyId),
        eq(invitations.email, input.email),
        pending,
        lte(invitations.expiresAt, sql`now()`),
      ),
    );
  const token = newLinkToken();
  const identifier = tokenIdentifier('invite', token);
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await tx
    .insert(invitations)
    .values({
      scopeCompanyId: input.companyId,
      email: input.email,
      role: input.role,
      canClosePeriods: input.canClosePeriods,
      invitedByUserId: input.invitedBy?.id ?? null,
      verificationIdentifier: identifier,
      expiresAt,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new CodedException('INVITATION_EXISTS', 'A pending invitation exists');
  await tx.insert(verifications).values({ identifier, value: row.id, expiresAt });
  await queueEmail(tx, 'invitation', input.email, {
    companyName: input.companyName,
    role: input.role,
    inviterName: input.invitedBy?.name ?? null,
    link: linkWithToken(appUrl, '/invitation', token),
    expiresAt: expiresAt.toISOString(),
  });
  await writeCompanyAudit(tx, input.companyId, actor, {
    action: 'invitation.created',
    entityType: 'invitation',
    entityId: row.id,
    after: {
      email: row.email,
      role: row.role,
      canClosePeriods: row.canClosePeriods,
      expiresAt: row.expiresAt,
    },
  });
  return invitationOf(row, input.invitedBy);
}

function invitationOf(
  row: InvitationRow,
  invitedBy: { id: string; name: string } | null,
): Invitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    canClosePeriods: row.canClosePeriods,
    invitedBy,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Invitations by email to a company (S01 rule 15). */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** `GET /api/invitations`: the pending invitations that have not expired. */
  async list(access: CompanyRouteAccess): Promise<Invitation[]> {
    const inviter = alias(users, 'inviter');
    const rows = await this.db
      .select({ invitation: invitations, inviterId: inviter.id, inviterName: inviter.name })
      .from(invitations)
      .leftJoin(inviter, eq(inviter.id, invitations.invitedByUserId))
      .where(
        and(
          eq(invitations.scopeCompanyId, access.company.id),
          pending,
          gt(invitations.expiresAt, sql`now()`),
        ),
      )
      .orderBy(asc(invitations.createdAt), asc(invitations.id));
    return rows.map((row) =>
      invitationOf(
        row.invitation,
        row.inviterId && row.inviterName ? { id: row.inviterId, name: row.inviterName } : null,
      ),
    );
  }

  /** `POST /api/invitations`. */
  async create(access: CompanyRouteAccess, input: CreateInvitation): Promise<Invitation> {
    const actor = actorOf(access);
    return withCompany(this.db, access.company.id, (tx) =>
      createInvitation(tx, this.config.appUrl, actor, {
        companyId: access.company.id,
        companyName: access.company.name,
        email: input.email,
        role: input.role,
        canClosePeriods: input.canClosePeriods,
        invitedBy: { id: access.person.id, name: access.person.name },
      }),
    );
  }

  /** `POST /api/invitations/:id/revoke`: a pending invitation; its link dies with it. */
  async revoke(access: CompanyRouteAccess, id: string): Promise<void> {
    const companyId = access.company.id;
    await withCompany(this.db, companyId, async (tx) => {
      const [revoked] = await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(and(eq(invitations.id, id), eq(invitations.scopeCompanyId, companyId), pending))
        .returning();
      if (!revoked) throw new CodedException('NOT_FOUND', 'No such invitation');
      await tx
        .delete(verifications)
        .where(eq(verifications.identifier, revoked.verificationIdentifier));
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: 'invitation.revoked',
        entityType: 'invitation',
        entityId: revoked.id,
      });
    });
  }

  /** `GET /api/invitations/lookup`: what a live link invites to, before accepting. */
  async lookup(access: RequestAccess, token: string): Promise<InvitationLookup> {
    await this.limitPerIp(access);
    const found = await this.live(this.db, token);
    if (!found) throw linkInvalid();
    const [person] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, found.invitation.email));
    return {
      companyName: found.companyName,
      role: found.invitation.role,
      email: found.invitation.email,
      personExists: person !== undefined,
    };
  }

  /**
   * `POST /api/invitations/accept`: a new person sets a name and password (the link proves the
   * email); an existing person must be signed in, both steps, as the invited email. The token is
   * used once, in the transaction that adds the membership.
   */
  async accept(access: RequestAccess, input: AcceptInvitation): Promise<MyMembership> {
    await this.limitPerIp(access);
    const found = await this.live(this.db, input.token);
    if (!found) throw linkInvalid();
    const companyId = found.invitation.scopeCompanyId;
    const [existing] = await this.db
      .select({ id: users.id, name: users.name, archivedAt: users.archivedAt })
      .from(users)
      .where(eq(users.email, found.invitation.email));
    if (existing?.archivedAt) throw linkInvalid();
    if (existing) {
      if (input.password !== undefined) {
        throw new CodedException('VALIDATION_FAILED', 'The person exists: sign in instead', [
          { path: ['password'], message: 'Sign in instead' },
        ]);
      }
      if (!access.person || !access.session) {
        throw new CodedException('UNAUTHENTICATED', 'Sign in first');
      }
      if (!access.session.twoFactorVerifiedAt) {
        throw new CodedException('TWO_FACTOR_REQUIRED', 'Enrol two-factor authentication first');
      }
      if (access.person.id !== existing.id) {
        throw new CodedException('INVITATION_EMAIL_MISMATCH', 'Signed in as another person');
      }
    } else if (input.name === undefined || input.password === undefined) {
      throw new CodedException('VALIDATION_FAILED', 'A new person sets a name and a password', [
        { path: ['password'], message: 'Required' },
      ]);
    } else if (input.password.toLowerCase() === found.invitation.email) {
      throw new CodedException('VALIDATION_FAILED', 'The password equals the email', [
        { path: ['password'], message: 'The password must not be the email' },
      ]);
    }
    const hash = input.password === undefined ? null : await hashPassword(input.password);

    return withCompany(this.db, companyId, async (tx) => {
      const [invitation] = await tx
        .select()
        .from(invitations)
        .where(
          and(
            eq(invitations.id, found.invitation.id),
            pending,
            gt(invitations.expiresAt, sql`now()`),
          ),
        )
        .for('update');
      const [company] = await tx
        .select()
        .from(companies)
        .where(and(eq(companies.id, companyId), isNull(companies.archivedAt)));
      if (!invitation || !company) throw linkInvalid();

      let person: { id: string; name: string };
      if (existing) {
        person = existing;
      } else {
        const [created] = await tx
          .insert(users)
          .values({ email: invitation.email, name: input.name ?? '', emailVerified: true })
          .returning({ id: users.id, name: users.name });
        if (!created || !hash) throw new Error('The person was not created');
        await tx.insert(accounts).values({
          userId: created.id,
          providerId: 'credential',
          accountId: created.id,
          password: hash,
        });
        person = created;
      }
      const [membership] = await tx
        .insert(memberships)
        .values({
          userId: person.id,
          scopeCompanyId: companyId,
          role: invitation.role,
          canClosePeriods: invitation.canClosePeriods,
          invitedByUserId: invitation.invitedByUserId,
        })
        .onConflictDoNothing()
        .returning();
      if (!membership) throw new CodedException('MEMBERSHIP_EXISTS', 'Already a member');
      await tx
        .update(invitations)
        .set({ acceptedAt: new Date(), acceptedByUserId: person.id })
        .where(eq(invitations.id, invitation.id));
      await tx
        .delete(verifications)
        .where(eq(verifications.identifier, invitation.verificationIdentifier));

      const actor: AuditActor = {
        kind: 'person',
        userId: person.id,
        name: person.name,
        sessionId: existing ? (access.session?.id ?? null) : null,
        requestId: access.requestId,
        ipAddress: access.ipAddress,
        userAgent: access.userAgent,
      };
      await writeCompanyAudit(tx, companyId, actor, {
        action: 'invitation.accepted',
        entityType: 'invitation',
        entityId: invitation.id,
      });
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
      return {
        membershipId: membership.id,
        company: {
          id: company.id,
          name: company.name,
          nameLatin: company.nameLatin,
          archived: false,
        },
        role: membership.role,
        canClosePeriods: membership.canClosePeriods,
      };
    });
  }

  /** A pending, unexpired invitation of an active company, by its token. */
  private async live(db: Database, token: string) {
    const [row] = await db
      .select({ invitation: invitations, companyName: companies.name })
      .from(invitations)
      .innerJoin(companies, eq(companies.id, invitations.scopeCompanyId))
      .where(
        and(
          eq(invitations.verificationIdentifier, tokenIdentifier('invite', token)),
          pending,
          gt(invitations.expiresAt, sql`now()`),
          isNull(companies.archivedAt),
        ),
      );
    return row ?? null;
  }

  private async limitPerIp(access: RequestAccess): Promise<void> {
    const key = `invitation:${access.ipAddress ?? 'unknown'}`;
    if (!(await consumeLimit(this.db, key, LIMITS.perIpPerMinute))) {
      throw new CodedException('RATE_LIMITED', 'Too many attempts');
    }
  }
}
