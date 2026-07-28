import { cn } from '#/lib/utils'
import { buildRingModel, type GoalProgressRingProps } from './goal-progress-ring-model'

export type { GoalProgressRingProps } from './goal-progress-ring-model'

/**
 * GoalProgressRing — reusable circular progress with "expected" notch.
 *
 * - Arc fill shows actual progress (current / target).
 * - Notch shows expected position based on time elapsed (for goals with periods).
 * - Colors reflect pace (ahead/on/behind) + status.
 * - Purely presentational; all derived values come from buildRingModel
 *   (goal-progress-ring-model.ts — BQC-5.3 complexity extraction).
 * - Follows project chart theming spirit via consistent color tokens.
 */
export function GoalProgressRing(props: GoalProgressRingProps) {
  const { className, now = new Date() } = props
  const m = buildRingModel({ ...props, now })

  return (
    <div
      className={cn('inline-flex flex-col items-center', className)}
      role="img"
      aria-label={m.effectiveAria}
    >
      <svg
        width={m.box}
        height={m.box}
        viewBox="0 0 100 100"
        className="block"
        role="progressbar"
        aria-valuenow={m.ariaValueNow}
        aria-valuemin={0}
        aria-valuemax={m.ariaValueMax}
        aria-label={m.effectiveAria}
      >
        {/* Background ring */}
        <circle
          cx="50"
          cy="50"
          r={m.radius}
          fill="none"
          stroke="currentColor"
          className="text-muted/30"
          strokeWidth={m.stroke}
        />

        {/* Progress arc */}
        <circle
          cx="50"
          cy="50"
          r={m.radius}
          fill="none"
          stroke="currentColor"
          className={m.progressArcClass}
          strokeWidth={m.stroke}
          strokeLinecap="round"
          strokeDasharray={m.circumference}
          strokeDashoffset={m.progressOffset}
          transform="rotate(-90 50 50)"
        />

        {/* Notch for expected progress (time elapsed so far) */}
        {m.showNotch && (
          <g>
            {/* Small radial marker line */}
            <line
              x1={m.notchLineX1}
              y1={m.notchLineY1}
              x2={m.notchLineX2}
              y2={m.notchLineY2}
              stroke="currentColor"
              strokeWidth={m.notchLineWidth}
              className={m.notchLineClass}
            />
            {/* Center dot at notch position */}
            <circle
              cx={m.notchX}
              cy={m.notchY}
              r={m.notchDotRadius}
              fill="currentColor"
              className={m.notchDotClass}
            />
          </g>
        )}

        {/* Center text */}
        {m.showLabel && (
          <text
            x="50"
            y="50"
            textAnchor="middle"
            dominantBaseline="central"
            className={cn('font-semibold tabular-nums fill-foreground', m.font)}
          >
            {m.label}
          </text>
        )}
      </svg>

      {/* Subtle pace hint under ring when not complete */}
      {m.showPaceHintText && (
        <span className={m.paceHintClass}>
          {m.paceArrow} expected {m.expectedPctFloor}% (time)
        </span>
      )}
    </div>
  )
}
