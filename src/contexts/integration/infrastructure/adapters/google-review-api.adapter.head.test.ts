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

// The head read: reviews.list page 1, newest-updated first, no run and no cursor.

const ORG_ID = organizationId('0UM0PoDLJNJ3yGCeBMERaQkQyxer9BuC')
const PROPERTY_ID = propertyId('00000000-0000-4000-8000-000000000002')
const CONNECTION_ID = googleConnectionId('00000000-0000-4000-8000-000000000003')
const SOURCE_EPOCH = 17
const authorization = Object.freeze({
  capability: 'property.connect_gbp',
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  connectionId: CONNECTION_ID,
  initiatorUserId: null,
  expectedCredentialGeneration: 3,
  authorizationVector: Object.freeze({
    generation: 3,
    propertySourceEpoch: SOURCE_EPOCH,
  }),
}) satisfies GoogleProviderCallAuthorization
const connection = {
  status: 'active',
  credentialUseState: 'active',
  lifecycleVersion: 7,
  accessVersion: 11,
  credentialGeneration: 3,
}
const REVIEW_NAMES = ['0001', '0002', '0003'].map((suffix) =>
  GOOGLE_REVIEW_PRIMARY_RESOURCE.replace(/0001$/u, suffix),
)

function cursorStore(): GoogleReviewCursorStore {
  return {
    redeem: vi.fn(),
    release: vi.fn(),
    publishNext: vi.fn(),
    discardRun: vi.fn(),
    startedAtMs: vi.fn(),
  } as unknown as GoogleReviewCursorStore
}

function providerReview(name: string, updateTime: string | undefined, extra = {}) {
  return {
    name,
    starRating: 'FIVE',
    comment: 'Excellent stay',
    reviewer: { displayName: 'Guest' },
    createTime: '2026-08-01T10:00:00.000Z',
    ...(updateTime === undefined ? {} : { updateTime }),
    ...extra,
  }
}

function jsonAnswer(body: unknown): Mock {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { contentType: 'application/json', cacheControl: null, retryAfter: null },
    body: new TextEncoder().encode(JSON.stringify(body)),
  })
}

function createAdapter(
  execute: Mock,
  options: Readonly<{ findById?: Mock; cursors?: GoogleReviewCursorStore }> = {},
) {
  const cursors = options.cursors ?? cursorStore()
  const authorizeProviderCall = vi
    .fn()
    .mockResolvedValue({ accessToken: 'access-token', authorization })
  const warn = vi.fn()
  return {
    cursors,
    authorizeProviderCall,
    warn,
    api: createGoogleReviewApiAdapter({
      connectionRepo: {
        findById: options.findById ?? vi.fn().mockResolvedValue(connection),
      } as never,
      logger: { warn } as never,
      cursorStore: cursors,
      executor: { execute },
      authorizeReviewSyncProviderCall: authorizeProviderCall,
      nowMs: () => Date.parse('2026-10-21T12:00:00.000Z'),
    }),
  }
}

const headInput = () => ({
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  connectionId: CONNECTION_ID,
  sourceEpoch: SOURCE_EPOCH,
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
})

const newestFirstPage = () => ({
  reviews: [
    providerReview(REVIEW_NAMES[0]!, '2026-10-20T10:00:00.000Z'),
    providerReview(REVIEW_NAMES[1]!, '2026-10-19T10:00:00.000Z'),
  ],
  totalReviewCount: 12,
  averageRating: 4.6,
})

