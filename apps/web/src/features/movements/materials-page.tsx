import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createMaterialSchema,
  type Material,
  type MaterialCosts,
  type Me,
  materialSchema,
  type UpdateMaterial,
  updateMaterialSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  Badge,
  Button,
  type DateRange,
  DateRangeField,
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
  isDateRangeOrdered,
  PageHeader,
  SelectField,
  Skeleton,
  SwitchField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@vertex-mizan/ui';
import { BoxesIcon, EllipsisIcon, LockIcon, PackageIcon, PlusIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { api } from '../../lib/api';
import {
  materialCatalogueQuery,
  materialCostsQuery,
  projectsQuery,
  refreshBooks,
} from '../../lib/movements';
import { can } from '../../lib/session';
import { ByCurrency } from './figures';
import { ReportPdfButton } from './report-pdf';

const t = ar.movements.materialsPage;
const m = ar.materials;

/**
 * `/materials` (S13 screen 7): the materials' costs across projects or for one, over a range, and
 * the catalogue with its dialog (a material's unit locked once used, S12 rule 3; archived, never
 * deleted, rule 10).
 */
export function MaterialsPage({ me, companyId }: { me: Me; companyId: string }) {
  const canCosts = can(me, 'reports.read');
  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      <Tabs defaultValue={canCosts ? 'costs' : 'catalogue'}>
        <TabsList>
          {canCosts && <TabsTrigger value="costs">{t.tabs.costs}</TabsTrigger>}
          <TabsTrigger value="catalogue">{t.tabs.catalogue}</TabsTrigger>
        </TabsList>
        {canCosts && (
          <TabsContent value="costs">
            <MaterialCostsView companyId={companyId} />
          </TabsContent>
        )}
        <TabsContent value="catalogue">
          <Catalogue me={me} companyId={companyId} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** Each material's quantity and cost in USD and by the currency it was paid in, and per project. */
function MaterialCostsView({ companyId }: { companyId: string }) {
  const [project, setProject] = useState<string>('all');
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const ordered = isDateRangeOrdered(range);
  const projects = useQuery(projectsQuery(companyId));
  const costs = useQuery(
    materialCostsQuery(companyId, {
      project: project === 'all' ? undefined : project,
      from: ordered && range.from !== '' ? range.from : undefined,
      to: ordered && range.to !== '' ? range.to : undefined,
    }),
  );
  const filtered = project !== 'all' || range.from !== '' || range.to !== '';
  const printed: Record<string, string> = {
    ...(project === 'all' ? {} : { project }),
    ...(ordered && range.from !== '' ? { from: range.from } : {}),
    ...(ordered && range.to !== '' ? { to: range.to } : {}),
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:items-start [&>*]:min-w-0">
        <SelectField
          label={t.project}
          value={project}
          options={[
            { value: 'all', label: t.allProjects },
            ...(projects.data ?? []).map((row) => ({ value: row.id, label: row.name })),
          ]}
          onValueChange={setProject}
        />
        <DateRangeField
          labelHidden
          value={range}
          onValueChange={setRange}
          label={t.range}
          fromLabel={t.from}
          toLabel={t.to}
          orderError={t.rangeOrder}
        />
      </div>
      {filtered && (
        <Button
          variant="link"
          size="sm"
          className="w-fit px-0"
          onClick={() => {
            setProject('all');
            setRange({ from: '', to: '' });
          }}
        >
          {t.clear}
        </Button>
      )}
      {costs.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-row w-full" />
          <Skeleton className="h-row w-full" />
        </div>
      ) : costs.isError ? (
        <EmptyState
          title={ar.common.errorTitle}
          description={ar.common.errorDescription}
          action={
            <Button variant="outline" onClick={() => void costs.refetch()}>
              {ar.common.retry}
            </Button>
          }
        />
      ) : costs.data.materials.length === 0 ? (
        filtered ? (
          <EmptyState title={t.noMatch} />
        ) : (
          <EmptyState icon={<PackageIcon />} title={t.empty} description={t.emptyHint} />
        )
      ) : (
        <>
          <ReportPdfButton
            companyId={companyId}
            report="material_costs"
            params={printed}
            label={ar.movements.print.materialsAction}
          />
          <CostsTable costs={costs.data} showProjects={project === 'all'} />
        </>
      )}
    </div>
  );
}

function CostsTable({ costs, showProjects }: { costs: MaterialCosts; showProjects: boolean }) {
  const book = costs.bookCurrency;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.columns.material}</TableHead>
          <TableHead>{t.columns.unit}</TableHead>
          <TableHead numeric>{t.columns.quantity}</TableHead>
          <TableHead numeric>{t.columns.cost}</TableHead>
          <TableHead>{t.columns.byCurrency}</TableHead>
          {showProjects && <TableHead>{t.columns.projects}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {costs.materials.map((row) => (
          <TableRow key={row.material.id}>
            <TableCell className="font-medium">{row.material.name}</TableCell>
            <TableCell>{row.material.unit}</TableCell>
            <TableCell numeric>
              <bdi dir="ltr">{row.quantity}</bdi>
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(row.bookMinor)} currency={book} />
            </TableCell>
            <TableCell className="min-w-44">
              <ByCurrency amounts={row.byCurrency} bookCurrency={book} />
            </TableCell>
            {showProjects && (
              <TableCell className="min-w-56 whitespace-normal">
                <ul className="flex flex-col gap-1 text-control">
                  {row.byProject.map((share) => (
                    <li
                      key={share.project.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3"
                    >
                      <span>
                        {share.project.name}: <bdi dir="ltr">{share.quantity}</bdi>{' '}
                        {row.material.unit}
                      </span>
                      <Amount value={BigInt(share.bookMinor)} currency={book} />
                    </li>
                  ))}
                </ul>
              </TableCell>
            )}
          </TableRow>
        ))}
        <TableRow>
          <TableCell className="font-bold">{t.total}</TableCell>
          <TableCell />
          <TableCell />
          <TableCell numeric>
            <Amount value={BigInt(costs.totalBookMinor)} currency={book} strong />
          </TableCell>
          <TableCell />
          {showProjects && <TableCell />}
        </TableRow>
      </TableBody>
    </Table>
  );
}

