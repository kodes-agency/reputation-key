import { useId } from 'react'

const STAR_BUCKETS = [5, 4, 3, 2, 1] as const

export type RatingDistributionDatum = Readonly<{
  stars: number
  label: string
  count: number
  percentage: number
  detail: string
}>

export function buildRatingDistributionData(
  distribution: readonly { stars: number; count: number }[],
): readonly RatingDistributionDatum[] {
  const counts = new Map<number, number>()
  for (const bucket of distribution) {
    counts.set(bucket.stars, (counts.get(bucket.stars) ?? 0) + bucket.count)
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0)

  return STAR_BUCKETS.map((stars) => {
    const count = counts.get(stars) ?? 0
    const percentage = total === 0 ? 0 : Math.round((count / total) * 1_000) / 10
    const percentageLabel = Number.isInteger(percentage)
      ? percentage.toFixed(0)
      : percentage.toFixed(1)
    return {
      stars,
      label: `${stars}★`,
      count,
      percentage,
      detail: `${count.toLocaleString()} · ${percentageLabel}%`,
    }
  })
}

type Props = Readonly<{
  distribution: readonly { stars: number; count: number }[]
  labelledBy: string
  label?: string
}>

/** Five labelled CSS bars keep every value legible in the fixed 160 px band. */
export function RatingDistributionChart({
  distribution,
  labelledBy,
  label = 'Rating distribution',
}: Props) {
  const captionId = useId()
  const data = buildRatingDistributionData(distribution)
  const total = data.reduce((sum, bucket) => sum + bucket.count, 0)
  if (total === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">No ratings in this period.</p>
    )
  }

  const largest = data.reduce((current, bucket) =>
    bucket.count > current.count ? bucket : current,
  )
  const caption = `${largest.count.toLocaleString()} of ${total.toLocaleString()} ratings are ${largest.label} (${Number.isInteger(largest.percentage) ? largest.percentage.toFixed(0) : largest.percentage.toFixed(1)}%).`

  return (
    <figure
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={captionId}
      className="min-w-0 space-y-2"
    >
      <figcaption id={captionId} className="text-sm text-muted-foreground">
        {caption}
      </figcaption>
      <ol className="flex h-40 flex-col justify-between" aria-label={`${label} values`}>
        {data.map((bucket) => (
          <li
            key={bucket.stars}
            className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 text-sm"
          >
            <span className="font-medium tabular-nums">{bucket.label}</span>
            <span
              className="h-2 overflow-hidden rounded-full bg-muted"
              aria-hidden="true"
            >
              <span
                className="block h-full rounded-full bg-muted-foreground"
                style={{ width: `${bucket.percentage}%` }}
              />
            </span>
            <span className="min-w-20 text-right tabular-nums">{bucket.detail}</span>
          </li>
        ))}
      </ol>
    </figure>
  )
}
