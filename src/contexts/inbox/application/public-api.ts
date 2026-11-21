import type { ResponseTargetStore } from '../../reputation/response-targets/store.port.server'
import type {
  UpdateInboxStatus,
  BulkUpdateInboxStatus,
} from '../../reputation/inbox/inbox-status-commands.server'
import type { BulkAssignInboxItems } from '../../reputation/inbox/bulk-assign-inbox-items.server'
import type { EscalateInboxItem } from '../../reputation/inbox/escalate-inbox-item.server'
import type { ResolveEscalation } from '../../reputation/inbox/resolve-escalation.server'
import type { SetInboxItemPriority } from '../../reputation/inbox/set-inbox-item-priority.server'
import type { AssignInboxItem } from '../../reputation/inbox/assign-inbox-item.server'
import type { GetInboxItems } from '../../reputation/inbox/get-inbox-items.server'
import type { AddInboxNote } from '../../reputation/inbox/add-inbox-note.server'
import type { GetLastVisitCount } from '../../reputation/inbox/get-last-visit-count.server'
import type { StampLastInboxView } from '../../reputation/inbox/stamp-last-inbox-view.server'
import type { GetInboxItemDetail } from '../../reputation/inbox/get-inbox-item-detail.server'
import type { CheckInboxReviewOnGoogle } from '../../reputation/inbox/check-inbox-review-on-google.server'
import type { GetInboxNotes } from '../../reputation/inbox/get-inbox-notes.server'
import type { GetInboxItemHistory } from '../../reputation/inbox/get-inbox-item-history.server'
import type { GetInboxQueueCounts } from '../../reputation/inbox/get-inbox-queue-counts.server'
import type { GetInboxPropertyCounts } from '../../reputation/inbox/get-inbox-property-counts.server'
import type { GetReviewInboxItemIds } from '../../reputation/inbox/get-review-inbox-item-ids.server'
import type { MarkFeedbackHandled } from '../../reputation/inbox/mark-feedback-handled.server'
import type { CorrectFeedbackHandlingOutcome } from '../../reputation/inbox/correct-feedback-handling-outcome.server'
import type {
  GetGoogleReviewTargetAnalytics,
  GetPrivateFeedbackTargetAnalytics,
  GetResponseTargetPolicySettings,
} from '../../reputation/response-targets/get-response-targets.server'
import type { SetResponseTargetPolicy } from '../../reputation/response-targets/set-response-target-policy.server'

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
  InboxItemReplyState,
  ReplyStatus,
  ReplyPublicationState,
  ReplyPublicationFailureClass,
} from '../../reputation/domain/inbox-types'
export type {
  FeedbackHandlingCommandResult,
  FeedbackHandlingState,
} from '../../reputation/inbox/feedback-handling-store.port.server'
export type {
  GoogleReviewTargetAnalytics,
  PrivateFeedbackTargetAnalytics,
  ResponseTargetView,
} from '../../reputation/response-targets/store.port.server'
export type {
  ResponseTargetPolicySettings,
  ResponseTargetPolicyWriteResult,
} from '../../reputation/response-targets/policy.store.port.server'
export {
  PRIVATE_FEEDBACK_HANDLING_OUTCOMES,
  type PrivateFeedbackHandlingOutcome,
} from '../../reputation/domain/feedback-handling'
export {
  INBOX_PRIORITY_LEVELS,
  effectiveInboxPriority,
  type EffectiveInboxPriority,
  type InboxPriority,
} from '../../reputation/domain/inbox-priority'
export {
  isInboxRevisionConflictResult,
  type InboxRevisionConflictResult,
} from '../../reputation/domain/inbox-errors'

// Application-layer detail result (includes the review reply) — used by the
// client detail state. See get-inbox-item-detail use case.
export type { InboxItemDetailResult } from '../../reputation/inbox/get-inbox-item-detail.server'
export type {
  CheckInboxReviewOnGoogleResult,
  InboxGoogleCheckOutcome,
} from '../../reputation/inbox/check-inbox-review-on-google.server'
export type { InboxNoteView } from '../../reputation/inbox/get-inbox-notes.server'
export type { InboxError } from '../../reputation/domain/inbox-errors'
export {
  INBOX_BULK_LIMIT,
  addInboxNoteFormDto,
  feedbackHandlingDecisionDto,
} from './dto/inbox.dto'
export type { GetInboxItemHistoryResult } from '../../reputation/inbox/get-inbox-item-history.server'
export type {
  Cursor,
  InboxSort,
} from '../../reputation/inbox/inbox-repository.port.server'
export { replyQueueStage, type InboxQueue } from './inbox-queues'
export type { InboxQueueCounts } from '../../reputation/inbox/get-inbox-queue-counts.server'
export type { InboxPropertyCounts } from '../../reputation/inbox/get-inbox-property-counts.server'
export type {
  InboxMentionCorrection,
  InboxMentionV3,
  InboxReviewAnalysis,
  ReviewAnalysisAspect,
  ReviewAspect,
  ReviewAspectPolarity,
} from '../../reputation/inbox/ai-review-insights.port.server'

/** Request-facing Inbox capabilities. Persistence and construction stay private. */
export type InboxPublicApi = Readonly<{
  updateInboxStatus: UpdateInboxStatus
  bulkUpdateInboxStatus: BulkUpdateInboxStatus
  bulkAssignInboxItems: BulkAssignInboxItems
  escalateInboxItem: EscalateInboxItem
  resolveEscalation: ResolveEscalation
  setInboxItemPriority: SetInboxItemPriority
  assignInboxItem: AssignInboxItem
  getInboxItems: GetInboxItems
  addInboxNote: AddInboxNote
  getLastVisitCount: GetLastVisitCount
  stampLastInboxView: StampLastInboxView
  getInboxItemDetail: GetInboxItemDetail
  checkInboxReviewOnGoogle: CheckInboxReviewOnGoogle
  getInboxNotes: GetInboxNotes
  getInboxItemHistory: GetInboxItemHistory
  getInboxQueueCounts: GetInboxQueueCounts
  getInboxPropertyCounts: GetInboxPropertyCounts
  getReviewInboxItemIds: GetReviewInboxItemIds
  markFeedbackHandled: MarkFeedbackHandled
  correctFeedbackHandlingOutcome: CorrectFeedbackHandlingOutcome
  getGoogleReviewTargetAnalytics: GetGoogleReviewTargetAnalytics
  getGoogleReviewTargetCountsByProperty: ResponseTargetStore['getGoogleReviewTargetCountsByProperty']
  getPrivateFeedbackTargetAnalytics: GetPrivateFeedbackTargetAnalytics
  getResponseTargetPolicySettings: GetResponseTargetPolicySettings
  setResponseTargetPolicy: SetResponseTargetPolicy
}>

// Event re-exports — cross-context consumers must import event types from public-api, not reputation/domain/inbox-events
export type {
  InboxItemCreated,
  InboxItemStatusChanged,
  InboxItemEscalated,
  InboxItemEscalationResolved,
  InboxItemPriorityChanged,
  InboxItemAssigned,
  InboxItemUnassigned,
  InboxNoteAdded,
  InboxItemBulkStatusChanged,
  InboxBulkAssignmentCompleted,
  InboxAssignmentsReleased,
  InboxBulkReopenCompleted,
  InboxHandlingCycleOpened,
  InboxHandlingCycleClosed,
  InboxHandlingCycleReopened,
  InboxResponseTargetReminderDue,
  InboxResponseTargetPolicyChanged,
  InboxEvent,
} from '../../reputation/domain/inbox-events'
