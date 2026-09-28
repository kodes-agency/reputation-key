import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  AI_ADMISSION_IN_FLIGHT,
  AI_ON_DEMAND_ANALYSIS_INTERACTIVE_HEADROOM,
} from '../../domain/admission-lanes'
import type {
  AiReviewAnalysisBacklogEntry,
  AiReviewAnalysisBacklogPort,
} from '../ports/ai-review-analysis-backlog.port'
import {
  AI_BACKFILL_OPERATION_HORIZON_MILLIS,
  type AnalyzeReviewEventResult,
} from './analyze-review-event'
import {
  AI_BACKLOG_CLAIM_LEASE_MILLIS,
  AI_BACKLOG_DRAIN_CONCURRENCY,
  AI_BACKLOG_DRAIN_TIME_BUDGET_MILLIS,
  createDrainReviewAnalysisBacklog,
} from './drain-review-analysis-backlog'

const NOW = Date.parse('2026-09-15T12:00:00.000Z')
const ORGANIZATION_ID = organizationId('drain-backlog-org')
const PROPERTY_A = propertyId('7a000000-0000-4000-8000-000000000001')
const PROPERTY_B = propertyId('7a000000-0000-4000-8000-000000000002')

function property(index: number) {
  return propertyId(`7a000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
}

function entry(
  index: number,
  overrides: Partial<AiReviewAnalysisBacklogEntry> = {},
): AiReviewAnalysisBacklogEntry {
  return {
    eventEnvelopeId: `7b000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_A,
    reviewId: reviewId(`7c000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
    sourceEpoch: 1,
    sourceRevision: 1,
    analysisSequence: index,
    origin: 'historical_onboarding',
    priority: 'background',
    attempts: 0,
    firstStartedAtEpochMillis: NOW - 1_000,
    ...overrides,
  }
}

/** The drain's clock, which a test may move while the drain runs. */
function clock(start = NOW) {
  let now = start
  return {
    read: () => now,
    set: (value: number) => {
      now = value
    },
  }
}

/**
 * `rounds[i]` is what the drain's i-th claim returns; later claims find the
 * backlog empty.
 */
function harness(
  rounds: ReadonlyArray<ReadonlyArray<AiReviewAnalysisBacklogEntry>>,
  answer: (
    index: number,
    entry: AiReviewAnalysisBacklogEntry,
  ) => AnalyzeReviewEventResult | Promise<AnalyzeReviewEventResult>,
  options: Readonly<{ now?: () => number }> = {},
) {
  let calls = 0
  const analyzeReviewEvent = vi.fn(
    async (input: Readonly<{ eventEnvelopeId: string }>) => {
      const claimed = rounds
        .flat()
        .find((e) => e.eventEnvelopeId === input.eventEnvelopeId)
      if (!claimed) throw new Error('analysed an entry nobody claimed')
      return answer(calls++, claimed)
    },
  )
  let claims = 0
  const backlog = {
    enqueue: vi.fn(),
    claimReady: vi.fn(async () => rounds[claims++] ?? []),
    claimForReview: vi.fn(async () => rounds[0]?.[0] ?? null),
    complete: vi.fn(async () => {}),
    reschedule: vi.fn(async () => {}),
    readProgress: vi.fn(),
    hasPendingForReview: vi.fn(),
  } satisfies AiReviewAnalysisBacklogPort
  const logger = { warn: vi.fn() }
  const advanceEnrollment = vi.fn(async () => ({ status: 'waiting_for_replay' }))
  const drainer = createDrainReviewAnalysisBacklog({
    backlog,
    analyzeReviewEvent,
    nowEpochMillis: options.now ?? (() => NOW),
    logger,
    advanceEnrollment,
  })
  return { drainer, backlog, analyzeReviewEvent, logger, advanceEnrollment }
}

describe('drainReviewAnalysisBacklog', () => {
  it('runs claimed entries in their lane from their first start and removes settled ones', async () => {
    const first = entry(1)
    const test = harness([[first]], () => ({ status: 'completed' }))

    await expect(test.drainer.drain()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      rescheduled: 0,
      waitingForLane: 0,
      failed: 0,
    })
    expect(test.backlog.claimReady).toHaveBeenCalledWith(
      expect.objectContaining({
        nowEpochMillis: NOW,
        leaseMillis: AI_BACKLOG_CLAIM_LEASE_MILLIS,
        perProperty: AI_ADMISSION_IN_FLIGHT.property.background,
      }),
    )
    expect(test.analyzeReviewEvent).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_A,
      reviewId: first.reviewId,
      sourceEpoch: 1,
      sourceRevision: 1,
      analysisSequence: 1,
      eventEnvelopeId: first.eventEnvelopeId,
      disposition: 'pending',
      eventRecordedAtEpochMillis: NOW - 1_000,
      operationHorizonMillis: AI_BACKFILL_OPERATION_HORIZON_MILLIS,
      execution: 'execute',
      lane: 'background',
    })
    expect(test.backlog.complete).toHaveBeenCalledWith({
      eventEnvelopeId: first.eventEnvelopeId,
      organizationId: ORGANIZATION_ID,
    })
  })

  it.each([
    { status: 'replayed' },
    { status: 'terminal' },
    { status: 'generation_changed' },
  ] as const)('treats %o as done', async (result) => {
    const test = harness([[entry(1)]], () => result)

    await test.drainer.drain()

    expect(test.backlog.complete).toHaveBeenCalledOnce()
    expect(test.backlog.reschedule).not.toHaveBeenCalled()
  })

  it('claims another round while rounds settle work', async () => {
    const test = harness([[entry(1), entry(2)], [entry(3)]], () => ({
      status: 'completed',
    }))

    await expect(test.drainer.drain()).resolves.toMatchObject({
      claimed: 3,
      completed: 3,
    })
    // Two rounds that settled work, then the claim that found nothing.
    expect(test.backlog.claimReady).toHaveBeenCalledTimes(3)
  })

  it('leaves the rest to the next tick once its time budget is spent', async () => {
    const time = clock()
    const test = harness(
      [[entry(1)], [entry(2)]],
      () => {
        time.set(NOW + AI_BACKLOG_DRAIN_TIME_BUDGET_MILLIS)
        return { status: 'completed' }
      },
      { now: time.read },
    )

    await expect(test.drainer.drain()).resolves.toMatchObject({ claimed: 1 })
    expect(test.backlog.claimReady).toHaveBeenCalledOnce()
  })

  it('runs at most its concurrency of analyses at once', async () => {
    const entries = Array.from({ length: 10 }, (_, index) =>
      entry(index + 1, { propertyId: property(index + 1) }),
    )
    let running = 0
    let mostAtOnce = 0
    const test = harness([entries], async () => {
      running += 1
      mostAtOnce = Math.max(mostAtOnce, running)
      await new Promise((resolve) => setTimeout(resolve, 1))
      running -= 1
      return { status: 'completed' }
    })

    await expect(test.drainer.drain()).resolves.toMatchObject({ completed: 10 })
    expect(mostAtOnce).toBe(AI_BACKLOG_DRAIN_CONCURRENCY)
  })

  it('leaves the backlog to a drain already running in this process', async () => {
    let release: () => void = () => {}
    const test = harness([[entry(1)]], async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { status: 'completed' }
    })

    const first = test.drainer.drain()
    await vi.waitFor(() => expect(test.analyzeReviewEvent).toHaveBeenCalledOnce())
    await expect(test.drainer.drain()).resolves.toEqual({
      claimed: 0,
      completed: 0,
      rescheduled: 0,
      waitingForLane: 0,
      failed: 0,
    })
    release()

    await expect(first).resolves.toMatchObject({ completed: 1 })
    expect(test.backlog.claimReady).toHaveBeenCalledTimes(2)
  })

  it('parks the rest of a busy property at the lane retry time without asking again', async () => {
    const entries = Array.from({ length: AI_BACKLOG_DRAIN_CONCURRENCY + 2 }, (_, index) =>
      entry(index + 1),
    )
    const test = harness([entries], () => ({
      status: 'retry',
      retryAtEpochMillis: NOW + 40_000,
      code: 'admission_busy',
    }))

    await expect(test.drainer.drain()).resolves.toMatchObject({
      waitingForLane: entries.length,
    })
    // Only the first wave asked; the entries after it were parked unasked.
    expect(test.analyzeReviewEvent).toHaveBeenCalledTimes(AI_BACKLOG_DRAIN_CONCURRENCY)
    for (const waiting of entries) {
      expect(test.backlog.reschedule).toHaveBeenCalledWith({
        eventEnvelopeId: waiting.eventEnvelopeId,
        organizationId: ORGANIZATION_ID,
        nextAttemptAtEpochMillis: NOW + 40_000,
        nowEpochMillis: NOW,
      })
    }
  })

  it('asks a parked lane again once its retry time has passed', async () => {
    const time = clock()
    const busy = entry(1, { propertyId: PROPERTY_A })
    const other = entry(2, { propertyId: PROPERTY_B })
    const later = entry(3, { propertyId: PROPERTY_A })
    const test = harness(
      [[busy, other], [later]],
      (_index, claimed) => {
        if (claimed === busy) {
          return {
            status: 'retry',
            retryAtEpochMillis: NOW + 1_000,
            code: 'admission_busy',
          }
        }
        time.set(NOW + 2_000)
        return { status: 'completed' }
      },
      { now: time.read },
    )

    await expect(test.drainer.drain()).resolves.toMatchObject({
      completed: 2,
      waitingForLane: 1,
    })
    expect(test.analyzeReviewEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventEnvelopeId: later.eventEnvelopeId }),
    )
  })

  it('keeps draining other properties when one is busy', async () => {
    const busy = entry(1, { propertyId: PROPERTY_A })
    const other = entry(2, { propertyId: PROPERTY_B })
    const test = harness([[busy, other]], (index) =>
      index === 0
        ? { status: 'retry', retryAtEpochMillis: NOW + 40_000, code: 'admission_busy' }
        : { status: 'completed' },
    )

    await expect(test.drainer.drain()).resolves.toMatchObject({
      completed: 1,
      waitingForLane: 1,
    })
    expect(test.backlog.complete).toHaveBeenCalledWith({
      eventEnvelopeId: other.eventEnvelopeId,
      organizationId: ORGANIZATION_ID,
    })
  })

  it('stops after a round that settles nothing', async () => {
    const test = harness([[entry(1)], [entry(2)]], () => ({
      status: 'retry',
      retryAtEpochMillis: NOW + 8_000,
      code: 'provider_unavailable',
    }))

    await expect(test.drainer.drain()).resolves.toMatchObject({ rescheduled: 1 })
    expect(test.backlog.claimReady).toHaveBeenCalledOnce()
  })

  it('reschedules a provider retry and a thrown attempt without losing the entry', async () => {
    const thrown = entry(2, { propertyId: PROPERTY_B, attempts: 4 })
    const entries = [entry(1), thrown]
    const failure = new Error('store unavailable')
    const test = harness([entries], (index) => {
      if (index === 0) {
        return {
          status: 'retry',
          retryAtEpochMillis: NOW + 8_000,
          code: 'provider_unavailable',
        }
      }
      throw failure
    })

    await expect(test.drainer.drain()).resolves.toMatchObject({
      rescheduled: 1,
      failed: 1,
    })
    expect(test.backlog.reschedule).toHaveBeenCalledWith(
      expect.objectContaining({ nextAttemptAtEpochMillis: NOW + 8_000 }),
    )
    expect(test.backlog.reschedule).toHaveBeenCalledWith(
      expect.objectContaining({ nextAttemptAtEpochMillis: NOW + 60_000 }),
    )
    expect(test.backlog.complete).not.toHaveBeenCalled()
    // Only the thrown attempt is recorded, by identifier; the provider retry
    // is an ordinary outcome and says nothing.
    expect(test.logger.warn).toHaveBeenCalledOnce()
    expect(test.logger.warn).toHaveBeenCalledWith(
      {
        err: failure,
        eventEnvelopeId: thrown.eventEnvelopeId,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_B,
        reviewId: thrown.reviewId,
        attempts: 4,
        lane: 'background',
      },
      'AI review analysis backlog entry failed',
    )
  })

  it('says nothing for entries that settle, retry or wait for their lane', async () => {
    const entries = [entry(1), entry(2), entry(3, { propertyId: PROPERTY_B })]
    const test = harness([entries], (index) => {
      if (index === 0) return { status: 'completed' }
      if (index === 1) {
        return {
          status: 'retry',
          retryAtEpochMillis: NOW + 8_000,
          code: 'provider_unavailable',
        }
      }
      return { status: 'retry', retryAtEpochMillis: NOW + 40_000, code: 'admission_busy' }
    })

    await expect(test.drainer.drain()).resolves.toMatchObject({ failed: 0 })
    expect(test.logger.warn).not.toHaveBeenCalled()
  })

  it('records a thrown non-Error by identifier only, never the thrown value', async () => {
    const test = harness([[entry(1)]], () => ({ status: 'completed' }))
    test.analyzeReviewEvent.mockRejectedValueOnce('Guest wrote: the room was cold')

    await expect(test.drainer.drain()).resolves.toMatchObject({ failed: 1 })
    expect(test.logger.warn).toHaveBeenCalledOnce()
    expect(test.logger.warn).toHaveBeenCalledWith(
      expect.not.objectContaining({ err: expect.anything() }),
      'AI review analysis backlog entry failed',
    )
    expect(JSON.stringify(test.logger.warn.mock.calls)).not.toContain('room was cold')
  })

  it('advances the enrollment of each property whose analyses settled', async () => {
    const entries = [
      entry(1, { propertyId: PROPERTY_A }),
      entry(2, { propertyId: PROPERTY_A }),
      entry(3, { propertyId: PROPERTY_B }),
    ]
    const test = harness([entries], (_index, claimed) =>
      claimed.propertyId === PROPERTY_A
        ? { status: 'completed' }
        : { status: 'retry', retryAtEpochMillis: NOW + 40_000, code: 'admission_busy' },
    )

    await test.drainer.drain()

    expect(test.advanceEnrollment).toHaveBeenCalledOnce()
    expect(test.advanceEnrollment).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_A,
    })
  })

  it('keeps its settled work when advancing an enrollment fails, and records it', async () => {
    const test = harness([[entry(1)]], () => ({ status: 'completed' }))
    const failure = new Error('enrollment store unavailable')
    test.advanceEnrollment.mockRejectedValueOnce(failure)

    await expect(test.drainer.drain()).resolves.toMatchObject({ completed: 1 })
    expect(test.logger.warn).toHaveBeenCalledWith(
      { err: failure, organizationId: ORGANIZATION_ID, propertyId: PROPERTY_A },
      'AI review analysis enrollment advance failed',
    )
  })

  it('runs an on-demand review on the interactive lane with headroom for drafts', async () => {
    const requested = entry(1, { priority: 'interactive' })
    const test = harness([[requested]], () => ({ status: 'completed' }))

    await expect(
      test.drainer.drainReview({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_A,
        reviewId: requested.reviewId,
      }),
    ).resolves.toEqual({ status: 'completed' })
    expect(test.analyzeReviewEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        lane: 'interactive',
        admissionHeadroom: AI_ON_DEMAND_ANALYSIS_INTERACTIVE_HEADROOM,
      }),
    )
    expect(test.advanceEnrollment).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_A,
    })
  })

  it('records an on-demand attempt that threw on the interactive lane', async () => {
    const requested = entry(1, { priority: 'interactive', attempts: 2 })
    const failure = new Error('operation store unavailable')
    const test = harness([[requested]], () => {
      throw failure
    })

    await expect(
      test.drainer.drainReview({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_A,
        reviewId: requested.reviewId,
      }),
    ).resolves.toEqual({ status: 'failed' })
    expect(test.logger.warn).toHaveBeenCalledOnce()
    expect(test.logger.warn).toHaveBeenCalledWith(
      {
        err: failure,
        eventEnvelopeId: requested.eventEnvelopeId,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_A,
        reviewId: requested.reviewId,
        attempts: 2,
        lane: 'interactive',
      },
      'AI review analysis backlog entry failed',
    )
    expect(test.advanceEnrollment).not.toHaveBeenCalled()
  })

  it('reports an on-demand review that is not waiting', async () => {
    const test = harness([], () => ({ status: 'completed' }))

    await expect(
      test.drainer.drainReview({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_A,
        reviewId: reviewId('7c000000-0000-4000-8000-000000000999'),
      }),
    ).resolves.toEqual({ status: 'not_pending' })
    expect(test.analyzeReviewEvent).not.toHaveBeenCalled()
  })

  it('leaves a busy on-demand review queued for the next drain', async () => {
    const requested = entry(1, { priority: 'interactive' })
    const test = harness([[requested]], () => ({
      status: 'retry',
      retryAtEpochMillis: NOW + 20_000,
      code: 'admission_busy',
    }))

    await expect(
      test.drainer.drainReview({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_A,
        reviewId: requested.reviewId,
      }),
    ).resolves.toEqual({ status: 'waiting', retryAtEpochMillis: NOW + 20_000 })
    expect(test.backlog.reschedule).toHaveBeenCalledOnce()
  })
})
