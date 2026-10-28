import { useMemo } from 'react'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { Permission } from '#/shared/domain/permissions'
import { isHeaderCommandPending } from './inbox-header-command-pending'
import { isTriageShortcutAllowed } from './use-inbox-escalation-shortcut'
import type { InboxDetailState } from './use-inbox-detail'

/**
 * The `p` shortcut (owner P-7): it opens the open item's Priority menu, gated
 * exactly like `e` — the toolbar is shown, the caller holds the Escalate gate,
 * and no item command is in flight. The menu's own typeahead does the rest: U,
 * H, M or L, then Enter. It reaches the menu through the box the control fills
 * while it is mounted (`InboxPriorityMenuBox`), so with no menu on screen the
 * key does nothing.
 */
export function useInboxPriorityShortcut(
  item: InboxItem | null,
  detailState: InboxDetailState,
  can: (permission: Permission) => boolean,
) {
  const isAllowed = isTriageShortcutAllowed(item, detailState, can)
  const isPending = isHeaderCommandPending(detailState)
  const { priorityMenu } = detailState

  return useMemo(
    () => ({
      isAllowed,
      isPending,
      open: () => priorityMenu?.current?.(),
    }),
    [isAllowed, isPending, priorityMenu],
  )
}
