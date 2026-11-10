import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type Account,
  chartTemplate,
  type HubCurrency,
  mapPostingRuleSchema,
  POSTING_SLOTS,
  type PostingRule,
  type PostingSlot,
  postingRuleSchema,
  slotAccountFits,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  AccountPicker,
  Badge,
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { api, hasCode } from '../../lib/api';
import { can, useCompany } from '../../lib/session';
import { accountsQuery } from '../chart/chart-queries';
import { typeLabel } from '../inbox/inbox-parts';
import { postingRulesQuery } from './posting-rules-queries';

const t = ar.postingRules;

type RuleId = keyof typeof t.rules;

/** The rule each slot is shown under, and the scenario each rule follows (S05 "Scenarios"). */
const RULE_OF_SLOT: Readonly<Record<PostingSlot, RuleId>> = {
  receivable: 'invoices',
  revenue_at_issue: 'invoices',
  termination_fee_revenue: 'invoices',
  'payment_method.cash': 'payments',
  'payment_method.bank_transfer': 'payments',
  'payment_method.e_wallet': 'payments',
  ad_funds: 'adFunds',
  ad_platforms_payable: 'adFunds',
  project_cost: 'projectExpenses',
  project_expense_awaiting_payment: 'projectExpenses',
};

const SCENARIOS: Readonly<Record<RuleId, readonly string[]>> = {
  invoices: ['revenue/revenue-at-issue'],
  payments: ['receivables/hub-payment', 'ad-funds/running-balance'],
  adFunds: ['ad-funds/running-balance'],
  projectExpenses: ['expenses/project-expense'],
};

const RULES = Object.keys(SCENARIOS) as RuleId[];

/** The service-agency template's account of a slot (S05 "Mapping slots"), by its code. */
const template = chartTemplate('service-agency');

function templateAccount(slot: PostingSlot, currency: HubCurrency | null) {
  const code = template.postingRules.find(
    (mapping) => mapping.slot === slot && mapping.currency === currency,
  )?.code;
  return template.accounts.find((account) => account.code === code) ?? null;
}

const slotName = (rule: PostingRule) =>
  rule.currency ? `${t.slots[rule.slot]} — ${rule.currency}` : t.slots[rule.slot];

const keyOf = (rule: Pick<PostingRule, 'slot' | 'currency'>) =>
  `${rule.slot}:${rule.currency ?? ''}`;

/**
 * `/settings/posting-rules` (S05 "Mapping slots", Q9): each rule with its slots, each slot's
 * account, the service-agency template's default and the events held for an unmapped slot. The
 * owner and accountants change a slot through the account picker, which offers only the accounts
 * that fit it; a change retries the held events once it commits (rule 10).
 */
