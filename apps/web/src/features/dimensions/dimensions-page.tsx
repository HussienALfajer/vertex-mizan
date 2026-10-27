import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CONTRACT_KINDS,
  type ContractKind,
  createDimensionTypeSchema,
  createDimensionValueSchema,
  type DimensionType,
  type DimensionValue,
  dimensionTypeSchema,
  dimensionValueSchema,
  linkDimensionValueSchema,
  type UpdateDimensionValue,
  updateDimensionTypeSchema,
  updateDimensionValueSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Badge,
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DimensionPicker,
  type DimensionPickerOption,
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
import { EllipsisIcon, InfoIcon, LinkIcon, PlusIcon, TagsIcon } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormError } from '../../components/form-error';
import { api } from '../../lib/api';
import { can, useCompany } from '../../lib/session';
import { dimensionTypesQuery, dimensionValuesQuery } from './dimension-queries';

const t = ar.dimensions;

/** The built-in contract type: its values have a kind and may name their client (rule 9). */
const isContractType = (type: DimensionType) => type.builtin && type.code === 'contract';

type TypeDialog = { kind: 'create' } | { kind: 'edit'; type: DimensionType };
type ValueDialog = { kind: 'create' } | { kind: 'edit'; value: DimensionValue };
type Confirm =
  | { kind: 'archive' | 'restore'; value: DimensionValue }
  | { kind: 'archiveType' | 'restoreType'; type: DimensionType };

/**
 * `/dimensions` (S02 rules 9–13): a tab per dimension type with its values. Owners and accountants
 * add custom types and manual values, rename them, link a manual value to its Hub ID once, and
 * archive and restore; every role reads them. Hub's values carry their Hub ID and are renamed by
 * Hub's next differing name.
 */
