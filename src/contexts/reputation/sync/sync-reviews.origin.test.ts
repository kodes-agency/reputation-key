import { describe, expect, it } from 'vitest'
import type { ScopeStableIdentity } from './sync-reviews.test-fixtures'
import {
  SCOPE_NOW,
  SCOPE_ORG,
  SCOPE_PROPERTY,
  SCOPE_PROVIDER_REVIEW,
  SCOPE_REVIEW,
  historyAt,
  recordedOrigins,
  scopeObservation,
  scopeReview,
  scopeWriter,
  sightingOf,
} from './sync-reviews.test-fixtures'

describe('initial import history cutoff', () => {
  const publishedAt = SCOPE_PROVIDER_REVIEW.reviewedAt
  const daysAfterPublication = (days: number) =>
    new Date(publishedAt.getTime() + days * 24 * 60 * 60 * 1000)

  it('records a first sighting published at the import cutoff as onboarding history', async () => {
    const { writer, upsertAndRecord, readHistoryCutoff } = scopeWriter(
      null,
      historyAt(publishedAt),
    )

    await writer.persist(scopeObservation({ sourceEpoch: 4 }))

    expect(readHistoryCutoff).toHaveBeenCalledWith({
      organizationId: SCOPE_ORG,
      propertyId: SCOPE_PROPERTY,
      sourceEpoch: 4,
    })
    await expect(recordedOrigins(upsertAndRecord)).resolves.toEqual({
      stored: 'historical_onboarding',
      event: expect.objectContaining({
        _tag: 'review.created',
        observationOrigin: 'historical_onboarding',
      }),
    })
  })

  it.each([
    {
      title: 'measures a first sighting published after the import cutoff',
      existing: null,
      history: historyAt(new Date(publishedAt.getTime() - 1)),
      origin: 'ongoing' as const,
      expected: { stored: 'ongoing', event: { observationOrigin: 'ongoing' } },
    },
    {
      title: 'keeps measuring first sightings on a property that was never imported',
      existing: null,
      history: null,
      origin: 'ongoing' as const,
      expected: { stored: 'ongoing' },
    },
    {
      title:
        'keeps Google history from before the first import silent when a relink lists it',
      existing: null,
      history: historyAt(daysAfterPublication(200), { firstImportCutoffAt: publishedAt }),
      origin: 'historical_onboarding' as const,
      expected: {
        stored: 'historical_onboarding',
        event: { observationOrigin: 'historical_onboarding' },
      },
    },
    {
      title:
        "announces, without measuring, an old Review Google lists only after the epoch's history was listed",
      existing: null,
      history: historyAt(daysAfterPublication(1), { historyListed: true }),
      origin: 'ongoing' as const,
      expected: {
        stored: 'legacy_unknown',
        event: { _tag: 'review.created', observationOrigin: 'legacy_unknown' },
      },
    },
    {
      title: "treats a Review carried into a new source epoch by that epoch's cutoff",
      existing: scopeReview({ sourceEpoch: 3 }),
      history: historyAt(new Date('2026-09-01T00:00:00.000Z')),
      origin: 'ongoing' as const,
      expected: {
        stored: 'historical_onboarding',
        event: { _tag: 'review.updated', observationOrigin: 'historical_onboarding' },
      },
      readsCutoff: true,
    },
    {
      title:
        'carries a Review RepKey already knew into a relinked epoch as history, never as news',
      existing: scopeReview({ sourceEpoch: 3 }),
      history: historyAt(daysAfterPublication(7), {
        firstImportCutoffAt: daysAfterPublication(-30),
        historyListed: true,
      }),
      origin: 'historical_onboarding' as const,
      expected: {
        stored: 'historical_onboarding',
        event: { _tag: 'review.updated', observationOrigin: 'historical_onboarding' },
      },
    },
  ])('$title', async ({ existing, history, origin, expected, readsCutoff }) => {
    const { writer, upsertAndRecord, readHistoryCutoff } = scopeWriter(existing, history)

    await writer.persist(scopeObservation({ sourceEpoch: 4, observationOrigin: origin }))

    if (readsCutoff) {
      expect(readHistoryCutoff).toHaveBeenCalledWith(
        expect.objectContaining({ sourceEpoch: 4 }),
      )
    }
    await expect(recordedOrigins(upsertAndRecord)).resolves.toMatchObject(expected)
  })

  it.each(['historical_onboarding', 'ongoing'] as const)(
    'announces, without measuring, a Review a relink finds from after the first import (%s run)',
    async (observationOrigin) => {
      // Imported a month before Google published it; relinked a week after.
      const { writer, upsertAndRecord } = scopeWriter(
        null,
        historyAt(daysAfterPublication(7), {
          firstImportCutoffAt: daysAfterPublication(-30),
        }),
      )

      await writer.persist(scopeObservation({ sourceEpoch: 4, observationOrigin }))

      await expect(recordedOrigins(upsertAndRecord)).resolves.toEqual({
        stored: 'legacy_unknown',
        event: expect.objectContaining({
          _tag: 'review.created',
          observationOrigin: 'legacy_unknown',
        }),
      })
    },
  )

  it('never turns a later revision of a Review known in this epoch into history', async () => {
    const existing = scopeReview({ sourceEpoch: 4 })
    const { writer, upsertAndRecord, readHistoryCutoff } = scopeWriter(
      existing,
      historyAt(new Date('2026-09-01T00:00:00.000Z')),
    )

    await writer.persist(
      scopeObservation({
        sourceEpoch: 4,
        review: { ...SCOPE_PROVIDER_REVIEW, text: 'The guest edited this review' },
      }),
    )

    expect(readHistoryCutoff).not.toHaveBeenCalled()
    await expect(recordedOrigins(upsertAndRecord)).resolves.toMatchObject({
      stored: 'ongoing',
      event: { observationOrigin: 'ongoing' },
    })
  })

  it('never turns a Review re-observed through its stable provider identity into history', async () => {
    // Google deleted the review, clearing its external id, and lists it again:
    // only the stable provider subject still finds the same Review in this epoch.
    const { writer, reobserveExpiredAndRecord, readHistoryCutoff } = scopeWriter(
      null,
      historyAt(daysAfterPublication(1)),
      {
        id: SCOPE_REVIEW,
        organizationId: SCOPE_ORG,
        propertyId: SCOPE_PROPERTY,
        sourceEpoch: 4,
        sourceRevision: 3,
        analysisSequence: 5,
        sourceContentState: 'provider_deleted',
        firstFetchedAt: publishedAt,
        sourceSeenGeneration: null,
        sentimentLabel: null,
        sentimentScore: null,
      },
    )

    await writer.persist(scopeObservation({ sourceEpoch: 4 }))

    expect(readHistoryCutoff).not.toHaveBeenCalled()
    // One origin for the revision and its review.updated fact.
    expect(reobserveExpiredAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: SCOPE_REVIEW, sourceEpoch: 4 }),
      SCOPE_NOW,
      'e'.repeat(64),
      'ongoing',
      false,
    )
  })

  it('keeps the legacy origin a run gave an unusable provider clock', async () => {
    const { writer, upsertAndRecord, readHistoryCutoff } = scopeWriter(
      null,
      historyAt(daysAfterPublication(1)),
    )

    await writer.persist(
      scopeObservation({ sourceEpoch: 4, observationOrigin: 'legacy_unknown' }),
    )

    expect(readHistoryCutoff).not.toHaveBeenCalled()
    await expect(recordedOrigins(upsertAndRecord)).resolves.toMatchObject({
      stored: 'legacy_unknown',
    })
  })
})

