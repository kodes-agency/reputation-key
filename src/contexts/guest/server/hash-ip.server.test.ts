import { describe, expect, it } from 'vitest'
import {
  createGuestNetworkPseudonymHasher,
  deriveGuestNetworkPseudonym,
} from './hash-ip.server'

const input = {
  secret: '0123456789abcdef0123456789abcdef',
  ip: '203.0.113.20',
  organizationId: 'org-a',
  portalId: '82000000-0000-4000-8000-000000000003',
  action: 'rating' as const,
  observedAt: new Date('2026-08-27T23:59:59.000Z'),
}

describe('Guest network pseudonym derivation', () => {
  it('uses the versioned daily Organization/Portal/action scope', () => {
    expect(deriveGuestNetworkPseudonym(input)).toBe(
      '973fbb99b24abbd04655793d28afce5558c9c50f3356f02d27bbb8778a5734ab',
    )
    expect(
      deriveGuestNetworkPseudonym({
        ...input,
        portalId: '82000000-0000-4000-8000-000000000004',
      }),
    ).not.toBe(deriveGuestNetworkPseudonym(input))
    expect(deriveGuestNetworkPseudonym({ ...input, organizationId: 'org-b' })).not.toBe(
      deriveGuestNetworkPseudonym(input),
    )
    expect(
      deriveGuestNetworkPseudonym({ ...input, action: 'private_feedback' }),
    ).not.toBe(deriveGuestNetworkPseudonym(input))
    expect(
      deriveGuestNetworkPseudonym({
        ...input,
        observedAt: new Date('2026-08-28T00:00:00.000Z'),
      }),
    ).not.toBe(deriveGuestNetworkPseudonym(input))
  })

  it('rejects an empty scope or secret instead of creating a global identity', () => {
    expect(() => deriveGuestNetworkPseudonym({ ...input, organizationId: '' })).toThrow(
      'scope',
    )
    expect(() => deriveGuestNetworkPseudonym({ ...input, secret: '' })).toThrow('secret')
  })

  it('binds the composition-supplied secret while requiring an explicit instant', () => {
    const hash = createGuestNetworkPseudonymHasher(input.secret)

    expect(
      hash(
        input.ip,
        { organizationId: input.organizationId, portalId: input.portalId },
        input.action,
        input.observedAt,
      ),
    ).toBe('973fbb99b24abbd04655793d28afce5558c9c50f3356f02d27bbb8778a5734ab')
    expect(() => createGuestNetworkPseudonymHasher('')).toThrow('secret')
  })
})
