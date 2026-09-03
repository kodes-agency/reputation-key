// Aggregated type of every server fn the InboxPageV2 subtree consumes.
//
// Routes construct this object and pass it as `inboxFns`; child components and
// hooks receive the relevant fn and wrap it with useServerFn/useActionMutation.
// This is the compliant prop channel per src/components/CONTEXT.md:55 —
// components never value-import from contexts/*/server. These imports are
// type-only (used in `typeof` positions), which the boundary gate allows.
//
// Note: getLastVisitCountFn is NOT here — InboxVisitBadge mounts in the global
// manager layout (routes/_authenticated.tsx), not via InboxPageV2. listProperties is
// also not here — PropertyFilterSelect consumes pre-loaded `properties` data instead.
import type {
  getInboxItemsFn,
  getInboxItemDetailFn,
  getInboxNotesFn,
  getInboxItemHistoryFn,
  getInboxFolderCountsFn,
  stampLastInboxViewFn,
  updateInboxStatusFn,
  escalateInboxItemFn,
  resolveEscalationFn,
  addInboxNoteFn,
  bulkUpdateInboxStatusFn,
  bulkAssignInboxItemsFn,
  markFeedbackHandledFn,
  correctFeedbackHandlingOutcomeFn,
} from '#/contexts/inbox/server/inbox'
import type { getActivityTimelineFn } from '#/contexts/activity/server/activity'
import type { generateReplySuggestionFn } from '#/contexts/ai/server/reply-suggestion'

export type InboxServerFns = Readonly<{
  getInboxItems: typeof getInboxItemsFn
  getInboxItemDetail: typeof getInboxItemDetailFn
  getInboxNotes: typeof getInboxNotesFn
  getInboxItemHistory: typeof getInboxItemHistoryFn
  getActivityTimeline: typeof getActivityTimelineFn
  getInboxFolderCounts: typeof getInboxFolderCountsFn
  stampLastInboxView: typeof stampLastInboxViewFn
  updateInboxStatus: typeof updateInboxStatusFn
  escalateInboxItem: typeof escalateInboxItemFn
  resolveEscalation: typeof resolveEscalationFn
  addInboxNote: typeof addInboxNoteFn
  bulkUpdateInboxStatus: typeof bulkUpdateInboxStatusFn
  bulkAssignInboxItems: typeof bulkAssignInboxItemsFn
  markFeedbackHandled: typeof markFeedbackHandledFn
  correctFeedbackHandlingOutcome: typeof correctFeedbackHandlingOutcomeFn
  generateReplySuggestion?: typeof generateReplySuggestionFn
}>

/** Functions consumed by the Inbox detail content subtree. */
export type InboxDetailFns = Pick<
  InboxServerFns,
  | 'getInboxItemDetail'
  | 'getActivityTimeline'
  | 'addInboxNote'
  | 'generateReplySuggestion'
>
