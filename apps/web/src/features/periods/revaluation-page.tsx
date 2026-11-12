import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  type ClosingRate,
  type Ledger,
  type RevaluationBalance,
  type RevaluationPreview,
  revaluationPostResultSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  Badge,
  Button,
  Callout,
  Card,
  Field,
  FieldLabel,
  Input,
  LedgerSwitch,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import {
  CircleAlertIcon,
  CircleCheckIcon,
  ClockIcon,
  LockIcon,
  RefreshCwIcon,
  RotateCwIcon,
  SendIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { FormError } from '../../components/form-error';
import { api, hasCode } from '../../lib/api';
import { damascusToday, formatDateTime, formatDay } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { companyQuery } from '../company/company-queries';
import { EntryNumberText, useFiscalYearStartMonth } from '../entries/entry-parts';
import { ValueName } from '../revenue/revenue-parts';
import { PeriodName, previousMonth } from './period-parts';
import { revaluationQuery } from './periods-queries';

const t = ar.revaluation;
const route = getRouteApi('/_app/_company/revaluation');

type Notice = { tone: 'info' | 'warning'; text: string } | null;

/**
 * `/revaluation?period=&ledger=` (S07 "Screens", rules 10–18): a month's revaluation in one ledger,
 * its closing rates with their dates, every balance with its carrying amount, value at the closing
 * rate, what is already revalued and the difference, the gain and loss totals, and the posted
 * revaluations with their entries and reversals. "ترحيل إعادة التقييم" (or "ترحيل قيد تسوية" once
 * one stands) posts the preview shown; "ترحيل الدفترين" posts each ledger in turn. A preview that
 * changed (`REVALUATION_CHANGED`) is read again and shown with a notice.
 */
export function RevaluationPage() {
  const search = route.useSearch();
  const navigate = useNavigate();
  const { companyId } = useCompany();
  const company = useQuery(companyQuery(companyId)).data;
  const period = search.period ?? previousMonth(damascusToday().slice(0, 7));
  const parallel = company?.ledgers.parallel ?? null;
  const ledger: Ledger = search.ledger === 'parallel' && parallel ? 'parallel' : 'book';
  const [notice, setNotice] = useState<Notice>(null);
  const go = (next: { period?: string; ledger?: Ledger }) => {
    setNotice(null);
    void navigate({ to: '/revaluation', search: { period, ledger, ...next } });
  };
  return (
    <>
      <PageHeader title={t.title} description={t.description} />
      <search className="flex flex-wrap items-end gap-4">
        <Field className="w-48">
          <FieldLabel>{t.month}</FieldLabel>
          <Input
            type="month"
            dir="ltr"
            value={period}
            onChange={(event) => {
              if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) {
                go({ period: event.target.value });
              }
            }}
          />
        </Field>
        {company && parallel && (
          <LedgerSwitch
            className="w-fit"
            label={t.ledgers.label}
            value={ledger}
            onValueChange={(next) => go({ ledger: next })}
            ledgers={{
              book: { label: t.ledgers.book, currency: company.ledgers.book.currency },
              parallel: { label: t.ledgers.parallel, currency: parallel.currency },
            }}
          />
        )}
      </search>
      <Preview
        period={period}
        ledger={ledger}
        hasParallel={parallel !== null}
        notice={notice}
        setNotice={setNotice}
      />
    </>
  );
}

function Preview({
  period,
  ledger,
  hasParallel,
  notice,
  setNotice,
}: {
  period: string;
  ledger: Ledger;
  hasParallel: boolean;
  notice: Notice;
  setNotice: (notice: Notice) => void;
}) {
  const { companyId } = useCompany();
  const preview = useQuery(revaluationQuery(companyId, period, ledger));
  if (preview.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-row" />
        <Skeleton className="h-row" />
        <Skeleton className="h-row" />
      </div>
    );
  }
  if (hasCode(preview.error, 'PERIOD_CLOSED')) {
    return (
      <Callout
        tone="neutral"
        icon={<LockIcon />}
        title={t.closed}
        action={
          <Button variant="outline" render={<Link to="/periods/$period" params={{ period }} />}>
            {t.openPeriod}
          </Button>
        }
      />
    );
  }
  if (preview.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <FormError error={preview.error} />
        <Button variant="outline" onClick={() => void preview.refetch()}>
          <RotateCwIcon aria-hidden="true" />
          {ar.common.retry}
        </Button>
      </div>
    );
  }
  return (
    <PreviewView
      data={preview.data}
      hasParallel={hasParallel}
      notice={notice}
      setNotice={setNotice}
    />
  );
}

