/**
 * Goal UI helpers — pure functions for formatting, sorting, and filtering goals.
 * No side effects, no DOM, safe for server and client.
 */

import type { Goal, GoalStatus } from '#/contexts/goal/application/public-api'
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
  if (targetValue === 0) return 0
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

const STATUS_ORDER: Record<GoalStatus, number> = {
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

// ── 5. filterGoalsForStaffView ─────────────────────────────────────────

const VISIBLE_STATUSES: ReadonlySet<GoalStatus> = new Set(['active', 'completed'])

export function filterGoalsForStaffView(
  goals: Goal[],
  staffIds: string[],
  teamIds: string[],
): Goal[] {
  const staffSet = new Set(staffIds)
  const teamSet = new Set(teamIds)

  return goals.filter((g) => {
    if (!VISIBLE_STATUSES.has(g.status)) return false
    const matchesStaff = g.staffId != null && staffSet.has(g.staffId)
    const matchesTeam = g.teamId != null && teamSet.has(g.teamId)
    return matchesStaff || matchesTeam
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
    case 'team':
      return 'Team'
    case 'staff':
      return 'Staff'
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
