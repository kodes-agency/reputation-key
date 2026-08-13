export const RECOGNITION_METRIC_KEYS = [
  'portal.content_review.completed',
  'portal.configuration_completeness',
  'portal.approved_destination_ratio',
] as const

export type RecognitionMetricKey = (typeof RECOGNITION_METRIC_KEYS)[number]
export type RecognitionAggregation = 'sum' | 'latest' | 'ratio'
export type RecognitionEligibilityReason =
  | 'eligible'
  | 'prohibited_metric'
  | 'prohibited_source'
  | 'consumer_not_permitted'
  | 'scope_not_permitted'
  | 'employment_decision_metric'
  | 'insufficient_sample'
  | 'insufficient_exposure'
  | 'stale'
  | 'incomplete'
  | 'unresolved_attribution'

export interface GovernedRecognitionMetric {
  readonly definitionId: string
  readonly definitionVersionId: string
  readonly metricKey: string
  readonly aggregation: RecognitionAggregation
  readonly allowedScopes: readonly string[]
  readonly sourcePolicyAllowlist: readonly string[]
  readonly permittedConsumers: readonly string[]
  readonly employmentDecisionEligible: boolean
  readonly minimumSample: number
}

export interface RecognitionCandidate {
  readonly portalGroupId: string
  readonly portalGroupLabel: string
  readonly exactValue: number
  readonly numerator: number | null
  readonly denominator: number | null
  readonly sampleCount: number
  readonly exposureCount: number
  readonly sourceWatermark: Date
  readonly completeness: number
  readonly correctionGeneration: number
  readonly attributionQuality?: 'exact' | 'current_state_backfill' | 'unresolved'
}

export interface RecognitionBoardEntry {
  readonly portalGroupId: string
  readonly portalGroupLabel: string
  readonly value: number | null
  readonly numerator: number | null
  readonly denominator: number | null
  readonly sampleCount: number
  readonly exposureCount: number
  readonly rank: number | null
  readonly tieGroup: number | null
  readonly eligibilityReason: RecognitionEligibilityReason
  readonly status: 'ranked' | 'insufficient' | 'stale' | 'corrected'
  readonly sourceWatermark: Date
  readonly completeness: number
  readonly correctionGeneration: number
  readonly employmentDecisionEligible: false
}

const PROHIBITED_METRIC_TOKENS = [
  'rating',
  'review',
  'text',
  'mention',
  'scan',
  'click',
  'sentiment',
  'ai.',
  'google',
] as const

const PROHIBITED_SOURCE_TOKENS = [
  'guest',
  'review',
  'rating',
  'mention',
  'scan',
  'click',
  'analytics',
  'worker',
  'staff',
  'employee',
  'ai',
  'google',
] as const

export function isRecognitionMetricEligible(
  metric: GovernedRecognitionMetric,
): Readonly<
  | { eligible: true; reason: 'eligible' }
  | { eligible: false; reason: RecognitionEligibilityReason }
> {
  const key = metric.metricKey.toLowerCase()
  if (
    !RECOGNITION_METRIC_KEYS.includes(metric.metricKey as RecognitionMetricKey) ||
    PROHIBITED_METRIC_TOKENS.some((token) => key.includes(token))
  ) {
    return { eligible: false, reason: 'prohibited_metric' }
  }
  if (metric.employmentDecisionEligible) {
    return { eligible: false, reason: 'employment_decision_metric' }
  }
  if (!metric.allowedScopes.includes('portal_group')) {
    return { eligible: false, reason: 'scope_not_permitted' }
  }
  if (!metric.permittedConsumers.includes('recognition')) {
    return { eligible: false, reason: 'consumer_not_permitted' }
  }
  if (
    metric.sourcePolicyAllowlist.length === 0 ||
    metric.sourcePolicyAllowlist.some((source) => {
      const normalized = source.toLowerCase()
      return PROHIBITED_SOURCE_TOKENS.some((token) => normalized.includes(token))
    })
  ) {
    return { eligible: false, reason: 'prohibited_source' }
  }
  return { eligible: true, reason: 'eligible' }
}

function candidateEligibility(
  metric: GovernedRecognitionMetric,
  candidate: RecognitionCandidate,
  minimumExposure: number,
  minimumCompleteness: number,
  freshAfter: Date,
): RecognitionEligibilityReason {
  if (candidate.attributionQuality === 'unresolved') return 'unresolved_attribution'
  if (candidate.sampleCount < metric.minimumSample) return 'insufficient_sample'
  if (candidate.exposureCount < minimumExposure) return 'insufficient_exposure'
  if (candidate.sourceWatermark < freshAfter) return 'stale'
  if (candidate.completeness < minimumCompleteness) return 'incomplete'
  return 'eligible'
}