function PreviewView({
  data,
  hasParallel,
  notice,
  setNotice,
}: {
  data: RevaluationPreview;
  hasParallel: boolean;
  notice: Notice;
  setNotice: (notice: Notice) => void;
}) {
  const { companyId, me } = useCompany();
  const queryClient = useQueryClient();
  const mayPost = can(me, 'revaluation.post');
  const other: Ledger = data.ledger === 'book' ? 'parallel' : 'book';
  const otherPreview = useQuery({
    ...revaluationQuery(companyId, data.period, other),
    enabled: mayPost && hasParallel,
  }).data;

  const post = useMutation({
    mutationFn: async (ledgers: RevaluationPreview[]) => {
      for (const preview of ledgers) {
        await api('POST', `/revaluation/${preview.period}`, {
          company: companyId,
          body: { ledger: preview.ledger, fingerprint: preview.fingerprint },
          schema: revaluationPostResultSchema,
        });
      }
    },
    onSuccess: async () => {
      setNotice({ tone: 'info', text: t.actions.done });
      await queryClient.invalidateQueries({ queryKey: ['periods', companyId] });
      await queryClient.invalidateQueries({ queryKey: ['entries', companyId] });
    },
    onError: async (error) => {
      // The preview changed since it was read (rule 17): show the new one with a notice.
      if (!hasCode(error, 'REVALUATION_CHANGED')) return;
      setNotice({ tone: 'warning', text: t.changed });
      await queryClient.invalidateQueries({ queryKey: ['periods', companyId] });
    },
  });

  const postable = (preview: RevaluationPreview | undefined): preview is RevaluationPreview =>
    preview?.ended === true && preview.state === 'to_post';
  const both = [data, otherPreview].filter(postable);
  both.sort((a, b) => (a.ledger === 'book' ? -1 : b.ledger === 'book' ? 1 : 0));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <PeriodName period={data.period} />
          <span className="text-muted-foreground text-sm">
            {`${t.lastDay}: `}
            {formatDay(data.lastDay)}
          </span>
        </div>
        {mayPost && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={!postable(data)}
              loading={post.isPending}
              onClick={() => post.mutate([data])}
            >
              <SendIcon aria-hidden="true" />
              {data.posted.length > 0 ? t.actions.adjust : t.actions.post}
            </Button>
            {hasParallel && (
              <Button
                variant="outline"
                disabled={both.length === 0 || post.isPending}
                onClick={() => post.mutate(both)}
              >
                {t.actions.both}
              </Button>
            )}
          </div>
        )}
      </div>
      {notice && (
        <Callout
          role="status"
          tone={notice.tone}
          icon={notice.tone === 'info' ? <CircleCheckIcon /> : <RefreshCwIcon />}
          title={notice.text}
        />
      )}
      {post.error && !hasCode(post.error, 'REVALUATION_CHANGED') && (
        <FormError error={post.error} />
      )}
      <StateCallout data={data} />
      {!data.ended && <Callout tone="neutral" icon={<ClockIcon />} title={t.notEnded} />}
      <Section id="closing-rates" title={t.closingRates.title}>
        <ClosingRates data={data} />
      </Section>
      <Section id="balances" title={t.balances.title}>
        <Balances data={data} />
      </Section>
      <Section id="posted" title={t.posted.title}>
        <Posted data={data} />
      </Section>
    </>
  );
}

