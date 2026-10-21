import { describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import type {
  GoogleConnectionId,
  OrganizationId,
  PropertyId,
  ReviewId,
} from '#/shared/domain/ids'
import type { GoogleReview } from '../../domain/types'
import type { GoogleReviewApiPort } from '../ports/google-review-api.port'
import type { ReviewProviderObservationWriter } from '../ports/review-provider-observation-writer.port'
import type {
  ReviewProviderSnapshotRepository,
  ReviewProviderSnapshotRun,
} from '../ports/review-provider-snapshot.repository'
import type { ReviewProviderSubjectKeyService } from '../provider-subject-keyring'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  runReviewProviderSnapshot,
  type RunReviewProviderSnapshotDeps,
} from './run-review-provider-snapshot'

const organizationId = '00000000-0000-4000-8000-000000000001' as OrganizationId
const propertyId = '00000000-0000-4000-8000-000000000002' as PropertyId
const connectionId = '00000000-0000-4000-8000-000000000003' as GoogleConnectionId
const reviewId = '00000000-0000-4000-8000-000000000004' as ReviewId
const runId = '00000000-0000-4000-8000-000000000005'
const NOW = new Date('2026-08-21T12:00:00.000Z')

const review: GoogleReview = {
  reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
  externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
  externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  reviewerName: 'Synthetic Reviewer',
  reviewerProfilePhotoUrl: null,
  googleReviewUrl: null,
  rating: 5,
  text: 'Synthetic review body',
  translatedText: null,
  languageCode: 'en',
  reviewedAt: new Date('2026-08-16T00:00:00.000Z'),
  replyText: null,
  replyUpdatedAt: null,
}

const run = (
  overrides: Partial<ReviewProviderSnapshotRun> = {},
): ReviewProviderSnapshotRun => ({
  id: runId,
  organizationId,
  propertyId,
  sourceEpoch: 1,
  observationOrigin: 'ongoing',
  state: 'scanning',
  phase: 'main',
  startedAt: new Date('2026-08-16T00:00:00.000Z'),
  expectedProviderTotal: null,
  expectedProviderAverageRating: null,
  mainPageIndex: 0,
  mainCursorRef: null,
  mainUniqueCount: 0,
  confirmationPageIndex: 0,
  confirmationCursorRef: null,
  confirmationUniqueCount: 0,
  confirmationDeadline: null,
  applyCursorReviewId: null,
  terminalAt: null,
  failureCode: null,
  ...overrides,
})

