// Property Google rating goal — reading the numbers a goal is worked out from.
//
// Three sources, read together at one `now` (ADR 0017):
//   - Google's own count and average, the current snapshot Reporting keeps
//     (`getCurrentOnGoogle`, which answers only at the Property's current
//     binding epoch);
//   - the review cache, through Review's own read (counts and star sums of the
//     current Google reviews, never a review), with the totals since a goal
//     was set when an evaluation asks for them;
//   - the Property's time zone, lifecycle state, binding epoch and binding.

import type { ReviewGoogleRatingReads } from '#/contexts/review/application/public-api'
import {
  organizationId as toOrganizationId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import {
  displayedTenths,
  exactAverage,
  recentMix,
  RECENT_MIX_FALLBACK_REVIEWS,
  RECENT_MIX_WINDOW_DAYS,
  type ExactAverage,
  type RatingTotals,
  type RecentMix,
} from '../domain/rating-goal-numbers'
import { PACE_WINDOW_DAYS } from '../domain/rating-goal-pace'
import { googleIsWaiting } from '../domain/rating-goal-status'
import {
  ratingGoalEligibility,
  type RatingGoalBasis,
  type RatingGoalEligibility,
} from '../domain/rating-goal-stops'
import type {
  RatingGoalPropertyFacts,
  RatingGoalPropertyFactsReader,
} from './ports/property-rating-goal.repository'
import type { MetricPublicApi } from './public-api'

const DAY_MS = 24 * 60 * 60 * 1000

export type RatingGoalReadDeps = Readonly<{
  properties: RatingGoalPropertyFactsReader
  google: Pick<MetricPublicApi, 'getCurrentOnGoogle'>
  reviews: ReviewGoogleRatingReads
}>

export type GoogleNumbers = Readonly<{
  reviewCount: number
  averageRating: number | null
  /** The tenth Google shows; null when Google has no average. */
  displayedTenths: number | null
  verifiedAt: Date
}>

export type RatingGoalReading = Readonly<{
  now: Date
  facts: RatingGoalPropertyFacts
  google: GoogleNumbers | null
  /** Google's snapshot is there, under an active binding, and at most a day old. */
  googleCurrent: boolean
  /** No usable numbers: Google's are not current, or there is no average or mix. */
  waiting: boolean
  exact: ExactAverage | null
  mix: RecentMix | null
  reviewsLast28Days: number
  /** Reviews created since each `countSince` instant, in the same order. */
  extraCounts: readonly number[]
  /** Reviews created since `totalsSince` and their stars; null when it was not asked. */
  sinceSet: RatingTotals | null
}>

/** What a read asks for beyond the numbers every read takes. */
export type RatingGoalReadRequest = Readonly<{
  /** Up to three more windowed counts, from the Property's facts (its time zone). */
  countSince?: (facts: RatingGoalPropertyFacts) => readonly Date[]
  /** The instant a goal was set: the totals of the reviews created since. */
  totalsSince?: Date
}>

/**
 * Reads the numbers for one Property at `now`. Null when the Property does
 * not exist in the Organization. The request asks, in the same read, for
 * more windowed counts (this week, a goal's pace window) and for the totals
 * since a goal was set.
 */
export async function readRatingGoalInputs(
  deps: RatingGoalReadDeps,
  organizationId: string,
  propertyId: string,
  now: Date,
  request: RatingGoalReadRequest = {},
): Promise<RatingGoalReading | null> {
  const facts = await deps.properties.findPropertyFacts(organizationId, propertyId)
  if (facts === null) return null
  const org = toOrganizationId(organizationId)
  const property = toPropertyId(propertyId)
  const [snapshot, summary] = await Promise.all([
    deps.google.getCurrentOnGoogle(org, property),
    deps.reviews.getRatingSummary(org, property, {
      mixWindowStart: new Date(now.getTime() - RECENT_MIX_WINDOW_DAYS * DAY_MS),
      mostRecentLimit: RECENT_MIX_FALLBACK_REVIEWS,
      countSince: [
        new Date(now.getTime() - PACE_WINDOW_DAYS * DAY_MS),
        ...(request.countSince?.(facts) ?? []),
      ],
      ...(request.totalsSince === undefined ? {} : { totalsSince: request.totalsSince }),
    }),
  ])
  const google: GoogleNumbers | null = snapshot
    ? {
        reviewCount: snapshot.reviewCount,
        averageRating: snapshot.averageRating,
        displayedTenths:
          snapshot.averageRating === null
            ? null
            : displayedTenths(snapshot.averageRating),
        verifiedAt: snapshot.verifiedAt,
      }
    : null
  const exact = google ? exactAverage(summary.all, google) : null
  const mix = recentMix(summary.mixWindow, summary.mostRecent)
  const googleCurrent = !googleIsWaiting(google, facts.googleBindingActive, now)
  return {
    now,
    facts,
    google,
    googleCurrent,
    waiting:
      !googleCurrent || google?.displayedTenths == null || exact === null || mix === null,
    exact,
    mix,
    reviewsLast28Days: summary.countsSince[0] ?? 0,
    extraCounts: summary.countsSince.slice(1),
    sinceSet: summary.totalsSince,
  }
}

/**
 * The numbers a plan is worked out from, at the recent mix, or null when
 * there are none. Stale numbers still form a basis (a page shows them "as
 * of"); `reading.waiting` says whether a status or a new goal may rely on
 * them. A goal's own numbers assume its tracking mix instead
 * (rating-goal-views.ts goalBasis).
 */
export function ratingBasis(reading: RatingGoalReading): RatingGoalBasis | null {
  const { google, exact, mix } = reading
  if (!google || google.displayedTenths === null || !exact || !mix) return null
  return {
    reviewCount: google.reviewCount,
    displayedTenths: google.displayedTenths,
    exact: exact.value,
    mix: mix.value,
  }
}

/** Whether Google's numbers let a goal be planned: ten reviews, then current numbers. */
export const numbersEligibility = (reading: RatingGoalReading): RatingGoalEligibility =>
  ratingGoalEligibility(reading.google, !reading.waiting)

/** Whether a goal may be set: an active Property first, then the numbers. */
export const setupEligibility = (reading: RatingGoalReading): RatingGoalEligibility =>
  reading.facts.lifecycleState === 'active'
    ? numbersEligibility(reading)
    : { eligible: false, reason: 'property_not_active' }
