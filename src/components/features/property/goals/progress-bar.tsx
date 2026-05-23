import { cn } from '#/lib/utils'
import {
  formatProgressLabel,
  progressBarWidth,
  progressBarColor,
  progressBarColorClass,
} from '#/contexts/goal/ui/helpers'
import type { AggregationFunction } from '#/shared/domain/metric-keys'
import type { GoalStatus } from '#/contexts/goal/application/dto/goal.dto'

type ProgressBarProps = {
  currentValue: number
  targetValue: number
  aggregation: AggregationFunction
  status: GoalStatus
  className?: string
}

export function ProgressBar({
  currentValue,
  targetValue,
  aggregation,
  status,
  className,
}: ProgressBarProps) {
  const width = progressBarWidth(currentValue, targetValue)
  const color = progressBarColor(status, currentValue, targetValue)
  const colorClass = progressBarColorClass(color)
  const label = formatProgressLabel(currentValue, targetValue, aggregation)

  return (
    <div className={cn('space-y-1', className)}>
      <div className="h-2 w-full rounded-full bg-gray-100">
        <div
          className={cn('h-2 rounded-full transition-all', colorClass)}
          style={{ width: `${width}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
