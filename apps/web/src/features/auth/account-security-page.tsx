import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { backupCodesSchema, type SignInEvent, signInPageSchema } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  FieldLabel,
  PageHeader,
  PasswordInput,
  SecretCodeList,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { LogOutIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { FormError } from '../../components/form-error';
import { useSensitiveAction } from '../../components/reauth-dialog';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { NewPasswordFields } from './new-password-fields';
import { newPasswordError } from './validation';

const t = ar.auth.security;
const { fields } = ar.auth;

/** `/account/security` (S01): the person's password, two-factor and recent sign-ins. */
export function AccountSecurityPage({ email }: { email: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: () => api('POST', '/auth/sign-out'),
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: '/sign-in', search: { redirect: undefined } });
    },
  });

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          <Button variant="outline" loading={signOut.isPending} onClick={() => signOut.mutate()}>
            <LogOutIcon aria-hidden="true" />
            {t.signOut}
          </Button>
        }
      />
      <FormError error={signOut.error} />
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <ChangePassword email={email} />
        <div className="flex flex-col gap-6">
          <BackupCodes />
          <Section title={t.authenticator.title} description={t.authenticator.description}>
            <Button
              variant="secondary"
              className="w-fit"
              render={<Link to="/two-factor/enrol" search={{ redirect: '/account/security' }} />}
            >
              {t.authenticator.action}
            </Button>
          </Section>
        </div>
      </div>
      <SignIns />
    </>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-4 px-6 pb-6">{children}</div>
    </Card>
  );
}

/** Changing the password ends every session (S01 rule 5), this one too: sign in again. */
function ChangePassword({ email }: { email: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { run, dialog } = useSensitiveAction();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{
    current?: string | undefined;
    password?: string | undefined;
    confirm?: string | undefined;
  }>({});
  const change = useMutation({
    mutationFn: () =>
      run(() => api('POST', '/me/password', { body: { currentPassword, newPassword } })),
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: '/sign-in', search: { redirect: undefined } });
    },
  });

  return (
    <Section title={t.password.title} description={t.password.description}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const found = {
            current: currentPassword === '' ? ar.auth.validation.required : undefined,
            ...newPasswordError(newPassword, confirm, email),
          };
          setErrors(found);
          if (!found.current && !found.password && !found.confirm) change.mutate();
        }}
      >
        <Field invalid={errors.current !== undefined}>
          <FieldLabel>{fields.currentPassword}</FieldLabel>
          <PasswordInput
            autoComplete="current-password"
            showLabel={fields.showPassword}
            hideLabel={fields.hidePassword}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>
        <NewPasswordFields
          password={newPassword}
          confirm={confirm}
          onPasswordChange={setNewPassword}
          onConfirmChange={setConfirm}
          errors={errors}
        />
        <FormError error={change.error} />
        <Button type="submit" className="w-fit" loading={change.isPending}>
          {t.password.submit}
        </Button>
      </form>
      {dialog}
    </Section>
  );
}

/** New backup codes void the old set (S01 rule 3), shown once. */
function BackupCodes() {
  const { run, dialog } = useSensitiveAction();
  const regenerate = useMutation({
    mutationFn: () =>
      run(() =>
        api('POST', '/auth/two-factor/generate-backup-codes', { schema: backupCodesSchema }),
      ),
  });
  return (
    <Section title={t.backupCodes.title} description={t.backupCodes.description}>
      {regenerate.data ? (
        <SecretCodeList
          codes={regenerate.data.backupCodes}
          label={t.backupCodes.newCodes}
          copyLabel={ar.auth.codes.copy}
          copiedLabel={ar.auth.codes.copied}
          printLabel={ar.auth.codes.print}
        />
      ) : (
        <Button
          variant="secondary"
          className="w-fit"
          loading={regenerate.isPending}
          onClick={() => regenerate.mutate()}
        >
          {t.backupCodes.regenerate}
        </Button>
      )}
      <FormError error={regenerate.error} />
      {dialog}
    </Section>
  );
}

/** The person's own platform audit entries, newest first, a page at a time (S01 rule 26). */
function SignIns() {
  const signIns = useInfiniteQuery({
    queryKey: ['auth', 'sign-ins'],
    queryFn: ({ pageParam }) =>
      api(
        'GET',
        pageParam ? `/me/sign-ins?cursor=${encodeURIComponent(pageParam)}` : '/me/sign-ins',
        { schema: signInPageSchema },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const entries = signIns.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-lg font-bold text-foreground">{t.signIns.title}</h2>
      {signIns.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
        </div>
      ) : signIns.isError ? (
        <FormError error={signIns.error} />
      ) : entries.length === 0 ? (
        <EmptyState title={t.signIns.empty} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.signIns.time}</TableHead>
                <TableHead>{t.signIns.event}</TableHead>
                <TableHead>{t.signIns.ipAddress}</TableHead>
                <TableHead>{t.signIns.device}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <SignInRow key={entry.id} entry={entry} />
              ))}
            </TableBody>
          </Table>
          {signIns.hasNextPage && (
            <Button
              variant="outline"
              className="w-fit self-center"
              loading={signIns.isFetchingNextPage}
              onClick={() => void signIns.fetchNextPage()}
            >
              {t.signIns.more}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

function SignInRow({ entry }: { entry: SignInEvent }) {
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">{formatDateTime(entry.createdAt)}</TableCell>
      <TableCell>{ar.auth.events[entry.action]}</TableCell>
      <TableCell>
        <bdi dir="ltr">{entry.ipAddress ?? t.signIns.unknown}</bdi>
      </TableCell>
      <TableCell className="max-w-64 truncate" title={entry.userAgent ?? undefined}>
        <bdi dir="ltr">{entry.userAgent ?? t.signIns.unknown}</bdi>
      </TableCell>
    </TableRow>
  );
}
