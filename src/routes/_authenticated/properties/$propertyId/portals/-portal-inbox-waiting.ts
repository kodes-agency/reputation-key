// How many private notes from a Property's Portals wait in its Inbox, for the
// "N waiting in Inbox" line under the Private notes figure. An enrichment, like
// the results beside the list: a reader who cannot open the Inbox, or a read that
// fails, leaves the strip without the line and never the page without its list.
// It reads the Inbox's own per-property count under the Inbox's own cache key, so
// the two surfaces share one entry and every Inbox write that refreshes the rail
// refreshes this too.
import { useQuery } from '@tanstack/react-query'
import {
  inboxWaitingFor,
  inboxWaitingQuery,
} from '#/components/features/portal/portal-overview/portal-overview-inbox'
import { getInboxPropertyCountsFn } from '#/contexts/inbox/server/inbox'
import { usePermissions } from '#/shared/hooks/usePermissions'

/** Null until read, and for a reader who cannot open the Inbox (`inbox.manage`). */
export function usePortalInboxWaiting(propertyId: string): number | null {
  const { can: canDo } = usePermissions()
  // The link opens the manager Inbox, whose route refuses anyone without this.
  const mayOpenInbox = canDo('inbox.manage')
  const { data } = useQuery(
    inboxWaitingQuery(mayOpenInbox, (queue) =>
      getInboxPropertyCountsFn({ data: { queue } }),
    ),
  )
  return inboxWaitingFor(mayOpenInbox, data, propertyId)
}
