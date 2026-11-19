import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DayRates, dayRatesSchema, recordDayRatesSchema } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
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
  RateInput,
  Skeleton,
  Textarea,
} from '@vertex-mizan/ui';
import { useState } from 'react';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { api } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { dayRatesQuery, refreshBooks } from '../../lib/movements';

const t = ar.movements.rates;

/**
 * The day's rates (S13 "Currencies"): 1 USD in each other currency the company uses, recorded once
 * a day. Rates already recorded for the day are corrected with a reason (`RATE_REASON_REQUIRED`).
 */
export function DayRatesDialog({
  companyId,
  open,
  onOpenChange,
  date,
}: {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The day to record, a back-dated movement's; today in Damascus when left out. */
  date?: string | undefined;
}) {
  const rates = useQuery({ ...dayRatesQuery(companyId, date), enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={ar.common.close}>
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>{t.dialogDescription}</DialogDescription>
        </DialogHeader>
        {rates.isPending ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-control w-full" />
            <Skeleton className="h-control w-full" />
          </div>
        ) : rates.isError ? (
          <FormError error={rates.error} />
        ) : (
          <RatesForm
            key={rates.dataUpdatedAt}
            companyId={companyId}
            day={rates.data}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RatesForm({
  companyId,
  day,
  onDone,
}: {
  companyId: string;
  day: DayRates;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => day.rates.map((rate) => rate.rate));
  const [invalid, setInvalid] = useState(() => day.rates.map(() => false));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<(string | undefined)[]>([]);
  const [attempt, setAttempt] = useState(0);
  // Rates recorded for this very day are a correction, kept with its reason.
  const correcting = day.rates.some((rate) => rate.effectiveOn === day.date);
  const save = useMutation({
    mutationFn: (body: unknown) =>
      api('POST', '/day-rates', { company: companyId, body, schema: dayRatesSchema }),
    onSuccess: async () => {
      await refreshBooks(queryClient, companyId);
      onDone();
    },
  });
  const ids = day.rates.map((rate) => `rate-${rate.quote}`);

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const found = day.rates.map((_, index) =>
          invalid[index] || values[index] === null ? t.invalid : undefined,
        );
        const reasonError =
          correcting && reason.trim() === '' ? ar.movements.dialog.required : undefined;
        setErrors([...found, reasonError]);
        if (found.some(Boolean) || reasonError) {
          setAttempt((count) => count + 1);
          return;
        }
        const body = recordDayRatesSchema.parse({
          date: day.date,
          rates: day.rates.map((rate, index) => ({
            base: rate.base,
            quote: rate.quote,
            rate: values[index],
          })),
          reason: correcting ? reason : null,
        });
        save.mutate(body);
      }}
    >
      <p className="text-control text-muted-foreground">{formatDay(day.date)}</p>
      <FormErrorSummary
        attempt={attempt}
        errors={[
          ...ids.map((id, index) => [id, errors[index]] as const),
          ['rate-reason', errors[ids.length]],
        ]}
      />
      {day.rates.map((rate, index) => (
        <Field key={rate.quote} id={ids[index]} invalid={errors[index] !== undefined}>
          <FieldLabel>{`${t.rateOf}${ar.accounting.currencies[rate.quote]}`}</FieldLabel>
          <RateInput
            value={values[index] ?? null}
            onValueChange={(value) =>
              setValues((all) => all.map((old, at) => (at === index ? value : old)))
            }
            onTextError={(bad) =>
              setInvalid((all) => all.map((old, at) => (at === index ? bad : old)))
            }
          />
          <FieldDescription>{t.perUsd}</FieldDescription>
          <FieldError match={errors[index] !== undefined}>{errors[index]}</FieldError>
        </Field>
      ))}
      {correcting && (
        <Field id="rate-reason" invalid={errors[ids.length] !== undefined}>
          <FieldLabel>{t.reason}</FieldLabel>
          <Textarea
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
          <FieldDescription>{t.reasonHint}</FieldDescription>
          <FieldError match={errors[ids.length] !== undefined}>{errors[ids.length]}</FieldError>
        </Field>
      )}
      <FormError error={save.error} />
      <DialogFooter>
        <Button type="submit" loading={save.isPending}>
          {t.save}
        </Button>
      </DialogFooter>
    </form>
  );
}
