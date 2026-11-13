import { Link } from '@tanstack/react-router';
import {
  ACCOUNT_ROLES,
  type AccountRole,
  CURRENCY_CODES,
  type CurrencyCode,
  type DimensionValue,
  type OpeningViewAnswer,
  POSTING_SLOTS,
  type PostingSlot,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Amount, Button, type ChecklistItemData, type StepStatus } from '@vertex-mizan/ui';
import type { ReactNode } from 'react';
import { detailText } from '../inbox/inbox-parts';

const t = ar.opening;
const r = t.review;

/** A text with `{name}` placeholders filled. */
export function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

/**
 * A client of the comparison: its value's name, or Hub's name while it is not linked
 * (`hub:<external id>`, check `mappings`).
 */
export function ClientName({
  view,
  client,
  values,
}: {
  view: OpeningViewAnswer;
  client: string;
  values: ReadonlyMap<string, DimensionValue>;
}) {
  if (client.startsWith('hub:')) {
    const externalId = client.slice(4);
    const party = view.hubItems.find((item) => item.client.externalId === externalId)?.client;
    return (
      <span>
        {fill(t.agreement.hubClient, { name: '' })}
        <bdi>{party?.name ?? externalId}</bdi>
      </span>
    );
  }
  const value = values.get(client);
  return <bdi>{value?.name ?? client}</bdi>;
}

const isCurrency = (value: unknown): value is CurrencyCode =>
  typeof value === 'string' && (CURRENCY_CODES as readonly string[]).includes(value);

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));

/** A ledger's name ("الدفتر الأساسي"), or the code as sent. */
function ledgerName(ledger: unknown): string {
  return ledger === 'book' || ledger === 'parallel' ? ar.accounting.ledger[ledger] : text(ledger);
}

/** One failing item of a check in words (S10 rule 21), amounts through `Amount`. */
function FailureText({
  view,
  check,
  failure,
  values,
}: {
  view: OpeningViewAnswer;
  check: OpeningViewAnswer['checks'][number]['check'];
  failure: Readonly<Record<string, string | number | boolean | null>>;
  values: ReadonlyMap<string, DimensionValue>;
}): ReactNode {
  const f = r.failure;
  switch (check) {
    case 'snapshot':
      return f.snapshot_missing;
    case 'records_agree': {
      const currency = isCurrency(failure.currency) ? failure.currency : 'USD';
      return (
        <>
          <ClientName view={view} client={text(failure.client)} values={values} />{' '}
          <bdi dir="ltr">{currency}</bdi>
          {' · '}
          {t.agreement.records}{' '}
          {failure.recordsMinor === null ? (
            t.agreement.missing
          ) : (
            <Amount value={BigInt(text(failure.recordsMinor))} currency={currency} />
          )}
          {' · '}
          {t.agreement.hub}{' '}
          <Amount value={BigInt(text(failure.hubMinor) || '0')} currency={currency} />
        </>
      );
    }
    case 'rates':
      return (
        <>
          {`${ledgerName(failure.ledger)}: `}
          <bdi dir="ltr">{`${text(failure.from)}/${text(failure.to)} ${text(failure.on)}`}</bdi>
        </>
      );
    case 'mappings': {
      if (typeof failure.slot === 'string') {
        const slot = (POSTING_SLOTS as readonly string[]).includes(failure.slot)
          ? ar.postingRules.slots[failure.slot as PostingSlot]
          : failure.slot;
        return failure.reason === 'slot_unmapped'
          ? fill(f.slotUnmapped, { slot })
          : fill(f.slotBlocked, { slot, account: text(failure.account) });
      }
      if (typeof failure.role === 'string') {
        const role = (ACCOUNT_ROLES as readonly string[]).includes(failure.role)
          ? ar.chart.roles[failure.role as AccountRole]
          : failure.role;
        return failure.reason === 'role_missing'
          ? fill(f.roleMissing, { role })
          : fill(f.roleBlocked, { role, account: text(failure.account) });
      }
      const value = text(failure.value);
      return fill(failure.reason === 'value_archived' ? f.valueArchived : f.valueUnlinked, {
        value,
      });
    }
    case 'schedules':
      return (
        <>
          <bdi dir="ltr">{text(failure.invoice)}</bdi>
          {': '}
          {detailText(text(failure.detail).split(':')[0] ?? null)}
        </>
      );
    case 'lines': {
      const code = text(failure.reason) || text(failure.code);
      const reason = f.lineReasons[code];
      return fill(f.line, {
        no: failure.lineNo === null ? '—' : text(failure.lineNo),
        reason: reason ? fill(reason, { ledger: ledgerName(failure.ledger) }) : code,
      });
    }
    default:
      return f.other;
  }
}

