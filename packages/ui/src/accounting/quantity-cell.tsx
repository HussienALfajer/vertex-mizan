import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/**
 * A quantity as text, grouped by three in its whole part (`1234.500` → `1,234.500`), its decimals as
 * given or, with `trim`, without trailing zeros (`6.000` → `6`, `6.500` → `6.5`). Latin digits and
 * an ASCII minus; never parsed into a float. Text that is not a decimal is returned as it is.
 */
export function formatQuantity(quantity: string, trim = false): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(quantity.trim());
  if (!match) return quantity;
  const [, sign = '', whole = '0', fraction = ''] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimals = trim ? fraction.replace(/0+$/, '') : fraction;
  const zero = /^0*$/.test(whole) && /^0*$/.test(fraction);
  return `${zero ? '' : sign}${grouped}${decimals ? `.${decimals}` : ''}`;
}

type QuantityCellProps = Omit<ComponentProps<'bdi'>, 'children' | 'dir'> & {
  /** The quantity as the API writes it: a decimal string with up to 3 places (S12 rule 5). */
  quantity: string;
  /** Its unit as typed (طن، م³، يوم); shown after the figure, outside the LTR isolate. */
  unit?: string | null | undefined;
  /** Drops trailing zeros (a wage sheet's days: `6`, not `6.000`). */
  trim?: boolean;
  strong?: boolean;
};

/**
 * One quantity with its unit (S12 "Screens", ADR 0010 §3, §7): the figure is an LTR isolate with
 * tabular Latin digits, like `Amount`, so its sign never moves inside Arabic text; a negative
 * quantity (a quantity out, rule 5) carries its minus and the `negative` color. The unit follows
 * the figure in the reading order, as Arabic text. A quantity is never an amount: it has no
 * currency and is never formatted by the money module.
 */
function QuantityCell({
  quantity,
  unit,
  trim = false,
  strong = false,
  className,
  ...props
}: QuantityCellProps) {
  const text = formatQuantity(quantity, trim);
  const negative = text.startsWith('-');
  return (
    <span data-slot="quantity" className={cn('inline-flex items-baseline gap-1', className)}>
      <bdi
        dir="ltr"
        data-negative={negative || undefined}
        className={cn(
          'whitespace-nowrap tabular-nums',
          negative && 'text-negative',
          strong && 'font-bold',
        )}
        {...props}
      >
        {text}
      </bdi>
      {unit ? <bdi className="text-muted-foreground text-xs">{unit}</bdi> : null}
    </span>
  );
}

export { QuantityCell, type QuantityCellProps };
