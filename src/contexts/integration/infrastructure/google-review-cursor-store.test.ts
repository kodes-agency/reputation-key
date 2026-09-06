import { describe, expect, it } from 'vitest'
import type {
  ProviderEphemeralCompareAndSwapEntry,
  ProviderEphemeralStore,
  ProviderEphemeralNamespace,
} from '#/shared/provider-ephemeral/provider-ephemeral-store'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  createGoogleReviewCursorStore,
  type GoogleReviewCursorAuthorization,
} from './google-review-cursor-store'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '../../../../test-fixtures/generated/google-provider-identifiers-v1'

const ORGANIZATION_ID = '0UM0PoDLJNJ3yGCeBMERaQkQyxer9BuC'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'
const CONNECTION_ID = '00000000-0000-4000-8000-000000000003'
const RUN_ID = '00000000-0000-4000-8000-000000000004'
const LOCATION = GOOGLE_LOCATION_PRIMARY_RESOURCE
const NOW_MS = Date.parse('2026-08-16T10:00:00.000Z')
const OLD_KEY = '11'.repeat(32)
const NEW_KEY = '22'.repeat(32)

const authorization: GoogleReviewCursorAuthorization = {
  connectionLifecycleVersion: 7,
  connectionAccessVersion: 11,
  credentialGeneration: 13,
  authorizationVectorSha256: 'ab'.repeat(32),
}

function scope(pageIndex: number, phase: 'main' | 'confirmation' = 'main') {
  return {
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    connectionId: CONNECTION_ID,
    sourceEpoch: 17,
    locationName: LOCATION,
    runId: RUN_ID,
    phase,
    pageIndex,
  } as const
}

function createMemoryStore(): ProviderEphemeralStore & {
  readonly values: Map<string, string>
} {
  const values = new Map<string, string>()
  const key = (namespace: ProviderEphemeralNamespace, value: string) =>
    `${namespace}:${value}`
  return {
    values,
    putIfAbsent: async (namespace, entryKey, value) => {
      const location = key(namespace, entryKey)
      if (values.has(location)) return false
      values.set(location, value)
      return true
    },
    read: async (namespace, entryKey) => values.get(key(namespace, entryKey)),
    consume: async (namespace, entryKey) => {
      const location = key(namespace, entryKey)
      const value = values.get(location)
      values.delete(location)
      return value
    },
    consumeIfEquals: async (namespace, entryKey, expectedValue) => {
      const location = key(namespace, entryKey)
      const value = values.get(location)
      if (value === undefined) return 'not_found'
      if (value !== expectedValue) return 'mismatch'
      values.delete(location)
      return 'consumed'
    },
    replaceIfEquals: async (namespace, entryKey, expectedValue, nextValue) => {
      const location = key(namespace, entryKey)
      const value = values.get(location)
      if (value === undefined) return 'not_found'
      if (value !== expectedValue) return 'mismatch'
      values.set(location, nextValue)
      return 'replaced'
    },
    compareAndSwapMany: async (
      namespace,
      entries: readonly ProviderEphemeralCompareAndSwapEntry[],
    ) => {
      for (const entry of entries) {
        const current = values.get(key(namespace, entry.key))
        if (
          (entry.expectedValue === null && current !== undefined) ||
          (entry.expectedValue !== null && current !== entry.expectedValue)
        ) {
          return false
        }
      }
      for (const entry of entries) {
        const location = key(namespace, entry.key)
        if (entry.next === null) values.delete(location)
        else values.set(location, entry.next.value)
      }
      return true
    },
    remove: async (namespace, entryKey) => {
      values.delete(key(namespace, entryKey))
    },
  }
}

function createStore(
  providerStore: ProviderEphemeralStore,
  keyring = createVersionedHmacKeyring(`v1:${OLD_KEY}`),
  nowMs = () => NOW_MS,
) {
  let nonce = 0
  return createGoogleReviewCursorStore({
    store: providerStore,
    keys: keyring,
    nowMs,
    randomNonce: () => Buffer.alloc(32, ++nonce).toString('base64url'),
  })
}

