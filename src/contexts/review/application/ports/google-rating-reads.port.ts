// Review context — ReviewGoogleRatingReads port (Property Google rating goal).
//
// Review-owned aggregate reads that Reporting's rating goal plans with: how
// many of a Property's current Google reviews there are and the sum of their
// stars, in windows by the date Google created them (`reviews.reviewed_at`,
// Google's createTime). They return counts and sums only, never a review.
//
// Since round 2 (2026-10-15) the goal also asks for the totals of the reviews
// created since it was set (their average judges whether new reviews are too
// low), and for each Property-local calendar year's totals (the best year is
// evidence for a planned quality). Still counts and sums only.
//
// Since rounds 3 and 4 (2026-10-16) the setup also asks for each Property-local
// calendar month's totals (the best month is evidence for the planned average;
// a month under ten reviews is never returned, so no month's total is one
// review's stars) and for the count of reviews on each Property-local date
// (the busiest 30 days are the proven pace). Dates carry counts only, never
// sums. Comparing successive reads of a growing month (the current one) is out
// of scope: managers already see each review in the Inbox.
//
// A review counts when it is servable under the same eligibility as
// ReviewServingStats (ADR 0031: active source content with a rating, a review
// instant and an unexpired cache clock, `now` from the injected clock) and was
// observed under the Property's CURRENT Google binding epoch. A review Google
// removed (provider_deleted), one whose content was erased or has expired, and
// one from an earlier binding never count, so the cache count can be compared
// with Google's own count to tell whether the cache is complete.

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

/** A count of ratings and the sum of their stars. */
export type GoogleRatingTotals = Readonly<{ count: number; sum: number }>

/** Most count windows one summary read answers. */
export const GOOGLE_RATING_SUMMARY_MAX_COUNT_WINDOWS = 4

export type GoogleRatingSummaryRequest = Readonly<{
  /** The recent-mix window starts here. */
  mixWindowStart: Date
  /** How many of the most recently created reviews the mix falls back to. */
  mostRecentLimit: number
  /** Reviews created at or after each instant are counted, in this order. */
  countSince: readonly Date[]
  /** When given, the count and star sum of the reviews created at or after it. */
  totalsSince?: Date
}>

export type GoogleRatingSummary = Readonly<{
  /** Every current Google review with a rating. */
  all: GoogleRatingTotals
  /** Those created at or after `mixWindowStart`. */
  mixWindow: GoogleRatingTotals
  /** The `mostRecentLimit` most recently created, or all when fewer. */
  mostRecent: GoogleRatingTotals
  /** One count per `countSince` instant, in the same order. */
  countsSince: readonly number[]
  /** Those created at or after `totalsSince`; null when it was not asked for. */
  totalsSince: GoogleRatingTotals | null
}>

/** The reviews created in one calendar year of the Property's time zone. */
export type GoogleRatingYearTotals = GoogleRatingTotals & Readonly<{ year: number }>

/** Reviews created in one Monday-to-Sunday week of the Property's time zone. */
export type GoogleRatingWeekCount = Readonly<{
  /** The week's Monday in the Property's time zone, `YYYY-MM-DD`. */
  weekStart: string
  count: number
}>

/** The reviews created in one calendar month of the Property's time zone. */
export type GoogleRatingMonthTotals = GoogleRatingTotals &
  Readonly<{ year: number; month: number }>

/** Reviews created on one Property-local date, `YYYY-MM-DD`. */
export type GoogleRatingDayCount = Readonly<{ day: string; count: number }>

export type GoogleRatingStarCount = Readonly<{ stars: number; count: number }>

export type ReviewGoogleRatingReads = Readonly<{
  /** Totals, the recent-mix inputs and windowed counts, in one read. */
  getRatingSummary(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    request: GoogleRatingSummaryRequest,
  ): Promise<GoogleRatingSummary>

  /** Reviews created at or after `since`, per Property-local Monday-to-Sunday week. */
  getWeeklyCounts(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    since: Date,
  ): Promise<readonly GoogleRatingWeekCount[]>

  /** Totals per Property-local calendar year, oldest first; a year without reviews is absent. */
  getYearlyTotals(
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<readonly GoogleRatingYearTotals[]>

  /**
   * Totals per Property-local calendar month from `since` on, oldest first;
   * only months with at least `minimumCount` reviews.
   */
  getMonthlyTotals(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    since: Date,
    minimumCount: number,
  ): Promise<readonly GoogleRatingMonthTotals[]>

  /**
   * Reviews created at or after `since`, per Property-local date, oldest
   * first; dates without reviews are absent. Counts only.
   */
  getDailyCounts(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    since: Date,
  ): Promise<readonly GoogleRatingDayCount[]>

  /** Reviews created at or after `since`, per star (1 to 5, every star present). */
  getStarDistribution(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    since: Date,
  ): Promise<readonly GoogleRatingStarCount[]>
}>
