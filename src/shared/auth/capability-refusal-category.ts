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
  'not_enabled_for_organization',
  'needs_admin_enablement',
  'temporarily_unavailable',
] as const

export type CapabilityRefusalCategory = (typeof CAPABILITY_REFUSAL_CATEGORIES)[number]

export function refusalCategory(
  decision: CapabilityDecision,
): CapabilityRefusalCategory | null {
  return (
    match<CapabilityDecision['reason'], CapabilityRefusalCategory | null>(decision.reason)
      .with('allowed', () => null)
      .with('capability_blocked', () =>
        CAPABILITY_FATE[decision.capability].fate === 'safety_blocked'
          ? 'temporarily_unavailable'
          : 'not_in_beta',
      )
      .with('capability_disabled', 'unknown_capability', () => 'not_in_beta')
      // The Organization allowlist is an operator input (ADR 0032): nothing in
      // Settings can change it, so its copy must not send the reader there.
      .with('org_not_allowlisted', () => 'not_enabled_for_organization')
      .with('property_not_allowlisted', 'missing_policy', () => 'needs_admin_enablement')
      .with('org_suspended', 'property_suspended', () => 'temporarily_unavailable')
      .exhaustive()
  )
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
  not_enabled_for_organization: {
    tooltip: 'Not enabled for your organization',
    title: (feature) => `${feature} is not enabled for your organization yet`,
    description:
      'Beta features are switched on per organization by the RepKey team, not from Settings. Contact support to have it enabled.',
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
