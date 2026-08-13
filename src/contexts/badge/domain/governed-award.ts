export interface GovernedAwardDefinitionSnapshot {
  readonly name: string
  readonly icon: string
  readonly criteria: string
  readonly rule: string
  readonly metricVersion: string
}

export interface GovernedGroupAward {
  readonly id: string
  readonly organizationId: string
  readonly propertyId: string
  readonly portalGroupId: string
  readonly definitionVersionId: string
  readonly metricDefinitionVersionId: string
  readonly sourceSnapshotId: string
  readonly sourceWatermark: Date
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly timezone: string
  readonly sampleCount: number
  readonly exposureCount: number
  readonly completeness: number
  readonly eligibilityReason: 'eligible'
  readonly definitionSnapshot: GovernedAwardDefinitionSnapshot
  readonly sourceFactId: string
  readonly awardedAt: Date
  readonly status: 'active'
  readonly employmentDecisionEligible: false
}

export interface AwardCorrectionFact {
  readonly awardId: string
  readonly status: 'invalidated'
  readonly correctionReference: string
  readonly reason: string
  readonly occurredAt: Date
}

export function appendAwardFact(
  input: Omit<GovernedGroupAward, 'status' | 'employmentDecisionEligible'>,
): GovernedGroupAward {
  if (input.sampleCount < 1 || input.exposureCount < 1) {
    throw new Error('award_requires_eligible_evidence')
  }
  if (input.completeness < 0 || input.completeness > 1) {
    throw new Error('award_completeness_out_of_range')
  }
  if (input.periodEnd <= input.periodStart) throw new Error('award_period_invalid')
  return { ...input, status: 'active', employmentDecisionEligible: false }
}

export function reconcileAwardCorrection(
  award: GovernedGroupAward,
  correction: Readonly<{
    correctionReference: string
    reason: string
    occurredAt: Date
  }>,
): AwardCorrectionFact {
  if (!correction.correctionReference.trim()) {
    throw new Error('award_correction_reference_required')
  }
  if (!correction.reason.trim()) throw new Error('award_correction_reason_required')
  return {
    awardId: award.id,
    status: 'invalidated',
    correctionReference: correction.correctionReference,
    reason: correction.reason,
    occurredAt: correction.occurredAt,
  }
}
