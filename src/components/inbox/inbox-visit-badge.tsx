// Inbox last-visit count badge — for sidebar nav.
// Shows the count of open items created since the user's last inbox visit
// (ADR 0023). Replaces the former org-level "new" badge.
// Receives the getLastVisitCount server fn as a prop per src/components/CONTEXT.md.
// Non-critical: a zero/undefined count renders nothing; a load failure falls
// back to null.
import { useQuery } from '@tanstack/react-query'
import type { getLastVisitCountFn } from '#/contexts/inbox/server/inbox'
import { inboxKeys } from '#/shared/queries/query-keys'
import { Badge } from '#/components/ui/badge'

export function InboxVisitBadge({
  getLastVisitCount,
}: Readonly<{ getLastVisitCount: typeof getLastVisitCountFn }>) {
  const { data: count } = useQuery({
    queryKey: inboxKeys.lastVisitCount(),
    queryFn: () => getLastVisitCount({ data: {} }),
    staleTime: 0,
  })

  if (count === undefined || count === 0) return null

  return (
    <Badge variant="destructive" className="ml-1.5 min-w-5 justify-center px-1.5 text-xs">
      {count > 99 ? '99+' : count}
    </Badge>
  )
}
