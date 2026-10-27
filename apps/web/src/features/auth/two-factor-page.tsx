import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import { ar } from '@vertex-mizan/i18n';
import { Button, Field, FieldLabel, Input, OtpField } from '@vertex-mizan/ui';
import { useRef, useState } from 'react';
import { AuthHeading } from '../../components/auth-layout';
import { FormError } from '../../components/form-error';
import { api } from '../../lib/api';
import { meQuery } from '../../lib/session';

const t = ar.auth;

/** `/sign-in/two-factor`: the second step, an authenticator code or one backup code (S01 rule 1). */
export function TwoFactorPage({ redirect }: { redirect: string | undefined }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'app' | 'backup'>('app');
  const [code, setCode] = useState('');
  const sent = useRef(false);

  const verify = useMutation({
    mutationFn: (value: string) =>
      api(
        'POST',
        mode === 'app' ? '/auth/two-factor/verify-totp' : '/auth/two-factor/verify-backup-code',
        { body: { code: value } },
      ),
    onSuccess: async () => {
      await queryClient.resetQueries({ queryKey: meQuery.queryKey });
      await router.navigate({ href: redirect ?? '/' });
    },
    onError: () => {
      sent.current = false;
      setCode('');
    },
  });

  function submit(value: string) {
    const ready = mode === 'app' ? value.length === 6 : value.trim() !== '';
    if (!ready || sent.current) return;
    sent.current = true;
    verify.mutate(value.trim());
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit(code);
      }}
    >
      <AuthHeading
        title={t.twoFactor.title}
        description={mode === 'app' ? t.twoFactor.description : t.twoFactor.backupDescription}
      />
      {mode === 'app' ? (
        <OtpField
          aria-label={t.fields.code}
          slotLabel={(position) => `${t.fields.slot} ${position}`}
          value={code}
          onValueChange={setCode}
          onValueComplete={submit}
          autoComplete="one-time-code"
          autoFocus
          disabled={verify.isPending}
        />
      ) : (
        <Field>
          <FieldLabel>{t.fields.backupCode}</FieldLabel>
          <Input
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoFocus
          />
        </Field>
      )}
      <FormError error={verify.error} />
      <Button type="submit" loading={verify.isPending}>
        {t.twoFactor.submit}
      </Button>
      <Button
        type="button"
        variant="link"
        className="self-center"
        onClick={() => {
          setMode(mode === 'app' ? 'backup' : 'app');
          setCode('');
          verify.reset();
        }}
      >
        {mode === 'app' ? t.twoFactor.useBackup : t.twoFactor.useApp}
      </Button>
      {/* The first step expires, and the API then refuses every code alike: start again here. */}
      <p className="text-center text-control text-muted-foreground">
        {t.twoFactor.expired}{' '}
        <Link to="/sign-in" search={{ redirect }} className="text-primary hover:underline">
          {t.twoFactor.backToSignIn}
        </Link>
      </p>
    </form>
  );
}
