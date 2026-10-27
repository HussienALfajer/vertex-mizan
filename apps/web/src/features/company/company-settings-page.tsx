import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type Company, companySchema } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
} from '@vertex-mizan/ui';
import { CircleCheckIcon, InfoIcon, LockIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { FormError } from '../../components/form-error';
import { ReasonDialog } from '../../components/reason-dialog';
import { useSensitiveAction } from '../../components/reauth-dialog';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { can, meQuery, useCompany } from '../../lib/session';
import { companyQuery } from './company-queries';
import {
  LedgerFields,
  type LedgerForm,
  ledgerFormError,
  ledgerFormOf,
  ledgersOf,
} from './ledger-fields';
import { nameError, policyNoteError } from './validation';

const t = ar.company.settings;
const { fields } = ar.company;

/**
 * `/settings/company` (S01 rules 10–12): the profile, the ledgers with their rate policies, the
 * fiscal year start and the policy note; archive and restore. The owner edits; others read.
 */
export function CompanySettingsPage() {
  const { companyId, me } = useCompany();
  const company = useQuery(companyQuery(companyId));

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {company.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      ) : company.isError ? (
        <FormError error={company.error} />
      ) : (
        <Settings
          company={company.data}
          canEdit={can(me, 'company.settings') && company.data.archived === null}
          canArchive={can(me, 'company.archive')}
        />
      )}
    </>
  );
}

function Settings({
  company,
  canEdit,
  canArchive,
}: {
  company: Company;
  canEdit: boolean;
  canArchive: boolean;
}) {
  const { me } = useCompany();
  return (
    <>
      {!can(me, 'company.settings') && (
        <Callout tone="info" icon={<InfoIcon />} title={t.readOnly} />
      )}
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Profile company={company} canEdit={canEdit} />
          <PolicyNote company={company} canEdit={canEdit} />
        </div>
        <Ledgers company={company} canEdit={canEdit} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {canArchive && <ArchiveOrRestore company={company} />}
        <Membership />
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
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <div className="flex flex-col gap-4 px-6 pb-6">{children}</div>
    </Card>
  );
}

/** Saves a company write and keeps the page and the switcher (names, archived) current. */
function useCompanyWrite<T>(write: (input: T) => Promise<Company>) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: async (company) => {
      queryClient.setQueryData(companyQuery(companyId).queryKey, company);
      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
    },
  });
}

function Saved({ show, title }: { show: boolean; title: string }) {
  if (!show) return null;
  return <Callout role="status" tone="info" icon={<CircleCheckIcon />} title={title} />;
}

function Profile({ company, canEdit }: { company: Company; canEdit: boolean }) {
  const { companyId } = useCompany();
  const [name, setName] = useState(company.name);
  const [nameLatin, setNameLatin] = useState(company.nameLatin ?? '');
  const [errors, setErrors] = useState<{ name?: string | undefined; latin?: string | undefined }>(
    {},
  );
  const save = useCompanyWrite(() =>
    api('PATCH', '/company', {
      company: companyId,
      body: { name, nameLatin: nameLatin.trim() === '' ? null : nameLatin },
      schema: companySchema,
    }),
  );
  return (
    <Section title={t.profile.title}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const found = {
            name: nameError(name),
            latin: nameLatin.trim() === '' ? undefined : nameError(nameLatin),
          };
          setErrors(found);
          if (!found.name && !found.latin) save.mutate(undefined);
        }}
      >
        <Field invalid={errors.name !== undefined}>
          <FieldLabel>{fields.name}</FieldLabel>
          <Input
            value={name}
            maxLength={200}
            readOnly={!canEdit}
            onChange={(event) => setName(event.target.value)}
          />
          <FieldError match={errors.name !== undefined}>{errors.name}</FieldError>
        </Field>
        <Field invalid={errors.latin !== undefined}>
          <FieldLabel>{fields.nameLatin}</FieldLabel>
          <Input
            dir="ltr"
            value={nameLatin}
            maxLength={200}
            readOnly={!canEdit}
            onChange={(event) => setNameLatin(event.target.value)}
          />
          <FieldDescription>{fields.nameLatinHint}</FieldDescription>
          <FieldError match={errors.latin !== undefined}>{errors.latin}</FieldError>
        </Field>
        <FormError error={save.error} />
        <Saved show={save.isSuccess} title={t.profile.saved} />
        {canEdit && (
          <Button type="submit" className="w-fit" loading={save.isPending}>
            {t.profile.submit}
          </Button>
        )}
      </form>
    </Section>
  );
}

