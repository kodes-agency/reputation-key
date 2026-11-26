import { describe, expect, it } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { Review } from '../domain/review-types'
import { GOOGLE_REVIEW_PRIMARY_SEGMENTS } from '#/shared/testing/google-provider-identifiers-v1'
import { providerReplyObservationKey } from './sync-reviews.server'
import {
  SCOPE_AI_PROVENANCE,
  SCOPE_NOW,
  SCOPE_ORG,
  SCOPE_PROPERTY,
  SCOPE_PROVIDER_REVIEW,
  SCOPE_REVIEW,
  scopeObservation,
  scopeReview,
  scopeWriter,
} from './sync-reviews.test-fixtures'
describe('Review provider observation of a Google reply it cannot read', () => {
  it('records no reply observation for a reply whose original text Google did not return', async () => {
    // Google shows a reply, but only as a translation envelope: the original
    // text is not recoverable, so `replyText` is null and `replyUnreadable` is
    // true. Recording `null` would write an `absent` head for a live reply and
    // reopen a closed Inbox item as "reply deleted".
    const { writer, record, upsertAndRecord } = scopeWriter(null)

    await writer.persist(
      scopeObservation({
        sourceEpoch: 4,
        review: { ...SCOPE_PROVIDER_REVIEW, replyText: null, replyUnreadable: true },
      }),
    )

    expect(upsertAndRecord).toHaveBeenCalledTimes(1)
    expect(record).not.toHaveBeenCalled()
  })

  it('still records an absent reply when Google shows none', async () => {
    const { writer, record } = scopeWriter(null)

    await writer.persist(
      scopeObservation({
        sourceEpoch: 4,
        review: { ...SCOPE_PROVIDER_REVIEW, replyText: null, replyUnreadable: false },
      }),
    )

    expect(record).toHaveBeenCalledTimes(1)
    expect(record.mock.calls[0]?.[0]).toMatchObject({ observedText: null })
  })
})

describe('Review provider observation of a reply Google is moderating', () => {
  // Google's moderation state is parsed and logged, not decided on. A snapshot
  // read of a PENDING or REJECTED reply is therefore recorded exactly as the
  // same read without the field: same observation key, same text, same clock.
  it.each(['pending', 'rejected', 'unspecified', 'approved'] as const)(
    'records a %s reply exactly as the same read without the moderation field',
    async (state) => {
      const reply = {
        ...SCOPE_PROVIDER_REVIEW,
        replyText: 'Thanks for staying with us',
        replyUpdatedAt: new Date('2026-09-09T09:01:28.000Z'),
      }
      const without = scopeWriter(null)
      const withState = scopeWriter(null)

      await without.writer.persist(scopeObservation({ sourceEpoch: 4, review: reply }))
      await withState.writer.persist(
        scopeObservation({
          sourceEpoch: 4,
          review: {
            ...reply,
            replyModeration: {
              state,
              policyViolation: state === 'rejected' ? 'SPAM' : null,
              commentPresent: true,
              commentEmpty: false,
              updateTimePresent: true,
              updateTimeEmpty: false,
            },
          },
        }),
      )

      expect(withState.record).toHaveBeenCalledTimes(1)
      expect(withState.record.mock.calls).toEqual(without.record.mock.calls)
    },
  )
})

