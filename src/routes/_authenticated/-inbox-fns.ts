// Constructs the InboxServerFns bundle from raw server fn references.
// Routes are the sanctioned import site; see src/routes/CONTEXT.md "Server-function bundles and mutations".
// components receive this bundle as a prop and never value-import server/.
//
// Getters resolve server-function bindings after module initialization, so a
// client chunk cycle cannot freeze an uninitialized function into the bundle.
// Do not turn this back into an object literal.
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

const generateReplySuggestionLazily: NonNullable<
  InboxServerFns['generateReplySuggestion']
> = async (input) =>
  (await import('#/contexts/ai/server/reply-suggestion')).generateReplySuggestionFn(input)

// Fetched with its first use, not imported. Only the empty To handle queue asks,
// and a server-function module that two entries share is grouped with the stubs
// first paint already loads (vite.config.ts, `app-server-fns`, merged under 16
// KiB): measured on 2026-10-28, this one stub put 51 B gzip into the first-paint
// closure. A module reached only by its own dynamic import is shared by nothing,
// so it stays a chunk of its own (the same reason as
// `properties/$propertyId/goals/-rating-goal-queries.ts`).
const readPortalPresence: NonNullable<InboxServerFns['getPortalPresence']> = async (
  input,
) => (await import('#/contexts/portal/server/portal-presence')).getPortalPresence(input)

// Fetched with its first use too: only the "Not right?" dialog calls it, and a
// server-function stub imported here is a stub in the first-paint closure.
const correctReviewMention: NonNullable<InboxServerFns['correctReviewMention']> = async (
  input,
) =>
  (await import('#/contexts/ai/server/review-mention-correction')).correctReviewMentionFn(
    input,
  )

export const inboxFns: InboxServerFns = {
  get getInboxItems() {
    return getInboxItemsFn
  },
  get getInboxItemDetail() {
    return getInboxItemDetailFn
  },
  get getInboxNotes() {
    return getInboxNotesFn
  },
  get getInboxItemHistory() {
    return getInboxItemHistoryFn
  },
  get getInboxQueueCounts() {
    return getInboxQueueCountsFn
  },
  get getInboxPropertyCounts() {
    return getInboxPropertyCountsFn
  },
  get stampLastInboxView() {
    return stampLastInboxViewFn
  },
  get updateInboxStatus() {
    return updateInboxStatusFn
  },
  get escalateInboxItem() {
    return escalateInboxItemFn
  },
  get resolveEscalation() {
    return resolveEscalationFn
  },
  get setInboxItemPriority() {
    return setInboxItemPriorityFn
  },
  get addInboxNote() {
    return addInboxNoteFn
  },
  get assignInboxItem() {
    return assignInboxItemFn
  },
  get bulkUpdateInboxStatus() {
    return bulkUpdateInboxStatusFn
  },
  get bulkAssignInboxItems() {
    return bulkAssignInboxItemsFn
  },
  get markFeedbackHandled() {
    return markFeedbackHandledFn
  },
  get correctFeedbackHandlingOutcome() {
    return correctFeedbackHandlingOutcomeFn
  },
  get checkReviewOnGoogle() {
    return checkReviewOnGoogleFn
  },
  get generateReplySuggestion() {
    return generateReplySuggestionLazily
  },
  get requestReviewAnalysisNow() {
    return requestReviewAnalysisNowFn
  },
  get correctReviewMention() {
    return correctReviewMention
  },
  get getPortalPresence() {
    return readPortalPresence
  },
}
