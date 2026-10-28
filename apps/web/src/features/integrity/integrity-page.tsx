import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  type AnchorResult,
  type IntegrityReport,
  integrityReportSchema,
  type PastedAnchor,
  pastedAnchorSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  Amount,
  Badge,
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Digest,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { ShieldAlertIcon, ShieldCheckIcon, ShieldIcon } from 'lucide-react';
import { type ClipboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { FormError, FormErrorSummary } from '../../components/form-error';
import { api } from '../../lib/api';
import { formatDateTime, formatDay, formatEntryNumber } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { accountsQuery } from '../chart/chart-queries';
import { companyQuery } from '../company/company-queries';
import { EntryNumberText } from '../entries/entry-parts';

const t = ar.integrity;
const route = getRouteApi('/_app/_company/integrity');

/** The last report of this company, kept while the app runs so the page shows it on return. */
const lastReportKey = (companyId: string) => ['integrity', companyId, 'last'] as const;

const resultTone: Record<AnchorResult, 'success' | 'danger' | 'warning'> = {
  verified: 'success',
  mismatch: 'danger',
  missing: 'warning',
};

/**
 * `/integrity` (S03 rule 19, "Screens"): runs the integrity check and shows its report: the
 * counts, the first break in the chain, numbering, unbalanced entries, period balances, every
 * stored anchor, and an anchor pasted from the daily email. `?run=true`, from the palette, runs
 * the check on arrival.
 */
export function IntegrityPage() {
  const { companyId } = useCompany();
  const { run: runOnArrival } = route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const last = useQuery({
    queryKey: lastReportKey(companyId),
    queryFn: (): IntegrityReport | null => null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
  const check = useMutation({
    mutationFn: (anchor: PastedAnchor | undefined) =>
      api('POST', '/integrity/check', {
        company: companyId,
        body: anchor ? { anchor } : {},
        schema: integrityReportSchema,
      }),
    onSuccess: (report) => queryClient.setQueryData(lastReportKey(companyId), report),
  });
  const started = useRef(false);
  useEffect(() => {
    if (!runOnArrival || started.current) return;
    started.current = true;
    check.mutate(undefined);
    void navigate({ to: '/integrity', search: {}, replace: true });
  }, [runOnArrival, check, navigate]);
  const report = last.data ?? null;
  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          <Button
            loading={check.isPending && check.variables === undefined}
            onClick={() => check.mutate(undefined)}
          >
            <ShieldCheckIcon aria-hidden="true" />
            {report ? t.runAgain : t.run}
          </Button>
        }
      />
      <div className="flex min-w-0 flex-col gap-6">
        <FormError error={check.error} />
        {report ? (
          <Report report={report} />
        ) : (
          <EmptyState
            icon={<ShieldIcon />}
            title={check.isPending ? t.running : t.notRun.title}
            description={t.notRun.description}
          />
        )}
        <PastedAnchorCard
          pending={check.isPending && check.variables !== undefined}
          onCheck={(anchor) => check.mutate(anchor)}
          pasted={report?.pasted ?? null}
        />
      </div>
    </>
  );
}

function Report({ report }: { report: IntegrityReport }) {
  const { companyId } = useCompany();
  const startMonth = useQuery(companyQuery(companyId)).data?.fiscalYearStartMonth ?? 1;
  return (
    <section aria-labelledby="integrity-result" className="flex min-w-0 flex-col gap-6">
      <h2 id="integrity-result" className="sr-only">
        {t.result.title}
      </h2>
      <Callout
        role="status"
        tone={report.ok ? 'info' : 'danger'}
        icon={report.ok ? <ShieldCheckIcon /> : <ShieldAlertIcon />}
        title={report.ok ? t.result.clean : t.result.broken}
        description={report.ok ? t.result.cleanDescription : t.result.brokenDescription}
      />
      <Card>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t.result.checkedAt}>{formatDateTime(report.checkedAt)}</Fact>
          <Fact label={t.result.entries}>
            <bdi dir="ltr" className="tabular-nums">
              {report.entryCount}
            </bdi>
          </Fact>
          <Fact label={t.result.lines}>
            <bdi dir="ltr" className="tabular-nums">
              {report.lineCount}
            </bdi>
          </Fact>
          <Fact label={t.result.head}>
            {report.head.hash ? (
              <span className="flex flex-wrap items-center gap-2">
                <Digest
                  value={report.head.hash}
                  copyLabel={t.anchors.copyHash}
                  copiedLabel={t.anchors.copied}
                />
                <Badge tone={report.head.matchesChain ? 'success' : 'danger'}>
                  {report.head.matchesChain ? t.result.headMatches : t.result.headDiffers}
                </Badge>
              </span>
            ) : (
              t.result.noHead
            )}
          </Fact>
        </dl>
      </Card>
      {report.firstBreak && (
        <Problems title={t.firstBreak.title}>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Fact label={t.firstBreak.entry}>
              <Link
                to="/entries/$id"
                params={{ id: report.firstBreak.entryId }}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                <EntryNumberText number={report.firstBreak.number} startMonth={startMonth} />
              </Link>
            </Fact>
            <Fact label={t.firstBreak.sequence}>
              <bdi dir="ltr" className="tabular-nums">
                {report.firstBreak.sequence}
              </bdi>
            </Fact>
            <Fact label={t.numbering.problem}>
              {t.firstBreak.reasons[report.firstBreak.reason]}
            </Fact>
          </dl>
        </Problems>
      )}
      {report.numbering.length > 0 && (
        <Problems title={t.numbering.title}>
          <Table aria-label={t.numbering.title}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.numbering.number}</TableHead>
                <TableHead>{t.numbering.problem}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.numbering.map((row) => (
                <TableRow key={`${row.fiscalYear}/${row.number}/${row.problem}`}>
                  <TableCell>
                    <bdi dir="ltr" className="tabular-nums">
                      {formatEntryNumber(row, startMonth)}
                    </bdi>
                  </TableCell>
                  <TableCell>{t.numbering.problems[row.problem]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Problems>
      )}
      {report.unbalanced.length > 0 && <Unbalanced report={report} startMonth={startMonth} />}
      {report.periodBalances.length > 0 && <PeriodBalances report={report} />}
      <Card>
        <CardHeader>
          <CardTitle>{t.anchors.title}</CardTitle>
          <CardDescription>{t.anchors.description}</CardDescription>
        </CardHeader>
        <div className="min-w-0">
          {report.anchors.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.anchors.empty}</p>
          ) : (
            <Table aria-label={t.anchors.title}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.anchors.date}</TableHead>
                  <TableHead numeric className="max-sm:hidden">
                    {t.anchors.count}
                  </TableHead>
                  <TableHead className="max-sm:hidden">{t.anchors.hash}</TableHead>
                  <TableHead>{t.anchors.result}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.anchors.map((anchor) => (
                  <TableRow key={anchor.anchoredOn}>
                    <TableCell className="whitespace-nowrap">
                      {formatDay(anchor.anchoredOn)}
                    </TableCell>
                    <TableCell numeric className="max-sm:hidden">
                      <bdi dir="ltr">{anchor.entryCount}</bdi>
                    </TableCell>
                    <TableCell className="max-sm:hidden">
                      <Digest
                        value={anchor.headHash}
                        copyLabel={t.anchors.copyHash}
                        copiedLabel={t.anchors.copied}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge tone={resultTone[anchor.result]}>{t.results[anchor.result]}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
    </section>
  );
}

function Unbalanced({ report, startMonth }: { report: IntegrityReport; startMonth: number }) {
  const { companyId } = useCompany();
  const ledgers = useQuery(companyQuery(companyId)).data?.ledgers;
  return (
    <Problems title={t.unbalanced.title}>
      <Table aria-label={t.unbalanced.title}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.unbalanced.entry}</TableHead>
            <TableHead className="max-sm:hidden">{t.unbalanced.ledger}</TableHead>
            <TableHead numeric>{t.unbalanced.residual}</TableHead>
            <TableHead numeric className="max-sm:hidden">
              {t.unbalanced.incompleteLines}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.unbalanced.map((row) => {
            const currency = ledgers?.[row.ledger]?.currency;
            return (
              <TableRow key={`${row.entryId}/${row.ledger}`}>
                <TableCell>
                  <Link
                    to="/entries/$id"
                    params={{ id: row.entryId }}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    <EntryNumberText number={row.number} startMonth={startMonth} />
                  </Link>
                </TableCell>
                <TableCell className="max-sm:hidden">{ar.accounting.ledger[row.ledger]}</TableCell>
                <TableCell numeric>
                  {currency ? (
                    <Amount value={BigInt(row.residualMinor)} currency={currency} showCurrency />
                  ) : null}
                </TableCell>
                <TableCell numeric className="max-sm:hidden">
                  <bdi dir="ltr">{row.incompleteLines}</bdi>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Problems>
  );
}

function PeriodBalances({ report }: { report: IntegrityReport }) {
  const { companyId } = useCompany();
  const accounts = useQuery(accountsQuery(companyId, true)).data;
  const byId = new Map(accounts?.map((account) => [account.id, account]));
  return (
    <Problems title={t.periodBalances.title}>
      <Table aria-label={t.periodBalances.title}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.periodBalances.period}</TableHead>
            <TableHead>{t.periodBalances.account}</TableHead>
            <TableHead className="max-sm:hidden">{t.periodBalances.currency}</TableHead>
            <TableHead>{t.periodBalances.problem}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.periodBalances.map((row) => {
            const account = byId.get(row.accountId);
            return (
              <TableRow
                key={`${row.period}/${row.accountId}/${row.dimensionSetId}/${row.currency}`}
              >
                <TableCell>
                  <bdi dir="ltr" className="tabular-nums">
                    {row.period}
                  </bdi>
                </TableCell>
                <TableCell className="max-w-72">
                  {account ? (
                    <AccountLabel code={account.code} name={account.name} />
                  ) : (
                    <bdi dir="ltr">{row.accountId}</bdi>
                  )}
                </TableCell>
                <TableCell className="max-sm:hidden">
                  <bdi dir="ltr">{row.currency}</bdi>
                </TableCell>
                <TableCell>{t.periodBalances.problems[row.problem]}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Problems>
  );
}

function Problems({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <div className="min-w-0">{children}</div>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}

/**
 * An anchor as the daily email lists it, pasted whole into one field: its date, its entry count
 * and its hash, in that order (`ar.email.dailyAnchor.anchor`). `null` when the text is not one.
 */
export function anchorFromEmail(
  text: string,
): { date: string; count: string; hash: string } | null {
  const latin = text.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
  const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(latin)?.[1];
  const hash = /\b([0-9a-fA-F]{64})\b/.exec(latin)?.[1];
  if (!date || !hash) return null;
  const rest = latin.replace(date, ' ').replace(hash, ' ');
  const count = /\b(\d{1,9})\b/.exec(rest)?.[1];
  if (!count) return null;
  return { date, count, hash: hash.toLowerCase() };
}

/**
 * The anchor from the daily email (S03 rule 19): date, count and hash, typed or pasted; pasting
 * the email's whole anchor into any field fills the three. The only check that does not trust
 * the server.
 */
function PastedAnchorCard({
  pending,
  onCheck,
  pasted,
}: {
  pending: boolean;
  onCheck: (anchor: PastedAnchor) => void;
  pasted: IntegrityReport['pasted'];
}) {
  const [date, setDate] = useState('');
  const [count, setCount] = useState('');
  const [hash, setHash] = useState('');
  const [errors, setErrors] = useState<
    Partial<Record<'date' | 'count' | 'hash', string | undefined>>
  >({});
  const [attempt, setAttempt] = useState(0);

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const parsed = anchorFromEmail(event.clipboardData.getData('text'));
    if (!parsed) return;
    event.preventDefault();
    setDate(parsed.date);
    setCount(parsed.count);
    setHash(parsed.hash);
    setErrors({});
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.pasted.title}</CardTitle>
        <CardDescription>{t.pasted.description}</CardDescription>
      </CardHeader>
      <form
        noValidate
        className="flex min-w-0 flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const typed = { date: date.trim(), count: count.trim(), hash: hash.trim().toLowerCase() };
          const parsed = pastedAnchorSchema.safeParse({
            date: typed.date,
            count: /^\d{1,9}$/.test(typed.count) ? Number(typed.count) : Number.NaN,
            hash: typed.hash,
          });
          const fields = new Set(parsed.error?.issues.map((issue) => issue.path[0]) ?? []);
          const found = {
            date: fields.has('date') ? t.pasted.errors.date : undefined,
            count: fields.has('count') ? t.pasted.errors.count : undefined,
            hash: fields.has('hash') ? t.pasted.errors.hash : undefined,
          };
          setErrors(found);
          if (!parsed.success) {
            setAttempt((value) => value + 1);
            return;
          }
          onCheck(parsed.data);
        }}
      >
        <FormErrorSummary
          attempt={attempt}
          errors={[
            ['anchor-date', errors.date],
            ['anchor-count', errors.count],
            ['anchor-hash', errors.hash],
          ]}
        />
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field id="anchor-date" invalid={errors.date !== undefined}>
            <FieldLabel>{t.pasted.date}</FieldLabel>
            <Input
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              value={date}
              onPaste={onPaste}
              onChange={(event) => setDate(event.target.value)}
            />
            <FieldError match={errors.date !== undefined}>{errors.date}</FieldError>
          </Field>
          <Field id="anchor-count" invalid={errors.count !== undefined}>
            <FieldLabel>{t.pasted.count}</FieldLabel>
            <Input
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              value={count}
              onPaste={onPaste}
              onChange={(event) => setCount(event.target.value)}
            />
            <FieldError match={errors.count !== undefined}>{errors.count}</FieldError>
          </Field>
        </div>
        <Field id="anchor-hash" invalid={errors.hash !== undefined}>
          <FieldLabel>{t.pasted.hash}</FieldLabel>
          <Input
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            value={hash}
            onPaste={onPaste}
            onChange={(event) => setHash(event.target.value)}
          />
          <FieldDescription>{t.pasted.hashHint}</FieldDescription>
          <FieldError match={errors.hash !== undefined}>{errors.hash}</FieldError>
        </Field>
        <Button type="submit" variant="outline" className="w-fit" loading={pending}>
          {t.pasted.submit}
        </Button>
        {pasted && <PastedResult pasted={pasted} />}
      </form>
    </Card>
  );
}

function PastedResult({ pasted }: { pasted: NonNullable<IntegrityReport['pasted']> }) {
  const copy = {
    verified: { title: t.pasted.verified, description: t.pasted.verifiedDescription },
    mismatch: { title: t.pasted.mismatch, description: t.pasted.mismatchDescription },
    missing: { title: t.pasted.missing, description: t.pasted.missingDescription },
  }[pasted.result];
  return (
    <Callout
      role="status"
      tone={
        pasted.result === 'verified' ? 'info' : pasted.result === 'mismatch' ? 'danger' : 'warning'
      }
      icon={pasted.result === 'verified' ? <ShieldCheckIcon /> : <ShieldAlertIcon />}
      title={copy.title}
      description={`${copy.description} ${t.pasted.stored[pasted.stored]}`}
    />
  );
}
