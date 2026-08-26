import { describe, expect, it, vi, type Mock } from 'vitest'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import type { GoogleReviewCursorStore } from '../google-review-cursor-store'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '../../../../../test-fixtures/generated/google-provider-identifiers-v1'
import { assertDirectProviderEgressAllowed } from '#/shared/config/provider-config-guards'
import { createGoogleReviewApiAdapter } from './google-review-api.adapter'

const ORG_ID = organizationId('0UM0PoDLJNJ3yGCeBMERaQkQyxer9BuC')
const PROPERTY_ID = propertyId('00000000-0000-4000-8000-000000000002')
const CONNECTION_ID = googleConnectionId('00000000-0000-4000-8000-000000000003')
const RUN_ID = '00000000-0000-4000-8000-000000000004'
const authorization = Object.freeze({
  capability: 'property.import_gbp_v2',
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  connectionId: CONNECTION_ID,
  initiatorUserId: '00000000-0000-4000-8000-000000000005',
  approvalBindingId: 'approval-1',
  expectedCredentialGeneration: 3,
  authorizationVector: Object.freeze({ generation: 3 }),
}) satisfies GoogleProviderCallAuthorization

const connection = {
  status: 'active',
  credentialUseState: 'active',
  lifecycleVersion: 7,
  accessVersion: 11,
  credentialGeneration: 3,
}

function cursorStore(
  overrides: Partial<GoogleReviewCursorStore> = {},
): GoogleReviewCursorStore {
  return {
    redeem: vi.fn(async () => ({
      ok: true as const,
      value: { pageToken: 'provider-page-token' },
    })),
    publishNext: vi.fn(async () => ({
      ok: true as const,
      value: { nextCursorRef: `v1.${'a'.repeat(43)}` },
    })),
    discardRun: vi.fn(async () => true),
    ...overrides,
  }
}

function providerReview() {
  return {
    name: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    starRating: 'FIVE',
    comment: 'Excellent stay',
    reviewer: { displayName: 'Guest' },
    createTime: '2026-08-01T10:00:00.000Z',
  }
}

function createAdapter(
  input: Readonly<{
    execute: Mock
    cursors?: GoogleReviewCursorStore
    authorizeProviderCall?: Mock
    findById?: Mock
  }>,
) {
  const authorizeProviderCall =
    input.authorizeProviderCall ??
    vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      authorization,
    })
  const findById = input.findById ?? vi.fn().mockResolvedValue(connection)
  const warn = vi.fn()
  return {
    api: createGoogleReviewApiAdapter({
      connectionRepo: { findById } as never,
      encryption: {} as never,
      refreshToken: vi.fn() as never,
      logger: { warn } as never,
      baseUrl: 'https://direct-provider.invalid',
      cursorStore: input.cursors ?? cursorStore(),
      executor: { execute: input.execute },
      authorizeProviderCall,
      nowMs: () => Date.parse('2026-08-12T12:00:00.000Z'),
    }),
    authorizeProviderCall,
    findById,
    warn,
  }
}

function listInput(cursorRef: string | null = null, pageIndex = 0) {
  return {
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    connectionId: CONNECTION_ID,
    sourceEpoch: 17,
    locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    runId: RUN_ID,
    phase: 'main' as const,
    pageIndex,
    cursorRef,
  }
}

