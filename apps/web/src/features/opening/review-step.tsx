import type { Account, DimensionValue, OpeningViewAnswer } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  Amount,
  Badge,
  Checklist,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { DimensionNames } from '../entries/entry-parts';
import { checkItems, fill } from './opening-parts';
import type { LedgerCurrencies } from './records-step';

const t = ar.opening.review;

type Group = 'records' | 'balancing';

/** The preview's lines by group, in rule 23's order: the records' lines, the balancing line. */
function groupsOf(
  view: OpeningViewAnswer,
): { group: Group; lines: OpeningViewAnswer['lines'][number][] }[] {
  const groups: { group: Group; lines: OpeningViewAnswer['lines'][number][] }[] = [
    { group: 'records', lines: view.lines.filter((line) => line.source === 'records') },
    { group: 'balancing', lines: view.lines.filter((line) => line.source === 'balancing') },
  ];
  return groups.filter((entry) => entry.lines.length > 0);
}

/**
 * Step 2 (S10 "Screens", without Hub: ADR 0021): the checks with their failing items and links,
 * then the entry the draft would post now, its records' lines and the balancing figure per ledger.
 */
export function ReviewStep({
  view,
  accounts,
  values,
  ledgers,
}: {
  view: OpeningViewAnswer;
  accounts: ReadonlyMap<string, Account>;
  values: ReadonlyMap<string, DimensionValue>;
  ledgers: LedgerCurrencies;
}) {
  const passing = view.checks.filter((check) => check.passed).length;
  const groups = groupsOf(view);
  const balancing = view.lines.find((line) => line.source === 'balancing');
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-labelledby="opening-checks" className="flex min-w-0 flex-col gap-2">
        <h3 id="opening-checks" className="font-semibold">
          {t.checks}
        </h3>
        <Checklist
          items={checkItems(view)}
          aria-labelledby="opening-checks"
          summary={fill(t.summary, { passed: passing, total: view.checks.length })}
        />
      </section>
      <section aria-labelledby="opening-preview" className="flex min-w-0 flex-col gap-3">
        <h3 id="opening-preview" className="font-semibold">
          {t.preview}
        </h3>
        {view.lines.length === 0 ? (
          <p className="text-muted-foreground">{t.previewEmpty}</p>
        ) : (
          <>
            <BalancingFigure line={balancing} ledgers={ledgers} />
            {groups.map(({ group, lines }) => (
              <GroupLines
                key={group}
                group={group}
                lines={lines}
                accounts={accounts}
                values={values}
                ledgers={ledgers}
              />
            ))}
          </>
        )}
      </section>
    </div>
  );
}

/** The balancing figure in each ledger (rule 19), or that the entry balances without one. */
function BalancingFigure({
  line,
  ledgers,
}: {
  line: OpeningViewAnswer['lines'][number] | undefined;
  ledgers: LedgerCurrencies;
}) {
  if (!line) return <p className="text-muted-foreground">{t.balancingNone}</p>;
  return (
    <dl
      data-slot="opening-balancing"
      className="grid w-fit grid-cols-[auto_auto] gap-x-6 gap-y-1 rounded-lg border border-border bg-surface px-4 py-3 text-control"
    >
      <dt className="col-span-2 font-medium">{t.balancing}</dt>
      <dt className="text-muted-foreground">{t.columns.book}</dt>
      <dd className="text-end">
        <Amount value={BigInt(line.bookMinor)} currency={ledgers.book} showCurrency strong />
      </dd>
      {ledgers.parallel !== null && line.parallelMinor !== null && (
        <>
          <dt className="text-muted-foreground">{t.columns.parallel}</dt>
          <dd className="text-end">
            <Amount
              value={BigInt(line.parallelMinor)}
              currency={ledgers.parallel}
              showCurrency
              strong
            />
          </dd>
        </>
      )}
    </dl>
  );
}

/** A group of the preview: its lines with their accounts, values and three amounts. */
function GroupLines({
  group,
  lines,
  accounts,
  values,
  ledgers,
}: {
  group: Group;
  lines: readonly OpeningViewAnswer['lines'][number][];
  accounts: ReadonlyMap<string, Account>;
  values: ReadonlyMap<string, DimensionValue>;
  ledgers: LedgerCurrencies;
}) {
  const name = t.groups[group];
  const c = t.columns;
  return (
    <section data-slot="opening-group" data-group={group} className="flex min-w-0 flex-col gap-2">
      <h4 className="flex items-center gap-2 text-control font-medium">
        <span>{name}</span>
        <Badge tone="outline">
          <bdi dir="ltr">{fill(t.groupCount, { count: lines.length })}</bdi>
        </Badge>
      </h4>
      <div className="min-w-0 overflow-x-auto">
        <Table>
          <TableCaption className="sr-only">{name}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{c.lineNo}</TableHead>
              <TableHead>{c.account}</TableHead>
              <TableHead>{c.dimensions}</TableHead>
              <TableHead>{c.kind}</TableHead>
              <TableHead numeric>{c.amount}</TableHead>
              <TableHead numeric>{`${c.book} (${ledgers.book})`}</TableHead>
              {ledgers.parallel !== null && (
                <TableHead numeric>{`${c.parallel} (${ledgers.parallel})`}</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => {
              const account = accounts.get(line.accountId);
              return (
                <TableRow key={line.lineNo} data-slot="opening-preview-line">
                  <TableCell>
                    <bdi dir="ltr">{line.lineNo}</bdi>
                  </TableCell>
                  <TableCell>
                    {account ? (
                      <AccountLabel code={account.code} name={account.name} />
                    ) : (
                      <bdi dir="ltr">{line.accountId}</bdi>
                    )}
                  </TableCell>
                  <TableCell>
                    <DimensionNames ids={line.dimensionValueIds} byId={values} />
                  </TableCell>
                  <TableCell>{t.kinds[line.kind] ?? line.kind}</TableCell>
                  <TableCell numeric>
                    <Amount
                      value={BigInt(line.amountMinor)}
                      currency={line.currency}
                      showCurrency
                    />
                  </TableCell>
                  <TableCell numeric>
                    <Amount value={BigInt(line.bookMinor)} currency={ledgers.book} />
                  </TableCell>
                  {ledgers.parallel !== null && (
                    <TableCell numeric>
                      {line.parallelMinor === null ? null : (
                        <Amount value={BigInt(line.parallelMinor)} currency={ledgers.parallel} />
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
