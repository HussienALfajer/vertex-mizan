import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, type LinkProps, useNavigate } from '@tanstack/react-router';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountPicker,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  PageHeader,
} from '@vertex-mizan/ui';
import {
  BookOpenIcon,
  ChartPieIcon,
  FileClockIcon,
  type LucideIcon,
  ReceiptTextIcon,
  ScaleIcon,
  ScrollTextIcon,
  SheetIcon,
  UserRoundSearchIcon,
  WalletCardsIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useCompany } from '../../lib/session';
import { accountsQuery } from '../chart/chart-queries';
import { accountPickerLabels, pickerAccounts } from '../entries/entry-parts';
import { rememberedSearch, type SearchScope } from './report-search';

const t = ar.reports;
const route = getRouteApi('/_app/_company/reports/');

interface ReportCard {
  /** The key its last parameters are kept under (`ReportFrame`'s `report`). */
  key: string;
  to: NonNullable<LinkProps['to']>;
  title: string;
  description: string;
  icon: LucideIcon;
}

const groups: { title: string; cards: ReportCard[] }[] = [
  {
    title: t.index.groups.statements,
    cards: [
      {
        key: 'income-statement',
        to: '/reports/income-statement',
        title: t.names.income_statement,
        description: t.index.descriptions.income_statement,
        icon: ReceiptTextIcon,
      },
      {
        key: 'balance-sheet',
        to: '/reports/balance-sheet',
        title: t.names.balance_sheet,
        description: t.index.descriptions.balance_sheet,
        icon: ScaleIcon,
      },
    ],
  },
  {
    title: t.index.groups.books,
    cards: [
      {
        key: 'trial-balance',
        to: '/reports/trial-balance',
        title: t.names.trial_balance,
        description: t.index.descriptions.trial_balance,
        icon: SheetIcon,
      },
      {
        key: 'general-ledger',
        to: '/reports/general-ledger',
        title: t.names.general_ledger,
        description: t.index.descriptions.general_ledger,
        icon: BookOpenIcon,
      },
      {
        key: 'journal',
        to: '/reports/journal',
        title: t.names.journal_book,
        description: t.index.descriptions.journal_book,
        icon: ScrollTextIcon,
      },
      {
        key: 'prints',
        to: '/reports/journal-book/prints',
        title: t.index.prints,
        description: t.index.descriptions.prints,
        icon: FileClockIcon,
      },
    ],
  },
  {
    title: t.index.groups.management,
    cards: [
      {
        key: 'profitability',
        to: '/reports/profitability',
        title: t.names.profitability,
        description: t.index.descriptions.profitability,
        icon: ChartPieIcon,
      },
      {
        key: 'contract-position',
        to: '/reports/contract-position',
        title: t.names.contract_position,
        description: t.index.descriptions.contract_position,
        icon: WalletCardsIcon,
      },
      {
        key: 'revenue-schedule',
        to: '/reports/revenue-schedule',
        title: t.names.revenue_schedule,
        description: t.index.descriptions.revenue_schedule,
        icon: FileClockIcon,
      },
    ],
  },
];

/**
 * `/reports` (S09 "Screens"): the reports by group, each opened with its last parameters, kept
 * per viewer in this browser; the account statement through its account picker, which the
 * palette's "كشف حساب…" opens (`?find=account`).
 */
export function ReportsPage() {
  const { find } = route.useSearch();
  const navigate = useNavigate();
  const { companyId, me } = useCompany();
  const scope = { personId: me.person.id, companyId };
  const accounts = useQuery(accountsQuery(companyId));
  const [account, setAccount] = useState<string | null>(null);
  const openStatement = (id: string) => {
    const kept = rememberedSearch(scope, 'account-statement');
    const { account: _account, ...search } = kept ?? {};
    void navigate({ to: '/reports/accounts/$id', params: { id }, search });
  };

  return (
    <>
      <PageHeader title={t.index.title} description={t.index.description} />
      {groups.map((group) => (
        <section
          key={group.title}
          aria-labelledby={`reports-${group.title}`}
          className="flex flex-col gap-3"
        >
          <h2 id={`reports-${group.title}`} className="text-lg font-bold">
            {group.title}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.cards.map((card) => (
              <li key={card.key}>
                <ReportLink card={card} scope={scope} />
              </li>
            ))}
            {group.title === t.index.groups.books && (
              <li>
                <Card className="h-full p-4">
                  <div className="flex items-start gap-3">
                    <UserRoundSearchIcon aria-hidden="true" className="mt-1 size-icon shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <span className="font-bold">{t.names.account_statement}</span>
                      <span className="text-sm text-muted-foreground">
                        {t.index.descriptions.account_statement}
                      </span>
                      <AccountPicker
                        label={t.filters.account}
                        accounts={pickerAccounts(accounts.data ?? [])}
                        value={account}
                        labels={accountPickerLabels}
                        onValueChange={(id) => {
                          setAccount(id);
                          openStatement(id);
                        }}
                      />
                    </div>
                  </div>
                </Card>
              </li>
            )}
          </ul>
        </section>
      ))}
      <Dialog
        open={find === 'account'}
        onOpenChange={(next) => !next && void navigate({ to: '/reports', search: {} })}
      >
        <DialogContent closeLabel={ar.common.close}>
          <DialogHeader>
            <DialogTitle>{t.names.account_statement}</DialogTitle>
            <DialogDescription>{t.ledgerBook.pickAccount}</DialogDescription>
          </DialogHeader>
          <AccountPicker
            label={t.filters.account}
            accounts={pickerAccounts(accounts.data ?? [])}
            value={null}
            labels={accountPickerLabels}
            onValueChange={openStatement}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A report's card: its name, what it shows, and whether it opens with kept parameters. */
function ReportLink({ card, scope }: { card: ReportCard; scope: SearchScope }) {
  const kept = rememberedSearch(scope, card.key);
  const Icon = card.icon;
  return (
    <Link
      to={card.to}
      search={(kept ?? {}) as never}
      className="block h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition-colors duration-150 hover:bg-muted/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon aria-hidden="true" className="size-icon shrink-0" />
            {card.title}
          </CardTitle>
          <CardDescription>{card.description}</CardDescription>
          <span className="text-xs text-muted-foreground">
            {kept ? t.index.lastShown : t.index.neverShown}
          </span>
        </CardHeader>
      </Card>
    </Link>
  );
}
