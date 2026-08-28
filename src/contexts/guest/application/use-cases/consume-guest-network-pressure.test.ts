import { describe, expect, it, vi } from 'vitest'
import { consumeGuestNetworkPressure } from './consume-guest-network-pressure'

const NOW = new Date('2026-08-27T12:00:00.000Z')

describe('consumeGuestNetworkPressure', () => {
  it('adds only the trusted clock to the exact Portal-scoped pressure command', async () => {
    const consume = vi.fn(async () => ({
      allowed: true,
      remaining: 4,
      resetAt: new Date('2026-08-27T13:00:00.000Z'),
    }))
    const check = consumeGuestNetworkPressure({
      store: { consume },
      clock: () => NOW,
    })
    const input = {
      organizationId: 'org-pressure',
      propertyId: '82000000-0000-4000-8000-000000000002',
      portalId: '82000000-0000-4000-8000-000000000003',
      pseudonym: 'a'.repeat(64),
      action: 'rating' as const,
      maxRequests: 5,
      windowSeconds: 60 * 60,
    }

    await expect(check(input)).resolves.toMatchObject({ allowed: true, remaining: 4 })
    expect(consume).toHaveBeenCalledWith({ ...input, observedAt: NOW })
  })
})
