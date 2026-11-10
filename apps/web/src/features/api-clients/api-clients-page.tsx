import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  API_CLIENT_SCOPES,
  API_CLIENT_SYSTEMS,
  type ApiClient,
  type ApiClientKey,
  type ApiClientScope,
  type ApiClientSystem,
  allowedNetworkSchema,
  apiClientKeySchema,
  apiClientSchema,
  createApiClientSchema,
  createdApiClientSchema,
  DOCUMENT_TYPES,
  type DocumentType,
  newApiKeySchema,
  updateApiClientSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  SecretReveal,
  SelectField,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@vertex-mizan/ui';
import { InfoIcon, KeyRoundIcon, PlugZapIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { ReasonDialog } from '../../components/reason-dialog';
import { useSensitiveAction } from '../../components/reauth-dialog';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { apiClientsQuery } from './api-clients-queries';

const t = ar.apiClients;

/** At most two active keys per client (S05 rule 19). */
const ACTIVE_KEY_LIMIT = 2;

const scopeLabel = (scope: string) =>
  (API_CLIENT_SCOPES as readonly string[]).includes(scope)
    ? t.scopes[scope as ApiClientScope]
    : t.unknownScope;

const documentTypeLabel = (type: string) =>
  (DOCUMENT_TYPES as readonly string[]).includes(type)
    ? ar.inbox.documentTypes[type as DocumentType]
    : type;

/** A secret shown once, with the client it belongs to. */
interface Revealed {
  clientName: string;
  secret: string;
}

/**
 * `/settings/api-clients` (S05 rules 19–21): the systems that post to the company with their
 * scopes, allow-lists, document types and keys. The owner creates a client, a key for a rotation
 * and revokes one with a reason, each after a fresh code; a new key's secret is shown once in a
 * dialog that closes only once the owner confirms it was kept. The auditor reads.
 */
export function ApiClientsPage() {
  const { companyId, me, membership } = useCompany();
  const manage = can(me, 'api_clients.manage') && !membership.company.archived;
  const clients = useQuery(apiClientsQuery(companyId));
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ApiClient | null>(null);
  const [revealed, setRevealed] = useState<Revealed | null>(null);

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          manage && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon />
              {t.form.newTitle}
            </Button>
          )
        }
      />
      {!can(me, 'api_clients.manage') && (
        <Callout tone="info" icon={<InfoIcon />} title={t.readOnly} />
      )}
      {clients.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-48" />
        </div>
      ) : clients.isError ? (
        <FormError error={clients.error} />
      ) : clients.data.length === 0 ? (
        <EmptyState icon={<PlugZapIcon />} title={t.empty} description={t.emptyDescription} />
      ) : (
        clients.data.map((client) => (
          <ClientCard
            key={client.id}
            client={client}
            manage={manage && client.archivedAt === null}
            onEdit={() => setEditing(client)}
            onKey={(secret) => setRevealed({ clientName: client.name, secret })}
          />
        ))
      )}
      {creating && (
        <ClientDialog
          onClose={() => setCreating(false)}
          onCreated={(client, secret) => setRevealed({ clientName: client.name, secret })}
        />
      )}
      {editing && (
        <ClientDialog key={editing.id} client={editing} onClose={() => setEditing(null)} />
      )}
      {revealed && <RevealDialog revealed={revealed} onDone={() => setRevealed(null)} />}
    </>
  );
}

