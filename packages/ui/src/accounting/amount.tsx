import { amountParts, type CurrencyCode, formatMinor } from '@vertex-mizan/contracts';
import { type ComponentProps, Fragment } from 'react';
import { cn } from '../lib/cn';

type AmountProps = Omit<ComponentProps<'bdi'>, 'children' | 'dir'> & {
  /** The amount in minor units of `currency` (ADR 0007). */
  value: bigint;
  currency: CurrencyCode;
  /** Shows the ISO code after the figure, inside the same isolate (where no column header says it). */
  showCurrency?: boolean;
  /** `dash` shows zero as `–` (a statement's choice, S09); screens and ledgers keep `0.00`. */
  zero?: 'digits' | 'dash';
  /**
   * A total: bold, with its separators at the regular weight. Montserrat's tabular digits are as
   * wide in every weight, but its separators widen in bold; this keeps a bold total aligned digit
   * for digit with the figures above it (ADR 0010 §3).
   */
  strong?: boolean;
};

/**
 * One amount (ADR 0009, ADR 0010 §3): Latin tabular digits, grouped by three, every decimal of the
 * currency, never abbreviated or truncated. A negative amount carries the minus sign and the
 * `negative` color. The figure, its sign and its code are one LTR isolate, so the sign never moves
 * inside Arabic text; the text is ASCII, so a copied figure pastes into Excel as a number.
 */
function Amount({
  value,
  currency,
  showCurrency = false,
  zero = 'digits',
  strong = false,
  className,
  ...props
}: AmountProps) {
  const { negative, groups, fraction } = amountParts(value, currency);
  const dash = zero === 'dash' && value === 0n;
  return (
    <bdi
      data-slot="amount"
      data-negative={negative || undefined}
      dir="ltr"
      className={cn(
        'whitespace-nowrap tabular-nums',
        negative && 'text-negative',
        strong && 'font-bold',
        className,
      )}
      {...props}
    >
      {dash ? (
        <>
          <span aria-hidden="true">–</span>
          <span className="sr-only">{formatMinor(value, currency)}</span>
        </>
      ) : strong ? (
        <>
          {negative && '-'}
          {groups.map((group, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a group is identified by its position.
            <Fragment key={i}>
              {i > 0 && <span className="font-normal">,</span>}
              {group}
            </Fragment>
          ))}
          {fraction && (
            <>
              <span className="font-normal">.</span>
              {fraction}
            </>
          )}
        </>
      ) : (
        formatMinor(value, currency)
      )}
      {showCurrency && <span className="ms-1 font-normal">{currency}</span>}
    </bdi>
  );
}

export { Amount, type AmountProps };
