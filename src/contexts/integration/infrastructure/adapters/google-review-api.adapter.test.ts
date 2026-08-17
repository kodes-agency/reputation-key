import { describe, expect, it, vi, type Mock } from 'vitest'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import type { GoogleReviewCursorStore } from '../google-review-cursor-store'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '../../../../../test-fixtures/generated/google-provider-identifiers-v1'
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
  return {
    api: createGoogleReviewApiAdapter({
      connectionRepo: { findById } as never,
      encryption: {} as never,
      refreshToken: vi.fn() as never,
      logger: { warn: vi.fn() } as never,
      baseUrl: 'https://direct-provider.invalid',
      cursorStore: input.cursors ?? cursorStore(),
      executor: { execute: input.execute },
      authorizeProviderCall,
      nowMs: () => Date.parse('2026-08-12T12:00:00.000Z'),
    }),
    authorizeProviderCall,
    findById,
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
})
