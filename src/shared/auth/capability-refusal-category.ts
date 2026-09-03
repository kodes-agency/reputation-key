import { match } from 'ts-pattern'
import type { CapabilityDecision } from './beta-capabilities'
import { CAPABILITY_FATE } from '#/shared/governance/capability-fate'

export type CapabilityRefusalCategory =
  'not_in_beta' | 'needs_admin_enablement' | 'temporarily_unavailable'

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
    .with('capability_disabled', 'unknown_capability', () => 'not_in_beta')
    .with(
      'org_not_allowlisted',
      'property_not_allowlisted',
      'missing_policy',
      () => 'needs_admin_enablement',
    )
    .with('org_suspended', 'property_suspended', () => 'temporarily_unavailable')
    .exhaustive()
}

export const REFUSAL_COPY: Record<
  CapabilityRefusalCategory,
  {
    tooltip: string
    title: (feature: string) => string
    description: string
    next: 'property_settings' | null
  }
> = {
  not_in_beta: {
    tooltip: 'Not available in this beta',
    title: (feature) => `${feature} is not part of this beta`,
    description:
      'This capability is switched off for the closed beta and cannot be enabled from Settings.',
    next: null,
  },
  needs_admin_enablement: {
    tooltip: 'Not enabled for this property',
    title: (feature) => `${feature} is not enabled for this workspace`,
    description:
      'An account admin can enable it for this property from Property settings.',
    next: 'property_settings',
  },
  temporarily_unavailable: {
    tooltip: 'Temporarily unavailable',
    title: (feature) => `${feature} is temporarily unavailable`,
    description:
      'Access is paused for this workspace or property. Try again later or contact support.',
    next: null,
  },
}
