// POST-BETA-4 PB4.1: Badge award snapshot and visible status.
//
// Per ADR 0043:
// - BadgeAwarded is an immutable historical fact.
// - BadgeAwardStatus is the current truthful presentation.
// - Awards snapshot definition name/icon/purpose/rule at award time —
//   they never depend on a mutable definition join for historical display.
// - Invalidation is factual and neutral, not punitive.
// - Physical deletion only through approved privacy/lifecycle workflow.

export type BadgeAwardStatus = 'active' | 'invalidated' | 'superseded' | 'hidden'

export interface BadgeAwardSnapshot {
  readonly definitionName: string
  readonly definitionPurpose: string
  readonly iconToken: string
  readonly thresholdRule: string
  readonly metricVersion: string
  readonly audience: string
}

export interface BadgeAward {
  readonly id: string
  readonly organizationId: string
  readonly propertyId: string
  readonly definitionId: string
  readonly definitionVersion: number
  readonly recipientStaffParticipationId: string
  readonly scopeType: 'property' | 'portal_group' | 'portal'
  readonly scopeId: string
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly timezone: string
  readonly sourceWatermark: Date
  readonly sampleSize: number
  readonly opportunitySize: number
  readonly completeness: number
  readonly evidenceSummary: string
  readonly evaluatorVersion: string
  readonly awardedAt: Date
  readonly snapshot: BadgeAwardSnapshot
  readonly status: BadgeAwardStatus
  readonly invalidatedAt: Date | null
  readonly invalidatedBy: string | null
  readonly invalidationReason: string | null
  readonly correctionReference: string | null
  readonly hiddenAt: Date | null
  readonly hiddenBy: string | null
}

export type AwardError =
  | { code: 'already_invalidated' }
  | { code: 'already_hidden' }
  | { code: 'invalid_status_for_operation'; status: BadgeAwardStatus }

export function createAward(params: {
  id: string
  organizationId: string
  propertyId: string
  definitionId: string
  definitionVersion: number
  recipientStaffParticipationId: string
  scopeType: 'property' | 'portal_group' | 'portal'
  scopeId: string
  periodStart: Date
  periodEnd: Date
  timezone: string
  sourceWatermark: Date
  sampleSize: number
  opportunitySize: number
  completeness: number
  evidenceSummary: string
  evaluatorVersion: string
  snapshot: BadgeAwardSnapshot
}): BadgeAward {
  return {
    ...params,
    awardedAt: new Date(),
    status: 'active',
    invalidatedAt: null,
    invalidatedBy: null,
    invalidationReason: null,
    correctionReference: null,
    hiddenAt: null,
    hiddenBy: null,
  }
}

/**
 * Invalidate an award. The award remains visible with a neutral reason.
 * Per ADR 0043: invalidation is factual and neutral, not punitive.
 */
export function invalidateAward(
  award: BadgeAward,
  invalidatedBy: string,
  reason: string,
  correctionReference?: string,
): BadgeAward | AwardError {
  if (award.status === 'invalidated') {
    return { code: 'already_invalidated' }
  }
  if (award.status === 'hidden') {
    return { code: 'invalid_status_for_operation', status: award.status }
  }
  return {
    ...award,
    status: 'invalidated',
    invalidatedAt: new Date(),
    invalidatedBy,
    invalidationReason: reason,
    correctionReference: correctionReference ?? null,
  }
}

/**
 * Supersede an award (e.g., when a new version replaces it).
 */
export function supersedeAward(
  award: BadgeAward,
  replacementAwardId: string,
): BadgeAward | AwardError {
  if (award.status === 'invalidated') {
    return { code: 'already_invalidated' }
  }
  return {
    ...award,
    status: 'superseded',
    correctionReference: replacementAwardId,
  }
}

/**
 * Hide an award from wider staff views (recipient opt-out).
 * Per ADR 0043: a recipient can hide their recognition where required.
 */
export function hideAward(award: BadgeAward, hiddenBy: string): BadgeAward | AwardError {
  if (award.status === 'hidden') {
    return { code: 'already_hidden' }
  }
  return {
    ...award,
    status: 'hidden',
    hiddenAt: new Date(),
    hiddenBy,
  }
}

/**
 * Unhide a previously hidden award.
 */
export function unhideAward(award: BadgeAward): BadgeAward | AwardError {
  if (award.status !== 'hidden') {
    return { code: 'invalid_status_for_operation', status: award.status }
  }
  return {
    ...award,
    status: 'active',
    hiddenAt: null,
    hiddenBy: null,
  }
}

/**
 * Check if an award should be visible to a given audience.
 */
export function isVisibleTo(
  award: BadgeAward,
  audience: 'recipient' | 'manager' | 'other_staff',
): boolean {
  if (award.status === 'hidden' && audience !== 'recipient') return false
  if (award.status === 'hidden' && audience === 'recipient') return true
  return true
}
