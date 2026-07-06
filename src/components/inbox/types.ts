// Aggregated type of every server fn the InboxPageV2 subtree consumes.
//
// Routes construct this object and pass it as `inboxFns`; child components and
// hooks receive the relevant fn and wrap it with useServerFn/useMutationAction.
// This is the compliant prop channel per src/components/CONTEXT.md:55 —
// components never value-import from contexts/*/server. These imports are
// type-only (used in `typeof` positions), which the boundary gate allows.
//
// Note: getNewCountFn is NOT here — InboxNewBadge mounts in the global manager
// layout (routes/_authenticated.tsx), not via InboxPageV2. listProperties is also
// not here — PropertyFilterSelect consumes pre-loaded `properties` data instead.
import type {
  getInboxItemsFn,
  getInboxItemDetailFn,
  getInboxNotesFn,
  getInboxFolderCountsFn,
  updateInboxStatusFn,
  addInboxNoteFn,
  bulkUpdateInboxStatusFn,
} from '#/contexts/inbox/server/inbox'
import type { getActivityTimelineFn } from '#/contexts/activity/server/activity'
import type { getReplyFn } from '#/contexts/review/server/reply'

export type InboxServerFns = Readonly<{
  getInboxItems: typeof getInboxItemsFn
  getInboxItemDetail: typeof getInboxItemDetailFn
  getInboxNotes: typeof getInboxNotesFn
  getActivityTimeline: typeof getActivityTimelineFn
  getInboxFolderCounts: typeof getInboxFolderCountsFn
  updateInboxStatus: typeof updateInboxStatusFn
  addInboxNote: typeof addInboxNoteFn
  getReply: typeof getReplyFn
  bulkUpdateInboxStatus: typeof bulkUpdateInboxStatusFn
}>

/** The 3 fns the inbox detail content subtree consumes (timeline, notes, reply). */
export type InboxDetailFns = Pick<
  InboxServerFns,
  'getActivityTimeline' | 'addInboxNote' | 'getReply'
>
