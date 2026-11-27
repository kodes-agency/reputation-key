import { describe, it, expect, vi } from 'vitest'
import { emptyLookupPorts } from '#/contexts/reputation/inbox/inbox-test-doubles.test-fixtures'
import type { ReviewSnippetResult } from '#/contexts/reputation/inbox/review-lookup.port.server'
import { inboxItemId, reviewId, feedbackId } from '#/shared/domain/ids'
import {
  ORG_A,
  db,
  createInboxRepository,
  makeInboxItem,
  useInboxRepositoryDb,
} from './inbox-repository.test-fixtures'

useInboxRepositoryDb()

describe('inbox repository — detail view', () => {
  const repo = createInboxRepository(db, emptyLookupPorts)

  it('findDetailById returns review source data for review items', async () => {
    const item = makeInboxItem({
      sourceType: 'review',
      sourceId: reviewId(crypto.randomUUID()),
    })
    await repo.seedItem(item)

    const detail = await repo.findDetailById(item.id, ORG_A)
    expect(detail).not.toBeNull()
    expect(detail!.item.id).toBe(item.id)
    expect(detail!.item.sourceType).toBe('review')
    // The stub lookup reports not_found — typed status, no content.
    expect(detail!.reviewContentStatus).toBe('not_found')
    expect(detail!.reviewText).toBeNull()
    // An ineligible source may not leak a translation either.
    expect(detail!.reviewTranslatedText).toBeNull()
  })

  it('findDetailById surfaces the guest original and Google translation together', async () => {
    const srcId = crypto.randomUUID()
    const item = makeInboxItem({ sourceType: 'review', sourceId: reviewId(srcId) })
    await repo.seedItem(item)

    const translatedRepo = createInboxRepository(db, {
      ...emptyLookupPorts,
      reviewLookup: {
        ...emptyLookupPorts.reviewLookup,
        getReviewSnippetById: async (): Promise<ReviewSnippetResult> => ({
          status: 'available',
          snippet: {
            reviewerName: 'Мария',
            text: 'Хотелът беше чист и уютен, а закуската беше много вкусна.',
            translatedText:
              'The hotel was clean and cosy, and the breakfast was very tasty.',
            reviewerProfilePhotoUrl: null,
            googleReviewUrl: null,
            rating: 5,
            languageCode: 'bg',
          },
        }),
      },
    })

    const detail = await translatedRepo.findDetailById(item.id, ORG_A)
    expect(detail!.reviewContentStatus).toBe('available')
    expect(detail!.reviewText).toBe(
      'Хотелът беше чист и уютен, а закуската беше много вкусна.',
    )
    expect(detail!.reviewTranslatedText).toBe(
      'The hotel was clean and cosy, and the breakfast was very tasty.',
    )
  })

  it('findDetailById leaves the translation null for an untranslated review', async () => {
    const item = makeInboxItem({
      sourceType: 'review',
      sourceId: reviewId(crypto.randomUUID()),
    })
    await repo.seedItem(item)

    const englishRepo = createInboxRepository(db, {
      ...emptyLookupPorts,
      reviewLookup: {
        ...emptyLookupPorts.reviewLookup,
        getReviewSnippetById: async (): Promise<ReviewSnippetResult> => ({
          status: 'available',
          snippet: {
            reviewerName: 'Jane',
            text: 'Wonderful stay.',
            translatedText: null,
            reviewerProfilePhotoUrl: null,
            googleReviewUrl: null,
            rating: 5,
            languageCode: 'en',
          },
        }),
      },
    })

    const detail = await englishRepo.findDetailById(item.id, ORG_A)
    expect(detail!.reviewText).toBe('Wonderful stay.')
    expect(detail!.reviewTranslatedText).toBeNull()
  })

  it('findDetailById serves neither text nor translation for an expired review', async () => {
    const item = makeInboxItem({
      sourceType: 'review',
      sourceId: reviewId(crypto.randomUUID()),
    })
    await repo.seedItem(item)

    const expiredRepo = createInboxRepository(db, {
      ...emptyLookupPorts,
      reviewLookup: {
        ...emptyLookupPorts.reviewLookup,
        getReviewSnippetById: async (): Promise<ReviewSnippetResult> => ({
          status: 'expired',
        }),
      },
    })

    const detail = await expiredRepo.findDetailById(item.id, ORG_A)
    expect(detail!.reviewContentStatus).toBe('expired')
    expect(detail!.reviewText).toBeNull()
    expect(detail!.reviewTranslatedText).toBeNull()
  })

  it('findDetailById returns null for non-existent item', async () => {
    const detail = await repo.findDetailById(inboxItemId(crypto.randomUUID()), ORG_A)
    expect(detail).toBeNull()
  })

  // ── reviewRating ────────────────────────────────────────────────────
  // The rating is the fifth field carried off `ReviewSnippet`, beside
  // `reviewText` / `reviewTranslatedText` / `reviewerProfilePhotoUrl` /
  // `reviewerName`, and it has to obey the same eligibility rule those four
  // already prove above: an ineligible source serves nothing. These cases
  // also fix the boundary that made the field necessary — `item.rating` is a
  // different number with a different owner, and the two must not track each
  // other.

  /** Same repository, different answer from the one governed input that
   *  decides both the content status and the rating. */
  const repoAnswering = (result: ReviewSnippetResult) =>
    createInboxRepository(db, {
      ...emptyLookupPorts,
      reviewLookup: {
        ...emptyLookupPorts.reviewLookup,
        getReviewSnippetById: async (): Promise<ReviewSnippetResult> => result,
      },
    })

  const availableWithRating = (rating: number | null): ReviewSnippetResult => ({
    status: 'available',
    snippet: {
      reviewerName: 'Jane',
      text: 'Wonderful stay.',
      translatedText: null,
      reviewerProfilePhotoUrl: null,
      googleReviewUrl: null,
      rating,
      languageCode: 'en',
    },
  })

  const createdReviewItem = async () => {
    const item = makeInboxItem({
      sourceType: 'review',
      sourceId: reviewId(crypto.randomUUID()),
    })
    await repo.seedItem(item)
    return item
  }

  it('findDetailById carries the rating of an available review', async () => {
    const item = await createdReviewItem()

    const detail = await repoAnswering(availableWithRating(5)).findDetailById(
      item.id,
      ORG_A,
    )
    expect(detail!.reviewContentStatus).toBe('available')
    expect(detail!.reviewRating).toBe(5)
    // And the projection's own column is still null on the very same payload —
    // `makeInboxItem` seeds `rating: 4`, the review creation path drops it
    // (`inbox-command-store.ts:936`, ":1416"). `reviewRating` is therefore the
    // ONLY place a review's stars exist on the detail; a pane reading
    // `item.rating` alone renders no stars at all, which is the defect row 7
    // of `docs/plan/inbox-detail-v2.md` describes.
    expect(detail!.item.rating).toBeNull()
  })

  it('findDetailById reports null when an available review carries no rating', async () => {
    const item = await createdReviewItem()

    // A rating-less review is a real Google state, and it is NOT the same fact
    // as unavailable content: the words are still served below.
    const detail = await repoAnswering(availableWithRating(null)).findDetailById(
      item.id,
      ORG_A,
    )
    expect(detail!.reviewContentStatus).toBe('available')
    expect(detail!.reviewText).toBe('Wonderful stay.')
    expect(detail!.reviewRating).toBeNull()
  })

  it('findDetailById withholds the rating of an expired review', async () => {
    const item = await createdReviewItem()

    const detail = await repoAnswering({ status: 'expired' }).findDetailById(
      item.id,
      ORG_A,
    )
    expect(detail!.reviewContentStatus).toBe('expired')
    // The rating goes silent with the text it belongs to, not independently.
    expect(detail!.reviewText).toBeNull()
    expect(detail!.reviewRating).toBeNull()
  })

  it("findDetailById carries the review's Google page with its words, and only then", async () => {
    const item = await createdReviewItem()
    // Synthetic (test-fixtures/google-provider-identifiers-v1.json).
    const page =
      'https://business.google.com/n/repkey-synthetic-do-not-use-location-0001/reviews/repkey-synthetic-do-not-use-reply-token-0001'
    const available = availableWithRating(5)
    if (available.status !== 'available') throw new Error('expected available')

    const served = await repoAnswering({
      ...available,
      snippet: { ...available.snippet, googleReviewUrl: page },
    }).findDetailById(item.id, ORG_A)
    expect(served!.googleReviewUrl).toBe(page)

    const expired = await repoAnswering({ status: 'expired' }).findDetailById(
      item.id,
      ORG_A,
    )
    expect(expired!.googleReviewUrl).toBeNull()

    const missing = await repo.findDetailById(item.id, ORG_A)
    expect(missing!.reviewContentStatus).toBe('not_found')
    expect(missing!.googleReviewUrl).toBeNull()
  })

  it('findDetailById withholds the rating of a not_found review', async () => {
    const item = await createdReviewItem()

    // `repo` itself is wired to the not_found stub (see `emptyLookupPorts`).
    const detail = await repo.findDetailById(item.id, ORG_A)
    expect(detail!.reviewContentStatus).toBe('not_found')
    expect(detail!.reviewRating).toBeNull()
  })

  it('findDetailById leaves reviewRating null for a feedback item', async () => {
    const item = makeInboxItem({
      sourceType: 'feedback',
      sourceId: feedbackId(crypto.randomUUID()),
    })
    await repo.seedItem(item)

    const feedbackRepo = createInboxRepository(db, {
      ...emptyLookupPorts,
      feedbackLookup: {
        ...emptyLookupPorts.feedbackLookup,
        getFeedbackSnippetById: async () => ({
          comment: 'The room was too warm.',
          ratingValue: 2,
        }),
      },
    })

    // Private feedback rates the stay, not a review. Its number stays in
    // `feedbackRatingValue`; a consumer that reads `reviewRating` for both
    // would print Google stars over a private score.
    const detail = await feedbackRepo.findDetailById(item.id, ORG_A)
    expect(detail!.feedbackRatingValue).toBe(2)
    expect(detail!.reviewRating).toBeNull()
    expect(detail!.reviewContentStatus).toBeNull()
  })
})