describe('GoogleReviewApiAdapter', () => {
  it('lists one fixed bounded page and replaces the provider token with an opaque ref', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        contentType: 'application/json; charset=utf-8',
        cacheControl: null,
        retryAfter: null,
      },
      body: new TextEncoder().encode(
        JSON.stringify({
          reviews: [providerReview()],
          totalReviewCount: 2,
          nextPageToken: 'provider-next-page-token',
        }),
      ),
    })
    const cursors = cursorStore()
    const { api } = createAdapter({ execute, cursors })

    const page = await api.listReviewsPage(listInput())

    expect(execute).toHaveBeenCalledWith(
      {
        routeKey: 'reviews.list',
        accessToken: 'access-token',
        locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      },
      expect.objectContaining({ authorization }),
    )
    expect(cursors.publishNext).toHaveBeenCalledWith(
      expect.objectContaining({
        parentCursorRef: null,
        nextPageToken: 'provider-next-page-token',
        scope: expect.objectContaining({ pageIndex: 0 }),
        nextScope: expect.objectContaining({ pageIndex: 1 }),
      }),
    )
    expect(page).toEqual({
      reviews: [
        expect.objectContaining({
          externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
          externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
          rating: 5,
          text: 'Excellent stay',
        }),
      ],
      totalReviewCount: 2,
      nextCursorRef: `v1.${'a'.repeat(43)}`,
    })
    expect(JSON.stringify(page)).not.toContain('provider-next-page-token')
  })

  it('accepts the provider fields Google actually sends and drops the unmodelled ones', async () => {
    // Shape observed in google-closed-beta 2026-08-19: per-review `reviewId`,
    // `updateTime`, `reviewReplyUrl` plus a top-level `averageRating`. Strict
    // schemas rejected the page and the property synced zero reviews.
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        contentType: 'application/json; charset=utf-8',
        cacheControl: null,
        retryAfter: null,
      },
      body: new TextEncoder().encode(
        JSON.stringify({
          reviews: [
            {
              ...providerReview(),
              reviewId: 'provider-review-id',
              updateTime: '2026-08-02T10:00:00.000Z',
              reviewReplyUrl: 'https://business.google.com/reviews/reply',
              reviewer: { displayName: 'Guest', isAnonymous: false },
            },
          ],
          totalReviewCount: 1,
          averageRating: 4.7,
        }),
      ),
    })
    const { api } = createAdapter({ execute })

    const page = await api.listReviewsPage(listInput())

    expect(page.totalReviewCount).toBe(1)
    expect(page.reviews).toEqual([
      expect.objectContaining({
        externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
        rating: 5,
        text: 'Excellent stay',
        sourceCreatedAt: new Date('2026-08-01T10:00:00.000Z'),
        sourceUpdatedAt: new Date('2026-08-02T10:00:00.000Z'),
      }),
    ])
    const serialized = JSON.stringify(page)
    expect(serialized).not.toContain('reviewReplyUrl')
    expect(serialized).not.toContain('provider-review-id')
  })

  it('maps a translated Google comment to the original as text and the translation aside', async () => {
    // 76 of 93 texted closed-beta reviews arrive wrapped like this. Storing the
    // blob as `text` made cld3 detect Google's English translation, so 8
    // Bulgarian reviews were judged reliable English.
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        contentType: 'application/json; charset=utf-8',
        cacheControl: null,
        retryAfter: null,
      },
      body: new TextEncoder().encode(
        JSON.stringify({
          reviews: [
            {
              ...providerReview(),
              comment: '(Translated by Google) Ok\n\n(Original)\nОк',
            },
          ],
          totalReviewCount: 1,
        }),
      ),
    })
    const { api } = createAdapter({ execute })

    const page = await api.listReviewsPage(listInput())

    expect(page.reviews).toEqual([
      expect.objectContaining({
        externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
        text: 'Ок',
        translatedText: 'Ok',
      }),
    ])
    expect(page.reviews[0]?.text).not.toContain('Translated by Google')
  })

  it('leaves an unwrapped Google comment as the review text', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        contentType: 'application/json; charset=utf-8',
        cacheControl: null,
        retryAfter: null,
      },
      body: new TextEncoder().encode(
        JSON.stringify({ reviews: [providerReview()], totalReviewCount: 1 }),
      ),
    })
    const { api } = createAdapter({ execute })

    const page = await api.listReviewsPage(listInput())

    expect(page.reviews).toEqual([
      expect.objectContaining({ text: 'Excellent stay', translatedText: null }),
    ])
  })

  it('redeems an opaque cursor inside Integration and never returns the provider token', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        contentType: 'application/json',
        cacheControl: null,
        retryAfter: null,
      },
      body: new TextEncoder().encode(
        JSON.stringify({ reviews: [providerReview()], totalReviewCount: 1 }),
      ),
    })
    const cursors = cursorStore()
    const { api } = createAdapter({ execute, cursors })
    const cursorRef = `v1.${'b'.repeat(43)}`

    const page = await api.listReviewsPage(listInput(cursorRef, 1))

    expect(cursors.redeem).toHaveBeenCalledWith(
      expect.objectContaining({
        cursorRef,
        scope: expect.objectContaining({ pageIndex: 1 }),
      }),
    )
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ pageToken: 'provider-page-token' }),
      expect.anything(),
    )
    expect(page.nextCursorRef).toBeNull()
    expect(JSON.stringify(page)).not.toContain('provider-page-token')
  })

  it('gets exactly one review and treats provider 404 as typed not_found', async () => {
    const foundExecute = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        contentType: 'application/json',
        cacheControl: null,
        retryAfter: null,
      },
      body: new TextEncoder().encode(JSON.stringify(providerReview())),
    })
    const { api: foundApi } = createAdapter({ execute: foundExecute })
    const input = {
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      connectionId: CONNECTION_ID,
      sourceEpoch: 17,
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    }

    await expect(foundApi.getReview(input)).resolves.toEqual({
      status: 'found',
      review: expect.objectContaining({
        externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
      }),
    })
    expect(foundExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        routeKey: 'reviews.get',
        reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
      }),
      expect.anything(),
    )

    const missingExecute = vi.fn().mockResolvedValue({
      ok: true,
      status: 404,
      headers: { contentType: null, cacheControl: null, retryAfter: null },
      body: new Uint8Array(),
    })
    const { api: missingApi } = createAdapter({ execute: missingExecute })
    await expect(missingApi.getReview(input)).resolves.toEqual({
      status: 'not_found',
    })
  })

  it('fails closed on malformed pages, page overflow, and authorization drift', async () => {
    const malformedExecute = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        contentType: 'application/json',
        cacheControl: null,
        retryAfter: null,
      },
      body: new TextEncoder().encode(
        JSON.stringify({
          reviews: Array.from({ length: 51 }, providerReview),
          totalReviewCount: 51,
        }),
      ),
    })
    const { api: malformedApi } = createAdapter({ execute: malformedExecute })
    await expect(malformedApi.listReviewsPage(listInput())).rejects.toMatchObject({
      _tag: 'GoogleReviewApiError',
      code: 'malformed_response',
    })

    const validExecute = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        contentType: 'application/json',
        cacheControl: null,
        retryAfter: null,
      },
      body: new TextEncoder().encode(
        JSON.stringify({ reviews: [providerReview()], totalReviewCount: 1 }),
      ),
    })
    const authorizeProviderCall = vi
      .fn()
      .mockResolvedValueOnce({ accessToken: 'access-token', authorization })
      .mockResolvedValueOnce({
        accessToken: 'new-access-token',
        authorization: {
          ...authorization,
          authorizationVector: { generation: 4 },
        },
      })
    const { api: driftApi } = createAdapter({
      execute: validExecute,
      authorizeProviderCall,
    })
    await expect(driftApi.listReviewsPage(listInput())).rejects.toMatchObject({
      _tag: 'GoogleReviewApiError',
      code: 'authorization_changed',
    })
  })

  it('records the raw store code when a cursor redemption is rejected', async () => {
    // google-closed-beta 2026-08-19: a run applied 6 pages / 256 reviews and
    // then failed with `cursor_failure` and no cause anywhere in the logs,
    // because the adapter maps the store code and the use case collapses the
    // mapping. `expired` is the store's code; `cursor_expired` is the mapping.
    const cursors = cursorStore({
      redeem: vi.fn(async () => ({ ok: false as const, code: 'expired' as const })),
    })
    const execute = vi.fn()
    const { api, warn } = createAdapter({ execute, cursors })

    await expect(
      api.listReviewsPage(listInput(`v1.${'c'.repeat(43)}`, 1)),
    ).rejects.toMatchObject({
      _tag: 'GoogleReviewApiError',
      code: 'cursor_expired',
    })

    expect(warn).toHaveBeenCalledWith(
      {
        event: 'reviews_cursor_rejected',
        operation: 'redeem',
        code: 'expired',
        phase: 'main',
        pageIndex: 1,
        runId: RUN_ID,
      },
      expect.any(String),
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('keeps the store code that the adapter error collapses on publication', async () => {
    // `conflict` and `unavailable` both map onto `provider_unavailable`, so the
    // thrown error cannot tell them apart — the log has to.
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        contentType: 'application/json',
        cacheControl: null,
        retryAfter: null,
      },
      body: new TextEncoder().encode(
        JSON.stringify({
          reviews: [providerReview()],
          totalReviewCount: 51,
          nextPageToken: 'provider-next-page-token',
        }),
      ),
    })
    const cursors = cursorStore({
      publishNext: vi.fn(async () => ({ ok: false as const, code: 'conflict' as const })),
    })
    const { api, warn } = createAdapter({ execute, cursors })

    // A page-5 continuation carries the parent ref redeemed for that page, so
    // this exercises the discriminator's true branch rather than the
    // null-parent-off-page-0 branch the store rejects outright.
    await expect(
      api.listReviewsPage(listInput(`v1.${'a'.repeat(43)}`, 5)),
    ).rejects.toMatchObject({
      _tag: 'GoogleReviewApiError',
      code: 'provider_unavailable',
    })

    expect(warn).toHaveBeenCalledWith(
      {
        event: 'reviews_cursor_rejected',
        operation: 'publish_next',
        code: 'conflict',
        phase: 'main',
        pageIndex: 5,
        runId: RUN_ID,
        // Publication carries the two `binding_mismatch` discriminators the
        // adapter owns, so one log line names which store branch rejected.
        parentCursorRefPresent: true,
        nextPageIndex: 6,
      },
      expect.any(String),
    )
  })

  it('records a store fault when the cursor store throws instead of answering', async () => {
    const cursors = cursorStore({
      redeem: vi.fn(async () => {
        throw new Error('redis connection reset')
      }),
    })
    const { api, warn } = createAdapter({ execute: vi.fn(), cursors })

    await expect(
      api.listReviewsPage(listInput(`v1.${'d'.repeat(43)}`, 2)),
    ).rejects.toMatchObject({
      _tag: 'GoogleReviewApiError',
      code: 'provider_unavailable',
    })

    expect(warn).toHaveBeenCalledWith(
      {
        event: 'reviews_cursor_rejected',
        operation: 'redeem',
        code: 'store_threw',
        phase: 'main',
        pageIndex: 2,
        runId: RUN_ID,
      },
      expect.any(String),
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('redis connection reset')
  })

  it('records both discard rejections without inventing scope it does not have', async () => {
    const discardInput = {
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 17,
      runId: RUN_ID,
    }
    const refusing = cursorStore({ discardRun: vi.fn(async () => false) })
    const { api: refusingApi, warn: refusingWarn } = createAdapter({
      execute: vi.fn(),
      cursors: refusing,
    })

    await expect(refusingApi.discardReviewCursors(discardInput)).rejects.toMatchObject({
      _tag: 'GoogleReviewApiError',
      code: 'provider_unavailable',
    })
    expect(refusingWarn).toHaveBeenCalledWith(
      {
        event: 'reviews_cursor_rejected',
        operation: 'discard_run',
        code: 'rejected',
        phase: null,
        pageIndex: null,
        runId: RUN_ID,
      },
      expect.any(String),
    )

    const faulting = cursorStore({
      discardRun: vi.fn(async () => {
        throw new Error('store unreachable')
      }),
    })
    const { api: faultingApi, warn: faultingWarn } = createAdapter({
      execute: vi.fn(),
      cursors: faulting,
    })

    await expect(faultingApi.discardReviewCursors(discardInput)).rejects.toMatchObject({
      _tag: 'GoogleReviewApiError',
      code: 'provider_unavailable',
    })
    expect(faultingWarn).toHaveBeenCalledWith(
      {
        event: 'reviews_cursor_rejected',
        operation: 'discard_cursors',
        code: 'store_threw',
        phase: null,
        pageIndex: null,
        runId: RUN_ID,
      },
      expect.any(String),
    )
  })

  it('never logs a page token or a cursor ref while diagnosing a rejection', async () => {
    const cursorRef = `v1.${'e'.repeat(43)}`
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        contentType: 'application/json',
        cacheControl: null,
        retryAfter: null,
      },
      body: new TextEncoder().encode(
        JSON.stringify({
          reviews: [providerReview()],
          totalReviewCount: 1,
          nextPageToken: 'provider-next-page-token',
        }),
      ),
    })
    const cursors = cursorStore({
      publishNext: vi.fn(async () => ({
        ok: false as const,
        code: 'capacity_exceeded' as const,
      })),
    })
    const { api, warn } = createAdapter({ execute, cursors })

    await expect(api.listReviewsPage(listInput(cursorRef, 3))).rejects.toMatchObject({
      code: 'cursor_capacity_exceeded',
    })

    expect(warn).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).toContain('reviews_cursor_rejected')
    expect(logged).not.toContain(cursorRef)
    expect(logged).not.toContain('provider-page-token')
    expect(logged).not.toContain('provider-next-page-token')
    expect(logged).not.toContain('Excellent stay')
  })
})

