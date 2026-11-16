import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createMaterialSchema,
  type Material,
  materialSchema,
  type UpdateMaterial,
  updateMaterialSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  Skeleton,
  SwitchField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { BoxesIcon, EllipsisIcon, LockIcon, PlusIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { api } from '../../lib/api';
import { can, useCompany } from '../../lib/session';
import { materialsQuery } from './project-queries';

const t = ar.materials;

type MaterialDialog = { kind: 'create' } | { kind: 'edit'; material: Material };

/**
 * `/materials` (S12 "Screens", rule 3): the catalogue by code, searched by code or name, archived
 * materials on request. The owner and the accountant add, edit and archive a material; its unit
 * is locked once a posted line names it (`MATERIAL_LOCKED`). Others read.
 */
export function MaterialsPage() {
  const { companyId, me, membership } = useCompany();
  const queryClient = useQueryClient();
  const manage = !membership.company.archived && can(me, 'dimensions.manage');
  const [text, setText] = useState('');
  const q = useDeferredValue(text.trim());
  const [showArchived, setShowArchived] = useState(false);
  const pages = useInfiniteQuery(
    materialsQuery(companyId, { ...(q === '' ? {} : { q }), archived: showArchived }),
  );
  const [dialog, setDialog] = useState<MaterialDialog | null>(null);
  const [archiving, setArchiving] = useState<Material | null>(null);
  const rows = pages.data?.pages.flatMap((page) => page.materials) ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['projects', companyId] });
  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          manage && (
            <Button onClick={() => setDialog({ kind: 'create' })}>
              <PlusIcon aria-hidden="true" />
              {t.add}
            </Button>
          )
        }
      />
      <Card className="flex flex-wrap items-end gap-4 p-4">
        <Field className="min-w-0 flex-1 basis-60">
          <FieldLabel>{t.search}</FieldLabel>
          <Input type="search" value={text} onChange={(event) => setText(event.target.value)} />
        </Field>
        <SwitchField
          label={t.showArchived}
          checked={showArchived}
          onCheckedChange={setShowArchived}
        />
      </Card>
      {pages.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
        </div>
      ) : pages.isError ? (
        <FormError error={pages.error} />
      ) : rows.length === 0 ? (
        q === '' ? (
          <EmptyState icon={<BoxesIcon />} title={t.empty} description={t.emptyHint} />
        ) : (
          <EmptyState title={t.emptySearch} />
        )
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <Table aria-label={t.title}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.code}</TableHead>
                <TableHead>{t.name}</TableHead>
                <TableHead className="max-md:hidden">{t.nameLatin}</TableHead>
                <TableHead>{t.unit}</TableHead>
                <TableHead>{t.state}</TableHead>
                {manage && (
                  <TableHead>
                    <span className="sr-only">{t.edit}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((material) => (
                <TableRow key={material.id}>
                  <TableCell>
                    <bdi dir="ltr" className="font-medium">
                      {material.code}
                    </bdi>
                  </TableCell>
                  <TableCell>
                    <bdi>{material.name}</bdi>
                  </TableCell>
                  <TableCell className="max-md:hidden">
                    {material.nameLatin && <bdi dir="ltr">{material.nameLatin}</bdi>}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1">
                      <bdi>{material.unit}</bdi>
                      {material.used && (
                        <LockIcon
                          role="img"
                          aria-label={t.unitLocked}
                          className="size-icon text-muted-foreground"
                        />
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge tone={material.archivedAt ? 'neutral' : 'success'}>
                      {material.archivedAt ? t.archived : t.active}
                    </Badge>
                  </TableCell>
                  {manage && (
                    <TableCell>
                      {material.archivedAt === null && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={t.editMaterial.replace('{name}', material.name)}
                              />
                            }
                          >
                            <EllipsisIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setDialog({ kind: 'edit', material })}>
                              {t.edit}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setArchiving(material)}
                            >
                              {t.archive}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {pages.hasNextPage && (
            <Button
              variant="outline"
              className="w-fit"
              loading={pages.isFetchingNextPage}
              onClick={() => void pages.fetchNextPage()}
            >
              {t.more}
            </Button>
          )}
        </div>
      )}
      {dialog && <MaterialFormDialog mode={dialog} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={t.archiveTitle}
        description={t.archiveDescription}
        submitLabel={t.archive}
        destructive
        onConfirm={() =>
          api('POST', `/materials/${archiving?.id}/archive`, {
            company: companyId,
            body: {},
            schema: materialSchema,
          })
        }
        onDone={refresh}
      />
    </>
  );
}

interface MaterialForm {
  code: string;
  name: string;
  nameLatin: string;
  unit: string;
}

/** A new material, or an existing one's code, names and unit (the unit only before first use). */
function MaterialFormDialog({ mode, onClose }: { mode: MaterialDialog; onClose: () => void }) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const current = mode.kind === 'edit' ? mode.material : null;
  const [form, setForm] = useState<MaterialForm>({
    code: current?.code ?? '',
    name: current?.name ?? '',
    nameLatin: current?.nameLatin ?? '',
    unit: current?.unit ?? '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof MaterialForm, string>>>({});
  const [attempt, setAttempt] = useState(0);
  const set = (change: Partial<MaterialForm>) => setForm({ ...form, ...change });
  const save = useMutation({
    mutationFn: (body: unknown) =>
      current
        ? api('PATCH', `/materials/${current.id}`, {
            company: companyId,
            body,
            schema: materialSchema,
          })
        : api('POST', '/materials', { company: companyId, body, schema: materialSchema }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects', companyId] });
      onClose();
    },
  });
  const optional = (text: string) => (text.trim() === '' ? null : text.trim());

  function submit() {
    const found: typeof errors = {};
    const length = (text: string, max: number) =>
      text.trim().length >= 1 && text.trim().length <= max;
    if (!length(form.code, 30)) found.code = t.validation.code;
    if (!length(form.name, 200)) found.name = t.validation.name;
    if (!length(form.unit, 20)) found.unit = t.validation.unit;
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setAttempt((count) => count + 1);
      return;
    }
    if (!current) {
      save.mutate(
        createMaterialSchema.parse({
          code: form.code,
          name: form.name,
          nameLatin: optional(form.nameLatin),
          unit: form.unit,
        }),
      );
      return;
    }
    const change: UpdateMaterial = {};
    if (form.code.trim() !== current.code) change.code = form.code.trim();
    if (form.name.trim() !== current.name) change.name = form.name.trim();
    if (optional(form.nameLatin) !== current.nameLatin) change.nameLatin = optional(form.nameLatin);
    if (form.unit.trim() !== current.unit) change.unit = form.unit.trim();
    if (Object.keys(change).length === 0) {
      onClose();
      return;
    }
    save.mutate(updateMaterialSchema.parse(change));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={ar.common.close}>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{current ? t.dialog.editTitle : t.dialog.newTitle}</DialogTitle>
            <DialogDescription>{t.dialog.description}</DialogDescription>
          </DialogHeader>
          <FormErrorSummary
            attempt={attempt}
            errors={[
              ['material-code', errors.code],
              ['material-name', errors.name],
              ['material-unit', errors.unit],
            ]}
          />
          <Field id="material-code" invalid={errors.code !== undefined}>
            <FieldLabel>{t.code}</FieldLabel>
            <Input
              dir="ltr"
              value={form.code}
              onChange={(event) => set({ code: event.target.value })}
            />
            <FieldError match={errors.code !== undefined}>{errors.code}</FieldError>
          </Field>
          <Field id="material-name" invalid={errors.name !== undefined}>
            <FieldLabel>{t.name}</FieldLabel>
            <Input value={form.name} onChange={(event) => set({ name: event.target.value })} />
            <FieldError match={errors.name !== undefined}>{errors.name}</FieldError>
          </Field>
          <Field>
            <FieldLabel>{t.nameLatin}</FieldLabel>
            <Input
              dir="auto"
              value={form.nameLatin}
              onChange={(event) => set({ nameLatin: event.target.value })}
            />
          </Field>
          <Field
            id="material-unit"
            invalid={errors.unit !== undefined}
            disabled={current?.used === true}
          >
            <FieldLabel>{t.unit}</FieldLabel>
            <Input
              value={form.unit}
              disabled={current?.used === true}
              onChange={(event) => set({ unit: event.target.value })}
            />
            <FieldDescription>{current?.used ? t.unitLocked : t.unitHint}</FieldDescription>
            <FieldError match={errors.unit !== undefined}>{errors.unit}</FieldError>
          </Field>
          <FormError error={save.error} />
          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              {t.dialog.submit}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {ar.common.cancel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
