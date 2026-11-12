import { Link } from '@tanstack/react-router';
import {
  HUB_DELIVERY_STATES,
  type HubDelivery,
  RECONCILIATION_ANNOTATIONS,
  RECONCILIATION_DAY_STATES,
  RECONCILIATION_KINDS,
  type ReconciliationAnnotationKind,
  type ReconciliationDayState,
  type ReconciliationKind,
  type ReconciliationMoney,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Amount, Button, ReconciliationDayBadge } from '@vertex-mizan/ui';
import { ArrowRightIcon } from 'lucide-react';

const t = ar.reconciliation;

// Mizan may answer what this build does not know yet (ADR 0006): each falls back to a neutral word.

const known = <T extends string>(list: readonly T[], value: string): value is T =>
  (list as readonly string[]).includes(value);

/** A day's state in Arabic. */
export function dayStateLabel(state: ReconciliationDayState | string): string {
  return known(RECONCILIATION_DAY_STATES, state) ? t.states[state] : t.unknownState;
}

/** A difference's kind in Arabic. */
export function kindLabel(kind: ReconciliationKind | string): string {
  return known(RECONCILIATION_KINDS, kind) ? t.kinds[kind] : t.unknownKind;
}

/** An annotation's kind in Arabic. */
export function annotationLabel(kind: ReconciliationAnnotationKind | string): string {
  return known(RECONCILIATION_ANNOTATIONS, kind) ? t.annotations[kind] : t.unknownAnnotation;
}

/** Hub's delivery state in Arabic. */
export function deliveryLabel(delivery: HubDelivery | string): string {
  return known(HUB_DELIVERY_STATES, delivery) ? t.delivery[delivery] : t.unknownDelivery;
}

/**
 * A day's state as a badge, with its gaps beside differences and "بعد الإقفال" when its month is
 * closed and the day is not clean (rule 15).
 */
export function DayState({
  state,
  gaps,
  closed,
}: {
  state: ReconciliationDayState;
  gaps?: number | undefined;
  closed: boolean;
}) {
  const unclean = state === 'differences' || state === 'missing';
  const parts = [
    state === 'differences' && gaps !== undefined && gaps > 0 ? `${t.gaps}: ${gaps}` : null,
    closed && unclean ? t.afterClose : null,
  ].filter((part) => part !== null);
  return (
    <ReconciliationDayBadge
      state={state}
      label={dayStateLabel(state)}
      detail={parts.length > 0 ? parts.join(ar.common.listSeparator) : null}
    />
  );
}

/** An amount with its Hub currency, or a dash for a type without one. */
export function MoneyText({ money }: { money: ReconciliationMoney | null }) {
  if (money === null) return <span className="text-muted-foreground">{t.day.totals.noAmount}</span>;
  return <Amount value={BigInt(money.amountMinor)} currency={money.currency} showCurrency />;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A client's id from the address, or none. */
export function clientParam(value: unknown): string | undefined {
  return typeof value === 'string' && UUID.test(value) ? value : undefined;
}

/** A month's search on `/reconciliation`. */
export function monthSearch(month: string, client: string | undefined) {
  return { month, ...(client ? { client } : {}) };
}

/** The way back to the month's days, above a day's title. */
export function MonthBackLink({ month, client }: { month: string; client: string | undefined }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-fit"
      render={<Link to="/reconciliation" search={monthSearch(month, client)} />}
    >
      <ArrowRightIcon aria-hidden="true" />
      {t.day.back}
    </Button>
  );
}
