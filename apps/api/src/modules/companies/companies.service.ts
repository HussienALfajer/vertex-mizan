import { Inject, Injectable } from '@nestjs/common';
import type {
  Company,
  CreateCompany,
  UpdateCompanyLedgers,
  UpdateCompanyProfile,
} from '@vertex-mizan/contracts';
import {
  companies,
  companySettings,
  createCompanyBooks,
  type Database,
  invitations,
  memberships,
  type Transaction,
  verifications,
  withCompany,
} from '@vertex-mizan/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { actorOf, type CompanyRouteAccess, type SignedInAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { type AuditActor, changedFields, writeCompanyAudit } from '../../core/audit/audit.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { auditedLedgerFields, companyOf, ledgerColumns } from './company-shape.js';

/** Companies (S01 rules 9–13): creation, profile, ledger settings with their lock, archive. */
@Injectable()
export class CompaniesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * `POST /api/companies`: a new company whose creator becomes its owner (rule 9), in one
   * transaction with its books (`createCompanyBooks`: the settings, whose insert makes the five
   * root accounts, the built-in dimension types and the ledger head, and the chart template chosen,
   * S02 rule 1), the owner's membership and both audit logs.
   */
  async create(access: SignedInAccess, input: CreateCompany): Promise<Company> {
    const actor = actorOf(access);
    const companyId = uuidv7();
    return withCompany(this.db, companyId, async (tx) => {
      const { company, settings } = await createCompanyBooks(
        tx,
        companyId,
        { ...input, createdByUserId: access.person.id },
        actor,
      );
      const [membership] = await tx
        .insert(memberships)
        .values({ userId: access.person.id, scopeCompanyId: companyId, role: 'owner' })
        .returning({ id: memberships.id });
      if (!membership) throw new Error('The company was not created');
      await writeCompanyAudit(tx, companyId, actor, {
        action: 'membership.created',
        entityType: 'membership',
        entityId: membership.id,
        after: { userId: access.person.id, role: 'owner', canClosePeriods: false },
      });
      return companyOf(company, settings);
    });
  }

  /** `GET /api/company`: the active company. */
  async get(access: CompanyRouteAccess): Promise<Company> {
    return withCompany(this.db, access.company.id, (tx) => this.read(tx, access.company.id));
  }

  /**
   * `PATCH /api/company`: the names and the policy note. Each change is one audit row with the
   * changed fields before and after; the policy note stays editable after the lock (rule 11).
   */
  async updateProfile(access: CompanyRouteAccess, change: UpdateCompanyProfile): Promise<Company> {
    const companyId = access.company.id;
    const actor = actorOf(access);
    return withCompany(this.db, companyId, async (tx) => {
      // Exclusive: the update below changes this row, and two shared locks would deadlock.
      await lockCompanyForWrite(tx, companyId, 'exclusive');
      const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
      const [settings] = await this.settings(tx, companyId);
      if (!company || !settings) throw new CodedException('NOT_FOUND', 'No such company');

      const names = changedFields(
        { name: company.name, nameLatin: company.nameLatin },
        {
          name: change.name ?? company.name,
          nameLatin: change.nameLatin === undefined ? company.nameLatin : change.nameLatin,
        },
      );
      if (names) {
        await tx.update(companies).set(names.after).where(eq(companies.id, companyId));
        await writeCompanyAudit(tx, companyId, actor, {
          action: 'company.updated',
          entityType: 'company',
          entityId: companyId,
          ...names,
        });
      }
      if (change.policyNote !== undefined && change.policyNote !== settings.policyNote) {
        await tx
          .update(companySettings)
          .set({ policyNote: change.policyNote })
          .where(eq(companySettings.id, settings.id));
        await writeCompanyAudit(tx, companyId, actor, {
          action: 'company.policy_note_updated',
          entityType: 'company_settings',
          entityId: settings.id,
          before: { policyNote: settings.policyNote },
          after: { policyNote: change.policyNote },
        });
      }
      return this.read(tx, companyId);
    });
  }

  /**
   * `PUT /api/company/ledgers`: the currencies, rate policies and fiscal year start, until the
   * first posted entry (rule 11, `COMPANY_SETTINGS_LOCKED`). The row is locked first, as the
   * posting function locks it to set `books_started_at` (S01 edge case 3).
   */
  async updateLedgers(access: CompanyRouteAccess, input: UpdateCompanyLedgers): Promise<Company> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const [settings] = await this.settings(tx, companyId).for('update');
      if (!settings) throw new CodedException('NOT_FOUND', 'No such company');
      if (settings.booksStartedAt) {
        throw new CodedException('COMPANY_SETTINGS_LOCKED', 'The books have started');
      }
      const next = {
        ...ledgerColumns(input.ledgers),
        fiscalYearStartMonth: input.fiscalYearStartMonth,
      };
      const change = changedFields(auditedLedgerFields(settings), next);
      if (change) {
        await tx.update(companySettings).set(next).where(eq(companySettings.id, settings.id));
        await writeCompanyAudit(tx, companyId, actorOf(access), {
          action: 'company.ledgers_updated',
          entityType: 'company_settings',
          entityId: settings.id,
          ...change,
        });
      }
      return this.read(tx, companyId);
    });
  }

  /**
   * `POST /api/company/archive`: read-only from now on (rule 12); pending invitations are revoked
   * and their links die. Archiving an archived company changes nothing and writes nothing.
   */
  async archive(access: CompanyRouteAccess, reason: string): Promise<Company> {
    const companyId = access.company.id;
    const actor = actorOf(access);
    return withCompany(this.db, companyId, async (tx) => {
      const company = await this.lockCompany(tx, companyId);
      if (company.archivedAt) return this.read(tx, companyId);
      await tx
        .update(companies)
        .set({ archivedAt: new Date(), archivedReason: reason })
        .where(eq(companies.id, companyId));
      await writeCompanyAudit(tx, companyId, actor, {
        action: 'company.archived',
        entityType: 'company',
        entityId: companyId,
        reason,
        before: { archivedReason: null },
        after: { archivedReason: reason },
      });
      await this.revokePendingInvitations(tx, companyId, actor, reason);
      return this.read(tx, companyId);
    });
  }

  /** `POST /api/company/restore`: writable again; revoked invitations stay revoked. */
  async restore(access: CompanyRouteAccess, reason: string): Promise<Company> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      const company = await this.lockCompany(tx, companyId);
      if (!company.archivedAt) return this.read(tx, companyId);
      await tx
        .update(companies)
        .set({ archivedAt: null, archivedReason: null })
        .where(eq(companies.id, companyId));
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: 'company.restored',
        entityType: 'company',
        entityId: companyId,
        reason,
        before: { archivedReason: company.archivedReason },
        after: { archivedReason: null },
      });
      return this.read(tx, companyId);
    });
  }

  private async revokePendingInvitations(
    tx: Transaction,
    companyId: string,
    actor: AuditActor,
    reason: string,
  ): Promise<void> {
    const revoked = await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invitations.scopeCompanyId, companyId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .returning({ id: invitations.id, identifier: invitations.verificationIdentifier });
    if (revoked.length === 0) return;
    await tx.delete(verifications).where(
      inArray(
        verifications.identifier,
        revoked.map((invitation) => invitation.identifier),
      ),
    );
    for (const invitation of revoked) {
      await writeCompanyAudit(tx, companyId, actor, {
        action: 'invitation.revoked',
        entityType: 'invitation',
        entityId: invitation.id,
        reason,
      });
    }
  }

  private async lockCompany(tx: Transaction, companyId: string) {
    const [company] = await tx
      .select()
      .from(companies)
      .where(eq(companies.id, companyId))
      .for('no key update');
    if (!company) throw new CodedException('NOT_FOUND', 'No such company');
    return company;
  }

  private settings(tx: Transaction, companyId: string) {
    return tx.select().from(companySettings).where(eq(companySettings.companyId, companyId));
  }

  private async read(tx: Transaction, companyId: string): Promise<Company> {
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
    const [settings] = await this.settings(tx, companyId);
    if (!company || !settings) throw new CodedException('NOT_FOUND', 'No such company');
    return companyOf(company, settings);
  }
}
