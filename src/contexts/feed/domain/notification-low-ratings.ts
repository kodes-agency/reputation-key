// Low ratings: a review or rated private feedback at or below the reader's own
// star threshold, per channel (ADR 0046, amended 2026-09-30).
//
// "How low" is the person's: 3★ or lower in the app and 2★ or lower by email
// unless they chose otherwise, per Property or as their default, like every
// other category. The decision is made when a notice is written, for each
// reader, from the rating as it stands then:
//
// - private feedback's rating is RepKey's own (the Portal collected it), so it
//   travels in the payload and its stars are shown;
// - a Google review's rating is Google's content, held only in Review's 30-day
//   refresh-or-remove cache (ADR 0031). Feed reads it at that moment, through
//   Inbox, to route the notice — and stores only the outcome, the `lowRating`
//   flag. A notification row lives on and an email cannot be recalled, so
//   neither ever carries the stars.

import type { NotificationType } from './notification-types'

/** The ratings a Low-ratings channel can be set to include: "N★ or lower". */
export const LOW_RATING_THRESHOLDS = [1, 2, 3, 4] as const

export type LowRatingThreshold = (typeof LOW_RATING_THRESHOLDS)[number]

export const isLowRatingThreshold = (value: unknown): value is LowRatingThreshold =>
  LOW_RATING_THRESHOLDS.includes(value as LowRatingThreshold)

/** The notices a rating can make low: a new or edited review, private feedback. */
export const RATED_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  'review.created',
  'review.updated',
  'feedback.created',
])

/** One channel's Low-ratings answer: on or off, and up to which rating. */
export type LowRatingChannelPreference = Readonly<{
  enabled: boolean
  maxRating: LowRatingThreshold
}>

/** Whether `rating` is low enough for this channel to tell its reader. */
export const isLowFor = (
  preference: LowRatingChannelPreference,
  rating: number | null,
): boolean => preference.enabled && rating !== null && rating <= preference.maxRating
