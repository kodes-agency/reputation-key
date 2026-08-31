import type {
  RatingTrendPoint,
  ReviewVolumePoint,
} from '#/contexts/dashboard/application/public-api'

export type PropertyReputationTrendDatum = Readonly<{
  avgRating?: number
  count?: number
  date: string
}>

export function buildPropertyReputationTrendData(
  ratingTrend: readonly RatingTrendPoint[],
  reviewVolume: readonly ReviewVolumePoint[],
): readonly PropertyReputationTrendDatum[] {
  const byDate = new Map<string, PropertyReputationTrendDatum>()
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
      avgRating: Math.round(point.avgRating * 10) / 10,
    })
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}
