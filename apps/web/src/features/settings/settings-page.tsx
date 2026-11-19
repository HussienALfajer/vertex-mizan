import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  type Branding,
  brandingSchema,
  LOGO_CONTENT_TYPES,
  LOGO_MAX_BYTES,
  type Me,
  updateBrandingSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  CompanyLogo,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FileUploadButton,
  Input,
  PageHeader,
  PasswordInput,
  Skeleton,
} from '@vertex-mizan/ui';
import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { useSensitiveAction } from '../../components/reauth-dialog';
import { api, upload } from '../../lib/api';
import { brandingQuery, logoUrl } from '../../lib/branding';
import { can } from '../../lib/session';
import { NewPasswordFields, newPasswordFieldIds } from '../auth/new-password-fields';
import { newPasswordError } from '../auth/validation';

const t = ar.settings;
const { fields } = ar.auth;

/**
 * `/settings` (S13 screen 10): the company's display name and logo, which the sign-in page, the
 * shell and every PDF show, and the person's password. Manual-entry approval is never offered
 * here (S13 "Access").
 */
export function SettingsPage({ me, companyId }: { me: Me; companyId: string }) {
  const branding = useQuery(brandingQuery(companyId));
  const canEdit = can(me, 'company.settings');
  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title={t.branding.title} description={t.branding.description}>
          {branding.isPending ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-control w-full" />
              <Skeleton className="h-16 w-48" />
            </div>
          ) : branding.isError ? (
            <EmptyState
              title={ar.common.errorTitle}
              description={ar.common.errorDescription}
              action={
                <Button variant="outline" onClick={() => void branding.refetch()}>
                  {ar.shell.reload}
                </Button>
              }
            />
          ) : (
            <>
              {!canEdit && (
                <Callout tone="info" icon={<CircleAlertIcon />} title={t.branding.readOnly} />
              )}
              <DisplayName companyId={companyId} branding={branding.data} canEdit={canEdit} />
              <Logo companyId={companyId} branding={branding.data} canEdit={canEdit} />
            </>
          )}
        </Section>
        <ChangePassword email={me.person.email} />
      </div>
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
      <div className="flex flex-col gap-5 px-6 pb-6">{children}</div>
    </Card>
  );
}

function Done({ show, title }: { show: boolean; title: string }) {
  if (!show) return null;
  return <Callout role="status" tone="info" icon={<CircleCheckIcon />} title={title} />;
}

/** The name the company is shown and printed under (`PUT /api/company/branding`). */
function DisplayName({
  companyId,
  branding,
  canEdit,
}: {
  companyId: string;
  branding: Branding;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(branding.displayName);
  const [error, setError] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const save = useMutation({
    mutationFn: () =>
      api('PUT', '/company/branding', {
        company: companyId,
        body: { displayName: name },
        schema: brandingSchema,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(brandingQuery(companyId).queryKey, saved);
      setName(saved.displayName);
    },
  });
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const found = nameError(name);
        setError(found);
        if (found) setAttempt((count) => count + 1);
        else save.mutate();
      }}
    >
      <FormErrorSummary attempt={attempt} errors={[['display-name', error]]} />
      <Field id="display-name" invalid={error !== undefined}>
        <FieldLabel>{t.branding.displayName}</FieldLabel>
        <Input
          value={name}
          readOnly={!canEdit}
          onChange={(event) => {
            setName(event.target.value);
            save.reset();
          }}
        />
        <FieldDescription>{t.branding.displayNameHint}</FieldDescription>
        <FieldError match={error !== undefined}>{error}</FieldError>
      </Field>
      <FormError error={save.error} />
      <Done show={save.isSuccess} title={t.branding.saved} />
      {canEdit && (
        <Button type="submit" className="w-fit" loading={save.isPending}>
          {t.branding.save}
        </Button>
      )}
    </form>
  );
}

function nameError(name: string): string | undefined {
  if (name.trim() === '') return ar.auth.validation.required;
  return updateBrandingSchema.safeParse({ displayName: name }).success
    ? undefined
    : t.branding.displayNameTooLong;
}

/**
 * The logo (`POST /api/company/branding/logo`): one PNG or JPEG of at most 1 MB, checked here
 * first and again by the API.
 */
function Logo({
  companyId,
  branding,
  canEdit,
}: {
  companyId: string;
  branding: Branding;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const send = useMutation({
    mutationFn: (file: File) =>
      upload('/company/branding/logo', file, { company: companyId, schema: brandingSchema }),
    onSuccess: (saved) => queryClient.setQueryData(brandingQuery(companyId).queryKey, saved),
  });
  const src = logoUrl(branding, '/company/branding/logo');
  return (
    <div className="flex flex-col gap-3">
      <span className="text-control font-medium text-foreground">{t.branding.logo}</span>
      <div className="flex min-h-20 items-center justify-center rounded-md border border-border bg-background p-3">
        <CompanyLogo
          src={src}
          label={branding.displayName}
          size="md"
          className="text-primary"
          imageClassName="rounded-md bg-sidebar-foreground p-2"
        />
      </div>
      <p className="text-control text-muted-foreground">
        {src ? t.branding.logoHint : `${t.branding.noLogo} ${t.branding.logoHint}`}
      </p>
      {refused && <Callout role="alert" tone="danger" icon={<CircleAlertIcon />} title={refused} />}
      <FormError error={send.error} />
      <Done show={send.isSuccess} title={t.branding.uploaded} />
      {canEdit && (
        <FileUploadButton
          className="w-fit"
          label={src ? t.branding.replace : t.branding.upload}
          accept={LOGO_CONTENT_TYPES}
          loading={send.isPending}
          onFiles={([file]) => {
            send.reset();
            const problem = file ? logoError(file) : undefined;
            setRefused(problem);
            if (file && !problem) send.mutate(file);
          }}
        />
      )}
    </div>
  );
}

function logoError(file: File): string | undefined {
  if (!(LOGO_CONTENT_TYPES as readonly string[]).includes(file.type)) return t.branding.logoType;
  if (file.size > LOGO_MAX_BYTES) return t.branding.logoTooLarge;
  return undefined;
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
  const [attempt, setAttempt] = useState(0);
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
          if (found.current || found.password || found.confirm) setAttempt((count) => count + 1);
          else change.mutate();
        }}
      >
        <FormErrorSummary
          attempt={attempt}
          errors={[
            ['current-password', errors.current],
            [newPasswordFieldIds.password, errors.password],
            [newPasswordFieldIds.confirm, errors.confirm],
          ]}
        />
        <Field id="current-password" invalid={errors.current !== undefined}>
          <FieldLabel>{fields.currentPassword}</FieldLabel>
          <PasswordInput
            autoComplete="current-password"
            showLabel={fields.showPassword}
            hideLabel={fields.hidePassword}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <FieldError match={errors.current !== undefined}>{errors.current}</FieldError>
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
