import { describe, expect, it, vi } from 'vitest'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { GOOGLE_REVIEW_API_NOT_CONFIGURED_CODE } from '../ports/google-review-api.port'
import type { GoogleReviewHeadResult } from '../ports/google-review-api.port'
import type {
  ReviewHeadBaseline,
  ReviewHeadCheckRepository,
} from '../ports/review-head-check.repository'
import type { HeadStoredCopy } from '../../domain/head-check'
import type { GoogleReviewRead } from '../ports/google-review-api.port'
import { createRunReviewHeadCheck } from './run-review-head-check'

/** What the integration adapter throws for a call Google answered or refused. */
const providerFailure = (
  fields: Readonly<{ code: string; providerStatus?: number; retryAfterMs?: number }>,
) =>
  Object.assign(new Error('provider call failed'), {
    _tag: 'GbpApiError',
    dispatch: 'answered',
    providerStatus: 429,
    ...fields,
  })

const ORG = organizationId('org-head-check')
const PROPERTY = propertyId('3f1c1d5e-0000-4000-8000-000000000001')
const CONNECTION = googleConnectionId('3f1c1d5e-0000-4000-8000-000000000002')
const LOCATION = GOOGLE_LOCATION_PRIMARY_RESOURCE
const EPOCH = 4
const T0 = new Date('2026-10-21T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

const input = {
  organizationId: ORG,
  propertyId: PROPERTY,
  connectionId: CONNECTION,
  sourceEpoch: EPOCH,
  locationName: LOCATION,
}

const googleReview = (
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

const storedCopy = (id: string, over: Partial<HeadStoredCopy> = {}): HeadStoredCopy => ({
  externalId: id,
  sourceEpoch: EPOCH,
  sourceUpdatedAt: new Date(T0.getTime() - 2 * DAY_MS),
  lastFetchedAt: new Date(T0.getTime() - 1 * DAY_MS),
  reply: null,
  ...over,
})

const okHead = (
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

const apiError = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`CANARY provider message for ${code}`), { code, ...extra })

function setup(
  options: Readonly<{
    head?: GoogleReviewHeadResult | Error
    baseline?: Partial<ReviewHeadBaseline> | Error
    outstandingFailure?: boolean | Error
    recordRun?: Error
    clockTicks?: readonly Date[]
    /** When the stored drop was first seen; the check's own start when unset. */
    countDropSeenAt?: Date | null
    countDropWrite?: Error
  }> = {},
) {
  const readReviewsHead = vi.fn(async () => {
    const head = options.head ?? okHead([googleReview('r-1')])
    if (head instanceof Error) throw head
    return head
  })
  const repository = {
    hasOutstandingFailure: vi.fn(async () => {
      if (options.outstandingFailure instanceof Error) throw options.outstandingFailure
      return options.outstandingFailure ?? false
    }),
    readBaseline: vi.fn(async () => {
      if (options.baseline instanceof Error) throw options.baseline
      return {
        copies: [storedCopy('r-1')],
        storedLiveCount: 1,
        storedAverageRating: 5,
        ...options.baseline,
      }
    }),
    readPersistState: vi.fn(async () => ({
      hasCompletedListing: true,
      snapshotActive: false,
      newestFact: null,
    })),
    recordHeadFact: vi.fn(async () => undefined),
    recordRun: vi.fn(async () => {
      if (options.recordRun) throw options.recordRun
    }),
    recordHeadCoverage: vi.fn(async () => undefined),
    requestFullRead: vi.fn(async () => undefined),
    recordCountDrop: vi.fn(async ({ seenAt }: { seenAt: Date }) => {
      if (options.countDropWrite) throw options.countDropWrite
      return options.countDropSeenAt === undefined ? seenAt : options.countDropSeenAt
    }),
    clearCountDrop: vi.fn(async () => {
      if (options.countDropWrite) throw options.countDropWrite
    }),
  } satisfies ReviewHeadCheckRepository
  const logger = { info: vi.fn(), warn: vi.fn() }
  const ticks = [...(options.clockTicks ?? [T0, new Date(T0.getTime() + 1_250)])]
  const clock = vi.fn(() => ticks.shift() ?? T0)
  const run = createRunReviewHeadCheck({
    googleReviewApi: { readReviewsHead },
    repository,
    logger,
    clock,
  })
  return { run, readReviewsHead, repository, logger }
}

describe('runReviewHeadCheck: a dark head check', () => {
  it('compares Google’s newest page with the stored copies and reports what it would store', async () => {
    const { run } = setup({
      head: okHead([googleReview('r-1'), googleReview('r-new')], {
        totalReviewCount: 40,
        averageRating: 4.5,
        hasMore: true,
      }),
      baseline: { storedLiveCount: 37, storedAverageRating: 4.4 },
    })

    const result = await run(input)

    expect(result).toMatchObject({
      status: 'compared',
      comparison: {
        listed: 2,
        newCount: 1,
        wouldPersist: 1,
        googleTotal: 40,
        storedLiveCount: 37,
        totalDifference: 3,
        averageDifference: 0.1,
        hasMore: true,
      },
    })
  })

  it('reads Google once with the Property’s own binding, then the stored copies of exactly those reviews', async () => {
    const { run, readReviewsHead, repository } = setup({
      head: okHead([googleReview('r-1'), googleReview('r-2')]),
    })

    await run(input)

    expect(readReviewsHead).toHaveBeenCalledOnce()
    expect(readReviewsHead).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: PROPERTY,
      connectionId: CONNECTION,
      sourceEpoch: EPOCH,
      locationName: LOCATION,
    })
    expect(repository.readBaseline).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceEpoch: EPOCH,
      externalIds: ['r-1', 'r-2'],
    })
  })

  it('writes one head_dark history row and nothing else about reviews', async () => {
    const { run, repository } = setup()

    await run(input)

    expect(repository.recordRun).toHaveBeenCalledOnce()
    expect(repository.recordRun).toHaveBeenCalledWith({
      propertyId: PROPERTY,
      sourceEpoch: EPOCH,
      startedAt: T0,
      completedAt: new Date(T0.getTime() + 1_250),
      mode: 'head_dark',
      outcome: 'compared',
      comparison: expect.objectContaining({ listed: 1, wouldPersist: 0 }),
      persistence: null,
    })
    // A dark check never reads the persist state or writes a head fact.
    expect(repository.readPersistState).not.toHaveBeenCalled()
    expect(repository.recordHeadFact).not.toHaveBeenCalled()
  })

  it('logs one content-free line with the counts, the hasMore flag, the order verdict and the duration', async () => {
    const { run, logger } = setup({
      head: okHead([googleReview('r-1'), googleReview('r-new')], { hasMore: true }),
    })

    await run(input)

    expect(logger.info).toHaveBeenCalledOnce()
    expect(logger.info).toHaveBeenCalledWith(
      {
        event: 'review_head_check',
        outcome: 'compared',
        listed: 2,
        new: 1,
        changed: 0,
        replyChanged: 0,
        leaseRefresh: 0,
        contentChanged: 1,
        wouldPersist: 1,
        totalDifference: 1,
        averageDifference: 0,
        hasMore: true,
        countDrop: 'cleared',
        pages: 1,
        orderViolation: false,
        durationMs: 1_250,
      },
      'Review head check finished',
    )
  })

  it('never puts an id, a location, a review field or a provider message in a log', async () => {
    const failing = setup({ head: apiError('provider_unavailable') })
    const ok = setup()

    await failing.run(input)
    await ok.run(input)

    const logged = JSON.stringify([
      failing.logger.info.mock.calls,
      failing.logger.warn.mock.calls,
      ok.logger.info.mock.calls,
      ok.logger.warn.mock.calls,
    ])
    for (const secret of [
      String(ORG),
      String(PROPERTY),
      String(CONNECTION),
      LOCATION,
      'r-1',
      'Canary',
    ]) {
      expect(logged).not.toContain(secret)
    }
  })

  it('reports an order violation, reads no stored copies and records the row', async () => {
    const { run, repository, logger } = setup({ head: { status: 'order_violation' } })

    const result = await run(input)

    expect(result).toEqual({ status: 'order_violation' })
    expect(repository.readBaseline).not.toHaveBeenCalled()
    expect(repository.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'order_violation', comparison: null }),
    )
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'order_violation',
        orderViolation: true,
        listed: 0,
      }),
      'Review head check finished',
    )
  })

  it('skips a Property with a recorded failure: no Google call, no row, one line', async () => {
    const { run, readReviewsHead, repository, logger } = setup({
      outstandingFailure: true,
    })

    const result = await run(input)

    expect(result).toEqual({ status: 'skipped_outstanding_failure' })
    expect(readReviewsHead).not.toHaveBeenCalled()
    expect(repository.recordRun).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped_outstanding_failure' }),
      'Review head check finished',
    )
  })

  describe.each([
    ['provider_rate_limited', 'rate_limited'],
    ['provider_unavailable', 'provider_unavailable'],
    ['provider_rejected', 'provider_rejected'],
    ['authorization_changed', 'authorization_changed'],
    ['reauthorization_required', 'authorization_changed'],
    ['authorization_denied', 'authorization_changed'],
    ['connection_unusable', 'authorization_changed'],
    ['capability_killed', 'authorization_changed'],
    ['malformed_response', 'malformed_response'],
    ['invalid_request', 'error'],
    ['something_unforeseen', 'error'],
  ] as const)('when Google fails with %s', (code, outcome) => {
    it(`completes as ${outcome} without throwing, and records the failure`, async () => {
      const { run, repository, logger } = setup({
        head: apiError(code, { retryAfterMs: 90_000 }),
      })

      const result = await run(input)

      expect(result).toEqual({ status: outcome })
      expect(repository.readBaseline).not.toHaveBeenCalled()
      expect(repository.recordRun).toHaveBeenCalledWith(
        expect.objectContaining({ outcome, comparison: null }),
      )
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ outcome, listed: 0, orderViolation: false }),
        'Review head check finished',
      )
    })
  })

  it('reports a process with no Google provider without a history row', async () => {
    const { run, repository } = setup({
      head: apiError(GOOGLE_REVIEW_API_NOT_CONFIGURED_CODE),
    })

    await expect(run(input)).resolves.toEqual({ status: 'no_provider' })
    expect(repository.recordRun).not.toHaveBeenCalled()
  })

  it('treats a thrown non-Error as an error outcome', async () => {
    const { run, readReviewsHead } = setup()
    readReviewsHead.mockRejectedValueOnce('boom')

    await expect(run(input)).resolves.toEqual({ status: 'error' })
  })

  it('completes as an error when the stored copies cannot be read', async () => {
    const { run, repository, logger } = setup({ baseline: new Error('db down') })

    const result = await run(input)

    expect(result).toEqual({ status: 'error' })
    expect(repository.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'error', comparison: null }),
    )
    expect(logger.warn).toHaveBeenCalledOnce()
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('db down')
  })

  it('completes as an error when the failure check cannot be read, without calling Google', async () => {
    const { run, readReviewsHead } = setup({ outstandingFailure: new Error('db down') })

    await expect(run(input)).resolves.toEqual({ status: 'error' })
    expect(readReviewsHead).not.toHaveBeenCalled()
  })

  it('still returns the comparison when the history row cannot be written', async () => {
    const { run, logger } = setup({ recordRun: new Error('db down') })

    const result = await run(input)

    expect(result).toMatchObject({ status: 'compared' })
    expect(logger.warn).toHaveBeenCalledWith(
      { event: 'review_head_check_run_not_recorded' },
      'Review head check history row could not be written',
    )
  })

  describe.each([
    [{ code: 'rate_limited', retryAfterMs: 7_000 }, 'rate_limited'],
    [{ code: 'upstream_error', providerStatus: 503 }, 'provider_unavailable'],
    [{ code: 'upstream_error', providerStatus: 404 }, 'provider_rejected'],
    [{ code: 'auth_failed', providerStatus: 401 }, 'authorization_changed'],
  ] as const)('when Google answers with the provider failure %j', (fields, outcome) => {
    it(`completes as ${outcome}`, async () => {
      const { run, repository } = setup({ head: providerFailure(fields) })

      await expect(run(input)).resolves.toEqual({ status: outcome })
      expect(repository.recordRun).toHaveBeenCalledWith(
        expect.objectContaining({ outcome, comparison: null }),
      )
    })
  })
})

