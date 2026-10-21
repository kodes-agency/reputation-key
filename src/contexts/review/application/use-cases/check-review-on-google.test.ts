import { describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'
import type { Review } from '../../domain/types'
import {
  GOOGLE_REVIEW_API_NOT_CONFIGURED_CODE,
  type GoogleReviewApiPort,
  type GoogleReviewRead,
} from '../ports/google-review-api.port'
import type { PropertyGoogleReadBindingPort } from '../ports/property-google-read-binding.port'
import type { ReviewProviderObservationWriter } from '../ports/review-provider-observation-writer.port'
import type { ReviewProviderSubjectKeyService } from '../provider-subject-keyring'
import { checkReviewOnGoogle } from './check-review-on-google'

const ORG = organizationId('org-check-review')
const PROPERTY = propertyId('00000000-0000-4000-8000-0000000000a1')
const CONNECTION = googleConnectionId('00000000-0000-4000-8000-0000000000a2')
const STALE_CONNECTION = googleConnectionId('00000000-0000-4000-8000-0000000000a3')
const REVIEW = reviewId('00000000-0000-4000-8000-0000000000a4')
const NOW = new Date('2026-09-02T08:00:00.000Z')
const EPOCH = 6

const storedReview = (overrides: Partial<Review> = {}): Review => ({
  id: REVIEW,
  organizationId: ORG,
  propertyId: PROPERTY,
  platform: 'google',
  externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
  externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  // A connection and epoch the Property has since moved past.
  googleConnectionId: STALE_CONNECTION,
  reviewerName: 'Synthetic Reviewer',
  reviewerProfilePhotoUrl: null,
  googleReviewUrl: null,
  rating: 4,
  text: 'Synthetic review body',
  translatedText: null,
  languageCode: 'en',
  reviewedAt: new Date('2026-08-27T07:00:00.000Z'),
  expiresAt: new Date('2027-08-27T07:00:00.000Z'),
  sentimentLabel: null,
  sentimentScore: null,
  sourceCreatedAt: null,
  sourceUpdatedAt: null,
  firstFetchedAt: null,
  lastFetchedAt: new Date('2026-08-27T07:30:00.000Z'),
  contentExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
  contentHash: null,
  sourceSeenGeneration: null,
  sourceEpoch: 2,
  sourceRevision: 3,
  analysisSequence: 1,
  aiSourceByteLength: 1,
  aiSourceDigest: '0'.repeat(64),
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
})

const googleReview = (overrides: Partial<GoogleReviewRead> = {}): GoogleReviewRead => ({
  reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
  externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
  externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  reviewerName: 'Synthetic Reviewer',
  reviewerProfilePhotoUrl: null,
  googleReviewUrl: null,
  rating: 4,
  text: 'Synthetic review body',
  translatedText: null,
  languageCode: 'en',
  reviewedAt: new Date('2026-08-27T07:00:00.000Z'),
  sourceUpdatedAt: null,
  replyText: 'Thank you for staying with us',
  replyUpdatedAt: new Date('2026-09-01T09:00:00.000Z'),
  ...overrides,
})

type Binding = Awaited<ReturnType<PropertyGoogleReadBindingPort['getBinding']>>

function setup(
  input: Readonly<{
    review?: Review | null
    getResult?: Awaited<ReturnType<GoogleReviewApiPort['getReview']>>
    getError?: unknown
    bindings?: ReadonlyArray<Binding>
    enabled?: boolean
    persistError?: Error
  }> = {},
) {
  const bindings = [
    ...(input.bindings ?? [
      { connectionId: CONNECTION, sourceEpoch: EPOCH },
      { connectionId: CONNECTION, sourceEpoch: EPOCH },
    ]),
  ]
  const getReview = vi.fn(async () => {
    if (input.getError !== undefined) throw input.getError
    return input.getResult ?? ({ status: 'found', review: googleReview() } as const)
  })
  const googleReviewApi: Pick<GoogleReviewApiPort, 'getReview'> = { getReview }
  const persist = vi.fn(async () => {
    if (input.persistError) throw input.persistError
    return { reviewId: REVIEW, sourceRevision: 3, isNew: false }
  })
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
  const findById = vi.fn(async () =>
    input.review === undefined ? storedReview() : input.review,
  )
  const isGoogleReadEnabled = vi.fn(() => input.enabled ?? true)
  const nonce = vi.fn(() => '3f8a9d7c-0000-4000-8000-000000000001')
  const warn = vi.fn()
  const check = checkReviewOnGoogle({
    logger: { warn },
    reviewRepo: { findById },
    googleReviewApi,
    propertyBinding: { getBinding: vi.fn(async () => bindings.shift() ?? null) },
    observationWriter,
    subjectKeyService,
    isGoogleReadEnabled,
    newObservationNonce: nonce,
    clock: () => NOW,
  })
  return {
    check,
    getReview,
    persist,
    observationWriter,
    findById,
    isGoogleReadEnabled,
    nonce,
    warn,
  }
}

const request = { organizationId: ORG, propertyId: PROPERTY, reviewId: REVIEW }

describe('checkReviewOnGoogle', () => {
  describe('a successful read', () => {
    it('reads through the governed adapter with the Property current binding, not the values cached on the review', async () => {
      const { check, getReview } = setup()

      await check(request)

      expect(getReview).toHaveBeenCalledWith({
        organizationId: ORG,
        propertyId: PROPERTY,
        connectionId: CONNECTION,
        sourceEpoch: EPOCH,
        locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
        reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
      })
    })

    it('persists one observation through the shared writer, after the read', async () => {
      const { check, getReview, persist, observationWriter } = setup()

      await expect(check(request)).resolves.toEqual({ status: 'read' })

      expect(persist).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG,
          propertyId: PROPERTY,
          connectionId: CONNECTION,
          sourceEpoch: EPOCH,
          observationOrigin: 'ongoing',
          firstSeenVia: 'demand',
          replyReadGeneration: 19,
          review: expect.objectContaining({ replyText: 'Thank you for staying with us' }),
        }),
      )
      expect(getReview.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(observationWriter.allocateReplyReadGeneration).mock
          .invocationCallOrder[0]!,
      )
    })

    it('uses a fresh observation key for every read, never a push delivery id', async () => {
      const first = setup()
      await first.check(request)
      const second = setup()
      second.nonce.mockReturnValue('3f8a9d7c-0000-4000-8000-000000000002')
      await second.check(request)

      const keyOf = (run: typeof first) =>
        (run.persist.mock.calls[0] as unknown as [{ observationKey: string }])[0]
          .observationKey
      expect(keyOf(first)).toMatch(/^[0-9a-f]{64}$/)
      expect(keyOf(first)).not.toBe(keyOf(second))
    })

    it('reports a reply it could not read, and records no reply state for it', async () => {
      const { check, persist } = setup({
        getResult: {
          status: 'found',
          review: googleReview({
            replyText: null,
            replyUpdatedAt: null,
            replyUnreadable: true,
          }),
        },
      })

      await expect(check(request)).resolves.toEqual({ status: 'reply_unreadable' })

      // The writer is the one that skips recording for `replyUnreadable`; the
      // flag must reach it untouched.
      expect(persist).toHaveBeenCalledWith(
        expect.objectContaining({
          review: expect.objectContaining({ replyUnreadable: true }),
        }),
      )
    })

    it('reports a 404 and persists nothing', async () => {
      const { check, persist } = setup({ getResult: { status: 'not_found' } })

      await expect(check(request)).resolves.toEqual({ status: 'review_missing' })
      expect(persist).not.toHaveBeenCalled()
    })
  })

  describe('nothing to read', () => {
    it('does not read a review whose content was erased', async () => {
      const { check, getReview } = setup({ review: null })

      await expect(check(request)).resolves.toEqual({
        status: 'not_checkable',
        reason: 'review_unavailable',
      })
      expect(getReview).not.toHaveBeenCalled()
    })

    it('does not read a review whose content has expired, so it can never be re-hydrated', async () => {
      const { check, getReview, persist } = setup({
        review: storedReview({ contentExpiresAt: NOW }),
      })

      await expect(check(request)).resolves.toEqual({
        status: 'not_checkable',
        reason: 'content_expired',
      })
      expect(getReview).not.toHaveBeenCalled()
      expect(persist).not.toHaveBeenCalled()
    })

    it('reads a review whose content expires a moment from now', async () => {
      const { check, getReview } = setup({
        review: storedReview({ contentExpiresAt: new Date(NOW.getTime() + 1) }),
      })

      await check(request)

      expect(getReview).toHaveBeenCalledTimes(1)
    })

    it('does not read another Property review', async () => {
      const { check, getReview } = setup({
        review: storedReview({
          propertyId: propertyId('00000000-0000-4000-8000-0000000000ff'),
        }),
      })

      await expect(check(request)).resolves.toEqual({
        status: 'not_checkable',
        reason: 'scope_mismatch',
      })
      expect(getReview).not.toHaveBeenCalled()
    })

    it('does not read when google reads are not enabled for the Property', async () => {
      const { check, getReview, findById } = setup({ enabled: false })

      await expect(check(request)).resolves.toEqual({
        status: 'not_checkable',
        reason: 'capability_off',
      })
      expect(getReview).not.toHaveBeenCalled()
      expect(findById).not.toHaveBeenCalled()
    })

    it.each([
      ['a Property that no longer exists', [null]],
      [
        'a Property with no active Google binding',
        [{ connectionId: null, sourceEpoch: 3 }],
      ],
    ] as const)('does not read for %s', async (_name, bindings) => {
      const { check, getReview } = setup({ bindings })

      await expect(check(request)).resolves.toEqual({
        status: 'not_checkable',
        reason: 'property_not_bound',
      })
      expect(getReview).not.toHaveBeenCalled()
    })

    it('does not read a review that has no provider identity left', async () => {
      const { check, getReview } = setup({ review: storedReview({ externalId: '' }) })

      await expect(check(request)).resolves.toEqual({
        status: 'not_checkable',
        reason: 'review_unavailable',
      })
      expect(getReview).not.toHaveBeenCalled()
    })

    it('reports a missing provider as its own reason, without waiting', async () => {
      const { check } = setup({
        getError: Object.assign(new Error('Governed Google review API is unavailable'), {
          code: GOOGLE_REVIEW_API_NOT_CONFIGURED_CODE,
        }),
      })

      await expect(check(request)).resolves.toEqual({
        status: 'not_checkable',
        reason: 'no_provider',
      })
    })
  })

  describe('the source moving', () => {
    it('refuses to persist when the Property epoch changed during the read', async () => {
      const { check, persist } = setup({
        bindings: [
          { connectionId: CONNECTION, sourceEpoch: EPOCH },
          { connectionId: CONNECTION, sourceEpoch: EPOCH + 1 },
        ],
      })

      await expect(check(request)).resolves.toEqual({
        status: 'not_checkable',
        reason: 'source_moved',
      })
      expect(persist).not.toHaveBeenCalled()
    })

    it('refuses to persist when the Property was reconnected to another connection during the read', async () => {
      const { check, persist } = setup({
        bindings: [
          { connectionId: CONNECTION, sourceEpoch: EPOCH },
          { connectionId: STALE_CONNECTION, sourceEpoch: EPOCH },
        ],
      })

      await expect(check(request)).resolves.toEqual({
        status: 'not_checkable',
        reason: 'source_moved',
      })
      expect(persist).not.toHaveBeenCalled()
    })

    it('refuses a provider answer for another location', async () => {
      const { check, persist } = setup({
        getResult: {
          status: 'found',
          review: googleReview({
            reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE.replace(
              'location-0001',
              'location-0002',
            ),
          }),
        },
      })

      await expect(check(request)).resolves.toEqual({
        status: 'unavailable',
        retry: 'never',
      })
      expect(persist).not.toHaveBeenCalled()
    })
  })

  describe('failures never throw', () => {
    const apiError = (code: string) =>
      Object.assign(new Error(code), { _tag: 'GoogleReviewApiError', code })

    it.each(['provider_rate_limited', 'provider_unavailable'] as const)(
      'treats %s as worth another try',
      async (code) => {
        const { check } = setup({ getError: apiError(code) })

        await expect(check(request)).resolves.toEqual({
          status: 'unavailable',
          retry: 'later',
        })
      },
    )

    it.each([
      'authorization_changed',
      'reauthorization_required',
      'provider_rejected',
      'invalid_request',
      'malformed_response',
    ] as const)('treats %s as permanent', async (code) => {
      const { check } = setup({ getError: apiError(code) })

      await expect(check(request)).resolves.toEqual({
        status: 'unavailable',
        retry: 'never',
      })
    })

    it.each(['authorization_denied', 'stale_source', 'capability_killed'] as const)(
      'treats an authorizer refusal (%s) as permanent',
      async (code) => {
        const { check } = setup({
          getError: Object.assign(new Error('refused'), { code }),
        })

        await expect(check(request)).resolves.toEqual({
          status: 'unavailable',
          retry: 'never',
        })
      },
    )

    it.each([
      [
        'an authorizer that could not decide',
        Object.assign(new Error('x'), { code: 'runtime_unavailable' }),
      ],
      ['a timeout', new Error('The operation timed out')],
      ['something that is not an Error', 'boom'],
    ] as const)('treats %s as worth another try', async (_name, getError) => {
      const { check } = setup({ getError })

      await expect(check(request)).resolves.toEqual({
        status: 'unavailable',
        retry: 'later',
      })
    })

    it('logs the error class and stage, never its text, when the read cannot finish', async () => {
      const { check, warn } = setup({
        persistError: new TypeError('review text leaked into an error message'),
      })

      await check(request)

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        { stage: 'check_review_on_google', errorName: 'TypeError' },
        expect.any(String),
      )
      expect(JSON.stringify(warn.mock.calls)).not.toContain('leaked')
    })

    it('treats a failed write as worth another try rather than throwing', async () => {
      const { check } = setup({ persistError: new Error('connection terminated') })

      await expect(check(request)).resolves.toEqual({
        status: 'unavailable',
        retry: 'later',
      })
    })
  })
})
