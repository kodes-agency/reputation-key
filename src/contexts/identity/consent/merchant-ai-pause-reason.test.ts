import { beforeEach, describe, expect, it, vi } from 'vitest'

const check = vi.hoisted(() => vi.fn())
vi.mock('#/shared/auth/beta-capabilities', () => ({ checkScopedCapability: check }))

import {
  merchantAiPauseReason,
  merchantAiRenewalDecision,
} from './merchant-ai-pause-reason.server'

const record = (
  ...capabilities: ('review_analysis' | 'reply_drafting' | 'property_trends')[]
) => ({
  authorization: { capabilities },
})

describe('merchantAiPauseReason', () => {
  beforeEach(() => check.mockReset())

  it('is null when nothing is granted', () => {
    expect(merchantAiPauseReason({ authorization: null }, 'org', 'prop')).toBeNull()
    expect(check).not.toHaveBeenCalled()
  })

  it('is null when every live capability is allowed', () => {
    check.mockReturnValue({ allowed: true })
    expect(
      merchantAiPauseReason(record('review_analysis', 'reply_drafting'), 'org', 'prop'),
    ).toBeNull()
  })

  it('never checks the retired trends capability', () => {
    expect(merchantAiPauseReason(record('property_trends'), 'org', 'prop')).toBeNull()
    expect(check).not.toHaveBeenCalled()
  })

  it('reports an Organization suspension', () => {
    check.mockReturnValue({ allowed: false, reason: 'org_suspended' })
    expect(merchantAiPauseReason(record('reply_drafting'), 'org', 'prop')).toBe(
      'org_suspended',
    )
    expect(check).toHaveBeenCalledWith(
      { organizationId: 'org', propertyId: 'prop' },
      'ai.generate_reply',
    )
  })

  it('reports any other refusal as a policy denial', () => {
    check.mockReturnValue({ allowed: false, reason: 'property_suspended' })
    expect(merchantAiPauseReason(record('review_analysis'), 'org', 'prop')).toBe(
      'policy_denied',
    )
  })
})

describe('merchantAiRenewalDecision', () => {
  const scope = { organizationId: 'org', propertyId: 'prop' }
  beforeEach(() => check.mockReset())

  it('allows the retired trends capability without asking the policy', () => {
    expect(merchantAiRenewalDecision({ ...scope, capability: 'property_trends' })).toBe(
      'allowed',
    )
    expect(check).not.toHaveBeenCalled()
  })

  it('maps the policy answer to renewal outcomes', () => {
    check.mockReturnValueOnce({ allowed: true })
    expect(merchantAiRenewalDecision({ ...scope, capability: 'review_analysis' })).toBe(
      'allowed',
    )
    check.mockReturnValueOnce({ allowed: false, reason: 'org_suspended' })
    expect(merchantAiRenewalDecision({ ...scope, capability: 'review_analysis' })).toBe(
      'org_suspended',
    )
    check.mockReturnValueOnce({ allowed: false, reason: 'kill_switch' })
    expect(merchantAiRenewalDecision({ ...scope, capability: 'reply_drafting' })).toBe(
      'policy_denied',
    )
  })
})
