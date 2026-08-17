import { GOOGLE_ACCOUNT_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import type {
  GoogleImportReferenceStore,
  ImportDiscoveryAuthorization,
} from './ports/google-import-reference-store.port'
import {
  createGoogleImportDiscovery,
  type GoogleImportCommandAuthorizer,
  type GoogleImportPropertyClassifier,
} from './google-import-discovery'
import type { GbpLocationCandidate } from './google-provider-contract'

const actor: AuthContext = {
  organizationId: organizationId('org-1'),
  userId: userId('user-1'),
  role: 'AccountAdmin',
}
const connectionId = googleConnectionId('11111111-1111-4111-8111-111111111111')
const approvalBindingId = '22222222-2222-4222-8222-222222222222'

const authorization = (
  overrides: Partial<ImportDiscoveryAuthorization> = {},
): ImportDiscoveryAuthorization => ({
  organizationId: actor.organizationId,
  userId: actor.userId,
  connectionId,
  connectionLifecycleVersion: 3,
  connectionAccessVersion: 4,
  credentialGeneration: 5,
  approvalBindingId,
  authorizationVector: { policyVersion: 7, membershipGeneration: 11 },
  ...overrides,
})
const providerAuthorization = () => ({
  capability: 'property.import_gbp_v2' as const,
  organizationId: actor.organizationId,
  propertyId: null,
  connectionId,
  initiatorUserId: actor.userId,
  expectedCredentialGeneration: 5,
  approvalBindingId,
  authorizationVector: authorization().authorizationVector,
})

function setup(
  input?: Readonly<{
    authorize?: GoogleImportCommandAuthorizer
    classify?: GoogleImportPropertyClassifier
  }>,
) {
  const authorizeGoogleImportCommand: GoogleImportCommandAuthorizer =
    input?.authorize ??
    vi.fn(async () => ({
      ok: true as const,
      authorization: authorization(),
      accessToken: 'access-token',
    }))
  const classifyCandidates: GoogleImportPropertyClassifier =
    input?.classify ??
    vi.fn(async ({ candidates }) =>
      candidates.map((candidate: GbpLocationCandidate) => ({
        accountId: candidate.binding.accountId,
        locationId: candidate.binding.locationId,
        accountDisplayName: candidate.accountDisplayName,
        businessName: candidate.businessName,
        address: candidate.address,
        primaryCategory: candidate.primaryCategory,
        countryCode: candidate.countryCode,
        eligibility: { kind: 'create' as const },
        expectedSourceEpoch: null,
        expectedProfileVersion: null,
        affectedPropertyId: null,
      })),
    )
  const references = {
    publishAccountPage: vi.fn(async () => ({
      ok: true as const,
      value: {
        items: [
          { accountRef: 'v1.account', displayName: 'Primary', role: 'owner' as const },
        ],
        nextCursor: 'v1.accounts-cursor',
        contentExpiresAt: '2026-08-12T10:15:00.000Z',
        authorizationLease: {
          leaseRef: 'v1.lease',
          expiresAt: '2026-08-12T10:00:30.000Z',
          ttlSeconds: 30,
          renewAfterMs: 10_000 as const,
        },
        contentTtlSeconds: 900,
      },
    })),
    resolveAccount: vi.fn(async () => ({
      ok: true as const,
      accountId: 'provider-account-1',
      displayName: 'Primary',
      role: 'owner' as const,
    })),
    redeemAccountsCursor: vi.fn(async () => ({
      ok: true as const,
      pageToken: 'provider-accounts-page-2',
    })),
    publishCandidatePage: vi.fn(async () => ({
      ok: true as const,
      value: {
        items: [],
        nextCursor: null,
        contentExpiresAt: '2026-08-12T10:15:00.000Z',
        authorizationLease: {
          leaseRef: 'v1.lease',
          expiresAt: '2026-08-12T10:00:30.000Z',
          ttlSeconds: 30,
          renewAfterMs: 10_000 as const,
        },
        contentTtlSeconds: 900,
      },
    })),
    redeemLocationsCursor: vi.fn(async () => ({
      ok: true as const,
      accountRef: 'v1.account',
      accountId: 'provider-account-1',
      accountDisplayName: 'Primary',
      pageToken: 'provider-locations-page-2',
    })),
    resolveCandidate: vi.fn(async () => ({
      ok: false as const,
      code: 'not_found' as const,
    })),
    claimCandidates: vi.fn(async () => ({
      ok: false as const,
      code: 'not_found' as const,
    })),
    releaseCandidateClaims: vi.fn(async () => true),
    consumeCandidateClaims: vi.fn(async () => true),
    renewLease: vi.fn(async () => ({
      ok: true as const,
      lease: {
        leaseRef: 'v1.lease',
        expiresAt: '2026-08-12T10:00:30.000Z',
        ttlSeconds: 30,
        renewAfterMs: 10_000 as const,
      },
    })),
    invalidateOrganization: vi.fn(async () => true),
    invalidateUser: vi.fn(async () => true),
    invalidateConnection: vi.fn(async () => true),
    invalidateProperty: vi.fn(async () => true),
  } satisfies GoogleImportReferenceStore
  const accounts = {
    listAccounts: vi.fn(async () => ({
      items: [
        {
          resourceName: GOOGLE_ACCOUNT_PRIMARY_RESOURCE,
          accountId: 'provider-account-1',
          displayName: 'Primary',
          role: 'owner' as const,
        },
      ],
      nextPageToken: 'provider-accounts-next',
    })),
  }
  const locations = {
    listLocations: vi.fn(async () => ({
      items: [
        {
          binding: {
            accountId: 'provider-account-1',
            locationId: 'provider-location-1',
          },
          accountDisplayName: 'Primary',
          businessName: 'Cafe One',
          address: '1 Main Street',
          primaryCategory: 'Cafe',
          countryCode: 'US',
        },
      ],
      nextPageToken: 'provider-locations-next',
    })),
  }
  const discovery = createGoogleImportDiscovery({
    authorizeGoogleImportCommand,
    classifyCandidates,
    references,
    accounts,
    locations,
    nowMs: () => Date.parse('2026-08-12T10:00:00.000Z'),
  })
  return {
    discovery,
    authorizeGoogleImportCommand,
    classifyCandidates,
    references,
    accounts,
    locations,
  }
}

describe('Google import discovery', () => {
  it('loads exactly one account page and replaces provider pagination with an opaque cursor', async () => {
    const { discovery, accounts, references, authorizeGoogleImportCommand } = setup()

    const page = await discovery.listAccounts({ connectionId }, actor)

    expect(accounts.listAccounts).toHaveBeenCalledWith({
      accessToken: 'access-token',
      authorization: providerAuthorization(),
      signal: undefined,
    })
    expect(authorizeGoogleImportCommand).toHaveBeenCalledTimes(2)
    expect(references.publishAccountPage).toHaveBeenCalledWith({
      authorization: authorization(),
      accounts: [
        {
          accountId: 'provider-account-1',
          displayName: 'Primary',
          role: 'owner',
        },
      ],
      nextPageToken: 'provider-accounts-next',
      contentDeadlineMs: Date.parse('2026-08-12T10:15:00.000Z'),
    })
    expect(page.items[0]).toEqual({
      accountRef: 'v1.account',
      displayName: 'Primary',
      role: 'owner',
    })
    expect(JSON.stringify(page)).not.toContain('provider-account-1')
    expect(JSON.stringify(page)).not.toContain('provider-accounts-next')
  })

  it('redeems an account cursor before loading only the requested next page', async () => {
    const { discovery, accounts, references } = setup()

    await discovery.listAccounts({ connectionId, cursorRef: 'v1.accounts-cursor' }, actor)

    expect(references.redeemAccountsCursor).toHaveBeenCalledWith({
      cursorRef: 'v1.accounts-cursor',
      authorization: authorization(),
    })
    expect(accounts.listAccounts).toHaveBeenCalledWith({
      accessToken: 'access-token',
      authorization: providerAuthorization(),
      pageToken: 'provider-accounts-page-2',
      signal: undefined,
    })
  })

  it('resolves account routing server-side and publishes classified candidates', async () => {
    const { discovery, locations, classifyCandidates, references } = setup()

    const page = await discovery.listCandidates(
      { connectionId, accountRef: 'v1.account' },
      actor,
    )

    expect(locations.listLocations).toHaveBeenCalledWith({
      accessToken: 'access-token',
      authorization: providerAuthorization(),
      accountId: 'provider-account-1',
      accountDisplayName: 'Primary',
      signal: undefined,
    })
    expect(classifyCandidates).toHaveBeenCalledOnce()
    expect(references.publishCandidatePage).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization: authorization(),
        account: {
          accountRef: 'v1.account',
          accountId: 'provider-account-1',
          displayName: 'Primary',
        },
        nextPageToken: 'provider-locations-next',
      }),
    )
    expect(page.items).toEqual([])
  })

  it('does not call Google when initial authorization denies', async () => {
    const authorize = vi.fn(async () => ({
      ok: false as const,
      code: 'authorization_denied' as const,
    }))
    const { discovery, accounts, references } = setup({ authorize })

    await expect(discovery.listAccounts({ connectionId }, actor)).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'Google import discovery failed: unauthorized',
    })
    expect(accounts.listAccounts).not.toHaveBeenCalled()
    expect(references.publishAccountPage).not.toHaveBeenCalled()
  })

  it('discards a parsed provider page when post-call authorization changes', async () => {
    const authorize = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        authorization: authorization(),
        accessToken: 'access-token',
      })
      .mockResolvedValueOnce({
        ok: false as const,
        code: 'authorization_changed' as const,
      })
    const { discovery, accounts, references } = setup({ authorize })

    await expect(discovery.listAccounts({ connectionId }, actor)).rejects.toMatchObject({
      code: 'unauthorized',
    })
    expect(accounts.listAccounts).toHaveBeenCalledOnce()
    expect(references.publishAccountPage).not.toHaveBeenCalled()
  })

  it('renews a content-free lease without a provider call', async () => {
    const { discovery, accounts, locations, references } = setup()

    const lease = await discovery.renewAuthorizationLease(
      { connectionId, leaseRef: 'v1.lease' },
      actor,
    )

    expect(references.renewLease).toHaveBeenCalledOnce()
    expect(accounts.listAccounts).not.toHaveBeenCalled()
    expect(locations.listLocations).not.toHaveBeenCalled()
    expect(lease.leaseRef).toBe('v1.lease')
  })

  it('never includes provider identifiers in reference failures', async () => {
    const { discovery, references } = setup()
    references.resolveAccount.mockResolvedValueOnce({
      ok: false,
      code: 'binding_mismatch',
    } as never)

    const error = await discovery
      .listCandidates({ connectionId, accountRef: 'v1.provider-account-1' }, actor)
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'reference_invalid' })
    expect(String(error)).not.toContain('provider-account-1')
  })
})
