import { Inject, Injectable } from '@nestjs/common';
import type { IntegrityCheck, IntegrityReport } from '@vertex-mizan/contracts';
import { type Database, readChain, readLedgerState, withCompany } from '@vertex-mizan/db';
import { anchorResult, checkIntegrity } from '@vertex-mizan/ledger';
import { sql } from 'drizzle-orm';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { writeCompanyAudit } from '../../core/audit/audit.js';
import { DATABASE } from '../../core/database/database.module.js';

/** How long the check may read: 100,000 entries in at most 60 s (S03 "Volume and performance"). */
const CHECK_TIMEOUT = '60s';

@Injectable()
export class IntegrityService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * `POST /api/integrity/check` (S03 rule 19): the chain, numbers, balances, period balances and
   * head recomputed from the first entry by `packages/ledger`, every stored anchor and the pasted
   * one compared with the chain, all in one snapshot. Each run is audited with its result.
   */
  async check(access: CompanyRouteAccess, body: IntegrityCheck): Promise<IntegrityReport> {
    const companyId = access.company.id;
    return withCompany(
      this.db,
      companyId,
      async (tx) => {
        await tx.execute(sql`set local statement_timeout = ${sql.raw(`'${CHECK_TIMEOUT}'`)}`);
        const [{ checkedAt } = { checkedAt: '' }] = (
          await tx.execute<{ checkedAt: string }>(
            sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "checkedAt"`,
          )
        ).rows;
        const chain = await readChain(tx);
        const state = await readLedgerState(tx);
        const findings = checkIntegrity({ chain, ...state });
        const anchors = state.anchors.map((anchor) => ({
          anchoredOn: anchor.anchoredOn,
          entryCount: Number(anchor.entryCount),
          headHash: anchor.headHash,
          result: anchorResult(chain, anchor),
        }));
        let pasted: IntegrityReport['pasted'] = null;
        if (body.anchor) {
          const { date, count, hash } = body.anchor;
          const stored = state.anchors.find((anchor) => anchor.anchoredOn === date);
          pasted = {
            anchor: body.anchor,
            result: anchorResult(chain, { entryCount: BigInt(count), headHash: hash }),
            stored:
              stored === undefined
                ? 'none'
                : stored.entryCount === BigInt(count) && stored.headHash === hash
                  ? 'same'
                  : 'different',
          };
        }
        const problemCount =
          findings.numbering.length + findings.unbalanced.length + findings.periodBalances.length;
        const ok =
          findings.firstBreak === null &&
          findings.headMatchesChain &&
          problemCount === 0 &&
          anchors.every((anchor) => anchor.result === 'verified') &&
          (pasted === null || (pasted.result === 'verified' && pasted.stored !== 'different'));
        const { firstBreak } = findings;
        const report: IntegrityReport = {
          checkedAt,
          ok,
          entryCount: findings.entryCount,
          lineCount: findings.lineCount,
          firstBreak:
            firstBreak === null
              ? null
              : {
                  sequence: Number(firstBreak.sequence),
                  entryId: firstBreak.entryId,
                  number: { fiscalYear: firstBreak.fiscalYear, number: firstBreak.number },
                  reason: firstBreak.reason,
                },
          head: {
            entryCount: Number(state.head.entryCount),
            hash: state.head.lastHash,
            matchesChain: findings.headMatchesChain,
          },
          numbering: [...findings.numbering],
          unbalanced: findings.unbalanced.map((entry) => ({
            entryId: entry.entryId,
            number: { fiscalYear: entry.fiscalYear, number: entry.number },
            ledger: entry.ledger,
            residualMinor: entry.residualMinor.toString(),
            incompleteLines: entry.incompleteLines,
          })),
          periodBalances: findings.periodBalances.map((problem) => ({
            period: problem.period,
            accountId: problem.accountId,
            dimensionSetId: state.dimensionSetIds.get(problem.dimensionKey) ?? null,
            currency: problem.currency,
            problem: problem.problem,
          })),
          anchors,
          pasted,
        };
        await writeCompanyAudit(tx, companyId, actorOf(access), {
          action: 'integrity.checked',
          entityType: 'integrity_check',
          entityId: null,
          after: {
            ok,
            entryCount: report.entryCount,
            firstBreakSequence: report.firstBreak?.sequence ?? null,
            problemCount,
            anchorCount: anchors.length,
            pastedResult: pasted?.result ?? null,
          },
        });
        return report;
      },
      { isolationLevel: 'repeatable read' },
    );
  }
}
