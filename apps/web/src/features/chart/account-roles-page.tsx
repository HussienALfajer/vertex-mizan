import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type Account,
  type AccountRole,
  accountRoleAssignmentSchema,
  accountRoleFits,
  setAccountRoleSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  AccountPicker,
  Badge,
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '../../components/form-error';
import { api, listOf } from '../../lib/api';
import { can, useCompany } from '../../lib/session';
import { accountRolesQuery, accountsQuery } from './chart-queries';

const t = ar.chart;
const r = t.roleSettings;

/**
 * `/chart/roles` (S02 rule 7): the six accounts the system posts to by itself. A missing role is
 * warned; owners and accountants change a role through the account picker, which offers only the
 * accounts that fit it.
 */
export function AccountRolesPage() {
  const { companyId, me, membership } = useCompany();
  const manage = can(me, 'accounts.manage') && !membership.company.archived;
  const roles = useQuery(accountRolesQuery(companyId));
  const accounts = useQuery(accountsQuery(companyId));
  const [editing, setEditing] = useState<AccountRole | null>(null);
  const byId = new Map(accounts.data?.map((account) => [account.id, account]));
  const missing = roles.data?.some((assignment) => assignment.accountId === null) ?? false;
  const error = roles.error ?? accounts.error;

  return (
    <>
      <PageHeader title={r.title} description={r.description} />
      {!can(me, 'accounts.manage') && (
        <Callout tone="info" icon={<InfoIcon />} title={t.readOnly} />
      )}
      {missing && (
        <Callout
          tone="warning"
          icon={<TriangleAlertIcon />}
          title={r.missingTitle}
          description={r.missingDescription}
        />
      )}
      {roles.isPending || accounts.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
        </div>
      ) : error ? (
        <FormError error={error} />
      ) : (
        <Table aria-label={r.label}>
          <TableHeader>
            <TableRow>
              <TableHead>{r.role}</TableHead>
              <TableHead>{r.account}</TableHead>
              <TableHead className="max-md:hidden">{r.fits}</TableHead>
              {manage && (
                <TableHead>
                  <span className="sr-only">{t.tree.actions}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.data?.map(({ role, accountId }) => {
              const account = accountId ? byId.get(accountId) : undefined;
              return (
                <TableRow key={role}>
                  <TableCell className="font-medium">{t.roles[role]}</TableCell>
                  <TableCell>
                    {account ? (
                      <AccountLabel code={account.code} name={account.name} />
                    ) : (
                      <Badge tone="warning">
                        <TriangleAlertIcon aria-hidden="true" />
                        {r.notSet}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-md:hidden">
                    {t.roleFits[role]}
                  </TableCell>
                  {manage && (
                    <TableCell className="text-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${r.change}: ${t.roles[role]}`}
                        onClick={() => setEditing(role)}
                      >
                        {r.change}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {editing && accounts.data && (
        <RoleDialog
          key={editing}
          role={editing}
          accounts={accounts.data}
          current={roles.data?.find((assignment) => assignment.role === editing)?.accountId ?? null}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function RoleDialog({
  role,
  accounts,
  current,
  onClose,
}: {
  role: AccountRole;
  accounts: readonly Account[];
  current: string | null;
  onClose: () => void;
}) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState<string | null>(current);
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: (id: string) =>
      api('PUT', '/account-roles', {
        company: companyId,
        body: setAccountRoleSchema.parse({ role, accountId: id }),
        schema: listOf(accountRoleAssignmentSchema),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['chart', companyId] });
      onClose();
    },
  });
  // Only the accounts that fit the role, with their headers for context.
  const fitting = accounts.filter((account) => accountRoleFits(role, account));
  const headers = new Set(fitting.map((account) => account.parentId));
  const options = accounts
    .filter((account) => fitting.includes(account) || headers.has(account.id))
    .map((account) => ({
      ...account,
      blocked: account.blocked !== null,
      archived: account.archived !== null,
    }));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={ar.common.close}>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!accountId) {
              setInvalid(true);
              return;
            }
            save.mutate(accountId);
          }}
        >
          <DialogHeader>
            <DialogTitle>{`${r.changeTitle}: ${t.roles[role]}`}</DialogTitle>
            <DialogDescription>{t.roleFits[role]}</DialogDescription>
          </DialogHeader>
          <AccountPicker
            label={r.picker}
            accounts={options}
            value={accountId}
            onValueChange={(id) => {
              setInvalid(false);
              setAccountId(id);
            }}
            labels={{ ...t.picker, header: t.kinds.header, blocked: t.tree.blocked }}
            error={invalid ? t.validation.required : undefined}
          />
          <FormError error={save.error} />
          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              {r.save}
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
