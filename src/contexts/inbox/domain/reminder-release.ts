import { isAnsweringGoogleReply, type GoogleReplyReading } from './rules'
import {
  isSupersededReminder,
  type ResponseTargetKind,
  type ResponseTargetReminderKind,
} from './response-target'

/**
 * How long a Google-review reminder may be held back while Google cannot be
 * read. Measured from the slot's own `scheduled_for`, so it needs no stored
 * state: a pending slot is write-once and cannot carry a retry counter.
 */
export const REMINDER_GOOGLE_CHECK_DELAY_CAP_MS = 15 * 60_000

/** The part of Review's Google reply head the release decision reads. */
export type ReminderReplyHead = GoogleReplyReading &
  Readonly<{
    materialReviewRevision: number
    observedAt: Date
  }>

/** What reading Google for one review came to, as far as the decision cares. */
export type ReminderGoogleCheckOutcome =
  /** Google was read and the reply head is as fresh as that read. */
  | 'read'
  /** Google shows a reply whose text could not be recovered; nothing was recorded. */
  | 'reply_unreadable'
  /** Google answered 404 for the review. */
  | 'review_missing'
  /** Rate limit, outage or timeout: a later try may work. */
  | 'transient_failure'
  /** Authorization, connection or provider rejected the read: waiting will not help. */
  | 'permanent_failure'
  /** Nothing to read: erased or expired content, no binding, capability off, no provider. */
  | 'not_checkable'

type HoldScope = Readonly<{
  /** When the cycle's Response Target started (null when it never did). */
  targetStartAt: Date | null
  /** The Material Review Revision the cycle measures. */
  cycleMaterialReviewRevision: number
}>

/**
 * Whether Google already shows the reply that answers this cycle, so that
 * the close (which the observation raised) is on its way and a reminder would
 * only prompt for work a manager has already done.
 *
 * Observed at or after the target start is what separates "this reply is
 * closing the item" from "a manager reopened the item after the reply": a
 * reopened target starts at the reopen instant, after the old reply. The same
 * revision keeps a reply to an earlier version of the review from holding a
 * reminder about the current one.
 */
export const holdsForAnsweringReply = (
  input: HoldScope & Readonly<{ head: ReminderReplyHead | undefined }>,
): boolean => {
  const { head, targetStartAt } = input
  if (head === undefined || targetStartAt === null) return false
  return (
    isAnsweringGoogleReply(head) &&
    head.materialReviewRevision === input.cycleMaterialReviewRevision &&
    head.observedAt.getTime() >= targetStartAt.getTime()
  )
}

export type ReminderReleasePlan = 'release_unchecked' | 'hold_local' | 'check'

/**
 * What to do with one due reminder before any call to Google. Only a Google
 * review reminder is ever checked: a private-feedback reminder has no Google
 * side, and a halfway reminder whose target has passed is cancelled by the
 * store without a prompt, so neither needs a read.
 */
export const planReminderRelease = (
  input: HoldScope &
    Readonly<{
      targetKind: ResponseTargetKind
      reminderKind: ResponseTargetReminderKind
      targetDueAt: Date | null
      now: Date
      head: ReminderReplyHead | undefined
    }>,
): ReminderReleasePlan => {
  if (input.targetKind !== 'google_review_response') return 'release_unchecked'
  if (
    input.targetDueAt !== null &&
    isSupersededReminder(input.reminderKind, input.targetDueAt, input.now)
  ) {
    return 'release_unchecked'
  }
  return holdsForAnsweringReply(input) ? 'hold_local' : 'check'
}

export type ReminderDecision = 'hold' | 'defer' | 'release'

/**
 * The decision after one attempt to read Google. Failing open is deliberate:
 * a reminder is only a prompt, so every case where Google cannot settle the
 * question ends in a prompt, and a held slot is never cancelled here.
 *
 * - hold: the read shows the answering reply; the normal close will cancel
 *   the slot. Nothing is written.
 * - defer: Google could not be read yet; leave the slot pending for the next
 *   tick, up to `scheduled_for` plus the cap. Nothing is written.
 * - release: deliver as before.
 */
export const decideReminderAfterGoogleCheck = (
  input: HoldScope &
    Readonly<{
      outcome: ReminderGoogleCheckOutcome
      head: ReminderReplyHead | undefined
      scheduledFor: Date
      now: Date
    }>,
): ReminderDecision => {
  switch (input.outcome) {
    case 'read':
      return holdsForAnsweringReply(input) ? 'hold' : 'release'
    case 'transient_failure':
    case 'review_missing':
      return input.now.getTime() <
        input.scheduledFor.getTime() + REMINDER_GOOGLE_CHECK_DELAY_CAP_MS
        ? 'defer'
        : 'release'
    // A reply Google shows but RepKey cannot read is never recorded, so it can
    // never close the item; holding on it would suppress the reminder forever.
    case 'reply_unreadable':
    case 'permanent_failure':
    case 'not_checkable':
      return 'release'
  }
}
