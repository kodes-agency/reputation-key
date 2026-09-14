import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { createAnalyzeReviewNowJobHandler } from './analyze-review-now.job'
import { createDrainReviewAnalysisBacklogJobHandler } from './drain-review-analysis-backlog.job'

const job = (data: unknown) => ({ data }) as Job

describe('review analysis backlog jobs', () => {
  it('drains and logs only when something was claimed', async () => {
    const info = vi.fn()
    const drain = vi
      .fn()
      .mockResolvedValueOnce({
        claimed: 0,
        completed: 0,
        rescheduled: 0,
        waitingForLane: 0,
        failed: 0,
      })
      .mockResolvedValueOnce({
        claimed: 3,
        completed: 2,
        rescheduled: 0,
        waitingForLane: 1,
        failed: 0,
      })
    const handler = createDrainReviewAnalysisBacklogJobHandler({
      drain,
      logger: { info },
    })

    await handler(job({}))
    await handler(job({}))

    expect(drain).toHaveBeenCalledTimes(2)
    expect(info).toHaveBeenCalledOnce()
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ claimed: 3, waitingForLane: 1 }),
      'AI Review Analysis backlog drain completed',
    )
  })

  it('analyses exactly the requested review', async () => {
    const drainReview = vi.fn(async () => ({ status: 'completed' as const }))
    const handler = createAnalyzeReviewNowJobHandler({ drainReview })

    await handler(
      job({
        organizationId: 'org-1',
        propertyId: '7f000000-0000-4000-8000-000000000001',
        reviewId: '7f000000-0000-4000-8000-000000000002',
      }),
    )

    expect(drainReview).toHaveBeenCalledWith({
      organizationId: 'org-1',
      propertyId: '7f000000-0000-4000-8000-000000000001',
      reviewId: '7f000000-0000-4000-8000-000000000002',
    })
  })

  it('refuses a payload that carries anything but identifiers', async () => {
    const handler = createAnalyzeReviewNowJobHandler({ drainReview: vi.fn() })

    await expect(
      handler(
        job({
          organizationId: 'org-1',
          propertyId: '7f000000-0000-4000-8000-000000000001',
          reviewId: '7f000000-0000-4000-8000-000000000002',
          text: 'review text',
        }),
      ),
    ).rejects.toThrow()
  })
})
