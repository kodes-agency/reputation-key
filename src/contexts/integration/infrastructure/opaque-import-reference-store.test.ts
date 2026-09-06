import { describe, expect, it } from 'vitest'
import { createInMemoryProviderEphemeralStore } from '#/shared/provider-ephemeral/in-memory-store'
import { createProviderAuthorizationLeaseService } from '#/shared/provider-ephemeral/authorization-lease'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { ProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import { createOpaqueImportReferenceStore } from './opaque-import-reference-store'
import type {
  ImportDiscoveryAuthorization,
  ImportDiscoveryCandidate,
} from '../application/ports/google-import-reference-store.port'

const NOW_MS = Date.parse('2026-08-12T10:00:00.000Z')
const CONTENT_DEADLINE_MS = NOW_MS + 15 * 60_000
const KEY_V1 = `v1:${'11'.repeat(32)}`
const KEY_V2 = `v2:${'22'.repeat(32)}`
const CONNECTION_ID = '00000000-0000-4000-8000-000000000002'

const authorization = (
  overrides: Partial<ImportDiscoveryAuthorization> = {},
): ImportDiscoveryAuthorization => ({
  organizationId: 'org-1',
  userId: 'user-1',
  connectionId: CONNECTION_ID,
  connectionLifecycleVersion: 3,
  connectionAccessVersion: 4,
  credentialGeneration: 5,
  authorizationVector: Object.freeze({
    policyVersion: 7,
    permissionVersion: 11,
    membershipGeneration: 13,
  }),
  ...overrides,
})

function deterministicRandom() {
  let value = 1
  return (bytes: number) => Buffer.alloc(bytes, value++)
}

function setup(
  input?: Readonly<{
    store?: ProviderEphemeralStore
    keyring?: ReturnType<typeof createVersionedHmacKeyring>
    random?: (bytes: number) => Buffer
    nowMs?: () => number
  }>,
) {
  const readNow = input?.nowMs ?? (() => NOW_MS)
  const providerStore = input?.store ?? createInMemoryProviderEphemeralStore(readNow)
  const handleKeys = input?.keyring ?? createVersionedHmacKeyring(KEY_V1)
  let leaseNonce = 0
  const leases = createProviderAuthorizationLeaseService({
    store: providerStore,
    handleKeys,
    randomNonce: () => Buffer.alloc(32, (leaseNonce += 1)).toString('base64url'),
    revalidate: async (record) => ({
      allowed: true,
      authorizationFenceSha256: record.authorizationFenceSha256,
    }),
  })
  const references = createOpaqueImportReferenceStore({
    store: providerStore,
    handleKeys,
    leasePrincipalKeys: createVersionedHmacKeyring(KEY_V2),
    leases,
    random: input?.random ?? deterministicRandom(),
    nowMs: readNow,
  })
  return { references, providerStore }
}

const accounts = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    accountId: `provider-account-${index}`,
    displayName: `Account ${index}`,
    role: index === 0 ? ('primary_owner' as const) : ('manager' as const),
  }))

const candidates = (count: number): ImportDiscoveryCandidate[] =>
  Array.from({ length: count }, (_, index) => ({
    accountId: 'provider-account-1',
    locationId: `provider-location-${index}`,
    accountDisplayName: 'Main account',
    businessName: `Business ${index}`,
    address: `${index} Example Street`,
    primaryCategory: 'Restaurant',
    countryCode: 'US',
    eligibility: { kind: 'create' as const },
  }))

