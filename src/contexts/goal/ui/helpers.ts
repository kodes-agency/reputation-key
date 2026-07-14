/**
 * Goal UI helpers — pure functions for formatting, sorting, and filtering goals.
 * No side effects, no DOM, safe for server and client.
 */

import type {
  Goal,
  GoalProgress,
  GoalStatus,
  GoalType,
} from '#/contexts/goal/application/public-api'
import type {
  MetricKey,
  AggregationFunction,
  EntityScope,
} from '#/shared/domain/metric-keys'
import {
  VALID_SCOPE_METRIC_KEYS,
  VALID_METRIC_AGGREGATIONS,
  DEFAULT_AGGREGATION,
} from '#/shared/domain/metric-keys'

// ── Number formatting ──────────────────────────────────────────────────

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

// ── 1. formatProgressLabel ─────────────────────────────────────────────

export function formatProgressLabel(
  currentValue: number,
  targetValue: number,
  aggregation: AggregationFunction,
): string {
  const cur = formatNum(currentValue)
  const tgt = formatNum(targetValue)

  switch (aggregation) {
    case 'avg':
      return `${cur} avg / ${tgt} target`
    case 'max':
      return `${cur} best / ${tgt} target`
    case 'sum':
    case 'count':
    default:
      return `${cur} / ${tgt}`
  }
}

// ── 2. progressBarWidth ────────────────────────────────────────────────

export function progressBarWidth(currentValue: number, targetValue: number): number {
  if (targetValue <= 0) return 0
  return Math.min(100, Math.floor((currentValue / targetValue) * 100))
}

// ── 3. progressBarColor ────────────────────────────────────────────────

export function progressBarColor(
  status: GoalStatus,
  currentValue: number,
  targetValue: number,
): string {
  if (status === 'completed') return 'green'
  if (status === 'expired' || status === 'cancelled') return 'gray'
  // active
  return currentValue >= targetValue ? 'green' : 'blue'
}

// ── 4. sortGoalsByStatus ───────────────────────────────────────────────

export const STATUS_ORDER: Record<GoalStatus, number> = {
  active: 0,
  completed: 1,
  expired: 2,
  cancelled: 3,
}

export function sortGoalsByStatus(goals: Goal[]): Goal[] {
  return [...goals].sort((a, b) => {
    const bucketDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    if (bucketDiff !== 0) return bucketDiff
    // Newest first within bucket
    return b.createdAt.getTime() - a.createdAt.getTime()
  })
}

// ── 5. filterGoalsForPortalGroupView ──────────────────────────────────

const VISIBLE_STATUSES: ReadonlySet<GoalStatus> = new Set(['active', 'completed'])

export function filterGoalsForPortalGroupView(
  goals: Goal[],
  portalGroupIds: string[],
): Goal[] {
  const groupSet = new Set(portalGroupIds)

  return goals.filter((g) => {
    if (!VISIBLE_STATUSES.has(g.status)) return false
    return g.portalGroupId != null && groupSet.has(g.portalGroupId)
  })
}

// ── 6. getMetricKeysForScope ───────────────────────────────────────────

export function getMetricKeysForScope(scope: EntityScope): MetricKey[] {
  return [...VALID_SCOPE_METRIC_KEYS[scope]]
}

// ── 7. getDefaultAggregationForKey ─────────────────────────────────────

export function getDefaultAggregationForKey(key: MetricKey): AggregationFunction {
  return DEFAULT_AGGREGATION[key]
}

// ── 8. getValidAggregationsForKey ──────────────────────────────────────

export function getValidAggregationsForKey(key: MetricKey): AggregationFunction[] {
  return [...VALID_METRIC_AGGREGATIONS[key]]
}

// ── 9. daysRemaining ───────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000

export function daysRemaining(periodEnd: Date | null): number | null {
  if (periodEnd === null) return null
  const now = new Date()
  return Math.ceil((periodEnd.getTime() - now.getTime()) / MS_PER_DAY)
}

// ── 10. formatPeriodDates ──────────────────────────────────────────────

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

