import { Link } from '@tanstack/react-router';
import { ACCOUNT_ROLES, type AccountRole, type OpeningViewAnswer } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Button, type ChecklistItemData, type StepStatus } from '@vertex-mizan/ui';
import type { ReactNode } from 'react';

const t = ar.opening;
const r = t.review;

/** A text with `{name}` placeholders filled. */
export function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));

/** A ledger's name ("الدفتر الأساسي"), or the code as sent. */
function ledgerName(ledger: unknown): string {
  return ledger === 'book' || ledger === 'parallel' ? ar.accounting.ledger[ledger] : text(ledger);
}

/**
 * One failing item of a check in words (S10 rule 21); a failure the screen does not know reads as
 * an unknown problem.
 */
function FailureText({
  check,
  failure,
}: {
  check: OpeningViewAnswer['checks'][number]['check'];
  failure: Readonly<Record<string, string | number | boolean | null>>;
}): ReactNode {
  const f = r.failure;
  switch (check) {
    case 'rates':
      return (
        <>
          {`${ledgerName(failure.ledger)}: `}
          <bdi dir="ltr">{`${text(failure.from)}/${text(failure.to)} ${text(failure.on)}`}</bdi>
        </>
      );
    case 'mappings': {
      if (typeof failure.role !== 'string') return f.other;
      const role = (ACCOUNT_ROLES as readonly string[]).includes(failure.role)
        ? ar.chart.roles[failure.role as AccountRole]
        : failure.role;
      return failure.reason === 'role_missing'
        ? fill(f.roleMissing, { role })
        : fill(f.roleBlocked, { role, account: text(failure.account) });
    }
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

/** Where a failing check is fixed (S10 "Screens" step 2): the rates, the account roles, the lines. */
function checkLink(
  check: OpeningViewAnswer['checks'][number],
): { to: '/rates' | '/chart/roles'; label: string } | { hash: 'records'; label: string } | null {
  switch (check.check) {
    case 'rates':
      return { to: '/rates', label: r.links.rates };
    case 'mappings':
      return check.failures.every((failure) => typeof failure.role === 'string')
        ? { to: '/chart/roles', label: r.links.roles }
        : null;
    case 'lines':
      return { hash: 'records', label: r.links.records };
    default:
      return null;
  }
}

/** The checks as the review's checklist, each failing item named under it with its link. */
export function checkItems(view: OpeningViewAnswer): ChecklistItemData[] {
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
                <FailureText check={check.check} failure={failure} />
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

/** The two steps' statuses (S10 "Screens"): done, needing attention, or not reached yet. */
export function stepStatuses(
  view: OpeningViewAnswer,
  dirty: boolean,
): Record<'records' | 'review', StepStatus> {
  if (view.state === 'posted') return { records: 'done', review: 'done' };
  const records =
    dirty || !passed(view, 'lines')
      ? 'attention'
      : view.recordLines.length === 0
        ? 'pending'
        : 'done';
  const review = view.checks.every((check) => check.passed) && !dirty ? 'pending' : 'attention';
  return { records, review };
}
