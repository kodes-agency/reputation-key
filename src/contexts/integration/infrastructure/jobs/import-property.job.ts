import type { Job } from 'bullmq'
import type { JobHandler } from '#/shared/jobs/registry'
import type { ImportPropertyJobData } from '../../application/ports/gbp-queue.port'
import type { ImportPropertyUseCase } from '../../application/use-cases/import-property'

export type { ImportPropertyJobData }

type ImportPropertyHandlerDeps = Readonly<{
  importPropertyUseCase: ImportPropertyUseCase
}>

export const createImportPropertyHandler = (
  deps: ImportPropertyHandlerDeps,
): JobHandler<ImportPropertyJobData> => {
  return async (job: Job<ImportPropertyJobData>) => {
    const { jobId, organizationId, connectionId, locations } = job.data

    await deps.importPropertyUseCase({
      jobId,
      organizationId,
      connectionId,
      locations: locations.map((loc) => ({
        gbpPlaceId: loc.gbpPlaceId,
        businessName: loc.businessName,
        gbpLocationName: loc.gbpLocationName,
      })),
    })
  }
}
