import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addBulletinHolidaySchema,
  type BulletinHoliday,
  bulletinHolidaySchema,
  rateCalendarSchema,
  updateRateCalendarSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { CircleCheckIcon, InfoIcon } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { api } from '../../lib/api';
import { formatDay, isoWeekday } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { rateCalendarQuery } from './rate-queries';

const t = ar.rates;
const c = t.calendar;
const WEEKDAYS = [6, 7, 1, 2, 3, 4, 5] as const;

/**
 * `/rates/calendar` (S02 rule 17): the bulletin's weekly days off and its holidays. A day off or a
 * holiday takes the last bulletin published before it; a change affects only postings after it.
 * Owners and accountants change it; every role reads it.
 */
export function RateCalendarPage() {
  const { companyId, me, membership } = useCompany();
  const manage = can(me, 'rates.manage') && !membership.company.archived;
  const calendar = useQuery(rateCalendarQuery(companyId));

  return (
    <>
      <PageHeader title={c.title} description={c.description} />
      {!can(me, 'rates.manage') && <Callout tone="info" icon={<InfoIcon />} title={t.readOnly} />}
      {calendar.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
        </div>
      ) : calendar.isError ? (
        <FormError error={calendar.error} />
      ) : (
        <>
          <DaysOff daysOff={calendar.data.daysOff} manage={manage} />
          <Holidays holidays={calendar.data.holidays} manage={manage} />
        </>
      )}
    </>
  );
}

function DaysOff({ daysOff, manage }: { daysOff: readonly number[]; manage: boolean }) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const [days, setDays] = useState<number[]>([...daysOff]);
  const [invalid, setInvalid] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const save = useMutation({
    mutationFn: (body: unknown) =>
      api('PUT', '/rate-calendar', { company: companyId, body, schema: rateCalendarSchema }),
    onSuccess: (calendar) =>
      queryClient.setQueryData(rateCalendarQuery(companyId).queryKey, calendar),
  });
  const changed = [...days].sort().join() !== [...daysOff].sort().join();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{c.daysOff}</CardTitle>
        <CardDescription>{c.daysOffHint}</CardDescription>
      </CardHeader>
      <form
        noValidate
        className="flex flex-col gap-4 px-6 pb-6"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = updateRateCalendarSchema.safeParse({ daysOff: [...days].sort() });
          setInvalid(!parsed.success);
          if (parsed.success) save.mutate(parsed.data);
          else setAttempt((count) => count + 1);
        }}
      >
        <FormErrorSummary
          attempt={attempt}
          errors={[['days-off', invalid ? c.daysOffInvalid : undefined]]}
        />
        <fieldset id="days-off" className="flex flex-wrap gap-x-6 gap-y-3" aria-label={c.daysOff}>
          {WEEKDAYS.map((day) => (
            // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's checkbox is the control.
            <label key={day} className="flex items-center gap-2 text-control text-foreground">
              <Checkbox
                checked={days.includes(day)}
                disabled={!manage}
                onCheckedChange={(checked) => {
                  setInvalid(false);
                  save.reset();
                  setDays(checked ? [...days, day] : days.filter((other) => other !== day));
                }}
              />
              {t.weekdays[day]}
            </label>
          ))}
        </fieldset>
        {invalid && (
          <p role="alert" className="text-control text-destructive-text">
            {c.daysOffInvalid}
          </p>
        )}
        <p className="text-control text-muted-foreground">{c.effect}</p>
        <FormError error={save.error} />
        {save.isSuccess && !changed && (
          <Callout role="status" tone="info" icon={<CircleCheckIcon />} title={c.saved} />
        )}
        {manage && (
          <Button type="submit" className="w-fit" disabled={!changed} loading={save.isPending}>
            {c.save}
          </Button>
        )}
      </form>
    </Card>
  );
}

