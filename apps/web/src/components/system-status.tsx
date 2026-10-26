import { useQuery } from '@tanstack/react-query';
import { ar } from '@vertex-mizan/i18n';
import { Badge } from '@vertex-mizan/ui';
import { formatDateTime } from '../lib/format';
import { healthQuery } from '../lib/health';

const t = ar.shell.status;

/** The API and database health (`GET /api/health`), for the people who watch the system. */
export function SystemStatus() {
  const { data, isPending, isError } = useQuery(healthQuery);

  let value: string;
  if (isPending) value = t.checking;
  else if (isError) value = t.unreachable;
  else value = data.status === 'ok' ? t.ok : t.error;
  const tone = isPending ? 'neutral' : !isError && data.status === 'ok' ? 'success' : 'danger';

  return (
    <p aria-live="polite" className="flex flex-wrap items-center gap-2 text-muted-foreground">
      {t.label}
      <Badge tone={tone}>{value}</Badge>
      {data && (
        <span>
          {t.checkedAt}: <time dateTime={data.timestamp}>{formatDateTime(data.timestamp)}</time>
        </span>
      )}
    </p>
  );
}
