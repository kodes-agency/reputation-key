import { cn } from '#/lib/utils'
import {
  formatProgressLabel,
  progressBarColor,
  progressBarColorClass,
  progressBarWidth,
} from '#/contexts/goal/ui/helpers'
import type { GoalStatus } from '#/contexts/goal/application/public-api'
import type { AggregationFunction } from '#/shared/domain/metric-keys'

type Props = Readonly<{
  currentValue: number
  targetValue: number
  aggregation: AggregationFunction
  status: GoalStatus
  className?: string
}>

export function GoalProgressBar({
  currentValue,
  targetValue,
  aggregation,
  status,
  className,
}: Props) {
  const width = progressBarWidth(currentValue, targetValue)
  const color = progressBarColor(status, currentValue, targetValue)
  const colorClass = progressBarColorClass(color)
  const label = formatProgressLabel(currentValue, targetValue, aggregation)

  return (
    <div className={cn('space-y-1', className)}>
      <div className="h-2 w-full rounded-full bg-muted">
        <div
          className={cn('h-2 rounded-full transition-all', colorClass)}
          style={{ width: `${width}%` }}
          role="progressbar"
          aria-valuenow={currentValue}
          aria-valuemin={0}
          aria-valuemax={targetValue}
          aria-label={`Progress: ${label}`}
        />
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
