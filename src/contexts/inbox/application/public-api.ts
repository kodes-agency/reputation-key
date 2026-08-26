/**
 * Public API for external consumers (components, routes).
 * Re-exports domain types. Per boundary rules: components may import
 * from `application/` but NOT from `domain/`.
 */
export type {
  InboxItem,
  InboxNote,
  InboxItemDetail,
  InboxStatus,
  SourceType,
  ReviewHandlingCycle,
  ReviewHandlingCycleHead,
  ReviewHandlingCycleOpenReason,
} from '../domain/types'
export type {
  ReviewHandlingCycleExpectation,
  ReviewHandlingCycleResult,
} from './ports/review-handling-cycle.store'

// Application-layer detail result (includes the review reply) — used by the
// client detail state. See get-inbox-item-detail use case.
export type { InboxItemDetailResult } from './use-cases/get-inbox-item-detail'
export type { InboxError, InboxErrorCode } from '../domain/errors'
export { isInboxError } from '../domain/errors'
export { INBOX_BULK_LIMIT } from './dto/inbox.dto'
export type { Cursor, InboxSort } from './ports/inbox.repository'
export type {
  InboxReviewAnalysis,
  ReviewAttention,
  ReviewCategory,
} from './ports/ai-review-insights.port'

// Event re-exports — cross-context consumers must import event types from public-api, not domain/events
export type {
  InboxItemCreated,
  InboxItemStatusChanged,
  InboxItemEscalated,
  InboxItemEscalationResolved,
  InboxItemAssigned,
  InboxItemUnassigned,
  InboxNoteAdded,
  InboxItemBulkStatusChanged,
  InboxEvent,
} from '../domain/events'