function formatDatePart(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export function formatPeriodDates(start: Date | null, end: Date | null): string {
  if (start === null && end === null) return ''
  if (start !== null && end !== null) {
    return `${formatDatePart(start)} – ${formatDatePart(end)}`
  }
  if (start !== null) return `${formatDatePart(start)} –`
  return `– ${formatDatePart(end!)}`
}

// ── 11. Status badge helpers ──────────────────────────────────────────

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

export function statusBadgeVariant(status: GoalStatus): BadgeVariant {
  switch (status) {
    case 'active':
      return 'default'
    case 'completed':
      return 'secondary'
    case 'cancelled':
      return 'destructive'
    case 'expired':
      return 'outline'
  }
}

export function statusLabel(status: GoalStatus): string {
  switch (status) {
    case 'active':
      return 'Active'
    case 'completed':
      return 'Completed'
    case 'cancelled':
      return 'Cancelled'
    case 'expired':
      return 'Expired'
  }
}

// ── 12. Scope / type / aggregation labels ─────────────────────────────

export function scopeLabel(scope: EntityScope): string {
  switch (scope) {
    case 'property':
      return 'Property'
    case 'portal':
      return 'Portal'
    case 'portal_group':
      return 'Portal Group'
  }
}

export function goalTypeLabel(type: string): string {
  switch (type) {
    case 'open':
      return 'Open'
    case 'one_shot':
      return 'One-shot'
    case 'rolling':
      return 'Rolling'
    case 'recurring':
      return 'Recurring'
    default:
      return type
  }
}

export function aggregationLabel(agg: AggregationFunction): string {
  switch (agg) {
    case 'sum':
      return 'Sum'
    case 'count':
      return 'Count'
    case 'max':
      return 'Max'
    case 'avg':
      return 'Average'
  }
}

// ── Friendly metric metadata (plain-language labels for the create flow) ──

export type MetricMeta = Readonly<{
  label: string
  description: string
  /** Unit suffix shown next to the target value, e.g. "scans" or "★". */
  unit: string
  /** True when the metric is a count (sum/count are equivalent; aggregation hidden). */
  isCountMetric: boolean
}>

export const METRIC_META: Readonly<Record<MetricKey, MetricMeta>> = {
  'portal.scan': {
    label: 'Scans',
    description: 'QR-code scans of your portal',
    unit: 'scans',
    isCountMetric: true,
  },
  'portal.rating': {
    label: 'Private guest ratings',
    description: 'Private 1–5 star ratings left by guests',
    unit: '★',
    isCountMetric: false,
  },
  'portal.feedback': {
    label: 'Feedback',
    description: 'Private feedback submissions',
    unit: 'responses',
    isCountMetric: true,
  },
  'portal.review_link_click': {
    label: 'Review-link clicks',
    description: 'Guests who opened your external review link',
    unit: 'clicks',
    isCountMetric: true,
  },
  'property.review': {
    label: 'Google reviews',
    description: 'Public Google reviews for this property',
    unit: 'reviews',
    isCountMetric: false,
  },
}

export function metricLabel(key: MetricKey): string {
  return METRIC_META[key].label
}

export function metricUnit(key: MetricKey): string {
  return METRIC_META[key].unit
}

/** Plain-language description of what each goal type means, for the timeframe step. */
export function goalTypeDescription(type: GoalType): string {
  switch (type) {
    case 'open':
      return 'Ongoing — no end date or reset.'
    case 'one_shot':
      return 'Hit the target once, between two dates.'
    case 'rolling':
      return 'Always tracked over the last N days.'
    case 'recurring':
      return 'Resets on a weekly, monthly, or quarterly cycle.'
  }
}

/** Metrics whose avg/max is a star rating (★), distinct from their count noun. */
const RATING_METRICS: ReadonlySet<MetricKey> = new Set([
  'portal.rating',
  'property.review',
])

export function isRatingMetric(key: MetricKey): boolean {
  return RATING_METRICS.has(key)
}

/** Plain-language "what's being measured" for a metric + aggregation.
 *  Shared by the create-flow preview and describeGoal so they never drift. */
export function measureLabel(
  metricKey: MetricKey | null,
  aggregation: AggregationFunction,
): string {
  if (!metricKey) return 'Your goal'
  if (!isRatingMetric(metricKey)) {
    return `total ${METRIC_META[metricKey].label.toLowerCase()}`
  }
  switch (aggregation) {
    case 'avg':
      return 'average rating'
    case 'max':
      return 'highest rating'
    case 'count':
      return `number of ${METRIC_META[metricKey].label.toLowerCase()}`
    default:
      return 'rating'
  }
}

/** Target unit adapted to metric + aggregation: ★ for avg/max of rating metrics,
 *  the count noun for counted ratings, else the metric unit. */
export function targetUnit(
  metricKey: MetricKey,
  aggregation: AggregationFunction,
): string {
  if (!isRatingMetric(metricKey)) return METRIC_META[metricKey].unit
  if (aggregation === 'count')
    return metricKey === 'portal.rating' ? 'ratings' : 'reviews'
  return '★'
}

/** Dropdown label for a rating metric's aggregation option (the "Measured by" selector). */
export function ratingAggOptionLabel(
  metricKey: MetricKey | null,
  aggregation: AggregationFunction,
): string {
  if (aggregation === 'count')
    return `Number of ${metricKey === 'portal.rating' ? 'ratings' : 'reviews'}`
  return `${aggregation === 'avg' ? 'Average' : 'Highest'} rating`
}

/** Plain-language one-line summary of an existing goal, mirroring the create-flow preview.
 *  e.g. "total scans — target 50 scans — resets monthly". */
export function describeGoal(goal: Goal): string {
  const measure = measureLabel(goal.metricKey, goal.aggregationFunction)
  const unit = targetUnit(goal.metricKey, goal.aggregationFunction)
  const target = `${goal.targetValue.toLocaleString()}${unit ? ` ${unit}` : ''}`
  const timeframe = (() => {
    switch (goal.goalType) {
      case 'one_shot':
        return formatPeriodDates(goal.periodStart, goal.periodEnd) || 'between two dates'
      case 'recurring':
        return `resets ${goal.recurrenceRule?.frequency ?? 'monthly'}`
      case 'rolling':
        return goal.rollingWindowDays
          ? `last ${goal.rollingWindowDays} days`
          : 'rolling window'
      case 'open':
        return 'ongoing'
    }
  })()
  return `${measure} — target ${target} — ${timeframe}`
}

// ── 13. Color class from color name ───────────────────────────────────

export function progressBarColorClass(color: string): string {
  switch (color) {
    case 'green':
      return 'bg-green-500'
    case 'blue':
      return 'bg-blue-500'
    case 'gray':
    default:
      return 'bg-gray-300'
  }
}

// ── 14. formatDate ────────────────────────────────────────────────────

export function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// ── 15. Re-exported shared types ────────────────────────────────────

export type { GoalWithProgress } from '#/contexts/goal/application/use-cases/list-goals'

// ── Time-based expected / pace (notch shows progress expected from time elapsed) ──

/** Returns true when the goal has a bounded period usable for time-based expected calculations. */
export function hasPeriod(goal: Goal): boolean {
  return goal.periodStart != null && goal.periodEnd != null
}

/**
 * Compute elapsed time fraction [0, 1] for expected progress based on time passed.
 * Clamped. Returns 0 for goals without both period dates.
 */
export function computeElapsedFraction(
  periodStart: Date | null,
  periodEnd: Date | null,
  now: Date = new Date(),
): number {
  if (!periodStart || !periodEnd) return 0
  const totalMs = periodEnd.getTime() - periodStart.getTime()
  if (totalMs <= 0) return 1
  const elapsedMs = now.getTime() - periodStart.getTime()
  return Math.max(0, Math.min(1, elapsedMs / totalMs))
}

/** Expected value = elapsedFraction * target (clamped to [0, target]). This is the "on pace" target based on time passed. */
export function computeExpectedValue(
  targetValue: number,
  elapsedFraction: number,
): number {
  if (targetValue <= 0) return 0
  return Math.min(targetValue, elapsedFraction * targetValue)
}

export type PaceStatus = 'ahead' | 'on-pace' | 'behind' | 'at-target' | 'no-period'

/**
 * Compute pace relative to expected (based on time elapsed).
 * Tolerance ~2% of target to classify "on-pace".
 */
export function computePaceStatus(
  currentValue: number,
  expectedValue: number,
  targetValue: number,
  status: GoalStatus,
): PaceStatus {
  if (status === 'completed') return 'at-target'
  if (status !== 'active' || targetValue <= 0) return 'no-period'

  const tolerance = Math.max(0.5, targetValue * 0.02) // at least 0.5 units
  if (currentValue >= targetValue) return 'at-target'

  const diff = currentValue - expectedValue
  if (diff >= tolerance) return 'ahead'
  if (diff <= -tolerance) return 'behind'
  return 'on-pace'
}

export function paceLabel(status: PaceStatus): string {
  switch (status) {
    case 'ahead':
      return 'Ahead (time)'
    case 'on-pace':
      return 'On pace (time)'
    case 'behind':
      return 'Behind (time)'
    case 'at-target':
      return 'Target reached'
    case 'no-period':
    default:
      return ''
  }
}

export function paceColor(status: PaceStatus): string {
  switch (status) {
    case 'ahead':
    case 'at-target':
      return 'green'
    case 'on-pace':
      return 'blue'
    case 'behind':
      return 'amber'
    case 'no-period':
    default:
      return 'gray'
  }
}

export function paceColorClass(color: string): string {
  switch (color) {
    case 'green':
      return 'text-green-600 dark:text-green-400'
    case 'blue':
      return 'text-blue-600 dark:text-blue-400'
    case 'amber':
      return 'text-amber-600 dark:text-amber-400'
    case 'gray':
    default:
      return 'text-muted-foreground'
  }
}

export type GoalListView = 'active' | 'history'
export type HistoryGoalStatus = Exclude<GoalStatus, 'active'>
export type GoalAttention = 'needs-attention' | 'on-track' | 'other'

export type GoalPresentation = Readonly<{
  currentValue: number
  targetValue: number
  unit: string
  progressPercent: number
  progressLabel: string
  progressCompactLabel: string
  timeframeLabel: string
  remainingLabel: string
  pace: PaceStatus
  paceLabel: string
  statusMessage: string
  attention: GoalAttention
  sortPriority: number
  expectedValue: number | null
  expectedPercent: number | null
  showExpectedMarker: boolean
}>

function formatGoalValue(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function formatUnitValue(value: number, unit: string): string {
  const formatted = formatGoalValue(value)
  return unit ? `${formatted} ${unit}` : formatted
}

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / MS_PER_DAY)
}

