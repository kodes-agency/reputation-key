import { checkScopedCapability } from '#/shared/auth/beta-capabilities'

const PURPOSE = {
  review_analysis: 'ai.analyze',
  reply_drafting: 'ai.generate_reply',
  property_trends: 'ai.detect_trends',
} as const

type MerchantAiCapability = keyof typeof PURPOSE
type Pause = 'org_suspended' | 'policy_denied'

const pauseOf = (reason: string | undefined): Pause =>
  reason === 'org_suspended' ? 'org_suspended' : 'policy_denied'

/** Why a granted capability is paused on one Property, if it is. */
export function merchantAiPauseReason(
  record: Readonly<{
    authorization: { capabilities: readonly MerchantAiCapability[] } | null
  }>,
  organizationId: string,
  propertyId: string,
): Pause | null {
  for (const capability of record.authorization?.capabilities ?? []) {
    if (capability === 'property_trends') continue
    const decision = checkScopedCapability(
      { organizationId, propertyId },
      PURPOSE[capability],
    )
    if (!decision.allowed) return pauseOf(decision.reason)
  }
  return null
}

/** Whether a standing grant may renew; retained evidence for retired processing never pauses. */
export function merchantAiRenewalDecision(
  input: Readonly<{
    organizationId: string
    propertyId: string
    capability: MerchantAiCapability
  }>,
): 'allowed' | Pause {
  if (input.capability === 'property_trends') return 'allowed'
  const decision = checkScopedCapability(input, PURPOSE[input.capability])
  return decision.allowed ? 'allowed' : pauseOf(decision.reason)
}
