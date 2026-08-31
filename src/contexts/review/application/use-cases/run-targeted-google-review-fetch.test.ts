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
import type { ReviewProviderObservationWriter } from '../ports/review-provider-snapshot.repository'
import type { ReviewProviderSubjectKeyService } from '../provider-subject-keyring'
import type { TargetedGoogleReviewReferenceResolver } from '../ports/targeted-google-review-reference.port'
import { runTargetedGoogleReviewFetch } from './run-targeted-google-review-fetch'

const organizationId = 'org-targeted-review' as OrganizationId
const propertyId = '00000000-0000-4000-8000-000000000011' as PropertyId
const connectionId = '00000000-0000-4000-8000-000000000012' as GoogleConnectionId
const reviewId = '00000000-0000-4000-8000-000000000013' as ReviewId
const deliveryId = '00000000-0000-4000-8000-000000000014'

const review: GoogleReview = {
  reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
  externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
  externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  reviewerName: 'Synthetic Reviewer',
  reviewerProfilePhotoUrl: null,
  rating: 4,
  text: 'Synthetic review body',
  translatedText: null,
  languageCode: 'en',
  reviewedAt: new Date('2026-08-27T07:00:00.000Z'),
  sourceUpdatedAt: new Date('2026-08-27T07:30:00.000Z'),
  replyText: null,
  replyUpdatedAt: null,
}

function setup(
  input: Readonly<{
    resolution?:
      | Readonly<{
          status: 'found'
          locationName: string
          reviewName: string
        }>
      | Readonly<{
          status: 'reconcile'
          locationName: string
          reason: 'reference_expired'
        }>
      | Readonly<{ status: 'obsolete' }>
    getResult?: Awaited<ReturnType<GoogleReviewApiPort['getReview']>>
    scopes?: readonly (Readonly<{
      processingRegion: string
      sourceEpoch: number
    }> | null)[]
    isNew?: boolean
  }> = {},
) {
  const scopes = [
    ...(input.scopes ?? [
      { processingRegion: 'us', sourceEpoch: 6 },
      { processingRegion: 'us', sourceEpoch: 6 },
    ]),
  ]
  const getReview = vi.fn(
    async () => input.getResult ?? ({ status: 'found', review } as const),
  )
  const googleReviewApi: GoogleReviewApiPort = {
    getReview,
    listReviewsPage: vi.fn(),
    discardReviewCursors: vi.fn(),
    replyToReview: vi.fn(),
  }
  const persist = vi.fn(async () => ({
    reviewId,
    sourceRevision: 3,
    isNew: input.isNew ?? true,
  }))
  const observationWriter: ReviewProviderObservationWriter = {
    allocateReplyReadGeneration: vi.fn(async () => 19),
    persist,
  }
  const subjectKeyService: ReviewProviderSubjectKeyService = {
    acquireDeriver: vi.fn(async () => ({
      activeVersion: 'v1',
      retiringVersion: null,
      inventoryGeneration: 1,
      deriveCandidates: () =>
        [
          {
            contractVersion: 'review-provider-subject-v1' as const,
            keyVersion: 'v1',
            locatorHmac: new Uint8Array(32),
            verifierHmac: new Uint8Array(32),
          },
        ] as const,
    })),
    stageTrustedNext: vi.fn(),
    activateTrustedNext: vi.fn(),
    removeRetiring: vi.fn(),
  }
  const syncActivity = {
    recordNewReviewObserved: vi.fn(async () => undefined),
    recordPushObserved: vi.fn(async () => undefined),
  }
  const useCase = runTargetedGoogleReviewFetch({
    references: {
      resolve: vi.fn<TargetedGoogleReviewReferenceResolver['resolve']>(async () =>
        Promise.resolve(
          input.resolution ?? {
            status: 'found' as const,
            locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
            reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
          },
        ),
      ),
    },
    googleReviewApi,
    propertyRouting: {
      getProcessingScope: vi.fn(async () => scopes.shift() ?? null),
    },
    observationWriter,
    subjectKeyService,
    syncActivity,
    clock: () => new Date('2026-08-27T08:00:00.000Z'),
  })
  return { useCase, getReview, observationWriter, persist, syncActivity }
}

const request = {
  organizationId,
  propertyId,
  connectionId,
  sourceEpoch: 6,
  referenceRef: `v1.${Buffer.alloc(32, 6).toString('base64url')}`,
  deliveryId,
}

describe('runTargetedGoogleReviewFetch', () => {
  it('re-enters the governed getReview adapter then persists one revision-aware observation', async () => {
    const { useCase, getReview, observationWriter, persist, syncActivity } = setup()

    await expect(useCase(request)).resolves.toEqual({
      status: 'persisted',
      reviewId,
      sourceRevision: 3,
      isNew: true,
    })
    expect(getReview).toHaveBeenCalledWith({
      organizationId,
      propertyId,
      connectionId,
      sourceEpoch: 6,
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    })
    expect(getReview.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(observationWriter.allocateReplyReadGeneration).mock
        .invocationCallOrder[0]!,
    )
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        propertyId,
        connectionId,
        sourceEpoch: 6,
        observationOrigin: 'ongoing',
        replyReadGeneration: 19,
        review,
      }),
    )
    expect(syncActivity.recordNewReviewObserved).toHaveBeenCalledTimes(1)
  })

  it('requests a full property reconciliation when the opaque target expired', async () => {
    const { useCase, getReview, persist } = setup({
      resolution: {
        status: 'reconcile',
        locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
        reason: 'reference_expired',
      },
    })
    await expect(useCase(request)).resolves.toEqual({
      status: 'reconcile',
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      reason: 'reference_expired',
    })
    expect(getReview).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })

  it('uses full reconciliation instead of declaring deletion from a targeted 404', async () => {
    const { useCase, persist } = setup({ getResult: { status: 'not_found' } })
    await expect(useCase(request)).resolves.toEqual({
      status: 'reconcile',
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      reason: 'target_not_found',
    })
    expect(persist).not.toHaveBeenCalled()
  })

  it('drops an obsolete event before provider I/O', async () => {
    const { useCase, getReview } = setup({ resolution: { status: 'obsolete' } })
    await expect(useCase(request)).resolves.toEqual({ status: 'obsolete' })
    expect(getReview).not.toHaveBeenCalled()
  })

  it('rechecks the source epoch after provider I/O and before persistence', async () => {
    const { useCase, persist } = setup({
      scopes: [
        { processingRegion: 'us', sourceEpoch: 6 },
        { processingRegion: 'us', sourceEpoch: 7 },
      ],
    })
    await expect(useCase(request)).resolves.toEqual({ status: 'obsolete' })
    expect(persist).not.toHaveBeenCalled()
  })
})