type MaterialDialogMode = { kind: 'create'; code: string } | { kind: 'edit'; material: Material };

/**
 * The next free numeric code (`001`, `002`, …) after the catalogue's highest, suggested for a new
 * material and editable: the API refuses a code taken.
 */
function suggestedCode(materials: readonly Material[]): string {
  const highest = materials.reduce((top, material) => {
    const value = /^\d+$/.test(material.code) ? Number(material.code) : 0;
    return value > top ? value : top;
  }, 0);
  return String(highest + 1).padStart(3, '0');
}

/** The catalogue (S12 rule 3): search, archived on request, new, edit and archive. */
function Catalogue({ me, companyId }: { me: Me; companyId: string }) {
  const queryClient = useQueryClient();
  const manage = can(me, 'dimensions.manage');
  const [text, setText] = useState('');
  const q = useDeferredValue(text.trim());
  const [showArchived, setShowArchived] = useState(false);
  const pages = useInfiniteQuery(
    materialCatalogueQuery(companyId, { q: q === '' ? undefined : q, archived: showArchived }),
  );
  const [dialog, setDialog] = useState<MaterialDialogMode | null>(null);
  const [archiving, setArchiving] = useState<Material | null>(null);
  const rows = pages.data?.pages.flatMap((page) => page.materials) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <Field className="min-w-0 flex-1 basis-60">
          <FieldLabel>{m.search}</FieldLabel>
          <Input type="search" value={text} onChange={(event) => setText(event.target.value)} />
        </Field>
        <SwitchField
          label={m.showArchived}
          checked={showArchived}
          onCheckedChange={setShowArchived}
        />
        {manage && (
          <Button onClick={() => setDialog({ kind: 'create', code: suggestedCode(rows) })}>
            <PlusIcon aria-hidden="true" />
            {m.add}
          </Button>
        )}
      </div>
      {pages.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
        </div>
      ) : pages.isError ? (
        <EmptyState
          title={ar.common.errorTitle}
          description={ar.common.errorDescription}
          action={
            <Button variant="outline" onClick={() => void pages.refetch()}>
              {ar.common.retry}
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        q === '' ? (
          <EmptyState icon={<BoxesIcon />} title={m.empty} description={m.emptyHint} />
        ) : (
          <EmptyState title={m.emptySearch} />
        )
      ) : (
        <>
          <Table aria-label={m.title}>
            <TableHeader>
              <TableRow>
                <TableHead>{m.code}</TableHead>
                <TableHead>{m.name}</TableHead>
                <TableHead>{m.unit}</TableHead>
                <TableHead>{m.state}</TableHead>
                {manage && (
                  <TableHead>
                    <span className="sr-only">{m.edit}</span>
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
                  <TableCell>
                    <span className="inline-flex items-center gap-1">
                      <bdi>{material.unit}</bdi>
                      {material.used && (
                        <LockIcon
                          role="img"
                          aria-label={m.unitLocked}
                          className="size-icon text-muted-foreground"
                        />
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge tone={material.archivedAt ? 'neutral' : 'success'}>
                      {material.archivedAt ? m.archived : m.active}
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
                                aria-label={m.editMaterial.replace('{name}', material.name)}
                              />
                            }
                          >
                            <EllipsisIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setDialog({ kind: 'edit', material })}>
                              {m.edit}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setArchiving(material)}
                            >
                              {m.archive}
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
              {m.more}
            </Button>
          )}
        </>
      )}
      {dialog && (
        <MaterialFormDialog companyId={companyId} mode={dialog} onClose={() => setDialog(null)} />
      )}
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={m.archiveTitle}
        description={m.archiveDescription}
        submitLabel={m.archive}
        destructive
        onConfirm={() =>
          api('POST', `/materials/${archiving?.id}/archive`, {
            company: companyId,
            body: {},
            schema: materialSchema,
          })
        }
        onDone={() => refreshBooks(queryClient, companyId)}
      />
    </div>
  );
}

