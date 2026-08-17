import { describe, expect, it, vi } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  createProviderAuthorizationLeaseService,
  type ProviderAuthorizationLeaseRecord,
} from './authorization-lease'
import { createInMemoryProviderEphemeralStore } from './in-memory-store'

const NOW = 1_800_000_000_000
const VECTOR = 'a'.repeat(64)
const PRINCIPAL = 'p'.repeat(43)
const NONCE = 'n'.repeat(43)
const KEYRING = createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`)
const STORE_KEY = KEYRING.sign('provider-authorization-lease-handle-v1', NONCE).digest
const ORG_ID = 'org-1'
const USER_ID = 'user-1'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000001'
const CONNECTION_ID = '00000000-0000-4000-8000-000000000002'
const APPROVAL_ID = '00000000-0000-4000-8000-000000000003'

function setup(
  revalidate = vi.fn(
    async (
      _record: ProviderAuthorizationLeaseRecord,
    ): Promise<{
      allowed: boolean
      approvalBindingId: string | null
      authorizationVectorSha256: string | null
    }> => ({
      allowed: true,
      approvalBindingId: APPROVAL_ID,
      authorizationVectorSha256: VECTOR,
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
      authorizationVectorSha256: VECTOR,
      absoluteDeadlineMs,
      nowMs: NOW,
    })
  const renew = (leaseRef: string, overrides: Record<string, unknown> = {}) =>
    service.renew({
      leaseRef,
      principalHmacKeyVersion: 'v1',
      principalHmac: PRINCIPAL,
      approvalBindingId: APPROVAL_ID,
      authorizationVectorSha256: VECTOR,
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
      authorizationVectorSha256: VECTOR,
    })
  })

  it('publishes no lease when fresh compound authorization denies issuance', async () => {
    const revalidate = vi.fn(async () => ({
      allowed: false,
      approvalBindingId: null,
      authorizationVectorSha256: null,
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
        authorizationVectorSha256: 'b'.repeat(64),
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
})
