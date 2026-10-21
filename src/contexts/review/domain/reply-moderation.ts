// What Google says about moderating an owner reply, as RepKey records it.
//
// Google's v4 reference documents `reviewReplyState` (PENDING | REJECTED |
// APPROVED, plus UNSPECIFIED) and `policyViolation` (set only when REJECTED) on
// a review reply. It does NOT document what `comment` and `updateTime` hold
// while a reply is PENDING or REJECTED, or how an edit of an approved reply
// behaves. So this module only names and reports what a read showed; nothing
// here decides anything. No observation, confirmation, Inbox or metric rule
// reads it yet (a later decision, designed from the recorded reads).
//
// Content-free by construction: a state, a presence flag and an opaque policy
// code, never reply text.

import { compareObservedGoogleReply } from './google-reply-observation'

/**
 * `absent`: Google sent no `reviewReplyState` (no reply, or a reply without
 * it). `unspecified`: Google sent `REVIEW_REPLY_STATE_UNSPECIFIED`, or a value
 * RepKey does not know.
 */
export type ReplyModerationState =
  'pending' | 'approved' | 'rejected' | 'unspecified' | 'absent'

export type ReplyModeration = Readonly<{
  state: ReplyModerationState
  /**
   * Google's `policyViolation` enum word, opaque to RepKey. Set only when the
   * state is `rejected`; `UNKNOWN` when Google sent something that is not an
   * enum word; null when it sent nothing.
   */
  policyViolation: string | null
  /** Google sent a non-empty `comment` on the reply. */
  commentPresent: boolean
  /** Google sent `comment` as an empty string (not present, not missing). */
  commentEmpty: boolean
  /** Google sent a non-empty `updateTime` on the reply. */
  updateTimePresent: boolean
  /** Google sent `updateTime` as an empty string. */
  updateTimeEmpty: boolean
}>

export const NO_REPLY_MODERATION: ReplyModeration = Object.freeze({
  state: 'absent',
  policyViolation: null,
  commentPresent: false,
  commentEmpty: false,
  updateTimePresent: false,
  updateTimeEmpty: false,
})

/**
 * The fields of the one log line written for RepKey's own publication
 * read-backs (the publish job's read after an uncertain write, and the
 * reconcile sweep's read). Designing the behaviour needs to know, per state,
 * whether Google shows the comment and its time, and whether the text it shows
 * is the attempt's.
 */
export type ReplyReadbackFacts = Readonly<{
  moderationState: ReplyModerationState
  commentPresent: boolean
  commentEmpty: boolean
  updateTimePresent: boolean
  updateTimeEmpty: boolean
  /** The text Google shows matches the attempt's, by the observation digest. */
  textMatchedAttempt: boolean
  /** Only when the state is `rejected` and Google sent a code. */
  policyViolation?: string
}>

export function replyReadbackFacts(
  input: Readonly<{
    moderation: ReplyModeration | undefined
    observedText: string | null
    attemptText: string
  }>,
): ReplyReadbackFacts {
  const moderation = input.moderation ?? NO_REPLY_MODERATION
  const textMatchedAttempt =
    input.observedText !== null &&
    compareObservedGoogleReply(input.attemptText, input.observedText).matches
  return {
    moderationState: moderation.state,
    commentPresent: moderation.commentPresent,
    commentEmpty: moderation.commentEmpty,
    updateTimePresent: moderation.updateTimePresent,
    updateTimeEmpty: moderation.updateTimeEmpty,
    textMatchedAttempt,
    ...(moderation.state === 'rejected' && moderation.policyViolation !== null
      ? { policyViolation: moderation.policyViolation }
      : {}),
  }
}
