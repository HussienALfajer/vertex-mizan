import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Account, ClientRef } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Badge, Button, LedgerSwitch } from '@vertex-mizan/ui';
import { ArrowRightIcon } from 'lucide-react';
import { companyQuery } from '../company/company-queries';
import { useDimensionCatalog } from '../entries/entry-queries';

const t = ar.openItems;

/** A client as the receivables screens name it: its code first when it has one. */
export function ClientName({ client }: { client: ClientRef | null }) {
  if (!client) return <span className="text-muted-foreground">{t.labels.noClient}</span>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      {client.code && (
        <bdi dir="ltr" className="font-medium tabular-nums">
          {client.code}
        </bdi>
      )}
      <bdi>{client.name}</bdi>
    </span>
  );
}

/** An item's reference, linked to its page. */
export function ItemLink({ id, reference }: { id: string; reference: string }) {
  return (
    <Link
      to="/open-items/$id"
      params={{ id }}
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      <bdi>{reference}</bdi>
    </Link>
  );
}

/** "معدّل في ميزان": a manual movement on an item from Hub (S04 rule 8). */
export function AdjustedBadge({ adjusted }: { adjusted: boolean }) {
  return adjusted ? (
    <Badge tone="warning" className="w-fit">
      {t.labels.adjusted}
    </Badge>
  ) : null;
}

/** The way back to the ageing, above a receivables sub-page's title. */
export function ReceivablesBackLink() {
  return (
    <Button variant="ghost" size="sm" className="w-fit" render={<Link to="/receivables" />}>
      <ArrowRightIcon aria-hidden="true" />
      {t.statement.back}
    </Button>
  );
}

/** The built-in client dimension type and its values, for the receivables filters. */
export function useClients(companyId: string) {
  const catalog = useDimensionCatalog(companyId);
  const type = catalog.types.find((candidate) => candidate.code === 'client');
  return { type, values: type ? catalog.valuesOf(type.id) : [], catalog };
}

/** Whether a company's chart has a running control account (ad funds): the funds screen's. */
export function hasRunningAccount(accounts: readonly Account[] | undefined): boolean {
  return (accounts ?? []).some((account) => account.itemKind === 'running');
}

/** The ledger switch of a report, when the company keeps a parallel ledger. */
export function ReportLedgerSwitch({
  companyId,
  value,
  onValueChange,
}: {
  companyId: string;
  value: 'book' | 'parallel';
  onValueChange: (ledger: 'book' | 'parallel') => void;
}) {
  const company = useQuery(companyQuery(companyId)).data;
  const parallel = company?.ledgers.parallel;
  if (!company || !parallel) return null;
  return (
    <LedgerSwitch
      className="w-fit"
      label={ar.accounting.ledger.label}
      value={value}
      onValueChange={onValueChange}
      ledgers={{
        book: { label: ar.accounting.ledger.book, currency: company.ledgers.book.currency },
        parallel: { label: ar.accounting.ledger.parallel, currency: parallel.currency },
      }}
    />
  );
}
