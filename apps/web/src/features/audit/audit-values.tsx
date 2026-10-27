import { CURRENCY_CODES, RATE_TYPES, ROLES } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { formatDateTime, formatMonthName } from '../../lib/format';
import { useCompany } from '../../lib/session';

const t = ar.audit;

const has = <T extends string>(list: readonly T[], value: unknown): value is T =>
  list.some((known) => known === value);

/** The name of an audited entity, or its type as recorded. */
export function auditEntityLabel(entityType: string): string {
  return has(Object.keys(t.entities), entityType)
    ? t.entities[entityType as keyof typeof t.entities]
    : entityType;
}

/** The name of an audited field, or its key as recorded. */
export function auditFieldLabel(field: string): string {
  return has(Object.keys(t.fields), field) ? t.fields[field as keyof typeof t.fields] : field;
}

/**
 * A value of an entry's before or after, shown as the rest of the app shows it: a role, a
 * currency, a rate type, a month, a person or a company by name; codes and addresses LTR.
 */
export function AuditValue({
  field,
  value,
  names,
}: {
  field: string;
  value: unknown;
  /** People's names by user id: the current members. */
  names: ReadonlyMap<string, string>;
}) {
  const { me } = useCompany();
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">{t.detail.none}</span>;
  }
  if (typeof value === 'boolean') {
    if (field === 'twoFactorEnabled') {
      return <>{value ? ar.members.table.enrolled : ar.members.table.notEnrolled}</>;
    }
    return <>{value ? t.detail.yes : t.detail.no}</>;
  }
  if (field === 'role' && has(ROLES, value)) return <>{ar.roles[value]}</>;
  if (field.endsWith('Currency') && has(CURRENCY_CODES, value)) {
    return (
      <>
        {ar.accounting.currencies[value]} (<bdi dir="ltr">{value}</bdi>)
      </>
    );
  }
  if (field.endsWith('RateType') && has(RATE_TYPES, value)) {
    return <>{ar.company.rateTypes[value]}</>;
  }
  if (field === 'fiscalYearStartMonth' && typeof value === 'number') {
    return <>{formatMonthName(value)}</>;
  }
  if (field === 'expiresAt' && typeof value === 'string') return <>{formatDateTime(value)}</>;
  if (field === 'userId' && typeof value === 'string') {
    const name = names.get(value);
    if (name) return <bdi>{name}</bdi>;
  }
  if (field === 'activeCompanyId' && typeof value === 'string') {
    const company = me.memberships.find((membership) => membership.company.id === value)?.company;
    if (company) return <bdi>{company.name}</bdi>;
  }
  const shown = typeof value === 'string' ? value : JSON.stringify(value);
  if (field === 'email' || field.endsWith('Id')) {
    return (
      <bdi dir="ltr" className="break-all">
        {shown}
      </bdi>
    );
  }
  return <bdi className="whitespace-pre-line">{shown}</bdi>;
}
