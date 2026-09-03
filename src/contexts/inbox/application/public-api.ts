import type { ResponseTargetStore } from './ports/response-target.store'

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
  ManualReopenReason,
} from '../domain/types'
export type {
  FeedbackHandlingCommandResult,
  FeedbackHandlingState,
} from './ports/feedback-handling.store'
export type {
  GoogleReviewTargetAnalytics,
  PrivateFeedbackTargetAnalytics,
  ResponseTargetView,
} from './ports/response-target.store'
export type {
  ResponseTargetPolicySettings,
  ResponseTargetPolicyWriteResult,
} from './ports/response-target-policy.store'
export {
  PRIVATE_FEEDBACK_HANDLING_OUTCOMES,
  type PrivateFeedbackHandlingOutcome,
} from '../domain/feedback-handling'
// The manager-facing conflict message. Components match rejected mutations on
// it because the client cannot read `code` off a deserialized server-function
// error; keeping the literal here gives it one authority.
export { REVISION_CONFLICT_MESSAGE } from '../domain/errors'

// IBX-01 cutover classification. Pure and read-only: it reports what the legacy
// rows prove and never infers an outcome or an on-time result from `closedAt`.
export { canonicalInboxHandlingCutoverReport } from './inbox-handling-cutover'

// Application-layer detail result (includes the review reply) — used by the
// client detail state. See get-inbox-item-detail use case.
export type { InboxItemDetailResult } from './use-cases/get-inbox-item-detail'
export type { InboxNoteView } from './use-cases/get-inbox-notes'
export type { InboxError } from '../domain/errors'
export { INBOX_BULK_LIMIT } from './dto/inbox.dto'
export type { Cursor, InboxSort } from './ports/inbox.repository'
export type { InboxReviewAnalysis, ReviewCategory } from './ports/ai-review-insights.port'

/** Request-facing Inbox capabilities. Persistence and construction stay private. */
export type InboxPublicApi = Readonly<{
  updateInboxStatus: import('./use-cases/update-inbox-status').UpdateInboxStatus
  bulkUpdateInboxStatus: import('./use-cases/bulk-update-inbox-status').BulkUpdateInboxStatus
  bulkAssignInboxItems: import('./use-cases/bulk-assign-inbox-items').BulkAssignInboxItems
  escalateInboxItem: import('./use-cases/escalate-inbox-item').EscalateInboxItem
  resolveEscalation: import('./use-cases/resolve-escalation').ResolveEscalation
  assignInboxItem: import('./use-cases/assign-inbox-item').AssignInboxItem
  getInboxItems: import('./use-cases/get-inbox-items').GetInboxItems
  addInboxNote: import('./use-cases/add-inbox-note').AddInboxNote
  getLastVisitCount: import('./use-cases/get-last-visit-count').GetLastVisitCount
  stampLastInboxView: import('./use-cases/stamp-last-inbox-view').StampLastInboxView
  getInboxItemDetail: import('./use-cases/get-inbox-item-detail').GetInboxItemDetail
  getInboxNotes: import('./use-cases/get-inbox-notes').GetInboxNotes
  getInboxItemHistory: import('./use-cases/get-inbox-item-history').GetInboxItemHistory
  getInboxFolderCounts: import('./use-cases/get-folder-counts').GetInboxFolderCounts
  markFeedbackHandled: import('./use-cases/mark-feedback-handled').MarkFeedbackHandled
  correctFeedbackHandlingOutcome: import('./use-cases/correct-feedback-handling-outcome').CorrectFeedbackHandlingOutcome
  getGoogleReviewTargetAnalytics: import('./use-cases/get-response-targets').GetGoogleReviewTargetAnalytics
  getGoogleReviewTargetCountsByProperty: ResponseTargetStore['getGoogleReviewTargetCountsByProperty']
  getPrivateFeedbackTargetAnalytics: import('./use-cases/get-response-targets').GetPrivateFeedbackTargetAnalytics
  getResponseTargetPolicySettings: import('./use-cases/get-response-targets').GetResponseTargetPolicySettings
  setResponseTargetPolicy: import('./use-cases/set-response-target-policy').SetResponseTargetPolicy
}>

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
  InboxBulkAssignmentCompleted,
  InboxHandlingCycleOpened,
  InboxHandlingCycleClosed,
  InboxHandlingCycleReopened,
  InboxResponseTargetReminderDue,
  InboxResponseTargetPolicyChanged,
  InboxEvent,
} from '../domain/events'
