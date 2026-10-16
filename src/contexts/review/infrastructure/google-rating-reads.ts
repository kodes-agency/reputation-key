// Review context — ReviewGoogleRatingReads implementation (rating goal).
//
// Counts and star sums over a Property's current Google reviews. Every read
// composes THE serving-eligibility predicate (ADR 0031, clock-injected) and
// joins the Property on its current binding epoch, so a review observed under
// an earlier binding never counts. No review content leaves this module, and
// the week sums behind the goal's chart never leave it either (round 5).

import { and, count, desc, eq, gte, sql, sum, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  properties,
  reviewGoogleReputationSnapshotFacts as snapshotFacts,
  reviews,
} from '#/shared/db/schema'
import type { Clock } from '#/shared/domain/clock'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import {
  GOOGLE_RATING_SUMMARY_MAX_COUNT_WINDOWS,
  GOOGLE_SHOWN_NUMBER_LIMIT,
  type GoogleRatingTotals,
  type GoogleShownNumber,
  type ReviewGoogleRatingReads,
} from '../application/ports/google-rating-reads.port'
import {
  endOfWeekAverages,
  type GoogleRatingWeekTotals,
} from '../application/google-rating-week-history'
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

/** The calendar month of a review in its Property's time zone. */
const reviewMonth = sql<number>`EXTRACT(MONTH FROM ${reviews.reviewedAt} AT TIME ZONE ${properties.timezone})::int`

/** The civil date of a review in its Property's time zone, `YYYY-MM-DD`. */
const reviewDay = sql<string>`TO_CHAR(${reviews.reviewedAt} AT TIME ZONE ${properties.timezone}, 'YYYY-MM-DD')`

/** The count and sum since an instant, when the request asks for them. */
const totalsSinceColumns = (
  instant: Date | undefined,
): Readonly<Record<string, SQL<number | null>>> =>
  instant === undefined
    ? {}
    : { totalsCount: countFrom(instant), totalsSum: sumFrom(instant) }

/**
 * Every current Google review's week (null before `since`) and stars, then
 * one group per week plus the grand total (`whole`), in one scan.
 */
async function weekTotals(
  deps: { db: Database; clock: Clock },
  organizationId: OrganizationId,
  propertyId: PropertyId,
  since: Date,
): Promise<
  Readonly<{ all: GoogleRatingTotals; weeks: readonly GoogleRatingWeekTotals[] }>
> {
  const scoped = deps.db
    .select({
      week: sql<
        string | null
      >`CASE WHEN ${reviews.reviewedAt} >= ${since} THEN ${reviewWeek} END`.as('week'),
      rating: reviews.rating,
    })
    .from(reviews)
    .innerJoin(properties, currentBinding)
    .where(currentGoogleReviews(organizationId, propertyId, deps.clock()))
    .as('scoped')
  const rows = await deps.db
    .select({
      week: scoped.week,
      whole: sql<number>`GROUPING(${scoped.week})`,
      count: count(),
      sum: sum(scoped.rating),
    })
    .from(scoped)
    .groupBy(sql`GROUPING SETS ((${scoped.week}), ())`)
  const whole = rows.find((row) => Number(row.whole) === 1)
  const weeks = rows.flatMap((row) =>
    Number(row.whole) === 0 && row.week !== null
      ? [{ weekStart: row.week, ...totalsOf(row) }]
      : [],
  )
  return { all: totalsOf(whole), weeks }
}

/** Google's number as the tenth it shows, as Reporting's displayedTenths reads it. */
const shownTenths = sql<
  number | null
>`floor((round(${snapshotFacts.averageRating} * 1000000) + 50000) / 100000)`

/**
 * The snapshot in force at `since` and every later one whose shown tenth
 * differs from the one before it (the newest, when there are more than the
 * limit holds), under the Property's current binding epoch, oldest first.
 */
