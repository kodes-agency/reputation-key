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
    reason: 'org_suspended',
    capability: 'goal.use',
    category: 'temporarily_unavailable',
  },
  {
    reason: 'capability_blocked',
    capability: 'portal.guest_contact',
    category: 'temporarily_unavailable',
  },
  {
    reason: 'capability_blocked',
    capability: 'identity.register',
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
    expect(REFUSAL_COPY.not_in_beta).toEqual({
      tooltip: 'Not available in this beta',
      title: expect.any(Function),
      description:
        'This capability is switched off for the closed beta and cannot be enabled from Settings.',
    })
    expect(REFUSAL_COPY.not_in_beta.title('Goals')).toBe('Goals is not part of this beta')

    expect(REFUSAL_COPY.temporarily_unavailable).toEqual({
      tooltip: 'Temporarily unavailable',
      title: expect.any(Function),
      description:
        'Access is paused for this workspace or property. Try again later or contact support.',
    })
    expect(REFUSAL_COPY.temporarily_unavailable.title('Goals')).toBe(
      'Goals is temporarily unavailable',
    )
  })
})
