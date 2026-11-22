import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '../../../../test-fixtures/generated/google-provider-identifiers-v1'
import {
  CONNECTION_ID,
  ORG_ID,
  PROPERTY_ID,
  RUN_ID,
  answered,
  authorization,
  byTitle,
  createAdapter,
  cursorStore,
  getReviewInput,
  jsonAnswer,
  listInput,
  providerReview,
} from '#/shared/testing/google-review-api-adapter.test-fixtures'

const PLAIN_JSON = { contentType: 'application/json' } as const

// Synthetic only (test-fixtures/google-provider-identifiers-v1.json): the
// catalogue's location and a token that says what it is. Google's real shape is
// https://business.google.com/n/{location}/reviews/{opaque token}.
const LOCATION_ID = GOOGLE_REVIEW_PRIMARY_SEGMENTS.locationId
const REVIEW_PAGE_URL = `https://business.google.com/n/${LOCATION_ID}/reviews/repkey-synthetic-do-not-use-reply-token-0001`
const SECOND_REVIEW_NAME = GOOGLE_REVIEW_PRIMARY_RESOURCE.replace(/0001$/u, '0002')
const SECOND_REVIEW_PAGE = REVIEW_PAGE_URL.replace(/0001$/u, '0002')

/** One complete page holding `reviews`. */
function reviewsPage(reviews: readonly unknown[]): Mock {
  return jsonAnswer({ reviews, totalReviewCount: reviews.length, averageRating: 5 })
}

type Api = ReturnType<typeof createAdapter>['api']

