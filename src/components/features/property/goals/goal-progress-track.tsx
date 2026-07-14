import { cn } from '#/lib/utils'
import type { GoalStatus } from '#/contexts/goal/application/public-api'
import type { GoalAttention } from '#/contexts/goal/ui/helpers'

type GoalProgressTrackProps = Readonly<{
  currentValue: number
  targetValue: number
  percent: number
  label: string
  status: GoalStatus
  attention: GoalAttention
  expectedPercent?: number | null
  showExpectedMarker?: boolean
  className?: string
}>

export function GoalProgressTrack({
  currentValue,
  targetValue,
  percent,
  label,
  status,
  attention,
  expectedPercent,
  showExpectedMarker = false,
  className,
}: GoalProgressTrackProps) {
  const width = Math.min(100, Math.max(0, percent))
  const valueNow = Math.min(Math.max(0, currentValue), Math.max(0, targetValue))

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, targetValue)}
        aria-valuenow={valueNow}
        aria-valuetext={label}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all',
            progressColor(status, attention),
          )}
          style={{ width: `${width}%` }}
        />
        {showExpectedMarker &&
          expectedPercent !== null &&
          expectedPercent !== undefined && (
            <span
              className="absolute top-[-2px] bottom-[-2px] w-px bg-foreground/70"
              style={{ left: `${Math.min(100, Math.max(0, expectedPercent))}%` }}
              aria-hidden="true"
            />
          )}
      </div>
    </div>
  )
}

function progressColor(status: GoalStatus, attention: GoalAttention): string {
  if (status === 'cancelled' || status === 'expired') return 'bg-muted-foreground/50'
  if (attention === 'needs-attention') return 'bg-destructive'
  return 'bg-primary'
}
