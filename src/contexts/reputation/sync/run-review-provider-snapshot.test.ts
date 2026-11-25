import { expect, it, vi } from 'vitest'
import {
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '#/shared/testing/google-provider-identifiers-v1'
import { runReviewProviderSnapshot } from './run-review-provider-snapshot.server'
import {
  organizationId,
  propertyId,
  reviewId,
  runId,
  NOW,
  review,
  run,
  makeDeps,
  request,
} from './run-review-provider-snapshot.test-fixtures'

describe('runReviewProviderSnapshot', () => {
  it('persists one bounded main page and checkpoints into confirmation', async () => {
    const deps = makeDeps()

    await expect(runReviewProviderSnapshot(deps)(request)).resolves.toEqual({
      status: 'checkpointed',
      runId,
      state: 'confirming',
    })
    expect(deps.googleReviewApi.listReviewsPage).toHaveBeenCalledWith(
      expect.objectContaining({ pageIndex: 0, phase: 'main', cursorRef: null }),
    )
    expect(
      vi.mocked(deps.googleReviewApi.listReviewsPage).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(deps.observationWriter.allocateReplyReadGeneration).mock
        .invocationCallOrder[0]!,
    )
    expect(deps.observationWriter.persist).toHaveBeenCalledTimes(1)
    expect(deps.repository.startOrResume).toHaveBeenCalledWith(
      expect.objectContaining({ observationOrigin: 'ongoing' }),
    )
    expect(deps.observationWriter.persist).toHaveBeenCalledWith(
      expect.objectContaining({ observationOrigin: 'ongoing' }),
    )
    expect(deps.repository.commitPage).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        expectedPageIndex: 0,
        observations: expect.any(Array),
      }),
    )
  })

  it('keeps the persisted run origin when a continuation carries a newer hint', async () => {
    const deps = makeDeps({
      currentRun: run({ observationOrigin: 'historical_onboarding' }),
    })

    await runReviewProviderSnapshot(deps)(request)

    expect(deps.observationWriter.persist).toHaveBeenCalledWith(
      expect.objectContaining({ observationOrigin: 'historical_onboarding' }),
    )
  })

  it('measures a review published after a historical import began', async () => {
    const deps = makeDeps({
      currentRun: run({
        observationOrigin: 'historical_onboarding',
        startedAt: new Date('2026-08-16T00:00:00.000Z'),
      }),
      page: {
        reviews: [
          {
            ...review,
            reviewedAt: new Date('2026-08-16T00:01:00.000Z'),
            sourceCreatedAt: new Date('2026-08-16T00:01:00.000Z'),
          },
        ],
        totalReviewCount: 1,
        averageRating: 5,
        nextCursorRef: null,
      },
    })

    await runReviewProviderSnapshot(deps)(request)

    expect(deps.observationWriter.persist).toHaveBeenCalledWith(
      expect.objectContaining({ observationOrigin: 'ongoing' }),
    )
  })

  it('classifies every review against the durable import cutoff', async () => {
    const cutoff = new Date('2026-08-16T00:00:00.000Z')
    const deps = makeDeps({
      currentRun: run({
        observationOrigin: 'historical_onboarding',
        startedAt: cutoff,
      }),
      page: {
        reviews: [
          { ...review, sourceCreatedAt: cutoff },
          {
            ...review,
            reviewName: `${GOOGLE_REVIEW_PRIMARY_RESOURCE}-new`,
            externalId: `${GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId}-new`,
            reviewedAt: new Date('2026-08-16T00:00:01.000Z'),
            sourceCreatedAt: new Date('2026-08-16T00:00:01.000Z'),
          },
        ],
        totalReviewCount: 2,
        averageRating: 5,
        nextCursorRef: null,
      },
    })

    await runReviewProviderSnapshot(deps)(request)

    expect(deps.observationWriter.persist).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ observationOrigin: 'historical_onboarding' }),
    )
    expect(deps.observationWriter.persist).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ observationOrigin: 'ongoing' }),
    )
  })

  it('classifies a retried import against the first import cutoff, not its own start', async () => {
    const deps = makeDeps({
      currentRun: run({
        observationOrigin: 'historical_onboarding',
        startedAt: new Date('2026-08-16T06:00:00.000Z'),
      }),
      historyCutoff: new Date('2026-08-16T00:00:00.000Z'),
      page: {
        reviews: [
          {
            ...review,
            reviewedAt: new Date('2026-08-16T03:00:00.000Z'),
            sourceCreatedAt: new Date('2026-08-16T03:00:00.000Z'),
          },
        ],
        totalReviewCount: 1,
        averageRating: 5,
        nextCursorRef: null,
      },
    })

    await runReviewProviderSnapshot(deps)(request)

    expect(deps.repository.readHistoryCutoff).toHaveBeenCalledWith({
      organizationId,
      propertyId,
      sourceEpoch: 1,
    })
    expect(deps.observationWriter.persist).toHaveBeenCalledWith(
      expect.objectContaining({ observationOrigin: 'ongoing' }),
    )
  })

  it('excludes an unusable publication clock instead of inventing timing', async () => {
    const deps = makeDeps({
      currentRun: run({ observationOrigin: 'historical_onboarding' }),
      page: {
        reviews: [
          {
            ...review,
            reviewedAt: new Date(Number.NaN),
            sourceCreatedAt: new Date(Number.NaN),
          },
        ],
        totalReviewCount: 1,
        averageRating: 5,
        nextCursorRef: null,
      },
    })

    await runReviewProviderSnapshot(deps)(request)

    expect(deps.observationWriter.persist).toHaveBeenCalledWith(
      expect.objectContaining({ observationOrigin: 'legacy_unknown' }),
    )
  })

  it('stamps discovery activity once for a page that persisted a new review', async () => {
    const deps = makeDeps({
      page: {
        reviews: [
          review,
          {
            ...review,
            // Composed from the fixture catalogue (a hand-written
            // `accounts/…/reviews/…` literal fails lint) — a page with two
            // DISTINCT provider resources, since duplicates are rejected.
            reviewName: `${GOOGLE_REVIEW_PRIMARY_RESOURCE}-2`,
            externalId: `${GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId}-2`,
          },
        ],
        totalReviewCount: 2,
        averageRating: 5,
        nextCursorRef: null,
      },
      observationIsNew: true,
    })

    await runReviewProviderSnapshot(deps)(request)

    // Two new reviews on one page is ONE activity fact, not two writes.
    expect(deps.syncActivity.recordNewReviewObserved).toHaveBeenCalledTimes(1)
    expect(deps.syncActivity.recordNewReviewObserved).toHaveBeenCalledWith(
      propertyId,
      NOW,
    )
  })

  it('tells the writer polling found each review of a snapshot page', async () => {
    const deps = makeDeps()

    await runReviewProviderSnapshot(deps)(request)

    expect(deps.observationWriter.persist).toHaveBeenCalledWith(
      expect.objectContaining({ firstSeenVia: 'snapshot' }),
    )
  })

  it('tells the writer a push handed the snapshot off when the run answers one', async () => {
    const deps = makeDeps()

    await runReviewProviderSnapshot(deps)({ ...request, firstSeenVia: 'push_reconcile' })

    expect(deps.observationWriter.persist).toHaveBeenCalledWith(
      expect.objectContaining({ firstSeenVia: 'push_reconcile' }),
    )
  })

  it('does not stamp discovery activity for a page of already-seen reviews', async () => {
    const deps = makeDeps({ observationIsNew: false })

    await runReviewProviderSnapshot(deps)(request)

    expect(deps.observationWriter.persist).toHaveBeenCalledTimes(1)
    expect(deps.syncActivity.recordNewReviewObserved).not.toHaveBeenCalled()
  })

  it('fails the page loudly when the activity stamp cannot be written', async () => {
    const deps = makeDeps({ observationIsNew: true })
    vi.mocked(deps.syncActivity.recordNewReviewObserved).mockRejectedValue(
      new Error('sync state write failed'),
    )

    await expect(runReviewProviderSnapshot(deps)(request)).resolves.toEqual({
      status: 'failed',
      runId,
      code: 'observation_failed',
    })
  })

  it('finishes the phase instead of refetching when a continuation lost its cursor', async () => {
    // A null cursor off page 0 means the previous page was final. Calling the
    // provider then fetches WITHOUT a page token, silently re-reads page 1, and
    // ends by publishing a cursor for a page that does not exist — which the
    // cursor store refuses with `binding_mismatch`. A completed 6-page /
    // 256-review scan in google-closed-beta died exactly that way and wrote no
    // watermark.
    const deps = makeDeps({
      currentRun: run({ mainPageIndex: 6, mainCursorRef: null, mainUniqueCount: 256 }),
    })

    await expect(runReviewProviderSnapshot(deps)(request)).resolves.toEqual({
      status: 'checkpointed',
      runId,
      state: 'confirming',
    })
    expect(deps.googleReviewApi.listReviewsPage).not.toHaveBeenCalled()
    expect(deps.repository.commitPage).not.toHaveBeenCalled()
    expect(deps.repository.finishMainScan).toHaveBeenCalledWith({ runId })
  })

  it('fails closed before persistence for a duplicate provider resource', async () => {
    const deps = makeDeps({
      page: {
        reviews: [review, review],
        totalReviewCount: 2,
        averageRating: 5,
        nextCursorRef: null,
      },
    })

    await expect(runReviewProviderSnapshot(deps)(request)).resolves.toEqual({
      status: 'failed',
      runId,
      code: 'duplicate_resource',
    })
    expect(deps.observationWriter.persist).not.toHaveBeenCalled()
    expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalledTimes(1)
  })

  it.each([
    { totalReviewCount: 1, averageRating: null },
    { totalReviewCount: 0, averageRating: 4 },
    { totalReviewCount: 1, averageRating: -0.1 },
    { totalReviewCount: 1, averageRating: 5.1 },
  ])(
    'fails before persistence when provider aggregate semantics drift: %o',
    async ({ totalReviewCount, averageRating }) => {
      const deps = makeDeps({
        page: {
          reviews: totalReviewCount === 0 ? [] : [review],
          totalReviewCount,
          averageRating,
          nextCursorRef: null,
        },
      })

      await expect(runReviewProviderSnapshot(deps)(request)).resolves.toMatchObject({
        status: 'failed',
        code: 'malformed_page',
      })
      expect(deps.observationWriter.persist).not.toHaveBeenCalled()
      expect(deps.repository.commitPage).not.toHaveBeenCalled()
    },
  )

  it('does not call the provider or delete when the source epoch changed', async () => {
    const deps = makeDeps()
    vi.mocked(deps.propertySourceEpoch.getSourceEpoch).mockResolvedValue({
      sourceEpoch: 2,
    })

    await expect(runReviewProviderSnapshot(deps)(request)).resolves.toEqual({
      status: 'failed',
      runId: '',
      code: 'source_changed',
    })
    expect(deps.googleReviewApi.listReviewsPage).not.toHaveBeenCalled()
    expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
  })

  it('retries a transient targeted lookup without advancing its candidate', async () => {
    const deps = makeDeps({
      currentRun: run({
        state: 'confirming',
        phase: 'confirmation',
        confirmationDeadline: new Date('2026-08-16T12:00:00.000Z'),
      }),
    })
    vi.mocked(deps.repository.readNextLinkedCandidate).mockResolvedValue({
      runId,
      reviewId,
      expectedState: 'linked',
      expectedSourceRevision: 1,
      status: 'pending',
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    })
    const providerError = Object.assign(new Error('bounded provider failure'), {
      _tag: 'GoogleReviewApiError' as const,
      code: 'provider_rate_limited' as const,
      recoverable: true,
    })
    vi.mocked(deps.googleReviewApi.getReview).mockRejectedValue(providerError)

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'checkpointed', runId, state: 'confirming' },
    )
    expect(deps.observationWriter.allocateReplyReadGeneration).not.toHaveBeenCalled()
    expect(deps.repository.confirmLinkedCandidateMissing).not.toHaveBeenCalled()
    expect(deps.repository.failRun).not.toHaveBeenCalled()
    expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
  })

  it('ends with the code the store recorded for a candidate an edit made stale', async () => {
    const deps = makeDeps({
      currentRun: run({
        state: 'confirming',
        phase: 'confirmation',
        confirmationDeadline: new Date('2026-08-16T12:00:00.000Z'),
      }),
    })
    vi.mocked(deps.repository.readNextLinkedCandidate).mockResolvedValue({
      runId,
      reviewId,
      expectedState: 'linked',
      expectedSourceRevision: 1,
      status: 'pending',
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    })
    vi.mocked(deps.repository.confirmLinkedCandidateMissing).mockResolvedValue(
      'edited_run_failed',
    )
    vi.mocked(deps.repository.failRun).mockResolvedValue(
      run({ state: 'failed', phase: 'terminal', failureCode: 'listing_changed' }),
    )

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'failed', runId, code: 'listing_changed' },
    )
    expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalled()
    expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
  })

  it('allocates a targeted reply generation only after acquiring the response', async () => {
    const deps = makeDeps({
      currentRun: run({
        state: 'confirming',
        phase: 'confirmation',
        confirmationDeadline: new Date('2026-08-16T12:00:00.000Z'),
      }),
    })
    vi.mocked(deps.repository.readNextLinkedCandidate).mockResolvedValue({
      runId,
      reviewId,
      expectedState: 'linked',
      expectedSourceRevision: 1,
      status: 'pending',
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    })
    vi.mocked(deps.googleReviewApi.getReview).mockResolvedValue({
      status: 'found',
      review,
    })

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'failed', runId, code: 'confirmation_set_changed' },
    )

    expect(
      vi.mocked(deps.googleReviewApi.getReview).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(deps.observationWriter.allocateReplyReadGeneration).mock
        .invocationCallOrder[0]!,
    )
    expect(deps.observationWriter.persist).toHaveBeenCalledWith(
      expect.objectContaining({ replyReadGeneration: 1 }),
    )
    expect(deps.repository.recordCandidateObservation).toHaveBeenCalledWith({
      runId,
      organizationId,
      observation: expect.any(Object),
    })
  })
})
