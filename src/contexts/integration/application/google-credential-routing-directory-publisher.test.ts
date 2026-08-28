import { describe, expect, it } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { validateGoogleCredentialRoutingDirectory } from '#/shared/routing/google-credential-routing'
import {
  createGoogleCredentialRoutingDirectoryPublisher,
  type GoogleCredentialRoutingDirectoryPublicationStore,
} from './google-credential-routing-directory-publisher'

const NOW = Date.parse('2026-08-27T12:00:00Z')

function storeWithFacts(
  overrides: Partial<
    Parameters<GoogleCredentialRoutingDirectoryPublicationStore['publishNext']>[0]
  > = {},
) {
  let revision = 4
  const published: unknown[] = []
  const store: GoogleCredentialRoutingDirectoryPublicationStore = {
    publishNext: async (build) => {
      revision += 1
      const value = build({
        revision,
        organizationHomes: [
          { organizationId: 'org-b', homeCellId: 'us', authorityGeneration: 2 },
          { organizationId: 'org-a', homeCellId: 'us', authorityGeneration: 1 },
        ],
        connectionHomes: [
          {
            organizationId: 'org-b',
            connectionId: 'connection-b',
            homeCellId: 'us',
            authorityGeneration: 2,
          },
          {
            organizationId: 'org-a',
            connectionId: 'connection-a',
            homeCellId: 'us',
            authorityGeneration: 1,
          },
        ],
        propertyTargets: [
          {
            organizationId: 'org-b',
            connectionId: 'connection-b',
            propertyId: 'property-b',
            targetCellId: 'us',
          },
          {
            organizationId: 'org-a',
            connectionId: 'connection-a',
            propertyId: 'property-a',
            targetCellId: 'us',
          },
        ],
        unhomedActiveConnectionCount: 0,
        unroutableActivePropertyCount: 0,
        authorityConflictCount: 0,
        ...overrides,
      })
      published.push(value)
      return value
    },
    loadCurrent: async () => (published.at(-1) as never) ?? null,
  }
  return store
}

describe('Google credential routing-directory publisher', () => {
  it('publishes monotonic, canonical, signed content-free snapshots', async () => {
    const keys = createVersionedHmacKeyring(`v1:${'33'.repeat(32)}`)
    const store = storeWithFacts()
    const publish = createGoogleCredentialRoutingDirectoryPublisher({
      store,
      keys,
      nowMs: () => NOW,
      ttlMs: 60_000,
      isAcceptingCell: (cell) => cell === 'us',
    })

    const first = await publish()
    const second = await publish()
    expect(first.revision).toBe(5)
    expect(second.revision).toBe(6)
    expect(first.organizationHomes.map((entry) => entry.organizationId)).toEqual([
      'org-a',
      'org-b',
    ])
    expect(
      validateGoogleCredentialRoutingDirectory(first, {
        keys,
        nowMs: NOW,
        minimumRevision: 5,
        isAcceptingCell: (cell) => cell === 'us',
      }),
    ).toMatchObject({ ok: true })
    expect(JSON.stringify(first)).not.toMatch(/token|review|guest|country/iu)
  })

  it.each([
    ['unhomed active connection', { unhomedActiveConnectionCount: 1 }],
    ['unroutable active property', { unroutableActivePropertyCount: 1 }],
    ['authority conflict', { authorityConflictCount: 1 }],
  ] as const)(
    'refuses publication with %s instead of omitting an exact route',
    async (_name, gap) => {
      const publish = createGoogleCredentialRoutingDirectoryPublisher({
        store: storeWithFacts(gap),
        keys: createVersionedHmacKeyring(`v1:${'33'.repeat(32)}`),
        nowMs: () => NOW,
        ttlMs: 60_000,
        isAcceptingCell: (cell) => cell === 'us',
      })
      await expect(publish()).rejects.toThrow(/incomplete/u)
    },
  )

  it('refuses a non-advancing durable revision', async () => {
    const keys = createVersionedHmacKeyring(`v1:${'33'.repeat(32)}`)
    let current: Awaited<
      ReturnType<GoogleCredentialRoutingDirectoryPublicationStore['loadCurrent']>
    > = null
    const store = storeWithFacts()
    const wrapped: GoogleCredentialRoutingDirectoryPublicationStore = {
      loadCurrent: async () => current,
      publishNext: async (build) => {
        const value = await store.publishNext(build)
        current ??= value
        return current
      },
    }
    const publish = createGoogleCredentialRoutingDirectoryPublisher({
      store: wrapped,
      keys,
      nowMs: () => NOW,
      ttlMs: 60_000,
      isAcceptingCell: (cell) => cell === 'us',
    })
    await publish()
    await expect(publish()).rejects.toThrow(/advance/u)
  })
})
