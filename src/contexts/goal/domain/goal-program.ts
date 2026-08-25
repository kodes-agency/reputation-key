import { calendarPeriodRange } from '#/shared/domain/period-range'

export const GOAL_METRICS = [
  'qualified_scans',
  'portal_rating_count',
  'portal_rating_average',
] as const

export type GoalMetric = (typeof GOAL_METRICS)[number]
export type GoalSubjectKind = 'property' | 'portal_group' | 'portal'
export type GoalProgramStatus = 'scheduled' | 'active' | 'paused' | 'ended'
export type GoalMonthlyResultStatus = 'open' | 'reconciling' | 'closed'

export type GoalSubject =
  | Readonly<{ kind: 'property'; propertyId: string }>
  | Readonly<{ kind: 'portal_group'; portalGroupId: string }>
  | Readonly<{ kind: 'portal'; portalId: string }>

export type GoalMetricReading = Readonly<{
  dataQuality: 'eligible' | 'updating' | 'unavailable' | 'quarantined'
  exactValue: number | null
  sampleCount: number
}>

export type GoalMetricEvaluation = Readonly<{
  state: 'eligible' | 'updating' | 'insufficient_data' | 'unavailable' | 'quarantined'
  value: number | null
  sampleCount: number
  achieved: boolean | null
  reason: string | null
}>

export type GoalAssignmentWindow = Readonly<{
  subject: GoalSubject
  metric: GoalMetric
  effectiveFrom: Date
  effectiveTo: Date | null
}>

export const RATING_AVERAGE_MINIMUM_SAMPLE = 10
export const GOAL_RECONCILIATION_DELAY_MS = 24 * 60 * 60 * 1_000

export type GoalTargetValidation =
  | Readonly<{ ok: true; normalizedTarget: number }>
  | Readonly<{
      ok: false
      reason:
        | 'target_not_finite'
        | 'count_target_not_positive_integer'
        | 'average_target_out_of_range'
        | 'average_target_precision'
    }>

export function validateGoalTarget(
  metric: GoalMetric,
  target: number,
): GoalTargetValidation {
  if (!Number.isFinite(target)) return { ok: false, reason: 'target_not_finite' }

  if (metric === 'qualified_scans' || metric === 'portal_rating_count') {
    if (!Number.isInteger(target) || target <= 0) {
      return { ok: false, reason: 'count_target_not_positive_integer' }
    }
    return { ok: true, normalizedTarget: target }
  }

  if (target < 1 || target > 5) {
    return { ok: false, reason: 'average_target_out_of_range' }
  }
  const tenths = target * 10
  if (Math.abs(tenths - Math.round(tenths)) > Number.EPSILON * 10) {
    return { ok: false, reason: 'average_target_precision' }
  }
  return { ok: true, normalizedTarget: Math.round(tenths) / 10 }
}

export function minimumSampleForGoalMetric(metric: GoalMetric): number {
  return metric === 'portal_rating_average' ? RATING_AVERAGE_MINIMUM_SAMPLE : 0
}

const noEvaluation = (
  state: Exclude<GoalMetricEvaluation['state'], 'eligible'>,
  sampleCount: number,
  reason: string,
  value: number | null = null,
): GoalMetricEvaluation => ({
  state,
  value,
  sampleCount,
  achieved: null,
  reason,
})

/**
 * Evaluate one governed monthly reading. A verified zero count is eligible,
 * while a missing or undersampled average is never coerced to zero.
 */
export function evaluateGoalMetric(
  input: Readonly<{
    metric: GoalMetric
    target: number
    reading: GoalMetricReading | null
  }>,
): GoalMetricEvaluation {
  const reading = input.reading
  if (!reading || reading.dataQuality === 'unavailable') {
    return noEvaluation('unavailable', reading?.sampleCount ?? 0, 'reading_unavailable')
  }
  if (reading.sampleCount < 0 || !Number.isInteger(reading.sampleCount)) {
    return noEvaluation('quarantined', 0, 'invalid_sample_count')
  }
  if (reading.dataQuality === 'quarantined') {
    return noEvaluation('quarantined', reading.sampleCount, 'reading_quarantined')
  }
  if (reading.dataQuality === 'updating') {
    const safeValue = validReadingValue(input.metric, reading.exactValue)
      ? reading.exactValue
      : null
    return noEvaluation('updating', reading.sampleCount, 'reading_updating', safeValue)
  }
  if (reading.sampleCount < minimumSampleForGoalMetric(input.metric)) {
    return noEvaluation(
      'insufficient_data',
      reading.sampleCount,
      'minimum_sample_not_met',
    )
  }
  if (!validReadingValue(input.metric, reading.exactValue)) {
    return noEvaluation('quarantined', reading.sampleCount, 'invalid_metric_value')
  }

  return {
    state: 'eligible',
    value: reading.exactValue,
    sampleCount: reading.sampleCount,
    achieved: reading.exactValue >= input.target,
    reason: null,
  }
}

