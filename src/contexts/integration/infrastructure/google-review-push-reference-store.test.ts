import { describe, expect, it } from 'vitest'
import { createInMemoryProviderEphemeralStore } from '#/shared/provider-ephemeral/in-memory-store'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { createGoogleReviewPushReferenceStore } from './google-review-push-reference-store'

const NOW_MS = Date.parse('2026-08-27T08:00:00.000Z')
const KEYRING = `v1:${'42'.repeat(32)}`
const SCOPE = Object.freeze({
  organizationId: 'org-google-push',
  propertyId: '00000000-0000-4000-8000-000000000001',
  connectionId: '00000000-0000-4000-8000-000000000002',
  sourceEpoch: 7,
})

function setup() {
  const time = { value: NOW_MS }
  let nonce = 0
  const store = createGoogleReviewPushReferenceStore({
    store: createInMemoryProviderEphemeralStore(() => time.value),
    keys: createVersionedHmacKeyring(KEYRING),
    nowMs: () => time.value,
    randomNonce: () => Buffer.alloc(32, ++nonce).toString('base64url'),
  })
  return { store, time }
}

describe('Google review push reference store', () => {
  it('keeps the raw provider review resource only behind a short-lived opaque handle', async () => {
    const { store } = setup()

    const published = await store.publish({
      scope: SCOPE,
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    })

    expect(published.ok).toBe(true)
    if (!published.ok) return
    expect(published.referenceRef).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/u)
    expect(published.referenceRef).not.toContain('accounts/')
    await expect(
      store.resolve({ scope: SCOPE, referenceRef: published.referenceRef }),
    ).resolves.toEqual({
      ok: true,
      target: {
        locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
        reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
      },
    })
  })

  it('rejects a handle outside its exact property, connection, and source generation', async () => {
    const { store } = setup()
    const published = await store.publish({
      scope: SCOPE,
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    })
    expect(published.ok).toBe(true)
    if (!published.ok) return

    await expect(
      store.resolve({
        scope: { ...SCOPE, sourceEpoch: SCOPE.sourceEpoch + 1 },
        referenceRef: published.referenceRef,
      }),
    ).resolves.toEqual({ ok: false, code: 'binding_mismatch' })
  })

  it('expires after fifteen minutes so delayed work falls back to reconciliation', async () => {
    const { store, time } = setup()
    const published = await store.publish({
      scope: SCOPE,
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    })
    expect(published.ok).toBe(true)
    if (!published.ok) return

    time.value += 15 * 60 * 1_000 + 1
    const result = await store.resolve({
      scope: SCOPE,
      referenceRef: published.referenceRef,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(['expired', 'not_found']).toContain(result.code)
  })

  it('rejects a review resource whose embedded location does not equal locationName', async () => {
    const { store } = setup()
    await expect(
      store.publish({
        scope: SCOPE,
        locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
        reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE.replace(
          '/locations/',
          '/locations/different-',
        ),
      }),
    ).rejects.toThrow('resource mismatch')
  })
})
