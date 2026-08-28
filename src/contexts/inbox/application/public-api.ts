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
  ManualReopenReason,
} from '../domain/types'
export type {
  ReviewHandlingCycleExpectation,
  ReviewHandlingCycleResult,
} from './ports/review-handling-cycle.store'
export type {
  FeedbackHandlingCommandResult,
  FeedbackHandlingCorrectionExpectation,
  FeedbackHandlingExpectation,
  FeedbackHandlingState,
} from './ports/feedback-handling.store'
export type {
  GoogleReviewTargetAnalytics,
  PrivateFeedbackTargetAnalytics,
  ResponseTargetView,
} from './ports/response-target.store'
export type {
  ResponseTargetPolicyStore,
  ResponseTargetPolicySettings,
  ResponseTargetPolicyWriteResult,
} from './ports/response-target-policy.store'
export type {
  ResponseTargetEligibility,
  ResponseTargetEvaluation,
  ResponseTargetKind,
  ResponseTargetPolicySource,
  ResponseTargetReminderKind,
  ResponseTargetResult,
} from '../domain/response-target'
export {
  PRIVATE_FEEDBACK_HANDLING_OUTCOMES,
  type FeedbackHandlingDeadlineResult,
  type FeedbackHandlingOutcomeFact,
  type PrivateFeedbackHandlingOutcome,
} from '../domain/feedback-handling'

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
  getInboxFolderCounts: import('./use-cases/get-folder-counts').GetInboxFolderCounts
  markFeedbackHandled: import('./use-cases/mark-feedback-handled').MarkFeedbackHandled
  correctFeedbackHandlingOutcome: import('./use-cases/correct-feedback-handling-outcome').CorrectFeedbackHandlingOutcome
  getGoogleReviewTargetAnalytics: import('./use-cases/get-response-targets').GetGoogleReviewTargetAnalytics
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
  InboxBulkAssignmentTransition,
  InboxBulkAssignmentCompleted,
  InboxHandlingCycleOpened,
  InboxHandlingCycleClosed,
  InboxHandlingCycleReopened,
  InboxResponseTargetReminderDue,
  InboxResponseTargetPolicyChanged,
  InboxEvent,
} from '../domain/events'
