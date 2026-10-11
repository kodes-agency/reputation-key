// AI job enqueue unit tests.
//
// What a producer can get wrong here is the payload: both families are
// property-scoped, so the delayed-execution gate needs the Organization and
// Property in it, and both handlers refuse anything but the identifiers they
// name. Each enqueue is therefore read back through its own handler.

import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import {
  createAnalyzeReviewNowEnqueue,
  createPropertyTrendEnqueue,
} from './ai-job-enqueue'
import {
  ANALYZE_REVIEW_NOW_JOB_NAME,
  createAnalyzeReviewNowJobHandler,
} from './analyze-review-now.job'
import {
  createGeneratePropertyTrendJobHandler,
  GENERATE_PROPERTY_TREND_JOB_NAME,
} from './generate-property-trend.job'

const ORGANIZATION_ID = 'ai-job-enqueue-test'
const PROPERTY_ID = '71000000-0000-4000-8000-000000000401'
const SCHEDULE_ID = '71000000-0000-4000-8000-000000000402'
const REVIEW_ID = '71000000-0000-4000-8000-000000000403'
const TREND = {
  scheduleId: SCHEDULE_ID,
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
} as const
const REVIEW = {
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  reviewId: REVIEW_ID,
} as const

function createQueue() {
  const add = vi.fn(async (_name: string, _data: unknown, _options?: unknown) => ({}))
  return { add }
}

const job = (data: unknown) => ({ data }) as unknown as Job

describe('property AI trend enqueue', () => {
  it('queues the schedule with the Organization and Property the gate decides on', async () => {
    const queue = createQueue()

    await createPropertyTrendEnqueue(queue)(TREND)

    expect(queue.add).toHaveBeenCalledExactlyOnceWith(
      GENERATE_PROPERTY_TREND_JOB_NAME,
      TREND,
      {
        // One job per schedule: a redelivered request coalesces.
        jobId: `ai-trend-${SCHEDULE_ID}`,
        ...jobEnqueueOptions(GENERATE_PROPERTY_TREND_JOB_NAME),
        removeOnComplete: true,
        removeOnFail: { count: 50 },
      },
    )
  })

  it('refuses to queue a schedule without its scope', async () => {
    const queue = createQueue()
    const enqueue = createPropertyTrendEnqueue(queue)

    await expect(enqueue({ ...TREND, organizationId: '' })).rejects.toThrow()
    await expect(enqueue({ ...TREND, propertyId: 'not-a-property' })).rejects.toThrow()
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('queues exactly what the trend handler accepts', async () => {
    const queue = createQueue()
    const generatePropertyTrend = vi.fn(async () => ({ status: 'completed' as const }))
    await createPropertyTrendEnqueue(queue)(TREND)
    const [, enqueued] = queue.add.mock.calls[0]!

    await createGeneratePropertyTrendJobHandler({ generatePropertyTrend })(job(enqueued))

    expect(generatePropertyTrend).toHaveBeenCalledExactlyOnceWith({
      scheduleId: SCHEDULE_ID,
      organizationId: organizationId(ORGANIZATION_ID),
      propertyId: propertyId(PROPERTY_ID),
    })
  })
})

describe('on-demand review analysis enqueue', () => {
  it('queues the review with its scope, one waiting job per review', async () => {
    const queue = createQueue()

    await createAnalyzeReviewNowEnqueue(queue)(REVIEW)

    expect(queue.add).toHaveBeenCalledExactlyOnceWith(
      ANALYZE_REVIEW_NOW_JOB_NAME,
      REVIEW,
      {
        jobId: `ai-analysis-now-${REVIEW_ID}`,
        ...jobEnqueueOptions(ANALYZE_REVIEW_NOW_JOB_NAME),
        removeOnComplete: true,
        removeOnFail: { count: 50 },
      },
    )
  })

  // The request use case hands over its whole input; the strict handler would
  // throw on anything that rode along with the identifiers.
  it('queues the identifiers alone, which is all the handler accepts', async () => {
    const queue = createQueue()
    const drainReview = vi.fn(async () => ({ status: 'not_pending' as const }))
    await createAnalyzeReviewNowEnqueue(queue)({
      ...REVIEW,
      requestedBy: 'manager-1',
    } as typeof REVIEW)
    const [, enqueued] = queue.add.mock.calls[0]!

    expect(enqueued).toEqual(REVIEW)
    await createAnalyzeReviewNowJobHandler({ drainReview })(job(enqueued))

    expect(drainReview).toHaveBeenCalledExactlyOnceWith({
      organizationId: organizationId(ORGANIZATION_ID),
      propertyId: propertyId(PROPERTY_ID),
      reviewId: reviewId(REVIEW_ID),
    })
  })
})
