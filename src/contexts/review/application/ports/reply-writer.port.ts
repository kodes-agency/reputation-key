import type { Tx } from '#/shared/outbox/commit'
import type { ReplyCommand } from '../../domain/reply-command-preconditions'
import type {
  PersistedPublicationState,
  PublicationFailureClass,
} from '../../domain/reply-publication-workflow'
import type { Reply } from '../../domain/types'
import type { ReplyCommandStore } from './reply-command-store.port'
import type { ConditionalReplyUpdate, ReplyRepository } from './reply.repository'

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
export type ReplyWriter = Readonly<{
  drafts: Pick<
    ReplyRepository,
    'upsert' | 'createDraft' | 'saveDraft' | 'deleteDraft' | 'deleteByReviewIdAndSource'
  >
  lockReplyReview(
    tx: Tx,
    organizationId: Reply['organizationId'],
    reviewId: Reply['reviewId'],
  ): Promise<void>
  aiTextMayBeClaimed(tx: Tx, reply: Reply): Promise<boolean>
  guardedReplyUpdate(
    tx: Tx,
    reply: Reply,
    command: ReplyCommand,
    updates: ConditionalReplyUpdate,
    occurredAt: Date,
  ): Promise<Reply | null>
  guardedPublicationUpdate(
    run: Tx,
    reply: Reply,
    expectedStatus: Reply['status'],
    allowedStates: ReadonlyArray<PersistedPublicationState>,
    set: Record<string, unknown>,
  ): Promise<Reply | null>
  updateCurrentAttempt(
    tx: Tx,
    reply: Reply,
    set: Record<string, unknown>,
    fromOutcomes?: ReadonlyArray<string>,
  ): Promise<void>
  submitMeasuredReply(
    ...args: Parameters<ReplyCommandStore['submitReply']>
  ): Promise<Reply | null>
  casUncertainAttempt(
    run: Tx,
    reply: Reply,
    snapshot: UncertainSendSnapshot,
    set: Record<string, unknown>,
  ): Promise<Reply | null>
  lockUncertainAttempt(
    tx: Tx,
    reply: Reply,
    snapshot: UncertainSendSnapshot,
  ): Promise<Readonly<{ startedAt: Date }> | null>
}>
