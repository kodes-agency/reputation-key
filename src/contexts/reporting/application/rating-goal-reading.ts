// Property Google rating goal — reading the numbers a goal is worked out from.
//
// Three sources, read together at one `now` (ADR 0017):
//   - Google's own count and average, the current snapshot Reporting keeps
//     (`getCurrentOnGoogle`, which answers only at the Property's current
//     binding epoch);
//   - the review cache, through Review's own read (counts and star sums of the
//     current Google reviews, never a review);
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
  type RecentMix,
} from '../domain/rating-goal-numbers'
import { PACE_WINDOW_DAYS } from '../domain/rating-goal-pace'
import { googleIsWaiting } from '../domain/rating-goal-status'
import type { RatingGoalBasis } from '../domain/rating-goal-stops'
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
  /** No usable numbers: no snapshot, a stale one, an inactive binding, or no cache. */
  waiting: boolean
  exact: ExactAverage | null
  mix: RecentMix | null
  reviewsLast28Days: number
  /** Reviews created since each `extraCountSince` instant, in the same order. */
  extraCounts: readonly number[]
}>

/**
 * Reads the numbers for one Property at `now`. Null when the Property does
 * not exist in the Organization. `extraCountSince` asks, from the Property's
 * facts (its time zone), for up to three more windowed counts in the same
 * read: this week, a goal's pace window.
 */
export async function readRatingGoalInputs(
  deps: RatingGoalReadDeps,
  organizationId: string,
  propertyId: string,
  now: Date,
  extraCountSince: (facts: RatingGoalPropertyFacts) => readonly Date[] = () => [],
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
        ...extraCountSince(facts),
      ],
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
  return {
    now,
    facts,
    google,
    waiting:
      googleIsWaiting(google, facts.googleBindingActive, now) ||
      google?.displayedTenths == null ||
      exact === null ||
      mix === null,
    exact,
    mix,
    reviewsLast28Days: summary.countsSince[0] ?? 0,
    extraCounts: summary.countsSince.slice(1),
  }
}

/**
 * The numbers a plan is worked out from, or null when there are none. Stale
 * numbers still form a basis (a page shows them "as of"); `reading.waiting`
 * says whether a status or a new goal may rely on them.
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