/** Editable after the settings lock too (rule 11), with before and after in the audit log. */
function PolicyNote({ company, canEdit }: { company: Company; canEdit: boolean }) {
  const { companyId } = useCompany();
  const [note, setNote] = useState(company.policyNote);
  const [error, setError] = useState<string | undefined>();
  const save = useCompanyWrite(() =>
    api('PATCH', '/company', {
      company: companyId,
      body: { policyNote: note },
      schema: companySchema,
    }),
  );
  return (
    <Section title={t.policyNote.title} description={t.policyNote.description}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const found = policyNoteError(note);
          setError(found);
          if (!found) save.mutate(undefined);
        }}
      >
        <Field invalid={error !== undefined}>
          <FieldLabel>{fields.policyNote}</FieldLabel>
          <Textarea
            value={note}
            maxLength={4000}
            readOnly={!canEdit}
            onChange={(event) => setNote(event.target.value)}
          />
          <FieldDescription>{fields.policyNoteHint}</FieldDescription>
          <FieldError match={error !== undefined}>{error}</FieldError>
        </Field>
        <FormError error={save.error} />
        <Saved show={save.isSuccess} title={t.policyNote.saved} />
        {canEdit && (
          <Button type="submit" className="w-fit" loading={save.isPending}>
            {t.policyNote.submit}
          </Button>
        )}
      </form>
    </Section>
  );
}

/** Free until the first posted entry; locked after it (rule 11, IAS 21.35–37). */
function Ledgers({ company, canEdit }: { company: Company; canEdit: boolean }) {
  const { companyId } = useCompany();
  const { run, dialog } = useSensitiveAction();
  const [form, setForm] = useState<LedgerForm>(() =>
    ledgerFormOf(company.ledgers, company.fiscalYearStartMonth),
  );
  const editable = canEdit && !company.booksStarted;
  const save = useCompanyWrite(() =>
    run(() =>
      api('PUT', '/company/ledgers', {
        company: companyId,
        body: { ledgers: ledgersOf(form), fiscalYearStartMonth: form.fiscalYearStartMonth },
        schema: companySchema,
      }),
    ),
  );
  return (
    <Section title={t.ledgers.title} description={t.ledgers.description}>
      {company.booksStarted && (
        <Callout
          tone="warning"
          icon={<LockIcon />}
          title={t.ledgers.lockedTitle}
          description={t.ledgers.lockedDescription}
        />
      )}
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ledgerFormError(form)) save.mutate(undefined);
        }}
      >
        <LedgerFields value={form} onChange={setForm} disabled={!editable} />
        <FormError error={save.error} />
        <Saved show={save.isSuccess} title={t.ledgers.saved} />
        {editable && (
          <Button type="submit" className="w-fit" loading={save.isPending}>
            {t.ledgers.submit}
          </Button>
        )}
      </form>
      {dialog}
    </Section>
  );
}

/** Archive with a reason (rule 12): read-only for everyone until an owner restores it. */
function ArchiveOrRestore({ company }: { company: Company }) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const archived = company.archived;
  const copy = archived ? t.restore : t.archive;
  return (
    <Section title={copy.title} description={copy.description}>
      {archived && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-control">
          <dt className="text-muted-foreground">{t.archive.archivedAt}</dt>
          <dd>{formatDateTime(archived.at)}</dd>
          <dt className="text-muted-foreground">{t.archive.archivedReason}</dt>
          <dd className="whitespace-pre-line">
            <bdi>{archived.reason}</bdi>
          </dd>
        </dl>
      )}
      <Button
        variant={archived ? 'secondary' : 'destructive'}
        className="w-fit"
        onClick={() => setOpen(true)}
      >
        {copy.action}
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={copy.title}
        description={copy.description}
        reasonLabel={copy.reason}
        submitLabel={copy.confirm}
        destructive={!archived}
        onConfirm={(reason) =>
          api('POST', archived ? '/company/restore' : '/company/archive', {
            company: companyId,
            body: { reason },
            schema: companySchema,
          })
        }
        onDone={async () => {
          await queryClient.invalidateQueries({ queryKey: companyQuery(companyId).queryKey });
          await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
        }}
      />
    </Section>
  );
}

/** Any member leaves (rule 18), as long as another owner remains. */
function Membership() {
  const { companyId, membership } = useCompany();
  const [open, setOpen] = useState(false);
  const leave = useLeaveCompany();
  return (
    <Section title={t.membership.title} description={t.membership.description}>
      <p className="text-control">
        <span className="text-muted-foreground">{ar.company.list.role}: </span>
        {ar.roles[membership.role]}
      </p>
      {/* An archived company refuses every write, leaving too (rule 12). */}
      {!membership.company.archived && (
        <Button variant="outline" className="w-fit" onClick={() => setOpen(true)}>
          {t.membership.leave}
        </Button>
      )}
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={ar.members.leave.title}
        description={ar.members.leave.description}
        reasonLabel={ar.members.reason}
        submitLabel={ar.members.leave.submit}
        destructive
        onConfirm={(reason) => leave.leave(companyId, membership.membershipId, reason)}
        onDone={leave.done}
      />
    </Section>
  );
}

/** Leaving archives one's own membership; the company is no longer active, so `/companies`. */
export function useLeaveCompany() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return {
    leave: (companyId: string, membershipId: string, reason: string) =>
      api('POST', `/members/${membershipId}/remove`, { company: companyId, body: { reason } }),
    done: async () => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
      await navigate({ to: '/companies' });
    },
  };
}
