// Headlines use Google's own rating and count, never a cache-derived average
// (ADR 0067). Stale or disconnected snapshots still show their dated last numbers;
// only a missing snapshot for the current binding produces a dash.

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