function makeDeps(
  input: Readonly<{
    currentRun?: ReviewProviderSnapshotRun
    page?: Readonly<{
      reviews: readonly GoogleReview[]
      totalReviewCount: number
      averageRating: number | null
      nextCursorRef: string | null
    }>
    /** Drives the observation writer's new-vs-seen answer. */
    observationIsNew?: boolean
    /** The source epoch's durable import history cutoff. */
    historyCutoff?: Date
  }> = {},
): RunReviewProviderSnapshotDeps {
  const currentRun = input.currentRun ?? run()
  const repository: ReviewProviderSnapshotRepository = {
    readExpiredActiveRun: vi.fn(async () => null),
    startOrResume: vi.fn(async () => currentRun),
    readHistoryCutoff: vi.fn(async () =>
      input.historyCutoff == null
        ? null
        : {
            cutoffAt: input.historyCutoff,
            firstImportCutoffAt: input.historyCutoff,
            historyListed: false,
          },
    ),
    fixImportHistoryCutoff: vi.fn(async () => undefined),
    readRun: vi.fn(async () => currentRun),
    commitPage: vi.fn(async ({ nextCursorRef }) => ({
      status: 'committed' as const,
      run: currentRun,
      finalPage: nextCursorRef == null,
    })),
    finishMainScan: vi.fn(async () => ({
      status: 'confirming' as const,
      run: run({ state: 'confirming', phase: 'confirmation' }),
    })),
    readNextLinkedCandidate: vi.fn(async () => null),
    confirmLinkedCandidateMissing: vi.fn(async () => 'confirmed' as const),
    recordCandidateObservation: vi.fn(async () => 'observed_run_failed' as const),
    beginConfirmationScan: vi.fn(async () => currentRun),
    finishConfirmationScan: vi.fn(async () => ({
      status: 'deleting' as const,
      run: run({ state: 'deleting', phase: 'apply' }),
    })),
    failRun: vi.fn(async ({ code }) =>
      run({
        state: 'failed',
        phase: 'terminal',
        failureCode: code,
      }),
    ),
    applyDeletionBatch: vi.fn(async () => ({
      run: run({ state: 'completed', phase: 'terminal' }),
      applied: 0,
      observed: 0,
      done: true,
    })),
    expireRawSourceBatch: vi.fn(async () => ({ transitioned: 0, nextReviewId: null })),
    sweepExpiredTombstones: vi.fn(async () => ({ deleted: 0, nextReviewId: null })),
  }
  const googleReviewApi: GoogleReviewApiPort = {
    listReviewsPage: vi.fn(
      async () =>
        input.page ?? {
          reviews: [review],
          totalReviewCount: 1,
          averageRating: 5,
          nextCursorRef: null,
        },
    ),
    getReview: vi.fn(async () => ({ status: 'not_found' as const })),
    discardReviewCursors: vi.fn(async () => undefined),
    replyToReview: vi.fn(async () => ({ providerCorrelationId: null })),
  }
  const observationWriter: ReviewProviderObservationWriter = {
    allocateReplyReadGeneration: vi.fn(async () => 1),
    persist: vi.fn(async () => ({
      reviewId,
      sourceRevision: 1,
      isNew: input.observationIsNew ?? true,
    })),
  }
  const subjectKeyService: ReviewProviderSubjectKeyService = {
    acquireDeriver: vi.fn(async () => ({
      activeVersion: 'key-v1',
      retiringVersion: null,
      inventoryGeneration: 1,
      deriveCandidates: () =>
        [
          {
            contractVersion: 'review-provider-subject-v1' as const,
            keyVersion: 'key-v1',
            locatorHmac: new Uint8Array(32),
            verifierHmac: new Uint8Array(32),
          },
        ] as const,
    })),
    stageTrustedNext: vi.fn(async () => undefined),
    activateTrustedNext: vi.fn(async () => undefined),
    removeRetiring: vi.fn(async () => undefined),
  }
  return {
    repository,
    googleReviewApi,
    observationWriter,
    subjectKeyService,
    propertySourceEpoch: {
      getSourceEpoch: vi.fn(async () => ({
        sourceEpoch: 1,
      })),
    },
    syncActivity: {
      recordNewReviewObserved: vi.fn(async () => undefined),
      recordPushObserved: vi.fn(async () => undefined),
    },
    clock: () => NOW,
    logger: testLogger(),
  }
}

function testLogger(): LoggerPort {
  const logger: LoggerPort = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logger,
  }
  return logger
}