async function shownNumberChanges(
  db: Database,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  since: Date,
): Promise<readonly GoogleShownNumber[]> {
  const result = await db.execute<{
    evaluatedAt: Date | string
    averageRating: number | null
    reviewCount: number
  }>(sql`
    WITH facts AS (
      SELECT ${snapshotFacts.evaluatedAt} AS evaluated_at,
        ${snapshotFacts.averageRating} AS average_rating,
        ${snapshotFacts.reviewCount} AS review_count,
        ${shownTenths} AS tenths,
        LAG(${shownTenths}) OVER (
          ORDER BY ${snapshotFacts.evaluatedAt}, ${snapshotFacts.runId}
        ) AS previous_tenths,
        ROW_NUMBER() OVER (
          ORDER BY ${snapshotFacts.evaluatedAt}, ${snapshotFacts.runId}
        ) AS position
      FROM ${snapshotFacts}
      INNER JOIN ${properties}
        ON ${properties.id} = ${snapshotFacts.propertyId}
        AND ${properties.organizationId} = ${snapshotFacts.organizationId}
        AND ${properties.sourceEpoch} = ${snapshotFacts.sourceEpoch}
      WHERE ${snapshotFacts.organizationId} = ${organizationId}
        AND ${snapshotFacts.propertyId} = ${propertyId}
    ),
    in_force AS (
      SELECT * FROM facts WHERE evaluated_at <= ${since} ORDER BY position DESC LIMIT 1
    ),
    changed AS (
      SELECT * FROM facts
      WHERE evaluated_at > ${since} AND tenths IS DISTINCT FROM previous_tenths
      ORDER BY position DESC
      LIMIT ${GOOGLE_SHOWN_NUMBER_LIMIT - 1}
    )
    SELECT evaluated_at AS "evaluatedAt", average_rating AS "averageRating",
      review_count AS "reviewCount"
    FROM (SELECT * FROM in_force UNION ALL SELECT * FROM changed) picked
    ORDER BY position ASC
  `)
  return result.rows.map((row) => ({
    at: row.evaluatedAt instanceof Date ? row.evaluatedAt : new Date(row.evaluatedAt),
    averageRating: row.averageRating === null ? null : Number(row.averageRating),
    reviewCount: Number(row.reviewCount),
  }))
}

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

    async getWeeklyHistory(organizationId, propertyId, since) {
      return trace('review.googleRatingReads.getWeeklyHistory', async () => {
        const totals = await weekTotals(deps, organizationId, propertyId, since)
        return endOfWeekAverages(totals.all, totals.weeks)
      })
    },

    async getShownNumberChanges(organizationId, propertyId, since) {
      return trace('review.googleRatingReads.getShownNumberChanges', () =>
        shownNumberChanges(deps.db, organizationId, propertyId, since),
      )
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

    async getMonthlyTotals(organizationId, propertyId, since, minimumCount) {
      return trace('review.googleRatingReads.getMonthlyTotals', async () => {
        const rows = await deps.db
          .select({
            year: reviewYear,
            month: reviewMonth,
            count: count(),
            sum: sum(reviews.rating),
          })
          .from(reviews)
          .innerJoin(properties, currentBinding)
          .where(currentGoogleReviews(organizationId, propertyId, deps.clock(), since))
          .groupBy(reviewYear, reviewMonth)
          .having(sql`count(*) >= ${minimumCount}`)
          .orderBy(reviewYear, reviewMonth)
        return rows.map((row) => ({
          year: Number(row.year),
          month: Number(row.month),
          ...totalsOf(row),
        }))
      })
    },

    async getDailyCounts(organizationId, propertyId, since) {
      return trace('review.googleRatingReads.getDailyCounts', async () => {
        const rows = await deps.db
          .select({ day: reviewDay, count: count() })
          .from(reviews)
          .innerJoin(properties, currentBinding)
          .where(currentGoogleReviews(organizationId, propertyId, deps.clock(), since))
          .groupBy(reviewDay)
          .orderBy(reviewDay)
        return rows.map((row) => ({ day: row.day, count: Number(row.count) }))
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
