import type { GuestResponse } from './guest-response'

export type GuestResponseIntegrityOutcome =
  'accepted' | 'filtered_automatically' | 'under_review'

export type GuestResponseIntegrityDecisionSource =
  'system' | 'automatic' | 'reviewer' | 'migration'

export type GuestResponseIntegrityDecision = Readonly<{
  responseId: string
  organizationId: string
  propertyId: string
  portalId: string
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

export type GuestResponseIntegrityError =
  | Readonly<{ code: 'already_deleted' }>
  | Readonly<{ code: 'response_not_submitted' }>
  | Readonly<{ code: 'integrity_outcome_unchanged' }>
  | Readonly<{ code: 'invalid_integrity_reason' }>
  | Readonly<{ code: 'invalid_integrity_actor' }>
  | Readonly<{ code: 'invalid_integrity_transition' }>

export type GuestResponseIntegrityChange = Readonly<{
  response: GuestResponse
  decision: GuestResponseIntegrityDecision
}>

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

export function isRatingMetricEligible(response: GuestResponse): boolean {
  return (
    response.integrityOutcome === 'accepted' &&
    response.rating !== null &&
    response.responseConsent
  )
}

export function changeGuestResponseIntegrity(
  response: GuestResponse,
  input: Readonly<{
    outcome: GuestResponseIntegrityOutcome
    reasonCode: string
    source: 'automatic' | 'reviewer'
    actorId: string
  }>,
  decidedAt: Date,
): GuestResponseIntegrityChange | GuestResponseIntegrityError {
  if (response.status === 'deleted') return { code: 'already_deleted' }
  if (response.status === 'pending') return { code: 'response_not_submitted' }
  if (!isReasonCode(input.reasonCode)) {
    return { code: 'invalid_integrity_reason' }
  }
  if (!isActorId(input.actorId)) return { code: 'invalid_integrity_actor' }
  if (input.outcome === response.integrityOutcome) {
    return { code: 'integrity_outcome_unchanged' }
  }
  // “Filtered automatically” is evidence about an automated decision. A
  // reviewer can restore a response or move it into a value-neutral review,
  // but cannot relabel a manual exclusion as an automatic one.
  if (input.source === 'reviewer' && input.outcome === 'filtered_automatically') {
    return { code: 'invalid_integrity_transition' }
  }

  const revision = response.integrityRevision + 1
  const decision: GuestResponseIntegrityDecision = {
    responseId: response.id,
    organizationId: response.organizationId,
    propertyId: response.propertyId,
    portalId: response.portalId,
    revision,
    previousOutcome: response.integrityOutcome,
    outcome: input.outcome,
    reasonCode: input.reasonCode,
    source: input.source,
    actorId: input.actorId,
    decidedAt,
  }
  return {
    response: {
      ...response,
      integrityOutcome: input.outcome,
      integrityReasonCode: input.reasonCode,
      integrityRevision: revision,
      integrityAssessedAt: decidedAt,
    },
    decision,
  }
}
