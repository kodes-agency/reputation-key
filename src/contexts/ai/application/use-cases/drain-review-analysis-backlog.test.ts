import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { AI_ON_DEMAND_ANALYSIS_INTERACTIVE_HEADROOM } from '../../domain/admission-lanes'
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
  createDrainReviewAnalysisBacklog,
} from './drain-review-analysis-backlog'

const NOW = Date.parse('2026-09-15T12:00:00.000Z')
const ORGANIZATION_ID = organizationId('drain-backlog-org')
const PROPERTY_A = propertyId('7a000000-0000-4000-8000-000000000001')
const PROPERTY_B = propertyId('7a000000-0000-4000-8000-000000000002')

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

function harness(
  claimed: ReadonlyArray<AiReviewAnalysisBacklogEntry>,
  answer: (index: number) => AnalyzeReviewEventResult,
) {
  let calls = 0
  const analyzeReviewEvent = vi.fn(async () => answer(calls++))
  const backlog = {
    enqueue: vi.fn(),
    claimReady: vi.fn(async () => claimed),
    claimForReview: vi.fn(async () => claimed[0] ?? null),
    complete: vi.fn(async () => {}),
    reschedule: vi.fn(async () => {}),
    readProgress: vi.fn(),
    hasPendingForReview: vi.fn(),
  } satisfies AiReviewAnalysisBacklogPort
  const drainer = createDrainReviewAnalysisBacklog({
    backlog,
    analyzeReviewEvent,
    nowEpochMillis: () => NOW,
  })
  return { drainer, backlog, analyzeReviewEvent }
}

describe('drainReviewAnalysisBacklog', () => {
  it('runs claimed entries in their lane from their first start and removes settled ones', async () => {
    const first = entry(1)
    const test = harness([first], () => ({ status: 'completed' }))

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
    const test = harness([entry(1)], () => result)

    await test.drainer.drain()

    expect(test.backlog.complete).toHaveBeenCalledOnce()
    expect(test.backlog.reschedule).not.toHaveBeenCalled()
  })

  it('parks the rest of a busy property at the lane retry time without asking again', async () => {
    const entries = [entry(1), entry(2), entry(3)]
    const test = harness(entries, () => ({
      status: 'retry',
      retryAtEpochMillis: NOW + 40_000,
      code: 'admission_busy',
    }))

    await expect(test.drainer.drain()).resolves.toMatchObject({ waitingForLane: 3 })
    expect(test.analyzeReviewEvent).toHaveBeenCalledOnce()
    for (const waiting of entries) {
      expect(test.backlog.reschedule).toHaveBeenCalledWith({
        eventEnvelopeId: waiting.eventEnvelopeId,
        organizationId: ORGANIZATION_ID,
        nextAttemptAtEpochMillis: NOW + 40_000,
        nowEpochMillis: NOW,
      })
    }
  })

  it('keeps draining other properties when one is busy', async () => {
    const busy = entry(1, { propertyId: PROPERTY_A })
    const other = entry(2, { propertyId: PROPERTY_B })
    const test = harness([busy, other], (index) =>
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

  it('reschedules a provider retry and a thrown attempt without losing the entry', async () => {
    const entries = [entry(1), entry(2, { propertyId: PROPERTY_B })]
    let call = 0
    const test = harness(entries, () => {
      call += 1
      if (call === 1) {
        return {
          status: 'retry',
          retryAtEpochMillis: NOW + 8_000,
          code: 'provider_unavailable',
        }
      }
      throw new Error('store unavailable')
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
  })

  it('runs an on-demand review on the interactive lane with headroom for drafts', async () => {
    const requested = entry(1, { priority: 'interactive' })
    const test = harness([requested], () => ({ status: 'completed' }))

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
    const test = harness([requested], () => ({
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
