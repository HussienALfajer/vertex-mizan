import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  type CashPositionAccount,
  type CashPositionGroup,
  VOUCHER_KINDS,
  type VoucherKind,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  Amount,
  Badge,
  Button,
  Card,
  CashAccountPicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  PageHeader,
  Skeleton,
} from '@vertex-mizan/ui';
import { EllipsisIcon, FileTextIcon, ListIcon, PlusIcon, WalletIcon } from 'lucide-react';
import { FormError } from '../../components/form-error';
import { damascusToday } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { searchOf } from '../receivables/receivables-queries';
import { DateInput, ReportExport } from '../reports/report-parts';
import { cashPositionQuery } from './cash-queries';
import { cashPickerAccounts, cashPickerLabels } from './voucher-fields';

const t = ar.cash;
const p = t.position;
const route = getRouteApi('/_app/_company/cash/');

/**
 * `/cash` (S11 rule 16, "Screens"): the cash position at a date, one card per cash account grouped
 * by currency with its balance and both carrying amounts, the totals per currency and per ledger;
 * new vouchers from the toolbar or a card, a card's statement, the export (Excel at once, PDF
 * queued). `?find=statement`, from the palette, opens the statement finder.
 */
export function CashPositionPage() {
  const { asOf, find } = route.useSearch();
  const navigate = useNavigate();
  const { companyId, me, membership } = useCompany();
  const date = asOf ?? damascusToday();
  const position = useQuery(cashPositionQuery(companyId, date));
  const acts = !membership.company.archived && can(me, 'drafts.manage');
  const data = position.data;
  const empty = data !== undefined && data.groups.length === 0;
  return (
    <>
      <PageHeader
        title={p.title}
        description={p.description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {acts &&
              VOUCHER_KINDS.map((kind) => (
                <Button
                  key={kind}
                  variant="outline"
                  size="sm"
                  render={<Link to="/cash/vouchers/new/$kind" params={{ kind }} />}
                >
                  <PlusIcon aria-hidden="true" />
                  {t.newVoucher[kind]}
                </Button>
              ))}
            <Button variant="ghost" size="sm" render={<Link to="/cash/vouchers" />}>
              <ListIcon aria-hidden="true" />
              {p.vouchers}
            </Button>
            <ReportExport
              disabled={!data || empty}
              excelPath={`/cash/accounts/export${searchOf({ format: 'xlsx', asOf: date })}`}
              pdf={{ report: 'cash_position', params: { asOf: date } }}
            />
          </div>
        }
      />
      <Card className="p-4">
        <div className="max-w-xs">
          <DateInput
            label={p.asOf}
            value={date}
            onValueChange={(value) =>
              void navigate({ to: '/cash', search: { asOf: value || undefined }, replace: true })
            }
          />
        </div>
      </Card>
      {position.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : position.isError ? (
        <FormError error={position.error} />
      ) : empty ? (
        <EmptyState
          icon={<WalletIcon />}
          title={p.empty}
          description={p.emptyHint}
          action={
            can(me, 'accounts.read') ? (
              <Button variant="outline" render={<Link to="/chart" />}>
                {p.toChart}
              </Button>
            ) : undefined
          }
        />
      ) : data ? (
        <div className="flex min-w-0 flex-col gap-6">
          {data.groups.map((group) => (
            <CurrencyGroup key={group.currency} group={group} acts={acts} />
          ))}
          <Card className="flex flex-col gap-2 p-4" data-slot="cash-ledger-totals">
            <h2 className="font-semibold">{p.ledgerTotals}</h2>
            <dl className="flex flex-wrap gap-x-8 gap-y-2">
              <div className="flex items-baseline gap-2">
                <dt className="text-muted-foreground">{p.book}</dt>
                <dd>
                  <Amount
                    value={BigInt(data.book.amountMinor)}
                    currency={data.book.currency}
                    showCurrency
                    strong
                  />
                </dd>
              </div>
              {data.parallel && (
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted-foreground">{p.parallel}</dt>
                  <dd>
                    <Amount
                      value={BigInt(data.parallel.amountMinor)}
                      currency={data.parallel.currency}
                      showCurrency
                      strong
                    />
                  </dd>
                </div>
              )}
            </dl>
          </Card>
        </div>
      ) : null}
      <StatementFinder
        open={find === 'statement'}
        companyId={companyId}
        onClose={() => void navigate({ to: '/cash', search: { asOf }, replace: true })}
        onPick={(id) => void navigate({ to: '/cash/$accountId', params: { accountId: id } })}
      />
    </>
  );
}

