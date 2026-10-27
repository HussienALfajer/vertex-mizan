import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  ACCOUNT_CLASSES,
  type Account,
  type AccountClass,
  accountSchema,
  applyChartTemplateSchema,
  type ChartTemplateId,
  STATEMENT_LINES,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountTree,
  type AccountTreeColumn,
  Badge,
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  matchesAccount,
  PageHeader,
  SelectField,
  Sheet,
  Skeleton,
  SwitchField,
} from '@vertex-mizan/ui';
import {
  DownloadIcon,
  EllipsisIcon,
  InfoIcon,
  KeyRoundIcon,
  LayoutTemplateIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { FormError } from '../../components/form-error';
import { ReasonDialog } from '../../components/reason-dialog';
import { api, download, listOf } from '../../lib/api';
import { can, useCompany } from '../../lib/session';
import { AccountSheet, type AccountSheetMode } from './account-sheet';
import { accountsQuery, templatesQuery } from './chart-queries';

const t = ar.chart;
const route = getRouteApi('/_app/_company/chart/');

/** An account as the tree shows it, with the API's account behind it. */
type ChartNode = Omit<Account, 'blocked' | 'archived'> & {
  blocked: boolean;
  archived: boolean;
  source: Account;
};

type Flag = 'all' | 'control' | 'monetary' | 'currency' | 'blocked';
type ReasonAction = { kind: 'block' | 'archive' | 'restore'; account: Account };

const lineNames = new Map(STATEMENT_LINES.map((line) => [line.code, line.name]));
const classOptions = [
  { value: 'all', label: t.filters.all },
  ...ACCOUNT_CLASSES.map((value) => ({ value, label: t.classes[value] })),
];
const flagOptions = (['all', 'control', 'monetary', 'currency', 'blocked'] as const).map(
  (value) => ({
    value,
    label: value === 'all' ? t.filters.all : t.filters[value],
  }),
);

const columns: AccountTreeColumn<ChartNode>[] = [
  {
    id: 'class',
    header: t.tree.class,
    hideBelow: 'md',
    cell: (account) => t.classes[account.class],
  },
  {
    id: 'line',
    header: t.tree.statementLine,
    hideBelow: 'lg',
    cell: (account) =>
      account.statementLine && (
        <span className="text-muted-foreground">{lineNames.get(account.statementLine)}</span>
      ),
  },
  {
    id: 'flags',
    header: t.tree.flags,
    hideBelow: 'md',
    cell: (account) => (
      <span className="flex flex-wrap gap-1">
        {account.isControl && <Badge tone="info">{t.flags.control}</Badge>}
        {account.isMonetary && <Badge tone="gold">{t.flags.monetary}</Badge>}
        {account.currency && (
          <Badge tone="outline">
            <bdi dir="ltr">{account.currency}</bdi>
          </Badge>
        )}
        {account.requiredDimensionTypeIds.length > 0 && (
          <Badge tone="neutral">{`${t.flags.dimensions}: ${account.requiredDimensionTypeIds.length}`}</Badge>
        )}
      </span>
    ),
  },
];

/**
 * `/chart` (S02 rules 1–6): the chart as a tree with filters. Owners and accountants add accounts
 * under headers, edit them in a side sheet, block, archive and restore them with a reason, and
 * apply a template to a chart of the five roots alone; every role reads and exports it.
 */
export function ChartPage() {
  const { companyId, me, membership } = useCompany();
  const { new: openNew } = route.useSearch();
  const navigate = useNavigate();
  const manage = can(me, 'accounts.manage') && !membership.company.archived;
  const [showArchived, setShowArchived] = useState(false);
  const accounts = useQuery(accountsQuery(companyId, showArchived));
  const [text, setText] = useState('');
  const [accountClass, setAccountClass] = useState<AccountClass | 'all'>('all');
  const [flag, setFlag] = useState<Flag>('all');
  const [sheet, setSheet] = useState<AccountSheetMode | null>(null);
  const [reason, setReason] = useState<ReasonAction | null>(null);
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['chart', companyId] });
  const unblock = useMutation({
    mutationFn: (account: Account) =>
      api('POST', `/accounts/${account.id}/unblock`, { company: companyId, schema: accountSchema }),
    onSuccess: refresh,
  });
  const exportFile = useMutation({
    mutationFn: () => download('/chart/export?format=xlsx', { company: companyId }),
  });

  const nodes = useMemo(
    () =>
      (accounts.data ?? []).map(
        (account): ChartNode => ({
          ...account,
          blocked: account.blocked !== null,
          archived: account.archived !== null,
          source: account,
        }),
      ),
    [accounts.data],
  );
  const match = useMemo(() => {
    if (text.trim() === '' && accountClass === 'all' && flag === 'all') return undefined;
    return (node: ChartNode) =>
      (text.trim() === '' || matchesAccount(node, text)) &&
      (accountClass === 'all' || node.class === accountClass) &&
      (flag === 'all' ||
        (flag === 'control' && node.isControl) ||
        (flag === 'monetary' && node.isMonetary) ||
        (flag === 'currency' && node.currency !== null) ||
        (flag === 'blocked' && node.blocked));
  }, [text, accountClass, flag]);
  const rootsOnly = accounts.data?.every((account) => account.level === 1) ?? false;
  // "New account" from the palette opens the sheet under the first root.
  const firstRoot = accounts.data?.find((account) => account.level === 1);
  const sheetMode: AccountSheetMode | null =
    sheet ?? (openNew && manage && firstRoot ? { kind: 'create', parent: firstRoot } : null);
  const closeSheet = () => {
    setSheet(null);
    if (openNew) void navigate({ to: '/chart', search: {}, replace: true });
  };

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" render={<Link to="/chart/roles" />}>
              <KeyRoundIcon aria-hidden="true" />
              {t.roleSettings.nav}
            </Button>
            <Button
              variant="outline"
              loading={exportFile.isPending}
              onClick={() => exportFile.mutate()}
            >
              <DownloadIcon aria-hidden="true" />
              {t.exportExcel}
            </Button>
          </div>
        }
      />
      {!can(me, 'accounts.manage') && (
        <Callout tone="info" icon={<InfoIcon />} title={t.readOnly} />
      )}
      <FormError error={exportFile.error ?? unblock.error} />
      {accounts.isPending ? (
        <Loading />
      ) : accounts.isError ? (
        <FormError error={accounts.error} />
      ) : (
        <>
          {rootsOnly && <Templates manage={manage} />}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <Field>
              <FieldLabel>{t.filters.search}</FieldLabel>
              <Input type="search" value={text} onChange={(event) => setText(event.target.value)} />
            </Field>
            <SelectField
              label={t.filters.class}
              value={accountClass}
              options={classOptions}
              onValueChange={(value) => setAccountClass(value as AccountClass | 'all')}
            />
            <SelectField
              label={t.filters.flag}
              value={flag}
              options={flagOptions}
              onValueChange={setFlag}
            />
            <SwitchField
              label={t.filters.showArchived}
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
          </div>
          {match && !nodes.some(match) ? (
            <EmptyState title={t.emptyFilter} />
          ) : (
            <AccountTree
              nodes={nodes}
              columns={columns}
              labels={{ ...t.tree, label: t.tree.label, header: t.kinds.header }}
              match={match}
              onOpen={(node) => setSheet({ kind: 'edit', account: node.source })}
              actions={(node) => (
                <RowActions
                  account={node.source}
                  manage={manage}
                  onSheet={setSheet}
                  onReason={setReason}
                  onUnblock={() => unblock.mutate(node.source)}
                />
              )}
            />
          )}
        </>
      )}
      <Sheet open={sheetMode !== null} onOpenChange={(open) => !open && closeSheet()}>
        {sheetMode && accounts.data && (
          <AccountSheet
            key={sheetMode.kind === 'edit' ? sheetMode.account.id : `new-${sheetMode.parent.id}`}
            mode={sheetMode}
            accounts={accounts.data}
            manage={manage}
            onDone={closeSheet}
          />
        )}
      </Sheet>
      <ReasonDialog
        open={reason !== null}
        onOpenChange={(open) => !open && setReason(null)}
        title={reason ? t[reason.kind].title : ''}
        description={reason ? t[reason.kind].description : ''}
        reasonLabel={reason ? t[reason.kind].reason : ''}
        submitLabel={reason ? t[reason.kind].submit : ''}
        destructive={reason?.kind !== 'restore'}
        onConfirm={(text) =>
          api('POST', `/accounts/${reason?.account.id}/${reason?.kind}`, {
            company: companyId,
            body: { reason: text },
            schema: accountSchema,
          })
        }
        onDone={refresh}
      />
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