function ClientCard({
  client,
  manage,
  onEdit,
  onKey,
}: {
  client: ApiClient;
  manage: boolean;
  onEdit: () => void;
  onKey: (secret: string) => void;
}) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const { run, dialog } = useSensitiveAction();
  const [keyOpen, setKeyOpen] = useState(false);
  const [revoking, setRevoking] = useState<ApiClientKey | null>(null);
  const active = client.keys.filter((key) => key.revokedAt === null).length;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['apiClients', companyId] });
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <bdi>{client.name}</bdi>
            {client.archivedAt && <Badge tone="neutral">{t.archived}</Badge>}
          </CardTitle>
          <CardDescription>
            {t.client.system}: {t.systems[client.system]} · {t.client.createdAt}{' '}
            {formatDateTime(client.createdAt)}
          </CardDescription>
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onEdit}>
              {t.client.edit}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={active >= ACTIVE_KEY_LIMIT}
              onClick={() => setKeyOpen(true)}
            >
              <KeyRoundIcon />
              {t.client.newKey}
            </Button>
          </div>
        )}
      </CardHeader>
      <div className="flex min-w-0 flex-col gap-4 px-6 pb-6">
        <dl className="grid gap-x-6 gap-y-3 text-control sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">{t.client.scopes}</dt>
          <dd className="flex flex-wrap gap-2">
            {client.scopes.map((scope) => (
              <Badge key={scope} tone="brand">
                {scopeLabel(scope)}
              </Badge>
            ))}
          </dd>
          <dt className="text-muted-foreground">{t.client.allowList}</dt>
          <dd>
            {client.ipAllowList.length === 0 ? (
              t.client.anyAddress
            ) : (
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {client.ipAllowList.map((network) => (
                  <li key={network}>
                    <bdi dir="ltr">{network}</bdi>
                  </li>
                ))}
              </ul>
            )}
          </dd>
          <dt className="text-muted-foreground">{t.client.documentTypes}</dt>
          <dd className="flex flex-wrap gap-2">
            {client.documentTypes.length === 0
              ? t.client.noDocumentTypes
              : client.documentTypes.map((type) => (
                  <Badge key={type} tone="outline">
                    {documentTypeLabel(type)}
                  </Badge>
                ))}
          </dd>
        </dl>
        {manage && active >= ACTIVE_KEY_LIMIT && (
          <p className="text-sm text-muted-foreground">{t.keys.limit}</p>
        )}
        <KeysTable keys={client.keys} manage={manage} onRevoke={setRevoking} />
      </div>
      <ConfirmDialog
        open={keyOpen}
        onOpenChange={setKeyOpen}
        title={t.newKey.title}
        description={t.newKey.description}
        submitLabel={t.newKey.confirm}
        onConfirm={async () => {
          const created = await run(() =>
            api('POST', `/api-clients/${client.id}/keys`, {
              company: companyId,
              schema: newApiKeySchema,
            }),
          );
          onKey(created.secret);
        }}
        onDone={refresh}
      />
      <ReasonDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t.revoke.title}
        description={t.revoke.description}
        reasonLabel={t.revoke.reason}
        submitLabel={t.revoke.confirm}
        destructive
        onConfirm={(reason) =>
          api('POST', `/api-clients/${client.id}/keys/${revoking?.id}/revoke`, {
            company: companyId,
            body: { reason },
            schema: apiClientKeySchema,
          })
        }
        onDone={refresh}
      >
        {revoking && (
          <p className="text-control">
            {t.keys.prefix}: <bdi dir="ltr">{revoking.prefix}</bdi>
          </p>
        )}
      </ReasonDialog>
      {dialog}
    </Card>
  );
}

