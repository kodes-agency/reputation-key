// How many items wait in a Property's Inbox, for the Portals strip's "N waiting
// in Inbox" link. An enrichment, like the results beside the list: a reader who
// cannot open the Inbox, or a read that fails, leaves the strip without the link
// and never the page without its list. It reads the Inbox's own per-property
// count under the Inbox's own cache key, so the two surfaces share one entry
// and every Inbox write that refreshes the rail refreshes this too.
import { useQuery } from '@tanstack/react-query'
import {
  INBOX_WAITING_QUEUE,
  inboxWaitingCount,
} from '#/components/features/portal/portal-overview/portal-overview-inbox'
import { getInboxPropertyCountsFn } from '#/contexts/inbox/server/inbox'
import { inboxKeys } from '#/shared/queries/query-keys'
import { usePermissions } from '#/shared/hooks/usePermissions'

const INBOX_WAITING_STALE_MS = 30_000

/** Null until read, and for a reader who cannot open the Inbox (`inbox.manage`). */
export function usePortalInboxWaiting(propertyId: string): number | null {
  const { can: canDo } = usePermissions()
  // The link opens the manager Inbox, whose route refuses anyone without this.
  const mayOpenInbox = canDo('inbox.manage')
  const { data } = useQuery({
    queryKey: inboxKeys.propertyCountsFor(INBOX_WAITING_QUEUE),
    queryFn: () => getInboxPropertyCountsFn({ data: { queue: INBOX_WAITING_QUEUE } }),
    enabled: mayOpenInbox,
    staleTime: INBOX_WAITING_STALE_MS,
    retry: false,
  })
  return mayOpenInbox ? inboxWaitingCount(data, propertyId) : null
}
