import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ENTRY_SOURCES, type EntrySource, type Ledger } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountPicker,
  Amount,
  Badge,
  Button,
  Callout,
  Card,
  type DateRange,
  DateRangeField,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  isDateRangeOrdered,
  LedgerSwitch,
  PageHeader,
  SelectField,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { BookOpenIcon, FilePenLineIcon, InfoIcon, PlusIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FormError } from '../../components/form-error';
import { formatDay, parseEntryNumber } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { accountsQuery } from '../chart/chart-queries';
import { companyQuery } from '../company/company-queries';
import { accountPickerLabels, EntryNumberText, pickerAccounts } from './entry-parts';
import { type EntryFilters, entriesQuery } from './entry-queries';

const t = ar.entries;
const route = getRouteApi('/_app/_company/entries/');

const sourceOptions = [
  { value: 'any', label: t.filters.anySource },
  ...ENTRY_SOURCES.map((source) => ({ value: source, label: t.sources[source] })),
];

/**
 * `/entries` (S03 "Screens"): the journal by entry date, newest first: number, date, description,
 * source, the debit total in the chosen ledger and the reversal marks; filtered by dates, number,
 * source, account and text. `?find=number`, from the palette, puts the focus in the number filter.
 */
export function JournalPage() {
  const { companyId, me, membership } = useCompany();
  const { find } = route.useSearch();
  const company = useQuery(companyQuery(companyId)).data;
  const accounts = useQuery(accountsQuery(companyId));
  const startMonth = company?.fiscalYearStartMonth ?? 1;
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [source, setSource] = useState<EntrySource | 'any'>('any');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [numberText, setNumberText] = useState('');
  const [text, setText] = useState('');
  const [typed, setTyped] = useState<{ number: string; text: string }>({ number: '', text: '' });
  const [ledger, setLedger] = useState<Ledger>('book');
  const numberRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (find === 'number') numberRef.current?.focus();
  }, [find]);

  const parsedNumber = typed.number.trim() === '' ? undefined : parseEntryNumber(typed.number);
  const filters: EntryFilters = {
    ...(range.from ? { from: range.from } : {}),
    ...(range.to ? { to: range.to } : {}),
    ...(parsedNumber ?? {}),
    ...(source === 'any' ? {} : { source }),
    ...(accountId ? { account: accountId } : {}),
    ...(typed.text.trim() ? { text: typed.text.trim() } : {}),
  };
  const valid = isDateRangeOrdered(range) && parsedNumber !== null;
  const list = useInfiniteQuery({ ...entriesQuery(companyId, filters), enabled: valid });
  const rows = list.data?.pages.flatMap((page) => page.entries) ?? [];
  const filtered = Object.keys(filters).length > 0;
  const parallel = company?.ledgers.parallel ?? null;
  const shown: Ledger = parallel ? ledger : 'book';

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          <div className="flex flex-wrap gap-2">
            {can(me, 'drafts.manage') && !membership.company.archived && (
              <Button render={<Link to="/entries/new" />}>
                <PlusIcon aria-hidden="true" />
                {t.newEntry}
              </Button>
            )}
            {can(me, 'drafts.read') && (
              <Button variant="outline" render={<Link to="/drafts" />}>
                <FilePenLineIcon aria-hidden="true" />
                {ar.drafts.nav}
              </Button>
            )}
          </div>
        }
      />
      {!can(me, 'drafts.manage') && <Callout tone="info" icon={<InfoIcon />} title={t.readOnly} />}
      <Card className="p-4">
        <search aria-label={t.filters.label}>
          <form
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              setTyped({ number: numberText, text });
            }}
          >
            <DateRangeField
              value={range}
              onValueChange={setRange}
              label={t.filters.range}
              fromLabel={t.filters.from}
              toLabel={t.filters.to}
              orderError={t.filters.order}
              className="md:col-span-2"
            />
            <SelectField
              label={t.filters.source}
              value={source}
              options={sourceOptions}
              onValueChange={(value) => setSource(value as EntrySource | 'any')}
            />
            <div className="flex items-end gap-1">
              <AccountPicker
                className="min-w-0 flex-1"
                label={t.filters.account}
                accounts={pickerAccounts(accounts.data ?? [])}
                value={accountId}
                onValueChange={setAccountId}
                labels={accountPickerLabels}
              />
              {accountId && (
                <IconButton label={t.filters.clearAccount} onClick={() => setAccountId(null)}>
                  <XIcon aria-hidden="true" />
                </IconButton>
              )}
            </div>
            <Field invalid={parsedNumber === null}>
              <FieldLabel>{t.filters.number}</FieldLabel>
              <Input
                ref={numberRef}
                dir="ltr"
                inputMode="numeric"
                value={numberText}
                onChange={(event) => setNumberText(event.target.value)}
              />
              <FieldDescription>{t.filters.numberHint}</FieldDescription>
              <FieldError match={parsedNumber === null}>{t.filters.numberInvalid}</FieldError>
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel>{t.filters.text}</FieldLabel>
              <Input
                type="search"
                value={text}
                maxLength={100}
                onChange={(event) => setText(event.target.value)}
              />
            </Field>
            <div className="flex items-end gap-2">
              <Button type="submit" variant="outline">
                {t.filters.apply}
              </Button>
              {filtered && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setRange({ from: '', to: '' });
                    setSource('any');
                    setAccountId(null);
                    setNumberText('');
                    setText('');
                    setTyped({ number: '', text: '' });
                  }}
                >
                  {t.filters.reset}
                </Button>
              )}
            </div>
          </form>
        </search>
      </Card>
      {parallel && company && (
        <LedgerSwitch
          className="w-fit"
          label={t.ledgerSwitch}
          value={shown}
          onValueChange={setLedger}
          ledgers={{
            book: { label: ar.accounting.ledger.book, currency: company.ledgers.book.currency },
            parallel: { label: ar.accounting.ledger.parallel, currency: parallel.currency },
          }}
        />
      )}
      {!valid ? null : list.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
        </div>
      ) : list.isError ? (
        <FormError error={list.error} />
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState title={t.empty.filtered} />
        ) : (
          <EmptyState
            icon={<BookOpenIcon />}
            title={t.empty.title}
            description={t.empty.description}
          />
        )
      ) : (
        <>
          <Table aria-label={t.table.label}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.table.number}</TableHead>
                <TableHead>{t.table.date}</TableHead>
                <TableHead>{t.table.description}</TableHead>
                <TableHead className="max-md:hidden">{t.table.source}</TableHead>
                <TableHead numeric>{t.table.debit}</TableHead>
                <TableHead className="max-sm:hidden">{t.table.status}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((entry) => {
                const debit = shown === 'parallel' ? entry.parallelDebit : entry.bookDebit;
                return (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <Link
                        to="/entries/$id"
                        params={{ id: entry.id }}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        <EntryNumberText number={entry} startMonth={startMonth} />
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDay(entry.entryDate)}
                    </TableCell>
                    <TableCell className="max-w-72 truncate">
                      <bdi>{entry.description}</bdi>
                    </TableCell>
                    <TableCell className="max-md:hidden">{t.sources[entry.source]}</TableCell>
                    <TableCell numeric>
                      {debit && (
                        <Amount value={BigInt(debit.amountMinor)} currency={debit.currency} />
                      )}
                    </TableCell>
                    <TableCell className="max-sm:hidden">
                      <span className="flex flex-wrap gap-1">
                        {entry.reversedByEntryId && (
                          <Badge tone="neutral">{t.table.reversed}</Badge>
                        )}
                        {entry.reversesEntryId && <Badge tone="info">{t.table.reversal}</Badge>}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {list.hasNextPage && (
            <Button
              variant="outline"
              className="w-fit self-center"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t.loadMore}
            </Button>
          )}
        </>
      )}
    </>
  );
}
