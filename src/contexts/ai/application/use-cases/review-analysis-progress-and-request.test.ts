import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
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

/** An Organization-wide reader: what the progress says is tested as this one. */
const ADMIN = buildTestAuthContext({
  organizationId: INPUT.organizationId,
  role: 'AccountAdmin',
})
const PROGRESS_INPUT = { ...INPUT, actor: ADMIN }

describe('who may read review analysis progress', () => {
  const OTHER_PROPERTY = propertyId('7d000000-0000-4000-8000-000000000002')
  const manager = buildTestAuthContext({
    organizationId: INPUT.organizationId,
    role: 'PropertyManager',
  })
  const forbidden = { _tag: 'AiError', code: 'forbidden' }
  const counts = { queued: 1, inProgress: 0, analysed: 2, settled: 2 }

  function progressRead(grants: readonly (typeof OTHER_PROPERTY)[]) {
    const ports = gate(true)
    const readProgress = vi.fn(async () => counts)
    const readEnrollmentReadiness = vi.fn(
      async () => ({ status: 'ready', caughtUpAtEpochMillis: 1 }) as never,
    )
    const read = createReadReviewAnalysisProgress({
      ...ports,
      propertyAccess: async () => grants,
      backlog: { readProgress },
      readEnrollmentReadiness,
    })
    return { read, readProgress, readEnrollmentReadiness, ...ports }
  }

  it('refuses a manager with no grant on the Property before any AI state is read', async () => {
    const harness = progressRead([OTHER_PROPERTY])

    await expect(harness.read({ ...INPUT, actor: manager })).rejects.toMatchObject(
      forbidden,
    )
    expect(harness.authorization.readMerchantAuthorization).not.toHaveBeenCalled()
    expect(harness.readProgress).not.toHaveBeenCalled()
    expect(harness.readEnrollmentReadiness).not.toHaveBeenCalled()
  })

  it('refuses a reader who belongs to another Organization', async () => {
    const harness = progressRead([])
    const foreignAdmin = buildTestAuthContext({
      organizationId: organizationId('progress-other-org'),
      role: 'AccountAdmin',
    })

    await expect(harness.read({ ...INPUT, actor: foreignAdmin })).rejects.toMatchObject(
      forbidden,
    )
    expect(harness.readProgress).not.toHaveBeenCalled()
  })

  it('refuses a reader who holds no dashboard.read', async () => {
    const harness = progressRead([])
    const inboxOnly = createScopedAuthContext({
      organizationId: INPUT.organizationId,
      userId: manager.userId,
      permissions: [['inbox.read', 'organization']],
    })

    await expect(harness.read({ ...INPUT, actor: inboxOnly })).rejects.toMatchObject(
      forbidden,
    )
    expect(harness.readProgress).not.toHaveBeenCalled()
  })

  it('serves a manager granted the Property', async () => {
    const harness = progressRead([INPUT.propertyId])

    await expect(harness.read({ ...INPUT, actor: manager })).resolves.toMatchObject({
      status: 'analysing',
      queued: 1,
      analysed: 2,
    })
  })
})

describe('readReviewAnalysisProgress', () => {
  it('is disabled without an enabled review-analysis authorization', async () => {
    const read = createReadReviewAnalysisProgress({
      ...gate(false),
      propertyAccess: async () => null,
      backlog: { readProgress: vi.fn() },
      readEnrollmentReadiness: vi.fn(),
    })

    await expect(read(PROGRESS_INPUT)).resolves.toEqual({ status: 'disabled' })
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
      propertyAccess: async () => null,
      backlog: { readProgress },
      readEnrollmentReadiness: vi.fn(async () => ({
        status: 'preparing' as const,
        reason: 'enrollment_running' as const,
      })),
    })

    await expect(read(PROGRESS_INPUT)).resolves.toEqual({
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
      propertyAccess: async () => null,
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

    await expect(read(PROGRESS_INPUT)).resolves.toMatchObject({
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
