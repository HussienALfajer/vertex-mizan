import { Link } from '@tanstack/react-router';
import {
  DOCUMENT_TYPES,
  type DocumentType,
  EVENT_ACTIONS,
  EVENT_STATES,
  EVENT_TYPES,
  type EventAction,
  type EventState,
  type EventType,
  HOLD_DETAILS,
  HOLD_REASONS,
  type HoldDetailCode,
  type HoldReason,
  type InboxEntry,
  POSTING_SLOTS,
  type PostingSlot,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Button, EventStateBadge } from '@vertex-mizan/ui';
import { ArrowRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { can, useCompany } from '../../lib/session';
import { EntryNumberText } from '../entries/entry-parts';

const t = ar.inbox;

// Hub may send what this build does not know yet (ADR 0006): each falls back to a neutral word.

/** An event type in Arabic. */
export function typeLabel(type: string): string {
  return (EVENT_TYPES as readonly string[]).includes(type)
    ? t.types[type as EventType]
    : t.unknownType;
}

/** A hold reason in Arabic. */
export function reasonLabel(reason: HoldReason | string | null): string | null {
  if (reason === null) return null;
  return (HOLD_REASONS as readonly string[]).includes(reason)
    ? t.reasons[reason as HoldReason]
    : t.unknownReason;
}

/** A state in Arabic. */
export function stateLabel(state: EventState | string): string {
  return (EVENT_STATES as readonly string[]).includes(state)
    ? t.states[state as EventState]
    : t.unknownState;
}

/** An action of an event's history in Arabic. */
export function actionLabel(action: EventAction | string): string {
  return (EVENT_ACTIONS as readonly string[]).includes(action)
    ? t.actions[action as EventAction]
    : t.unknownAction;
}

/** A slot's name, or the slot as sent when this build does not know it. */
export function slotLabel(slot: string): ReactNode {
  return (POSTING_SLOTS as readonly string[]).includes(slot) ? (
    ar.postingRules.slots[slot as PostingSlot]
  ) : (
    <bdi dir="ltr">{slot}</bdi>
  );
}

/**
 * A hold's detail in words (rules 8–9): a fixed code, `slot_unmapped:<slot>` with the slot's name,
 * `account_blocked:<code>` with the account's code; an unknown detail as sent, LTR.
 */
export function detailText(detail: string | null): ReactNode {
  if (detail === null) return null;
  if ((HOLD_DETAILS as readonly string[]).includes(detail)) {
    return t.details[detail as HoldDetailCode];
  }
  const [code, what] = detail.split(':', 2) as [string, string | undefined];
  if (code === 'slot_unmapped' && what) {
    return (
      <>
        {`${t.slotUnmapped}: `}
        {slotLabel(what)}
      </>
    );
  }
  if (code === 'account_blocked' && what) {
    return (
      <>
        {`${t.accountBlocked}: `}
        <bdi dir="ltr">{what}</bdi>
      </>
    );
  }
  return <bdi dir="ltr">{detail}</bdi>;
}

/** An event's state, with a held event's reason beside it. */
export function EventStateText({
  state,
  reason,
}: {
  state: EventState | string;
  reason: HoldReason | string | null;
}) {
  return (
    <EventStateBadge
      state={state as EventState}
      label={stateLabel(state)}
      reason={state === 'held' ? reasonLabel(reason) : null}
    />
  );
}

/** The entries an event posted, each linked to its page. */
export function EntryLinks({
  entries,
  startMonth,
}: {
  entries: readonly InboxEntry[];
  startMonth: number;
}) {
  if (entries.length === 0)
    return <span className="text-muted-foreground">{t.table.noEntries}</span>;
  return (
    <span className="flex flex-wrap gap-x-2">
      {entries.map((entry) => (
        <Link
          key={entry.id}
          to="/entries/$id"
          params={{ id: entry.id }}
          className="text-primary underline-offset-4 hover:underline"
        >
          <EntryNumberText number={entry} startMonth={startMonth} />
        </Link>
      ))}
    </span>
  );
}

/** An event's name linked to its page: its type in Arabic. */
export function EventLink({ id, type }: { id: string; type: string }) {
  return (
    <Link
      to="/inbox/$id"
      params={{ id }}
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      {typeLabel(type)}
    </Link>
  );
}

/**
 * A Hub document on an entry or an item (S05 "Screens"): its type and number, and a link to the
 * event that posted it for a person who reads the inbox.
 */
export function HubDocumentLink({
  document,
  eventId,
}: {
  document: { type: string; number: string | null };
  eventId: string | null;
}) {
  const { me } = useCompany();
  const type = (DOCUMENT_TYPES as readonly string[]).includes(document.type)
    ? t.documentTypes[document.type as DocumentType]
    : null;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      {type && <span>{type}</span>}
      {document.number && <bdi dir="ltr">{document.number}</bdi>}
      {eventId && can(me, 'events.read') && (
        <Link
          to="/inbox/$id"
          params={{ id: eventId }}
          className="text-primary underline-offset-4 hover:underline"
        >
          {t.entryLink.openEvent}
        </Link>
      )}
    </span>
  );
}

/** The way back to the inbox, above an event's title. */
export function InboxBackLink() {
  return (
    <Button variant="ghost" size="sm" className="w-fit" render={<Link to="/inbox" />}>
      <ArrowRightIcon aria-hidden="true" />
      {t.event.back}
    </Button>
  );
}