describe('GoogleReviewApiAdapter', () => {
  it('reads an empty provider page as zero reviews', async () => {
    // Google omits `totalReviewCount` entirely for a location with no reviews:
    // the body is `{}`. Requiring the field turned that into `malformed_page`,
    // which failed the whole snapshot run — observed live on 2026-09-02 for
    // every property, with `sync-property-reviews` never completing a run.
    const { api } = createAdapter({ execute: jsonAnswer({}), cursors: cursorStore() })

    const page = await api.listReviewsPage(listInput())

    expect(page.totalReviewCount).toBe(0)
    expect(page.reviews).toEqual([])
  })

  it('lists one fixed bounded page and replaces the provider token with an opaque ref', async () => {
    const execute = jsonAnswer({
      reviews: [providerReview()],
      totalReviewCount: 2,
      averageRating: 4.5,
      nextPageToken: 'provider-next-page-token',
    })
    const cursors = cursorStore()
    const { api, authorizeProviderCall } = createAdapter({ execute, cursors })

    const page = await api.listReviewsPage(listInput())

    expect(execute).toHaveBeenCalledWith(
      {
        routeKey: 'reviews.list',
        accessToken: 'access-token',
        locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      },
      expect.objectContaining({ authorization }),
    )
    expect(authorizeProviderCall).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      connectionId: CONNECTION_ID,
      sourceEpoch: 17,
    })
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
      averageRating: 4.5,
      nextCursorRef: `v1.${'a'.repeat(43)}`,
    })
    expect(JSON.stringify(page)).not.toContain('provider-next-page-token')
  })

  it('accepts the provider fields Google actually sends and drops the unmodelled ones', async () => {
    // Shape observed in google-closed-beta 2026-08-19: per-review `reviewId`,
    // `updateTime`, `reviewReplyUrl` plus a top-level `averageRating`. Strict
    // schemas rejected the page and the property synced zero reviews.
    const execute = jsonAnswer({
      reviews: [
        {
          ...providerReview(),
          reviewId: 'provider-review-id',
          updateTime: '2026-08-02T10:00:00.000Z',
          reviewReplyUrl: REVIEW_PAGE_URL,
          reviewer: { displayName: 'Guest', isAnonymous: false },
        },
      ],
      totalReviewCount: 1,
      averageRating: 4.7,
    })
    const { api } = createAdapter({ execute })

    const page = await api.listReviewsPage(listInput())

    expect(page.totalReviewCount).toBe(1)
    expect(page.averageRating).toBe(4.7)
    expect(page.reviews).toEqual([
      expect.objectContaining({
        externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
        rating: 5,
        text: 'Excellent stay',
        sourceCreatedAt: new Date('2026-08-01T10:00:00.000Z'),
        sourceUpdatedAt: new Date('2026-08-02T10:00:00.000Z'),
        // `reviewReplyUrl` is read (2026-10-17) and carried under its domain
        // name; every other unmodelled field is still dropped.
        googleReviewUrl: REVIEW_PAGE_URL,
      }),
    ])
    const serialized = JSON.stringify(page)
    expect(serialized).not.toContain('reviewReplyUrl')
    expect(serialized).not.toContain('provider-review-id')
  })

  it('reads no review page from a review that carries none, and logs nothing', async () => {
    const { api, warn } = createAdapter({ execute: reviewsPage([providerReview()]) })

    const page = await api.listReviewsPage(listInput())

    expect(page.reviews[0]?.googleReviewUrl).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([
    [
      'a page at another location',
      REVIEW_PAGE_URL.replace(`/n/${LOCATION_ID}/`, '/n/0001/'),
    ],
    ['another host', REVIEW_PAGE_URL.replace('business.google.com', 'evil.example')],
    ['the old made-up shape', 'https://business.google.com/reviews/reply'],
    ['a query', `${REVIEW_PAGE_URL}?authuser=1`],
    ['a value over 2,048 characters', `${REVIEW_PAGE_URL}${'A'.repeat(2_048)}`],
    ['an empty string', ''],
    ['a number', 42],
    ['null', null],
    ['an object', { href: REVIEW_PAGE_URL }],
  ])(
    'keeps the review and the page when reviewReplyUrl is %s, counting the refusal without its value',
    async (_case, reviewReplyUrl) => {
      const execute = reviewsPage([
        { ...providerReview(), reviewReplyUrl },
        {
          ...providerReview(),
          name: SECOND_REVIEW_NAME,
          reviewReplyUrl: SECOND_REVIEW_PAGE,
        },
      ])
      const { api, warn } = createAdapter({ execute })

      const page = await api.listReviewsPage(listInput())

      expect(page.reviews.map((review) => review.googleReviewUrl)).toEqual([
        null,
        SECOND_REVIEW_PAGE,
      ])
      expect(page.reviews[0]).toEqual(
        expect.objectContaining({ externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId }),
      )
      expect(warn).toHaveBeenCalledOnce()
      expect(warn).toHaveBeenCalledWith(
        { event: 'reviews_reply_url_refused', operation: 'reviews.list', refused: 1 },
        'Google review page links refused',
      )
      expect(JSON.stringify(warn.mock.calls)).not.toContain('business.google.com')
      expect(JSON.stringify(warn.mock.calls)).not.toContain('evil.example')
    },
  )

  it('reads the review page on the targeted read too, and refuses one the same way', async () => {
    const getInput = getReviewInput()
    const found = createAdapter({
      execute: jsonAnswer({ ...providerReview(), reviewReplyUrl: REVIEW_PAGE_URL }),
    })
    await expect(found.api.getReview(getInput)).resolves.toEqual({
      status: 'found',
      review: expect.objectContaining({ googleReviewUrl: REVIEW_PAGE_URL }),
    })
    expect(found.warn).not.toHaveBeenCalled()

    const refused = createAdapter({
      execute: jsonAnswer({
        ...providerReview(),
        reviewReplyUrl: 'https://evil.example/',
      }),
    })
    await expect(refused.api.getReview(getInput)).resolves.toEqual({
      status: 'found',
      review: expect.objectContaining({ googleReviewUrl: null }),
    })
    expect(refused.warn).toHaveBeenCalledWith(
      { event: 'reviews_reply_url_refused', operation: 'reviews.get', refused: 1 },
      'Google review page links refused',
    )
  })

  it.each([
    { reviews: [providerReview()], totalReviewCount: 1 },
    { reviews: [providerReview()], totalReviewCount: 1, averageRating: -0.1 },
    { reviews: [providerReview()], totalReviewCount: 1, averageRating: 5.1 },
    { reviews: [], totalReviewCount: 0, averageRating: 4 },
  ])('rejects malformed provider aggregate metadata: %o', async (payload) => {
    const { api } = createAdapter({ execute: jsonAnswer(payload) })

    await expect(api.listReviewsPage(listInput())).rejects.toMatchObject({
      _tag: 'GoogleReviewApiError',
      code: 'malformed_response',
    })
  })

  it('maps the provider zero-review aggregate to an explicit null average', async () => {
    const { api } = createAdapter({
      execute: jsonAnswer({ totalReviewCount: 0, averageRating: 0 }),
    })

    await expect(api.listReviewsPage(listInput())).resolves.toMatchObject({
      reviews: [],
      totalReviewCount: 0,
      averageRating: null,
    })
  })

  it('maps a translated Google comment to the original as text and the translation aside', async () => {
    // 76 of 93 texted closed-beta reviews arrive wrapped like this. Storing the
    // blob as `text` made cld3 detect Google's English translation, so 8
    // Bulgarian reviews were judged reliable English.
    const { api } = createAdapter({
      execute: reviewsPage([
        {
          ...providerReview(),
          comment: '(Translated by Google) Ok\n\n(Original)\nОк',
        },
      ]),
    })

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

  // Captured live: a Bulgarian reply that Google had already published at
  // 09:01:28Z came back wrapped in the same envelope as review text, so the
  // digest of the blob never matched the digest of what we sent. The reply
  // settled as "Google status unconfirmed" and no reply on a translated review
  // could ever reach Published.
  it('maps an echoed reply back to the text we published, not Google translation of it', async () => {
    const published =
      'Благодарим за препоръката. Радваме се, че услугите на KODES agency са допринесли за повече трафик.'
    const { api } = createAdapter({
      execute: reviewsPage([
        {
          ...providerReview(),
          reviewReply: {
            comment: `(Translated by Google) Thank you for the recommendation.\n\n(Original)\n${published}`,
            updateTime: '2026-09-09T09:01:28.000Z',
          },
        },
      ]),
    })

    const page = await api.listReviewsPage(listInput())

    expect(page.reviews[0]?.replyText).toBe(published)
    expect(page.reviews[0]?.replyText).not.toContain('Translated by Google')
  })

  // Since 2026-10-23 Google also sends the original first, for the review and
  // for its reply. Stored whole, 59 closed-beta reviews read as guest edits.
  it('splits the original-first envelope on the review and on its reply', async () => {
    const { api } = createAdapter({
      execute: reviewsPage([
        {
          ...providerReview(),
          comment: 'Ок\n\n(Translated by Google)\nOk',
          reviewReply: {
            comment: 'Благодарим\n\n(Translated by Google)\nThank you',
            updateTime: '2026-10-23T04:35:00.000Z',
          },
        },
      ]),
    })

    const page = await api.listReviewsPage(listInput())

    expect(page.reviews[0]).toEqual(
      expect.objectContaining({
        text: 'Ок',
        translatedText: 'Ok',
        replyText: 'Благодарим',
        replyUnreadable: false,
      }),
    )
  })

  it('leaves an unwrapped echoed reply exactly as Google returned it', async () => {
    const { api } = createAdapter({
      execute: reviewsPage([
        {
          ...providerReview(),
          reviewReply: {
            comment: 'Thank you for the kind words.',
            updateTime: '2026-09-09T09:01:28.000Z',
          },
        },
      ]),
    })

    const page = await api.listReviewsPage(listInput())

    expect(page.reviews[0]?.replyText).toBe('Thank you for the kind words.')
  })

  // D6: a translation-only reply envelope carries no recoverable original. Read
  // as `replyText: null` alone, it looked exactly like "Google has no reply", and
  // reconciliation treats absence as the answer that keeps a send uncertain.
  it.each([
    [
      'a translation-only envelope',
      { comment: '(Translated by Google) Thank you for staying with us.' },
      { replyText: null, replyUnreadable: true },
    ],
    [
      'a normal envelope',
      { comment: '(Translated by Google) Thank you.\n\n(Original)\nБлагодарим.' },
      { replyText: 'Благодарим.', replyUnreadable: false },
    ],
    [
      'a plain reply',
      { comment: 'Thank you for the kind words.' },
      { replyText: 'Thank you for the kind words.', replyUnreadable: false },
    ],
    ['no reply', undefined, { replyText: null, replyUnreadable: false }],
  ])('getReview maps %s to its readable reply state', async (_label, reply, expected) => {
    const execute = jsonAnswer({
      ...providerReview(),
      ...(reply
        ? { reviewReply: { ...reply, updateTime: '2026-09-09T09:01:28.000Z' } }
        : {}),
    })
    const { api } = createAdapter({ execute })

    const result = await api.getReview(getReviewInput())

    expect(result).toEqual({
      status: 'found',
      review: expect.objectContaining(expected),
    })
  })

  it('leaves an unwrapped Google comment as the review text', async () => {
    const { api } = createAdapter({ execute: reviewsPage([providerReview()]) })

    const page = await api.listReviewsPage(listInput())

    expect(page.reviews).toEqual([
      expect.objectContaining({ text: 'Excellent stay', translatedText: null }),
    ])
  })

  it('redeems an opaque cursor inside Integration and never returns the provider token', async () => {
    const execute = jsonAnswer(
      { reviews: [providerReview()], totalReviewCount: 1, averageRating: 5 },
      PLAIN_JSON,
    )
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
    const foundExecute = jsonAnswer(providerReview(), PLAIN_JSON)
    const { api: foundApi } = createAdapter({ execute: foundExecute })
    const input = getReviewInput()

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

    const missingExecute = answered(404, { contentType: null, body: '' })
    const { api: missingApi } = createAdapter({ execute: missingExecute })
    await expect(missingApi.getReview(input)).resolves.toEqual({
      status: 'not_found',
    })
  })

  it('fails closed on malformed pages, page overflow, and authorization drift', async () => {
    const malformedExecute = jsonAnswer(
      {
        reviews: Array.from({ length: 51 }, providerReview),
        totalReviewCount: 51,
      },
      PLAIN_JSON,
    )
    const { api: malformedApi } = createAdapter({ execute: malformedExecute })
    await expect(malformedApi.listReviewsPage(listInput())).rejects.toMatchObject({
      _tag: 'GoogleReviewApiError',
      code: 'malformed_response',
    })

    const validExecute = jsonAnswer(
      { reviews: [providerReview()], totalReviewCount: 1, averageRating: 5 },
      PLAIN_JSON,
    )
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

  // A rejected cursor is logged with the raw store code, because the adapter
  // error collapses it and the use case collapses that again. Each row names the
  // exact line the log must carry.
  it.each(
    byTitle([
      {
        // google-closed-beta 2026-08-19: a run applied 6 pages / 256 reviews and
        // then failed with `cursor_failure` and no cause anywhere in the logs,
        // because the adapter maps the store code and the use case collapses the
        // mapping. `expired` is the store's code; `cursor_expired` is the mapping.
        title: 'records the raw store code when a cursor redemption is rejected',
        cursors: () =>
          cursorStore({
            redeem: vi.fn(async () => ({ ok: false as const, code: 'expired' as const })),
          }),
        execute: () => vi.fn(),
        providerCalls: 0,
        call: (api: Api) => api.listReviewsPage(listInput(`v1.${'c'.repeat(43)}`, 1)),
        errorCode: 'cursor_expired',
        logged: {
          event: 'reviews_cursor_rejected',
          operation: 'redeem',
          code: 'expired',
          phase: 'main',
          pageIndex: 1,
          runId: RUN_ID,
        },
        secrets: [],
      },
      {
        // `conflict` and `unavailable` both map onto `provider_unavailable`, so the
        // thrown error cannot tell them apart — the log has to. A page-5
        // continuation carries the parent ref redeemed for that page, so this
        // exercises the discriminator's true branch rather than the
        // null-parent-off-page-0 branch the store rejects outright.
        title: 'keeps the store code that the adapter error collapses on publication',
        cursors: () =>
          cursorStore({
            publishNext: vi.fn(async () => ({
              ok: false as const,
              code: 'conflict' as const,
            })),
          }),
        execute: () =>
          jsonAnswer(
            {
              reviews: [providerReview()],
              totalReviewCount: 51,
              averageRating: 4.9,
              nextPageToken: 'provider-next-page-token',
            },
            PLAIN_JSON,
          ),
        providerCalls: 1,
        call: (api: Api) => api.listReviewsPage(listInput(`v1.${'a'.repeat(43)}`, 5)),
        errorCode: 'provider_unavailable',
        logged: {
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
        secrets: [],
      },
      {
        title: 'records a store fault when the cursor store throws instead of answering',
        cursors: () =>
          cursorStore({
            redeem: vi.fn(async () => {
              throw new Error('redis connection reset')
            }),
          }),
        execute: () => vi.fn(),
        providerCalls: 0,
        call: (api: Api) => api.listReviewsPage(listInput(`v1.${'d'.repeat(43)}`, 2)),
        errorCode: 'provider_unavailable',
        logged: {
          event: 'reviews_cursor_rejected',
          operation: 'redeem',
          code: 'store_threw',
          phase: 'main',
          pageIndex: 2,
          runId: RUN_ID,
        },
        secrets: ['redis connection reset'],
      },
      {
        title: 'records both discard rejections without inventing scope it does not have',
        cursors: () => cursorStore({ discardRun: vi.fn(async () => false) }),
        execute: () => vi.fn(),
        providerCalls: 0,
        call: (api: Api) => api.discardReviewCursors(discardInput()),
        errorCode: 'provider_unavailable',
        logged: {
          event: 'reviews_cursor_rejected',
          operation: 'discard_run',
          code: 'rejected',
          phase: null,
          pageIndex: null,
          runId: RUN_ID,
        },
        secrets: [],
      },
      {
        title: 'records a discard that throws without inventing scope it does not have',
        cursors: () =>
          cursorStore({
            discardRun: vi.fn(async () => {
              throw new Error('store unreachable')
            }),
          }),
        execute: () => vi.fn(),
        providerCalls: 0,
        call: (api: Api) => api.discardReviewCursors(discardInput()),
        errorCode: 'provider_unavailable',
        logged: {
          event: 'reviews_cursor_rejected',
          operation: 'discard_cursors',
          code: 'store_threw',
          phase: null,
          pageIndex: null,
          runId: RUN_ID,
        },
        secrets: [],
      },
    ]),
  )('%s', async (_title, row) => {
    const execute = row.execute()
    const { api, warn } = createAdapter({ execute, cursors: row.cursors() })

    await expect(row.call(api)).rejects.toMatchObject({
      _tag: 'GoogleReviewApiError',
      code: row.errorCode,
    })

    expect(warn).toHaveBeenCalledWith(row.logged, expect.any(String))
    expect(execute).toHaveBeenCalledTimes(row.providerCalls)
    for (const secret of row.secrets) {
      expect(JSON.stringify(warn.mock.calls)).not.toContain(secret)
    }
  })

  it('never logs a page token or a cursor ref while diagnosing a rejection', async () => {
    const cursorRef = `v1.${'e'.repeat(43)}`
    const execute = jsonAnswer(
      {
        reviews: [providerReview()],
        totalReviewCount: 1,
        averageRating: 5,
        nextPageToken: 'provider-next-page-token',
      },
      PLAIN_JSON,
    )
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

function discardInput() {
  return {
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    sourceEpoch: 17,
    runId: RUN_ID,
  }
}