describe('GoogleReviewApiAdapter.readReviewsHead', () => {
  it('asks for page 1 ordered updateTime desc, with no page token', async () => {
    const execute = jsonAnswer(newestFirstPage())
    const { api, authorizeProviderCall } = createAdapter(execute)

    await api.readReviewsHead(headInput())

    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith(
      {
        routeKey: 'reviews.list',
        accessToken: 'access-token',
        locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
        orderBy: 'updateTime desc',
      },
      expect.objectContaining({ authorization }),
    )
    expect(authorizeProviderCall).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      connectionId: CONNECTION_ID,
      sourceEpoch: SOURCE_EPOCH,
    })
  })

  it('returns the mapped reviews with Google total and average', async () => {
    const { api } = createAdapter(jsonAnswer(newestFirstPage()))

    const head = await api.readReviewsHead(headInput())

    expect(head).toEqual({
      status: 'ok',
      reviews: [
        expect.objectContaining({
          externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
          sourceUpdatedAt: new Date('2026-10-20T10:00:00.000Z'),
        }),
        expect.objectContaining({
          sourceUpdatedAt: new Date('2026-10-19T10:00:00.000Z'),
        }),
      ],
      totalReviewCount: 12,
      averageRating: 4.6,
      hasMore: false,
    })
  })

  it('reports hasMore without publishing, redeeming or releasing any cursor', async () => {
    const cursors = cursorStore()
    const { api } = createAdapter(
      jsonAnswer({ ...newestFirstPage(), nextPageToken: 'provider-next-page-token' }),
      { cursors },
    )

    const head = await api.readReviewsHead(headInput())

    expect(head).toMatchObject({ status: 'ok', hasMore: true })
    expect(JSON.stringify(head)).not.toContain('provider-next-page-token')
    expect(cursors.publishNext).not.toHaveBeenCalled()
    expect(cursors.redeem).not.toHaveBeenCalled()
    expect(cursors.release).not.toHaveBeenCalled()
  })

  it('reads a location with no reviews as zero reviews and no average', async () => {
    const { api } = createAdapter(jsonAnswer({}))

    await expect(api.readReviewsHead(headInput())).resolves.toEqual({
      status: 'ok',
      reviews: [],
      totalReviewCount: 0,
      averageRating: null,
      hasMore: false,
    })
  })

  it('accepts reviews that share an updateTime', async () => {
    const tied = '2026-10-20T10:00:00.000Z'
    const { api } = createAdapter(
      jsonAnswer({
        reviews: [
          providerReview(REVIEW_NAMES[0]!, tied),
          providerReview(REVIEW_NAMES[1]!, tied),
        ],
        totalReviewCount: 2,
        averageRating: 5,
      }),
    )

    await expect(api.readReviewsHead(headInput())).resolves.toMatchObject({
      status: 'ok',
    })
  })

  it.each([
    [
      'an older review before a newer one',
      [
        providerReview(REVIEW_NAMES[0]!, '2026-10-18T10:00:00.000Z'),
        providerReview(REVIEW_NAMES[1]!, '2026-10-19T10:00:00.000Z'),
      ],
    ],
    [
      'a review with no updateTime',
      [
        providerReview(REVIEW_NAMES[0]!, '2026-10-20T10:00:00.000Z'),
        providerReview(REVIEW_NAMES[1]!, undefined),
      ],
    ],
    ['a lone review with no updateTime', [providerReview(REVIEW_NAMES[0]!, undefined)]],
  ])('returns an order violation, and no reviews, for %s', async (_case, reviews) => {
    const { api } = createAdapter(
      jsonAnswer({ reviews, totalReviewCount: reviews.length, averageRating: 5 }),
    )

    await expect(api.readReviewsHead(headInput())).resolves.toEqual({
      status: 'order_violation',
    })
  })

  it('refuses a page that fails the shared schema as a malformed response', async () => {
    const { api, warn } = createAdapter(
      jsonAnswer({
        reviews: [providerReview(REVIEW_NAMES[0]!, '2026-10-20T10:00:00.000Z')],
        totalReviewCount: 1,
      }),
    )

    await expect(api.readReviewsHead(headInput())).rejects.toMatchObject({
      code: 'malformed_response',
    })
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'reviews_page_rejected' }),
      'Google reviews page rejected by schema',
    )
  })

  it('names a spent quota as a rate limit that carries the wait', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: false,
      code: 'admission_denied',
      admissionCode: 'quota_exhausted',
      dispatch: 'not_sent',
      retryAfterMs: 1_200,
    })
    const { api } = createAdapter(execute)

    await expect(api.readReviewsHead(headInput())).rejects.toMatchObject({
      code: 'provider_rate_limited',
      recoverable: true,
      retryAfterMs: expect.any(Number),
    })
  })

  it('names a Google 5xx as an outage and a 404 as a rejection', async () => {
    const answer = (status: number) =>
      vi.fn().mockResolvedValue({
        ok: true,
        status,
        headers: {
          contentType: 'application/json',
          cacheControl: null,
          retryAfter: null,
        },
        body: new Uint8Array(),
      })

    await expect(
      createAdapter(answer(503)).api.readReviewsHead(headInput()),
    ).rejects.toMatchObject({ code: 'provider_unavailable', recoverable: true })
    await expect(
      createAdapter(answer(404)).api.readReviewsHead(headInput()),
    ).rejects.toMatchObject({ code: 'provider_rejected' })
  })

  it('fails as authorization_changed when the connection moved while Google was read', async () => {
    const findById = vi
      .fn()
      .mockResolvedValueOnce(connection)
      .mockResolvedValueOnce({ ...connection, credentialGeneration: 4 })
    const { api } = createAdapter(jsonAnswer(newestFirstPage()), { findById })

    await expect(api.readReviewsHead(headInput())).rejects.toMatchObject({
      code: 'authorization_changed',
    })
  })

  it.each([
    ['an extra key', { ...headInput(), runId: '00000000-0000-4000-8000-000000000004' }],
    ['a page token', { ...headInput(), pageToken: 'x' }],
    ['a bad property id', { ...headInput(), propertyId: 'not-a-uuid' }],
    ['a negative epoch', { ...headInput(), sourceEpoch: -1 }],
    ['a traversing location', { ...headInput(), locationName: '../locations/1' }],
  ])('refuses %s before any provider call', async (_case, input) => {
    const execute = jsonAnswer(newestFirstPage())
    const { api, authorizeProviderCall } = createAdapter(execute)

    await expect(api.readReviewsHead(input as never)).rejects.toMatchObject({
      code: 'invalid_request',
    })
    expect(authorizeProviderCall).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })
})
