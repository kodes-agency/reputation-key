import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import type { RecoverInvitedRegistrationsResult } from '../../application/use-cases/recover-invited-registrations'

export const JOB_NAME = 'recover-invited-registrations' as const

type RecoverInvitedRegistrationsHandlerDeps = Readonly<{
  recover: () => Promise<RecoverInvitedRegistrationsResult>
  logger: Pick<LoggerPort, 'info'>
}>

/** One bounded, content-free recovery pass per scheduler tick. */
export const createRecoverInvitedRegistrationsHandler =
  (deps: RecoverInvitedRegistrationsHandlerDeps) =>
  async (_job: Job): Promise<void> =>
    trace(`job.${JOB_NAME}`, async () => {
      const result = await deps.recover()
      deps.logger.info(
        {
          job: JOB_NAME,
          claimed: result.claimed,
          accepted: result.accepted,
          awaitingProvider: result.awaitingProvider,
          compensated: result.compensated,
          manualReview: result.manualReview,
          claimsLost: result.claimsLost,
          failures: result.failures,
        },
        'Invited registration recovery completed',
      )
      if (result.failures > 0) {
        throw new Error(
          `Invited registration recovery left ${result.failures} attempt unresolved`,
        )
      }
    })
