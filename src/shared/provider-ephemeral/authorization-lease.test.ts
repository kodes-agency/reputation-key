import { describe, expect, it, vi } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  providerAuthorizationFenceSha256,
  type ProviderAuthorizationVectorValue,
} from './authorization-binding'
import {
  createProviderAuthorizationLeaseService,
  type ProviderAuthorizationLeaseRecord,
} from './authorization-lease'
import { createInMemoryProviderEphemeralStore } from './in-memory-store'

const NOW = 1_800_000_000_000
const PRINCIPAL = 'p'.repeat(43)
const NONCE = 'n'.repeat(43)
const KEYRING = createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`)
const STORE_KEY = KEYRING.sign('provider-authorization-lease-handle-v1', NONCE).digest
const ORG_ID = 'org-1'
const USER_ID = 'user-1'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000001'
const CONNECTION_ID = '00000000-0000-4000-8000-000000000002'
const APPROVAL_ID = '00000000-0000-4000-8000-000000000003'

/** The full authorization vector a Google content preauthorization returns. */
function authorizationVector(
  overrides: Readonly<Record<string, ProviderAuthorizationVectorValue>> = {},
): Readonly<Record<string, ProviderAuthorizationVectorValue>> {
  return {
    executionPolicyVersion: 11,
    googleContentPolicyVersion: 5,
    emergencyKillVersion: 1,
    connectionLifecycleVersion: 4,
    connectionAccessVersion: 2,
    credentialGeneration: 7,
    role: 'owner',
    ...overrides,
  }
}

function fenceOf(
  overrides: Readonly<Record<string, ProviderAuthorizationVectorValue>> = {},
): string {
  const vector = authorizationVector(overrides)
  return providerAuthorizationFenceSha256({
    connectionLifecycleVersion: vector.connectionLifecycleVersion as number,
    connectionAccessVersion: vector.connectionAccessVersion as number,
    authorizationVector: vector,
  })
}

const FENCE = fenceOf()

function setup(
  revalidate = vi.fn(
    async (
      _record: ProviderAuthorizationLeaseRecord,
    ): Promise<{
      allowed: boolean
      approvalBindingId: string | null
      authorizationFenceSha256: string | null
    }> => ({
      allowed: true,
      approvalBindingId: APPROVAL_ID,
      authorizationFenceSha256: FENCE,
    }),
  ),
) {
  const store = createInMemoryProviderEphemeralStore(() => NOW)
  const service = createProviderAuthorizationLeaseService({
    store,
    handleKeys: KEYRING,
    randomNonce: () => NONCE,
    revalidate,
  })
  const issue = (absoluteDeadlineMs = NOW + 15 * 60_000) =>
    service.issue({
      audience: 'performance',
      capability: 'property.read_gbp_performance',
      organizationId: ORG_ID,
      initiatorUserId: USER_ID,
      propertyId: PROPERTY_ID,
      connectionId: CONNECTION_ID,
      approvalBindingId: APPROVAL_ID,
      principalHmacKeyVersion: 'v1',
      principalHmac: PRINCIPAL,
      authorizationFenceSha256: FENCE,
      absoluteDeadlineMs,
      nowMs: NOW,
    })
  const renew = (leaseRef: string, overrides: Record<string, unknown> = {}) =>
    service.renew({
      leaseRef,
      principalHmacKeyVersion: 'v1',
      principalHmac: PRINCIPAL,
      approvalBindingId: APPROVAL_ID,
      authorizationFenceSha256: FENCE,
      nowMs: NOW + 10_000,
      ...overrides,
    })
  return { service, store, issue, renew, revalidate }
}

describe('provider authorization leases', () => {
  it('issues a signed opaque 30-second lease without provider content', async () => {
    const { issue } = setup()
    const result = await issue()
    expect(result).toMatchObject({
      ok: true,
      lease: {
        expiresAt: new Date(NOW + 30_000).toISOString(),
        ttlSeconds: 30,
        renewAfterMs: 10_000,
      },
    })
    if (!result.ok) throw new Error('expected lease')
    expect(result.lease.leaseRef).toMatch(
      /^l1\.[A-Za-z0-9_-]{43}\.v1\.[A-Za-z0-9_-]{43}$/,
    )
    expect(JSON.stringify(result)).not.toContain(CONNECTION_ID)
  })

  it('revalidates the exact actor and authorization vector before issue and renewal', async () => {
    const { issue, renew, revalidate } = setup()
    const issued = await issue()
    if (!issued.ok) throw new Error('expected lease')
    await expect(renew(issued.lease.leaseRef)).resolves.toMatchObject({
      ok: true,
      lease: { expiresAt: new Date(NOW + 40_000).toISOString() },
    })
    expect(revalidate).toHaveBeenCalledTimes(2)
    expect(revalidate.mock.calls[0]![0]).toMatchObject({
      organizationId: ORG_ID,
      initiatorUserId: USER_ID,
      propertyId: PROPERTY_ID,
      authorizationFenceSha256: FENCE,
    })
  })

  it('publishes no lease when fresh compound authorization denies issuance', async () => {
    const revalidate = vi.fn(async () => ({
      allowed: false,
      approvalBindingId: null,
      authorizationFenceSha256: null,
    }))
    const { issue, store } = setup(revalidate)

    await expect(issue()).resolves.toEqual({
      ok: false,
      code: 'authorization_denied',
    })
    expect(await store.read('authorization-lease', STORE_KEY)).toBeUndefined()
  })

  it('fails closed and removes a lease when authorization changes', async () => {
    const { issue, renew } = setup()
    const issued = await issue()
    if (!issued.ok) throw new Error('expected lease')
    await expect(
      renew(issued.lease.leaseRef, {
        authorizationFenceSha256: 'b'.repeat(64),
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'authorization_changed',
    })
    await expect(renew(issued.lease.leaseRef)).resolves.toEqual({
      ok: false,
      code: 'not_found',
    })
  })

  it('does not disclose or destroy a valid lease on principal mismatch', async () => {
    const { issue, renew, revalidate } = setup()
    const issued = await issue()
    if (!issued.ok) throw new Error('expected lease')
    await expect(
      renew(issued.lease.leaseRef, {
        principalHmac: 'x'.repeat(43),
      }),
    ).resolves.toEqual({ ok: false, code: 'principal_mismatch' })
    await expect(renew(issued.lease.leaseRef)).resolves.toMatchObject({ ok: true })
    expect(revalidate).toHaveBeenCalledTimes(2)
  })

  it('caps renewal at the immutable absolute content deadline', async () => {
    const { issue, renew } = setup()
    const issued = await issue(NOW + 25_000)
    if (!issued.ok) throw new Error('expected lease')
    expect(issued.lease.expiresAt).toBe(new Date(NOW + 25_000).toISOString())
    await expect(renew(issued.lease.leaseRef, { nowMs: NOW + 25_000 })).resolves.toEqual({
      ok: false,
      code: 'expired',
    })
  })

  it('allows a durable 24-hour import checkpoint without widening performance content', async () => {
    const first = setup()
    await expect(
      first.service.issue({
        audience: 'import',
        capability: 'property.import_gbp_v2',
        organizationId: ORG_ID,
        initiatorUserId: USER_ID,
        propertyId: null,
        connectionId: CONNECTION_ID,
        approvalBindingId: APPROVAL_ID,
        principalHmacKeyVersion: 'v1',
        principalHmac: PRINCIPAL,
        authorizationFenceSha256: FENCE,
        absoluteDeadlineMs: NOW + 24 * 60 * 60_000,
        nowMs: NOW,
      }),
    ).resolves.toMatchObject({ ok: true })

    const second = setup()
    await expect(second.issue(NOW + 24 * 60 * 60_000)).resolves.toEqual({
      ok: false,
      code: 'malformed',
    })
  })
  it('removes a lease when its exact approval binding changes', async () => {
    const { issue, renew } = setup()
    const issued = await issue()
    if (!issued.ok) throw new Error('expected lease')
    await expect(
      renew(issued.lease.leaseRef, {
        approvalBindingId: '00000000-0000-4000-8000-000000000004',
      }),
    ).resolves.toEqual({ ok: false, code: 'authorization_changed' })
    await expect(renew(issued.lease.leaseRef)).resolves.toEqual({
      ok: false,
      code: 'not_found',
    })
  })

  it('renews across a routine credential-generation bump', async () => {
    // A Google token refresh bumps credential_generation only. Fencing the
    // lease on that member destroyed the open report within one renewal.
    let current = authorizationVector()
    const revalidate = vi.fn(async () => ({
      allowed: true,
      approvalBindingId: APPROVAL_ID,
      authorizationFenceSha256: providerAuthorizationFenceSha256({
        connectionLifecycleVersion: current.connectionLifecycleVersion as number,
        connectionAccessVersion: current.connectionAccessVersion as number,
        authorizationVector: current,
      }),
    }))
    const { issue, renew, store } = setup(revalidate)
    const issued = await issue()
    if (!issued.ok) throw new Error('expected lease')

    current = authorizationVector({ credentialGeneration: 8 })

    await expect(
      renew(issued.lease.leaseRef, {
        authorizationFenceSha256: fenceOf({ credentialGeneration: 8 }),
      }),
    ).resolves.toMatchObject({ ok: true })
    expect(await store.read('authorization-lease', STORE_KEY)).toBeDefined()
  })

  it.each([
    ['connection lifecycle version', { connectionLifecycleVersion: 5 }],
    ['connection access version', { connectionAccessVersion: 3 }],
    ['execution policy version', { executionPolicyVersion: 12 }],
    ['emergency kill version', { emergencyKillVersion: 2 }],
  ])(
    'removes the lease when the %s changes',
    async (
      _label,
      override: Readonly<Record<string, ProviderAuthorizationVectorValue>>,
    ) => {
      const { issue, renew, store } = setup()
      const issued = await issue()
      if (!issued.ok) throw new Error('expected lease')

      await expect(
        renew(issued.lease.leaseRef, {
          authorizationFenceSha256: fenceOf(override),
        }),
      ).resolves.toEqual({ ok: false, code: 'authorization_changed' })
      expect(await store.read('authorization-lease', STORE_KEY)).toBeUndefined()
    },
  )
})
