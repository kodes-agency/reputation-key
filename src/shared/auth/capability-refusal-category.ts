import { match } from 'ts-pattern'
import type { CapabilityDecision } from './beta-capabilities'
import { CAPABILITY_FATE } from '#/shared/governance/capability-fate'

/**
 * Why a capability is refused, in the terms the reader can act on. Every
 * surface that carries a category (the `/unavailable` URL included) derives
 * from this list, so a new category cannot be silently dropped.
 */
export const CAPABILITY_REFUSAL_CATEGORIES = [
  'not_in_beta',
  'temporarily_unavailable',
] as const

export type CapabilityRefusalCategory = (typeof CAPABILITY_REFUSAL_CATEGORIES)[number]

export function refusalCategory(
  decision: CapabilityDecision,
): CapabilityRefusalCategory | null {
  return match<CapabilityDecision['reason'], CapabilityRefusalCategory | null>(
    decision.reason,
  )
    .with('allowed', () => null)
    .with('capability_blocked', () =>
      CAPABILITY_FATE[decision.capability].fate === 'safety_blocked'
        ? 'temporarily_unavailable'
        : 'not_in_beta',
    )
    .with('capability_disabled', () => 'not_in_beta')
    .with('org_suspended', () => 'temporarily_unavailable')
    .exhaustive()
}

export const REFUSAL_COPY: Record<
  CapabilityRefusalCategory,
  {
    tooltip: string
    title: (feature: string) => string
    description: string
  }
> = {
  not_in_beta: {
    tooltip: 'Not available in this beta',
    title: (feature) => `${feature} is not part of this beta`,
    description:
      'This capability is switched off for the closed beta and cannot be enabled from Settings.',
  },
  temporarily_unavailable: {
    tooltip: 'Temporarily unavailable',
    title: (feature) => `${feature} is temporarily unavailable`,
    description:
      'Access is paused for this workspace or property. Try again later or contact support.',
  },
}
