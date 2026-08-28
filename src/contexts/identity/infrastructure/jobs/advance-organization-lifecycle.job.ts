import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import type { AdvanceOrganizationLifecycleResult } from '../../application/use-cases/advance-organization-lifecycle'
import { organizationLifecycleJobError } from '../organization-lifecycle-job-error'

export const JOB_NAME = 'advance-organization-lifecycle' as const

type AdvanceOrganizationLifecycleHandlerDeps = Readonly<{
  advance?: (
    input?: Readonly<{ limit?: number }>,
  ) => Promise<AdvanceOrganizationLifecycleResult>
  logger: Pick<LoggerPort, 'info'>
}>

export type AdvanceOrganizationLifecycleJobResult =
  | Readonly<{ configured: false }>
  | (Readonly<{ configured: true }> & AdvanceOrganizationLifecycleResult)

/**
 * One bounded pass. The safety handler remains registered while the schedule
 * is quarantined, so a stale queued firing completes without inventing a
 * lifecycle receipt or mutation.
 */
export const createAdvanceOrganizationLifecycleHandler = (
  deps: AdvanceOrganizationLifecycleHandlerDeps,
) => {
  return async (_job: Job): Promise<AdvanceOrganizationLifecycleJobResult> =>
    trace(`job.${JOB_NAME}`, async () => {
      if (!deps.advance) {
        deps.logger.info(
          { job: JOB_NAME, configured: false },
          'Organization lifecycle maintenance remains contributor-gated',
        )
        return { configured: false }
      }

      let result: AdvanceOrganizationLifecycleResult
      try {
        result = await deps.advance()
      } catch {
        throw organizationLifecycleJobError('scheduled_pass_failed')
      }
      deps.logger.info(
        {
          job: JOB_NAME,
          configured: true,
          examined: result.examined,
          transitioned: result.transitioned,
          failed: result.failed,
          closingPrepared: result.closingPrepared,
          purgePending: result.purgePending,
          closed: result.closed,
        },
        'Organization lifecycle maintenance pass completed',
      )
      if (result.failed > 0) {
        throw organizationLifecycleJobError('context_contribution_failed')
      }
      return { configured: true, ...result }
    })
}
