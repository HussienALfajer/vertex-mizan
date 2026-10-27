import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ar } from '@vertex-mizan/i18n';
import { Button } from '@vertex-mizan/ui';
import { useState } from 'react';
import { AuthHeading } from '../../components/auth-layout';
import { FormError } from '../../components/form-error';
import { api, hasCode } from '../../lib/api';
import { useFragmentToken } from '../../lib/fragment-token';
import { NewPasswordFields } from './new-password-fields';
import { newPasswordError } from './validation';

const t = ar.auth;

/** `/reset-password#token=…`: a new password from the emailed link (S01 rule 6). */
export function ResetPasswordPage() {
  const token = useFragmentToken();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const reset = useMutation({
    mutationFn: () => api('POST', '/auth/reset-password', { body: { token, password } }),
  });

  if (!token || hasCode(reset.error, 'LINK_INVALID')) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeading
          title={token ? ar.errors.LINK_INVALID : t.reset.missingTitle}
          description={t.reset.missingBody}
        />
        <Button render={<Link to="/forgot-password" />}>{t.reset.requestNew}</Button>
      </div>
    );
  }

  if (reset.isSuccess) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeading title={t.reset.doneTitle} description={t.reset.doneBody} />
        <Button render={<Link to="/sign-in" />}>{t.reset.signIn}</Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const found = newPasswordError(password, confirm);
        setErrors(found);
        if (!found.password && !found.confirm) reset.mutate();
      }}
    >
      <AuthHeading title={t.reset.title} description={t.reset.description} />
      <NewPasswordFields
        password={password}
        confirm={confirm}
        onPasswordChange={setPassword}
        onConfirmChange={setConfirm}
        errors={errors}
      />
      <FormError error={reset.error} />
      <Button type="submit" loading={reset.isPending}>
        {t.reset.submit}
      </Button>
    </form>
  );
}
