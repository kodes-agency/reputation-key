// Shared harness for the persist-mode head check suites.
import { vi } from 'vitest'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import type {
  GoogleReviewHeadResult,
  GoogleReviewRead,
} from './google-review-api.port.server'
import type {
  ReviewHeadCheckRepository,
  ReviewHeadPersistState,
} from './review-head-check-repository.port.server'
import type { ReviewProviderObservationWriter } from './sync-reviews.port.server'
import type { ReviewProviderSubjectSightings } from './review-provider-subject-link.port.server'
import type { HeadStoredCopy } from '../domain/head-check'
import { createRunReviewHeadCheck } from './run-review-head-check.server'

export const ORG = organizationId('org-head-persist')
export const PROPERTY = propertyId('3f1c1d5e-0000-4000-8000-000000000001')
export const CONNECTION = googleConnectionId('3f1c1d5e-0000-4000-8000-000000000002')
export const LOCATION = GOOGLE_LOCATION_PRIMARY_RESOURCE
export const EPOCH = 4
export const T0 = new Date('2026-10-21T12:00:00.000Z')
export const DAY_MS = 24 * 60 * 60 * 1000
export const FACT_ID = '3f1c1d5e-0000-4000-8000-0000000000f1'
export const GENERATION = 41

export const input = {
  organizationId: ORG,
  propertyId: PROPERTY,
  connectionId: CONNECTION,
  sourceEpoch: EPOCH,
  locationName: LOCATION,
  mode: 'persist',
} as const

export const googleReview = (
  id: string,
  over: Partial<GoogleReviewRead> = {},
): GoogleReviewRead => ({
  reviewName: `${LOCATION}/reviews/${id}`,
  externalId: id,
  externalLocationId: LOCATION,
  reviewerName: 'Canary Reviewer Name',
  reviewerProfilePhotoUrl: null,
  googleReviewUrl: null,
  rating: 5,
  text: 'Canary review text',
  translatedText: null,
  languageCode: null,
  reviewedAt: new Date(T0.getTime() - 3 * DAY_MS),
  sourceCreatedAt: new Date(T0.getTime() - 3 * DAY_MS),
  sourceUpdatedAt: new Date(T0.getTime() - 2 * DAY_MS),
  replyText: null,
  replyUpdatedAt: null,
  ...over,
})

export const storedCopy = (
  id: string,
  over: Partial<HeadStoredCopy> = {},
): HeadStoredCopy => ({
  externalId: id,
  sourceEpoch: EPOCH,
  sourceUpdatedAt: new Date(T0.getTime() - 2 * DAY_MS),
  lastFetchedAt: new Date(T0.getTime() - 1 * DAY_MS),
  reply: null,
  ...over,
})

export const okHead = (
  reviews: readonly GoogleReviewRead[],
  over: Partial<Extract<GoogleReviewHeadResult, { status: 'ok' }>> = {},
): GoogleReviewHeadResult => ({
  status: 'ok',
  reviews,
  totalReviewCount: reviews.length,
  averageRating: reviews.length === 0 ? null : 5,
  hasMore: false,
  ...over,
})

export const readyState: ReviewHeadPersistState = {
  hasCompletedListing: true,
  snapshotActive: false,
  newestFact: {
    reviewCount: 2,
    averageRating: 5,
    observedAt: new Date(T0.getTime() - 3_600_000),
  },
}

export const copiesFor = (
  prefix: string,
  count: number,
  over: Partial<HeadStoredCopy> = {},
) => Array.from({ length: count }, (_, index) => storedCopy(`${prefix}-${index}`, over))

export type Options = Readonly<{
  head?: GoogleReviewHeadResult
  /** Answers of successive reads; a read past the end is a failure. An Error rejects. */
  heads?: readonly (GoogleReviewHeadResult | Error)[]
  copies?: readonly HeadStoredCopy[]
  state?: ReviewHeadPersistState | Error
  /** What the second read of the state (just before the fact) answers. */
  stateAtFact?: ReviewHeadPersistState | Error
  currentEpoch?: number | null
  failPersistFor?: ReadonlySet<string>
  newReviewIds?: ReadonlySet<string>
  generation?: number | Error
  recordHeadFact?: Error
  stampActivity?: Error
  mode?: 'dark' | 'persist'
  withoutPersistDeps?: boolean
  coverWrite?: Error
}>

