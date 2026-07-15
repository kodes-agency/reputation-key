// POST-BETA-3 PB3.3: Goal measure-kind semantics.
//
// Per ADR 0042: three measure kinds with distinct evaluation rules.
// Progress: monotonic accumulation, may achieve early.
// Level: latest snapshot, met/not_met/insufficient_data.
// Ratio: numerator/denominator with sample threshold.
//
// Separation: GoalDefinition, GoalPeriod, GoalEvaluation.

export type GoalMeasureKind = 'progress' | 'level' | 'ratio'
export type GoalDefinitionStatus =
  | 'draft'
  | 'scheduled'
  | 'active'
  | 'paused'
  | 'archived'
export type GoalDefinitionAudience = 'property' | 'portal_group'
export type GoalPeriodStatus = 'scheduled' | 'active' | 'closed'
export type GoalPeriodOutcome =
  | 'achieved'
  | 'not_achieved'
  | 'insufficient_data'
  | 'cancelled'
  | 'invalidated'
  | 'pending'

export interface GoalDefinition {
  readonly id: string
  readonly organizationId: string
  readonly metricDefinitionVersionId: string
  readonly measureKind: GoalMeasureKind
  readonly audience: GoalDefinitionAudience
  readonly targetRule: string
  readonly targetValue: number
  readonly recurrence: string | null
  readonly timezonePolicy: string
  readonly visibility: string
  readonly status: GoalDefinitionStatus
  readonly version: number
  readonly supersededBy: string | null
}

export interface GoalPeriod {
  readonly id: string
  readonly definitionId: string
  readonly definitionVersion: number
  readonly organizationId: string
  readonly propertyId: string
  readonly portalGroupId: string | null
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly timezone: string
  readonly baseline: number | null
  readonly targetSnapshot: number
  readonly status: GoalPeriodStatus
  readonly outcome: GoalPeriodOutcome
}

export interface GoalEvaluation {
  readonly id: string
  readonly periodId: string
  readonly value: number | null
  readonly sampleSize: number
  readonly completeness: number
  readonly freshness: Date
  readonly result: GoalPeriodOutcome
  readonly sourceWatermark: Date
  readonly evaluationVersion: number
  readonly correctionLink: string | null
  readonly evaluatedAt: Date
}

/**
 * Evaluate a progress goal.
 * Progress is monotonic accumulation. May achieve early.
 * A correction after close may invalidate/supersede the outcome.
 */
export function evaluateProgressGoal(
  currentValue: number,
  target: number,
  sampleSize: number,
  minimumSample: number,
  periodClosed: boolean,
): { result: GoalPeriodOutcome; achieved: boolean } {
  if (sampleSize < minimumSample && periodClosed) {
    return { result: 'insufficient_data', achieved: false }
  }
  const achieved = currentValue >= target
  if (achieved) {
    return { result: 'achieved', achieved: true }
  }
  if (periodClosed) {
    return { result: 'not_achieved', achieved: false }
  }
  return { result: 'pending', achieved: false }
}

/**
 * Evaluate a level goal.
 * Latest eligible snapshot. met/not_met/insufficient_data.
 * Does NOT permanently complete on first crossing.
 */
export function evaluateLevelGoal(
  currentValue: number | null,
  target: number,
  sampleSize: number,
  minimumSample: number,
  periodClosed: boolean,
): { result: GoalPeriodOutcome; met: boolean } {
  if (currentValue === null || sampleSize < minimumSample) {
    if (periodClosed) {
      return { result: 'insufficient_data', met: false }
    }
    return { result: 'pending', met: false }
  }
  const met = currentValue >= target
  if (periodClosed) {
    return { result: met ? 'achieved' : 'not_achieved', met }
  }
  return { result: 'pending', met }
}

/**
 * Evaluate a ratio goal.
 * Numerator/denominator with sample threshold.
 * Evaluate through the period; finalize at close.
 * Insufficient data ≠ zero.
 */
export function evaluateRatioGoal(
  numerator: number,
  denominator: number,
  target: number,
  minimumSample: number,
  periodClosed: boolean,
): { result: GoalPeriodOutcome; ratio: number | null; achieved: boolean } {
  if (denominator < minimumSample) {
    if (periodClosed) {
      return { result: 'insufficient_data', ratio: null, achieved: false }
    }
    return { result: 'pending', ratio: null, achieved: false }
  }
  const ratio = numerator / denominator
  const achieved = ratio >= target
  if (periodClosed) {
    return { result: achieved ? 'achieved' : 'not_achieved', ratio, achieved }
  }
  return { result: 'pending', ratio, achieved: false }
}

/**
 * Apply a correction after period close.
 * Per ADR 0042: appends a new evaluation and may change visible outcome
 * to invalidated/superseded.
 */
export function applyCorrectionToPeriod(
  period: GoalPeriod,
  newOutcome: GoalPeriodOutcome,
): GoalPeriod {
  return {
    ...period,
    outcome: newOutcome,
  }
}
