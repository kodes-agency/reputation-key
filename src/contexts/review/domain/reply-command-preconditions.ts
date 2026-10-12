// Review context — what each reply command may start from.
//
// REPLY_TRANSITIONS (rules.ts) says which status may follow which. It cannot say
// which command may make the move: `publish_failed → approved` is a retry and
// never an approval, and a reply that returns from `approved` to `draft` got
// there by a cancellation and never by a draft save. A command that trusted the
// table therefore accepted replies that belonged to a sibling command.
//
// Each command states its own start here, as the reply status and publication
// state it accepts. The use case reads the statement to refuse in words; the
// store reads the same statement and carries it as the compare-and-set of its
// write, so a second entry point, or a change between the read and the write,
// cannot get past it.

import { reviewError } from './errors'
import {
  nextPublicationState,
  type PersistedPublicationState,
  type PublicationStateInput,
} from './reply-publication-workflow'
import type { Reply, ReplyStatus } from './types'

export type ReplyCommand =
  /** Save draft and load template: rewrite the text of an unsubmitted reply. */
  | 'save_draft'
  | 'submit'
  /** Confirm & Publish. */
  | 'approve'
  | 'reject'
  /** Try publishing again. */
  | 'retry_publication'
  /** Edit a published reply and republish it. */
  | 'edit_published'
  | 'delete'
  /** Record a reply as published on provider confirmation. */
  | 'confirm_published'

/** The part of a reply a command's precondition reads. */
export type ReplyCommandSubject = Pick<
  Reply,
  'status' | 'publicationState' | 'publicationCycle' | 'publicationLastErrorClass'
>

type ReplyCommandStart = Readonly<{
  statuses: ReadonlyArray<ReplyStatus>
  publicationStates: ReadonlyArray<PublicationStateInput>
}>

/** No publication cycle is open: none was ever authorized, or the last one was
 * cancelled and the reply went back to draft. */
const NO_OPEN_PUBLICATION: ReadonlyArray<PublicationStateInput> = [null, 'cancelled']

/** A cycle whose write may have reached Google, or did and was not confirmed. */
const UNCONFIRMED_PUBLICATION: ReadonlyArray<PublicationStateInput> = [
  'sending',
  'pending_observation',
  'ambiguous',
  'terminal',
]

const REPLY_COMMAND_STARTS: Readonly<Record<ReplyCommand, ReplyCommandStart>> = {
  save_draft: { statuses: ['draft', 'rejected'], publicationStates: NO_OPEN_PUBLICATION },
  submit: { statuses: ['draft'], publicationStates: NO_OPEN_PUBLICATION },
  approve: { statuses: ['pending_approval'], publicationStates: NO_OPEN_PUBLICATION },
  reject: { statuses: ['pending_approval'], publicationStates: NO_OPEN_PUBLICATION },
  // Only a settled failure. An attempt of unknown outcome is first proved never
  // to have left RepKey, which settles it as `terminal` (Invariant 9).
  retry_publication: { statuses: ['publish_failed'], publicationStates: ['terminal'] },
  // NULL: a reply published before the publication state was recorded.
  edit_published: { statuses: ['published'], publicationStates: ['published', null] },
  delete: { statuses: ['draft', 'rejected'], publicationStates: [null] },
  confirm_published: {
    statuses: ['approved', 'publish_failed'],
    publicationStates: UNCONFIRMED_PUBLICATION,
  },
}

/** Terminal ambiguity: the automatic checks ended without learning whether
 * Google has the reply. It is `terminal`, and still not safe to send again. */
const endedWithoutAnAnswer = (reply: ReplyCommandSubject): boolean =>
  reply.publicationState === 'terminal' && reply.publicationLastErrorClass === 'ambiguous'

/** A reply that was ever authorized for publication has authorization, and
 * perhaps attempt, rows behind it. They are evidence and outlive the draft. */
export const hasPublicationRecord = (reply: ReplyCommandSubject): boolean =>
  reply.publicationCycle > 0 || reply.publicationState !== null

/** Whether `command` may start from this reply. */
export function replyCommandMayStart(
  command: ReplyCommand,
  reply: ReplyCommandSubject,
): boolean {
  const start = REPLY_COMMAND_STARTS[command]
  if (
    !start.statuses.includes(reply.status) ||
    !start.publicationStates.includes(reply.publicationState)
  ) {
    return false
  }
  if (command === 'retry_publication') return !endedWithoutAnAnswer(reply)
  if (command === 'delete') return !hasPublicationRecord(reply)
  return true
}

const REPLY_KEPT_WITH_ITS_RECORD =
  'This reply was confirmed for publishing before, so RepKey keeps it with its publication record. Edit it and submit it again, or leave it as a draft.'

const REPLY_COMMAND_REFUSALS: Readonly<Record<ReplyCommand, string>> = {
  save_draft: 'Only a draft or a rejected reply can be edited',
  submit: 'Only a draft can be submitted for approval',
  approve: 'Only a reply that is waiting for approval can be confirmed and published',
  reject: 'Only a reply that is waiting for approval can be rejected',
  retry_publication: 'Only a reply that failed to publish can be sent again',
  edit_published: 'Only a published reply can be edited and republished',
  delete: 'Can only delete draft or rejected replies',
  confirm_published: 'Only a reply sent to Google can be recorded as published',
}

/** Refuse, in the command's own words, a reply it may not start from. */
export function assertReplyCommandMayStart(
  command: ReplyCommand,
  reply: ReplyCommandSubject,
): void {
  if (replyCommandMayStart(command, reply)) return
  const keptForItsRecord =
    command === 'delete' &&
    REPLY_COMMAND_STARTS.delete.statuses.includes(reply.status) &&
    hasPublicationRecord(reply)
  throw reviewError(
    'invalid_transition',
    keptForItsRecord ? REPLY_KEPT_WITH_ITS_RECORD : REPLY_COMMAND_REFUSALS[command],
  )
}

/** What a cancelled publication leaves behind: a draft that must be submitted
 * and approved again before anything is published. */
export type CancelledPublication = Readonly<{
  status: Extract<ReplyStatus, 'draft'>
  publicationState: Extract<PersistedPublicationState, 'cancelled'>
}>

/**
 * The one way a reply goes from `approved` back to `draft`: its open
 * publication cycle is cancelled (a Google disconnect, a Property that left the
 * workspace, a manager who lost access). Null when the reply has no cycle a
 * cancellation can end. No reply command makes this move; `save_draft` in
 * particular refuses an approved reply.
 */
export function cancelledPublication(
  reply: Pick<Reply, 'publicationState'>,
): CancelledPublication | null {
  const publicationState = nextPublicationState(reply.publicationState, 'cancel')
  return publicationState === 'cancelled' ? { status: 'draft', publicationState } : null
}
