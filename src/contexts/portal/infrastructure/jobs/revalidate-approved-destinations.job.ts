import type { Job } from 'bullmq'
import type { RevalidatePortalApprovedDestinations } from '../../application/use-cases/manage-portal-approved-destinations'
import type { LoggerPort } from '#/shared/domain/logger.port'

export const JOB_NAME = 'portal-approved-destination-revalidation' as const

export const createRevalidateApprovedDestinationsHandler =
  (
    deps: Readonly<{
      revalidate: RevalidatePortalApprovedDestinations
      authorizeScope: (organizationId: string, propertyId: string) => Promise<boolean>
      logger: Pick<LoggerPort, 'info'>
    }>,
  ) =>
  async (_job: Job): Promise<void> => {
    const outcome = await deps.revalidate({
      limit: 100,
      authorizeScope: deps.authorizeScope,
    })
    // Aggregate counts only. Destination, tenant, Property, hostname, URI and
    // network answers never enter job data or logs.
    deps.logger.info(
      { job: JOB_NAME, ...outcome },
      'Portal approved-destination revalidation completed',
    )
  }
