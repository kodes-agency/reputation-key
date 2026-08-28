// Inbox context — Handling History read port (IBX-01-T5).
//
// Inbox owns this read. Recent Activity is a convenience feed and is never
// evidence that an Inbox command committed, so the manager-facing history is
// assembled from Inbox's own append-only tables and nothing else.

import type { InboxItemId, OrganizationId } from '#/shared/domain/ids'
import type { InboxHistoryEntry } from '../../domain/handling-history'

/**
 * Per-source row cap. Every underlying query carries this as an explicit LIMIT
 * so a pathological item can never return an unbounded result set into a
 * request path. `truncated` tells the caller the story is incomplete instead of
 * quietly pretending it is whole.
 */
export const INBOX_HISTORY_SOURCE_LIMIT = 200

export type InboxHistoryPage = Readonly<{
  entries: readonly InboxHistoryEntry[]
  truncated: boolean
}>

export type InboxHistoryRepository = Readonly<{
  /**
   * One ordered stream merged from `inbox_handling_cycles`,
   * `inbox_handling_cycle_transitions`, `inbox_assignment_history`,
   * `inbox_escalation_history` and `inbox_feedback_handling_outcomes`.
   *
   * Every entry is returned with its raw manager-internal note included; the
   * use case, which is the only place that knows the caller's current
   * permissions, decides whether that field survives to the response.
   */
  findByInboxItemId(
    input: Readonly<{
      inboxItemId: InboxItemId
      organizationId: OrganizationId
      limit?: number
    }>,
  ): Promise<InboxHistoryPage>
}>
