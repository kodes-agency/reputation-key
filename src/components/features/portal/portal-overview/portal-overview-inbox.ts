// "N waiting in Inbox": the one figure on a Property's results strip that is not
// a result. It counts the Inbox's Open queue (every open item, reviews and
// private feedback alike) for the Property, which is the queue the link lands
// on, so the number a manager reads is the number the Inbox shows. Pure, so the
// wording and the zero rule are tested apart from the strip.
import type {
  InboxPropertyCounts,
  InboxQueue,
} from '#/contexts/inbox/application/public-api'

/** The queue counted and opened; `open` needs `inbox.read` only, not `reply.manage`. */
export const INBOX_WAITING_QUEUE = 'open' satisfies InboxQueue

/** Null when the read has not answered: a missing count is not a zero. */
export function inboxWaitingCount(
  counts: InboxPropertyCounts | undefined,
  propertyId: string,
): number | null {
  if (!counts) return null
  return counts.byProperty[propertyId] ?? 0
}

/** The link's words, or null when there is nothing to say (status only by exception). */
export function inboxWaitingLabel(count: number | null): string | null {
  if (count === null || count <= 0) return null
  return `${count} waiting in Inbox`
}
