import {
  type Account,
  type DimensionValue,
  OPENING_HUB_SLOTS,
  type OpeningViewAnswer,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  Amount,
  Badge,
  Checklist,
  cn,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { ChevronDownIcon } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { DimensionNames } from '../entries/entry-parts';
import { checkItems, fill } from './opening-parts';
import type { LedgerCurrencies } from './records-step';

const t = ar.opening.review;

type Group = (typeof OPENING_HUB_SLOTS)[number] | 'schedules' | 'records' | 'balancing';

/** A preview line with what it carries from Hub: its item or its schedule (rule 20). */
interface ReviewLine {
  readonly line: OpeningViewAnswer['lines'][number];
  readonly item?: OpeningViewAnswer['hubItems'][number];
  readonly schedule?: OpeningViewAnswer['schedules'][number];
}

/**
 * The preview's lines by group, in rule 23's order: Hub's items by slot (the view lists them in
 * the entry's order), the schedules, the records' lines, the balancing line.
 */
function groupsOf(view: OpeningViewAnswer): { group: Group; lines: ReviewLine[] }[] {
  const hub = view.lines.filter((line) => line.source === 'hub');
  const schedules = view.lines.filter((line) => line.source === 'schedule');
  const groups: { group: Group; lines: ReviewLine[] }[] = OPENING_HUB_SLOTS.map((slot) => ({
    group: slot,
    lines: hub.flatMap((line, index) => {
      const item = view.hubItems[index];
      return item?.slot === slot ? [{ line, item }] : [];
    }),
  }));
  groups.push({
    group: 'schedules',
    lines: schedules.map((line, index) => {
      const schedule = view.schedules[index];
      return schedule ? { line, schedule } : { line };
    }),
  });
  groups.push({
    group: 'records',
    lines: view.lines.filter((line) => line.source === 'records').map((line) => ({ line })),
  });
  groups.push({
    group: 'balancing',
    lines: view.lines.filter((line) => line.source === 'balancing').map((line) => ({ line })),
  });
  return groups.filter((entry) => entry.lines.length > 0);
}

/**
 * Step 4 (S10 "Screens"): the checks with their failing items and links, then the entry the draft
 * would post now, Hub's lines grouped by slot and opening to each item or schedule, and the
 * balancing figure per ledger.
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
          items={checkItems(view, values)}
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

/** A group of the preview, Hub's opening to their items and schedules from its button. */
function GroupLines({
  group,
  lines,
  accounts,
  values,
  ledgers,
}: {
  group: Group;
  lines: readonly ReviewLine[];
  accounts: ReadonlyMap<string, Account>;
  values: ReadonlyMap<string, DimensionValue>;
  ledgers: LedgerCurrencies;
}) {
  const id = useId();
  const fromHub = group !== 'records' && group !== 'balancing';
  const [open, setOpen] = useState(!fromHub);
  const name = t.groups[group];
  const c = t.columns;
  return (
    <section data-slot="opening-group" data-group={group} className="flex min-w-0 flex-col gap-2">
      <h4 className="flex items-center gap-2 text-control font-medium">
        {fromHub ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((current) => !current)}
            className="flex min-h-row items-center gap-2 rounded-md px-1 hover:bg-muted"
          >
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                'size-icon transition-transform duration-150',
                !open && 'rtl:rotate-90 ltr:-rotate-90',
              )}
            />
            <span>{name}</span>
            <span className="sr-only">
              {fill(open ? t.hideItems : t.showItems, { group: name })}
            </span>
          </button>
        ) : (
          <span>{name}</span>
        )}
        <Badge tone="outline">
          <bdi dir="ltr">{fill(t.groupCount, { count: lines.length })}</bdi>
        </Badge>
      </h4>
      {open && (
        <div id={id} className="min-w-0 overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">{name}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{c.lineNo}</TableHead>
                <TableHead>{c.account}</TableHead>
                {fromHub && <TableHead>{c.document}</TableHead>}
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
              {lines.map(({ line, item, schedule }) => {
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
                    {fromHub && (
                      <TableCell>
                        <HubDocument item={item} schedule={schedule} />
                      </TableCell>
                    )}
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
      )}
    </section>
  );
}

/** What a Hub line carries from the snapshot: its invoice, milestone or wallet, or its schedule. */
function HubDocument({
  item,
  schedule,
}: {
  item: ReviewLine['item'];
  schedule: ReviewLine['schedule'];
}): ReactNode {
  const c = t.columns;
  if (item) {
    const type = item.document?.type ?? 'wallet';
    return (
      <span className="flex flex-col gap-0.5">
        <span>
          {t.documentTypes[type]} <bdi dir="ltr">{item.document?.number ?? item.reference}</bdi>
        </span>
        <span className="text-muted-foreground text-xs">
          <bdi>{item.client.name}</bdi>
          {' · '}
          {c.documentDate} <bdi dir="ltr">{item.documentDate}</bdi>
          {item.dueOn !== null && (
            <>
              {' · '}
              {c.dueOn} <bdi dir="ltr">{item.dueOn}</bdi>
            </>
          )}
        </span>
      </span>
    );
  }
  if (schedule) {
    return (
      <span className="flex flex-col gap-0.5">
        <span>
          {t.documentTypes.invoice} <bdi dir="ltr">{schedule.invoice.number}</bdi>
          {' · '}
          <bdi>{schedule.service.name}</bdi>
        </span>
        <span className="text-muted-foreground text-xs">
          <bdi>{schedule.client.name}</bdi>
          {' · '}
          {c.issuedOn} <bdi dir="ltr">{schedule.issuedOn}</bdi>
          {schedule.serviceFrom !== null && schedule.serviceTo !== null && (
            <>
              {' · '}
              {c.period} <bdi dir="ltr">{`${schedule.serviceFrom} – ${schedule.serviceTo}`}</bdi>
            </>
          )}
        </span>
        <span className="text-muted-foreground text-xs">
          {c.deferred}{' '}
          <Amount value={BigInt(schedule.deferred.transactionMinor)} currency={schedule.currency} />
          {' · '}
          {c.beforeOpening}{' '}
          <Amount
            value={BigInt(schedule.beforeOpening.transactionMinor)}
            currency={schedule.currency}
          />
          {' · '}
          {c.remaining}{' '}
          <Amount
            value={BigInt(schedule.remaining.transactionMinor)}
            currency={schedule.currency}
          />
        </span>
      </span>
    );
  }
  return null;
}
