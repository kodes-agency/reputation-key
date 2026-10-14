// Google's own rating and review count, as every headline shows them (pure).
//
// One rating number (ADR 0067, decision 16): the Property Overview's Rating
// tile, the Properties list and the rating goal all lead with the number Google
// shows and Google's count, read from the Current on Google snapshot, never
// RepKey's own average of the reviews it holds. Numbers more than a day old, or
// read while the Google binding is not active, are still Google's last numbers:
// a headline shows them with their date ("4.3 · as of Oct 12"), and a dash only
// when Google never sent numbers for the Property's current binding.

import { displayedTenths } from './rating-goal-numbers'
import { googleIsWaiting } from './rating-goal-status'
import { MIN_GOOGLE_REVIEWS_FOR_RATING_GOAL } from './rating-goal-stops'

/** Google's numbers as a headline prints them. */
export type GoogleNumbersView = Readonly<{
  /** Google's one-decimal number (4.3); null when Google has no average. */
  shows: number | null
  reviewCount: number
  /** When Review last verified these numbers with Google (ISO). */
  asOf: string
  /** False when older than 24 hours or the Google binding is not active. */
  current: boolean
}>

/** The Current on Google snapshot's figures, at the Property's current binding. */
export type GoogleSnapshotFigures = Readonly<{
  reviewCount: number
  averageRating: number | null
  verifiedAt: Date
}>

export function googleNumbersView(
  snapshot: GoogleSnapshotFigures | null,
  bindingActive: boolean,
  now: Date,
): GoogleNumbersView | null {
  if (snapshot === null) return null
  return {
    shows:
      snapshot.averageRating === null
        ? null
        : displayedTenths(snapshot.averageRating) / 10,
    reviewCount: snapshot.reviewCount,
    asOf: snapshot.verifiedAt.toISOString(),
    current: !googleIsWaiting(snapshot, bindingActive, now),
  }
}

/**
 * Whether a Property is offered a rating goal at all: active, and Google counts
 * at least ten reviews for it, current or not. Fresh numbers are the wizard's
 * own question; a standing door to it (the setup strip's step, the Properties
 * list's "Set goal") needs only this.
 */
export function ratingGoalOffered(
  facts: Readonly<{ propertyActive: boolean; googleReviewCount: number | null }>,
): boolean {
  return (
    facts.propertyActive &&
    facts.googleReviewCount !== null &&
    facts.googleReviewCount >= MIN_GOOGLE_REVIEWS_FOR_RATING_GOAL
  )
}
