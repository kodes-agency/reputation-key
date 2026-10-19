import type { Job } from 'bullmq'
import { z } from 'zod/v4'
import { redriveMetadataSchema } from '#/shared/jobs/failure-quarantine'
import type { SchedulePropertyTrendsResult } from '../../application/use-cases/schedule-property-trends'

export const SCHEDULE_PROPERTY_TRENDS_JOB_NAME = 'schedule-property-ai-trends'

// Empty but for what a quarantine redrive adds. That applies to on-demand or
// legacy dead letters only: a firing of this schedule is never dead-lettered.
const schedulePropertyTrendsJobData = z
  .object({ redriveMetadata: redriveMetadataSchema.optional() })
  .strict()

export type SchedulePropertyTrendsJobDependencies = Readonly<{
  idGen: () => string
  schedulePropertyTrends(
    input: Readonly<{
      leaseOwner: string
    }>,
  ): Promise<SchedulePropertyTrendsResult>
}>

export const createSchedulePropertyTrendsJobHandler = (
  dependencies: SchedulePropertyTrendsJobDependencies,
): ((job: Job) => Promise<void>) => {
  return async (job) => {
    schedulePropertyTrendsJobData.parse(job.data)
    await dependencies.schedulePropertyTrends({
      leaseOwner: dependencies.idGen(),
    })
  }
}
