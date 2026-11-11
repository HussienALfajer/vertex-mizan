import { useMutation, useQuery } from '@tanstack/react-query';
import {
  type AmountTextError,
  type CurrencyCode,
  type SplitRemainder,
  splitRemainderSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  AmountInput,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Skeleton,
  Textarea,
} from '@vertex-mizan/ui';
import { useState } from 'react';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { ApiError, hasCode } from '../../lib/api';
import { useCompany } from '../../lib/session';
import { PreviewEntries } from './action-preview';
import { inboxActionPreviewQuery } from './revenue-queries';

const t = ar.revenue.actions.split;

/**
 * "تقسيم المتبقي" (S06 rules 15–16): the revenue part of a cancelled project's remainder, in the
 * project's currency, and a reason; the entry the split would post is previewed under the amount
 * as it is typed, the rest left as the refund payable. The currency is the remainder's, read from
 * the preview of the whole remainder refunded.
 */
export function SplitDialog({
  id,
  open,
  onOpenChange,
  onConfirm,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (body: SplitRemainder) => Promise<unknown>;
}) {
  const { companyId } = useCompany();
  const [value, setValue] = useState<bigint | null>(null);
  const [textError, setTextError] = useState<AmountTextError | null>(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ revenue?: string; reason?: string }>({});
  const [attempt, setAttempt] = useState(0);
  const whole = useQuery({
    ...inboxActionPreviewQuery(companyId, id, {
      action: 'split-remainder',
      revenueAmount: '0',
    }),
    enabled: open,
  });
  const currency: CurrencyCode | undefined = whole.data?.entries[0]?.lines[0]?.amount.currency;
  const typed = value === null ? '0' : value.toString();
  const preview = useQuery({
    ...inboxActionPreviewQuery(companyId, id, { action: 'split-remainder', revenueAmount: typed }),
    enabled: open && textError === null,
  });
  const confirm = useMutation({
    mutationFn: (body: SplitRemainder) => onConfirm(body),
    onSuccess: () => close(),
  });

  function close() {
    setValue(null);
    setTextError(null);
    setReason('');
    setErrors({});
    setAttempt(0);
    confirm.reset();
    onOpenChange(false);
  }

  const remainingMinor =
    preview.error instanceof ApiError && hasCode(preview.error, 'VALIDATION_FAILED')
      ? preview.error.details?.remainingMinor
      : undefined;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent closeLabel={ar.common.close} className="sm:max-w-3xl">
        <form
          noValidate
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const revenueError =
              textError !== null
                ? ar.accounting.amountInput[textError]
                : value === null
                  ? t.revenueRequired
                  : undefined;
            const parsed = splitRemainderSchema.safeParse({
              revenueAmount: value === null ? '' : value.toString(),
              reason,
            });
            if (revenueError !== undefined || !parsed.success) {
              setErrors({
                ...(revenueError === undefined ? {} : { revenue: revenueError }),
                ...(reason.trim() ? {} : { reason: t.reasonRequired }),
              });
              setAttempt((count) => count + 1);
              return;
            }
            setErrors({});
            confirm.mutate(parsed.data);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{t.description}</DialogDescription>
          </DialogHeader>
          <FormErrorSummary
            attempt={attempt}
            errors={[
              ['split-revenue', errors.revenue],
              ['split-reason', errors.reason],
            ]}
          />
          {currency === undefined ? (
            whole.isError ? (
              <FormError error={whole.error} />
            ) : whole.data ? (
              // Held with nothing to post: the hold says why no part can be typed.
              <PreviewEntries preview={whole.data} />
            ) : (
              <Skeleton className="h-control" />
            )
          ) : (
            <Field id="split-revenue" invalid={errors.revenue !== undefined}>
              <FieldLabel>
                {`${t.revenue} `}
                <bdi dir="ltr">{currency}</bdi>
              </FieldLabel>
              <AmountInput
                currency={currency}
                value={value}
                allowNegative={false}
                onValueChange={(next) => {
                  confirm.reset();
                  setValue(next);
                }}
                onTextError={setTextError}
              />
              <FieldDescription>{t.revenueHint}</FieldDescription>
              <FieldError match={errors.revenue !== undefined}>{errors.revenue}</FieldError>
            </Field>
          )}
          <Field id="split-reason" invalid={errors.reason !== undefined}>
            <FieldLabel>{t.reason}</FieldLabel>
            <Textarea
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
            <FieldError match={errors.reason !== undefined}>{errors.reason}</FieldError>
          </Field>
          <section aria-labelledby="split-entry" className="flex min-w-0 flex-col gap-2">
            <h3 id="split-entry" className="font-bold">
              {t.entry}
            </h3>
            {remainingMinor !== undefined && currency !== undefined ? (
              <p role="alert" className="text-destructive-text">
                {`${t.outside} `}
                <Amount value={BigInt(remainingMinor)} currency={currency} showCurrency />
              </p>
            ) : preview.isError ? (
              <FormError error={preview.error} />
            ) : preview.data ? (
              <PreviewEntries preview={preview.data} />
            ) : (
              <Skeleton className="h-row" />
            )}
          </section>
          <FormError error={confirm.error} />
          <DialogFooter>
            <Button type="submit" loading={confirm.isPending}>
              {t.confirm}
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              {t.cancel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
