import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import type { GeneratedOrganizationExport } from '../../application/ports/organization-export.port'
import { organizationLifecycleJobError } from '../organization-lifecycle-job-error'

export const JOB_NAME = 'generate-organization-export' as const

type GenerateOrganizationExportHandlerDeps = Readonly<{
  generateNext?: () => Promise<GeneratedOrganizationExport | null>
  logger: Pick<LoggerPort, 'info'>
}>

export const createGenerateOrganizationExportHandler = (
  deps: GenerateOrganizationExportHandlerDeps,
) => {
  return async (
    _job: Job,
  ): Promise<Readonly<{ configured: boolean; claimed: boolean }>> =>
    trace(`job.${JOB_NAME}`, async () => {
      if (!deps.generateNext) {
        deps.logger.info(
          { job: JOB_NAME, configured: false, claimed: false },
          'Organization Export generation remains contributor-gated',
        )
        return { configured: false, claimed: false }
      }
      try {
        const generated = await deps.generateNext()
        const result = { configured: true, claimed: generated !== null }
        deps.logger.info(
          { job: JOB_NAME, ...result },
          'Organization Export generation pass completed',
        )
        return result
      } catch {
        throw organizationLifecycleJobError('export_generation_failed')
      }
    })
}