function StateCallout({ data }: { data: RevaluationPreview }) {
  if (data.state === 'current') {
    return (
      <Callout
        tone="info"
        icon={<CircleCheckIcon />}
        title={t.states.current}
        description={t.currentDescription}
      />
    );
  }
  if (data.state === 'rate_missing') {
    return (
      <Callout
        tone="danger"
        icon={<CircleAlertIcon />}
        title={t.states.rate_missing}
        description={
          <>
            {`${t.rateMissing.description} `}
            {data.missingRates.map((missing, index) => (
              <span key={`${missing.currency}-${missing.to}-${missing.rateType}`}>
                {index > 0 && ar.common.listSeparator}
                <bdi dir="ltr" className="tabular-nums">
                  {`${missing.currency}/${missing.to}`}
                </bdi>
                {` ${ar.rates.types[missing.rateType]} `}
                {formatDay(missing.on)}
              </span>
            ))}
          </>
        }
        action={
          <Button variant="outline" render={<Link to="/rates" />}>
            {t.rateMissing.record}
          </Button>
        }
      />
    );
  }
  return <Callout tone="warning" icon={<CircleAlertIcon />} title={t.states.to_post} />;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <h2 id={id} className="text-lg font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A closing rate's rows as quoted, never inverted (ADR 0007). */
function RateText({ rate }: { rate: ClosingRate }) {
  return (
    <span className="flex flex-col gap-0.5">
      {rate.rows.map((row) => (
        <bdi key={row.rateId} dir="ltr" className="tabular-nums whitespace-nowrap">
          {`${row.base}/${row.quote} ${row.rate}`}
        </bdi>
      ))}
    </span>
  );
}

function ClosingRates({ data }: { data: RevaluationPreview }) {
  if (data.closingRates.length === 0) {
    return <p className="text-muted-foreground">{t.closingRates.none}</p>;
  }
  return (
    <Card className="min-w-0 overflow-x-auto">
      <Table aria-label={t.closingRates.label}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.closingRates.currency}</TableHead>
            <TableHead>{t.closingRates.rateType}</TableHead>
            <TableHead>{t.closingRates.rate}</TableHead>
            <TableHead>{t.closingRates.effectiveOn}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.closingRates.map((rate) => (
            <TableRow key={rate.currency}>
              <TableCell>
                <bdi dir="ltr">{rate.currency}</bdi>
                {rate.rows.length > 1 && (
                  <span className="block text-muted-foreground text-xs">
                    {t.closingRates.cross}
                  </span>
                )}
              </TableCell>
              <TableCell>{ar.rates.types[rate.rateType]}</TableCell>
              <TableCell>
                <RateText rate={rate} />
              </TableCell>
              <TableCell>
                <span className="flex flex-col gap-0.5">
                  {rate.rows.map((row) => (
                    <span key={row.rateId} className="whitespace-nowrap">
                      {formatDay(row.effectiveOn)}
                    </span>
                  ))}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function LedgerAmount({ minor, currency }: { minor: string | null; currency: string }) {
  if (minor === null) return <span className="text-muted-foreground">{t.balances.noRate}</span>;
  return (
    <Amount value={BigInt(minor)} currency={currency as RevaluationPreview['ledgerCurrency']} />
  );
}

function Balances({ data }: { data: RevaluationPreview }) {
  if (data.balances.length === 0) {
    return <p className="text-muted-foreground">{t.balances.empty}</p>;
  }
  const currency = data.ledgerCurrency;
  const rateOf = (balance: RevaluationBalance) =>
    data.closingRates.find((rate) => rate.currency === balance.currency);
  return (
    <Card className="min-w-0 overflow-x-auto">
      <Table aria-label={t.balances.label}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.balances.account}</TableHead>
            <TableHead>{t.balances.itemOrDimensions}</TableHead>
            <TableHead>{t.balances.currency}</TableHead>
            <TableHead numeric>{t.balances.transaction}</TableHead>
            <TableHead numeric>{t.balances.carrying}</TableHead>
            <TableHead>{t.balances.closingRate}</TableHead>
            <TableHead numeric>{t.balances.target}</TableHead>
            <TableHead numeric>{t.balances.revalued}</TableHead>
            <TableHead numeric>{t.balances.difference}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.balances.map((balance) => {
            const rate = rateOf(balance);
            return (
              <TableRow
                key={`${balance.accountId}-${balance.item?.id ?? balance.values.map((value) => value.id).join('.')}-${balance.currency}`}
              >
                <TableCell>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <bdi dir="ltr" className="font-medium tabular-nums">
                      {balance.accountCode}
                    </bdi>
                    <bdi>{balance.accountName}</bdi>
                    {balance.blocked && (
                      <Badge tone="warning" className="w-fit">
                        <LockIcon aria-hidden="true" />
                        {t.balances.blocked}
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  {balance.item ? (
                    <Link
                      to="/open-items/$id"
                      params={{ id: balance.item.id }}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      <bdi dir="ltr">{balance.item.reference}</bdi>
                    </Link>
                  ) : null}
                  {balance.values.length > 0 && (
                    <span className="flex flex-col gap-0.5">
                      {balance.values.map((value) => (
                        <span key={value.id} className="inline-flex flex-wrap items-center gap-x-2">
                          <ValueName value={value} />
                          {value.archived && (
                            <Badge tone="neutral" className="w-fit">
                              {t.balances.archived}
                            </Badge>
                          )}
                        </span>
                      ))}
                    </span>
                  )}
                  {!balance.item && balance.values.length === 0 && (
                    <span className="text-muted-foreground">{ar.periods.table.none}</span>
                  )}
                </TableCell>
                <TableCell>
                  <bdi dir="ltr">{balance.currency}</bdi>
                </TableCell>
                <TableCell numeric>
                  <Amount value={BigInt(balance.transactionMinor)} currency={balance.currency} />
                </TableCell>
                <TableCell numeric>
                  <Amount value={BigInt(balance.carryingMinor)} currency={currency} />
                </TableCell>
                <TableCell>
                  {rate ? (
                    <RateText rate={rate} />
                  ) : (
                    <span className="text-muted-foreground">{t.balances.noRate}</span>
                  )}
                </TableCell>
                <TableCell numeric>
                  <LedgerAmount minor={balance.targetMinor} currency={currency} />
                </TableCell>
                <TableCell numeric>
                  <Amount value={BigInt(balance.revaluedMinor)} currency={currency} />
                </TableCell>
                <TableCell numeric>
                  <LedgerAmount minor={balance.differenceMinor} currency={currency} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <dl className="flex flex-wrap justify-end gap-x-8 gap-y-2 border-t px-cell py-3">
        <div className="flex items-baseline gap-2">
          <dt className="text-muted-foreground text-sm">{t.gain}</dt>
          <dd>
            <Amount value={BigInt(data.gainMinor)} currency={currency} strong showCurrency />
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-muted-foreground text-sm">{t.loss}</dt>
          <dd>
            <Amount value={BigInt(data.lossMinor)} currency={currency} strong showCurrency />
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function Posted({ data }: { data: RevaluationPreview }) {
  const { companyId } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  if (data.posted.length === 0) return <p className="text-muted-foreground">{t.posted.none}</p>;
  const link = (entry: RevaluationPreview['posted'][number]['entry']) => (
    <span className="flex flex-col gap-0.5">
      <Link
        to="/entries/$id"
        params={{ id: entry.id }}
        className="text-primary underline-offset-4 hover:underline"
      >
        <EntryNumberText number={entry} startMonth={startMonth} />
      </Link>
      <span className="text-muted-foreground text-xs">{formatDay(entry.date)}</span>
    </span>
  );
  return (
    <Card className="min-w-0 overflow-x-auto">
      <Table aria-label={t.posted.label}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.posted.kind}</TableHead>
            <TableHead>{t.posted.entry}</TableHead>
            <TableHead>{t.posted.reversal}</TableHead>
            <TableHead>{t.posted.at}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.posted.map((revaluation) => (
            <TableRow key={revaluation.id}>
              <TableCell>{revaluation.adjusting ? t.posted.adjusting : t.posted.first}</TableCell>
              <TableCell>{link(revaluation.entry)}</TableCell>
              <TableCell>{link(revaluation.reversal)}</TableCell>
              <TableCell className="whitespace-nowrap">
                {formatDateTime(revaluation.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