const request = {
  organizationId,
  propertyId,
  connectionId,
  sourceEpoch: 1,
  observationOrigin: 'ongoing' as const,
  firstSeenVia: 'snapshot' as const,
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
}

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

  it('checkpoints a rate-limited page scan and preserves the run cursors', async () => {
    const deps = makeDeps()
    const providerError = Object.assign(new Error('429 from provider'), {
      _tag: 'GoogleReviewApiError' as const,
      code: 'provider_rate_limited' as const,
      recoverable: true,
    })
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(providerError)

    // Transient: the queue retries the SAME page. Discarding cursors here
    // restarted a multi-page scan from zero on a single 429.
    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'checkpointed', runId, state: 'scanning' },
    )
    expect(deps.googleReviewApi.discardReviewCursors).not.toHaveBeenCalled()
    expect(deps.repository.failRun).not.toHaveBeenCalled()
    expect(deps.repository.commitPage).not.toHaveBeenCalled()
  })

  // The cursor does not move here, so the continuation repeats this exact call.
  // Carrying the provider's own hint out is what lets the scheduler wait
  // instead of spinning: without it the retry rate is queue speed.
  it('carries the provider backoff hint out on a rate-limited checkpoint', async () => {
    const deps = makeDeps()
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
      Object.assign(new Error('429 from provider'), {
        _tag: 'GoogleReviewApiError' as const,
        code: 'provider_rate_limited' as const,
        recoverable: true,
        retryAfterMs: 5_000,
      }),
    )

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'checkpointed', runId, state: 'scanning', retryAfterMs: 5_000 },
    )
  })

  it('omits the hint when the provider sent none, rather than inventing one', async () => {
    const deps = makeDeps()
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
      Object.assign(new Error('429 from provider'), {
        _tag: 'GoogleReviewApiError' as const,
        code: 'provider_rate_limited' as const,
        recoverable: true,
        retryAfterMs: 0,
      }),
    )

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'checkpointed', runId, state: 'scanning' },
    )
  })

  it('checkpoints a provider-unavailable page scan', async () => {
    const deps = makeDeps()
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
      Object.assign(new Error('503 from provider'), {
        _tag: 'GoogleReviewApiError' as const,
        code: 'provider_unavailable' as const,
        recoverable: true,
      }),
    )

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'checkpointed', runId, state: 'scanning' },
    )
    expect(deps.repository.failRun).not.toHaveBeenCalled()
  })

  it('still fails terminally when the page scan hits a non-recoverable code', async () => {
    const deps = makeDeps()
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
      Object.assign(new Error('403 from provider'), {
        _tag: 'GoogleReviewApiError' as const,
        code: 'authorization_changed' as const,
        recoverable: false,
      }),
    )

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'failed', runId, code: 'authorization_changed' },
    )
    expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalledWith(
      expect.objectContaining({ runId }),
    )
    expect(deps.repository.failRun).toHaveBeenCalledWith({
      runId,
      organizationId,
      code: 'authorization_changed',
    })
  })

  // Google answered that the Location or the request is not valid (404, 400):
  // every retry gets the same answer, so the run ends and the next poll starts
  // a fresh one instead of the continuation looping until the run expires.
  it('ends the run when Google rejected the page request', async () => {
    const deps = makeDeps()
    const error = Object.assign(new Error('404 from provider'), {
      _tag: 'GoogleReviewApiError' as const,
      code: 'provider_rejected' as const,
      recoverable: false,
    })
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(error)

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'failed', runId, code: 'provider_failure' },
    )
    expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalledWith(
      expect.objectContaining({ runId }),
    )
    expect(deps.repository.commitPage).not.toHaveBeenCalled()
  })

  it('ends the confirmation when Google rejected the review request', async () => {
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
    vi.mocked(deps.googleReviewApi.getReview).mockRejectedValue(
      Object.assign(new Error('400 from provider'), {
        _tag: 'GoogleReviewApiError' as const,
        code: 'provider_rejected' as const,
        recoverable: false,
      }),
    )

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'failed', runId, code: 'provider_failure' },
    )
    expect(deps.repository.confirmLinkedCandidateMissing).not.toHaveBeenCalled()
  })

  it.each(['authorization_denied', 'runtime_unavailable', 'stale_source'] as const)(
    'preserves the Review sync authorization cause %s',
    async (code) => {
      const deps = makeDeps()
      vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
        Object.assign(new Error(code), { code }),
      )

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({
        status: 'failed',
        runId,
        code,
      })
      expect(deps.logger.error).not.toHaveBeenCalled()
    },
  )

  it('logs a code-less provider failure with its bounded execution identity', async () => {
    const deps = makeDeps()
    const error = new Error('uncoded provider failure')
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(error)

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      {
        status: 'failed',
        runId,
        code: 'provider_failure',
      },
    )
    // runId only: BQC-7.3 bans tenant identifiers from logger call-sites, and
    // the run row resolves the property for whoever reads the log.
    expect(deps.logger.error).toHaveBeenCalledWith(
      { err: error, runId },
      'review snapshot failed without a coded cause',
    )
  })

  // The cursor store is ephemeral by design (ADR 0050): a deploy that restarts
  // it drops every published page cursor. A run caught mid-scan then finds its
  // next cursor gone. That is a lost run to start again, not a broken one.
  describe('when the page cursor is gone from the store', () => {
    const RUN_STARTED_AT = new Date('2026-08-21T11:50:00.000Z')
    const cursorNotFound = (cursorStoreStartedAtMs?: number) =>
      Object.assign(new Error('Google review API request failed'), {
        _tag: 'GoogleReviewApiError' as const,
        code: 'cursor_not_found' as const,
        recoverable: false,
        ...(cursorStoreStartedAtMs === undefined ? {} : { cursorStoreStartedAtMs }),
      })
    const midScan = () =>
      makeDeps({
        currentRun: run({
          startedAt: RUN_STARTED_AT,
          mainPageIndex: 44,
          mainCursorRef: 'v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        }),
      })

    it('ends the run as cursor_lost when the store restarted after the run began', async () => {
      const deps = midScan()
      vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
        cursorNotFound(RUN_STARTED_AT.getTime() + 5 * 60_000),
      )

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'cursor_lost' })
      expect(deps.repository.failRun).toHaveBeenCalledWith({
        runId,
        organizationId,
        code: 'cursor_lost',
      })
      expect(deps.repository.commitPage).not.toHaveBeenCalled()
      // Expected after every deploy: a warning with the execution identity,
      // never an error.
      expect(deps.logger.warn).toHaveBeenCalledWith(
        {
          event: 'review_snapshot_cursor_lost',
          runId,
          phase: 'main',
          pageIndex: 44,
        },
        'Review snapshot lost its page cursor to a cursor store restart',
      )
      expect(deps.logger.error).not.toHaveBeenCalled()
    })

    // No restart since the run began, yet the cursor is gone: something
    // dropped it, and that must stay as loud as it was.
    it('stays cursor_failure when the store has been up since before the run began', async () => {
      const deps = midScan()
      vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
        cursorNotFound(RUN_STARTED_AT.getTime() - 60 * 60_000),
      )

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'cursor_failure' })
      expect(deps.logger.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'review_snapshot_cursor_lost' }),
        expect.anything(),
      )
    })

    it('stays cursor_failure when the store could not say when it started', async () => {
      const deps = midScan()
      vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(cursorNotFound())

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'cursor_failure' })
    })
  })

  // A guest who posts while a run is between its main and its confirmation
  // listing changes the set the confirmation must find again. The store
  // records such a run as `listing_changed`, and as `confirmation_set_changed`
  // only once the Property's runs keep changing (snapshot-listing-change.ts).
  describe('when the listing changed between the two scans', () => {
    const NEXT_CURSOR = 'v1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    const counts = {
      expectedProviderTotal: 3_714,
      expectedProviderAverageRating: 4.5,
      mainPageIndex: 75,
      mainUniqueCount: 3_713,
      confirmationUniqueCount: 2_000,
    } as const
    const confirming = run({
      ...counts,
      state: 'confirming',
      phase: 'confirmation',
      confirmationDeadline: new Date('2026-08-16T12:00:00.000Z'),
      confirmationPageIndex: 40,
      confirmationCursorRef: 'v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    })
    const endedAs = (code: 'listing_changed' | 'confirmation_set_changed') =>
      run({ ...counts, state: 'failed', phase: 'terminal', failureCode: code })
    const confirmationPage = (nextCursorRef: string | null) =>
      makeDeps({
        currentRun: confirming,
        page: {
          reviews: [review],
          totalReviewCount: 3_714,
          averageRating: 4.5,
          nextCursorRef,
        },
      })
    /** The store answers with the code it recorded, whatever the step asked. */
    const recordedAs = (
      deps: RunReviewProviderSnapshotDeps,
      code: 'listing_changed' | 'confirmation_set_changed',
    ) => {
      vi.mocked(deps.repository.failRun).mockResolvedValue(endedAs(code))
      vi.mocked(deps.repository.commitPage).mockResolvedValue({
        status: 'failed',
        run: endedAs(code),
        code,
      })
    }
    const LISTING_CHANGED_LOG = {
      event: 'review_snapshot_listing_changed',
      expected: 3_714,
      listed: 3_713,
      confirmed: 2_000,
    }

    it('ends the run as listing_changed, warns with counts only and removes nothing', async () => {
      const deps = confirmationPage(NEXT_CURSOR)
      recordedAs(deps, 'listing_changed')

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'listing_changed' })

      expect(deps.logger.warn).toHaveBeenCalledTimes(1)
      expect(deps.logger.warn).toHaveBeenCalledWith(
        LISTING_CHANGED_LOG,
        expect.any(String),
      )
      expect(deps.logger.error).not.toHaveBeenCalled()
      expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalledWith(
        expect.objectContaining({ runId }),
      )
      expect(deps.repository.finishConfirmationScan).not.toHaveBeenCalled()
      expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
    })

    it('stays confirmation_set_changed, with no warning, when the store found it repeating', async () => {
      const deps = confirmationPage(NEXT_CURSOR)
      recordedAs(deps, 'confirmation_set_changed')

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'confirmation_set_changed' })

      expect(deps.logger.warn).not.toHaveBeenCalled()
      expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
    })

    // The last confirmation page commits; the counts that disagree are found
    // when the confirmation scan is finished.
    it('answers with the code the store recorded when it finishes the confirmation', async () => {
      const deps = confirmationPage(null)
      vi.mocked(deps.repository.finishConfirmationScan).mockResolvedValue({
        status: 'failed',
        run: endedAs('listing_changed'),
        code: 'listing_changed',
      })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'listing_changed' })

      expect(deps.logger.warn).toHaveBeenCalledWith(
        LISTING_CHANGED_LOG,
        expect.any(String),
      )
      expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
    })

    // A review this run had found missing is on Google after all.
    it('ends the run the store failed on a removal candidate found again', async () => {
      const deps = makeDeps({ currentRun: confirming })
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
      recordedAs(deps, 'listing_changed')

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'listing_changed' })

      expect(deps.logger.warn).toHaveBeenCalledTimes(1)
      expect(deps.repository.confirmLinkedCandidateMissing).not.toHaveBeenCalled()
      expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
    })

    it('answers a later step of that run with its code and applies nothing', async () => {
      const deps = makeDeps({ currentRun: endedAs('listing_changed') })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'listing_changed' })

      expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
      expect(deps.googleReviewApi.listReviewsPage).not.toHaveBeenCalled()
      expect(deps.logger.warn).not.toHaveBeenCalled()
    })
  })

  // A guest who posts while the main scan is between two pages moves Google's
  // total (3,716 then 3,717 on the largest beta location, 2026-10-20). The
  // store records the failure as `listing_changed` unless the Property's runs
  // keep changing (snapshot-listing-change.ts), and the use case answers with
  // whatever the store recorded.
  describe("when Google's listing moved while the main scan was reading it", () => {
    const NEXT_CURSOR = 'v1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    const counts = {
      expectedProviderTotal: 3_716,
      expectedProviderAverageRating: 4.5,
      mainPageIndex: 6,
      mainUniqueCount: 300,
    } as const
    const scanning = run({
      ...counts,
      mainCursorRef: 'v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    })
    const endedAs = (code: 'listing_changed' | 'total_changed' | 'average_changed') =>
      run({ ...counts, state: 'failed', phase: 'terminal', failureCode: code })
    /** Page 7 of the scan, with Google's total one review higher than before. */
    const pageSeven = () =>
      makeDeps({
        currentRun: scanning,
        page: {
          reviews: [review],
          totalReviewCount: 3_717,
          averageRating: 4.5,
          nextCursorRef: NEXT_CURSOR,
        },
      })
    /** The store answers with the code it recorded, whatever the step asked. */
    const recordedAs = (
      deps: RunReviewProviderSnapshotDeps,
      code: 'listing_changed' | 'total_changed' | 'average_changed',
    ) => {
      vi.mocked(deps.repository.failRun).mockResolvedValue(endedAs(code))
      vi.mocked(deps.repository.commitPage).mockResolvedValue({
        status: 'failed',
        run: endedAs(code),
        code,
      })
    }
    const LISTING_CHANGED_LOG = {
      event: 'review_snapshot_listing_changed',
      expected: 3_716,
      listed: 300,
      confirmed: 0,
    }

    it('ends the run as listing_changed, warns with counts only and removes nothing', async () => {
      const deps = pageSeven()
      recordedAs(deps, 'listing_changed')

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'listing_changed' })

      expect(deps.repository.commitPage).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'main', totalReviewCount: 3_717 }),
      )
      expect(deps.logger.warn).toHaveBeenCalledTimes(1)
      expect(deps.logger.warn).toHaveBeenCalledWith(
        LISTING_CHANGED_LOG,
        expect.any(String),
      )
      expect(deps.logger.error).not.toHaveBeenCalled()
      expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalledWith(
        expect.objectContaining({ runId }),
      )
      // It never got as far as listing a second time or applying anything.
      expect(deps.repository.finishMainScan).not.toHaveBeenCalled()
      expect(deps.repository.beginConfirmationScan).not.toHaveBeenCalled()
      expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
    })

    it.each(['total_changed', 'average_changed'] as const)(
      'stays %s, with no warning, when the store found the changes repeating',
      async (code) => {
        const deps = pageSeven()
        recordedAs(deps, code)

        await expect(
          runReviewProviderSnapshot(deps)({ ...request, runId }),
        ).resolves.toEqual({ status: 'failed', runId, code })

        expect(deps.logger.warn).not.toHaveBeenCalled()
        expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
      },
    )

    it('answers a later step of that run with its code and lists nothing more', async () => {
      const deps = makeDeps({ currentRun: endedAs('listing_changed') })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'listing_changed' })

      expect(deps.googleReviewApi.listReviewsPage).not.toHaveBeenCalled()
      expect(deps.repository.commitPage).not.toHaveBeenCalled()
      expect(deps.logger.warn).not.toHaveBeenCalled()
    })

    // The same review twice on ONE page is not the listing moving between
    // pages: Google's page is broken, and the run asks for `duplicate_resource`
    // outright (the store keeps it loud, review-provider-snapshot-listing-change).
    it('still asks for duplicate_resource when one page lists a review twice', async () => {
      const deps = makeDeps({
        currentRun: scanning,
        page: {
          reviews: [review, review],
          totalReviewCount: 3_716,
          averageRating: 4.5,
          nextCursorRef: NEXT_CURSOR,
        },
      })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'duplicate_resource' })

      expect(deps.repository.failRun).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'duplicate_resource' }),
      )
      expect(deps.repository.commitPage).not.toHaveBeenCalled()
      expect(deps.logger.warn).not.toHaveBeenCalled()
    })
  })

  it('applies only the fixed 100-row deletion batch and resumes until complete', async () => {
    const deps = makeDeps({ currentRun: run({ state: 'deleting', phase: 'apply' }) })
    vi.mocked(deps.repository.applyDeletionBatch).mockResolvedValue({
      run: run({ state: 'deleting', phase: 'apply' }),
      applied: 100,
      observed: 0,
      done: false,
    })

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'deleting', runId, applied: 100 },
    )
    expect(deps.repository.applyDeletionBatch).toHaveBeenCalledWith({ runId, limit: 100 })
  })

  describe("when Google's total and its list differ by a small amount", () => {
    const completedWith = (
      listing: Readonly<{ expected: number; unique: number; pages: number }>,
    ) => {
      const deps = makeDeps({ currentRun: run({ state: 'deleting', phase: 'apply' }) })
      vi.mocked(deps.repository.applyDeletionBatch).mockResolvedValue({
        run: run({
          state: 'completed',
          phase: 'terminal',
          expectedProviderTotal: listing.expected,
          expectedProviderAverageRating: 4.5,
          mainUniqueCount: listing.unique,
          mainPageIndex: listing.pages,
        }),
        applied: 0,
        observed: 0,
        done: true,
      })
      return deps
    }

    it('completes the run and logs the gap as counts only', async () => {
      const deps = completedWith({ expected: 82, unique: 81, pages: 2 })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'completed', runId })

      expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalledTimes(1)
      expect(deps.logger.warn).toHaveBeenCalledTimes(1)
      expect(deps.logger.warn).toHaveBeenCalledWith(
        {
          event: 'review_snapshot_completed_with_count_gap',
          expected: 82,
          unique: 81,
          gap: 1,
        },
        expect.any(String),
      )
    })

    it('logs a list longer than the total the same way', async () => {
      const deps = completedWith({ expected: 19, unique: 20, pages: 1 })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'completed', runId })

      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ expected: 19, unique: 20, gap: 1 }),
        expect.any(String),
      )
    })

    it('logs a gap of two the same way (86 counted, 84 listed)', async () => {
      const deps = completedWith({ expected: 86, unique: 84, pages: 2 })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'completed', runId })

      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ expected: 86, unique: 84, gap: 2 }),
        expect.any(String),
      )
    })

    it('logs nothing when the list matches the total', async () => {
      const deps = completedWith({ expected: 81, unique: 81, pages: 2 })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'completed', runId })

      expect(deps.logger.warn).not.toHaveBeenCalled()
    })

    it('fails the run and discards its cursors when the store refuses the gap', async () => {
      const deps = makeDeps()
      vi.mocked(deps.repository.finishMainScan).mockResolvedValue({
        status: 'failed',
        run: run({ state: 'failed', phase: 'terminal', failureCode: 'set_mismatch' }),
        code: 'set_mismatch',
      })

      await expect(runReviewProviderSnapshot(deps)(request)).resolves.toEqual({
        status: 'failed',
        runId,
        code: 'set_mismatch',
      })
      expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalledTimes(1)
      expect(deps.logger.warn).not.toHaveBeenCalled()
    })
  })
})