describe('inbox repository — live content lookup (BQC-1.2)', () => {
  const repo = createInboxRepository(db, emptyLookupPorts)

  it('list items read rating/snippet/reviewerName from the eligible lookup map', async () => {
    const srcId = crypto.randomUUID()
    await repo.seedItem(makeInboxItem({ sourceId: reviewId(srcId) }))

    const liveRepo = createInboxRepository(db, {
      ...emptyLookupPorts,
      reviewLookup: {
        ...emptyLookupPorts.reviewLookup,
        getReviewSnippetsByIds: async () =>
          new Map([
            [
              srcId,
              {
                text: 'Live text',
                translatedText: null,
                reviewerName: 'Live Reviewer',
                reviewerProfilePhotoUrl: null,
                googleReviewUrl: null,
                rating: 5,
                languageCode: 'en',
              },
            ],
          ]),
      },
    })

    const result = await liveRepo.findFilteredPaginated({}, ORG_A, undefined, 50)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.rating).toBe(5)
    expect(result.items[0]!.snippet).toBe('Live text')
    expect(result.items[0]!.reviewerName).toBe('Live Reviewer')
    expect(result.items[0]!.reviewLanguageCode).toBe('en')
    expect(result.items[0]!.contentAvailability).toBe('text')
  })

  it('marks a live textless review as rating-only only when a rating exists', async () => {
    const sourceId = reviewId(crypto.randomUUID())
    await repo.seedItem(makeInboxItem({ sourceId }))
    const ratingOnlyRepo = createInboxRepository(db, {
      ...emptyLookupPorts,
      reviewLookup: {
        ...emptyLookupPorts.reviewLookup,
        getReviewSnippetsByIds: async () =>
          new Map([
            [
              sourceId,
              {
                text: null,
                translatedText: null,
                reviewerName: null,
                reviewerProfilePhotoUrl: null,
                googleReviewUrl: null,
                rating: 4,
                languageCode: null,
              },
            ],
          ]),
      },
    })

    const [item] = (await ratingOnlyRepo.findFilteredPaginated({}, ORG_A)).items
    expect(item?.snippet).toBeNull()
    expect(item?.contentAvailability).toBe('rating_only')
  })

  it('batches and enriches feedback rows without inventing a reviewer', async () => {
    const sourceId = feedbackId(crypto.randomUUID())
    await repo.seedItem(
      makeInboxItem({ sourceType: 'feedback', sourceId, platform: 'direct' }),
    )
    const getFeedbackSnippetsByIds = vi.fn(
      async () =>
        new Map([[sourceId, { comment: 'Excellent breakfast', ratingValue: 5 }]]),
    )
    const feedbackRepo = createInboxRepository(db, {
      ...emptyLookupPorts,
      feedbackLookup: { ...emptyLookupPorts.feedbackLookup, getFeedbackSnippetsByIds },
    })

    const [item] = (await feedbackRepo.findFilteredPaginated({}, ORG_A)).items

    expect(getFeedbackSnippetsByIds).toHaveBeenCalledWith([sourceId], ORG_A)
    expect(item).toMatchObject({
      sourceType: 'feedback',
      rating: 5,
      snippet: 'Excellent breakfast',
      reviewerName: null,
      contentAvailability: 'text',
    })
  })

  it('list items render nulls when the lookup has no eligible snippet', async () => {
    await repo.seedItem(makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }))

    const result = await repo.findFilteredPaginated({}, ORG_A, undefined, 50)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.rating).toBeNull()
    expect(result.items[0]!.snippet).toBeNull()
    expect(result.items[0]!.reviewerName).toBeNull()
    expect(result.items[0]!.contentAvailability).toBe('unavailable')
  })

  it('rating/search filters resolve via reviewLookup.findEligibleReviewIds', async () => {
    const srcMatch = crypto.randomUUID()
    const srcOther = crypto.randomUUID()
    await repo.seedItem(makeInboxItem({ sourceId: reviewId(srcMatch) }))
    await repo.seedItem(makeInboxItem({ sourceId: reviewId(srcOther) }))

    const filteredRepo = createInboxRepository(db, {
      ...emptyLookupPorts,
      reviewLookup: {
        ...emptyLookupPorts.reviewLookup,
        findEligibleReviewIds: async () => [srcMatch],
      },
    })

    const result = await filteredRepo.findFilteredPaginated(
      { ratingMin: 4 },
      ORG_A,
      undefined,
      50,
    )
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.sourceId).toBe(reviewId(srcMatch))
  })

  it('rating/search filters correlate eligible ids with feedback source type', async () => {
    const sharedId = crypto.randomUUID()
    await repo.seedItem(
      makeInboxItem({ sourceType: 'review', sourceId: reviewId(sharedId) }),
    )
    await repo.seedItem(
      makeInboxItem({ sourceType: 'feedback', sourceId: feedbackId(sharedId) }),
    )
    const findEligibleFeedbackIds = vi.fn(async () => [feedbackId(sharedId)])
    const filteredRepo = createInboxRepository(db, {
      ...emptyLookupPorts,
      feedbackLookup: { ...emptyLookupPorts.feedbackLookup, findEligibleFeedbackIds },
    })

    const result = await filteredRepo.findFilteredPaginated(
      { q: 'breakfast' },
      ORG_A,
      undefined,
      50,
    )

    expect(findEligibleFeedbackIds).toHaveBeenCalledWith(ORG_A, {
      ratingMin: undefined,
      ratingMax: undefined,
      textQuery: 'breakfast',
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.sourceType).toBe('feedback')
  })

  it('rating/search filters match nothing when no reviews are eligible', async () => {
    await repo.seedItem(makeInboxItem({ sourceId: reviewId(crypto.randomUUID()) }))

    // emptyLookupPorts.findEligibleReviewIds returns [] — provably empty result.
    const result = await repo.findFilteredPaginated(
      { ratingMin: 4 },
      ORG_A,
      undefined,
      50,
    )
    expect(result.items).toHaveLength(0)
    expect(result.nextCursor).toBeNull()
  })
})
