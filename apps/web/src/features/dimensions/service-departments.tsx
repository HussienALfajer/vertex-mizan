import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type DimensionValue,
  serviceDepartmentHistorySchema,
  setServiceDepartmentSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DimensionPicker,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@vertex-mizan/ui';
import { useState } from 'react';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { api } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { dimensionPickerLabels, pickerValues } from '../entries/entry-parts';
import { useDimensionCatalog } from '../entries/entry-queries';
import { ReportValueName } from '../reports/report-parts';
import { serviceDepartmentsQuery } from '../reports/reports-queries';

const t = ar.dimensions.departments;

/**
 * A service's department history (S09 rules 32–34, "Screens"): every dated row, oldest first, with
 * its source, who set it and why; a manual service takes a new row from an open month's date with
 * a reason, for the owner and accountant (`dimensions.manage`). A Hub service's department comes
 * only from Hub, so its sheet only reads.
 */
export function ServiceDepartmentsDialog({
  service,
  manage,
  onClose,
}: {
  service: DimensionValue;
  manage: boolean;
  onClose: () => void;
}) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const history = useQuery(serviceDepartmentsQuery(companyId, service.id));
  const catalog = useDimensionCatalog(companyId);
  const departmentType = catalog.types.find((type) => type.code === 'department');
  const departments = departmentType ? catalog.valuesOf(departmentType.id) : [];
  const [department, setDepartment] = useState<string | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reason, setReason] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [missing, setMissing] = useState(false);
  const save = useMutation({
    mutationFn: (body: { departmentValueId: string; effectiveFrom: string; reason: string }) =>
      api('POST', `/dimension-values/${service.id}/departments`, {
        company: companyId,
        body,
        schema: serviceDepartmentHistorySchema,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(serviceDepartmentsQuery(companyId, service.id).queryKey, next);
      setDepartment(null);
      setEffectiveFrom('');
      setReason('');
      setMissing(false);
    },
  });
  const data = history.data;
  const canAdd = manage && data !== undefined && !data.fromHub;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={ar.common.close} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{`${t.title}: ${service.name}`}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        {history.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-row" />
            <Skeleton className="h-row" />
          </div>
        ) : history.isError ? (
          <FormError error={history.error} />
        ) : data && data.rows.length === 0 ? (
          <p className="text-muted-foreground">{t.empty}</p>
        ) : data ? (
          <Table aria-label={t.caption}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.effectiveFrom}</TableHead>
                <TableHead>{t.department}</TableHead>
                <TableHead>{t.source}</TableHead>
                <TableHead className="max-sm:hidden">{t.recordedBy}</TableHead>
                <TableHead className="max-md:hidden">{t.reason}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{formatDay(row.effectiveFrom)}</TableCell>
                  <TableCell>
                    <ReportValueName value={row.department} />
                  </TableCell>
                  <TableCell>
                    <Badge tone={row.source === 'hub' ? 'info' : 'outline'}>
                      {t.sources[row.source]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-sm:hidden">
                    <span className="flex flex-col">
                      {row.recordedBy && <bdi>{row.recordedBy.name}</bdi>}
                      <bdi className="text-xs text-muted-foreground">
                        {formatDateTime(row.createdAt)}
                      </bdi>
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-normal max-md:hidden">
                    {row.reason && <bdi>{row.reason}</bdi>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        {data?.fromHub && <p className="text-sm text-muted-foreground">{t.fromHub}</p>}
        {canAdd && (
          <form
            aria-label={t.addTitle}
            className="flex flex-col gap-3 border-t border-border pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = setServiceDepartmentSchema.safeParse({
                departmentValueId: department ?? '',
                effectiveFrom,
                reason,
              });
              if (!parsed.success) {
                setMissing(true);
                setAttempt((count) => count + 1);
                return;
              }
              save.mutate(parsed.data);
            }}
          >
            <h3 className="font-bold">{t.addTitle}</h3>
            <FormErrorSummary
              attempt={attempt}
              errors={[['department-reason', missing ? t.required : undefined]]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <DimensionPicker
                label={t.department}
                values={pickerValues(departments)}
                value={department}
                labels={dimensionPickerLabels}
                onValueChange={setDepartment}
              />
              <Field>
                <FieldLabel>{t.effectiveFrom}</FieldLabel>
                <Input
                  type="date"
                  dir="ltr"
                  value={effectiveFrom}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                />
                <FieldDescription>{t.effectiveHint}</FieldDescription>
              </Field>
            </div>
            <Field id="department-reason" invalid={missing && reason.trim() === ''}>
              <FieldLabel>{t.reason}</FieldLabel>
              <Textarea
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <FormError error={save.error} />
            {save.isSuccess && (
              <p role="status" className="text-sm text-muted-foreground">
                {t.saved}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" loading={save.isPending}>
                {t.submit}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
