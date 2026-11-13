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
import type {
  GoogleReviewApiPort,
  GoogleReviewRead,
} from '../ports/google-review-api.port'
import type { ReviewProviderObservationWriter } from '../ports/review-provider-observation-writer.port'
import type { ReviewProviderSubjectKeyService } from '../provider-subject-keyring'
import { REPLY_PRE_READ_REFUSAL_OPERATION } from '../google-review-api-error'
import { readReviewBeforePublish } from './read-review-before-publish'

/** What the integration adapter throws for a call Google answered or refused. */
const providerFailure = (
  fields: Readonly<{
    code: string
    providerStatus?: number
    retryAfterMs?: number
    operation?: string
    dispatch?: string
    executionCode?: string
  }>,
) =>
  Object.assign(new Error('provider call failed'), {
    _tag: 'GbpApiError',
    operation: 'getReview',
    dispatch: 'answered',
    providerStatus: 429,
    ...fields,
  })

/** What the adapter throws when the authorizer or connection check refuses the read. */
const preReadRefusal = (
  fields: Readonly<{
    code: 'permission_denied' | 'upstream_error'
    executionCode?: string
  }>,
) =>
  providerFailure({
    operation: REPLY_PRE_READ_REFUSAL_OPERATION,
    dispatch: 'not_sent',
    ...fields,
  } as never)

const organizationId = 'org-pre-read' as OrganizationId
const propertyId = '00000000-0000-4000-8000-000000000021' as PropertyId
const connectionId = '00000000-0000-4000-8000-000000000022' as GoogleConnectionId
const reviewId = '00000000-0000-4000-8000-000000000023' as ReviewId

const review: GoogleReviewRead = {
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
  reviewedAt: new Date('2026-10-20T07:00:00.000Z'),
  sourceUpdatedAt: new Date('2026-10-20T07:30:00.000Z'),
  replyText: null,
  replyUpdatedAt: null,
}

