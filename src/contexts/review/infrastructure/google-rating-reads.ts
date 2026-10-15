// Review context — ReviewGoogleRatingReads implementation (rating goal).
//
// Counts and star sums over a Property's current Google reviews. Every read
// composes THE serving-eligibility predicate (ADR 0031, clock-injected) and
// joins the Property on its current binding epoch, so a review observed under
// an earlier binding never counts. No review content leaves this module.

import { and, count, desc, eq, gte, sql, sum, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties, reviews } from '#/shared/db/schema'
import type { Clock } from '#/shared/domain/clock'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import {
  GOOGLE_RATING_SUMMARY_MAX_COUNT_WINDOWS,
  type GoogleRatingTotals,
  type ReviewGoogleRatingReads,
} from '../application/ports/google-rating-reads.port'
import { contentEligible } from './serving-stats'

/** The Property row a review is joined to: same tenant, same binding epoch. */
const currentBinding = and(
  eq(properties.id, reviews.propertyId),
  eq(properties.organizationId, reviews.organizationId),
  eq(properties.sourceEpoch, reviews.sourceEpoch),
)

/** Tenant + Property + Google + eligibility, optionally from an instant on. */
function currentGoogleReviews(
  organizationId: OrganizationId,
  propertyId: PropertyId,
  now: Date,
  since?: Date,
): SQL | undefined {
  return and(
    eq(reviews.organizationId, organizationId),
    eq(reviews.propertyId, propertyId),
    eq(reviews.platform, 'google'),
    contentEligible(now),
    since ? gte(reviews.reviewedAt, since) : undefined,
  )
}

const totalsOf = (
  row: { count: unknown; sum: unknown } | undefined,
): GoogleRatingTotals => ({
  count: Number(row?.count ?? 0),
  sum: Number(row?.sum ?? 0),
})

const countFrom = (instant: Date) =>
  sql<number>`count(*) FILTER (WHERE ${reviews.reviewedAt} >= ${instant})`

const sumFrom = (instant: Date) =>
  sql<
    number | null
  >`sum(${reviews.rating}) FILTER (WHERE ${reviews.reviewedAt} >= ${instant})`

/** The Monday of a review's week in its Property's time zone. */
const reviewWeek = sql<string>`TO_CHAR(DATE_TRUNC('week', ${reviews.reviewedAt} AT TIME ZONE ${properties.timezone}), 'YYYY-MM-DD')`

/** The calendar year of a review in its Property's time zone. */
const reviewYear = sql<number>`EXTRACT(YEAR FROM ${reviews.reviewedAt} AT TIME ZONE ${properties.timezone})::int`

/** The count and sum since an instant, when the request asks for them. */
const totalsSinceColumns = (
  instant: Date | undefined,
): Readonly<Record<string, SQL<number | null>>> =>
  instant === undefined
    ? {}
    : { totalsCount: countFrom(instant), totalsSum: sumFrom(instant) }

export const createGoogleRatingReads = (deps: {
  db: Database
  clock: Clock
}): ReviewGoogleRatingReads =>
  Object.freeze({
    async getRatingSummary(organizationId, propertyId, request) {
      if (request.countSince.length > GOOGLE_RATING_SUMMARY_MAX_COUNT_WINDOWS) {
        throw new RangeError('Too many count windows for one rating summary')
      }
      return trace('review.googleRatingReads.getRatingSummary', async () => {
        const now = deps.clock()
        const scope = currentGoogleReviews(organizationId, propertyId, now)
        const windows = Object.fromEntries(
          request.countSince.map((instant, index) => [
            `since${index}`,
            countFrom(instant),
          ]),
        )
        const mostRecent = deps.db
          .select({ rating: reviews.rating })
          .from(reviews)
          .innerJoin(properties, currentBinding)
          .where(scope)
          .orderBy(desc(reviews.reviewedAt), desc(reviews.id))
          .limit(request.mostRecentLimit)
          .as('most_recent')
        const [aggregateRows, recentRows] = await Promise.all([
          deps.db
            .select({
              count: count(),
              sum: sum(reviews.rating),
              mixCount: countFrom(request.mixWindowStart),
              mixSum: sumFrom(request.mixWindowStart),
              ...totalsSinceColumns(request.totalsSince),
              ...windows,
            })
            .from(reviews)
            .innerJoin(properties, currentBinding)
            .where(scope),
          deps.db
            .select({ count: count(), sum: sum(mostRecent.rating) })
            .from(mostRecent),
        ])
        const aggregate = (aggregateRows[0] ?? {}) as Record<string, unknown>
        return {
          all: totalsOf({ count: aggregate.count, sum: aggregate.sum }),
          mixWindow: totalsOf({ count: aggregate.mixCount, sum: aggregate.mixSum }),
          mostRecent: totalsOf(recentRows[0]),
          countsSince: request.countSince.map((_, index) =>
            Number(aggregate[`since${index}`] ?? 0),
          ),
          totalsSince:
            request.totalsSince === undefined
              ? null
              : totalsOf({ count: aggregate.totalsCount, sum: aggregate.totalsSum }),
        }
      })
    },

    async getWeeklyCounts(organizationId, propertyId, since) {
      return trace('review.googleRatingReads.getWeeklyCounts', async () => {
        const rows = await deps.db
          .select({ weekStart: reviewWeek, count: count() })
          .from(reviews)
          .innerJoin(properties, currentBinding)
          .where(currentGoogleReviews(organizationId, propertyId, deps.clock(), since))
          .groupBy(reviewWeek)
          .orderBy(reviewWeek)
        return rows.map((row) => ({ weekStart: row.weekStart, count: Number(row.count) }))
      })
    },

    async getYearlyTotals(organizationId, propertyId) {
      return trace('review.googleRatingReads.getYearlyTotals', async () => {
        const rows = await deps.db
          .select({ year: reviewYear, count: count(), sum: sum(reviews.rating) })
          .from(reviews)
          .innerJoin(properties, currentBinding)
          .where(currentGoogleReviews(organizationId, propertyId, deps.clock()))
          .groupBy(reviewYear)
          .orderBy(reviewYear)
        return rows.map((row) => ({ year: Number(row.year), ...totalsOf(row) }))
      })
    },

    async getStarDistribution(organizationId, propertyId, since) {
      return trace('review.googleRatingReads.getStarDistribution', async () => {
        const rows = await deps.db
          .select({ stars: reviews.rating, count: count() })
          .from(reviews)
          .innerJoin(properties, currentBinding)
          .where(currentGoogleReviews(organizationId, propertyId, deps.clock(), since))
          .groupBy(reviews.rating)
        const byStars = new Map(rows.map((row) => [row.stars, Number(row.count)]))
        return [1, 2, 3, 4, 5].map((stars) => ({ stars, count: byStars.get(stars) ?? 0 }))
      })
    },
  })