function validReadingValue(metric: GoalMetric, value: number | null): value is number {
  if (value === null || !Number.isFinite(value)) return false
  if (metric === 'portal_rating_average') return value >= 1 && value <= 5
  return Number.isInteger(value) && value >= 0
}

/** First complete property-local month that does not start before `at`. */
export function firstFullMonthlyPeriodAtOrAfter(
  at: Date,
  timezone: string,
): Readonly<{ start: Date; end: Date }> {
  const current = calendarPeriodRange(at, timezone, 'monthly')
  if (at.getTime() === current.start.getTime()) return current
  return calendarPeriodRange(current.end, timezone, 'monthly')
}

export function isCompleteMonthlyPeriod(
  period: Readonly<{ start: Date; end: Date }>,
  timezone: string,
): boolean {
  if (period.end <= period.start) return false
  const expected = calendarPeriodRange(period.start, timezone, 'monthly')
  return (
    expected.start.getTime() === period.start.getTime() &&
    expected.end.getTime() === period.end.getTime()
  )
}

const PROGRAM_TRANSITIONS: Readonly<
  Record<GoalProgramStatus, readonly GoalProgramStatus[]>
> = {
  scheduled: ['active'],
  active: ['paused', 'ended'],
  paused: ['active', 'ended'],
  ended: [],
}

export function canTransitionGoalProgram(
  from: GoalProgramStatus,
  to: GoalProgramStatus,
): boolean {
  return from === to || PROGRAM_TRANSITIONS[from].includes(to)
}

const RESULT_TRANSITIONS: Readonly<
  Record<GoalMonthlyResultStatus, readonly GoalMonthlyResultStatus[]>
> = {
  open: ['reconciling'],
  reconciling: ['closed'],
  closed: [],
}

export function canTransitionGoalMonthlyResult(
  from: GoalMonthlyResultStatus,
  to: GoalMonthlyResultStatus,
): boolean {
  return from === to || RESULT_TRANSITIONS[from].includes(to)
}

export function parseGoalSubject(
  kind: string,
  subjectId: string,
  owningPropertyId: string,
): GoalSubject | null {
  if (subjectId.trim().length === 0) return null
  if (kind === 'property' && subjectId === owningPropertyId) {
    return { kind, propertyId: subjectId }
  }
  if (kind === 'portal_group') return { kind, portalGroupId: subjectId }
  if (kind === 'portal') return { kind, portalId: subjectId }
  return null
}

export function goalSubjectIdentity(subject: GoalSubject): string {
  switch (subject.kind) {
    case 'property':
      return `property:${subject.propertyId}`
    case 'portal_group':
      return `portal_group:${subject.portalGroupId}`
    case 'portal':
      return `portal:${subject.portalId}`
  }
}

/** Half-open effective windows conflict only for the same subject and metric. */
export function goalAssignmentsOverlap(
  left: GoalAssignmentWindow,
  right: GoalAssignmentWindow,
): boolean {
  if (
    left.metric !== right.metric ||
    goalSubjectIdentity(left.subject) !== goalSubjectIdentity(right.subject)
  ) {
    return false
  }
  const leftEnd = left.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY
  const rightEnd = right.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY
  return (
    left.effectiveFrom.getTime() < rightEnd && right.effectiveFrom.getTime() < leftEnd
  )
}

export function goalAssignmentMonthlyKey(
  assignment: Pick<GoalAssignmentWindow, 'subject' | 'metric'>,
  periodStart: Date,
): string {
  return `${goalSubjectIdentity(assignment.subject)}:${assignment.metric}:${periodStart.toISOString()}`
}

export function isGoalResultReadyToClose(
  input: Readonly<{
    periodEnd: Date
    now: Date
    sourceWatermark: Date
  }>,
): boolean {
  return (
    input.now.getTime() >= input.periodEnd.getTime() + GOAL_RECONCILIATION_DELAY_MS &&
    input.sourceWatermark >= input.periodEnd
  )
}
