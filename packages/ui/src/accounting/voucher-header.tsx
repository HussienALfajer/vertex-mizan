import type { CurrencyCode } from '@vertex-mizan/contracts';
import type { ComponentProps, ReactNode } from 'react';
import { Badge } from '../components/badge';
import { cn } from '../lib/cn';
import { AccountLabel } from './account-label';
import { Amount } from './amount';

/** The cash account a voucher header shows with its balance (S11). */
export interface VoucherHeaderAccount {
  readonly code: string;
  readonly name: string;
  readonly currency: CurrencyCode;
  /** The account's balance in its currency, in minor units. */
  readonly balanceMinor: bigint;
}

/**
 * A voucher's header (S11 "Screens", ADR 0010 §7): its kind as the heading, its number (an LTR
 * isolate, or the pending text until it posts: a number is given only at posting), its date, a
 * state such as "ملغى", each cash account with its balance through `Amount`, and the fields or
 * facts the app passes as children (date, cash account, party), laid out one column on a phone and
 * three from a tablet. Labels come in as props; nothing is computed here.
 */
function VoucherHeader({
  kind,
  number,
  labels,
  date,
  state,
  accounts = [],
  children,
  className,
  ...props
}: Omit<ComponentProps<'section'>, 'children'> & {
  /** The kind's name, the heading ("سند قبض"). */
  kind: string;
  /** The printed number (`2026/15`), or null before posting. */
  number: string | null;
  labels: {
    readonly number: string;
    /** "يُعطى عند الترحيل". */
    readonly numberPending: string;
    readonly date: string;
    /** The balance's name ("الرصيد"). */
    readonly balance: string;
  };
  /** The voucher's date, `YYYY-MM-DD`, shown when no field edits it. */
  date?: string | undefined;
  /** A state shown beside the heading, such as cancelled. */
  state?: { readonly label: string; readonly tone: 'danger' | 'success' | 'neutral' } | undefined;
  /** The cash accounts the voucher moves, each with its role ("من حساب") and balance. */
  accounts?: readonly (VoucherHeaderAccount & { readonly role: string })[];
  children?: ReactNode;
}) {
  return (
    <section
      data-slot="voucher-header"
      className={cn(
        'flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 text-surface-foreground',
        className,
      )}
      {...props}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-lg">{kind}</h2>
          {state && <Badge tone={state.tone}>{state.label}</Badge>}
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-control">
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">{labels.number}</dt>
            <dd data-slot="voucher-number">
              {number === null ? (
                <span className="text-muted-foreground">{labels.numberPending}</span>
              ) : (
                <bdi dir="ltr" className="font-medium">
                  {number}
                </bdi>
              )}
            </dd>
          </div>
          {date !== undefined && (
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">{labels.date}</dt>
              <dd>
                <bdi dir="ltr">{date}</bdi>
              </dd>
            </div>
          )}
        </dl>
      </div>
      {accounts.length > 0 && (
        <dl className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-8">
          {accounts.map((account) => (
            <div
              key={`${account.role}:${account.code}`}
              data-slot="voucher-header-account"
              className="flex min-w-0 flex-col gap-0.5"
            >
              <dt className="text-muted-foreground text-xs">{account.role}</dt>
              <dd className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                <AccountLabel code={account.code} name={account.name} />
                <span className="flex items-baseline gap-1 text-control">
                  <span className="text-muted-foreground text-xs">{labels.balance}</span>
                  <Amount value={account.balanceMinor} currency={account.currency} showCurrency />
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {children !== undefined && (
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {children}
        </div>
      )}
    </section>
  );
}

export { VoucherHeader };