/** One currency's cards and its total. */
function CurrencyGroup({ group, acts }: { group: CashPositionGroup; acts: boolean }) {
  const name = ar.accounting.currencies[group.currency];
  return (
    <section aria-label={name} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">{name}</h2>
        <span className="flex items-baseline gap-2">
          <span className="text-muted-foreground">
            {p.total.replace('{currency}', group.currency)}
          </span>
          <Amount
            value={BigInt(group.total.amountMinor)}
            currency={group.currency}
            showCurrency
            strong
          />
        </span>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {group.accounts.map((account) => (
          <li key={account.id} className="min-w-0">
            <AccountCard account={account} acts={acts} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A cash account's card: kind, balance, carrying amounts, statement and new vouchers. */
function AccountCard({ account, acts }: { account: CashPositionAccount; acts: boolean }) {
  const navigate = useNavigate();
  const zero = account.balance.amountMinor === '0';
  const label = `${account.code} ${account.name}`;
  return (
    <Card className="flex h-full min-w-0 flex-col gap-3 p-4" data-slot="cash-account-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <AccountLabel code={account.code} name={account.name} className="font-medium" />
          <span className="flex flex-wrap gap-2">
            <Badge tone="neutral">{t.cashKinds[account.cashKind]}</Badge>
            {zero && <Badge tone="warning">{p.atZero}</Badge>}
          </span>
        </div>
        {acts && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={p.actions.replace('{account}', label)}
                />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {VOUCHER_KINDS.filter(
                (kind: VoucherKind) => kind !== 'count' || account.cashKind === 'box',
              ).map((kind) => (
                <DropdownMenuItem
                  key={kind}
                  onClick={() =>
                    void navigate({
                      to: '/cash/vouchers/new/$kind',
                      params: { kind },
                      search: { account: account.id },
                    })
                  }
                >
                  {t.newVoucher[kind]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <Amount
        value={BigInt(account.balance.amountMinor)}
        currency={account.currency}
        showCurrency
        strong
        className="text-xl"
      />
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-control">
        <div className="flex items-baseline gap-2">
          <dt className="text-muted-foreground">{p.book}</dt>
          <dd>
            <Amount
              value={BigInt(account.book.amountMinor)}
              currency={account.book.currency}
              showCurrency
            />
          </dd>
        </div>
        {account.parallel && (
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">{p.parallel}</dt>
            <dd>
              <Amount
                value={BigInt(account.parallel.amountMinor)}
                currency={account.parallel.currency}
                showCurrency
              />
            </dd>
          </div>
        )}
      </dl>
      <Button
        variant="outline"
        size="sm"
        className="mt-auto w-fit"
        render={<Link to="/cash/$accountId" params={{ accountId: account.id }} />}
      >
        <FileTextIcon aria-hidden="true" />
        {p.statement}
      </Button>
    </Card>
  );
}

/** "كشف صندوق…" from the palette: a cash account picked opens its statement. */
function StatementFinder({
  open,
  companyId,
  onClose,
  onPick,
}: {
  open: boolean;
  companyId: string;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const position = useQuery({ ...cashPositionQuery(companyId, undefined), enabled: open });
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={ar.common.close}>
        <DialogHeader>
          <DialogTitle>{t.statement.title}</DialogTitle>
          <DialogDescription>{t.palette.statement}</DialogDescription>
        </DialogHeader>
        <CashAccountPicker
          label={t.form.cashAccount}
          accounts={cashPickerAccounts(position.data)}
          value={null}
          labels={cashPickerLabels}
          onValueChange={onPick}
        />
      </DialogContent>
    </Dialog>
  );
}
