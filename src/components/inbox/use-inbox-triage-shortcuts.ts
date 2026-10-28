import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { Permission } from '#/shared/domain/permissions'
import { useInboxEscalationShortcut } from './use-inbox-escalation-shortcut'
import { useInboxPriorityShortcut } from './use-inbox-priority-shortcut'
import type { InboxDetailState } from './use-inbox-detail'

/**
 * The two triage keys on the open item, `e` (escalate) and `p` (priority). They
 * share one gate (`isTriageShortcutAllowed`) and one pending test, so the page
 * controller takes them as a pair: a hook apiece pushed `useInboxPage` over the
 * complexity ceiling the audit holds it to.
 */
export function useInboxTriageShortcuts(
  item: InboxItem | null,
  detailState: InboxDetailState,
  can: (permission: Permission) => boolean,
) {
  return {
    escalation: useInboxEscalationShortcut(item, detailState, can),
    priority: useInboxPriorityShortcut(item, detailState, can),
  }
}
