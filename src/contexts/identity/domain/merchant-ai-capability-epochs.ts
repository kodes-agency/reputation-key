import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'
import type {
  MerchantAiCapabilityEpochs,
  MerchantAiSnapshot,
} from './merchant-ai-authorization'

export function nextMerchantAiCapabilityEpochs(
  current: MerchantAiSnapshot | null,
  input: Readonly<{
    operation: 'enable' | 'change' | 'revoke'
    capabilities: ReadonlyArray<MerchantAiCapability>
    sourcePolicyId: string
    routingPolicyVersion: number
    redactionProfileFamily: string
  }>,
  sourceRebound: boolean,
  materiallyChanged: ReadonlyArray<MerchantAiCapability>,
): MerchantAiCapabilityEpochs {
  if (!current) {
    return Object.freeze({
      review_analysis: 1,
      reply_drafting: 1,
      property_trends: 1,
    })
  }

  const previous = new Set(current.capabilities)
  const next = new Set(input.capabilities)
  const incrementAll = input.operation === 'enable' || input.operation === 'revoke'
  const dataUsePolicyChanged =
    current.sourcePolicyId !== input.sourcePolicyId ||
    current.routingPolicyVersion !== input.routingPolicyVersion ||
    current.redactionProfileFamily !== input.redactionProfileFamily
  const epochFor = (capability: MerchantAiCapability): number => {
    const membershipChanged = previous.has(capability) !== next.has(capability)
    const enabledAcrossMaterialChange =
      (dataUsePolicyChanged || materiallyChanged.includes(capability)) &&
      (previous.has(capability) || next.has(capability))
    const enabledAcrossSourceRebind =
      sourceRebound && (previous.has(capability) || next.has(capability))
    return (
      current.capabilityEpochs[capability] +
      (incrementAll ||
      membershipChanged ||
      enabledAcrossMaterialChange ||
      enabledAcrossSourceRebind
        ? 1
        : 0)
    )
  }

  return Object.freeze({
    review_analysis: epochFor('review_analysis'),
    reply_drafting: epochFor('reply_drafting'),
    property_trends: epochFor('property_trends'),
  })
}
