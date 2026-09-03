import { describe, expect, it } from 'vitest'
import type {
  Capability,
  CapabilityDecision,
  CapabilityDenyReason,
} from './beta-capabilities'
import {
  REFUSAL_COPY,
  refusalCategory,
  type CapabilityRefusalCategory,
} from './capability-refusal-category'

const DENY_CASES = [
  {
    reason: 'capability_disabled',
    capability: 'goal.use',
    category: 'not_in_beta',
  },
  {
    reason: 'org_not_allowlisted',
    capability: 'goal.use',
    category: 'needs_admin_enablement',
  },
  {
    reason: 'property_not_allowlisted',
    capability: 'goal.use',
    category: 'needs_admin_enablement',
  },
  {
    reason: 'org_suspended',
    capability: 'goal.use',
    category: 'temporarily_unavailable',
  },
  {
    reason: 'property_suspended',
    capability: 'goal.use',
    category: 'temporarily_unavailable',
  },
  {
    reason: 'unknown_capability',
    capability: 'goal.use',
    category: 'not_in_beta',
  },
  {
    reason: 'missing_policy',
    capability: 'goal.use',
    category: 'needs_admin_enablement',
  },
  {
    reason: 'capability_blocked',
    capability: 'portal.upload',
    category: 'temporarily_unavailable',
  },
  {
    reason: 'capability_blocked',
    capability: 'team.use',
    category: 'not_in_beta',
  },
] satisfies ReadonlyArray<
  Readonly<{
    reason: CapabilityDenyReason
    capability: Capability
    category: CapabilityRefusalCategory
  }>
>

const deniedDecision = (
  reason: CapabilityDenyReason,
  capability: Capability,
): CapabilityDecision => ({ allowed: false, reason, capability })

describe('capability refusal category', () => {
  it.each(DENY_CASES)(
    'maps $reason for $capability to $category',
    ({ reason, capability, category }) => {
      expect(refusalCategory(deniedDecision(reason, capability))).toBe(category)
    },
  )

  it('returns no refusal category for an allowed decision', () => {
    expect(
      refusalCategory({ allowed: true, reason: 'allowed', capability: 'goal.use' }),
    ).toBeNull()
  })

  it('publishes the approved refusal copy', () => {
    expect(REFUSAL_COPY.not_in_beta).toMatchObject({
      tooltip: 'Not available in this beta',
      description:
        'This capability is switched off for the closed beta and cannot be enabled from Settings.',
      next: null,
    })
    expect(REFUSAL_COPY.not_in_beta.title('Goals')).toBe('Goals is not part of this beta')

    expect(REFUSAL_COPY.needs_admin_enablement).toMatchObject({
      tooltip: 'Not enabled for this property',
      description:
        'An account admin can enable it for this property from Property settings.',
      next: 'property_settings',
    })
    expect(REFUSAL_COPY.needs_admin_enablement.title('Goals')).toBe(
      'Goals is not enabled for this workspace',
    )

    expect(REFUSAL_COPY.temporarily_unavailable).toMatchObject({
      tooltip: 'Temporarily unavailable',
      description:
        'Access is paused for this workspace or property. Try again later or contact support.',
      next: null,
    })
    expect(REFUSAL_COPY.temporarily_unavailable.title('Goals')).toBe(
      'Goals is temporarily unavailable',
    )
  })
})
