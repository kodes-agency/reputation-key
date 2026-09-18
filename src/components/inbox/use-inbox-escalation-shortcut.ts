import { useMemo } from 'react'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { Permission } from '#/shared/domain/permissions'
import { isHeaderCommandPending } from './inbox-header-command-pending'
import { isCaseToolbarShown, itemCommandFence } from './inbox-case-toolbar-props'
import { INBOX_SOURCE_HANDLE_PERMISSION } from './inbox-owner-control'
import type { InboxDetailState } from './use-inbox-detail'

type CanPermission = (permission: Permission) => boolean

type EscalationCommands = Pick<InboxDetailState, 'escalate' | 'resolveEscalation'>

/**
 * The two commands `e` can issue, bound to the item's revision fence. Hook-free
 * so the node unit project can call them without rendering the hook.
 *
 * Each is `.catch`ed, as the toolbar's are (`buildInboxCaseToolbarProps`): an
 * `Action` is `mutateAsync` and rejects on refusal, and a keypress has nowhere
 * to put the promise, so a bare `void` left every refused press an unhandled
 * rejection. What TELLS the manager is the `errorMessage` toast these commands
 * carry in `use-inbox-detail.ts`.
 */
export function bindEscalationShortcutCommands(
  item: InboxItem | null,
  { escalate, resolveEscalation }: EscalationCommands,
) {
  return {
    escalate: () => {
      if (!item) return
      void escalate({ data: itemCommandFence(item) }).catch(() => undefined)
    },
    resolveEscalation: () => {
      if (!item) return
      void resolveEscalation({ data: itemCommandFence(item) }).catch(() => undefined)
    },
  }
}

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
      ...bindEscalationShortcutCommands(item, { escalate, resolveEscalation }),
    }),
    [isAllowed, isPending, item, escalate, resolveEscalation],
  )
}