describe('runReviewHeadCheck: a drop in Google’s total below the stored count', () => {
  const MINUTE_MS = 60 * 1000
  const HOUR_MS = 60 * MINUTE_MS
  /** Google counts one review fewer than RepKey shows. */
  const dropped = {
    head: okHead([googleReview('r-1')], { totalReviewCount: 40 }),
    baseline: { storedLiveCount: 41 },
  }

  it('stamps the first sighting and asks for nothing yet', async () => {
    const { run, repository, logger } = setup(dropped)

    await run(input)

    expect(repository.recordCountDrop).toHaveBeenCalledExactlyOnceWith({
      propertyId: PROPERTY,
      seenAt: T0,
    })
    expect(repository.requestFullRead).not.toHaveBeenCalled()
    expect(repository.clearCountDrop).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ countDrop: 'seen', totalDifference: -1 }),
      'Review head check finished',
    )
  })

  it('asks for nothing when the drop was first seen under 15 minutes ago', async () => {
    const { run, repository } = setup({
      ...dropped,
      countDropSeenAt: new Date(T0.getTime() - 14 * MINUTE_MS),
    })

    await run(input)

    expect(repository.requestFullRead).not.toHaveBeenCalled()
  })

  it('asks for a full read when a second check at least 15 minutes later still sees it', async () => {
    const asked = new Date(T0.getTime() + 500)
    const { run, repository, logger } = setup({
      ...dropped,
      countDropSeenAt: new Date(T0.getTime() - 15 * MINUTE_MS),
      clockTicks: [T0, asked, new Date(T0.getTime() + 1_250)],
    })

    await run(input)

    expect(repository.requestFullRead).toHaveBeenCalledExactlyOnceWith({
      propertyId: PROPERTY,
      requestedAt: asked,
    })
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ countDrop: 'confirmed' }),
      'Review head check finished',
    )
  })

  it('asks in dark mode too: the alarm does not depend on storing anything', async () => {
    const { run, repository } = setup({
      ...dropped,
      countDropSeenAt: new Date(T0.getTime() - HOUR_MS),
    })

    await run({ ...input, mode: 'dark' })

    expect(repository.requestFullRead).toHaveBeenCalledOnce()
    expect(repository.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'head_dark' }),
    )
  })

  it('keeps asking until 72 hours after the first sighting, then stops', async () => {
    const at = (ageMs: number) => {
      const { run, repository } = setup({
        ...dropped,
        countDropSeenAt: new Date(T0.getTime() - ageMs),
      })
      return { run, repository }
    }
    const lastAsk = at(72 * HOUR_MS - 1)
    await lastAsk.run(input)
    const stopped = at(72 * HOUR_MS)
    await stopped.run(input)

    expect(lastAsk.repository.requestFullRead).toHaveBeenCalledOnce()
    expect(stopped.repository.requestFullRead).not.toHaveBeenCalled()
    expect(stopped.repository.recordCountDrop).toHaveBeenCalledOnce()
  })

  it.each([
    ['level', 41],
    ['above the stored count', 45],
  ])('clears the drop when Google’s total is %s', async (_case, total) => {
    const { run, repository, logger } = setup({
      head: okHead([googleReview('r-1')], { totalReviewCount: total }),
      baseline: { storedLiveCount: 41 },
    })

    await run(input)

    expect(repository.clearCountDrop).toHaveBeenCalledExactlyOnceWith({
      propertyId: PROPERTY,
    })
    expect(repository.recordCountDrop).not.toHaveBeenCalled()
    expect(repository.requestFullRead).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ countDrop: 'cleared' }),
      'Review head check finished',
    )
  })

  it('asks for nothing for a Property the sweep has never dated', async () => {
    const { run, repository } = setup({ ...dropped, countDropSeenAt: null })

    await run(input)

    expect(repository.requestFullRead).not.toHaveBeenCalled()
  })

  it.each([
    ['an order violation', { status: 'order_violation' } as const],
    ['a provider failure', providerFailure({ code: 'rate_limited' })],
  ])('neither stamps nor clears after %s', async (_case, head) => {
    const { run, repository } = setup({ head })

    await run(input)

    expect(repository.recordCountDrop).not.toHaveBeenCalled()
    expect(repository.clearCountDrop).not.toHaveBeenCalled()
  })

  it('logs a closed code and still completes when the stamp cannot be written', async () => {
    const { run, logger } = setup({ ...dropped, countDropWrite: new Error('db down') })

    await expect(run(input)).resolves.toMatchObject({ status: 'compared' })
    expect(logger.warn).toHaveBeenCalledWith(
      { event: 'review_head_check_count_drop_not_recorded' },
      'Review head check could not record a drop in the review total',
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('db down')
  })
})
