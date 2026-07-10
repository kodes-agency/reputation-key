// Inbox new count badge — for sidebar nav.
// Receives the getNewCount server fn as a prop per src/components/CONTEXT.md:55.
// Cached via TanStack Query (inboxKeys.newCount) so mark-read / status mutations
// can invalidate it. Non-critical: a zero/undefined count renders nothing and a
// load failure falls back to 0 (Query error → data undefined → null).
import { useQuery } from '@tanstack/react-query'
import type { getNewCountFn } from '#/contexts/inbox/server/inbox'
import { inboxKeys } from '#/shared/queries/query-keys'
import { Badge } from '#/components/ui/badge'

export function InboxNewBadge({
  getNewCount,
}: Readonly<{ getNewCount: typeof getNewCountFn }>) {
  const { data: count } = useQuery({
    queryKey: inboxKeys.newCount(),
    queryFn: () => getNewCount({ data: {} }),
    staleTime: 0,
  })

  if (count === undefined || count === 0) return null

  return (
    <Badge variant="destructive" className="ml-1.5 min-w-5 justify-center px-1.5 text-xs">
      {count > 99 ? '99+' : count}
    </Badge>
  )
}