export function setup(options: Options = {}) {
  const order: string[] = []
  let reads = 0
  let headReads = 0
  const readReviewsHead = vi.fn(async (_request: unknown) => {
    order.push('read')
    if (options.heads !== undefined) {
      const answer = options.heads[headReads++]
      if (answer === undefined || answer instanceof Error) {
        throw answer ?? new Error('no further page')
      }
      return answer
    }
    return (
      options.head ??
      okHead([googleReview('r-1'), googleReview('r-2')], {
        totalReviewCount: 2,
        averageRating: 5,
      })
    )
  })
  const repository = {
    hasOutstandingFailure: vi.fn(async () => false),
    readBaseline: vi.fn(async () => ({
      copies: options.copies ?? [storedCopy('r-1'), storedCopy('r-2')],
      storedLiveCount: 2,
      storedAverageRating: 5,
    })),
    readPersistState: vi.fn(async () => {
      if (options.state instanceof Error) throw options.state
      reads++
      if (reads > 1 && options.stateAtFact) {
        if (options.stateAtFact instanceof Error) throw options.stateAtFact
        return options.stateAtFact
      }
      return options.state ?? readyState
    }),
    recordHeadFact: vi.fn(async () => {
      order.push('fact')
      if (options.recordHeadFact) throw options.recordHeadFact
    }),
    recordRun: vi.fn(async () => undefined),
    recordHeadCoverage: vi.fn(async () => {
      if (options.coverWrite) throw options.coverWrite
    }),
    requestFullRead: vi.fn(async () => {
      if (options.coverWrite) throw options.coverWrite
    }),
    recordCountDrop: vi.fn(async ({ seenAt }: { seenAt: Date }) => seenAt),
    clearCountDrop: vi.fn(async () => undefined),
  } satisfies ReviewHeadCheckRepository
  const persist = vi.fn(
    async (call: Parameters<ReviewProviderObservationWriter['persist']>[0]) => {
      order.push(`persist:${call.review.externalId}`)
      if (options.failPersistFor?.has(call.review.externalId)) {
        throw new Error('db down CANARY')
      }
      return {
        reviewId: `id-${call.review.externalId}` as never,
        sourceRevision: 1,
        isNew: options.newReviewIds?.has(call.review.externalId) ?? false,
      }
    },
  )
  const allocateReplyReadGeneration = vi.fn(async () => {
    order.push('allocate')
    if (options.generation instanceof Error) throw options.generation
    return options.generation ?? GENERATION
  })
  const recordNewReviewObserved = vi.fn(async () => {
    if (options.stampActivity) throw options.stampActivity
  })
  const deriveCandidates = vi.fn(() => [
    { keyVersion: 'v1', locatorHmac: 'h'.repeat(64) },
  ])
  const recordSighting = vi.fn<ReviewProviderSubjectSightings['record']>(async () => {
    order.push('sighting')
    return 'linked'
  })
  const logger = { info: vi.fn(), warn: vi.fn() }
  let tick = 0
  const clock = vi.fn(() => new Date(T0.getTime() + 100 * tick++))
  const run = createRunReviewHeadCheck({
    googleReviewApi: { readReviewsHead },
    repository,
    logger,
    clock,
    ...(options.withoutPersistDeps
      ? {}
      : {
          persist: {
            observationWriter: { allocateReplyReadGeneration, persist },
            subjectKeyService: {
              acquireDeriver: async () => ({ deriveCandidates }),
            } as never,
            subjectSightings: { record: recordSighting },
            propertySourceEpoch: {
              getSourceEpoch: async () =>
                options.currentEpoch === null
                  ? null
                  : { sourceEpoch: options.currentEpoch ?? EPOCH },
            },
            syncActivity: { recordNewReviewObserved },
            newId: () => FACT_ID,
          },
        }),
  })
  return {
    run: () => run({ ...input, mode: options.mode ?? 'persist' }),
    order,
    repository,
    persist,
    allocateReplyReadGeneration,
    recordNewReviewObserved,
    recordSighting,
    logger,
    readReviewsHead,
  }
}