/** Where a failing check is fixed (S10 "Screens" step 4): rates, mappings, values, a step. */
function checkLink(
  check: OpeningViewAnswer['checks'][number],
):
  | { to: '/rates' | '/dimensions' | '/settings/posting-rules'; label: string }
  | { hash: 'agreement' | 'records'; label: string }
  | null {
  switch (check.check) {
    case 'rates':
      return { to: '/rates', label: r.links.rates };
    case 'mappings':
      return check.failures.every((failure) => typeof failure.value === 'string')
        ? { to: '/dimensions', label: r.links.values }
        : { to: '/settings/posting-rules', label: r.links.mappings };
    case 'records_agree':
      return { hash: 'agreement', label: r.links.agreement };
    case 'lines':
      return { hash: 'records', label: r.links.records };
    default:
      return null;
  }
}

/** The checks as the review's checklist, each failing item named under it with its link. */
export function checkItems(
  view: OpeningViewAnswer,
  values: ReadonlyMap<string, DimensionValue>,
): ChecklistItemData[] {
  return view.checks.map((check) => {
    const link = check.passed ? null : checkLink(check);
    return {
      id: check.check,
      status: check.passed ? 'passed' : 'failed',
      label: r.checkNames[check.check],
      statusLabel: check.passed ? r.passed : r.failed,
      count: fill(r.failures, { count: check.failures.length }),
      description:
        check.failures.length === 0 ? undefined : (
          <ul className="flex list-disc flex-col gap-0.5 ps-4" data-slot="opening-check-failures">
            {check.failures.map((failure, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a check's failures have no id of their own.
              <li key={index}>
                <FailureText view={view} check={check.check} failure={failure} values={values} />
              </li>
            ))}
          </ul>
        ),
      action:
        link === null ? undefined : 'hash' in link ? (
          <Button variant="link" size="sm" render={<a href={`#${link.hash}`} />}>
            {link.label}
          </Button>
        ) : (
          <Button variant="link" size="sm" render={<Link to={link.to} />}>
            {link.label}
          </Button>
        ),
    };
  });
}

const passed = (view: OpeningViewAnswer, check: OpeningViewAnswer['checks'][number]['check']) =>
  view.checks.find((candidate) => candidate.check === check)?.passed ?? false;

/** The four steps' statuses (S10 "Screens"): done, needing attention, or not reached yet. */
export function stepStatuses(
  view: OpeningViewAnswer,
  dirty: boolean,
): Record<'hub' | 'records' | 'agreement' | 'review', StepStatus> {
  if (view.state === 'posted') {
    return { hub: 'done', records: 'done', agreement: 'done', review: 'done' };
  }
  const hub = !view.hubClient || view.snapshot !== null ? 'done' : 'attention';
  const records =
    dirty || !passed(view, 'lines')
      ? 'attention'
      : view.recordLines.length === 0
        ? 'pending'
        : 'done';
  const agreement = passed(view, 'records_agree') ? 'done' : 'attention';
  const review = view.checks.every((check) => check.passed) && !dirty ? 'pending' : 'attention';
  return { hub, records, agreement, review };
}
