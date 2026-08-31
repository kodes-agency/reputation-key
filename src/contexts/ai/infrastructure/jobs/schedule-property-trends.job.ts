import type { Job } from 'bullmq'
import { z } from 'zod/v4'
import type { SchedulePropertyTrendsResult } from '../../application/use-cases/schedule-property-trends'

export const SCHEDULE_PROPERTY_TRENDS_JOB_NAME = 'schedule-property-ai-trends'

const schedulePropertyTrendsJobData = z.object({}).strict()

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
