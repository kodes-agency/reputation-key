// Aggregated type of every server fn the InboxPageV2 subtree consumes.
//
// Routes construct this object and pass it as `inboxFns`; child components and
// hooks receive the relevant fn and wrap it with useServerFn/useActionMutation.
// This is the compliant prop channel per src/components/CONTEXT.md "Server-function boundary" —
// components never value-import from contexts/*/server. These imports are
// type-only (used in `typeof` positions), which the boundary gate allows.
//
// Note: getLastVisitCountFn is NOT here — InboxVisitBadge mounts in the global
// manager layout (routes/_authenticated.tsx), not via InboxPageV2. The property
// list is likewise route data; only its per-queue counts are read from here.
import type {
  getInboxItemsFn,
  getInboxItemDetailFn,
  getInboxNotesFn,
  getInboxItemHistoryFn,
  getInboxQueueCountsFn,
  getInboxPropertyCountsFn,
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
  checkReviewOnGoogleFn,
  setInboxItemPriorityFn,
} from '#/contexts/inbox/server/inbox'
import type { getActivityTimelineFn } from '#/contexts/feed/server/activity'
import type { generateReplySuggestionFn } from '#/contexts/ai/server/reply-suggestion'
import type { requestReviewAnalysisNowFn } from '#/contexts/ai/server/review-analysis'

type ServerCall<T> = T extends (...args: infer Args) => infer Result
  ? (...args: Args) => Result
  : never

export type GenerateReplySuggestionCall = ServerCall<typeof generateReplySuggestionFn>

export type InboxServerFns = Readonly<{
  getInboxItems: typeof getInboxItemsFn
  getInboxItemDetail: typeof getInboxItemDetailFn
  getInboxNotes: typeof getInboxNotesFn
  getInboxItemHistory: typeof getInboxItemHistoryFn
  getActivityTimeline: typeof getActivityTimelineFn
  getInboxQueueCounts: typeof getInboxQueueCountsFn
  getInboxPropertyCounts: typeof getInboxPropertyCountsFn
  stampLastInboxView: typeof stampLastInboxViewFn
  updateInboxStatus: typeof updateInboxStatusFn
  escalateInboxItem: typeof escalateInboxItemFn
  resolveEscalation: typeof resolveEscalationFn
  setInboxItemPriority: typeof setInboxItemPriorityFn
  addInboxNote: typeof addInboxNoteFn
  assignInboxItem: typeof assignInboxItemFn
  bulkUpdateInboxStatus: typeof bulkUpdateInboxStatusFn
  bulkAssignInboxItems: typeof bulkAssignInboxItemsFn
  markFeedbackHandled: typeof markFeedbackHandledFn
  correctFeedbackHandlingOutcome: typeof correctFeedbackHandlingOutcomeFn
  /** Absent where there is no Google to read (the action is then not offered). */
  checkReviewOnGoogle?: typeof checkReviewOnGoogleFn
  generateReplySuggestion?: GenerateReplySuggestionCall
  requestReviewAnalysisNow?: typeof requestReviewAnalysisNowFn
  /**
   * Whether a scope has a Portal: the empty To handle queue offers a feedback
   * page only where there is none. A plain function, not a server function's
   * type, because the route fetches the server function with its first use
   * (`routes/_authenticated/-inbox-fns.ts` says why).
   */
  getPortalPresence?: (
    input: Readonly<{ data: { propertyId?: string } }>,
  ) => Promise<PortalPresence>
}>

/** The answer to "does this scope have a Portal?": a yes or a no, nothing of any Portal. */
export type PortalPresence = Readonly<{ hasPortal: boolean }>

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
