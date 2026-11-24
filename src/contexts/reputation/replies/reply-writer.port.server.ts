import type {
  PersistedPublicationState,
  PublicationFailureClass,
} from '../domain/reply-publication-workflow'
import type { Reply } from '../domain/review-types'
import type { createReplyWriter } from './store.server'

/** Outcomes an uncertain attempt row can still carry. */
export const UNCERTAIN_ATTEMPT_OUTCOMES = ['sending', 'ambiguous'] as const

/** A (status, publication_state[, last error class]) an uncertain-send command
 * may start from. */
export type UncertainSendSnapshot = Readonly<{
  status: Reply['status']
  publicationState: PersistedPublicationState
  lastErrorClass?: PublicationFailureClass
}>

/**
 * The only writer of Reply rows. Every method locks the Review before any of
 * its Replies, inside the caller's transaction where it takes one.
 */
export type ReplyWriter = ReturnType<typeof createReplyWriter>
