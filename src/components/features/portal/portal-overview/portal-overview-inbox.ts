// "N waiting in Inbox": the line under the Private notes figure on a Property's
// results strip (boards 01, 03, 10 to 13). It counts the guest feedback from the
// Portals that still waits in the Inbox, which is the `feedback` queue (open
// items whose source is private feedback), so the figure sits beside the private
// notes it follows up and the link lands on exactly those items. Google reviews
// are not Portal results and are not counted. Pure, so the wording, the zero rule
// and the permission gate are tested apart from the strip.
import { queryOptions } from '@tanstack/react-query'
import type {
  InboxPropertyCounts,
  InboxQueue,
} from '#/contexts/inbox/application/public-api'
import { inboxKeys } from '#/shared/queries/query-keys'

/** The queue counted and opened; `feedback` needs `inbox.read` only, not `reply.manage`. */
export const INBOX_WAITING_QUEUE = 'feedback' satisfies InboxQueue

const INBOX_WAITING_STALE_MS = 30_000

/**
 * The count read, under the Inbox's own cache key so the rail and this share one
 * entry. Disabled for a reader who cannot open the Inbox; a failed read is not
 * retried and leaves the strip without the line.
 */
export function inboxWaitingQuery(
  mayOpenInbox: boolean,
  fetchCounts: (queue: typeof INBOX_WAITING_QUEUE) => Promise<InboxPropertyCounts>,
) {
  return queryOptions({
    queryKey: inboxKeys.propertyCountsFor(INBOX_WAITING_QUEUE),
    queryFn: () => fetchCounts(INBOX_WAITING_QUEUE),
    enabled: mayOpenInbox,
    staleTime: INBOX_WAITING_STALE_MS,
    retry: false,
  })
}

/** Null when the read has not answered: a missing count is not a zero. */
export function inboxWaitingCount(
  counts: InboxPropertyCounts | undefined,
  propertyId: string,
): number | null {
  if (!counts) return null
  return counts.byProperty[propertyId] ?? 0
}

/** The count for a reader who may open the Inbox; null for one who may not. */
export function inboxWaitingFor(
  mayOpenInbox: boolean,
  counts: InboxPropertyCounts | undefined,
  propertyId: string,
): number | null {
  return mayOpenInbox ? inboxWaitingCount(counts, propertyId) : null
}

/** The link's words, or null when there is nothing to say (status only by exception). */
export function inboxWaitingLabel(count: number | null): string | null {
  if (count === null || count <= 0) return null
  return `${count} waiting in Inbox`
}
