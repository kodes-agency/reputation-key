// Invited registration recovery job.
//
// One bounded pass a minute finishes registrations whose request died between
// sign-up and the acceptance transaction (see
// `../../application/use-cases/recover-invited-registrations`).
//
// The tenant-cross schedule is only the enumeration boundary: the firing is
// admitted before any capability is asked, so each acceptance asks
// `authorizeScope` for its own Organization first (kill switch, suspension).
// A refused registration is counted as `denied` and waits for its next turn.
// A policy outage throws from `authorizeScope`, is counted as a failure and
// fails the run so the queue retries it.

import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { OrganizationId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type {
  RecoverInvitedRegistrationsResult,
  RecoverInvitedRegistrationsRun,
} from '../../application/use-cases/recover-invited-registrations'

export const JOB_NAME = 'recover-invited-registrations' as const

type RecoverInvitedRegistrationsHandlerDeps = Readonly<{
  recover: (
    run: RecoverInvitedRegistrationsRun,
  ) => Promise<RecoverInvitedRegistrationsResult>
  authorizeScope: (organizationId: OrganizationId) => Promise<boolean>
  logger: Pick<LoggerPort, 'info'>
}>

/** One bounded, content-free recovery pass per scheduler tick. */
export const createRecoverInvitedRegistrationsHandler =
  (deps: RecoverInvitedRegistrationsHandlerDeps) =>
  async (_job: Job): Promise<void> =>
    trace(`job.${JOB_NAME}`, async () => {
      const result = await deps.recover({
        authorizeOrganization: (organizationId) => deps.authorizeScope(organizationId),
      })
      deps.logger.info(
        {
          job: JOB_NAME,
          claimed: result.claimed,
          accepted: result.accepted,
          denied: result.denied,
          awaitingProvider: result.awaitingProvider,
          compensated: result.compensated,
          manualReview: result.manualReview,
          failures: result.failures,
        },
        'Invited registration recovery completed',
      )
      if (result.failures > 0) {
        throw new Error(
          `Invited registration recovery left ${result.failures} verification ${result.failures === 1 ? 'record' : 'records'} unresolved`,
        )
      }
    })
