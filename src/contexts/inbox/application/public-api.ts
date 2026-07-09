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
} from '../domain/types'

// Application-layer detail result (includes the review reply) — used by the
// client detail state. See get-inbox-item-detail use case.
export type { InboxItemDetailResult } from './use-cases/get-inbox-item-detail'
export type { InboxError, InboxErrorCode } from '../domain/errors'
export { isInboxError } from '../domain/errors'
export type { Cursor } from './ports/inbox.repository'

// Event re-exports — cross-context consumers must import event types from public-api, not domain/events
export type {
  InboxItemCreated,
  InboxItemStatusChanged,
  InboxItemAssigned,
  InboxItemUnassigned,
  InboxItemEscalated,
  InboxNoteAdded,
  InboxItemBulkStatusChanged,
  InboxEvent,
} from '../domain/events'
