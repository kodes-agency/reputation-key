// A quarantine redrive is the repair command the catalogue names for every
// job family (`pnpm ops quarantine redrive`). It puts the dead-lettered payload
// back on its queue with a `redriveMetadata` entry added. The four AI handlers
// parse their payload strictly, so each is read here through the real redrive:
// a handler that refuses what the redrive adds can never be repaired by it.

import { describe, expect, it, vi } from 'vitest'
import type { Job, JobProgress, JobsOptions } from 'bullmq'
import { ZodError } from 'zod/v4'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  createRedriveJob,
  quarantineExhaustedJob,
} from '#/shared/jobs/failure-quarantine'
import {
  ANALYZE_REVIEW_NOW_JOB_NAME,
  createAnalyzeReviewNowJobHandler,
} from './analyze-review-now.job'
import {
  createDrainReviewAnalysisBacklogJobHandler,
  DRAIN_REVIEW_ANALYSIS_BACKLOG_JOB_NAME,
} from './drain-review-analysis-backlog.job'
import {
  createGeneratePropertyTrendJobHandler,
  GENERATE_PROPERTY_TREND_JOB_NAME,
} from './generate-property-trend.job'
import {
  createSchedulePropertyTrendsJobHandler,
  SCHEDULE_PROPERTY_TRENDS_JOB_NAME,
} from './schedule-property-trends.job'

const ORGANIZATION_ID = 'ai-job-redrive-test'
const PROPERTY_ID = '71000000-0000-4000-8000-000000000501'
const SCHEDULE_ID = '71000000-0000-4000-8000-000000000502'
const REVIEW_ID = '71000000-0000-4000-8000-000000000503'

type Stored = {
  id: string
  name: string
  data: unknown
  progress: JobProgress
  updateProgress: (progress: JobProgress) => Promise<void>
  getState: () => Promise<string>
  remove: () => Promise<void>
}

/** The slice of a BullMQ queue the quarantine and the redrive use. */
function memoryQueue() {
  const jobs = new Map<string, Stored>()
  return {
    jobs,
    add: async (name: string, data: unknown, opts?: JobsOptions) => {
      const stored: Stored = {
        id: opts?.jobId ?? `job-${jobs.size + 1}`,
        name,
        data,
        progress: 0,
        updateProgress: async (progress) => {
          stored.progress = progress
        },
        getState: async () => 'waiting',
        remove: async () => {
          jobs.delete(stored.id)
        },
      }
      jobs.set(stored.id, stored)
      return stored
    },
    getJob: async (id: string) => jobs.get(id),
    getJobs: async () => [...jobs.values()],
  }
}

/** The job a worker receives after an operator redrives this dead-lettered payload. */
async function redriven(jobName: string, data: unknown): Promise<Job> {
  const quarantine = memoryQueue()
  const target = memoryQueue()
  const exhausted = {
    id: 'exhausted-1',
    name: jobName,
    queueName: 'default',
    data,
    attemptsMade: 1,
    opts: { attempts: 1 },
  } as unknown as Job
  const staged = await quarantineExhaustedJob(
    quarantine,
    exhausted,
    new Error('provider timeout'),
  )
  const outcome = await createRedriveJob(
    quarantine,
    () => target,
  )(staged.quarantineJobId ?? '')
  expect(outcome).toMatchObject({ redriven: true, targetQueue: 'default' })
  const [job] = [...target.jobs.values()]
  if (!job) throw new Error('the redrive queued nothing')
  expect(job.data).toMatchObject({ redriveMetadata: { redrivenFrom: 'quarantine' } })
  return { name: job.name, data: job.data } as unknown as Job
}

describe('AI job handlers after a quarantine redrive', () => {
  it('analyses the redriven review', async () => {
    const drainReview = vi.fn(async () => ({ status: 'not_pending' as const }))
    const job = await redriven(ANALYZE_REVIEW_NOW_JOB_NAME, {
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
    })

    await createAnalyzeReviewNowJobHandler({ drainReview })(job)

    expect(drainReview).toHaveBeenCalledExactlyOnceWith({
      organizationId: organizationId(ORGANIZATION_ID),
      propertyId: propertyId(PROPERTY_ID),
      reviewId: reviewId(REVIEW_ID),
    })
  })

  it('generates the redriven Property trend', async () => {
    const generatePropertyTrend = vi.fn(async () => ({ status: 'completed' as const }))
    const job = await redriven(GENERATE_PROPERTY_TREND_JOB_NAME, {
      scheduleId: SCHEDULE_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
    })

    await createGeneratePropertyTrendJobHandler({ generatePropertyTrend })(job)

    expect(generatePropertyTrend).toHaveBeenCalledExactlyOnceWith({
      scheduleId: SCHEDULE_ID,
      organizationId: organizationId(ORGANIZATION_ID),
      propertyId: propertyId(PROPERTY_ID),
    })
  })

  it('runs the redriven backlog drain', async () => {
    const drain = vi.fn(async () => ({
      claimed: 0,
      analysed: 0,
      denied: 0,
      failed: 0,
      timedOut: false,
    }))
    const authorizeScope = vi.fn(async () => true)
    const job = await redriven(DRAIN_REVIEW_ANALYSIS_BACKLOG_JOB_NAME, {})

    await createDrainReviewAnalysisBacklogJobHandler({
      drain: drain as never,
      authorizeScope: authorizeScope as never,
      logger: { info: vi.fn() },
    })(job)

    expect(drain).toHaveBeenCalledExactlyOnceWith({ authorizeScope })
  })

  it('runs the redriven trend schedule', async () => {
    const schedulePropertyTrends = vi.fn(async () => ({}) as never)
    const job = await redriven(SCHEDULE_PROPERTY_TRENDS_JOB_NAME, {})

    await createSchedulePropertyTrendsJobHandler({
      idGen: () => 'lease-owner-1',
      schedulePropertyTrends,
    })(job)

    expect(schedulePropertyTrends).toHaveBeenCalledExactlyOnceWith({
      leaseOwner: 'lease-owner-1',
    })
  })

  // The payload still carries no authority: the marker is the one addition.
  it('still refuses any other key, and a marker that is not a redrive', async () => {
    const drainReview = vi.fn(async () => ({ status: 'not_pending' as const }))
    const handler = createAnalyzeReviewNowJobHandler({ drainReview })
    const identifiers = {
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
    }

    await expect(
      handler({ data: { ...identifiers, requestedBy: 'manager-1' } } as unknown as Job),
    ).rejects.toThrow(ZodError)
    await expect(
      handler({
        data: { ...identifiers, redriveMetadata: { redrivenFrom: 'elsewhere' } },
      } as unknown as Job),
    ).rejects.toThrow(ZodError)
    expect(drainReview).not.toHaveBeenCalled()
  })
})
