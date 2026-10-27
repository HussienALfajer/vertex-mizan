import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  invitationLookupSchema,
  myMembershipSchema,
  signInResultSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Button, Field, FieldError, FieldLabel, Input, Skeleton } from '@vertex-mizan/ui';
import { useEffect, useState } from 'react';
import { AuthHeading } from '../../components/auth-layout';
import { FormError } from '../../components/form-error';
import { api, errorText } from '../../lib/api';
import { useFragmentToken } from '../../lib/fragment-token';
import { meQuery } from '../../lib/session';
import { NewPasswordFields } from './new-password-fields';
import { newPasswordError } from './validation';

const t = ar.auth;

/**
 * Where the invitation's token waits while an existing person signs in to accept it: this tab
 * only, removed once accepted. It never goes into a URL.
 */
const pendingInvitationKey = 'mizan.pendingInvitation';

function storedToken(): string | undefined {
  try {
    return sessionStorage.getItem(pendingInvitationKey) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeToken(token: string | undefined) {
  try {
    if (token) sessionStorage.setItem(pendingInvitationKey, token);
    else sessionStorage.removeItem(pendingInvitationKey);
  } catch {
    // Without session storage the person opens the emailed link again after signing in.
  }
}

/**
 * `/invitation#token=…` (S01 rule 15): what the link invites to; a new person sets a name and a
 * password, an existing one signs in (both steps) and accepts.
 */
export function InvitationPage() {
  const fromLink = useFragmentToken();
  const [token] = useState(() => fromLink ?? storedToken());
  useEffect(() => storeToken(token), [token]);

  const lookup = useQuery({
    queryKey: ['auth', 'invitation', token],
    queryFn: () =>
      api('POST', '/invitations/lookup', { body: { token }, schema: invitationLookupSchema }),
    enabled: token !== undefined,
    retry: false,
  });

  if (!token || lookup.isError) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeading
          title={t.invitation.invalidTitle}
          description={lookup.isError ? errorText(lookup.error) : ar.errors.LINK_INVALID}
        />
        <Button variant="secondary" render={<Link to="/sign-in" />}>
          {t.reset.signIn}
        </Button>
      </div>
    );
  }

  if (!lookup.data) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <AuthHeading title={t.invitation.title} />
        <Skeleton className="h-control" />
        <Skeleton className="h-control" />
      </div>
    );
  }

  const invitation = lookup.data;
  return (
    <div className="flex flex-col gap-5">
      <AuthHeading title={t.invitation.title} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-md bg-muted px-4 py-3 text-control">
        <dt className="whitespace-nowrap text-muted-foreground">{t.invitation.invitedTo}</dt>
        <dd className="font-bold text-foreground">
          <bdi>{invitation.companyName}</bdi>
        </dd>
        <dt className="whitespace-nowrap text-muted-foreground">{t.invitation.asRole}</dt>
        <dd className="text-foreground">{ar.roles[invitation.role]}</dd>
        <dt className="whitespace-nowrap text-muted-foreground">{t.invitation.sentTo}</dt>
        <dd className="min-w-0 break-all text-foreground">
          <bdi dir="ltr">{invitation.email}</bdi>
        </dd>
      </dl>
      {invitation.personExists ? (
        <ExistingPerson token={token} />
      ) : (
        <NewPerson token={token} email={invitation.email} />
      )}
    </div>
  );
}

/** An existing person accepts once signed in as the invited email, both steps done. */
function ExistingPerson({ token }: { token: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);
  const accept = useMutation({
    mutationFn: () =>
      api('POST', '/invitations/accept', { body: { token }, schema: myMembershipSchema }),
    onSuccess: async () => {
      storeToken(undefined);
      await queryClient.resetQueries({ queryKey: meQuery.queryKey });
      await navigate({ to: '/' });
    },
  });

  if (me.isPending) return <Skeleton className="h-control" />;
  if (!me.data) {
    return (
      <>
        <p className="text-control text-muted-foreground">{t.invitation.existingPerson}</p>
        <Button render={<Link to="/sign-in" search={{ redirect: '/invitation' }} />}>
          {t.invitation.signInToAccept}
        </Button>
      </>
    );
  }
  return (
    <>
      <FormError error={accept.error} />
      <Button loading={accept.isPending} onClick={() => accept.mutate()}>
        {t.invitation.accept}
      </Button>
    </>
  );
}

/** A new person sets a name and a password, then signs in and enrols two-factor (S01 rule 2). */
function NewPerson({ token, email }: { token: string; email: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{
    name?: string | undefined;
    password?: string | undefined;
    confirm?: string | undefined;
  }>({});

  const accept = useMutation({
    mutationFn: async () => {
      await api('POST', '/invitations/accept', {
        body: { token, name: name.trim(), password },
        schema: myMembershipSchema,
      });
      storeToken(undefined);
      // The link verified the email (S01 rule 15): sign in, then enrol. The membership exists
      // already, so if this sign-in fails the person signs in by hand.
      try {
        await api('POST', '/auth/sign-in/email', {
          body: { email, password },
          schema: signInResultSchema,
        });
        return true;
      } catch {
        return false;
      }
    },
    onSuccess: async (signedIn) => {
      if (!signedIn) {
        await navigate({ to: '/sign-in', search: { redirect: undefined } });
        return;
      }
      await queryClient.resetQueries({ queryKey: meQuery.queryKey });
      await navigate({ to: '/two-factor/enrol', search: { redirect: undefined } });
    },
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const found = {
          name: name.trim() === '' ? t.validation.required : undefined,
          ...newPasswordError(password, confirm, email),
        };
        setErrors(found);
        if (!found.name && !found.password && !found.confirm) accept.mutate();
      }}
    >
      <p className="text-control text-muted-foreground">{t.invitation.newPerson}</p>
      <Field invalid={errors.name !== undefined}>
        <FieldLabel>{t.fields.name}</FieldLabel>
        <Input
          autoComplete="name"
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <FieldError match={errors.name !== undefined}>{errors.name}</FieldError>
      </Field>
      <NewPasswordFields
        password={password}
        confirm={confirm}
        onPasswordChange={setPassword}
        onConfirmChange={setConfirm}
        errors={errors}
      />
      <FormError error={accept.error} />
      <Button type="submit" loading={accept.isPending}>
        {t.invitation.accept}
      </Button>
    </form>
  );
}
