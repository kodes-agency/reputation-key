import { ArrowDownRight, ArrowUpRight, Minus, Star } from 'lucide-react'
import type { TimeRangePreset } from '#/contexts/dashboard/application/dto/dashboard.dto'
import {
  portalRatingPresentation,
  type PortalRatingPresentationInput,
} from './portal-rating-presentation'

export function PortalRatingCard({
  rating,
  timeRange,
}: {
  rating: PortalRatingPresentationInput
  timeRange: TimeRangePreset
}) {
  const presentation = portalRatingPresentation(rating, timeRange)
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
      <p className="mt-1 text-xs text-muted-foreground">{presentation.evidence}</p>
    </div>
  )
}