export function PostingRulesPage() {
  const { companyId, me, membership } = useCompany();
  const manage = can(me, 'posting_rules.manage') && !membership.company.archived;
  const rules = useQuery(postingRulesQuery(companyId));
  const accounts = useQuery({ ...accountsQuery(companyId), enabled: manage });
  const [editing, setEditing] = useState<PostingRule | null>(null);
  const unmapped = rules.data?.filter((rule) => rule.account === null) ?? [];

  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      {!can(me, 'posting_rules.manage') && (
        <Callout tone="info" icon={<InfoIcon />} title={t.readOnly} />
      )}
      {unmapped.length > 0 && (
        <Callout
          tone="warning"
          icon={<TriangleAlertIcon />}
          title={t.unmappedTitle}
          description={t.unmappedDescription}
          action={
            can(me, 'events.read') && unmapped.some((rule) => rule.heldEvents > 0) ? (
              <Button variant="secondary" size="sm" render={<Link to="/inbox" />}>
                {t.openInbox}
              </Button>
            ) : undefined
          }
        />
      )}
      {rules.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : rules.isError ? (
        <FormError error={rules.error} />
      ) : (
        RULES.map((id) => (
          <RuleCard
            key={id}
            id={id}
            rules={rules.data.filter((rule) => RULE_OF_SLOT[rule.slot] === id)}
            manage={manage && accounts.isSuccess}
            onChange={setEditing}
          />
        ))
      )}
      {accounts.isError && <FormError error={accounts.error} />}
      {editing && accounts.data && (
        <MapDialog
          key={keyOf(editing)}
          rule={editing}
          accounts={accounts.data}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function RuleCard({
  id,
  rules,
  manage,
  onChange,
}: {
  id: RuleId;
  rules: readonly PostingRule[];
  manage: boolean;
  onChange: (rule: PostingRule) => void;
}) {
  const copy = t.rules[id];
  const order = (rule: PostingRule) => POSTING_SLOTS.indexOf(rule.slot);
  const sorted = [...rules].sort(
    (a, b) => order(a) - order(b) || (a.currency ?? '').localeCompare(b.currency ?? ''),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
        <p className="text-sm text-muted-foreground">
          {t.scenario}:{' '}
          {SCENARIOS[id].map((scenario, index) => (
            <span key={scenario}>
              {index > 0 && ar.common.listSeparator}
              <bdi dir="ltr">{scenario}</bdi>
            </span>
          ))}
        </p>
      </CardHeader>
      <div className="min-w-0 overflow-x-auto px-6 pb-6">
        <Table aria-label={copy.title}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.table.slot}</TableHead>
              <TableHead>{t.table.account}</TableHead>
              <TableHead className="max-lg:hidden">{t.table.events}</TableHead>
              <TableHead>{t.table.held}</TableHead>
              {manage && (
                <TableHead>
                  <span className="sr-only">{t.table.actions}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((rule) => {
              const fallback = templateAccount(rule.slot, rule.currency);
              return (
                <TableRow key={keyOf(rule)}>
                  <TableCell className="font-medium">{slotName(rule)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      {rule.account ? (
                        <AccountLabel code={rule.account.code} name={rule.account.name} />
                      ) : (
                        <Badge tone="warning">
                          <TriangleAlertIcon aria-hidden="true" />
                          {t.notMapped}
                        </Badge>
                      )}
                      <span className="text-sm text-muted-foreground">
                        {t.table.template}:{' '}
                        {fallback ? <bdi dir="ltr">{fallback.code}</bdi> : t.noTemplate}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-40 whitespace-normal text-muted-foreground max-lg:hidden">
                    {rule.events.map(typeLabel).join(ar.common.listSeparator)}
                  </TableCell>
                  <TableCell>
                    {rule.heldEvents > 0 ? (
                      <Badge tone="warning">
                        <bdi dir="ltr">{rule.heldEvents}</bdi> {t.heldEvents}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">{t.noHeld}</span>
                    )}
                  </TableCell>
                  {manage && (
                    <TableCell className="text-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${t.change}: ${slotName(rule)}`}
                        onClick={() => onChange(rule)}
                      >
                        {t.change}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function MapDialog({
  rule,
  accounts,
  onClose,
}: {
  rule: PostingRule;
  accounts: readonly Account[];
  onClose: () => void;
}) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState<string | null>(rule.account?.id ?? null);
  const [invalid, setInvalid] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const save = useMutation({
    mutationFn: (id: string) =>
      api('PUT', `/posting-rules/${rule.slot}`, {
        company: companyId,
        body: mapPostingRuleSchema.parse({
          accountId: id,
          ...(rule.currency ? { currency: rule.currency } : {}),
        }),
        schema: postingRuleSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['postingRules', companyId] });
      await queryClient.invalidateQueries({ queryKey: ['inbox', companyId] });
      onClose();
    },
  });
  // Only the accounts that fit the slot (the server checks again), with their headers for context.
  const fitting = accounts.filter(
    (account) =>
      account.archived === null &&
      account.blocked === null &&
      slotAccountFits(rule.slot, rule.currency, account),
  );
  const headers = new Set(fitting.map((account) => account.parentId));
  const options = accounts
    .filter((account) => fitting.includes(account) || headers.has(account.id))
    .map((account) => ({
      ...account,
      blocked: account.blocked !== null,
      archived: account.archived !== null,
    }));
  const chart = ar.chart;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={ar.common.close}>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!accountId) {
              setInvalid(true);
              setAttempt((count) => count + 1);
              return;
            }
            save.mutate(accountId);
          }}
        >
          <DialogHeader>
            <DialogTitle>{`${t.changeTitle}: ${slotName(rule)}`}</DialogTitle>
            <DialogDescription>{t.fits[rule.slot]}</DialogDescription>
          </DialogHeader>
          <FormErrorSummary
            attempt={attempt}
            errors={[['slot-account', invalid ? t.required : undefined]]}
          />
          {fitting.length === 0 && (
            <Callout tone="warning" icon={<TriangleAlertIcon />} title={t.noFitting} />
          )}
          <AccountPicker
            id="slot-account"
            label={t.picker}
            accounts={options}
            value={accountId}
            onValueChange={(id) => {
              setInvalid(false);
              setAccountId(id);
            }}
            labels={{ ...chart.picker, header: chart.kinds.header, blocked: chart.tree.blocked }}
            description={t.pickerHint}
            error={invalid ? t.required : undefined}
          />
          {hasCode(save.error, 'ACCOUNT_HAS_BALANCE') ? (
            <Callout
              role="alert"
              tone="danger"
              icon={<TriangleAlertIcon />}
              title={t.hasOpenItems}
            />
          ) : (
            <FormError error={save.error} />
          )}
          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              {t.save}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {ar.common.cancel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