describe('GoogleReviewCursorStore', () => {
  it('publishes an opaque handle and redeems the provider token only inside Integration', async () => {
    const providerStore = createMemoryStore()
    const cursors = createStore(providerStore)

    const published = await cursors.publishNext({
      parentCursorRef: null,
      scope: scope(0),
      nextScope: scope(1),
      authorization,
      nextPageToken: 'provider-page-token',
    })

    expect(published.ok).toBe(true)
    if (!published.ok) return
    expect(published.value.nextCursorRef).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/u)
    expect(published.value.nextCursorRef).not.toContain('provider-page-token')
    expect(
      await cursors.redeem({
        cursorRef: published.value.nextCursorRef,
        scope: scope(1),
        authorization,
      }),
    ).toEqual({ ok: true, value: { pageToken: 'provider-page-token' } })
  })

  it('binds a cursor to audience, scope, authorization generation, and next page', async () => {
    const providerStore = createMemoryStore()
    const cursors = createStore(providerStore)
    const published = await cursors.publishNext({
      parentCursorRef: null,
      scope: scope(0),
      nextScope: scope(1),
      authorization,
      nextPageToken: 'provider-page-token',
    })
    if (!published.ok) throw new Error('fixture publication failed')

    await expect(
      cursors.redeem({
        cursorRef: published.value.nextCursorRef,
        scope: { ...scope(1), runId: '00000000-0000-4000-8000-000000000099' },
        authorization,
      }),
    ).resolves.toEqual({ ok: false, code: 'binding_mismatch' })
    await expect(
      cursors.redeem({
        cursorRef: published.value.nextCursorRef,
        scope: scope(1),
        authorization: { ...authorization, credentialGeneration: 14 },
      }),
    ).resolves.toEqual({ ok: false, code: 'binding_mismatch' })
    await expect(
      cursors.publishNext({
        parentCursorRef: null,
        scope: scope(1),
        nextScope: scope(2),
        authorization,
        nextPageToken: 'provider-page-token',
      }),
    ).resolves.toEqual({ ok: false, code: 'binding_mismatch' })
    await expect(
      cursors.publishNext({
        parentCursorRef: null,
        scope: scope(0),
        nextScope: scope(2),
        authorization,
        nextPageToken: 'provider-page-token',
      }),
    ).resolves.toEqual({ ok: false, code: 'binding_mismatch' })
  })

  it('returns the same child on replay and rejects a changed provider token', async () => {
    const providerStore = createMemoryStore()
    const cursors = createStore(providerStore)
    const input = {
      parentCursorRef: null,
      scope: scope(0),
      nextScope: scope(1),
      authorization,
      nextPageToken: 'provider-page-token',
    } as const
    const first = await cursors.publishNext(input)
    const replay = await cursors.publishNext(input)

    expect(first.ok && replay.ok && replay.value.nextCursorRef).toBe(
      first.ok ? first.value.nextCursorRef : null,
    )
    await expect(
      cursors.publishNext({ ...input, nextPageToken: 'different-provider-token' }),
    ).resolves.toEqual({ ok: false, code: 'conflict' })
  })

  it('decrements the exact replay budget atomically', async () => {
    const providerStore = createMemoryStore()
    const cursors = createStore(providerStore)
    const published = await cursors.publishNext({
      parentCursorRef: null,
      scope: scope(0),
      nextScope: scope(1),
      authorization,
      nextPageToken: 'provider-page-token',
    })
    if (!published.ok) throw new Error('fixture publication failed')

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        cursors.redeem({
          cursorRef: published.value.nextCursorRef,
          scope: scope(1),
          authorization,
        }),
      ).resolves.toMatchObject({ ok: true })
    }
    await expect(
      cursors.redeem({
        cursorRef: published.value.nextCursorRef,
        scope: scope(1),
        authorization,
      }),
    ).resolves.toEqual({ ok: false, code: 'exhausted' })
  })

  it('accepts a retained-key cursor after rotation and cleans every version index', async () => {
    const providerStore = createMemoryStore()
    const beforeRotation = createStore(providerStore)
    const published = await beforeRotation.publishNext({
      parentCursorRef: null,
      scope: scope(0),
      nextScope: scope(1),
      authorization,
      nextPageToken: 'provider-page-token',
    })
    if (!published.ok) throw new Error('fixture publication failed')

    const afterRotation = createStore(
      providerStore,
      createVersionedHmacKeyring(`v2:${NEW_KEY},v1:${OLD_KEY}`),
    )
    await expect(
      afterRotation.redeem({
        cursorRef: published.value.nextCursorRef,
        scope: scope(1),
        authorization,
      }),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      afterRotation.discardRun({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: 17,
        runId: RUN_ID,
      }),
    ).resolves.toBe(true)
    expect(providerStore.values.size).toBeLessThanOrEqual(1)
  })

  it('expires at equality and never releases the token', async () => {
    const providerStore = createMemoryStore()
    let atMs = NOW_MS
    const cursors = createStore(providerStore, undefined, () => atMs)
    const published = await cursors.publishNext({
      parentCursorRef: null,
      scope: scope(0),
      nextScope: scope(1),
      authorization,
      nextPageToken: 'provider-page-token',
    })
    if (!published.ok) throw new Error('fixture publication failed')
    atMs += 30 * 60 * 1_000

    await expect(
      cursors.redeem({
        cursorRef: published.value.nextCursorRef,
        scope: scope(1),
        authorization,
      }),
    ).resolves.toEqual({ ok: false, code: 'expired' })
  })
})
