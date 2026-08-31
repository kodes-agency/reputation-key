// Activity context — BullMQ worker job handler
// Consumes jobs from the 'default' queue with name 'project-recent-activity'.
// Per architecture (ADR 0010): "Worker consumes jobs, calls projectRecentActivity use case."

import type {
  ProjectRecentActivityDeps,
  ProjectRecentActivityInput,
} from '../../application/use-cases/project-recent-activity'
import { projectRecentActivity } from '../../application/use-cases/project-recent-activity'
import type { Job } from 'bullmq'

export const PROJECT_RECENT_ACTIVITY_JOB_NAME = 'project-recent-activity'
/**
 * Rolling-deployment drain identifier only. No producer may enqueue it after
 * migration 0160; bootstrap retains the handler until old queue depth is zero.
 */
export const LEGACY_INSERT_ACTIVITY_LOG_JOB_NAME = 'insert-activity-log'

export type ProjectRecentActivityJobData = ProjectRecentActivityInput

export const createProjectRecentActivityHandler = (deps: ProjectRecentActivityDeps) => {
  const useCase = projectRecentActivity(deps)
  const log = deps.logger.child({ component: 'project-recent-activity-job' })
  return async (job: Job<ProjectRecentActivityJobData>): Promise<void> => {
    // BQC-7.3: no jobId/resourceId in log bindings — jobName is implicit.
    log.info('Processing Recent Activity projection job')
    await useCase(job.data)
    log.info('Inserted Recent Activity entry')
  }
}
