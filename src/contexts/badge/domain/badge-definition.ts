// POST-BETA-4 PB4.1: Badge definition and activation domain.
//
// Per ADR 0043:
// - Badges are coaching/recognition tools, not employment-decision systems.
// - Off by default — requires explicit workforce activation per property.
// - Positive only — no negative badges.
// - Versioned definitions with snapshots at award time.
// - Correctable — awards have visible invalidated/superseded status.

export type BadgeDefinitionStatus = 'draft' | 'approved' | 'retired'
export type BadgeActivationStatus = 'inactive' | 'active' | 'suspended'
export type BadgeVisibility =
  | 'recipient_only'
  | 'recipient_and_managers'
  | 'team_announcement'

export interface BadgeDefinition {
  readonly id: string
  readonly key: string
  readonly name: string
  readonly purpose: string
  readonly iconToken: string
  readonly metricDefinitionVersionId: string
  readonly thresholdRule: string
  readonly thresholdValue: number
  readonly windowDays: number
  readonly minimumSample: number
  readonly audienceDefault: BadgeVisibility
  readonly lifecycleStatus: BadgeDefinitionStatus
  readonly version: number
  readonly workerDataFlag: boolean
  readonly fairnessReviewStatus: string
  readonly policyVersion: string
}

export interface BadgeActivation {
  readonly id: string
  readonly organizationId: string
  readonly propertyId: string
  readonly definitionId: string
  readonly definitionVersion: number
  readonly status: BadgeActivationStatus
  readonly audience: BadgeVisibility
  readonly effectiveFrom: Date
  readonly effectiveTo: Date | null
  readonly activatedBy: string
  readonly activationReason: string
  readonly reviewExpiryDate: Date
  readonly acknowledgementNoEmploymentDecision: boolean
}

export type ActivationError =
  | { code: 'definition_not_approved' }
  | { code: 'already_active'; activationId: string }
  | { code: 'not_active'; status: BadgeActivationStatus }
  | { code: 'acknowledgement_required' }

export function createActivation(params: {
  id: string
  organizationId: string
  propertyId: string
  definitionId: string
  definitionVersion: number
  activatedBy: string
  activationReason: string
  audience: BadgeVisibility
  reviewExpiryDays: number
}): BadgeActivation | ActivationError {
  return {
    id: params.id,
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    definitionId: params.definitionId,
    definitionVersion: params.definitionVersion,
    status: 'active',
    audience: params.audience,
    effectiveFrom: new Date(),
    effectiveTo: null,
    activatedBy: params.activatedBy,
    activationReason: params.activationReason,
    reviewExpiryDate: new Date(Date.now() + params.reviewExpiryDays * 86400000),
    acknowledgementNoEmploymentDecision: true,
  }
}

export function suspendActivation(
  activation: BadgeActivation,
): BadgeActivation | ActivationError {
  if (activation.status !== 'active') {
    return { code: 'not_active', status: activation.status }
  }
  return { ...activation, status: 'suspended' }
}

export function resumeActivation(
  activation: BadgeActivation,
): BadgeActivation | ActivationError {
  if (activation.status !== 'suspended') {
    return { code: 'not_active', status: activation.status }
  }
  return { ...activation, status: 'active' }
}

export function isActivationActive(
  activation: BadgeActivation,
  asOf: Date = new Date(),
): boolean {
  if (activation.status !== 'active') return false
  if (activation.effectiveTo !== null && asOf >= activation.effectiveTo) return false
  return true
}