function setup(
  input: Readonly<{
    getResult?: Awaited<ReturnType<GoogleReviewApiPort['getReview']>>
    getError?: Error
    persistError?: Error
    connectionStatus?: string | null
    statusError?: Error
    epochs?: readonly (Readonly<{ sourceEpoch: number }> | null)[]
    review?: GoogleReviewRead
  }> = {},
) {
  const epochs = [...(input.epochs ?? [{ sourceEpoch: 6 }, { sourceEpoch: 6 }])]
  const getReview = vi.fn(async () => {
    if (input.getError) throw input.getError
    return (
      input.getResult ?? ({ status: 'found', review: input.review ?? review } as const)
    )
  })
  const googleReviewApi: GoogleReviewApiPort = {
    getReview,
    listReviewsPage: vi.fn(),
    readReviewsHead: vi.fn(),
    discardReviewCursors: vi.fn(),
    replyToReview: vi.fn(),
  }
  const persist = vi.fn(async () => {
    if (input.persistError) throw input.persistError
    return { reviewId, sourceRevision: 3, isNew: false }
  })
  const observationWriter: ReviewProviderObservationWriter = {
    allocateReplyReadGeneration: vi.fn(async () => 23),
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
  const logger = { warn: vi.fn() }
  const findStatus = vi.fn(
    async () => input.connectionStatus ?? ('active' as string | null),
  )
  const useCase = readReviewBeforePublish({
    googleReviewApi,
    connectionStatus: {
      findStatus: input.statusError
        ? vi.fn(async () => {
            throw input.statusError
          })
        : findStatus,
    },
    logger,
    propertySourceEpoch: {
      getSourceEpoch: vi.fn(async () => epochs.shift() ?? null),
    },
    observationWriter,
    subjectKeyService,
    subjectSightings: { record: vi.fn(async () => 'linked' as const) },
  })
  return {
    useCase,
    getReview,
    persist,
    observationWriter,
    subjectKeyService,
    findStatus,
    logger,
  }
}

const request = {
  organizationId,
  propertyId,
  connectionId,
  sourceEpoch: 6,
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
  readKey: 'reply-1:2:0',
}

describe('readReviewBeforePublish', () => {
  it('reads the review as a publication read, then records it through the shared writer', async () => {
    const { useCase, getReview, persist, observationWriter } = setup()

    await expect(useCase(request)).resolves.toEqual({ status: 'recorded' })

    expect(getReview).toHaveBeenCalledWith({
      organizationId,
      propertyId,
      connectionId,
      sourceEpoch: 6,
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
      forReplyPublication: true,
    })
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        propertyId,
        connectionId,
        sourceEpoch: 6,
        observationOrigin: 'ongoing',
        firstSeenVia: 'demand',
        replyReadGeneration: 23,
        review,
      }),
    )
    expect(getReview.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(observationWriter.allocateReplyReadGeneration).mock
        .invocationCallOrder[0]!,
    )
  })

  it('keys the observation by the read, never by anything in the review or its reply', async () => {
    const first = setup()
    const second = setup()
    const other = setup()

    await first.useCase(request)
    await second.useCase(request)
    await other.useCase({ ...request, readKey: 'reply-1:2:1' })

    const keyOf = (persist: ReturnType<typeof setup>['persist']) =>
      (persist.mock.calls[0] as unknown as [{ observationKey: string }])[0].observationKey
    expect(keyOf(first.persist)).toMatch(/^[a-f0-9]{64}$/u)
    expect(keyOf(second.persist)).toBe(keyOf(first.persist))
    expect(keyOf(other.persist)).not.toBe(keyOf(first.persist))
  })

  it('records a review whose Google reply it can read', async () => {
    const { useCase, persist } = setup({
      review: { ...review, replyText: 'Thank you!', replyUpdatedAt: new Date() },
    })

    await expect(useCase(request)).resolves.toEqual({ status: 'recorded' })
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('reports a reply it cannot read, after recording the review itself', async () => {
    const { useCase, persist } = setup({ review: { ...review, replyUnreadable: true } })

    await expect(useCase(request)).resolves.toEqual({ status: 'reply_unreadable' })
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('reports a review Google no longer has without recording anything', async () => {
    const { useCase, persist } = setup({ getResult: { status: 'not_found' } })

    await expect(useCase(request)).resolves.toEqual({ status: 'review_missing' })
    expect(persist).not.toHaveBeenCalled()
  })

  it('stops before any Google call when the Property moved on', async () => {
    const { useCase, getReview } = setup({ epochs: [{ sourceEpoch: 7 }] })

    await expect(useCase(request)).resolves.toEqual({ status: 'obsolete' })
    expect(getReview).not.toHaveBeenCalled()
  })

  it('rechecks the source epoch after the read and records nothing when it moved', async () => {
    const { useCase, persist } = setup({
      epochs: [{ sourceEpoch: 6 }, { sourceEpoch: 7 }],
    })

    await expect(useCase(request)).resolves.toEqual({ status: 'obsolete' })
    expect(persist).not.toHaveBeenCalled()
  })

  it('does not call a missing review missing when the Property moved during the read', async () => {
    const { useCase } = setup({
      getResult: { status: 'not_found' },
      epochs: [{ sourceEpoch: 6 }, null],
    })

    await expect(useCase(request)).resolves.toEqual({ status: 'obsolete' })
  })

  it('refuses a review from another location without recording it', async () => {
    const other = GOOGLE_LOCATION_PRIMARY_RESOURCE.replace(/\d$/u, '9')
    const { useCase, persist } = setup()

    await expect(useCase({ ...request, locationName: other })).rejects.toThrow(
      'Targeted Google review resource mismatch',
    )
    expect(persist).not.toHaveBeenCalled()
  })

  it('lets a failed read fail the caller, which decides whether to retry', async () => {
    const failure = new Error('read failed')
    const { useCase, persist } = setup({ getError: failure })

    await expect(useCase(request)).rejects.toBe(failure)
    expect(persist).not.toHaveBeenCalled()
  })

  it('lets a failed write of the observation fail the caller', async () => {
    const failure = new Error('write failed')
    const { useCase } = setup({ persistError: failure })

    await expect(useCase(request)).rejects.toBe(failure)
  })

  it('translates a provider failure on the read into the review API error', async () => {
    const { useCase, persist } = setup({
      getError: providerFailure({ code: 'rate_limited', retryAfterMs: 7_000 }),
    })

    await expect(useCase(request)).rejects.toMatchObject({
      _tag: 'GoogleReviewApiError',
      code: 'provider_rate_limited',
      retryAfterMs: 7_000,
    })
    expect(persist).not.toHaveBeenCalled()
  })

  describe('a read refused before it reached Google', () => {
    it('is the reconnect case while the connection waits for a reconnect', async () => {
      const { useCase, findStatus, persist } = setup({
        getError: preReadRefusal({
          code: 'permission_denied',
          executionCode: 'authorization_denied',
        }),
        connectionStatus: 'reauth_required',
      })

      await expect(useCase(request)).rejects.toMatchObject({
        _tag: 'GoogleReviewApiError',
        code: 'reauthorization_required',
        recoverable: false,
        failure: { executionCode: 'authorization_denied', dispatch: 'not_sent' },
      })
      expect(findStatus).toHaveBeenCalledWith(organizationId, connectionId)
      expect(persist).not.toHaveBeenCalled()
    })

    it.each(['authorization_denied', 'stale_source', 'connection_unusable'])(
      'keeps a %s refusal from a usable connection as authorization_changed, with the closed code as not-sent evidence',
      async (executionCode) => {
        const { useCase } = setup({
          getError: preReadRefusal({ code: 'permission_denied', executionCode }),
        })

        await expect(useCase(request)).rejects.toMatchObject({
          code: 'authorization_changed',
          recoverable: false,
          failure: { executionCode, dispatch: 'not_sent' },
        })
      },
    )

    it('keeps authorization_changed when the connection does not exist', async () => {
      const { useCase } = setup({
        getError: preReadRefusal({ code: 'permission_denied' }),
        connectionStatus: null,
      })

      await expect(useCase(request)).rejects.toMatchObject({
        code: 'authorization_changed',
      })
    })

    it('keeps authorization_changed, and logs, when the connection cannot be read', async () => {
      const { useCase, logger } = setup({
        getError: preReadRefusal({
          code: 'permission_denied',
          executionCode: 'authorization_denied',
        }),
        statusError: new Error('database unavailable'),
      })

      await expect(useCase(request)).rejects.toMatchObject({
        code: 'authorization_changed',
        recoverable: false,
      })
      expect(logger.warn).toHaveBeenCalledWith(
        { event: 'google_reply_refusal_connection_unreadable' },
        expect.any(String),
      )
    })

    it('is a retryable provider_unavailable that sent nothing for an outage, without reading the connection', async () => {
      const { useCase, findStatus } = setup({
        getError: preReadRefusal({
          code: 'upstream_error',
          executionCode: 'runtime_unavailable',
        }),
        connectionStatus: 'reauth_required',
      })

      await expect(useCase(request)).rejects.toMatchObject({
        code: 'provider_unavailable',
        recoverable: true,
        retryAfterMs: expect.any(Number),
        failure: { executionCode: 'runtime_unavailable', dispatch: 'not_sent' },
      })
      expect(findStatus).not.toHaveBeenCalled()
    })

    it('is a retryable provider_unavailable for a failure that carried no closed code', async () => {
      const { useCase } = setup({ getError: preReadRefusal({ code: 'upstream_error' }) })

      await expect(useCase(request)).rejects.toMatchObject({
        code: 'provider_unavailable',
        recoverable: true,
        failure: { executionCode: null, dispatch: 'not_sent' },
      })
    })
  })

  describe('a read Google answered or the gateway failed', () => {
    it.each([
      ['auth_failed', 401],
      ['permission_denied', 403],
    ])(
      'keeps a %s answer as authorization_changed even while the connection waits for a reconnect',
      async (code, providerStatus) => {
        const { useCase, findStatus } = setup({
          getError: providerFailure({ code, providerStatus }),
          connectionStatus: 'reauth_required',
        })

        await expect(useCase(request)).rejects.toMatchObject({
          code: 'authorization_changed',
          recoverable: false,
        })
        expect(findStatus).not.toHaveBeenCalled()
      },
    )

    it('keeps an answered 400 as a terminal provider_rejected', async () => {
      const { useCase } = setup({
        getError: providerFailure({ code: 'upstream_error', providerStatus: 400 }),
      })

      await expect(useCase(request)).rejects.toMatchObject({
        code: 'provider_rejected',
        recoverable: false,
      })
    })

    it('keeps an upstream 503 as a retryable provider_unavailable', async () => {
      const { useCase } = setup({
        getError: providerFailure({ code: 'upstream_error', providerStatus: 503 }),
      })

      await expect(useCase(request)).rejects.toMatchObject({
        code: 'provider_unavailable',
        recoverable: true,
      })
    })
  })
})
