import { APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS } from '../../application/approved-destination-age'
import type { PortalApprovedDestinationId } from '#/shared/domain/ids'
import type { AlertDispatcher } from '#/shared/observability/alert-dispatcher'
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
  visitedIds: [],
  oldestUnvalidatedAgeMs: 0,
  scanned: 0,
  validated: 0,
  quarantined: 0,
  unavailable: 0,
  unauthorized: 0,
  stale: 0,
}

const addOutcomes = (total: Outcome, page: Outcome): Outcome => ({
  visitedIds: page.visitedIds,
  oldestUnvalidatedAgeMs: Math.max(
    total.oldestUnvalidatedAgeMs,
    page.oldestUnvalidatedAgeMs,
  ),
  scanned: total.scanned + page.scanned,
  validated: total.validated + page.validated,
  quarantined: total.quarantined + page.quarantined,
  unavailable: total.unavailable + page.unavailable,
  unauthorized: total.unauthorized + page.unauthorized,
  stale: total.stale + page.stale,
})

/** Keep oldest-first priority while excluding every row already visited this run. */
export const createRevalidateApprovedDestinationsHandler =
  (
    deps: Readonly<{
      revalidate: RevalidatePortalApprovedDestinations
      authorizeScope: (organizationId: string, propertyId: string) => Promise<boolean>
      clock: Clock
      logger: Pick<LoggerPort, 'info'>
      alertDispatcher: AlertDispatcher
    }>,
  ) =>
  async (_job: Job): Promise<void> => {
    const at = deps.clock()
    const startedAt = at.getTime()
    const visitedIds: PortalApprovedDestinationId[] = []
    let budgetExhausted = false
    let total = NO_OUTCOME
    let pages = 0
    for (;;) {
      const page = await deps.revalidate({
        limit: REVALIDATION_PAGE_SIZE,
        at,
        excludeIds: visitedIds,
        authorizeScope: deps.authorizeScope,
      })
      total = addOutcomes(total, page)
      pages += 1
      if (page.scanned < REVALIDATION_PAGE_SIZE) break
      if (page.visitedIds.length === 0)
        throw new Error('Full revalidation page has no visited ids')
      visitedIds.push(...page.visitedIds)
      if (deps.clock().getTime() - startedAt >= REVALIDATION_RUN_BUDGET_MS) {
        budgetExhausted = true
        break
      }
    }
    // Aggregate counts only. Destination, tenant, Property, hostname, URI and
    // network answers never enter job data or logs.
    const { visitedIds: _visited, oldestUnvalidatedAgeMs, ...counts } = total
    if (
      budgetExhausted ||
      oldestUnvalidatedAgeMs >= APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS
    ) {
      await deps.alertDispatcher.dispatch({
        name: 'portal.destination-revalidation-lag',
        severity: 'P2',
        owner: 'portal',
        runbook: 'src/contexts/portal/CONTEXT.md#destination-revalidation',
        value: budgetExhausted
          ? deps.clock().getTime() - startedAt
          : oldestUnvalidatedAgeMs,
        threshold: budgetExhausted
          ? REVALIDATION_RUN_BUDGET_MS
          : APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS,
        windowMs: REVALIDATION_RUN_BUDGET_MS,
        detail: budgetExhausted
          ? 'Destination revalidation exhausted its run budget; due work may remain'
          : 'Destination network checks remain unavailable past the validation freshness limit',
      })
    }
    deps.logger.info(
      { job: JOB_NAME, pages, ...counts },
      'Portal approved-destination revalidation completed',
    )
  }
