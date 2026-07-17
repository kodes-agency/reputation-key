import type { Job } from 'bullmq'
import type { JobHandler } from '#/shared/jobs/registry'
import type { ImportPropertyJobData } from '../../application/ports/gbp-queue.port'
import type { ImportPropertyUseCase } from '../../application/use-cases/import-property'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { isCapabilityJobEnabled } from '#/shared/auth/beta-capabilities'

export type { ImportPropertyJobData }

export const JOB_NAME = 'import-property' as const

type ImportPropertyHandlerDeps = Readonly<{
  importPropertyUseCase: ImportPropertyUseCase
}>

export const createImportPropertyHandler = (
  deps: ImportPropertyHandlerDeps,
): JobHandler<ImportPropertyJobData> => {
  return async (job: Job<ImportPropertyJobData>) => {
    return trace('job.importProperty', async () => {
      const logger = getLogger()
      const { jobId, organizationId, connectionId, locations } = job.data

      // BQC-0.4 stop control: already-enqueued work must not call Google after
      // the capability is switched off (jobs are skipped, not deleted).
      if (!isCapabilityJobEnabled('property.connect_gbp')) {
        logger.info(
          { jobId, organizationId },
          'BQC-0.4: import skipped — property.connect_gbp is disabled',
        )
        return
      }

      logger.info(
        { jobId, organizationId, connectionId, locationCount: locations.length },
        'Importing properties',
      )

      try {
        await deps.importPropertyUseCase({
          jobId,
          organizationId,
          connectionId,
          locations: locations.map((loc) => ({
            gbpPlaceId: loc.gbpPlaceId,
            businessName: loc.businessName,
            gbpLocationName: loc.gbpLocationName,
            countryCode: loc.countryCode ?? null,
          })),
        })

        logger.info({ jobId, organizationId }, 'Import properties completed')
      } catch (err) {
        logger.error(
          { err, jobId, organizationId, connectionId },
          'Import properties failed',
        )
        throw err
      }
    })
  }
}
