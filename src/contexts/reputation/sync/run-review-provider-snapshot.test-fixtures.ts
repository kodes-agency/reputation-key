import { vi } from 'vitest'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '#/shared/testing/google-provider-identifiers-v1'
import type {
  GoogleConnectionId,
  OrganizationId,
  PropertyId,
  ReviewId,
} from '#/shared/domain/ids'
import type { GoogleReview } from '../domain/review-types'
import type { GoogleReviewApiPort } from './google-review-api.port.server'
import type { ReviewProviderObservationWriter } from './sync-reviews.port.server'
import type {
  ReviewProviderSnapshotRepository,
  ReviewProviderSnapshotRun,
} from './review-provider-snapshot-repository.port.server'
import type { ReviewProviderSubjectKeyService } from './provider-subject-keyring.server'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { RunReviewProviderSnapshotDeps } from './run-review-provider-snapshot.server'

export const organizationId = '00000000-0000-4000-8000-000000000001' as OrganizationId
export const propertyId = '00000000-0000-4000-8000-000000000002' as PropertyId
export const connectionId = '00000000-0000-4000-8000-000000000003' as GoogleConnectionId
export const reviewId = '00000000-0000-4000-8000-000000000004' as ReviewId
export const runId = '00000000-0000-4000-8000-000000000005'
export const NOW = new Date('2026-08-21T12:00:00.000Z')

export const review: GoogleReview = {
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

export const run = (
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

export function makeDeps(
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
    readReviewsHead: vi.fn(),
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

export function testLogger(): LoggerPort {
  const logger: LoggerPort = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logger,
  }
  return logger
}

export const request = {
  organizationId,
  propertyId,
  connectionId,
  sourceEpoch: 1,
  observationOrigin: 'ongoing' as const,
  firstSeenVia: 'snapshot' as const,
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
}
