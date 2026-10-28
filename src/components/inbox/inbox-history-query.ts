// The handling-history read of one Inbox item. The detail pane starts it with the
// detail and the notes (`use-inbox-detail-queries.ts`), and the thread reads it
// (`inbox-thread.tsx`): one set of options, so both observers are the one query.
import { queryOptions } from '@tanstack/react-query'
import { inboxKeys } from '#/shared/queries/query-keys'
import type { InboxServerFns } from './types'

// The thread mounts a moment after the pane started the read. At 0 it would
// read again as it mounted, one more request for what the pane just fetched. A
// change to the item still reads again at once: `invalidateQueries` ignores
// this (`inbox-cache-policy.ts`).
const HISTORY_FRESH_MS = 3_000

export const inboxHistoryQueryOptions = (
  id: string,
  getInboxItemHistory: InboxServerFns['getInboxItemHistory'],
) =>
  queryOptions({
    queryKey: inboxKeys.history(id),
    queryFn: () => getInboxItemHistory({ data: { inboxItemId: id } }),
    staleTime: HISTORY_FRESH_MS,
  })
