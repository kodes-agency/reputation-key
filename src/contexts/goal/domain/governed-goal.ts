export type GoalScope =
  | Readonly<{ kind: 'property' }>
  | Readonly<{ kind: 'portal_group'; portalGroupId: string }>

/** Kept in the input union so every boundary can reject legacy individual targets explicitly. */
export type GoalScopeInput = GoalScope | Readonly<{ kind: 'portal'; portalId: string }>

export type GoalMeasureKind = 'progress' | 'level' | 'ratio'
export type GoalDefinitionStatus = 'active' | 'paused' | 'cancelled'
export type GoalPeriodStatus = 'scheduled' | 'open' | 'closed' | 'cancelled'
export type GoalEvaluationState =
  'eligible' | 'insufficient_data' | 'unavailable' | 'quarantined'

export type GovernedMetricVersion = Readonly<{
  definitionId: string
  versionId: string
  metricKey: string
  valueKind: 'counter' | 'duration' | 'level' | 'ratio' | 'average'
  allowedScopes: readonly string[]
  sourcePolicyAllowlist: readonly string[]
  permittedConsumers: readonly string[]
  minimumSample: number
  employmentDecisionEligible: boolean
}>

export type GovernedReading = Readonly<{
  id?: string
  sourceEventId?: string
  definitionVersionId?: string
  dataQuality: 'eligible' | 'quarantined' | 'unavailable'
  exactValue: number | null
  numerator: number | null
  denominator: number | null
  sampleCount: number | null
  sourcePolicy: string
  eventAt?: Date
}>

export type GoalEvaluationValue = Readonly<{
  state: GoalEvaluationState
  reason: string | null
  value: number | null
  numerator: number | null
  denominator: number | null
  sampleCount: number | null
  achieved: boolean
}>

export type DefinitionValidation =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false
      reason:
        | 'scope_not_allowed'
        | 'metric_not_goal_eligible'
        | 'metric_scope_not_allowed'
        | 'source_policy_not_allowed'
        | 'measure_kind_mismatch'
        | 'invalid_target'
    }>

export function validateGoalDefinition(input: {
  scope: GoalScopeInput
  measureKind: GoalMeasureKind
  targetValue: number
  metric: GovernedMetricVersion
  sourcePolicy: string
}): DefinitionValidation {
  if (input.scope.kind !== 'property' && input.scope.kind !== 'portal_group') {
    return { ok: false, reason: 'scope_not_allowed' }
  }
  if (
    input.metric.employmentDecisionEligible ||
    !input.metric.permittedConsumers.includes('goal')
  ) {
    return { ok: false, reason: 'metric_not_goal_eligible' }
  }
  if (!input.metric.allowedScopes.includes(input.scope.kind)) {
    return { ok: false, reason: 'metric_scope_not_allowed' }
  }
  if (!input.metric.sourcePolicyAllowlist.includes(input.sourcePolicy)) {
    return { ok: false, reason: 'source_policy_not_allowed' }
  }
  if (
    (input.measureKind === 'ratio' && input.metric.valueKind !== 'ratio') ||
    (input.measureKind === 'level' && input.metric.valueKind !== 'level') ||
    (input.measureKind === 'progress' && input.metric.valueKind === 'ratio')
  ) {
    return { ok: false, reason: 'measure_kind_mismatch' }
  }
  if (!Number.isFinite(input.targetValue) || input.targetValue <= 0) {
    return { ok: false, reason: 'invalid_target' }
  }
  return { ok: true }
}

const unavailable = (
  state: Exclude<GoalEvaluationState, 'eligible'>,
  reason: string,
): GoalEvaluationValue => ({
  state,
  reason,
  value: null,
  numerator: null,
  denominator: null,
  sampleCount: null,
  achieved: false,
})

/**
 * Evaluate one governed aggregate. Missing and ineligible data deliberately retain
 * a null value: absence is never converted to a score of zero.
 */
export function evaluateGovernedReading(input: {
  measureKind: GoalMeasureKind
  targetValue: number
  minimumSample: number
  sourcePolicy: string
  reading: GovernedReading | null
}): GoalEvaluationValue {
  const reading = input.reading
  if (!reading || reading.dataQuality === 'unavailable') {
    return unavailable('unavailable', 'reading_unavailable')
  }
  if (reading.dataQuality === 'quarantined') {
    return unavailable('quarantined', 'reading_quarantined')
  }
  if (reading.sourcePolicy !== input.sourcePolicy) {
    return unavailable('quarantined', 'source_policy_mismatch')
  }
  if ((reading.sampleCount ?? 0) < input.minimumSample) {
    return unavailable('insufficient_data', 'minimum_sample_not_met')
  }

  if (input.measureKind === 'ratio') {
    if (
      reading.numerator === null ||
      reading.denominator === null ||
      reading.denominator <= 0
    ) {
      return unavailable('quarantined', 'invalid_ratio_components')
    }
    const value = reading.numerator / reading.denominator
    return {
      state: 'eligible',
      reason: null,
      value,
      numerator: reading.numerator,
      denominator: reading.denominator,
      sampleCount: reading.sampleCount,
      achieved: value >= input.targetValue,
    }
  }

  if (reading.exactValue === null || !Number.isFinite(reading.exactValue)) {
    return unavailable('quarantined', 'invalid_exact_value')
  }
  return {
    state: 'eligible',
    reason: null,
    value: reading.exactValue,
    numerator: null,
    denominator: null,
    sampleCount: reading.sampleCount,
    achieved: reading.exactValue >= input.targetValue,
  }
}

export function correctionIdempotencyKey(input: {
  periodId: string
  sourceEventId: string
  correctedReadingId: string
}): string {
  return `goal-correction:${input.periodId}:${input.sourceEventId}:${input.correctedReadingId}`
}
