import {
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
import type { InboxServerFns } from '#/components/inbox/types'
import { requestReviewAnalysisNowFn } from '#/contexts/ai/server/review-analysis'
import { generateReplySuggestionFn } from '#/contexts/ai/server/reply-suggestion'
import { getPortalPresence } from '#/contexts/portal/server/portal-presence'
import { correctReviewMentionFn } from '#/contexts/ai/server/review-mention-correction'

export const inboxFns: InboxServerFns = {
  getInboxItems: getInboxItemsFn,
  getInboxItemDetail: getInboxItemDetailFn,
  getInboxNotes: getInboxNotesFn,
  getInboxItemHistory: getInboxItemHistoryFn,
  getInboxQueueCounts: getInboxQueueCountsFn,
  getInboxPropertyCounts: getInboxPropertyCountsFn,
  stampLastInboxView: stampLastInboxViewFn,
  updateInboxStatus: updateInboxStatusFn,
  escalateInboxItem: escalateInboxItemFn,
  resolveEscalation: resolveEscalationFn,
  setInboxItemPriority: setInboxItemPriorityFn,
  addInboxNote: addInboxNoteFn,
  assignInboxItem: assignInboxItemFn,
  bulkUpdateInboxStatus: bulkUpdateInboxStatusFn,
  bulkAssignInboxItems: bulkAssignInboxItemsFn,
  markFeedbackHandled: markFeedbackHandledFn,
  correctFeedbackHandlingOutcome: correctFeedbackHandlingOutcomeFn,
  checkReviewOnGoogle: checkReviewOnGoogleFn,
  generateReplySuggestion: generateReplySuggestionFn,
  requestReviewAnalysisNow: requestReviewAnalysisNowFn,
  correctReviewMention: correctReviewMentionFn,
  getPortalPresence,
}