function KeysTable({
  keys,
  manage,
  onRevoke,
}: {
  keys: readonly ApiClientKey[];
  manage: boolean;
  onRevoke: (key: ApiClientKey) => void;
}) {
  if (keys.length === 0)
    return <p className="text-control text-muted-foreground">{t.keys.empty}</p>;
  return (
    <div className="min-w-0 overflow-x-auto">
      <Table aria-label={t.keys.label}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.keys.prefix}</TableHead>
            <TableHead className="max-md:hidden">{t.keys.createdAt}</TableHead>
            <TableHead>{t.keys.lastUsed}</TableHead>
            <TableHead>{t.keys.state}</TableHead>
            {manage && (
              <TableHead>
                <span className="sr-only">{t.keys.actions}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((key) => (
            <TableRow key={key.id}>
              <TableCell className="font-medium">
                <bdi dir="ltr">{key.prefix}</bdi>
              </TableCell>
              <TableCell className="max-md:hidden">{formatDateTime(key.createdAt)}</TableCell>
              <TableCell>
                {key.lastUsedAt ? (
                  <div className="flex flex-col">
                    <span>{formatDateTime(key.lastUsedAt)}</span>
                    {key.lastUsedIp && (
                      <bdi dir="ltr" className="text-sm text-muted-foreground">
                        {key.lastUsedIp}
                      </bdi>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">{t.keys.neverUsed}</span>
                )}
              </TableCell>
              <TableCell>
                {key.revokedAt ? (
                  <div className="flex flex-col items-start gap-1">
                    <Badge tone="danger">{t.keys.revoked}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {t.keys.revokedAt} {formatDateTime(key.revokedAt)}
                    </span>
                    {key.revokeReason && (
                      <bdi className="text-sm text-muted-foreground">{key.revokeReason}</bdi>
                    )}
                  </div>
                ) : (
                  <Badge tone="success">{t.keys.active}</Badge>
                )}
              </TableCell>
              {manage && (
                <TableCell className="text-end">
                  {key.revokedAt === null && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${t.keys.revoke}: ${key.prefix}`}
                      onClick={() => onRevoke(key)}
                    >
                      {t.keys.revoke}
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** The allow-list typed one entry per line; the first line that is no address nor network. */
function parseAllowList(text: string): { list: string[]; error?: string } {
  const list = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const wrong = list.find((line) => !allowedNetworkSchema.safeParse(line).success);
  if (wrong !== undefined) return { list, error: `${t.form.allowListInvalidLine} ${wrong}` };
  if (list.length > 50) return { list, error: t.form.allowListTooMany };
  return { list };
}

/** A new client (its first key shown once after) or an existing one's fields, after a fresh code. */
function ClientDialog({
  client,
  onClose,
  onCreated,
}: {
  client?: ApiClient;
  onClose: () => void;
  onCreated?: (client: ApiClient, secret: string) => void;
}) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const { run, dialog } = useSensitiveAction();
  const [name, setName] = useState(client?.name ?? '');
  const [system, setSystem] = useState<ApiClientSystem>(client?.system ?? 'hub');
  const [scopes, setScopes] = useState<ApiClientScope[]>(
    client?.scopes ?? ['events:write', 'periods:read'],
  );
  const [allowList, setAllowList] = useState((client?.ipAllowList ?? []).join('\n'));
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>(client?.documentTypes ?? []);
  const [errors, setErrors] = useState<{
    name?: string | undefined;
    scopes?: string | undefined;
    allowList?: string | undefined;
  }>({});
  const [attempt, setAttempt] = useState(0);
  const save = useMutation({
    mutationFn: async (ipAllowList: string[]) => {
      if (client) {
        await run(() =>
          api('PUT', `/api-clients/${client.id}`, {
            company: companyId,
            body: updateApiClientSchema.parse({ name, scopes, ipAllowList, documentTypes }),
            schema: apiClientSchema,
          }),
        );
        return;
      }
      const created = await run(() =>
        api('POST', '/api-clients', {
          company: companyId,
          body: createApiClientSchema.parse({ name, system, scopes, ipAllowList }),
          schema: createdApiClientSchema,
        }),
      );
      onCreated?.(created.client, created.key.secret);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['apiClients', companyId] });
      onClose();
    },
  });
  const f = t.form;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={ar.common.close}>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = parseAllowList(allowList);
            const found = {
              name:
                name.trim().length === 0 || name.trim().length > 100 ? f.nameRequired : undefined,
              scopes: scopes.length === 0 ? f.scopesRequired : undefined,
              allowList: parsed.error,
            };
            setErrors(found);
            if (found.name || found.scopes || found.allowList) setAttempt((count) => count + 1);
            else save.mutate(parsed.list);
          }}
        >
          <DialogHeader>
            <DialogTitle>{client ? f.editTitle : f.newTitle}</DialogTitle>
            <DialogDescription>{client ? f.editDescription : f.newDescription}</DialogDescription>
          </DialogHeader>
          <FormErrorSummary
            attempt={attempt}
            errors={[
              ['client-name', errors.name],
              ['client-scopes', errors.scopes],
              ['client-allow-list', errors.allowList],
            ]}
          />
          <Field id="client-name" invalid={errors.name !== undefined}>
            <FieldLabel>{f.name}</FieldLabel>
            <Input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
            <FieldDescription>{f.nameHint}</FieldDescription>
            <FieldError match={errors.name !== undefined}>{errors.name}</FieldError>
          </Field>
          {!client && (
            <SelectField
              label={f.system}
              value={system}
              options={API_CLIENT_SYSTEMS.map((value) => ({ value, label: t.systems[value] }))}
              onValueChange={setSystem}
            />
          )}
          <fieldset
            id="client-scopes"
            className="flex flex-col gap-3"
            aria-invalid={errors.scopes !== undefined || undefined}
          >
            <legend className="mb-2 text-control font-medium text-foreground">{f.scopes}</legend>
            {API_CLIENT_SCOPES.map((scope) => (
              // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's checkbox is the control.
              <label key={scope} className="flex items-center gap-3 text-control text-foreground">
                <Checkbox
                  checked={scopes.includes(scope)}
                  onCheckedChange={(checked) =>
                    setScopes(
                      checked
                        ? API_CLIENT_SCOPES.filter(
                            (other) => other === scope || scopes.includes(other),
                          )
                        : scopes.filter((other) => other !== scope),
                    )
                  }
                />
                {t.scopes[scope]}
              </label>
            ))}
            {errors.scopes && (
              <p role="alert" className="text-control text-destructive-text">
                {errors.scopes}
              </p>
            )}
          </fieldset>
          <Field id="client-allow-list" invalid={errors.allowList !== undefined}>
            <FieldLabel>{f.allowList}</FieldLabel>
            <Textarea
              dir="ltr"
              rows={3}
              value={allowList}
              onChange={(event) => setAllowList(event.target.value)}
            />
            <FieldDescription>{f.allowListHint}</FieldDescription>
            <FieldError match={errors.allowList !== undefined}>{errors.allowList}</FieldError>
          </Field>
          {client && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-control font-medium text-foreground">
                {f.documentTypes}
              </legend>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                {DOCUMENT_TYPES.map((type) => (
                  // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's checkbox is the control.
                  <label
                    key={type}
                    className="flex items-center gap-3 text-control text-foreground"
                  >
                    <Checkbox
                      checked={documentTypes.includes(type)}
                      onCheckedChange={(checked) =>
                        setDocumentTypes(
                          checked
                            ? DOCUMENT_TYPES.filter(
                                (other) => other === type || documentTypes.includes(other),
                              )
                            : documentTypes.filter((other) => other !== type),
                        )
                      }
                    />
                    {documentTypeLabel(type)}
                  </label>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">{f.documentTypesHint}</p>
            </fieldset>
          )}
          <FormError error={save.error} />
          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              {client ? f.save : f.create}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {ar.common.cancel}
            </Button>
          </DialogFooter>
        </form>
        {dialog}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The secret of a new key, shown once (rule 19): the dialog has no close button and ignores
 * Escape and outside clicks until the owner confirms the key was kept.
 */
function RevealDialog({ revealed, onDone }: { revealed: Revealed; onDone: () => void }) {
  const r = t.reveal;
  return (
    <Dialog open disablePointerDismissal onOpenChange={() => {}}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`${r.title}: ${revealed.clientName}`}</DialogTitle>
          <DialogDescription>{r.description}</DialogDescription>
        </DialogHeader>
        <SecretReveal
          secret={revealed.secret}
          label={r.label}
          warning={r.warning}
          copyLabel={r.copy}
          copiedLabel={r.copied}
          confirmLabel={r.confirm}
          doneLabel={r.done}
          onDone={onDone}
        />
      </DialogContent>
    </Dialog>
  );
}