/**
 * The adapter falls back to a DIRECT `fetch` whenever the egress executor is
 * absent, which is what leaving the six GOOGLE_EGRESS_* values unset produces.
 * That path bypasses admission, quota control, credential binding and mTLS, so
 * production must refuse it — while development keeps working exactly as it
 * does today, since that is how the local stack talks to Google at all.
 */
describe('GoogleReviewApiAdapter direct-egress guard', () => {
  const ungovernedAdapter = (
    env: Parameters<typeof assertDirectProviderEgressAllowed>[0],
  ) =>
    createGoogleReviewApiAdapter({
      connectionRepo: { findById: vi.fn().mockResolvedValue(connection) } as never,
      // No executor: the direct fallback resolves credentials through the
      // refresh path, exactly as an unconfigured deployment would.
      encryption: { decrypt: vi.fn(() => 'access-token') } as never,
      refreshToken: vi
        .fn()
        .mockResolvedValue({ ...connection, encryptedAccessToken: 'enc' }) as never,
      logger: { warn: vi.fn() } as never,
      baseUrl: 'https://direct-provider.invalid',
      cursorStore: cursorStore(),
      nowMs: () => Date.parse('2026-08-12T12:00:00.000Z'),
      assertDirectEgressAllowed: (operation) =>
        assertDirectProviderEgressAllowed(env, operation),
    })

  it('refuses the ungoverned call in production and never reaches the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const api = ungovernedAdapter({ NODE_ENV: 'production' })

    await expect(
      api.replyToReview(ORG_ID, CONNECTION_ID, GOOGLE_REVIEW_PRIMARY_RESOURCE, 'thanks'),
    ).rejects.toMatchObject({
      _tag: 'ProviderConfigError',
      code: 'config_invalid',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('names the missing egress configuration in the refusal', async () => {
    const api = ungovernedAdapter({ NODE_ENV: 'production' })

    await expect(
      api.replyToReview(ORG_ID, CONNECTION_ID, GOOGLE_REVIEW_PRIMARY_RESOURCE, 'thanks'),
    ).rejects.toThrow(/GOOGLE_EGRESS_GATEWAY_ORIGIN/u)
  })

  it('allows the direct call in development, unchanged', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    // Local deterministic adapters retain direct transport; production has no
    // equivalent override because every Review request carries an OAuth token.
    // fallow-ignore-next-line code-duplication
    const api = ungovernedAdapter({ NODE_ENV: 'development' })

    await expect(
      api.replyToReview(ORG_ID, CONNECTION_ID, GOOGLE_REVIEW_PRIMARY_RESOURCE, 'thanks'),
    ).resolves.toEqual({ providerCorrelationId: null })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    fetchSpy.mockRestore()
  })

  it('refuses the direct call in production even when the legacy opt-out is set', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    const api = ungovernedAdapter({
      NODE_ENV: 'production',
      GOOGLE_ALLOW_DIRECT_PROVIDER_EGRESS: true,
    })

    await expect(
      api.replyToReview(ORG_ID, CONNECTION_ID, GOOGLE_REVIEW_PRIMARY_RESOURCE, 'thanks'),
    ).rejects.toMatchObject({ code: 'config_invalid' })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
