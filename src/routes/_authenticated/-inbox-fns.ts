// Constructs the InboxServerFns bundle from raw server fn references.
// Routes are the sanctioned site for importing server fns (CONTEXT.md:55);
// components receive this bundle as a prop and never value-import server/.
import {
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
import { getActivityTimelineFn } from '#/contexts/activity/server/activity'
import type { InboxServerFns } from '#/components/inbox/types'
import { generateReplySuggestionFn } from '#/contexts/ai/server/reply-suggestion'

export const inboxFns: InboxServerFns = {
  getInboxItems: getInboxItemsFn,
  getInboxItemDetail: getInboxItemDetailFn,
  getInboxNotes: getInboxNotesFn,
  getInboxItemHistory: getInboxItemHistoryFn,
  getActivityTimeline: getActivityTimelineFn,
  getInboxFolderCounts: getInboxFolderCountsFn,
  stampLastInboxView: stampLastInboxViewFn,
  updateInboxStatus: updateInboxStatusFn,
  escalateInboxItem: escalateInboxItemFn,
  resolveEscalation: resolveEscalationFn,
  addInboxNote: addInboxNoteFn,
  bulkUpdateInboxStatus: bulkUpdateInboxStatusFn,
  bulkAssignInboxItems: bulkAssignInboxItemsFn,
  markFeedbackHandled: markFeedbackHandledFn,
  correctFeedbackHandlingOutcome: correctFeedbackHandlingOutcomeFn,
  generateReplySuggestion: generateReplySuggestionFn,
}
