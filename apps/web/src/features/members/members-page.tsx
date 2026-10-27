import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import {
  acceptsPeriodPermission,
  createInvitationSchema,
  effectivePermissions,
  type Invitation,
  invitationSchema,
  type Member,
  memberSchema,
  ROLES,
  type Role,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
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
} from '@vertex-mizan/ui';
import {
  CircleCheckIcon,
  EllipsisIcon,
  InfoIcon,
  ShieldCheckIcon,
  UserPlusIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { FormError } from '../../components/form-error';
import { ReasonDialog } from '../../components/reason-dialog';
import { useSensitiveAction } from '../../components/reauth-dialog';
import { api } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { can, meQuery, useCompany } from '../../lib/session';
import { emailError } from '../auth/validation';
import { useLeaveCompany } from '../company/company-settings-page';
import { invitationsQuery, membersQuery } from './members-queries';

const t = ar.members;

type Action =
  | { kind: 'change' | 'remove' | 'reset' | 'leave'; member: Member }
  | { kind: 'invite' };

/**
 * `/settings/members` (S01 rules 14–18, 21): the members and the pending invitations. Owners
 * invite, change roles, remove and reset two-factor; auditors read.
 */
export function MembersPage() {
  const { companyId, me, membership } = useCompany();
  const manage = can(me, 'members.manage') && !membership.company.archived;
  const members = useQuery(membersQuery(companyId));
  const [action, setAction] = useState<Action | null>(null);

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          manage && (
            <Button onClick={() => setAction({ kind: 'invite' })}>
              <UserPlusIcon aria-hidden="true" />
              {t.invite}
            </Button>
          )
        }
      />
      {!can(me, 'members.manage') && <Callout tone="info" icon={<InfoIcon />} title={t.readOnly} />}
      {members.isPending ? (
        <Loading />
      ) : members.isError ? (
        <FormError error={members.error} />
      ) : members.data.length === 0 ? (
        <EmptyState title={t.emptyTitle} />
      ) : (
        <Table aria-label={t.table.label}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.table.name}</TableHead>
              <TableHead>{t.table.email}</TableHead>
              <TableHead>{t.table.role}</TableHead>
              <TableHead>{t.table.periods}</TableHead>
              <TableHead>{t.table.twoFactor}</TableHead>
              <TableHead>{t.table.joined}</TableHead>
              <TableHead>
                <span className="sr-only">{t.table.actions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.data.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                self={member.userId === me.person.id}
                manage={manage}
                onAction={(kind) => setAction({ kind, member })}
              />
            ))}
          </TableBody>
        </Table>
      )}
      <Invitations manage={manage} />
      <Dialogs action={action} onClose={() => setAction(null)} />
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