function Holidays({ holidays, manage }: { holidays: readonly BulletinHoliday[]; manage: boolean }) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const [on, setOn] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ on?: string; note?: string }>({});
  const [attempt, setAttempt] = useState(0);
  const [removing, setRemoving] = useState<BulletinHoliday | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['rates', companyId] });
  const add = useMutation({
    mutationFn: (body: unknown) =>
      api('POST', '/rate-calendar/holidays', {
        company: companyId,
        body,
        schema: bulletinHolidaySchema,
      }),
    onSuccess: async () => {
      setOn('');
      setNote('');
      await refresh();
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{c.holidays}</CardTitle>
      </CardHeader>
      <div className="flex min-w-0 flex-col gap-4 px-6 pb-6">
        <FormErrorSummary
          attempt={attempt}
          errors={[
            ['holiday-on', errors.on],
            ['holiday-note', errors.note],
          ]}
        />
        {manage && (
          <form
            noValidate
            className="flex flex-wrap items-start gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = addBulletinHolidaySchema.safeParse({ on, note });
              if (!parsed.success) {
                const paths = new Set(parsed.error.issues.map((issue) => issue.path[0]));
                setErrors({
                  ...(paths.has('on') ? { on: t.validation.required } : {}),
                  ...(paths.has('note') ? { note: t.validation.required } : {}),
                });
                setAttempt((count) => count + 1);
                return;
              }
              setErrors({});
              add.mutate(parsed.data);
            }}
          >
            <Field id="holiday-on" className="w-48" invalid={errors.on !== undefined}>
              <FieldLabel>{c.holidayOn}</FieldLabel>
              <Input
                type="date"
                dir="ltr"
                value={on}
                onChange={(event) => {
                  add.reset();
                  setOn(event.target.value);
                }}
              />
              <FieldError match={errors.on !== undefined}>{errors.on}</FieldError>
            </Field>
            <Field
              id="holiday-note"
              className="min-w-0 flex-1 basis-60"
              invalid={errors.note !== undefined}
            >
              <FieldLabel>{c.note}</FieldLabel>
              <Input
                value={note}
                maxLength={200}
                onChange={(event) => setNote(event.target.value)}
              />
              <FieldError match={errors.note !== undefined}>{errors.note}</FieldError>
            </Field>
            <Button type="submit" className="mt-6" loading={add.isPending}>
              {c.add}
            </Button>
          </form>
        )}
        <FormError error={add.error} />
        {add.isSuccess && (
          <Callout role="status" tone="info" icon={<CircleCheckIcon />} title={c.added} />
        )}
        {holidays.length === 0 ? (
          <EmptyState title={c.emptyHolidays} />
        ) : (
          <Table aria-label={c.holidaysLabel}>
            <TableHeader>
              <TableRow>
                <TableHead>{c.holidayOn}</TableHead>
                <TableHead>{c.note}</TableHead>
                {manage && (
                  <TableHead>
                    <span className="sr-only">{c.remove}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {holidays.map((holiday) => (
                <TableRow key={holiday.id}>
                  <TableCell>
                    <span className="flex flex-col">
                      <span>{formatDay(holiday.on)}</span>
                      <span className="text-muted-foreground text-xs">
                        {t.weekdays[isoWeekday(holiday.on)]}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <bdi>{holiday.note}</bdi>
                  </TableCell>
                  {manage && (
                    <TableCell className="text-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${c.remove}: ${formatDay(holiday.on)}`}
                        onClick={() => setRemoving(holiday)}
                      >
                        {c.remove}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing ? `${c.removeTitle}: ${formatDay(removing.on)}` : ''}
        description={c.removeDescription}
        submitLabel={c.remove}
        destructive
        onConfirm={() =>
          api('POST', `/rate-calendar/holidays/${removing?.id}/remove`, {
            company: companyId,
            schema: bulletinHolidaySchema,
          })
        }
        onDone={refresh}
      />
    </Card>
  );
}
