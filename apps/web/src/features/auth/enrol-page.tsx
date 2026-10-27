import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { type TwoFactorSetup, twoFactorSetupSchema } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
  Checkbox,
  Field,
  FieldError,
  FieldLabel,
  OtpField,
  PasswordInput,
  QrCode,
  SecretCodeList,
} from '@vertex-mizan/ui';
import { useRef, useState } from 'react';
import { AuthHeading } from '../../components/auth-layout';
import { FormError } from '../../components/form-error';
import { useSensitiveAction } from '../../components/reauth-dialog';
import { api } from '../../lib/api';
import { meQuery } from '../../lib/session';

const t = ar.auth;

/** The secret inside an `otpauth://` URI, for people who type it instead of scanning. */
function secretOf(uri: string): string {
  return new URL(uri).searchParams.get('secret') ?? '';
}

/**
 * `/two-factor/enrol` (S01 rules 2–3): the password again, then the QR code and the secret as
 * text, a first code that must verify, then the 10 backup codes, shown once. A person re-enrolling
 * keeps their old authenticator until the new one verifies.
 */
export function EnrolPage({ redirect }: { redirect: string | undefined }) {
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [verified, setVerified] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <AuthHeading title={t.enrol.title} description={t.enrol.description} />
      {!setup ? (
        <PasswordStep onSetup={setSetup} />
      ) : !verified ? (
        <VerifyStep setup={setup} onVerified={() => setVerified(true)} />
      ) : (
        <BackupCodesStep codes={setup.backupCodes} redirect={redirect} />
      )}
    </div>
  );
}

function PasswordStep({ onSetup }: { onSetup: (setup: TwoFactorSetup) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const { run, dialog } = useSensitiveAction();
  const enable = useMutation({
    mutationFn: () =>
      run(() =>
        api('POST', '/auth/two-factor/enable', {
          body: { password },
          schema: twoFactorSetupSchema,
        }),
      ),
    onSuccess: onSetup,
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const found = password === '' ? t.validation.required : undefined;
        setError(found);
        if (!found) enable.mutate();
      }}
    >
      <p className="text-control text-foreground">{t.enrol.passwordStep}</p>
      <Field invalid={error !== undefined}>
        <FieldLabel>{t.fields.password}</FieldLabel>
        <PasswordInput
          autoComplete="current-password"
          showLabel={t.fields.showPassword}
          hideLabel={t.fields.hidePassword}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <FieldError match={error !== undefined}>{error}</FieldError>
      </Field>
      <FormError error={enable.error} />
      <Button type="submit" loading={enable.isPending}>
        {t.enrol.start}
      </Button>
      {dialog}
    </form>
  );
}

function VerifyStep({ setup, onVerified }: { setup: TwoFactorSetup; onVerified: () => void }) {
  const [code, setCode] = useState('');
  const sent = useRef(false);
  const verify = useMutation({
    mutationFn: (value: string) =>
      api('POST', '/auth/two-factor/verify-totp', { body: { code: value } }),
    onSuccess: onVerified,
    onError: () => {
      sent.current = false;
      setCode('');
    },
  });

  function submit(value: string) {
    if (value.length !== 6 || sent.current) return;
    sent.current = true;
    verify.mutate(value);
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
      <p className="text-control text-foreground">{t.enrol.scanStep}</p>
      <QrCode value={setup.totpURI} label={t.enrol.qr} className="self-center" />
      <p className="text-control text-muted-foreground">{t.enrol.secretStep}</p>
      <SecretCodeList
        codes={[secretOf(setup.totpURI)]}
        columns={1}
        label={t.enrol.secret}
        copyLabel={t.codes.copy}
        copiedLabel={t.codes.copied}
      />
      <p className="text-control text-foreground">{t.enrol.codeStep}</p>
      <OtpField
        aria-label={t.fields.code}
        slotLabel={(position) => `${t.fields.slot} ${position}`}
        value={code}
        onValueChange={setCode}
        onValueComplete={submit}
        autoComplete="one-time-code"
        disabled={verify.isPending}
      />
      <FormError error={verify.error} />
      <Button type="submit" loading={verify.isPending} disabled={code.length !== 6}>
        {t.enrol.verify}
      </Button>
    </form>
  );
}

function BackupCodesStep({
  codes,
  redirect,
}: {
  codes: readonly string[];
  redirect: string | undefined;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold text-foreground">{t.enrol.backupTitle}</h2>
        <p className="text-control text-muted-foreground">{t.enrol.backupBody}</p>
      </div>
      <SecretCodeList
        codes={codes}
        label={t.enrol.backupCodes}
        copyLabel={t.codes.copy}
        copiedLabel={t.codes.copied}
        printLabel={t.codes.print}
      />
      {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI's checkbox is the control. */}
      <label className="flex items-center gap-3 text-control text-foreground">
        <Checkbox checked={saved} onCheckedChange={setSaved} />
        {t.enrol.saved}
      </label>
      <Button
        disabled={!saved}
        onClick={async () => {
          await queryClient.resetQueries({ queryKey: meQuery.queryKey });
          await router.navigate({ href: redirect ?? '/' });
        }}
      >
        {t.enrol.finish}
      </Button>
    </div>
  );
}
