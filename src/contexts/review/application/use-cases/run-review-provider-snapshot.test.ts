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
import type {
  ReviewProviderObservationWriter,
  ReviewProviderSnapshotRepository,
  ReviewProviderSnapshotRun,
} from '../ports/review-provider-snapshot.repository'
import type { ReviewProviderSubjectKeyService } from '../provider-subject-keyring'
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
  state: 'scanning',
  phase: 'main',
  startedAt: new Date('2026-08-16T00:00:00.000Z'),
  expectedProviderTotal: null,
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
      nextCursorRef: string | null
    }>
    /** Drives the observation writer's new-vs-seen answer. */
    observationIsNew?: boolean
  }> = {},
): RunReviewProviderSnapshotDeps {
  const currentRun = input.currentRun ?? run()
  const repository: ReviewProviderSnapshotRepository = {
    readExpiredActiveRun: vi.fn(async () => null),
    startOrResume: vi.fn(async () => currentRun),
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
        input.page ?? { reviews: [review], totalReviewCount: 1, nextCursorRef: null },
    ),
    getReview: vi.fn(async () => ({ status: 'not_found' as const })),
    discardReviewCursors: vi.fn(async () => undefined),
    replyToReview: vi.fn(async () => undefined),
  }
  const observationWriter: ReviewProviderObservationWriter = {
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
    propertyRouting: {
      getProcessingScope: vi.fn(async () => ({
        processingRegion: 'global',
        sourceEpoch: 1,
      })),
    },
    syncActivity: {
      recordNewReviewObserved: vi.fn(async () => undefined),
      recordPushObserved: vi.fn(async () => undefined),
    },
    clock: () => NOW,
  }
}

const request = {
  organizationId,
  propertyId,
  connectionId,
  sourceEpoch: 1,
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
    expect(deps.observationWriter.persist).toHaveBeenCalledTimes(1)
    expect(deps.repository.commitPage).toHaveBeenCalledWith(
      expect.objectContaining({ expectedPageIndex: 0, observations: expect.any(Array) }),
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
      page: { reviews: [review, review], totalReviewCount: 2, nextCursorRef: null },
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

  it('does not call the provider or delete when the source epoch changed', async () => {
    const deps = makeDeps()
    vi.mocked(deps.propertyRouting.getProcessingScope).mockResolvedValue({
      processingRegion: 'global',
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
    expect(deps.repository.confirmLinkedCandidateMissing).not.toHaveBeenCalled()
    expect(deps.repository.failRun).not.toHaveBeenCalled()
    expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
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
})
