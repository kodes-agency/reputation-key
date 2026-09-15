import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import { createReadReviewAnalysisProgress } from './read-review-analysis-progress'
import { createRequestReviewAnalysisNow } from './request-review-analysis-now'

const INPUT = {
  organizationId: organizationId('progress-org'),
  propertyId: propertyId('7d000000-0000-4000-8000-000000000001'),
}

function gate(enabled: boolean) {
  const authorization = {
    readMerchantAuthorization: vi.fn(async () =>
      enabled
        ? {
            state: 'enabled',
            capabilities: ['review_analysis'],
            authorizedSourceEpoch: 3,
            capabilityEpochs: { review_analysis: { epoch: 2 } },
          }
        : null,
    ),
  } as unknown as AiAuthorizationPort
  const processingProfiles = {
    readForAi: vi.fn(async () => ({ status: 'available', profile: {} })),
  } as unknown as PropertyProcessingProfilePort
  return { authorization, processingProfiles }
}

describe('readReviewAnalysisProgress', () => {
  it('is disabled without an enabled review-analysis authorization', async () => {
    const read = createReadReviewAnalysisProgress({
      ...gate(false),
      backlog: { readProgress: vi.fn() },
      readEnrollmentReadiness: vi.fn(),
    })

    await expect(read(INPUT)).resolves.toEqual({ status: 'disabled' })
  })

  it('reports queued work under the current fence as analysing', async () => {
    const readProgress = vi.fn(async () => ({
      queued: 40,
      inProgress: 2,
      analysed: 50,
      settled: 54,
    }))
    const read = createReadReviewAnalysisProgress({
      ...gate(true),
      backlog: { readProgress },
      readEnrollmentReadiness: vi.fn(async () => ({
        status: 'preparing' as const,
        reason: 'enrollment_running' as const,
      })),
    })

    await expect(read(INPUT)).resolves.toEqual({
      status: 'analysing',
      queued: 40,
      inProgress: 2,
      analysed: 50,
      notAnalysable: 4,
      verifiedThroughEpochMillis: null,
    })
    expect(readProgress).toHaveBeenCalledWith({
      ...INPUT,
      sourceEpoch: 3,
      reviewAnalysisEpoch: 2,
    })
  })

  it('reports an empty backlog with caught-up enrollment as caught up', async () => {
    const read = createReadReviewAnalysisProgress({
      ...gate(true),
      backlog: {
        readProgress: vi.fn(async () => ({
          queued: 0,
          inProgress: 0,
          analysed: 96,
          settled: 96,
        })),
      },
      readEnrollmentReadiness: vi.fn(
        async () =>
          ({ status: 'ready', caughtUpAtEpochMillis: 1_789_000_000_000 }) as never,
      ),
    })

    await expect(read(INPUT)).resolves.toMatchObject({
      status: 'caught_up',
      notAnalysable: 0,
      verifiedThroughEpochMillis: 1_789_000_000_000,
    })
  })
})

describe('requestReviewAnalysisNow', () => {
  const REQUEST = { ...INPUT, reviewId: reviewId('7e000000-0000-4000-8000-000000000001') }

  it('hands a waiting review to the worker', async () => {
    const enqueueReviewAnalysisNow = vi.fn(async () => {})
    const request = createRequestReviewAnalysisNow({
      ...gate(true),
      backlog: { hasPendingForReview: vi.fn(async () => true) },
      enqueueReviewAnalysisNow,
    })

    await expect(request(REQUEST)).resolves.toEqual({ status: 'queued' })
    expect(enqueueReviewAnalysisNow).toHaveBeenCalledWith(REQUEST)
  })

  it('does nothing for a review with no waiting analysis', async () => {
    const enqueueReviewAnalysisNow = vi.fn(async () => {})
    const request = createRequestReviewAnalysisNow({
      ...gate(true),
      backlog: { hasPendingForReview: vi.fn(async () => false) },
      enqueueReviewAnalysisNow,
    })

    await expect(request(REQUEST)).resolves.toEqual({ status: 'not_pending' })
    expect(enqueueReviewAnalysisNow).not.toHaveBeenCalled()
  })

  it('refuses quietly when review analysis is not enabled', async () => {
    const hasPendingForReview = vi.fn(async () => true)
    const request = createRequestReviewAnalysisNow({
      ...gate(false),
      backlog: { hasPendingForReview },
      enqueueReviewAnalysisNow: vi.fn(),
    })

    await expect(request(REQUEST)).resolves.toEqual({ status: 'disabled' })
    expect(hasPendingForReview).not.toHaveBeenCalled()
  })
})
