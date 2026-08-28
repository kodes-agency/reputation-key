import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import { organizationLifecycleJobError } from '../organization-lifecycle-job-error'

export const JOB_NAME = 'purge-expired-organization-exports' as const

type PurgeExpiredOrganizationExportsHandlerDeps = Readonly<{
  purgeNextExpired?: () => Promise<boolean>
  logger: Pick<LoggerPort, 'info'>
}>

export const createPurgeExpiredOrganizationExportsHandler = (
  deps: PurgeExpiredOrganizationExportsHandlerDeps,
) => {
  return async (
    _job: Job,
  ): Promise<Readonly<{ configured: boolean; deleted: boolean }>> =>
    trace(`job.${JOB_NAME}`, async () => {
      if (!deps.purgeNextExpired) {
        deps.logger.info(
          { job: JOB_NAME, configured: false, deleted: false },
          'Organization Export deletion remains storage-gated',
        )
        return { configured: false, deleted: false }
      }
      try {
        const deleted = await deps.purgeNextExpired()
        const result = { configured: true, deleted }
        deps.logger.info(
          { job: JOB_NAME, ...result },
          'Organization Export deletion pass completed',
        )
        return result
      } catch {
        throw organizationLifecycleJobError('export_deletion_failed')
      }
    })
}