function RowActions({
  account,
  manage,
  onSheet,
  onReason,
  onUnblock,
}: {
  account: Account;
  manage: boolean;
  onSheet: (mode: AccountSheetMode) => void;
  onReason: (action: ReasonAction) => void;
  onUnblock: () => void;
}) {
  const live = manage && account.archived === null;
  const items: { id: string; label: string; destructive?: boolean; run: () => void }[] = [
    {
      id: 'open',
      label: live ? t.actions.edit : t.actions.view,
      run: () => onSheet({ kind: 'edit', account }),
    },
    ...(live && account.kind === 'header' && account.level < 4
      ? [
          {
            id: 'child',
            label: t.actions.addChild,
            run: () => onSheet({ kind: 'create', parent: account }),
          },
        ]
      : []),
    ...(live && account.kind === 'postable'
      ? account.blocked
        ? [{ id: 'unblock', label: t.actions.unblock, run: onUnblock }]
        : [
            {
              id: 'block',
              label: t.actions.block,
              destructive: true,
              run: () => onReason({ kind: 'block', account }),
            },
          ]
      : []),
    ...(live && account.level > 1
      ? [
          {
            id: 'archive',
            label: t.actions.archive,
            destructive: true,
            run: () => onReason({ kind: 'archive', account }),
          },
        ]
      : []),
    ...(manage && account.archived !== null
      ? [
          {
            id: 'restore',
            label: t.actions.restore,
            run: () => onReason({ kind: 'restore', account }),
          },
        ]
      : []),
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={`${t.tree.menu}: ${account.code}`} />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            variant={item.destructive ? 'destructive' : 'default'}
            onClick={item.run}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A chart of the five roots alone (S02 rule 1): the templates, applied by an owner or accountant. */
function Templates({ manage }: { manage: boolean }) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const templates = useQuery(templatesQuery(companyId));
  const apply = useMutation({
    mutationFn: (templateId: ChartTemplateId) =>
      api('POST', '/chart/apply-template', {
        company: companyId,
        body: applyChartTemplateSchema.parse({ templateId }),
        schema: listOf(accountSchema),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chart', companyId] }),
  });
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <EmptyState
        icon={<LayoutTemplateIcon />}
        title={t.empty.title}
        description={t.empty.description}
      />
      <Callout tone="warning" icon={<InfoIcon />} title={t.empty.draft} />
      <FormError error={templates.error ?? apply.error} />
      <div className="grid gap-4 md:grid-cols-2">
        {templates.data?.map((template) => (
          <Card key={template.id}>
            <CardHeader>
              <CardTitle>{t.templates[template.id]}</CardTitle>
              <CardDescription>
                <bdi dir="ltr">{`${template.accountCount}`}</bdi> {t.empty.accounts}
              </CardDescription>
            </CardHeader>
            {manage && (
              <div className="px-6 pb-6">
                <Button
                  loading={apply.isPending && apply.variables === template.id}
                  disabled={apply.isPending}
                  onClick={() => apply.mutate(template.id)}
                >
                  {t.empty.apply}
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