interface MaterialForm {
  code: string;
  name: string;
  unit: string;
}

/** A new material, or an existing one's code, name and unit (the unit only before first use). */
function MaterialFormDialog({
  companyId,
  mode,
  onClose,
}: {
  companyId: string;
  mode: MaterialDialogMode;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const current = mode.kind === 'edit' ? mode.material : null;
  const [form, setForm] = useState<MaterialForm>({
    code: current?.code ?? (mode.kind === 'create' ? mode.code : ''),
    name: current?.name ?? '',
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
      await refreshBooks(queryClient, companyId);
      onClose();
    },
  });

  function submit() {
    const found: typeof errors = {};
    const length = (text: string, max: number) =>
      text.trim().length >= 1 && text.trim().length <= max;
    if (!length(form.code, 30)) found.code = m.validation.code;
    if (!length(form.name, 200)) found.name = m.validation.name;
    if (!length(form.unit, 20)) found.unit = m.validation.unit;
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setAttempt((count) => count + 1);
      return;
    }
    if (!current) {
      save.mutate(
        createMaterialSchema.parse({ code: form.code, name: form.name, unit: form.unit }),
      );
      return;
    }
    const change: UpdateMaterial = {};
    if (form.code.trim() !== current.code) change.code = form.code.trim();
    if (form.name.trim() !== current.name) change.name = form.name.trim();
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
            event.stopPropagation();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{current ? m.dialog.editTitle : m.dialog.newTitle}</DialogTitle>
            <DialogDescription>{m.dialog.description}</DialogDescription>
          </DialogHeader>
          <FormErrorSummary
            attempt={attempt}
            errors={[
              ['material-name', errors.name],
              ['material-unit', errors.unit],
              ['material-code', errors.code],
            ]}
          />
          <Field id="material-name" invalid={errors.name !== undefined}>
            <FieldLabel>{m.name}</FieldLabel>
            <Input value={form.name} onChange={(event) => set({ name: event.target.value })} />
            <FieldError match={errors.name !== undefined}>{errors.name}</FieldError>
          </Field>
          <Field
            id="material-unit"
            invalid={errors.unit !== undefined}
            disabled={current?.used === true}
          >
            <FieldLabel>{m.unit}</FieldLabel>
            <Input
              value={form.unit}
              disabled={current?.used === true}
              onChange={(event) => set({ unit: event.target.value })}
            />
            <FieldDescription>{current?.used ? m.unitLocked : m.unitHint}</FieldDescription>
            <FieldError match={errors.unit !== undefined}>{errors.unit}</FieldError>
          </Field>
          <Field id="material-code" invalid={errors.code !== undefined}>
            <FieldLabel>{m.code}</FieldLabel>
            <Input
              dir="ltr"
              value={form.code}
              onChange={(event) => set({ code: event.target.value })}
            />
            {!current && <FieldDescription>{t.suggestedCode}</FieldDescription>}
            <FieldError match={errors.code !== undefined}>{errors.code}</FieldError>
          </Field>
          <FormError error={save.error} />
          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              {m.dialog.submit}
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
