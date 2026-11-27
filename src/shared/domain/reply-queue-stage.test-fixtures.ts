/** Every persisted reply status (`replyStatusEnum`), for exhaustive tests. */
export const REPLY_QUEUE_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'published',
  'rejected',
  'publish_failed',
] as const

/** Every persisted publication state (`replies_publication_state_check`). */
export const REPLY_QUEUE_PUBLICATION_STATES = [
  'requested',
  'authorized',
  'sending',
  'pending_observation',
  'published',
  'terminal',
  'ambiguous',
  'cancelled',
] as const