export function DimensionsPage() {
  const { companyId, me, membership } = useCompany();
  const manage = can(me, 'dimensions.manage') && !membership.company.archived;
  const types = useQuery(dimensionTypesQuery(companyId));
  const [showArchived, setShowArchived] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [typeDialog, setTypeDialog] = useState<TypeDialog | null>(null);
  const listed = (types.data ?? []).filter((type) => showArchived || type.archivedAt === null);
  const active = listed.find((type) => type.id === chosen) ?? listed[0];

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          manage && (
            <Button variant="outline" onClick={() => setTypeDialog({ kind: 'create' })}>
              <PlusIcon aria-hidden="true" />
              {t.newType}
            </Button>
          )
        }
      />
      {!can(me, 'dimensions.manage') && (
        <Callout tone="info" icon={<InfoIcon />} title={t.readOnly} />
      )}
      {types.isPending ? (
        <Loading />
      ) : types.isError ? (
        <FormError error={types.error} />
      ) : !active ? (
        <EmptyState icon={<TagsIcon />} title={t.emptyTypes} />
      ) : (
        <>
          <SwitchField
            label={t.showArchived}
            checked={showArchived}
            onCheckedChange={setShowArchived}
          />
          <Tabs value={active.id} onValueChange={(value) => setChosen(value as string)}>
            <TabsList aria-label={t.types}>
              {listed.map((type) => (
                <TabsTrigger key={type.id} value={type.id}>
                  <bdi>{type.name}</bdi>
                  {type.archivedAt !== null && <Badge tone="neutral">{t.archived}</Badge>}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={active.id}>
              <TypePanel
                key={active.id}
                type={active}
                types={types.data ?? []}
                manage={manage}
                showArchived={showArchived}
                onEditType={() => setTypeDialog({ kind: 'edit', type: active })}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
      {typeDialog && (
        <TypeFormDialog
          key={typeDialog.kind === 'edit' ? typeDialog.type.id : 'new'}
          mode={typeDialog}
          onClose={() => setTypeDialog(null)}
          onCreated={(type) => setChosen(type.id)}
        />
      )}
    </>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-row" />
      <Skeleton className="h-row" />
      <Skeleton className="h-row" />
    </div>
  );
}

/**
 * The parent type's values the picker offers (a contract's client), searched on the server so any
 * of them can be found, with the chosen one kept even when the search does not return it.
 */
function useParentOptions(
  companyId: string,
  parentType: DimensionType | undefined,
  chosen: DimensionPickerOption | null,
) {
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query);
  const found = useInfiniteQuery({
    ...dimensionValuesQuery(companyId, parentType?.id ?? '', { q }),
    enabled: parentType !== undefined,
  });
  const options = useMemo(() => {
    const listed = (found.data?.pages.flatMap((page) => page.values) ?? []).map(pickerOption);
    return chosen && !listed.some((option) => option.id === chosen.id)
      ? [chosen, ...listed]
      : listed;
  }, [found.data, chosen]);
  return { options, setQuery };
}

const pickerOption = (value: DimensionValue): DimensionPickerOption => ({
  id: value.id,
  code: value.code,
  name: value.name,
  nameLatin: value.nameLatin,
  archived: value.archivedAt !== null,
});

function TypePanel({
  type,
  types,
  manage,
  showArchived,
  onEditType,
}: {
  type: DimensionType;
  types: readonly DimensionType[];
  manage: boolean;
  showArchived: boolean;
  onEditType: () => void;
}) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const q = useDeferredValue(text.trim());
  const values = useInfiniteQuery(
    dimensionValuesQuery(companyId, type.id, { q, includeArchived: showArchived }),
  );
  const parentType = types.find((candidate) => candidate.id === type.parentTypeId);
  const [valueDialog, setValueDialog] = useState<ValueDialog | null>(null);
  const [linking, setLinking] = useState<DimensionValue | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const rows = values.data?.pages.flatMap((page) => page.values) ?? [];
  const contract = isContractType(type);
  const live = manage && type.archivedAt === null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['dimensions', companyId] });

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label={type.name}>
      <div className="flex flex-wrap items-end gap-2">
        <Field className="min-w-0 flex-1 basis-60">
          <FieldLabel>{t.search}</FieldLabel>
          <Input type="search" value={text} onChange={(event) => setText(event.target.value)} />
        </Field>
        {live && (
          <Button onClick={() => setValueDialog({ kind: 'create' })}>
            <PlusIcon aria-hidden="true" />
            {t.newValue}
          </Button>
        )}
        {manage && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={`${t.actions.typeMenu}: ${type.name}`}
                />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEditType}>{t.actions.editType}</DropdownMenuItem>
              {!type.builtin &&
                (type.archivedAt === null ? (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirm({ kind: 'archiveType', type })}
                  >
                    {t.actions.archiveType}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => setConfirm({ kind: 'restoreType', type })}>
                    {t.actions.restoreType}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {values.isPending ? (
        <Loading />
      ) : values.isError ? (
        <FormError error={values.error} />
      ) : rows.length === 0 ? (
        q === '' ? (
          <EmptyState icon={<TagsIcon />} title={t.empty.title} description={t.empty.description} />
        ) : (
          <EmptyState title={t.empty.search} />
        )
      ) : (
        <>
          <Table aria-label={`${t.table.label}: ${type.name}`}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.table.code}</TableHead>
                <TableHead>{t.table.name}</TableHead>
                <TableHead className="max-lg:hidden">{t.table.nameLatin}</TableHead>
                {contract && <TableHead className="max-md:hidden">{t.table.kind}</TableHead>}
                {contract && <TableHead className="max-md:hidden">{t.table.client}</TableHead>}
                <TableHead className="max-sm:hidden">{t.table.hub}</TableHead>
                <TableHead>
                  <span className="sr-only">{t.table.actions}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((value) => (
                <TableRow key={value.id}>
                  <TableCell>{value.code && <bdi dir="ltr">{value.code}</bdi>}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2">
                      <bdi className="font-medium">{value.name}</bdi>
                      {value.archivedAt !== null && <Badge tone="neutral">{t.archived}</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-lg:hidden">
                    {value.nameLatin && <bdi>{value.nameLatin}</bdi>}
                  </TableCell>
                  {contract && (
                    <TableCell className="max-md:hidden">
                      {value.contractKind && t.contractKinds[value.contractKind]}
                    </TableCell>
                  )}
                  {contract && (
                    <TableCell className="max-md:hidden">
                      {value.parentName && <bdi>{value.parentName}</bdi>}
                    </TableCell>
                  )}
                  <TableCell className="max-sm:hidden">
                    {value.externalId ? (
                      <Badge tone="info">
                        <LinkIcon aria-hidden="true" />
                        <bdi dir="ltr" className="max-w-40 truncate">
                          {value.externalId}
                        </bdi>
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">{t.table.manual}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    {live && (
                      <ValueActions
                        value={value}
                        onEdit={() => setValueDialog({ kind: 'edit', value })}
                        onLink={() => setLinking(value)}
                        onConfirm={setConfirm}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {values.hasNextPage && (
            <Button
              variant="outline"
              className="w-fit self-center"
              loading={values.isFetchingNextPage}
              onClick={() => void values.fetchNextPage()}
            >
              {t.loadMore}
            </Button>
          )}
        </>
      )}
      {valueDialog && (
        <ValueFormDialog
          key={valueDialog.kind === 'edit' ? valueDialog.value.id : 'new'}
          mode={valueDialog}
          type={type}
          parentType={parentType}
          onClose={() => setValueDialog(null)}
        />
      )}
      {linking && <LinkDialog key={linking.id} value={linking} onClose={() => setLinking(null)} />}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm ? t[confirm.kind].title : ''}
        description={confirm ? t[confirm.kind].description : ''}
        submitLabel={confirm ? t[confirm.kind].submit : ''}
        destructive={confirm?.kind === 'archive' || confirm?.kind === 'archiveType'}
        onConfirm={() => {
          if (!confirm) return Promise.resolve();
          if ('value' in confirm) {
            return api('POST', `/dimension-values/${confirm.value.id}/${confirm.kind}`, {
              company: companyId,
              schema: dimensionValueSchema,
            });
          }
          const action = confirm.kind === 'archiveType' ? 'archive' : 'restore';
          return api('POST', `/dimension-types/${confirm.type.id}/${action}`, {
            company: companyId,
            schema: dimensionTypeSchema,
          });
        }}
        onDone={refresh}
      />
    </section>
  );
}

function ValueActions({
  value,
  onEdit,
  onLink,
  onConfirm,
}: {
  value: DimensionValue;
  onEdit: () => void;
  onLink: () => void;
  onConfirm: (confirm: Confirm) => void;
}) {
  const archived = value.archivedAt !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={`${t.table.menu}: ${value.name}`} />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {!archived && <DropdownMenuItem onClick={onEdit}>{t.actions.edit}</DropdownMenuItem>}
        {!archived && value.externalId === null && (
          <DropdownMenuItem onClick={onLink}>{t.actions.link}</DropdownMenuItem>
        )}
        {archived ? (
          <DropdownMenuItem onClick={() => onConfirm({ kind: 'restore', value })}>
            {t.actions.restore}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onConfirm({ kind: 'archive', value })}
          >
            {t.actions.archive}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ValueForm {
  code: string;
  name: string;
  nameLatin: string;
  contractKind: ContractKind | '';
  parentValueId: string | null;
}

const kindOptions = CONTRACT_KINDS.map((value) => ({ value, label: t.contractKinds[value] }));

/** A new manual value, or an existing value's names, code and client (rules 11–12). */
function ValueFormDialog({
  mode,
  type,
  parentType,
  onClose,
}: {
  mode: ValueDialog;
  type: DimensionType;
  parentType: DimensionType | undefined;
  onClose: () => void;
}) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const current = mode.kind === 'edit' ? mode.value : null;
  const [form, setForm] = useState<ValueForm>({
    code: current?.code ?? '',
    name: current?.name ?? '',
    nameLatin: current?.nameLatin ?? '',
    contractKind: current?.contractKind ?? '',
    parentValueId: current?.parentValueId ?? null,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ValueForm, string>>>({});
  const [unchanged, setUnchanged] = useState(false);
  const contract = isContractType(type);
  // The chosen client's id and name, kept while the search shows other clients.
  const [chosenParent, setChosenParent] = useState<DimensionPickerOption | null>(
    current?.parentValueId && current.parentName
      ? { id: current.parentValueId, name: current.parentName }
      : null,
  );
  const parentOptions = useParentOptions(
    companyId,
    contract ? parentType : undefined,
    chosenParent,
  );
  const set = (change: Partial<ValueForm>) => {
    setForm({ ...form, ...change });
    setUnchanged(false);
  };
  const save = useMutation({
    mutationFn: (body: unknown) =>
      current
        ? api('PATCH', `/dimension-values/${current.id}`, {
            company: companyId,
            body,
            schema: dimensionValueSchema,
          })
        : api('POST', '/dimension-values', {
            company: companyId,
            body,
            schema: dimensionValueSchema,
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dimensions', companyId] });
      onClose();
    },
  });
  const optional = (text: string) => (text.trim() === '' ? null : text);

  function submit() {
    const found: typeof errors = {};
    if (form.name.trim() === '') found.name = t.validation.required;
    if (contract && !current && form.contractKind === '')
      found.contractKind = t.validation.required;
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (!current) {
      const parsed = createDimensionValueSchema.safeParse({
        typeId: type.id,
        code: optional(form.code),
        name: form.name,
        nameLatin: optional(form.nameLatin),
        contractKind: contract ? form.contractKind : null,
        parentValueId: contract ? form.parentValueId : null,
      });
      if (!parsed.success) {
        setErrors({ name: t.validation.length });
        return;
      }
      save.mutate(parsed.data);
      return;
    }
    const change: UpdateDimensionValue = {};
    if (optional(form.code) !== current.code) change.code = optional(form.code);
    if (form.name.trim() !== current.name) change.name = form.name;
    if (optional(form.nameLatin) !== current.nameLatin) change.nameLatin = optional(form.nameLatin);
    if (contract && form.parentValueId !== current.parentValueId) {
      change.parentValueId = form.parentValueId;
    }
    if (Object.keys(change).length === 0) {
      setUnchanged(true);
      return;
    }
    const parsed = updateDimensionValueSchema.safeParse(change);
    if (!parsed.success) {
      setErrors({ name: t.validation.length });
      return;
    }
    save.mutate(parsed.data);
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
            <DialogTitle>{current ? t.value.editTitle : t.value.createTitle}</DialogTitle>
            <DialogDescription>{type.name}</DialogDescription>
          </DialogHeader>
          {current?.externalSource === 'hub' && (
            <Callout
              tone="info"
              icon={<InfoIcon />}
              title={t.value.hubTitle}
              description={t.value.hubDescription}
            />
          )}
          <Field invalid={errors.name !== undefined}>
            <FieldLabel>{t.value.name}</FieldLabel>
            <Input value={form.name} onChange={(event) => set({ name: event.target.value })} />
            <FieldError match={errors.name !== undefined}>{errors.name}</FieldError>
          </Field>
          <Field>
            <FieldLabel>{t.value.nameLatin}</FieldLabel>
            <Input
              dir="auto"
              value={form.nameLatin}
              onChange={(event) => set({ nameLatin: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel>{t.value.code}</FieldLabel>
            <Input
              dir="ltr"
              value={form.code}
              onChange={(event) => set({ code: event.target.value })}
            />
            <FieldDescription>{t.value.codeHint}</FieldDescription>
          </Field>
          {contract && (
            <SelectField
              label={t.value.kind}
              value={form.contractKind === '' ? null : form.contractKind}
              options={kindOptions}
              placeholder={ar.chart.sheet.choose}
              disabled={current !== null}
              error={errors.contractKind}
              onValueChange={(value) => set({ contractKind: value })}
            />
          )}
          {contract && parentType && (
            <DimensionPicker
              label={parentType.name}
              values={parentOptions.options}
              onQueryChange={parentOptions.setQuery}
              value={form.parentValueId}
              onValueChange={(id) => {
                setChosenParent(parentOptions.options.find((option) => option.id === id) ?? null);
                set({ parentValueId: id });
              }}
              labels={t.picker}
              description={t.value.clientHint}
            />
          )}
          {unchanged && <Callout tone="info" icon={<InfoIcon />} title={t.value.nothingChanged} />}
          <FormError error={save.error} />
          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              {current ? t.value.save : t.value.create}
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

/** A manual value to its Hub ID, once (rule 11). */
function LinkDialog({ value, onClose }: { value: DimensionValue; onClose: () => void }) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const [externalId, setExternalId] = useState('');
  const [invalid, setInvalid] = useState(false);
  const link = useMutation({
    mutationFn: (body: unknown) =>
      api('POST', `/dimension-values/${value.id}/link`, {
        company: companyId,
        body,
        schema: dimensionValueSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dimensions', companyId] });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={ar.common.close}>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = linkDimensionValueSchema.safeParse({ externalId });
            setInvalid(!parsed.success);
            if (parsed.success) link.mutate(parsed.data);
          }}
        >
          <DialogHeader>
            <DialogTitle>{`${t.link.title}: ${value.name}`}</DialogTitle>
            <DialogDescription>{t.link.description}</DialogDescription>
          </DialogHeader>
          <Field invalid={invalid}>
            <FieldLabel>{t.link.externalId}</FieldLabel>
            <Input
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={externalId}
              onChange={(event) => {
                setInvalid(false);
                setExternalId(event.target.value);
              }}
            />
            <FieldDescription>{t.link.externalIdHint}</FieldDescription>
            <FieldError match={invalid}>{t.validation.required}</FieldError>
          </Field>
          <FormError error={link.error} />
          <DialogFooter>
            <Button type="submit" loading={link.isPending}>
              {t.link.submit}
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

/** A custom type, or a type's names (rule 9). A type's code never changes. */
function TypeFormDialog({
  mode,
  onClose,
  onCreated,
}: {
  mode: TypeDialog;
  onClose: () => void;
  onCreated: (type: DimensionType) => void;
}) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const current = mode.kind === 'edit' ? mode.type : null;
  const [code, setCode] = useState('');
  const [name, setName] = useState(current?.name ?? '');
  const [nameLatin, setNameLatin] = useState(current?.nameLatin ?? '');
  const [errors, setErrors] = useState<{ code?: string; name?: string }>({});
  const save = useMutation({
    mutationFn: (body: unknown) =>
      current
        ? api('PATCH', `/dimension-types/${current.id}`, {
            company: companyId,
            body,
            schema: dimensionTypeSchema,
          })
        : api('POST', '/dimension-types', {
            company: companyId,
            body,
            schema: dimensionTypeSchema,
          }),
    onSuccess: async (type) => {
      await queryClient.invalidateQueries({ queryKey: ['dimensions', companyId] });
      if (!current) onCreated(type);
      onClose();
    },
  });

  function submit() {
    const latin = nameLatin.trim() === '' ? null : nameLatin;
    if (current) {
      const parsed = updateDimensionTypeSchema.safeParse({ name, nameLatin: latin });
      setErrors(parsed.success ? {} : { name: t.validation.required });
      if (parsed.success) save.mutate(parsed.data);
      return;
    }
    const parsed = createDimensionTypeSchema.safeParse({ code, name, nameLatin: latin });
    if (!parsed.success) {
      const paths = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      setErrors({
        ...(paths.has('code') ? { code: t.validation.typeCode } : {}),
        ...(paths.has('name') ? { name: t.validation.required } : {}),
      });
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
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
            <DialogTitle>{current ? t.type.editTitle : t.type.createTitle}</DialogTitle>
            <DialogDescription>{t.type.limit}</DialogDescription>
          </DialogHeader>
          <Field invalid={errors.code !== undefined} disabled={current !== null}>
            <FieldLabel>{t.type.code}</FieldLabel>
            <Input
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={current ? current.code : code}
              disabled={current !== null}
              onChange={(event) => setCode(event.target.value)}
            />
            <FieldDescription>{t.type.codeHint}</FieldDescription>
            <FieldError match={errors.code !== undefined}>{errors.code}</FieldError>
          </Field>
          <Field invalid={errors.name !== undefined}>
            <FieldLabel>{t.type.name}</FieldLabel>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
            <FieldError match={errors.name !== undefined}>{errors.name}</FieldError>
          </Field>
          <Field>
            <FieldLabel>{t.type.nameLatin}</FieldLabel>
            <Input
              dir="auto"
              value={nameLatin}
              onChange={(event) => setNameLatin(event.target.value)}
            />
          </Field>
          <FormError error={save.error} />
          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              {current ? t.type.save : t.type.create}
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
