import { BanIcon, FolderTreeIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Badge } from '../components/badge';
import { cn } from '../lib/cn';

type AccountLabelProps = Omit<ComponentProps<'span'>, 'children'> & {
  code: string;
  /** The account's name as the company wrote it: Arabic, English or both. */
  name: string;
} & (
    | { kind?: 'postable'; kindLabel?: never }
    | {
        /**
         * A header account (never posted to) or a blocked one, shown with an icon and the
         * required `kindLabel` text, never color alone (ADR 0010 §5).
         */
        kind: 'header' | 'blocked';
        kindLabel: string;
      }
  );

/**
 * An account as accountants read it: the code first, isolated left to right, then the name in its
 * own direction, so a mixed name ("مصاريف Google Ads") never reorders the code or the punctuation
 * around it (ADR 0010 §3). A long name is cut with an ellipsis; the code never is.
 */
function AccountLabel({
  code,
  name,
  kind = 'postable',
  kindLabel,
  className,
  ...props
}: AccountLabelProps) {
  const Icon = kind === 'header' ? FolderTreeIcon : kind === 'blocked' ? BanIcon : undefined;
  return (
    <span
      data-slot="account-label"
      data-kind={kind}
      className={cn('inline-flex min-w-0 items-baseline gap-2', className)}
      {...props}
    >
      <bdi dir="ltr" className="shrink-0 font-medium tabular-nums">
        {code}
      </bdi>
      <bdi className={cn('min-w-0 truncate', kind === 'header' && 'font-medium')}>{name}</bdi>
      {Icon && (
        <Badge tone={kind === 'blocked' ? 'danger' : 'neutral'} className="self-center">
          <Icon aria-hidden="true" />
          {kindLabel}
        </Badge>
      )}
    </span>
  );
}

export { AccountLabel, type AccountLabelProps };
