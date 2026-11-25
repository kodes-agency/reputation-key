import type { GuestResponse } from './guest-response'
import type {
  GuestResponseId,
  OrganizationId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'

export type GuestResponseIntegrityOutcome =
  'accepted' | 'filtered_automatically' | 'under_review'

export type GuestResponseIntegrityDecisionSource =
  'system' | 'automatic' | 'reviewer' | 'migration'

export type GuestResponseIntegrityDecision = Readonly<{
  responseId: GuestResponseId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  revision: number
  previousOutcome: GuestResponseIntegrityOutcome | null
  outcome: GuestResponseIntegrityOutcome
  reasonCode: string
  source: GuestResponseIntegrityDecisionSource
  actorId: string
  decidedAt: Date
}>

export type GuestResponseInitialIntegrityAssessment = Readonly<{
  outcome: GuestResponseIntegrityOutcome
  reasonCode: string
  source: 'system' | 'automatic'
  actorId: string
}>

export const DEFAULT_GUEST_RESPONSE_INTEGRITY_ASSESSMENT = {
  outcome: 'accepted',
  reasonCode: 'initial_submission',
  source: 'system',
  actorId: 'guest.gateway',
} as const satisfies GuestResponseInitialIntegrityAssessment

const LOWER_ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyz0123456789'
const ACTOR_CHARACTERS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:@/-'

function isReasonCode(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 100 ||
    value.startsWith('_') ||
    value.endsWith('_') ||
    value.includes('__')
  ) {
    return false
  }
  for (const character of value) {
    if (character !== '_' && !LOWER_ALPHANUMERIC.includes(character)) return false
  }
  return true
}

function isActorId(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 255 ||
    !LOWER_ALPHANUMERIC.includes(value[0]!.toLowerCase())
  ) {
    return false
  }
  for (const character of value) {
    if (!ACTOR_CHARACTERS.includes(character)) return false
  }
  return true
}

export function initialGuestResponseIntegrityDecision(
  response: GuestResponse,
  assessment: GuestResponseInitialIntegrityAssessment = DEFAULT_GUEST_RESPONSE_INTEGRITY_ASSESSMENT,
): GuestResponseIntegrityDecision {
  if (
    response.integrityRevision !== 1 ||
    response.integrityOutcome !== assessment.outcome ||
    response.integrityReasonCode !== assessment.reasonCode ||
    !isReasonCode(assessment.reasonCode) ||
    !isActorId(assessment.actorId)
  ) {
    throw new Error('Guest response initial integrity assessment is invalid')
  }
  return {
    responseId: response.id,
    organizationId: response.organizationId,
    propertyId: response.propertyId,
    portalId: response.portalId,
    revision: response.integrityRevision,
    previousOutcome: null,
    outcome: response.integrityOutcome,
    reasonCode: response.integrityReasonCode,
    source: assessment.source,
    actorId: assessment.actorId,
    decidedAt: response.integrityAssessedAt,
  }
}

export function isRatingMetricEligible(
  response: GuestResponse,
): response is GuestResponse & { readonly rating: number } {
  return (
    response.integrityOutcome === 'accepted' &&
    response.rating !== null &&
    response.responseConsent
  )
}