function MemberRow({
  member,
  self,
  manage,
  onAction,
}: {
  member: Member;
  self: boolean;
  manage: boolean;
  onAction: (kind: 'change' | 'remove' | 'reset' | 'leave') => void;
}) {
  const items: { kind: 'change' | 'remove' | 'reset' | 'leave'; label: string }[] = [
    ...(manage ? [{ kind: 'change' as const, label: t.actions.change }] : []),
    ...(manage && !self
      ? [
          { kind: 'reset' as const, label: t.actions.resetTwoFactor },
          { kind: 'remove' as const, label: t.actions.remove },
        ]
      : []),
    ...(self ? [{ kind: 'leave' as const, label: t.actions.leave }] : []),
  ];
  return (
    <TableRow>
      <TableCell>
        <span className="flex flex-wrap items-center gap-2">
          <bdi className="font-medium">{member.name}</bdi>
          {self && <Badge tone="brand">{t.table.you}</Badge>}
        </span>
      </TableCell>
      <TableCell>
        <bdi dir="ltr">{member.email}</bdi>
      </TableCell>
      <TableCell className="whitespace-nowrap">{ar.roles[member.role]}</TableCell>
      <TableCell>
        {effectivePermissions(member).includes('periods.close') ? t.table.yes : t.table.no}
      </TableCell>
      <TableCell>
        <Badge tone={member.twoFactorEnabled ? 'success' : 'warning'}>
          {member.twoFactorEnabled ? t.table.enrolled : t.table.notEnrolled}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap">{formatDate(member.joinedAt)}</TableCell>
      <TableCell className="text-end">
        {items.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t.actions.menu}: ${member.name}`}
                />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {items.map((item) => (
                <DropdownMenuItem
                  key={item.kind}
                  variant={item.kind === 'change' ? 'default' : 'destructive'}
                  onClick={() => onAction(item.kind)}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}

/** Pending invitations (rule 15): an owner revokes one. */
function Invitations({ manage }: { manage: boolean }) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const invitations = useQuery(invitationsQuery(companyId));
  const revoke = useMutation({
    mutationFn: (id: string) => api('POST', `/invitations/${id}/revoke`, { company: companyId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members', companyId] }),
  });
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-lg font-bold text-foreground">{t.invitations.title}</h2>
      <FormError error={revoke.error} />
      {invitations.isPending ? (
        <Loading />
      ) : invitations.isError ? (
        <FormError error={invitations.error} />
      ) : invitations.data.length === 0 ? (
        <EmptyState title={t.invitations.empty} />
      ) : (
        <Table aria-label={t.invitations.label}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.invitations.email}</TableHead>
              <TableHead>{t.invitations.role}</TableHead>
              <TableHead>{t.invitations.invitedBy}</TableHead>
              <TableHead>{t.invitations.expires}</TableHead>
              {manage && (
                <TableHead>
                  <span className="sr-only">{t.table.actions}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.data.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                manage={manage}
                revoking={revoke.isPending && revoke.variables === invitation.id}
                onRevoke={() => revoke.mutate(invitation.id)}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function InvitationRow({
  invitation,
  manage,
  revoking,
  onRevoke,
}: {
  invitation: Invitation;
  manage: boolean;
  revoking: boolean;
  onRevoke: () => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <bdi dir="ltr">{invitation.email}</bdi>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {ar.roles[invitation.role]}
        {invitation.canClosePeriods && (
          <Badge tone="outline" className="ms-2">
            {t.table.periods}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <bdi>{invitation.invitedBy?.name ?? t.invitations.system}</bdi>
      </TableCell>
      <TableCell className="whitespace-nowrap">{formatDateTime(invitation.expiresAt)}</TableCell>
      {manage && (
        <TableCell className="text-end">
          <Button
            variant="ghost"
            size="sm"
            loading={revoking}
            onClick={onRevoke}
            aria-label={`${t.invitations.revoke}: ${invitation.email}`}
          >
            {t.invitations.revoke}
          </Button>
        </TableCell>
      )}
    </TableRow>
  );
}

function Dialogs({ action, onClose }: { action: Action | null; onClose: () => void }) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const leave = useLeaveCompany();
  const router = useRouter();
  // A change to one's own role changes what the pages offer: the person loads again too.
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['members', companyId] });
    await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
    await router.invalidate();
  };
  const member = action && action.kind !== 'invite' ? action.member : undefined;
  const reasonCopy =
    action?.kind === 'remove' ? t.remove : action?.kind === 'reset' ? t.resetTwoFactor : t.leave;

  return (
    <>
      <InviteDialog open={action?.kind === 'invite'} onClose={onClose} onDone={refresh} />
      {member && action?.kind === 'change' && (
        <ChangeRoleDialog member={member} onClose={onClose} onDone={refresh} />
      )}
      <ReasonDialog
        open={
          member !== undefined &&
          (action?.kind === 'remove' || action?.kind === 'reset' || action?.kind === 'leave')
        }
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title={reasonCopy.title}
        description={reasonCopy.description}
        reasonLabel={t.reason}
        submitLabel={reasonCopy.submit}
        destructive
        onConfirm={(reason) => {
          if (!member) return Promise.resolve();
          if (action?.kind === 'leave') return leave.leave(companyId, member.id, reason);
          return api(
            'POST',
            `/members/${member.id}/${action?.kind === 'reset' ? 'reset-two-factor' : 'remove'}`,
            { company: companyId, body: { reason } },
          );
        }}
        onDone={action?.kind === 'leave' ? leave.done : refresh}
      >
        {member && (
          <p className="text-control">
            <bdi className="font-medium">{member.name}</bdi> · <bdi dir="ltr">{member.email}</bdi>
          </p>
        )}
      </ReasonDialog>
    </>
  );
}

const roleOptions = ROLES.map((role) => ({ value: role, label: ar.roles[role] }));

/** A role with the period permission, shown only for an accountant (S01 "Roles"). */
function RoleFields({
  role,
  canClosePeriods,
  onChange,
}: {
  role: Role;
  canClosePeriods: boolean;
  onChange: (value: { role: Role; canClosePeriods: boolean }) => void;
}) {
  const granted = effectivePermissions({ role, canClosePeriods });
  return (
    <>
      <SelectField
        label={t.table.role}
        value={role}
        options={roleOptions}
        onValueChange={(next) =>
          onChange({
            role: next,
            canClosePeriods: acceptsPeriodPermission(next) && canClosePeriods,
          })
        }
      />
      {acceptsPeriodPermission(role) && (
        <SwitchField
          label={t.periodPermission}
          description={t.periodPermissionHint}
          checked={canClosePeriods}
          onCheckedChange={(next) => onChange({ role, canClosePeriods: next })}
        />
      )}
      <Callout
        tone="neutral"
        icon={<ShieldCheckIcon />}
        title={t.rolePermissions}
        description={
          <ul className="list-inside list-disc">
            {granted.map((permission) => (
              <li key={permission}>{ar.permissions[permission]}</li>
            ))}
          </ul>
        }
      />
    </>
  );
}

function FormDialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent closeLabel={ar.common.close}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { companyId } = useCompany();
  const { run, dialog } = useSensitiveAction();
  const [email, setEmail] = useState('');
  const [assignment, setAssignment] = useState<{ role: Role; canClosePeriods: boolean }>({
    role: 'accountant',
    canClosePeriods: false,
  });
  const [invalid, setInvalid] = useState<string | undefined>();
  const invite = useMutation({
    mutationFn: () =>
      run(() =>
        api('POST', '/invitations', {
          company: companyId,
          body: createInvitationSchema.parse({ email, ...assignment }),
          schema: invitationSchema,
        }),
      ),
    onSuccess: onDone,
  });

  function close() {
    setEmail('');
    setAssignment({ role: 'accountant', canClosePeriods: false });
    setInvalid(undefined);
    invite.reset();
    onClose();
  }

  return (
    <>
      <FormDialog
        open={open}
        onClose={close}
        title={t.inviteDialog.title}
        description={t.inviteDialog.description}
      >
        {invite.isSuccess ? (
          <>
            <Callout
              role="status"
              tone="info"
              icon={<CircleCheckIcon />}
              title={t.inviteDialog.sent}
            />
            <DialogFooter>
              <Button onClick={close}>{ar.common.close}</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const found = emailError(email);
              setInvalid(found);
              if (!found) invite.mutate();
            }}
          >
            <Field invalid={invalid !== undefined}>
              <FieldLabel>{t.inviteDialog.email}</FieldLabel>
              <Input
                type="email"
                dir="ltr"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <FieldError match={invalid !== undefined}>{invalid}</FieldError>
            </Field>
            <RoleFields {...assignment} onChange={setAssignment} />
            <FormError error={invite.error} />
            <DialogFooter>
              <Button type="submit" loading={invite.isPending}>
                {t.inviteDialog.submit}
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                {ar.common.cancel}
              </Button>
            </DialogFooter>
          </form>
        )}
      </FormDialog>
      {dialog}
    </>
  );
}

/** Takes effect on the member's next request (rule 16); the last owner stays (rule 18). */
function ChangeRoleDialog({
  member,
  onClose,
  onDone,
}: {
  member: Member;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { companyId } = useCompany();
  const { run, dialog } = useSensitiveAction();
  const [assignment, setAssignment] = useState({
    role: member.role,
    canClosePeriods: member.canClosePeriods,
  });
  const change = useMutation({
    mutationFn: () =>
      run(() =>
        api('PATCH', `/members/${member.id}`, {
          company: companyId,
          body: assignment,
          schema: memberSchema,
        }),
      ),
    onSuccess: async () => {
      await onDone();
      onClose();
    },
  });
  return (
    <>
      <FormDialog open onClose={onClose} title={t.change.title} description={t.change.description}>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            change.mutate();
          }}
        >
          <p className="text-control">
            <bdi className="font-medium">{member.name}</bdi> · <bdi dir="ltr">{member.email}</bdi>
          </p>
          <RoleFields {...assignment} onChange={setAssignment} />
          <FormError error={change.error} />
          <DialogFooter>
            <Button type="submit" loading={change.isPending}>
              {t.change.submit}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {ar.common.cancel}
            </Button>
          </DialogFooter>
        </form>
      </FormDialog>
      {dialog}
    </>
  );
}
