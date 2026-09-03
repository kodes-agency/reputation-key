import { describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { GbpLocationCandidate } from './google-provider-contract'
import {
  createGoogleImportPropertyClassifier,
  type GoogleImportPropertyDiscoveryView,
} from './google-import-property-classifier'

const actor: AuthContext = {
  organizationId: organizationId('org-1'),
  userId: userId('user-1'),
  role: 'AccountAdmin',
}
const selectedConnectionId = googleConnectionId('11111111-1111-4111-8111-111111111111')
const otherConnectionId = googleConnectionId('22222222-2222-4222-8222-222222222222')

const candidate = (
  locationId: string,
  accountId = 'account-1',
  countryCode: string | null = 'US',
  verification: GbpLocationCandidate['verification'] = 'verified',
): GbpLocationCandidate => ({
  binding: { accountId, locationId },
  accountDisplayName: 'Primary account',
  businessName: `Business ${locationId}`,
  address: '1 Main Street',
  primaryCategory: 'Restaurant',
  countryCode,
  verification,
})

const view = (
  id: string,
  locationId: string,
  overrides: Partial<GoogleImportPropertyDiscoveryView> = {},
): GoogleImportPropertyDiscoveryView => ({
  organizationId: actor.organizationId,
  propertyId: propertyId(id),
  state: 'active',
  connectionId: selectedConnectionId,
  accountId: 'account-1',
  locationId,
  sourceEpoch: 7,
  profileVersion: 3,
  name: `Property ${id}`,
  address: 'Existing address',
  countryCode: 'US',
  timezone: 'America/New_York',
  processingRegion: 'us',
  lifecycleState: 'active',
  deletedAt: null,
  ...overrides,
})

describe('Google import Property candidate classifier', () => {
  it('classifies create, imported, relink, conflict, resolved-region, and inaccessible rows', async () => {
    const rows = [
      view('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'already'),
      view('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'relink', {
        state: 'disconnected',
      }),
      view('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'conflict', {
        connectionId: otherConnectionId,
      }),
      view('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'hidden', {
        state: 'disconnected',
      }),
      view('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'suspended', {
        state: 'disconnected',
        lifecycleState: 'suspended',
      }),
    ]
    const readByLocationIds = vi.fn(async () => rows)
    const isAllowed = vi.fn(async ({ propertyId: target, action }) => {
      if (target === 'dddddddd-dddd-4ddd-8ddd-dddddddddddd') return false
      if (action === 'property.create') return true
      return true
    })
    const classify = createGoogleImportPropertyClassifier({
      readByLocationIds,
      isAllowed,
    })

    const result = await classify({
      actor,
      connectionId: selectedConnectionId,
      candidates: [
        candidate('new'),
        candidate('already'),
        candidate('relink'),
        candidate('conflict'),
        candidate('hidden'),
        candidate('suspended'),
        candidate('europe', 'account-1', 'GB'),
        candidate('unknown-region', 'account-1', null),
      ],
    })

    expect(readByLocationIds).toHaveBeenCalledWith(actor.organizationId, [
      'new',
      'already',
      'relink',
      'conflict',
      'hidden',
      'suspended',
      'europe',
      'unknown-region',
    ])
    expect(result.map((item) => item.eligibility)).toEqual([
      { kind: 'create' },
      {
        kind: 'already_imported',
        propertyId: propertyId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      },
      {
        kind: 'relink',
        propertyId: propertyId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
        profile: {
          name: 'Property bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          address: 'Existing address',
          countryCode: 'US',
          timezone: 'America/New_York',
          profileVersion: 3,
        },
      },
      { kind: 'active_binding_conflict' },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
      { kind: 'create' },
      { kind: 'region_unavailable' },
    ])
    expect(result[2]).toMatchObject({
      expectedSourceEpoch: 7,
      expectedProfileVersion: 3,
      affectedPropertyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })
    expect(result[4]).not.toHaveProperty('eligibility.propertyId')
  })

  it('marks otherwise-creatable rows unavailable without property.create', async () => {
    const classify = createGoogleImportPropertyClassifier({
      readByLocationIds: vi.fn(async () => []),
      isAllowed: vi.fn(async () => false),
    })

    await expect(
      classify({
        actor,
        connectionId: selectedConnectionId,
        candidates: [candidate('new')],
      }),
    ).resolves.toMatchObject([{ eligibility: { kind: 'unavailable' } }])
  })

  it('withholds an unverified location from import and reports why', async () => {
    const classify = createGoogleImportPropertyClassifier({
      readByLocationIds: vi.fn(async () => []),
      isAllowed: vi.fn(async () => true),
    })

    await expect(
      classify({
        actor,
        connectionId: selectedConnectionId,
        candidates: [candidate('unverified', 'account-1', 'US', 'unverified')],
      }),
    ).resolves.toMatchObject([{ eligibility: { kind: 'verification_required' } }])
  })

  it('reports verification ahead of an unprocessable region', async () => {
    // Verification is the blocker the operator can clear themselves, in Google.
    const classify = createGoogleImportPropertyClassifier({
      readByLocationIds: vi.fn(async () => []),
      isAllowed: vi.fn(async () => true),
    })

    await expect(
      classify({
        actor,
        connectionId: selectedConnectionId,
        candidates: [candidate('both', 'account-1', 'JP', 'unverified')],
      }),
    ).resolves.toMatchObject([{ eligibility: { kind: 'verification_required' } }])
  })

  it('still offers a location whose verification could not be observed', async () => {
    const classify = createGoogleImportPropertyClassifier({
      readByLocationIds: vi.fn(async () => []),
      isAllowed: vi.fn(async () => true),
    })

    await expect(
      classify({
        actor,
        connectionId: selectedConnectionId,
        candidates: [candidate('unknown-state', 'account-1', 'US', 'unknown')],
      }),
    ).resolves.toMatchObject([{ eligibility: { kind: 'create' } }])
  })

  it('treats an account with no locations as an empty page, not a failure', async () => {
    // The binding reader rejects an empty id list as an invalid binding, so
    // classifying an empty provider page used to surface as
    // "Locations unavailable" for accounts that simply own no locations.
    const readByLocationIds = vi.fn(async () => [])
    const classify = createGoogleImportPropertyClassifier({
      readByLocationIds,
      isAllowed: vi.fn(async () => true),
    })

    await expect(
      classify({ actor, connectionId: selectedConnectionId, candidates: [] }),
    ).resolves.toEqual([])
    expect(readByLocationIds).not.toHaveBeenCalled()
  })

  it('fails closed on duplicate or out-of-scope Property reader results', async () => {
    const duplicate = view('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'same')
    const classifyDuplicate = createGoogleImportPropertyClassifier({
      readByLocationIds: vi.fn(async () => [duplicate, duplicate]),
      isAllowed: vi.fn(async () => true),
    })
    await expect(
      classifyDuplicate({
        actor,
        connectionId: selectedConnectionId,
        candidates: [candidate('same')],
      }),
    ).rejects.toThrow('Google import Property classification failed')

    const classifyCrossTenant = createGoogleImportPropertyClassifier({
      readByLocationIds: vi.fn(async () => [
        view('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'same', {
          organizationId: organizationId('org-2'),
        }),
      ]),
      isAllowed: vi.fn(async () => true),
    })
    await expect(
      classifyCrossTenant({
        actor,
        connectionId: selectedConnectionId,
        candidates: [candidate('same')],
      }),
    ).rejects.toThrow('Google import Property classification failed')
  })
})
