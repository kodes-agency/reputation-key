import { useMemo } from 'react'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { Permission } from '#/shared/domain/permissions'
import { isHeaderCommandPending } from './inbox-header-command-pending'
import { isCaseToolbarShown, itemCommandFence } from './inbox-case-toolbar-props'
import { INBOX_SOURCE_HANDLE_PERMISSION } from './inbox-owner-control'
import type { InboxDetailState } from './use-inbox-detail'

type CanPermission = (permission: Permission) => boolean

/**
 * Builds the `e` shortcut from the same availability and command fences as the
 * detail toolbar. Keeping the whole policy here prevents the page controller
 * from growing a second, subtly different escalation path.
 */
export function useInboxEscalationShortcut(
  item: InboxItem | null,
  detailState: InboxDetailState,
  can: CanPermission,
) {
  const isAllowed =
    item !== null &&
    isCaseToolbarShown(detailState) &&
    can('inbox.write') &&
    can(INBOX_SOURCE_HANDLE_PERMISSION[item.sourceType]) &&
    can('inbox.manage')
  const isPending = isHeaderCommandPending(detailState)
  const { escalate, resolveEscalation } = detailState

  return useMemo(
    () => ({
      isAllowed,
      isPending,
      escalate: () => {
        if (!item) return
        void escalate({ data: itemCommandFence(item) })
      },
      resolveEscalation: () => {
        if (!item) return
        void resolveEscalation({ data: itemCommandFence(item) })
      },
    }),
    [isAllowed, isPending, item, escalate, resolveEscalation],
  )
}