describe('opaque Google import reference store', () => {
  it('publishes one bounded account page without exposing provider identifiers', async () => {
    const { references } = setup()

    const result = await references.publishAccountPage({
      authorization: authorization(),
      accounts: accounts(20),
      nextPageToken: 'provider-page-token',
      contentDeadlineMs: CONTENT_DEADLINE_MS,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items).toHaveLength(20)
    expect(result.value.nextCursor).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/)
    expect(result.value.authorizationLease).toMatchObject({
      leaseRef: expect.stringMatching(/^l1\.[A-Za-z0-9_-]{43}\.v1\.[A-Za-z0-9_-]{43}$/),
      ttlSeconds: 30,
      renewAfterMs: 10_000,
    })
    expect(result.value.contentTtlSeconds).toBe(900)
    const serialized = JSON.stringify(result.value)
    expect(serialized).not.toContain('provider-account-')
    expect(serialized).not.toContain('provider-page-token')
  })

  it('resolves account routing only for the exact authorization audience', async () => {
    const { references } = setup()
    const published = await references.publishAccountPage({
      authorization: authorization(),
      accounts: accounts(1),
      nextPageToken: null,
      contentDeadlineMs: CONTENT_DEADLINE_MS,
    })
    expect(published.ok).toBe(true)
    if (!published.ok) return
    const accountRef = published.value.items[0]!.accountRef

    await expect(
      references.resolveAccount({
        accountRef,
        authorization: authorization(),
      }),
    ).resolves.toMatchObject({ ok: true, accountId: 'provider-account-0' })

    for (const changed of [
      authorization({ organizationId: 'org-2' }),
      authorization({ userId: 'user-2' }),
      authorization({ connectionId: '00000000-0000-4000-8000-000000000003' }),
      authorization({ connectionAccessVersion: 6 }),
      authorization({ authorizationVector: { policyVersion: 8 } }),
    ]) {
      await expect(
        references.resolveAccount({ accountRef, authorization: changed }),
      ).resolves.toEqual({ ok: false, code: 'binding_mismatch' })
    }
  })

  it('bounds explicit cursor redemption and rejects expiry, future issue, and wrong audience', async () => {
    let now = NOW_MS
    const { references, providerStore } = setup({ nowMs: () => now })
    const published = await references.publishAccountPage({
      authorization: authorization(),
      accounts: accounts(1),
      nextPageToken: 'provider-page-token',
      contentDeadlineMs: CONTENT_DEADLINE_MS,
      cursorRedemptionBudget: 2,
    })
    expect(published.ok).toBe(true)
    if (!published.ok || !published.value.nextCursor) return

    await expect(
      references.redeemAccountsCursor({
        cursorRef: published.value.nextCursor,
        authorization: authorization(),
      }),
    ).resolves.toMatchObject({ ok: true, pageToken: 'provider-page-token' })
    await expect(
      references.redeemAccountsCursor({
        cursorRef: published.value.nextCursor,
        authorization: authorization(),
      }),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      references.redeemAccountsCursor({
        cursorRef: published.value.nextCursor,
        authorization: authorization(),
      }),
    ).resolves.toEqual({ ok: false, code: 'budget_exhausted' })
    await expect(
      references.resolveAccount({
        accountRef: published.value.nextCursor,
        authorization: authorization(),
      }),
    ).resolves.toEqual({ ok: false, code: 'binding_mismatch' })

    now = CONTENT_DEADLINE_MS + 1
    await expect(
      references.redeemAccountsCursor({
        cursorRef: published.value.nextCursor,
        authorization: authorization(),
      }),
    ).resolves.toEqual({ ok: false, code: 'not_found' })

    const futureHandle = `${createVersionedHmacKeyring(KEY_V1).activeVersion}.${Buffer.alloc(32, 77).toString('base64url')}`
    const futureKey = createVersionedHmacKeyring(KEY_V1).derive(
      'google-import-reference:accounts_cursor',
      futureHandle,
      'v1',
    )!
    await providerStore.putIfAbsent(
      'opaque-reference',
      futureKey,
      JSON.stringify({
        schemaVersion: 2,
        audience: 'accounts_cursor',
        ...authorization(),
        issuedAtMs: now + 61_000,
        expiresAtMs: now + 120_000,
        pageToken: 'future-token',
        remainingRedemptions: 1,
      }),
      120,
    )
    await expect(
      references.redeemAccountsCursor({
        cursorRef: futureHandle,
        authorization: authorization(),
      }),
    ).resolves.toEqual({ ok: false, code: 'expired' })
  })

  it('resolves records issued by the one retained key and rejects unknown versions', async () => {
    const providerStore = createInMemoryProviderEphemeralStore()
    const old = setup({
      store: providerStore,
      keyring: createVersionedHmacKeyring(KEY_V1),
    }).references
    const published = await old.publishAccountPage({
      authorization: authorization(),
      accounts: accounts(1),
      nextPageToken: null,
      contentDeadlineMs: CONTENT_DEADLINE_MS,
    })
    expect(published.ok).toBe(true)
    if (!published.ok) return

    const rotated = setup({
      store: providerStore,
      keyring: createVersionedHmacKeyring(`${KEY_V2},${KEY_V1}`),
    }).references
    await expect(
      rotated.resolveAccount({
        accountRef: published.value.items[0]!.accountRef,
        authorization: authorization(),
      }),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      rotated.resolveAccount({
        accountRef: `v0.${Buffer.alloc(32, 3).toString('base64url')}`,
        authorization: authorization(),
      }),
    ).resolves.toEqual({ ok: false, code: 'malformed' })
    await expect(
      rotated.resolveAccount({
        accountRef: 'not-a-reference',
        authorization: authorization(),
      }),
    ).resolves.toEqual({ ok: false, code: 'malformed' })
  })

  it('publishes exactly 100 classified locations and only actionable references', async () => {
    const { references } = setup()
    const accountPage = await references.publishAccountPage({
      authorization: authorization(),
      accounts: accounts(1),
      nextPageToken: null,
      contentDeadlineMs: CONTENT_DEADLINE_MS,
    })
    expect(accountPage.ok).toBe(true)
    if (!accountPage.ok) return
    const account = await references.resolveAccount({
      accountRef: accountPage.value.items[0]!.accountRef,
      authorization: authorization(),
    })
    expect(account.ok).toBe(true)
    if (!account.ok) return
    const input = candidates(100)
    input[1] = { ...input[1]!, eligibility: { kind: 'active_binding_conflict' } }

    const result = await references.publishCandidatePage({
      authorization: authorization(),
      account: {
        accountRef: accountPage.value.items[0]!.accountRef,
        accountId: account.accountId,
        displayName: account.displayName,
      },
      candidates: input,
      nextPageToken: 'next-locations-page',
      contentDeadlineMs: CONTENT_DEADLINE_MS,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items).toHaveLength(100)
    expect(result.value.items[0]!.candidateRef).toMatch(/^v1\./)
    expect(result.value.items[1]!.candidateRef).toBeNull()
    expect(result.value.nextCursor).toMatch(/^v1\./)
    const serialized = JSON.stringify(result.value)
    expect(serialized).not.toContain('provider-location-')
    expect(serialized).not.toContain('next-locations-page')
  })

  it('fails closed on count, candidate-byte, and atomic-collision bounds', async () => {
    const { references } = setup()
    await expect(
      references.publishAccountPage({
        authorization: authorization(),
        accounts: accounts(21),
        nextPageToken: null,
        contentDeadlineMs: CONTENT_DEADLINE_MS,
      }),
    ).resolves.toEqual({ ok: false, code: 'capacity_exceeded' })

    const accountPage = await references.publishAccountPage({
      authorization: authorization(),
      accounts: accounts(1),
      nextPageToken: null,
      contentDeadlineMs: CONTENT_DEADLINE_MS,
    })
    expect(accountPage.ok).toBe(true)
    if (!accountPage.ok) return
    const oversized = candidates(1)
    oversized[0] = { ...oversized[0]!, businessName: 'x'.repeat(17 * 1024) }
    await expect(
      references.publishCandidatePage({
        authorization: authorization(),
        account: {
          accountRef: accountPage.value.items[0]!.accountRef,
          accountId: 'provider-account-0',
          displayName: 'Account 0',
        },
        candidates: oversized,
        nextPageToken: null,
        contentDeadlineMs: CONTENT_DEADLINE_MS,
      }),
    ).resolves.toEqual({ ok: false, code: 'capacity_exceeded' })

    const { references: collisionStore } = setup({
      random: (bytes) => Buffer.alloc(bytes, 1),
    })
    await expect(
      collisionStore.publishAccountPage({
        authorization: authorization(),
        accounts: accounts(2),
        nextPageToken: null,
        contentDeadlineMs: CONTENT_DEADLINE_MS,
      }),
    ).resolves.toEqual({ ok: false, code: 'runtime_unavailable' })
  })

  it('maps provider-store failure to a code-only unavailable result', async () => {
    const unavailable = new Proxy(createInMemoryProviderEphemeralStore(), {
      get() {
        return async () => {
          throw new Error('redis endpoint and secret must not escape')
        }
      },
    })
    const { references } = setup({ store: unavailable })

    const result = await references.publishAccountPage({
      authorization: authorization(),
      accounts: accounts(1),
      nextPageToken: null,
      contentDeadlineMs: CONTENT_DEADLINE_MS,
    })
    expect(result).toEqual({ ok: false, code: 'runtime_unavailable' })
    expect(JSON.stringify(result)).not.toContain('redis')
    await expect(
      references.resolveAccount({
        accountRef: `v1.${Buffer.alloc(32, 8).toString('base64url')}`,
        authorization: authorization(),
      }),
    ).resolves.toEqual({ ok: false, code: 'runtime_unavailable' })
  })

  it('invalidates every connection-scoped record without a keyspace scan', async () => {
    const { references } = setup()
    const page = await references.publishAccountPage({
      authorization: authorization(),
      accounts: accounts(1),
      nextPageToken: 'next-page',
      contentDeadlineMs: CONTENT_DEADLINE_MS,
    })
    expect(page.ok).toBe(true)
    if (!page.ok || !page.value.nextCursor) return
    const accountRef = page.value.items[0]!.accountRef

    await expect(
      references.invalidateConnection({
        organizationId: 'org-1',
        connectionId: CONNECTION_ID,
      }),
    ).resolves.toBe(true)
    await expect(
      references.resolveAccount({ accountRef, authorization: authorization() }),
    ).resolves.toEqual({ ok: false, code: 'not_found' })
    await expect(
      references.redeemAccountsCursor({
        cursorRef: page.value.nextCursor,
        authorization: authorization(),
      }),
    ).resolves.toEqual({ ok: false, code: 'not_found' })
  })

  it('renews a content lease without extending its absolute content deadline', async () => {
    let now = NOW_MS
    const { references } = setup({ nowMs: () => now })
    const page = await references.publishAccountPage({
      authorization: authorization(),
      accounts: accounts(1),
      nextPageToken: null,
      contentDeadlineMs: CONTENT_DEADLINE_MS,
    })
    expect(page.ok).toBe(true)
    if (!page.ok) return

    now += 20_000
    await expect(
      references.renewLease({
        leaseRef: page.value.authorizationLease.leaseRef,
        authorization: authorization(),
      }),
    ).resolves.toEqual({
      ok: true,
      lease: {
        leaseRef: page.value.authorizationLease.leaseRef,
        expiresAt: new Date(now + 30_000).toISOString(),
        ttlSeconds: 30,
        renewAfterMs: 10_000,
      },
    })

    let capNow = NOW_MS
    const { references: cappedReferences } = setup({ nowMs: () => capNow })
    const cappedDeadlineMs = NOW_MS + 25_000
    const cappedPage = await cappedReferences.publishAccountPage({
      authorization: authorization(),
      accounts: accounts(1),
      nextPageToken: null,
      contentDeadlineMs: cappedDeadlineMs,
    })
    expect(cappedPage.ok).toBe(true)
    if (!cappedPage.ok) return

    capNow += 20_000
    await expect(
      cappedReferences.renewLease({
        leaseRef: cappedPage.value.authorizationLease.leaseRef,
        authorization: authorization(),
      }),
    ).resolves.toMatchObject({
      ok: true,
      lease: {
        expiresAt: new Date(cappedDeadlineMs).toISOString(),
        ttlSeconds: 5,
      },
    })
  })

  it('invalidates organization, user, and property audiences through bounded indexes', async () => {
    const publishRelinkPage = async () => {
      const { references } = setup()
      const accountPage = await references.publishAccountPage({
        authorization: authorization(),
        accounts: accounts(1),
        nextPageToken: null,
        contentDeadlineMs: CONTENT_DEADLINE_MS,
      })
      expect(accountPage.ok).toBe(true)
      if (!accountPage.ok) throw new Error('account page publication failed')
      const accountRef = accountPage.value.items[0]!.accountRef
      const candidatePage = await references.publishCandidatePage({
        authorization: authorization(),
        account: {
          accountRef,
          accountId: 'provider-account-0',
          displayName: 'Account 0',
        },
        candidates: [
          {
            ...candidates(1)[0]!,
            eligibility: {
              kind: 'relink',
              propertyId: 'property-1' as never,
              profile: {
                name: 'Existing property',
                address: '1 Existing Street',
                countryCode: 'US',
                timezone: 'America/New_York',
                profileVersion: 4,
              },
            },
            expectedSourceEpoch: 7,
            expectedProfileVersion: 4,
          },
        ],
        nextPageToken: null,
        contentDeadlineMs: CONTENT_DEADLINE_MS,
      })
      expect(candidatePage.ok).toBe(true)
      if (!candidatePage.ok) throw new Error('candidate page publication failed')
      return { references, accountRef, candidatePage: candidatePage.value }
    }

    const byOrganization = await publishRelinkPage()
    await expect(
      byOrganization.references.invalidateOrganization({ organizationId: 'org-1' }),
    ).resolves.toBe(true)
    await expect(
      byOrganization.references.resolveAccount({
        accountRef: byOrganization.accountRef,
        authorization: authorization(),
      }),
    ).resolves.toEqual({ ok: false, code: 'not_found' })

    const byUser = await publishRelinkPage()
    await expect(
      byUser.references.invalidateUser({
        organizationId: 'org-1',
        userId: 'user-1',
      }),
    ).resolves.toBe(true)

    const byProperty = await publishRelinkPage()
    await expect(
      byProperty.references.invalidateProperty({
        organizationId: 'org-1',
        propertyId: 'property-1',
      }),
    ).resolves.toBe(true)
    await expect(
      byProperty.references.resolveCandidate({
        candidateRef: byProperty.candidatePage.items[0]!.candidateRef!,
        authorization: authorization(),
      }),
    ).resolves.toEqual({ ok: false, code: 'not_found' })
  })
  it('claims candidate sets atomically and permits only idempotent same-request takeover', async () => {
    const { references } = setup()
    const accountPage = await references.publishAccountPage({
      authorization: authorization(),
      accounts: accounts(1),
      nextPageToken: null,
      contentDeadlineMs: CONTENT_DEADLINE_MS,
    })
    expect(accountPage.ok).toBe(true)
    if (!accountPage.ok) return
    const candidatePage = await references.publishCandidatePage({
      authorization: authorization(),
      account: {
        accountRef: accountPage.value.items[0]!.accountRef,
        accountId: 'provider-account-0',
        displayName: 'Account 0',
      },
      candidates: candidates(2),
      nextPageToken: null,
      contentDeadlineMs: CONTENT_DEADLINE_MS,
    })
    expect(candidatePage.ok).toBe(true)
    if (!candidatePage.ok) return
    const candidateRefs = candidatePage.value.items.map((item) => item.candidateRef!)
    const firstRequestId = '00000000-0000-4000-8000-000000000101'
    const secondRequestId = '00000000-0000-4000-8000-000000000102'

    const claimed = await references.claimCandidates({
      candidateRefs,
      organizationId: 'org-1',
      userId: 'user-1',
      requestId: firstRequestId,
    })
    expect(claimed).toMatchObject({
      ok: true,
      candidates: [
        {
          candidateRef: candidateRefs[0],
          authorization: {
            organizationId: 'org-1',
            userId: 'user-1',
            connectionId: CONNECTION_ID,
          },
          candidate: {
            accountId: 'provider-account-1',
            locationId: 'provider-location-0',
          },
        },
        {
          candidateRef: candidateRefs[1],
          candidate: { locationId: 'provider-location-1' },
        },
      ],
    })
    await expect(
      references.claimCandidates({
        candidateRefs,
        organizationId: 'org-1',
        userId: 'user-1',
        requestId: firstRequestId,
      }),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      references.claimCandidates({
        candidateRefs: [candidateRefs[1]!],
        organizationId: 'org-1',
        userId: 'user-1',
        requestId: secondRequestId,
      }),
    ).resolves.toEqual({ ok: false, code: 'binding_mismatch' })
    await expect(
      references.claimCandidates({
        candidateRefs: [candidateRefs[0]!],
        organizationId: 'org-2',
        userId: 'user-1',
        requestId: firstRequestId,
      }),
    ).resolves.toEqual({ ok: false, code: 'binding_mismatch' })
  })

  it('releases or consumes only the exact candidate claim set', async () => {
    const { references } = setup()
    const accountPage = await references.publishAccountPage({
      authorization: authorization(),
      accounts: accounts(1),
      nextPageToken: null,
      contentDeadlineMs: CONTENT_DEADLINE_MS,
    })
    expect(accountPage.ok).toBe(true)
    if (!accountPage.ok) return
    const candidatePage = await references.publishCandidatePage({
      authorization: authorization(),
      account: {
        accountRef: accountPage.value.items[0]!.accountRef,
        accountId: 'provider-account-0',
        displayName: 'Account 0',
      },
      candidates: candidates(2),
      nextPageToken: null,
      contentDeadlineMs: CONTENT_DEADLINE_MS,
    })
    expect(candidatePage.ok).toBe(true)
    if (!candidatePage.ok) return
    const candidateRefs = candidatePage.value.items.map((item) => item.candidateRef!)
    const firstRequestId = '00000000-0000-4000-8000-000000000101'
    const secondRequestId = '00000000-0000-4000-8000-000000000102'

    await references.claimCandidates({
      candidateRefs,
      organizationId: 'org-1',
      userId: 'user-1',
      requestId: firstRequestId,
    })
    await expect(
      references.releaseCandidateClaims({
        candidateRefs,
        organizationId: 'org-1',
        userId: 'user-1',
        requestId: secondRequestId,
      }),
    ).resolves.toBe(false)
    await expect(
      references.releaseCandidateClaims({
        candidateRefs,
        organizationId: 'org-1',
        userId: 'user-1',
        requestId: firstRequestId,
      }),
    ).resolves.toBe(true)
    await expect(
      references.claimCandidates({
        candidateRefs,
        organizationId: 'org-1',
        userId: 'user-1',
        requestId: secondRequestId,
      }),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      references.consumeCandidateClaims({
        candidateRefs,
        organizationId: 'org-1',
        userId: 'user-1',
        requestId: secondRequestId,
      }),
    ).resolves.toBe(true)
    await expect(
      references.resolveCandidate({
        candidateRef: candidateRefs[0]!,
        authorization: authorization(),
      }),
    ).resolves.toEqual({ ok: false, code: 'not_found' })
  })
})
