import { Inject, Injectable } from '@nestjs/common';
import {
  HUB_CURRENCIES,
  type HubCurrency,
  type MapPostingRule,
  POSTING_SLOTS,
  type PostingRule,
  type PostingSlot,
  SLOT_READERS,
  type SlotAccount,
  slotAccountFits,
  slotIsPerCurrency,
} from '@vertex-mizan/contracts';
import {
  chartAccounts,
  type Database,
  inboundEventStates,
  postingRuleAccounts,
  type Transaction,
  withCompany,
} from '@vertex-mizan/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { writeCompanyAudit } from '../../core/audit/audit.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { RetryQueue } from '../../core/jobs/retry-queue.js';

/** Every slot of the mapping screen, a payment method's once per Hub currency. */
type SlotRow = { slot: PostingSlot; currency: HubCurrency | null };

const SLOT_ROWS: readonly SlotRow[] = POSTING_SLOTS.flatMap((slot): SlotRow[] =>
  slotIsPerCurrency(slot)
    ? HUB_CURRENCIES.map((currency) => ({ slot, currency }))
    : [{ slot, currency: null }],
);

/**
 * The posting rules' mapping (S05 "Mapping slots"): the account each slot reads, changed by the
 * owner or an accountant (`posting_rule.mapped`, audited before and after); a change retries the
 * events held `NO_MAPPING` once it commits (rule 10).
 */
@Injectable()
export class PostingRulesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(RetryQueue) private readonly retries: RetryQueue,
  ) {}

  /** `GET /api/posting-rules`: every slot with its account, its events and its held events. */
  async list(access: CompanyRouteAccess): Promise<PostingRule[]> {
    return withCompany(this.db, access.company.id, (tx) => this.read(tx));
  }

  /**
   * `PUT /api/posting-rules/:slot`: an account of the company that fits the slot
   * (`MAPPING_ACCOUNT_INVALID`, also for a blocked or archived account), the currency given exactly
   * for a payment method's slot.
   */
  async map(
    access: CompanyRouteAccess,
    slot: PostingSlot,
    input: MapPostingRule,
  ): Promise<PostingRule> {
    const companyId = access.company.id;
    const currency = input.currency ?? null;
    if (slotIsPerCurrency(slot) !== (currency !== null)) {
      throw new CodedException('VALIDATION_FAILED', 'A payment method is mapped per currency', [
        { path: ['currency'], message: 'Required for a payment method, refused otherwise' },
      ]);
    }
    const rule = await withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const [account] = await tx
        .select()
        .from(chartAccounts)
        .where(eq(chartAccounts.id, input.accountId))
        .for('share');
      if (!account) throw new CodedException('NOT_FOUND', 'No such account');
      const fits =
        !account.blockedAt &&
        !account.archivedAt &&
        slotAccountFits(slot, currency, {
          kind: account.kind as SlotAccount['kind'],
          class: account.class as SlotAccount['class'],
          isControl: account.isControl,
          itemKind: account.itemKind as SlotAccount['itemKind'],
          currency: account.currency,
          isMonetary: account.isMonetary,
        });
      if (!fits) {
        throw new CodedException(
          'MAPPING_ACCOUNT_INVALID',
          'The account does not fit the slot',
          undefined,
          {
            slot,
            code: account.code,
          },
        );
      }
      const [current] = await tx
        .select({
          id: postingRuleAccounts.id,
          accountId: postingRuleAccounts.accountId,
          archivedAt: postingRuleAccounts.archivedAt,
          code: chartAccounts.code,
        })
        .from(postingRuleAccounts)
        .innerJoin(
          chartAccounts,
          and(
            eq(chartAccounts.companyId, postingRuleAccounts.companyId),
            eq(chartAccounts.id, postingRuleAccounts.accountId),
          ),
        )
        .where(
          and(
            eq(postingRuleAccounts.slot, slot),
            currency === null
              ? isNull(postingRuleAccounts.currency)
              : eq(postingRuleAccounts.currency, currency),
          ),
        )
        .for('update', { of: postingRuleAccounts });
      const unchanged = current && !current.archivedAt && current.accountId === account.id;
      if (!unchanged) {
        let id: string;
        if (current) {
          await tx
            .update(postingRuleAccounts)
            .set({ accountId: account.id, updatedByUserId: access.person.id, archivedAt: null })
            .where(eq(postingRuleAccounts.id, current.id));
          id = current.id;
        } else {
          const [inserted] = await tx
            .insert(postingRuleAccounts)
            .values({
              companyId,
              slot,
              currency,
              accountId: account.id,
              updatedByUserId: access.person.id,
            })
            .returning({ id: postingRuleAccounts.id });
          if (!inserted) throw new Error('The slot was not mapped');
          id = inserted.id;
        }
        await writeCompanyAudit(tx, companyId, actorOf(access), {
          action: 'posting_rule.mapped',
          entityType: 'posting_rule',
          entityId: id,
          before:
            current && !current.archivedAt
              ? { slot, currency, accountId: current.accountId, accountCode: current.code }
              : null,
          after: { slot, currency, accountId: account.id, accountCode: account.code },
        });
      }
      const rules = await this.read(tx);
      return {
        rule: rules.find((row) => row.slot === slot && row.currency === currency),
        changed: !unchanged,
      };
    });
    if (rule.changed) await this.retries.afterCommit(companyId, [{ kind: 'mapping' }]);
    if (!rule.rule) throw new Error('The slot was not read back');
    return rule.rule;
  }

  private async read(tx: Transaction): Promise<PostingRule[]> {
    const mapped = await tx
      .select({
        slot: postingRuleAccounts.slot,
        currency: postingRuleAccounts.currency,
        updatedAt: postingRuleAccounts.updatedAt,
        id: chartAccounts.id,
        code: chartAccounts.code,
        name: chartAccounts.name,
      })
      .from(postingRuleAccounts)
      .innerJoin(
        chartAccounts,
        and(
          eq(chartAccounts.companyId, postingRuleAccounts.companyId),
          eq(chartAccounts.id, postingRuleAccounts.accountId),
        ),
      )
      .where(isNull(postingRuleAccounts.archivedAt));
    const held = await tx
      .select({ detail: inboundEventStates.holdDetail, count: sql<number>`count(*)::int` })
      .from(inboundEventStates)
      .where(
        and(eq(inboundEventStates.state, 'held'), eq(inboundEventStates.holdReason, 'NO_MAPPING')),
      )
      .groupBy(inboundEventStates.holdDetail);
    return SLOT_ROWS.map(({ slot, currency }) => {
      const row = mapped.find((entry) => entry.slot === slot && entry.currency === currency);
      return {
        slot,
        currency,
        account: row ? { id: row.id, code: row.code, name: row.name } : null,
        events: [...SLOT_READERS[slot]],
        heldEvents: held.find((entry) => entry.detail === `slot_unmapped:${slot}`)?.count ?? 0,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }
}