function recurrenceLabel(goal: Goal): string {
  const frequency = goal.recurrenceRule?.frequency
  if (!frequency) return 'Recurring schedule'
  return `Resets ${frequency}`
}

function timeframeLabel(goal: Goal): string {
  if (goal.goalType === 'rolling') {
    return goal.rollingWindowDays
      ? `Last ${goal.rollingWindowDays} days`
      : 'Rolling window'
  }
  if (goal.goalType === 'open') return 'Ongoing'
  if (goal.goalType === 'recurring' && goal.parentGoalId === null) {
    return recurrenceLabel(goal)
  }
  return formatPeriodDates(goal.periodStart, goal.periodEnd) || 'No timeframe'
}

function remainingLabelForGoal(goal: Goal, now: Date): string {
  if (goal.status === 'completed') {
    return goal.completedAt ? `Completed ${formatDate(goal.completedAt)}` : 'Completed'
  }
  if (goal.status === 'expired') {
    return goal.periodEnd ? `Ended ${formatDate(goal.periodEnd)}` : 'Expired'
  }
  if (goal.status === 'cancelled') return 'Cancelled'
  if (goal.goalType === 'rolling') return 'Rolling window'
  if (goal.goalType === 'open') return 'No deadline'
  if (goal.goalType === 'recurring' && goal.parentGoalId === null) {
    return 'Current period'
  }
  if (!goal.periodStart || !goal.periodEnd) return 'No deadline'

  if (now.getTime() < goal.periodStart.getTime()) {
    return `Starts ${formatDate(goal.periodStart)}`
  }

  const remaining = daysBetween(now, goal.periodEnd)
  if (remaining < 0) return 'Period ended'
  if (remaining === 0) return 'Ends today'
  if (remaining === 1) return '1 day remaining'
  return `${remaining} days remaining`
}

