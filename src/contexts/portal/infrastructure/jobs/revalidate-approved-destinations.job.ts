import type { Job } from 'bullmq'
import type { RevalidatePortalApprovedDestinations } from '../../application/use-cases/manage-portal-approved-destinations'
import type { Clock } from '#/shared/domain/clock'
import type { LoggerPort } from '#/shared/domain/logger.port'

export const JOB_NAME = 'portal-approved-destination-revalidation' as const

/** Destinations taken in one page (the control caps a page at 500). */
export const REVALIDATION_PAGE_SIZE = 50

/**
 * No new page starts once a run has used this long. The job's own timeout is
 * 5 minutes (`PORTAL_BACKGROUND_JOB_ROWS`) and fails the run when it passes, so
 * the budget leaves the rest of it for the page already in flight.
 */
export const REVALIDATION_RUN_BUDGET_MS = 150_000

type Outcome = Awaited<ReturnType<RevalidatePortalApprovedDestinations>>

const NO_OUTCOME: Outcome = {
  scanned: 0,
  validated: 0,
  quarantined: 0,
  unavailable: 0,
  unauthorized: 0,
  stale: 0,
}

const addOutcomes = (total: Outcome, page: Outcome): Outcome => ({
  scanned: total.scanned + page.scanned,
  validated: total.validated + page.validated,
  quarantined: total.quarantined + page.quarantined,
  unavailable: total.unavailable + page.unavailable,
  unauthorized: total.unauthorized + page.unauthorized,
  stale: total.stale + page.stale,
})

/**
 * Takes pages of due destinations, oldest first, until one of three things
 * ends the run: a page comes back short (nothing else is due), a page left
 * nothing validated or quarantined (the rows it took stay due and would head
 * the next page too), or the run budget is spent.
 */
export const createRevalidateApprovedDestinationsHandler =
  (
    deps: Readonly<{
      revalidate: RevalidatePortalApprovedDestinations
      authorizeScope: (organizationId: string, propertyId: string) => Promise<boolean>
      clock: Clock
      logger: Pick<LoggerPort, 'info'>
    }>,
  ) =>
  async (_job: Job): Promise<void> => {
    const startedAt = deps.clock().getTime()
    let total = NO_OUTCOME
    let pages = 0
    for (;;) {
      const page = await deps.revalidate({
        limit: REVALIDATION_PAGE_SIZE,
        authorizeScope: deps.authorizeScope,
      })
      total = addOutcomes(total, page)
      pages += 1
      if (page.scanned < REVALIDATION_PAGE_SIZE) break
      if (page.validated + page.quarantined === 0) break
      if (deps.clock().getTime() - startedAt >= REVALIDATION_RUN_BUDGET_MS) break
    }
    // Aggregate counts only. Destination, tenant, Property, hostname, URI and
    // network answers never enter job data or logs.
    deps.logger.info(
      { job: JOB_NAME, pages, ...total },
      'Portal approved-destination revalidation completed',
    )
  }
