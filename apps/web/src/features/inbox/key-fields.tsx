import {
  EVENT_PAYLOADS_V1,
  EVENT_TYPES,
  type EventEnvelope,
  type EventType,
  type HubCurrency,
  hubMinor,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Amount } from '@vertex-mizan/ui';
import type { ReactNode } from 'react';
import { formatDay } from '../../lib/format';
import { Fact } from '../entries/entry-parts';

const t = ar.inbox.fields;

type Field = readonly [label: string, value: ReactNode];

const money = (amount: number, currency: HubCurrency) => (
  <Amount value={hubMinor(amount)} currency={currency} showCurrency />
);
const name = (value: { name: string; code?: string | undefined }) => (
  <span className="inline-flex flex-wrap items-baseline gap-x-2">
    {value.code && (
      <bdi dir="ltr" className="font-medium tabular-nums">
        {value.code}
      </bdi>
    )}
    <bdi>{value.name}</bdi>
  </span>
);
const number = (value: string) => <bdi dir="ltr">{value}</bdi>;
const day = (value: string) => formatDay(value);
const text = (value: string) => <bdi>{value}</bdi>;

type Payload<T extends EventType> = Extract<EventEnvelope, { type: T }>['payload'];

/** The fields that matter of each event type, in the order the accountant reads them. */
function fieldsOf(event: { type: EventType; payload: unknown }): Field[] {
  const p = event.payload;
  switch (event.type) {
    case 'invoice.issued': {
      const invoice = p as Payload<'invoice.issued'>;
      return [
        [t.client, name(invoice.client)],
        ...(invoice.contract ? [[t.contract, name(invoice.contract)] as const] : []),
        [t.issuedOn, day(invoice.issued_on)],
        [t.dueOn, day(invoice.due_on)],
        [t.sypPerUsd, number(invoice.syp_per_usd)],
        ...invoice.lines.map(
          (line, index) =>
            [
              `${t.line} ${index + 1}`,
              <span key={line.id} className="flex flex-col items-start gap-0.5">
                {money(line.amount, invoice.currency)}
                <span className="text-muted-foreground text-xs">
                  {name(line.service)}
                  {line.description && <> · {text(line.description)}</>}
                </span>
              </span>,
            ] as const,
        ),
      ];
    }
    case 'invoice.voided': {
      const voided = p as Payload<'invoice.voided'>;
      return [
        [t.invoice, number(voided.invoice.number)],
        [t.voidedOn, day(voided.voided_on)],
        [t.reason, text(voided.reason)],
      ];
    }
    case 'invoice.line_service_changed': {
      const changed = p as Payload<'invoice.line_service_changed'>;
      return [
        [t.invoice, number(changed.invoice.number)],
        [t.oldService, name(changed.old_service)],
        [t.newService, name(changed.new_service)],
        [t.changedOn, day(changed.changed_on)],
      ];
    }
    case 'invoice.due_date_changed': {
      const changed = p as Payload<'invoice.due_date_changed'>;
      return [
        [t.invoice, number(changed.invoice.number)],
        [t.dueOn, day(changed.due_on)],
      ];
    }
    case 'payment.recorded': {
      const payment = p as Payload<'payment.recorded'>;
      return [
        [t.invoice, number(payment.invoice.number)],
        [t.paidOn, day(payment.paid_on)],
        [t.method, ar.inbox.methods[payment.method]],
        [t.amount, money(payment.amount, payment.currency)],
        [t.applied, money(payment.applied_amount, payment.invoice_currency)],
        [t.sypPerUsd, number(payment.syp_per_usd)],
      ];
    }
    case 'payment.voided': {
      const voided = p as Payload<'payment.voided'>;
      return [
        [t.invoice, number(voided.invoice.number)],
        [t.voidedOn, day(voided.voided_on)],
        ...(voided.reason ? [[t.reason, text(voided.reason)] as const] : []),
      ];
    }
    case 'milestone.done': {
      const milestone = p as Payload<'milestone.done'>;
      return [
        [t.client, name(milestone.client)],
        [t.project, name(milestone.project)],
        [t.amount, money(milestone.amount, milestone.currency)],
        [t.doneOn, day(milestone.done_on)],
      ];
    }
    case 'milestone.reopened': {
      const reopened = p as Payload<'milestone.reopened'>;
      return [
        [t.milestone, number(reopened.milestone.number)],
        [t.client, name(reopened.client)],
        [t.project, name(reopened.project)],
        [t.reopenedOn, day(reopened.reopened_on)],
      ];
    }
    case 'project.completed':
    case 'project.cancelled': {
      const project = p as Payload<'project.completed'>;
      return [
        [t.client, name(project.client)],
        [t.project, name(project.project)],
        [t.on, day(project.on)],
      ];
    }
    case 'project_expense.recorded':
    case 'project_expense.changed': {
      const expense = p as Payload<'project_expense.recorded'>;
      return [
        [t.client, name(expense.client)],
        ...(expense.contract ? [[t.contract, name(expense.contract)] as const] : []),
        [t.department, name(expense.department)],
        [t.spentOn, day(expense.spent_on)],
        [t.amount, money(expense.amount, expense.currency)],
        [t.sypPerUsd, number(expense.syp_per_usd)],
        [t.description, text(expense.description)],
        ...(expense.changed_on ? [[t.changedOn, day(expense.changed_on)] as const] : []),
      ];
    }
    case 'project_expense.archived': {
      const archived = p as Payload<'project_expense.archived'>;
      return [[t.archivedOn, day(archived.archived_on)]];
    }
    case 'ad_wallet.deposited':
    case 'ad_wallet.refunded': {
      const entry = p as Payload<'ad_wallet.deposited'>;
      return [
        [t.client, name(entry.client)],
        [t.enteredOn, day(entry.entered_on)],
        [t.method, ar.inbox.methods[entry.method]],
        [t.amount, money(entry.amount, entry.currency)],
        [t.usdAmount, money(entry.usd_amount, 'USD')],
        [t.sypPerUsd, number(entry.syp_per_usd)],
      ];
    }
    case 'ad_wallet.entry_voided': {
      const voided = p as Payload<'ad_wallet.entry_voided'>;
      return [
        [t.client, name(voided.client)],
        [t.voidedOn, day(voided.voided_on)],
      ];
    }
    case 'ad_spend.recorded':
    case 'ad_spend.changed': {
      const spend = p as Payload<'ad_spend.recorded'>;
      return [
        [t.client, name(spend.client)],
        [t.campaign, number(spend.campaign.number)],
        [
          t.period,
          <span key="period">
            {day(spend.period_from)} – {day(spend.period_to)}
          </span>,
        ],
        [t.usdSpend, money(spend.usd_spend, 'USD')],
        ...(spend.changed_on ? [[t.changedOn, day(spend.changed_on)] as const] : []),
      ];
    }
    case 'ad_spend.archived': {
      const archived = p as Payload<'ad_spend.archived'>;
      return [
        [t.client, name(archived.client)],
        [t.campaign, number(archived.campaign.number)],
        [t.archivedOn, day(archived.archived_on)],
      ];
    }
    case 'rate.changed': {
      const rate = p as Payload<'rate.changed'>;
      return [
        [t.effectiveOn, day(rate.effective_on)],
        [t.sypPerUsd, number(rate.syp_per_usd)],
      ];
    }
  }
}

/**
 * An event's key fields (S05 "Screens"), read from its payload with the contract's schema of its
 * type at version 1; amounts through `Amount`, codes and numbers LTR. A version or shape this
 * build does not know shows `fallback` instead (the raw JSON stays below it).
 */
export function KeyFields({
  type,
  version,
  payload,
  fallback,
}: {
  type: string;
  version: number;
  payload: unknown;
  fallback: ReactNode;
}) {
  if (version !== 1 || !(EVENT_TYPES as readonly string[]).includes(type)) return fallback;
  const known = type as EventType;
  const parsed = EVENT_PAYLOADS_V1[known].safeParse(payload);
  if (!parsed.success) return fallback;
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {fieldsOf({ type: known, payload: parsed.data }).map(([label, value]) => (
        <Fact key={label} label={label}>
          {value}
        </Fact>
      ))}
    </dl>
  );
}
