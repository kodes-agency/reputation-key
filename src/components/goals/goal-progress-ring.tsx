import { cn } from '#/lib/utils'
import {
  computeElapsedFraction,
  computeExpectedValue,
  computePaceStatus,
  paceColor,
  paceColorClass,
} from '#/contexts/goal/ui/helpers'
import type { GoalStatus } from '#/contexts/goal/application/public-api'

type GoalProgressRingProps = Readonly<{
  /** Current progress value (from GoalProgress or instance) */
  currentValue: number
  /** Target value from the goal */
  targetValue: number
  /** Goal status for coloring and special states */
  status: GoalStatus
  /** Optional period dates for computing expected notch (time elapsed) */
  periodStart?: Date | null
  periodEnd?: Date | null
  /** Precomputed expected override (useful in previews or tests) */
  expectedValue?: number
  /** Visual size */
  size?: 'sm' | 'md' | 'lg'
  /** Show numeric center label */
  showLabel?: boolean
  /** Optional className */
  className?: string
  /** Accessible label override */
  ariaLabel?: string
  /** Show the "expected % (time)" hint under the ring. Default true; suppress on dense list rows where a separate pace label already carries it. */
  showPaceHint?: boolean
}>

/**
 * GoalProgressRing — reusable circular progress with "expected" notch.
 *
 * - Arc fill shows actual progress (current / target).
 * - Notch shows expected position based on time elapsed (for goals with periods).
 * - Colors reflect pace (ahead/on/behind) + status.
 * - Purely presentational; calculations in helpers.
 * - Follows project chart theming spirit via consistent color tokens.
 */
export function GoalProgressRing({
  currentValue,
  targetValue,
  status,
  periodStart,
  periodEnd,
  expectedValue: expectedOverride,
  size = 'md',
  showLabel = true,
  className,
  ariaLabel,
  showPaceHint = true,
}: GoalProgressRingProps) {
  const safeTarget = Math.max(0.0001, targetValue) // avoid /0
  const pct = Math.min(100, Math.max(0, (currentValue / safeTarget) * 100))

  const hasExpectedPace =
    expectedOverride !== undefined || (periodStart != null && periodEnd != null)

  // Expected notch
  const now = new Date()
  const elapsed = hasExpectedPace
    ? computeElapsedFraction(periodStart ?? null, periodEnd ?? null, now)
    : 0
  const computedExpected = hasExpectedPace
    ? (expectedOverride ?? computeExpectedValue(targetValue, elapsed))
    : 0
  const expectedPct = Math.min(100, Math.max(0, (computedExpected / safeTarget) * 100))

  const isComplete = status === 'completed' || currentValue >= targetValue
  const pace = hasExpectedPace
    ? computePaceStatus(currentValue, computedExpected, targetValue, status)
    : isComplete
      ? 'at-target'
      : 'no-period'
  const colorName = paceColor(pace)

  // Sizing (radius 42 for 100x100 viewBox gives nice stroke room)
  const sizes = {
    sm: { box: 64, stroke: 6, font: 'text-[10px]' },
    md: { box: 88, stroke: 8, font: 'text-xs' },
    lg: { box: 112, stroke: 9, font: 'text-sm' },
  }[size]
  const { box, stroke, font } = sizes

  const radius = 42
  const circumference = 2 * Math.PI * radius
  const progressOffset = circumference * (1 - pct / 100)

  // Notch angle: -90deg start (top), clockwise
  const notchAngle = (expectedPct / 100) * 360 - 90
  const notchX = 50 + radius * Math.cos((notchAngle * Math.PI) / 180)
  const notchY = 50 + radius * Math.sin((notchAngle * Math.PI) / 180)

  const label = isComplete ? '100%' : `${Math.floor(pct)}%`

  const effectiveAria = ariaLabel ?? `Progress: ${Math.floor(pct)}% of ${targetValue}`

  const ringColor =
    colorName === 'green'
      ? 'stroke-green-500'
      : colorName === 'amber'
        ? 'stroke-amber-500'
        : colorName === 'blue'
          ? 'stroke-blue-500'
          : 'stroke-gray-400'

  const notchColor =
    colorName === 'green'
      ? 'stroke-green-600 dark:stroke-green-400'
      : colorName === 'amber'
        ? 'stroke-amber-600 dark:stroke-amber-400'
        : 'stroke-blue-600 dark:stroke-blue-400'

  return (
    <div
      className={cn('inline-flex flex-col items-center', className)}
      role="img"
      aria-label={effectiveAria}
    >
      <svg
        width={box}
        height={box}
        viewBox="0 0 100 100"
        className="block"
        role="progressbar"
        aria-valuenow={Math.round(currentValue)}
        aria-valuemin={0}
        aria-valuemax={Math.round(targetValue)}
        aria-label={effectiveAria}
      >
        {/* Background ring */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-muted/30"
          strokeWidth={stroke}
        />

        {/* Progress arc */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          className={cn(ringColor, isComplete && 'stroke-green-500')}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={progressOffset}
          transform="rotate(-90 50 50)"
        />

        {/* Notch for expected progress (time elapsed so far) */}
        {hasExpectedPace && expectedPct > 0.5 && expectedPct < 99.5 && (
          <g>
            {/* Small radial marker line */}
            <line
              x1={50 + (radius - 3) * Math.cos((notchAngle * Math.PI) / 180)}
              y1={50 + (radius - 3) * Math.sin((notchAngle * Math.PI) / 180)}
              x2={50 + (radius + 3) * Math.cos((notchAngle * Math.PI) / 180)}
              y2={50 + (radius + 3) * Math.sin((notchAngle * Math.PI) / 180)}
              stroke="currentColor"
              strokeWidth={Math.max(1.5, stroke / 4)}
              className={cn(notchColor, 'opacity-90')}
            />
            {/* Center dot at notch position */}
            <circle
              cx={notchX}
              cy={notchY}
              r={stroke / 3.5}
              fill="currentColor"
              className={cn(notchColor)}
            />
          </g>
        )}

        {/* Center text */}
        {showLabel && (
          <text
            x="50"
            y="50"
            textAnchor="middle"
            dominantBaseline="central"
            className={cn('font-semibold tabular-nums fill-foreground', font)}
          >
            {label}
          </text>
        )}
      </svg>

      {/* Subtle pace hint under ring when not complete */}
      {!isComplete && hasExpectedPace && pace !== 'no-period' && showPaceHint && (
        <span className={cn('mt-1 text-xs font-medium', paceColorClass(colorName))}>
          {pace === 'ahead' ? '↑' : pace === 'behind' ? '↓' : '≈'} expected{' '}
          {Math.floor(expectedPct)}% (time)
        </span>
      )}
    </div>
  )
}
