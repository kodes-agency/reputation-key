// Feed activity surface — drain-only BullMQ handlers on the 'default' queue for
// the retired Recent Activity accelerator. Nothing has enqueued
// 'project-recent-activity' since the in-process event bus was deleted (WP3.1,
// ec76dc15f); Recent Activity is delivered by the `activity.recent-activity`
// outbox consumer (ADR 0056, "Merged from ADR 0010").

import type {
  ProjectRecentActivityDeps,
  ProjectRecentActivityInput,
} from '../../application/use-cases/project-recent-activity'
import { projectRecentActivity } from '../../application/use-cases/project-recent-activity'
import type { Job } from 'bullmq'

export const PROJECT_RECENT_ACTIVITY_JOB_NAME = 'project-recent-activity'
/**
 * Rolling-deployment drain identifier only. Nothing has enqueued it since
 * 2026-08-28, when 7ba8f44be renamed the job to 'project-recent-activity' with
 * the former migration 0160_recent_activity_identifiers (squashed into
 * 0000_baseline on 2026-09-06, so that number no longer names a file). Remove
 * both drain handlers once no job of either name is waiting, delayed or failed
 * on the 'default' queue in any environment; zero counts from
 * `pnpm ops queue status default --operator <id>` are sufficient proof.
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
