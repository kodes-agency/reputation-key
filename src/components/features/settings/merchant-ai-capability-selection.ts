import type { CurrentMerchantAiCapability } from '#/contexts/identity/application/public-api'

/**
 * Keep a capability selection coherent: property trends are built from review
 * analysis, so choosing trends adds analysis and dropping analysis drops trends.
 * The result follows `order`, the capability order of the notice on screen.
 *
 * The property AI settings card and the setup wizard's AI question both ask for
 * capabilities under the same notice, so both toggle through this one rule.
 */
export function toggleAiCapability(
  current: readonly CurrentMerchantAiCapability[],
  capability: CurrentMerchantAiCapability,
  checked: boolean,
  order: readonly CurrentMerchantAiCapability[],
): readonly CurrentMerchantAiCapability[] {
  const next = new Set(current)
  if (checked) {
    next.add(capability)
    if (capability === 'property_trends') next.add('review_analysis')
  } else {
    next.delete(capability)
    if (capability === 'review_analysis') next.delete('property_trends')
  }
  return order.filter((candidate) => next.has(candidate))
}
