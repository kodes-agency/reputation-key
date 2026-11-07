// AI job enqueue unit tests.
//
// What a producer can get wrong here is the payload: the family is
// property-scoped, so the delayed-execution gate needs the Organization and
// Property in it, and the handler refuses anything but the identifiers they
// name. Each enqueue is therefore read back through its own handler.

import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import { createAnalyzeReviewNowEnqueue } from './ai-job-enqueue'
import {
  ANALYZE_REVIEW_NOW_JOB_NAME,
  createAnalyzeReviewNowJobHandler,
} from './analyze-review-now.job'

const ORGANIZATION_ID = 'ai-job-enqueue-test'
const PROPERTY_ID = '71000000-0000-4000-8000-000000000401'
const REVIEW_ID = '71000000-0000-4000-8000-000000000403'
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
        // A kept failed job would hold the review's id and swallow the next
        // request (ai-job-enqueue.integration.test.ts).
        removeOnFail: true,
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
