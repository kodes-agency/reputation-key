// Aggregated type of every server fn the InboxPageV2 subtree consumes.
//
// Routes construct this object and pass it as `inboxFns`; child components and
// hooks receive the relevant fn and wrap it with useServerFn/useActionMutation.
// This is the compliant prop channel per src/components/CONTEXT.md "Server-function boundary" —
// components never value-import from contexts/*/server. These imports are
// type-only (used in `typeof` positions), which the boundary gate allows.
//
// Note: getLastVisitCountFn is NOT here — InboxVisitBadge mounts in the global
// manager layout (routes/_authenticated.tsx), not via InboxPageV2. Property scope
// options are likewise route data, not an inbox server-function dependency.
import type {
  getInboxItemsFn,
  getInboxItemDetailFn,
  getInboxNotesFn,
  getInboxItemHistoryFn,
  getInboxQueueCountsFn,
  stampLastInboxViewFn,
  updateInboxStatusFn,
  escalateInboxItemFn,
  resolveEscalationFn,
  addInboxNoteFn,
  assignInboxItemFn,
  bulkUpdateInboxStatusFn,
  bulkAssignInboxItemsFn,
  markFeedbackHandledFn,
  correctFeedbackHandlingOutcomeFn,
} from '#/contexts/inbox/server/inbox'
import type { getActivityTimelineFn } from '#/contexts/feed/server/activity'
import type { generateReplySuggestionFn } from '#/contexts/ai/server/reply-suggestion'
import type { requestReviewAnalysisNowFn } from '#/contexts/ai/server/review-analysis'

export type InboxServerFns = Readonly<{
  getInboxItems: typeof getInboxItemsFn
  getInboxItemDetail: typeof getInboxItemDetailFn
  getInboxNotes: typeof getInboxNotesFn
  getInboxItemHistory: typeof getInboxItemHistoryFn
  getActivityTimeline: typeof getActivityTimelineFn
  getInboxQueueCounts: typeof getInboxQueueCountsFn
  stampLastInboxView: typeof stampLastInboxViewFn
  updateInboxStatus: typeof updateInboxStatusFn
  escalateInboxItem: typeof escalateInboxItemFn
  resolveEscalation: typeof resolveEscalationFn
  addInboxNote: typeof addInboxNoteFn
  assignInboxItem: typeof assignInboxItemFn
  bulkUpdateInboxStatus: typeof bulkUpdateInboxStatusFn
  bulkAssignInboxItems: typeof bulkAssignInboxItemsFn
  markFeedbackHandled: typeof markFeedbackHandledFn
  correctFeedbackHandlingOutcome: typeof correctFeedbackHandlingOutcomeFn
  generateReplySuggestion?: typeof generateReplySuggestionFn
  requestReviewAnalysisNow?: typeof requestReviewAnalysisNowFn
}>

/** Functions consumed by the Inbox detail content subtree. */
export type InboxDetailFns = Pick<
  InboxServerFns,
  | 'getInboxItemDetail'
  | 'getInboxItemHistory'
  | 'getActivityTimeline'
  | 'addInboxNote'
  | 'generateReplySuggestion'
  | 'requestReviewAnalysisNow'
>
