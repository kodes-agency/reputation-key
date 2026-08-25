// Inbox context — barrel re-export
export {
  getInboxItemsFn,
  getLastVisitCountFn,
  stampLastInboxViewFn,
  getInboxFolderCountsFn,
} from './inbox-queries'
export {
  updateInboxStatusFn,
  bulkUpdateInboxStatusFn,
  escalateInboxItemFn,
  resolveEscalationFn,
} from './inbox-status'
export { addInboxNoteFn } from './inbox-item-actions'
export { getInboxItemDetailFn, getInboxNotesFn } from './inbox-item-queries'
