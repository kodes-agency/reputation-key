import { ArrowDownRight, ArrowUpRight, Minus, Star } from 'lucide-react'
import type { TimeRangePreset } from '#/contexts/dashboard/application/dto/dashboard.dto'
import {
  ratingPresentation,
  type RatingPresentationInput,
} from '#/components/features/dashboard/rating-presentation'
import { metricEvidenceLine } from '#/components/features/dashboard/metric-availability-presentation'
import type { PortalMetricEvidence } from '#/contexts/dashboard/application/public-api'

export function PortalRatingCard({
  rating,
  timeRange,
  timeZone,
}: {
  rating: RatingPresentationInput & Readonly<{ evidence: PortalMetricEvidence }>
  timeRange: TimeRangePreset
  timeZone: string
}) {
  const presentation = ratingPresentation(rating, timeRange)
  const ComparisonIcon =
    presentation.direction === 'up'
      ? ArrowUpRight
      : presentation.direction === 'down'
        ? ArrowDownRight
        : Minus
  const comparisonClass =
    presentation.direction === 'up'
      ? 'text-emerald-500'
      : presentation.direction === 'down'
        ? 'text-red-500'
        : 'text-muted-foreground'

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Star className="size-4" />
        <span className="text-xs font-medium uppercase tracking-wide">
          Private rating avg
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-2xl font-semibold tabular-nums">{presentation.value}</p>
        <span
          className={`flex items-center gap-0.5 text-xs tabular-nums ${comparisonClass}`}
        >
          <ComparisonIcon className="size-3" />
          {presentation.comparison}
        </span>
      </div>
      {rating.evidence.state === 'ready' && (
        <p className="mt-1 text-xs text-muted-foreground">{presentation.evidence}</p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {metricEvidenceLine(
          {
            basis: rating.evidence.basis,
            state: rating.evidence.state,
            dataThrough: rating.evidence.verifiedThrough,
          },
          undefined,
          timeZone,
        )}
      </p>
    </div>
  )
}