export function evaluateRecognitionBoard(
  input: Readonly<{
    metric: GovernedRecognitionMetric
    candidates: readonly RecognitionCandidate[]
    minimumExposure: number
    minimumCompleteness: number
    freshAfter: Date
  }>,
): RecognitionBoardEntry[] {
  const metricEligibility = isRecognitionMetricEligible(input.metric)
  const entries = input.candidates.map((candidate): RecognitionBoardEntry => {
    const eligibilityReason = metricEligibility.eligible
      ? candidateEligibility(
          input.metric,
          candidate,
          input.minimumExposure,
          input.minimumCompleteness,
          input.freshAfter,
        )
      : metricEligibility.reason
    const eligible = eligibilityReason === 'eligible'
    return {
      portalGroupId: candidate.portalGroupId,
      portalGroupLabel: candidate.portalGroupLabel,
      value: eligible ? candidate.exactValue : null,
      numerator: eligible ? candidate.numerator : null,
      denominator: eligible ? candidate.denominator : null,
      sampleCount: candidate.sampleCount,
      exposureCount: candidate.exposureCount,
      rank: null,
      tieGroup: null,
      eligibilityReason,
      status:
        eligibilityReason === 'stale'
          ? 'stale'
          : eligible
            ? candidate.correctionGeneration > 0
              ? 'corrected'
              : 'ranked'
            : 'insufficient',
      sourceWatermark: candidate.sourceWatermark,
      completeness: candidate.completeness,
      correctionGeneration: candidate.correctionGeneration,
      employmentDecisionEligible: false,
    }
  })

  const rankable = entries
    .filter((entry) => entry.value !== null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  const ranks = new Map<string, { rank: number; tieGroup: number }>()
  let previousValue: number | null = null
  let rank = 0
  let tieGroup = 0
  rankable.forEach((entry, index) => {
    if (previousValue === null || entry.value !== previousValue) {
      rank = index + 1
      tieGroup += 1
      previousValue = entry.value
    }
    ranks.set(entry.portalGroupId, { rank, tieGroup })
  })

  return entries
    .map((entry) => {
      const ranked = ranks.get(entry.portalGroupId)
      return ranked ? { ...entry, ...ranked } : entry
    })
    .sort((a, b) => {
      if (a.rank === null && b.rank === null)
        return a.portalGroupLabel.localeCompare(b.portalGroupLabel)
      if (a.rank === null) return 1
      if (b.rank === null) return -1
      return a.rank - b.rank || a.portalGroupLabel.localeCompare(b.portalGroupLabel)
    })
}

export type RecognitionActivation = Readonly<{
  organizationId: string
  propertyId: string
  policyVersion: string
  jurisdiction: string
  noticeStatus: 'completed'
  consultationStatus: 'completed' | 'not_required'
  audience: 'property_managers_and_scoped_staff'
  acknowledgedBy: string
  acknowledgedAt: Date
  selectedPortalGroupIds: readonly string[]
  metricDefinitionVersionId: string
  aggregation: RecognitionAggregation
  periodKind: 'weekly' | 'monthly' | 'quarterly'
  minimumExposure: number
  minimumSample: number
  freshnessSeconds: number
  minimumCompleteness: number
  effectiveFrom: Date
  effectiveTo: Date | null
  status: 'active' | 'inactive'
  deactivationReason: string | null
  employmentDecisionEligible: false
}>

export type RecognitionActivationCommand =
  | Readonly<{
      kind: 'activate'
      organizationId: string
      propertyId: string
      policyVersion: string
      jurisdiction: string
      noticeStatus: 'completed'
      consultationStatus: 'completed' | 'not_required'
      audience: 'property_managers_and_scoped_staff'
      acknowledgedBy: string
      selectedPortalGroupIds: readonly string[]
      metricDefinitionVersionId: string
      aggregation: RecognitionAggregation
      periodKind: 'weekly' | 'monthly' | 'quarterly'
      minimumExposure: number
      minimumSample: number
      freshnessSeconds: number
      minimumCompleteness: number
      now: Date
    }>
  | Readonly<{
      kind: 'deactivate'
      reason: string
      actorId: string
      now: Date
    }>

export function transitionRecognitionActivation(
  current: RecognitionActivation | null,
  command: RecognitionActivationCommand,
): RecognitionActivation {
  if (command.kind === 'deactivate') {
    if (!current) throw new Error('recognition_activation_not_found')
    if (!command.reason.trim())
      throw new Error('recognition_deactivation_reason_required')
    return {
      ...current,
      status: 'inactive',
      effectiveTo: command.now,
      deactivationReason: command.reason.trim(),
    }
  }

  const selectedPortalGroupIds = [...new Set(command.selectedPortalGroupIds)]
  if (selectedPortalGroupIds.length === 0) {
    throw new Error('recognition_group_required')
  }
  if (!command.jurisdiction.trim()) throw new Error('recognition_jurisdiction_required')
  if (
    command.minimumExposure < 1 ||
    command.minimumSample < 1 ||
    command.freshnessSeconds < 1 ||
    command.minimumCompleteness < 0 ||
    command.minimumCompleteness > 1
  ) {
    throw new Error('recognition_thresholds_invalid')
  }
  return {
    organizationId: command.organizationId,
    propertyId: command.propertyId,
    policyVersion: command.policyVersion,
    jurisdiction: command.jurisdiction.trim(),
    noticeStatus: command.noticeStatus,
    consultationStatus: command.consultationStatus,
    metricDefinitionVersionId: command.metricDefinitionVersionId,
    aggregation: command.aggregation,
    periodKind: command.periodKind,
    minimumExposure: command.minimumExposure,
    minimumSample: command.minimumSample,
    freshnessSeconds: command.freshnessSeconds,
    minimumCompleteness: command.minimumCompleteness,
    audience: command.audience,
    acknowledgedBy: command.acknowledgedBy,
    acknowledgedAt: command.now,
    selectedPortalGroupIds,
    effectiveFrom: command.now,
    effectiveTo: null,
    status: 'active',
    deactivationReason: null,
    employmentDecisionEligible: false,
  }
}
