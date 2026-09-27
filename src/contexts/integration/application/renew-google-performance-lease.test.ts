import { describe, expect, it, vi } from 'vitest'
import {
  organizationId,
  propertyId,
  googleConnectionId,
  userId,
} from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { GooglePerformanceAuthorizationSnapshot } from './get-property-google-performance'
import { createRenewGooglePerformanceLease } from './renew-google-performance-lease'

const actor: AuthContext = Object.freeze({
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  role: 'PropertyManager',
  effectivePermissions: new Set(['property.read', 'integration.manage'] as const),
})
const snapshot: GooglePerformanceAuthorizationSnapshot = Object.freeze({
  organizationId: actor.organizationId,
  propertyId: propertyId('11111111-1111-4111-8111-111111111111'),
  connectionId: googleConnectionId('22222222-2222-4222-8222-222222222222'),
  locationId: 'location-1',
  timezone: 'Europe/Sofia',
  sourceEpoch: 2,
  profileVersion: 3,
  connectionLifecycleVersion: 4,
  connectionAccessVersion: 5,
  credentialGeneration: 6,
  authorizationVector: Object.freeze({ policyVersion: 'beta-local-2' }),
  authorizationVectorSha256: 'a'.repeat(64),
  authorizationFenceSha256: 'f'.repeat(64),
  principalHmacKeyVersion: 'v1',
  principalHmac: 'b'.repeat(43),
})

const lease = Object.freeze({
  leaseRef: `v1.${'c'.repeat(43)}.v1.${'d'.repeat(43)}`,
  expiresAt: '2026-08-12T10:15:00.000Z',
  ttlSeconds: 850,
  renewAfterMs: 10_000,
})

describe('renew Google Performance authorization lease', () => {
  it('revalidates current authorization and renews without fetching provider content', async () => {
    const authorize = vi.fn(async () => ({
      ok: true as const,
      snapshot,
      accessToken: null,
    }))
    const renew = vi.fn(async () => ({ ok: true as const, lease }))
    const service = createRenewGooglePerformanceLease({
      authorize,
      renew,
      clock: () => new Date('2026-08-12T10:00:50.000Z'),
    })

    await expect(
      service({ propertyId: snapshot.propertyId, leaseRef: lease.leaseRef, actor }),
    ).resolves.toEqual({ ok: true, lease })
    expect(authorize).toHaveBeenCalledWith({
      actor,
      propertyId: snapshot.propertyId,
      phase: 'before_return',
    })
    expect(renew).toHaveBeenCalledWith({
      leaseRef: lease.leaseRef,
      principalHmacKeyVersion: snapshot.principalHmacKeyVersion,
      principalHmac: snapshot.principalHmac,
      authorizationFenceSha256: snapshot.authorizationFenceSha256,
      nowMs: new Date('2026-08-12T10:00:50.000Z').getTime(),
    })
  })

  it('fails closed when current authorization or lease renewal fails', async () => {
    const renew = vi.fn()
    const deniedAuthorization = createRenewGooglePerformanceLease({
      authorize: vi.fn(async () => ({
        ok: false as const,
        result: {
          status: 'unavailable' as const,
          reason: 'policy_disabled' as const,
          action: null,
        },
      })),
      renew,
      clock: () => new Date(),
    })
    await expect(
      deniedAuthorization({
        propertyId: snapshot.propertyId,
        leaseRef: lease.leaseRef,
        actor,
      }),
    ).resolves.toEqual({ ok: false })
    expect(renew).not.toHaveBeenCalled()

    const rejectedLease = createRenewGooglePerformanceLease({
      authorize: vi.fn(async () => ({ ok: true as const, snapshot, accessToken: null })),
      renew: vi.fn(async () => ({ ok: false as const, code: 'expired' as const })),
      clock: () => new Date(),
    })
    await expect(
      rejectedLease({ propertyId: snapshot.propertyId, leaseRef: lease.leaseRef, actor }),
    ).resolves.toEqual({ ok: false })
  })
})

// The browser only ever learns `{ ok: false }` (ADR 0050 clears the panel at
// once), so the operator record is the only place a broken lease runtime can
// show up. It carries no lease handle, principal digest or provider content.
describe('renew Google Performance authorization lease: operator record', () => {
  const renewWith = (
    renew: Parameters<typeof createRenewGooglePerformanceLease>[0]['renew'],
  ) => {
    const logger = { warn: vi.fn() }
    const service = createRenewGooglePerformanceLease({
      authorize: vi.fn(async () => ({ ok: true as const, snapshot, accessToken: null })),
      renew,
      clock: () => new Date('2026-08-12T10:00:50.000Z'),
      logger,
    })
    return {
      logger,
      run: () =>
        service({ propertyId: snapshot.propertyId, leaseRef: lease.leaseRef, actor }),
    }
  }
  const neverCarriesTheLease = (calls: ReadonlyArray<unknown>) => {
    const recorded = JSON.stringify(calls)
    expect(recorded).not.toContain(lease.leaseRef)
    expect(recorded).not.toContain(snapshot.principalHmac)
  }

  it.each(['runtime_unavailable', 'malformed'] as const)(
    'records a %s renewal, which means the lease runtime is broken',
    async (code) => {
      const test = renewWith(vi.fn(async () => ({ ok: false as const, code })))

      await expect(test.run()).resolves.toEqual({ ok: false })
      expect(test.logger.warn).toHaveBeenCalledOnce()
      expect(test.logger.warn).toHaveBeenCalledWith(
        { surface: 'google-performance', stage: 'renew_lease', code },
        'Google performance lease renewal failed',
      )
      neverCarriesTheLease(test.logger.warn.mock.calls)
    },
  )

  it('records a renewal that threw with the error name and message only', async () => {
    const test = renewWith(
      vi.fn(async () => {
        throw new TypeError('lease store connection closed')
      }),
    )

    await expect(test.run()).resolves.toEqual({ ok: false })
    expect(test.logger.warn).toHaveBeenCalledOnce()
    expect(test.logger.warn).toHaveBeenCalledWith(
      {
        surface: 'google-performance',
        stage: 'renew_lease',
        err: { name: 'TypeError', message: 'lease store connection closed' },
      },
      'Google performance lease renewal failed',
    )
    neverCarriesTheLease(test.logger.warn.mock.calls)
  })

  it.each([
    'expired',
    'not_found',
    'principal_mismatch',
    'authorization_denied',
    'authorization_changed',
    'concurrent_update',
  ] as const)('says nothing for an expected %s refusal', async (code) => {
    const test = renewWith(vi.fn(async () => ({ ok: false as const, code })))

    await expect(test.run()).resolves.toEqual({ ok: false })
    expect(test.logger.warn).not.toHaveBeenCalled()
  })

  it('says nothing for a renewed lease', async () => {
    const test = renewWith(vi.fn(async () => ({ ok: true as const, lease })))

    await expect(test.run()).resolves.toEqual({ ok: true, lease })
    expect(test.logger.warn).not.toHaveBeenCalled()
  })
})
