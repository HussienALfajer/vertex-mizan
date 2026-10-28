import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ar } from '@vertex-mizan/i18n';
import { Button, Field, FieldError, FieldLabel, Input } from '@vertex-mizan/ui';
import { useState } from 'react';
import { AuthHeading } from '../../components/auth-layout';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { api } from '../../lib/api';
import { emailError } from './validation';

const t = ar.auth;

/** `/forgot-password`: asks for a reset link; the answer is the same for every email (S01 rule 6). */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const request = useMutation({
    mutationFn: () => api('POST', '/auth/request-password-reset', { body: { email } }),
  });

  if (request.isSuccess) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeading title={t.forgot.sentTitle} description={t.forgot.sentBody} />
        <Button variant="secondary" render={<Link to="/sign-in" />}>
          {t.forgot.back}
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const found = emailError(email);
        setError(found);
        if (found) setAttempt((count) => count + 1);
        else request.mutate();
      }}
    >
      <AuthHeading title={t.forgot.title} description={t.forgot.description} />
      <FormErrorSummary attempt={attempt} errors={[['forgot-email', error]]} />
      <Field id="forgot-email" invalid={error !== undefined}>
        <FieldLabel>{t.fields.email}</FieldLabel>
        <Input
          type="email"
          dir="ltr"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <FieldError match={error !== undefined}>{error}</FieldError>
      </Field>
      <FormError error={request.error} />
      <Button type="submit" loading={request.isPending}>
        {t.forgot.submit}
      </Button>
      <Button variant="link" className="self-center" render={<Link to="/sign-in" />}>
        {t.forgot.back}
      </Button>
    </form>
  );
}
