import type {
  RatingTrendPoint,
  ReviewVolumePoint,
} from '#/contexts/reporting/application/public-api'
import { groupByBucket, type Bucket } from '#/shared/chart-buckets'
import type { BucketUnit } from '#/shared/dashboard-range'

export type PropertyReputationDailyDatum = Readonly<{
  avgRating?: number
  count?: number
  date: string
}>

export type PropertyReputationTrendDatum = Readonly<{
  date: string
  label: string
  newReviews: number
  runningAverage?: number
}>

export type PropertyReputationTrendData = Readonly<{
  buckets: ReadonlyArray<Bucket<PropertyReputationDailyDatum>>
  points: readonly PropertyReputationTrendDatum[]
}>

/**
 * The read model returns rating and volume as independent daily series. Merge
 * them by calendar date before bucketing so a sparse day in either series can
 * never be paired with an unrelated day from the other one.
 */
export function mergePropertyReputationDailyData(
  ratingTrend: readonly RatingTrendPoint[],
  reviewVolume: readonly ReviewVolumePoint[],
): readonly PropertyReputationDailyDatum[] {
  const byDate = new Map<string, PropertyReputationDailyDatum>()

  for (const point of reviewVolume) {
    byDate.set(point.date, {
      ...byDate.get(point.date),
      date: point.date,
      count: point.count,
    })
  }

  for (const point of ratingTrend) {
    byDate.set(point.date, {
      ...byDate.get(point.date),
      date: point.date,
      avgRating: point.avgRating,
    })
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}

/**
 * Aggregate daily observations into the range's display buckets. The rating
 * line is weighted by the number of reviews behind each daily average and then
 * carried forward, so it describes the reputation accumulated across the
 * selected period rather than whipsawing between tiny per-bucket samples.
 */
export function buildPropertyReputationTrendData(
  ratingTrend: readonly RatingTrendPoint[],
  reviewVolume: readonly ReviewVolumePoint[],
  unit: BucketUnit,
): PropertyReputationTrendData {
  const daily = mergePropertyReputationDailyData(ratingTrend, reviewVolume)
  const buckets = groupByBucket(daily, unit, (row) => row.date)
  let cumulativeRatingTotal = 0
  let cumulativeRatingCount = 0

  const points = buckets.map((bucket): PropertyReputationTrendDatum => {
    let newReviews = 0

    for (const row of bucket.rows) {
      newReviews += row.count ?? 0
      if (row.avgRating === undefined || row.count === undefined || row.count <= 0) {
        continue
      }
      cumulativeRatingTotal += row.avgRating * row.count
      cumulativeRatingCount += row.count
    }

    return {
      date: bucket.start,
      label: bucket.label,
      newReviews,
      ...(cumulativeRatingCount > 0
        ? {
            runningAverage:
              Math.round((cumulativeRatingTotal / cumulativeRatingCount) * 100) / 100,
          }
        : {}),
    }
  })

  return { buckets, points }
}
