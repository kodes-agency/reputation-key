// GoalProgressRing — derived-value model (BQC-5.3 follow-up).
//
// Pure computation extracted from the component so each unit stays under the
// fallow complexity thresholds (CRAP at 0% coverage). Every derived value the
// ring renders is computed here; the component is JSX-only. Behavior is
// preserved exactly: notch visibility thresholds (0.5/99.5), label rounding,
// aria strings, the ↑/↓/≈ pace hint, size map values, and stroke math —
// including the original's undefined notchColor for gray (no-period) pace.

import { cn } from '#/lib/utils'
import {
  computeElapsedFraction,
  computeExpectedValue,
  computePaceStatus,
  paceColor,
  paceColorClass,
  type PaceStatus,
} from '#/contexts/goal/ui/helpers'
import type { GoalStatus } from '#/contexts/goal/application/public-api'

export type GoalProgressRingProps = Readonly<{
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
  /** BQC-5.3: the render edge owns the wall clock — inject a fixed value in stories/tests for deterministic pace. */
  now?: Date
}>

export type RingModel = Readonly<{
  box: number
  stroke: number
  font: string
  radius: number
  circumference: number
  progressOffset: number
  label: string
  effectiveAria: string
  ariaValueNow: number
  ariaValueMax: number
  progressArcClass: string
  showNotch: boolean
  notchX: number
  notchY: number
  notchLineX1: number
  notchLineY1: number
  notchLineX2: number
  notchLineY2: number
  notchLineWidth: number
  notchDotRadius: number
  notchLineClass: string
  notchDotClass: string
  showLabel: boolean
  showPaceHintText: boolean
  paceHintClass: string
  paceArrow: string
  expectedPctFloor: number
}>

const SIZES = {
  sm: { box: 64, stroke: 6, font: 'text-[10px]' },
  md: { box: 88, stroke: 8, font: 'text-xs' },
  lg: { box: 112, stroke: 9, font: 'text-sm' },
} as const

const RING_COLOR: Record<string, string> = {
  green: 'stroke-green-500',
  amber: 'stroke-amber-500',
  blue: 'stroke-blue-500',
  gray: 'stroke-gray-400',
}

// Original had no gray fallback — undefined for 'no-period' pace. Keep that.
const NOTCH_COLOR: Record<string, string> = {
  green: 'stroke-green-600 dark:stroke-green-400',
  amber: 'stroke-amber-600 dark:stroke-amber-400',
  blue: 'stroke-blue-600 dark:stroke-blue-400',
}

const PACE_ARROW: Record<string, string> = {
  ahead: '↑',
  behind: '↓',
}

function paceWithoutPeriod(isComplete: boolean): PaceStatus {
  return isComplete ? 'at-target' : 'no-period'
}

/** All derived values for GoalProgressRing. Pure — `now` arrives via props. */
export function buildRingModel(props: GoalProgressRingProps & { now: Date }): RingModel {
  const {
    currentValue,
    targetValue,
    status,
    periodStart,
    periodEnd,
    expectedValue: expectedOverride,
    size = 'md',
    showLabel = true,
    ariaLabel,
    showPaceHint = true,
    now,
  } = props

  const safeTarget = Math.max(0.0001, targetValue) // avoid /0
  const pct = Math.min(100, Math.max(0, (currentValue / safeTarget) * 100))
  const pctFloor = Math.floor(pct)

  const hasExpectedPace =
    expectedOverride !== undefined || (periodStart != null && periodEnd != null)

  // Expected notch
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
    : paceWithoutPeriod(isComplete)
  const colorName = paceColor(pace)

  // Sizing (radius 42 for 100x100 viewBox gives nice stroke room)
  const { box, stroke, font } = SIZES[size]

  const radius = 42
  const circumference = 2 * Math.PI * radius
  const progressOffset = circumference * (1 - pct / 100)

  // Notch angle: -90deg start (top), clockwise
  const notchAngle = (expectedPct / 100) * 360 - 90
  const notchRad = (notchAngle * Math.PI) / 180
  const notchCos = Math.cos(notchRad)
  const notchSin = Math.sin(notchRad)
  const notchX = 50 + radius * notchCos
  const notchY = 50 + radius * notchSin

  const notchColor = NOTCH_COLOR[colorName]

  return {
    box,
    stroke,
    font,
    radius,
    circumference,
    progressOffset,
    label: isComplete ? '100%' : `${pctFloor}%`,
    effectiveAria: ariaLabel ?? `Progress: ${pctFloor}% of ${targetValue}`,
    ariaValueNow: Math.round(currentValue),
    ariaValueMax: Math.round(targetValue),
    progressArcClass: cn(RING_COLOR[colorName], isComplete && 'stroke-green-500'),
    showNotch: hasExpectedPace && expectedPct > 0.5 && expectedPct < 99.5,
    notchX,
    notchY,
    notchLineX1: 50 + (radius - 3) * notchCos,
    notchLineY1: 50 + (radius - 3) * notchSin,
    notchLineX2: 50 + (radius + 3) * notchCos,
    notchLineY2: 50 + (radius + 3) * notchSin,
    notchLineWidth: Math.max(1.5, stroke / 4),
    notchDotRadius: stroke / 3.5,
    notchLineClass: cn(notchColor, 'opacity-90'),
    notchDotClass: cn(notchColor),
    showLabel,
    showPaceHintText:
      !isComplete && hasExpectedPace && pace !== 'no-period' && showPaceHint,
    paceHintClass: cn('mt-1 text-xs font-medium', paceColorClass(colorName)),
    paceArrow: PACE_ARROW[pace] ?? '≈',
    expectedPctFloor: Math.floor(expectedPct),
  }
}
