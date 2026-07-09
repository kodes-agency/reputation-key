// Inbox detail sub-hooks — split from use-inbox-detail.ts for line-count
// compliance. useDetailData is gone (reads now live in use-inbox-detail via
// TanStack Query); this file owns the debounced mark-as-read effect.

import { useEffect, useRef } from 'react'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import type { updateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import type { InboxItem } from '#/contexts/inbox/application/public-api'

/** Debounced auto-mark-as-read for newly-opened 'new' items. Calls
 *  `onMarkedRead(updatedItem)` on success — the caller wires it to Query
 *  invalidation (detail/notes/activity) + the optimistic list sync. */
export function useAutoMarkRead(
  item: InboxItem | null,
  active: boolean,
  enabled: boolean | undefined,
  onMarkedRead: (updatedItem: InboxItem) => void,
  updateInboxStatus: typeof updateInboxStatusFn,
): string | null {
  // invalidate: false — detail/list refresh via Query invalidation in the
  // caller's onMarkedRead; the inbox route has no loader, so full
  // router.invalidate() is pure waste.
  const markReadMutation = useMutationAction(updateInboxStatus, {
    invalidate: false,
    onSuccess: onMarkedRead,
  })
  const markReadRef = useRef(markReadMutation)
  markReadRef.current = markReadMutation
  const lastMarkedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !active || !item) return
    if (lastMarkedRef.current === item.id) return
    // FE-2: skip already-read items (and any other non-'new' status) so we
    // don't fire a redundant markRead mutation — that would trigger an
    // unnecessary server call plus side effects (toast, query invalidation).
    if (item.status === 'read') return
    if (item.status !== 'new') return

    const timer = setTimeout(() => {
      lastMarkedRef.current = item.id
      markReadRef.current({ data: { inboxItemId: item.id, status: 'read' } })
    }, 500)
    return () => clearTimeout(timer)
  }, [enabled, active, item])

  return lastMarkedRef.current
}