function isBoundedActivePeriod(goal: Goal, now: Date): boolean {
  if (goal.status !== 'active') return false
  if (!goal.periodStart || !goal.periodEnd) return false
  if (goal.periodEnd.getTime() <= goal.periodStart.getTime()) return false
  return now.getTime() >= goal.periodStart.getTime()
}

function paceMessage(
  pace: PaceStatus,
  currentValue: number,
  expectedValue: number | null,
  targetValue: number,
  unit: string,
): string {
  if (pace === 'at-target') return 'Target reached'
  if (expectedValue === null) return ''
  const delta = Math.abs(currentValue - expectedValue)
  if (pace === 'ahead') return `Ahead by ${formatUnitValue(delta, unit)}`
  if (pace === 'behind') return `Behind by ${formatUnitValue(delta, unit)}`
  if (pace === 'on-pace') return 'On pace'
  if (targetValue <= 0) return ''
  return ''
}

function statusMessageForGoal(
  goal: Goal,
  currentValue: number,
  targetValue: number,
  unit: string,
  paceMessageText: string,
  now: Date,
): string {
  const progressText = `${formatUnitValue(currentValue, unit)} of ${formatUnitValue(
    targetValue,
    unit,
  )}`

  if (goal.status === 'completed') return `Finished at ${progressText}`
  if (goal.status === 'expired') {
    const shortfall = Math.max(0, targetValue - currentValue)
    return shortfall > 0
      ? `Ended ${formatUnitValue(shortfall, unit)} short`
      : `Ended at ${progressText}`
  }
  if (goal.status === 'cancelled') return `Stopped at ${progressText}`
  if (paceMessageText) return paceMessageText
  if (goal.periodStart && now.getTime() < goal.periodStart.getTime()) {
    return 'Not started yet'
  }
  if (goal.goalType === 'rolling') return 'Rolling target'
  if (goal.goalType === 'recurring' && goal.parentGoalId === null) {
    return 'Current period progress'
  }
  if (goal.goalType === 'open') return 'Ongoing target'
  return 'Progress is being tracked'
}

