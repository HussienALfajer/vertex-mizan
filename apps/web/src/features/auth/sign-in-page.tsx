import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { signInResultSchema } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
  Callout,
  Field,
  FieldError,
  FieldLabel,
  Input,
  PasswordInput,
} from '@vertex-mizan/ui';
import { CircleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { AuthHeading } from '../../components/auth-layout';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { api } from '../../lib/api';
import { isEnrolled, meQuery } from '../../lib/session';
import { emailError } from './validation';

const t = ar.auth;

/**
 * `/sign-in` (S13 screen 1): email and password. The one person is exempt from two-factor (S01
 * rule 2); S13 has no two-factor screens (ADR 0024), so an account that needs them is told so.
 */
export function SignInPage({ redirect }: { redirect: string | undefined }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{
    email?: string | undefined;
    password?: string | undefined;
  }>({});
  const [attempt, setAttempt] = useState(0);
  const [twoFactor, setTwoFactor] = useState(false);

  const signIn = useMutation({
    mutationFn: () =>
      api('POST', '/auth/sign-in/email', {
        body: { email, password },
        schema: signInResultSchema,
      }),
    onMutate: () => setTwoFactor(false),
    onSuccess: async ({ twoFactorRequired }) => {
      await queryClient.resetQueries({ queryKey: meQuery.queryKey });
      const me = twoFactorRequired ? null : await queryClient.fetchQuery(meQuery);
      if (!me || !isEnrolled(me)) {
        setTwoFactor(true);
        return;
      }
      await router.navigate({ href: redirect ?? '/' });
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
        if (found.email || found.password) setAttempt((count) => count + 1);
        else signIn.mutate();
      }}
    >
      <AuthHeading title={t.signIn.title} description={t.signIn.description} />
      <FormErrorSummary
        attempt={attempt}
        errors={[
          ['sign-in-email', errors.email],
          ['sign-in-password', errors.password],
        ]}
      />
      <Field id="sign-in-email" invalid={errors.email !== undefined}>
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
      <Field id="sign-in-password" invalid={errors.password !== undefined}>
        <FieldLabel>{t.fields.password}</FieldLabel>
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
      {twoFactor && (
        <Callout
          role="alert"
          tone="warning"
          icon={<CircleAlertIcon />}
          title={t.signIn.twoFactorUnavailable}
        />
      )}
      <Button type="submit" loading={signIn.isPending}>
        {t.signIn.submit}
      </Button>
    </form>
  );
}