describe('Review provider observation first-sighting ledger', () => {
  it('hands the command store the first sighting a polling snapshot made', async () => {
    const { writer, upsertAndRecord } = scopeWriter(null)

    await writer.persist(scopeObservation({ firstSeenVia: 'snapshot' }))

    expect(sightingOf(upsertAndRecord)).toEqual({
      seenVia: 'snapshot',
      pushAcceptedAt: null,
    })
  })

  it('carries the push acceptance time of a Review a push read found first', async () => {
    const acceptedAt = new Date('2026-09-05T09:59:30.000Z')
    const { writer, upsertAndRecord } = scopeWriter(null)

    await writer.persist(
      scopeObservation({ firstSeenVia: 'push', pushAcceptedAt: acceptedAt }),
    )

    expect(sightingOf(upsertAndRecord)).toEqual({
      seenVia: 'push',
      pushAcceptedAt: acceptedAt,
    })
  })

  it.each(['historical_onboarding', 'legacy_unknown'] as const)(
    'records no sighting for a first sighting whose origin is %s',
    async (observationOrigin) => {
      const { writer, upsertAndRecord } = scopeWriter(null)

      await writer.persist(scopeObservation({ observationOrigin }))

      expect(sightingOf(upsertAndRecord)).toBeUndefined()
    },
  )

  it('records no sighting for a history import first sighting after the cutoff turns it into history', async () => {
    const publishedAt = SCOPE_PROVIDER_REVIEW.reviewedAt
    const { writer, upsertAndRecord } = scopeWriter(null, historyAt(publishedAt))

    await writer.persist(scopeObservation({ sourceEpoch: 4 }))

    expect(sightingOf(upsertAndRecord)).toBeUndefined()
  })

  it('records no sighting for a Review RepKey already holds', async () => {
    const { writer, upsertAndRecord } = scopeWriter(scopeReview({ sourceEpoch: 4 }), null)

    await writer.persist(
      scopeObservation({ review: { ...SCOPE_PROVIDER_REVIEW, text: 'Edited review' } }),
    )

    expect(sightingOf(upsertAndRecord)).toBeUndefined()
  })

  it('records no sighting for a Review reached through its stable provider identity', async () => {
    const stableIdentity: ScopeStableIdentity = {
      id: SCOPE_REVIEW,
      organizationId: SCOPE_ORG,
      propertyId: SCOPE_PROPERTY,
      sourceEpoch: 4,
      sourceRevision: 7,
      analysisSequence: 11,
      sourceContentState: 'active',
      firstFetchedAt: new Date('2026-07-01T10:00:00.000Z'),
      sourceSeenGeneration: null,
      sentimentLabel: 'negative',
      sentimentScore: -0.8,
    }
    const { writer, upsertAndRecord } = scopeWriter(null, null, stableIdentity)

    await writer.persist(scopeObservation())

    expect(sightingOf(upsertAndRecord)).toBeUndefined()
  })
})
