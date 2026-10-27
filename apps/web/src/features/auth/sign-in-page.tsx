import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { signInResultSchema } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Button, Field, FieldError, FieldLabel, Input, PasswordInput } from '@vertex-mizan/ui';
import { useState } from 'react';
import { AuthHeading } from '../../components/auth-layout';
import { FormError } from '../../components/form-error';
import { api } from '../../lib/api';
import { meQuery } from '../../lib/session';
import { emailError } from './validation';

const t = ar.auth;

/** `/sign-in`: the first step, email and password (S01 rule 1). */
export function SignInPage({ redirect }: { redirect: string | undefined }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{
    email?: string | undefined;
    password?: string | undefined;
  }>({});

  const signIn = useMutation({
    mutationFn: () =>
      api('POST', '/auth/sign-in/email', {
        body: { email, password },
        schema: signInResultSchema,
      }),
    onSuccess: async ({ twoFactorRequired }) => {
      if (twoFactorRequired) {
        await navigate({ to: '/sign-in/two-factor', search: { redirect } });
        return;
      }
      // Not enrolled yet: the session reaches only enrolment (S01 rule 2).
      await queryClient.resetQueries({ queryKey: meQuery.queryKey });
      await navigate({ to: '/two-factor/enrol', search: { redirect } });
    },
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const found = {
          email: emailError(email),
          password: password === '' ? t.validation.required : undefined,
        };
        setErrors(found);
        if (!found.email && !found.password) signIn.mutate();
      }}
    >
      <AuthHeading title={t.signIn.title} description={t.signIn.description} />
      <Field invalid={errors.email !== undefined}>
        <FieldLabel>{t.fields.email}</FieldLabel>
        <Input
          type="email"
          dir="ltr"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <FieldError match={errors.email !== undefined}>{errors.email}</FieldError>
      </Field>
      <Field invalid={errors.password !== undefined}>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>{t.fields.password}</FieldLabel>
          <Link to="/forgot-password" className="text-control text-primary hover:underline">
            {t.signIn.forgot}
          </Link>
        </div>
        <PasswordInput
          autoComplete="current-password"
          showLabel={t.fields.showPassword}
          hideLabel={t.fields.hidePassword}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <FieldError match={errors.password !== undefined}>{errors.password}</FieldError>
      </Field>
      <FormError error={signIn.error} />
      <Button type="submit" loading={signIn.isPending}>
        {t.signIn.submit}
      </Button>
    </form>
  );
}