describe('Review provider observation of text the AI source contract refuses', () => {
  // 497 x U+FDFA is 1,491 bytes of Google text and 16,401 once NFKC has
  // expanded it, over the 16,384 byte limit of the canonical AI source (S13-02).
  const OVER_THE_LIMIT = { ...SCOPE_PROVIDER_REVIEW, text: '\uFDFA'.repeat(497) }
  const UNPAIRED_SURROGATE = { ...SCOPE_PROVIDER_REVIEW, text: 'Lovely stay \uD83D' }
  const CANONICAL_LIMIT = 16_384

  it('stores a review whose canonical source is over the limit, marked as over it', async () => {
    const { writer, upsertAndRecord } = scopeWriter(null)

    await writer.persist(scopeObservation({ sourceEpoch: 4, review: OVER_THE_LIMIT }))

    const stored = upsertAndRecord.mock.calls[0]?.[0]
    expect(stored?.text).toBe(OVER_THE_LIMIT.text)
    expect(stored?.aiSourceByteLength).toBeGreaterThan(CANONICAL_LIMIT)
    expect(stored?.aiSourceDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('stores a review whose text holds an unpaired surrogate, marked as over the limit', async () => {
    const { writer, upsertAndRecord } = scopeWriter(null)

    await writer.persist(scopeObservation({ sourceEpoch: 4, review: UNPAIRED_SURROGATE }))

    const stored = upsertAndRecord.mock.calls[0]?.[0]
    expect(stored?.aiSourceByteLength).toBeGreaterThan(CANONICAL_LIMIT)
  })

  it('refreshes the same refused review quietly when it is observed again', async () => {
    const first = scopeWriter(null)
    await first.writer.persist(
      scopeObservation({ sourceEpoch: 4, review: OVER_THE_LIMIT }),
    )
    const firstWrite = first.upsertAndRecord.mock.calls[0]?.[0]
    const existing = scopeReview({ ...firstWrite, sourceEpoch: 4 })
    const { writer, upsert, upsertAndRecord } = scopeWriter(existing)

    await writer.persist(scopeObservation({ sourceEpoch: 4, review: OVER_THE_LIMIT }))

    expect(upsertAndRecord).not.toHaveBeenCalled()
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('records an update when a refused review is edited to other refused text', async () => {
    const first = scopeWriter(null)
    await first.writer.persist(
      scopeObservation({ sourceEpoch: 4, review: OVER_THE_LIMIT }),
    )
    const firstWrite = first.upsertAndRecord.mock.calls[0]?.[0]
    const existing = scopeReview({ ...firstWrite, sourceEpoch: 4 })
    const { writer, upsertAndRecord } = scopeWriter(existing)

    await writer.persist(
      scopeObservation({
        sourceEpoch: 4,
        review: { ...OVER_THE_LIMIT, text: '\uFDFB'.repeat(497) },
      }),
    )

    expect(upsertAndRecord).toHaveBeenCalledTimes(1)
  })

  it('records an update when a guest shortens a refused review into one the AI can read', async () => {
    const first = scopeWriter(null)
    await first.writer.persist(
      scopeObservation({ sourceEpoch: 4, review: OVER_THE_LIMIT }),
    )
    const firstWrite = first.upsertAndRecord.mock.calls[0]?.[0]
    const existing = scopeReview({ ...firstWrite, sourceEpoch: 4 })
    const { writer, upsertAndRecord } = scopeWriter(existing)

    await writer.persist(
      scopeObservation({ sourceEpoch: 4, review: SCOPE_PROVIDER_REVIEW }),
    )

    const written = upsertAndRecord.mock.calls[0]?.[0]
    expect(written?.aiSourceByteLength).toBe(SCOPE_AI_PROVENANCE.byteLength)
    expect(written?.aiSourceDigest).toBe(SCOPE_AI_PROVENANCE.digest)
  })

  it('records an update when a guest expands a readable review past the limit', async () => {
    const existing = scopeReview({ sourceEpoch: 4 })
    const { writer, upsertAndRecord } = scopeWriter(existing)

    await writer.persist(scopeObservation({ sourceEpoch: 4, review: OVER_THE_LIMIT }))

    const written = upsertAndRecord.mock.calls[0]?.[0]
    expect(written?.aiSourceByteLength).toBeGreaterThan(CANONICAL_LIMIT)
  })
})

describe("Review provider observation of the review's page on Google", () => {
  // Synthetic (test-fixtures/google-provider-identifiers-v1.json).
  const PAGE = `https://business.google.com/n/${GOOGLE_REVIEW_PRIMARY_SEGMENTS.locationId}/reviews/repkey-synthetic-do-not-use-reply-token-0001`

  it('carries the page on a first sighting', async () => {
    const { writer, upsertAndRecord } = scopeWriter(null)

    await writer.persist(
      scopeObservation({ review: { ...SCOPE_PROVIDER_REVIEW, googleReviewUrl: PAGE } }),
    )

    expect(upsertAndRecord.mock.calls[0]?.[0]).toMatchObject({ googleReviewUrl: PAGE })
  })

  it.each([
    ['starts sending a page', null, PAGE],
    ['stops sending one', PAGE, null],
  ])(
    'refreshes an unchanged Review quietly when Google %s, writing what it sent',
    async (_case, stored, sent) => {
      const existing = scopeReview({ sourceEpoch: 4, googleReviewUrl: stored })
      const refresh = (googleReviewUrl: string | null) => {
        const written = scopeWriter(existing)
        return written.writer
          .persist(
            scopeObservation({
              sourceEpoch: 4,
              review: { ...SCOPE_PROVIDER_REVIEW, googleReviewUrl },
            }),
          )
          .then(() => written)
      }
      // The same fetch with the page as it was stored is the baseline.
      const same = await refresh(stored)
      const changed = await refresh(sent)

      // The page is in no digest and no AI source, so it never reads as an edit.
      expect(changed.upsertAndRecord).not.toHaveBeenCalled()
      expect(changed.upsert).toHaveBeenCalledTimes(1)
      const { googleReviewUrl, ...rest } = changed.upsert.mock.calls[0]![0]
      const { googleReviewUrl: baseline, ...expected } = same.upsert.mock.calls[0]![0]
      expect(googleReviewUrl).toBe(sent)
      expect(baseline).toBe(stored)
      expect(rest).toEqual(expected)
      expect(rest.sourceRevision).toBe(existing.sourceRevision)
      expect(rest.aiSourceDigest).toBe(existing.aiSourceDigest)
    },
  )
})

describe('Review provider observation identity', () => {
  it('does not conflate an absent reply with the literal live reply "absent"', () => {
    const common = {
      providerObservationKey: 'f'.repeat(64),
      sourceEpoch: 4,
      materialReviewRevision: 8,
      replyUpdatedAt: null,
    }

    expect(providerReplyObservationKey({ ...common, replyText: null })).not.toBe(
      providerReplyObservationKey({ ...common, replyText: 'absent' }),
    )
  })

  it('carries the same Review forward after its property source epoch advances', async () => {
    const existing = scopeReview({ sourceEpoch: 3 })
    const { writer, upsert, upsertAndRecord } = scopeWriter(existing)

    await expect(writer.persist(scopeObservation({ sourceEpoch: 4 }))).resolves.toEqual({
      reviewId: existing.id,
      sourceRevision: existing.sourceRevision + 1,
      isNew: false,
    })
    expect(upsertAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: existing.id,
        organizationId: existing.organizationId,
        propertyId: existing.propertyId,
        sourceEpoch: 4,
      }),
      expect.any(Function),
      SCOPE_NOW,
      'e'.repeat(64),
      'ongoing',
      undefined,
      false,
    )
    expect(upsert).not.toHaveBeenCalled()
  })

  it('marks the recorded review event with the observation origin', async () => {
    const existing = scopeReview({ sourceEpoch: 3 })
    const { writer, upsertAndRecord } = scopeWriter(existing)

    await writer.persist(
      scopeObservation({ sourceEpoch: 4, observationOrigin: 'historical_onboarding' }),
    )

    const eventFor = (upsertAndRecord.mock.calls[0] as unknown as unknown[])[1] as (
      persisted: Review,
    ) => Readonly<{ _tag: string; observationOrigin?: string }>
    const persisted = await upsertAndRecord.mock.results[0]?.value
    expect(eventFor(persisted)).toMatchObject({
      _tag: 'review.updated',
      observationOrigin: 'historical_onboarding',
    })
  })

  it('carries an expired Review forward through the re-observation path', async () => {
    const existing = scopeReview({
      sourceEpoch: 3,
      contentExpiresAt: new Date('2026-09-04T10:00:00.000Z'),
    })
    const { writer, upsert, reobserveExpiredAndRecord } = scopeWriter(existing)

    await expect(writer.persist(scopeObservation({ sourceEpoch: 4 }))).resolves.toEqual({
      reviewId: existing.id,
      sourceRevision: existing.sourceRevision + 1,
      isNew: false,
    })
    expect(reobserveExpiredAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: existing.id,
        propertyId: existing.propertyId,
        sourceEpoch: 4,
      }),
      SCOPE_NOW,
      'e'.repeat(64),
      'ongoing',
      false,
    )
    expect(upsert).not.toHaveBeenCalled()
  })

  it.each([
    [
      'rejects an external Review identity owned by a different Property',
      () =>
        scopeReview({
          propertyId: propertyId('73000000-0000-4000-8000-000000000014'),
          sourceEpoch: 4,
        }),
    ],
    [
      'rejects a stale observation after the stored Review has reached a newer epoch',
      () => scopeReview({ sourceEpoch: 5 }),
    ],
    [
      'rejects an external Review identity outside the observation organization',
      () =>
        scopeReview({
          organizationId: organizationId('org-review-writer-scope-other'),
          sourceEpoch: 3,
        }),
    ],
  ])('%s', async (_title, storedReview) => {
    const { writer, upsert } = scopeWriter(storedReview())

    await expect(
      writer.persist(scopeObservation({ sourceEpoch: 4 })),
    ).rejects.toMatchObject({
      _tag: 'DomainError',
      code: 'observation_scope_mismatch',
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('re-observes an erased provider subject on the same stable ReviewId', async () => {
    const { writer, reobserveExpiredAndRecord } = scopeWriter(null, null, {
      id: SCOPE_REVIEW,
      organizationId: SCOPE_ORG,
      propertyId: SCOPE_PROPERTY,
      sourceEpoch: 4,
      sourceRevision: 7,
      analysisSequence: 11,
      sourceContentState: 'provider_deleted',
      firstFetchedAt: new Date('2026-07-01T10:00:00.000Z'),
      sourceSeenGeneration: null,
      sentimentLabel: 'negative',
      sentimentScore: -0.8,
    })

    const result = await writer.persist(
      scopeObservation({
        sourceEpoch: 4,
        observationKey: 'f'.repeat(64),
        review: {
          ...SCOPE_PROVIDER_REVIEW,
          rating: 2,
          text: 'Corrected source content',
        },
      }),
    )

    expect(reobserveExpiredAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: SCOPE_REVIEW,
        sourceEpoch: 4,
        sourceRevision: 7,
        analysisSequence: 11,
      }),
      SCOPE_NOW,
      'f'.repeat(64),
      'ongoing',
      false,
    )
    expect(result).toEqual({ reviewId: SCOPE_REVIEW, sourceRevision: 8, isNew: false })
  })
})

describe("Review provider observation of Google's updateTime", () => {
  // The Review store may call a difference at an unmoved updateTime Google
  // rewording a review, but only when Google reported a time on this read. The
  // writer carries the stored time onto a read that lacked one, so the store
  // cannot tell the two apart unless the writer says which it was.
  const STORED_UPDATE = new Date('2026-08-20T09:00:00.000Z')
  const EDITED = { ...SCOPE_PROVIDER_REVIEW, text: 'Existing review, edited' }
  const storedReview = (over: Partial<Review> = {}) =>
    scopeReview({ sourceEpoch: 4, sourceUpdatedAt: STORED_UPDATE, ...over })
  /** The arguments of a store's first call, whatever its mock was typed with. */
  const argumentsOf = (store: { mock: { calls: readonly unknown[] } }) =>
    store.mock.calls[0] as unknown[]

  it('tells the store Google reported no updateTime, though the stored Review has one', async () => {
    const { writer, upsertAndRecord } = scopeWriter(storedReview())

    await writer.persist(scopeObservation({ sourceEpoch: 4, review: EDITED }))

    const call = argumentsOf(upsertAndRecord)
    // The stored time is carried onto the observation, as it always was.
    expect((call[0] as Review).sourceUpdatedAt).toEqual(STORED_UPDATE)
    expect(call[6]).toBe(false)
  })

  it('tells the store Google reported an updateTime when it did, moved or not', async () => {
    for (const reportedAt of [STORED_UPDATE, new Date(STORED_UPDATE.getTime() + 1)]) {
      const { writer, upsertAndRecord } = scopeWriter(storedReview())

      await writer.persist(
        scopeObservation({
          sourceEpoch: 4,
          review: { ...EDITED, sourceUpdatedAt: reportedAt },
        }),
      )

      const call = argumentsOf(upsertAndRecord)
      expect((call[0] as Review).sourceUpdatedAt).toEqual(reportedAt)
      expect(call[6]).toBe(true)
    }
  })

  it('tells the store a first sighting has no reported updateTime when Google sent none', async () => {
    const { writer, upsertAndRecord } = scopeWriter(null)

    await writer.persist(scopeObservation({ sourceEpoch: 4, review: EDITED }))

    expect(argumentsOf(upsertAndRecord)[6]).toBe(false)
  })

  it('says the same on the re-observation of an expired Review', async () => {
    const expired = storedReview({
      sourceEpoch: 3,
      contentExpiresAt: new Date('2026-09-04T10:00:00.000Z'),
    })
    const omitted = scopeWriter(expired)
    const reported = scopeWriter(expired)

    await omitted.writer.persist(scopeObservation({ sourceEpoch: 4, review: EDITED }))
    await reported.writer.persist(
      scopeObservation({
        sourceEpoch: 4,
        review: { ...EDITED, sourceUpdatedAt: STORED_UPDATE },
      }),
    )

    expect(argumentsOf(omitted.reobserveExpiredAndRecord)[4]).toBe(false)
    expect(argumentsOf(reported.reobserveExpiredAndRecord)[4]).toBe(true)
  })

  it('says the same on the quiet refresh of an unchanged Review', async () => {
    const omitted = scopeWriter(storedReview())
    const reported = scopeWriter(storedReview())

    await omitted.writer.persist(
      scopeObservation({ sourceEpoch: 4, review: SCOPE_PROVIDER_REVIEW }),
    )
    await reported.writer.persist(
      scopeObservation({
        sourceEpoch: 4,
        review: { ...SCOPE_PROVIDER_REVIEW, sourceUpdatedAt: STORED_UPDATE },
      }),
    )

    expect(argumentsOf(omitted.upsert)[4]).toBe(false)
    expect(argumentsOf(reported.upsert)[4]).toBe(true)
  })
})