function sortPriorityForGoal(
  goal: Goal,
  attention: GoalAttention,
  pace: PaceStatus,
): number {
  if (goal.status !== 'active') {
    return STATUS_ORDER[goal.status] * 1_000_000 - goal.updatedAt.getTime() / 1000
  }

  const attentionOrder: Record<GoalAttention, number> = {
    'needs-attention': 0,
    'on-track': 1,
    other: 2,
  }
  const paceOrder: Record<PaceStatus, number> = {
    behind: 0,
    'on-pace': 1,
    'at-target': 2,
    ahead: 3,
    'no-period': 4,
  }
  const deadlineRank = goal.periodEnd
    ? Math.max(0, goal.periodEnd.getTime() / 1000)
    : Number.MAX_SAFE_INTEGER

  return (
    attentionOrder[attention] * 10_000_000_000 +
    paceOrder[pace] * 1_000_000 +
    deadlineRank
  )
}

export function getGoalPresentation(
  goal: Goal,
  progress: GoalProgress | null,
  now: Date = new Date(),
): GoalPresentation {
  const currentValue = progress?.currentValue ?? 0
  const targetValue = goal.targetValue
  const unit = targetUnit(goal.metricKey, goal.aggregationFunction)
  const progressPercent = progressBarWidth(currentValue, targetValue)
  const progressCompactLabel = `${formatGoalValue(currentValue)} / ${formatGoalValue(
    targetValue,
  )}`
  const progressLabel = `${formatUnitValue(currentValue, unit)} of ${formatUnitValue(
    targetValue,
    unit,
  )}`

  const canMeasureTimePace = isBoundedActivePeriod(goal, now)
  const elapsedFraction = canMeasureTimePace
    ? computeElapsedFraction(goal.periodStart, goal.periodEnd, now)
    : 0
  const expectedValue = canMeasureTimePace
    ? computeExpectedValue(targetValue, elapsedFraction)
    : null
  const expectedPercent =
    expectedValue !== null && targetValue > 0
      ? Math.min(100, Math.max(0, (expectedValue / targetValue) * 100))
      : null

  const pace =
    goal.status === 'completed' || currentValue >= targetValue
      ? 'at-target'
      : expectedValue !== null
        ? computePaceStatus(currentValue, expectedValue, targetValue, goal.status)
        : 'no-period'

  const paceLabelText = paceMessage(pace, currentValue, expectedValue, targetValue, unit)
  const periodEndedBehind =
    goal.status === 'active' &&
    goal.periodEnd !== null &&
    now.getTime() > goal.periodEnd.getTime() &&
    currentValue < targetValue
  const attention: GoalAttention =
    pace === 'behind' || periodEndedBehind
      ? 'needs-attention'
      : pace === 'ahead' || pace === 'on-pace' || pace === 'at-target'
        ? 'on-track'
        : 'other'

  return {
    currentValue,
    targetValue,
    unit,
    progressPercent,
    progressLabel,
    progressCompactLabel,
    timeframeLabel: timeframeLabel(goal),
    remainingLabel: remainingLabelForGoal(goal, now),
    pace,
    paceLabel: paceLabelText,
    statusMessage: statusMessageForGoal(
      goal,
      currentValue,
      targetValue,
      unit,
      paceLabelText,
      now,
    ),
    attention,
    sortPriority: sortPriorityForGoal(goal, attention, pace),
    expectedValue,
    expectedPercent,
    showExpectedMarker:
      expectedPercent !== null && expectedPercent > 0.5 && expectedPercent < 99.5,
  }
}
