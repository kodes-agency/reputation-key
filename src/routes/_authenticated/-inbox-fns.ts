// Constructs the InboxServerFns bundle from raw server fn references.
// Routes are the sanctioned site for importing server fns (CONTEXT.md:55);
// components receive this bundle as a prop and never value-import server/.
import {
  getInboxItemsFn,
  getInboxItemDetailFn,
  getInboxNotesFn,
  getInboxFolderCountsFn,
  updateInboxStatusFn,
  escalateInboxItemFn,
  resolveEscalationFn,
  addInboxNoteFn,
  bulkUpdateInboxStatusFn,
} from '#/contexts/inbox/server/inbox'
import { getActivityTimelineFn } from '#/contexts/activity/server/activity'
import type { InboxServerFns } from '#/components/inbox/types'

export const inboxFns: InboxServerFns = {
  getInboxItems: getInboxItemsFn,
  getInboxItemDetail: getInboxItemDetailFn,
  getInboxNotes: getInboxNotesFn,
  getActivityTimeline: getActivityTimelineFn,
  getInboxFolderCounts: getInboxFolderCountsFn,
  updateInboxStatus: updateInboxStatusFn,
  escalateInboxItem: escalateInboxItemFn,
  resolveEscalation: resolveEscalationFn,
  addInboxNote: addInboxNoteFn,
  bulkUpdateInboxStatus: bulkUpdateInboxStatusFn,
}
