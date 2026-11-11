import type { CurrentMerchantAiCapability } from '#/contexts/identity/application/public-api'

/** Keep selection in the order and capability set of the notice on screen. */
export function toggleAiCapability(
  current: readonly CurrentMerchantAiCapability[],
  capability: CurrentMerchantAiCapability,
  checked: boolean,
  order: readonly CurrentMerchantAiCapability[],
): readonly CurrentMerchantAiCapability[] {
  const next = new Set(current)
  if (checked) {
    next.add(capability)
  } else {
    next.delete(capability)
  }
  return order.filter((candidate) => next.has(candidate))
}
