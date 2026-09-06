// Constructs the InboxServerFns bundle from raw server fn references.
// Routes are the sanctioned site for importing server fns (CONTEXT.md:55);
// components receive this bundle as a prop and never value-import server/.
//
// WHY GETTERS AND NOT AN OBJECT LITERAL. This bundle draws from three contexts,
// and the client build puts them in different chunks. Vite chunked the Activity
// and AI server fns into a chunk that imports this one AND is imported by it —
// a genuine two-way cycle. Under ESM one side of a cycle necessarily evaluates
// while the other is still uninitialized, and the bundler emits `var`, so a
// premature read yields `undefined` instead of throwing. An eager
// `{ getActivityTimeline: getActivityTimelineFn }` therefore froze `undefined`
// into the bundle for exactly the two members that came from the cycled chunk.
//
// The symptom was silent and remote: the inbox activity timeline rendered
// "Activity 0 events" and "Failed to load activity" with NO network request at
// all, because calling `undefined` throws inside the React Query `queryFn`
// before any fetch. Nothing failed at build time, typecheck was clean, and the
// server never saw a request to log. Reply suggestion had the same defect and
// simply had no test exercising it.
//
// A getter resolves the binding when the property is READ — after every module
// in the cycle has initialized — so chunking can never again decide whether
// this table holds functions or `undefined`. Do not "simplify" this back into
// an object literal.
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
  get getActivityTimeline() {
    return getActivityTimelineFn
  },
  get getInboxFolderCounts() {
    return getInboxFolderCountsFn
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
  get addInboxNote() {
    return addInboxNoteFn
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
  get generateReplySuggestion() {
    return generateReplySuggestionFn
  },
}
