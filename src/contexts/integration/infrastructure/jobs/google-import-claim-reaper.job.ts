import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import type { GoogleImportV2ClaimReaper } from '../../application/google-import-v2-claim-reaper'

export const JOB_NAME = 'google-import-claim-reaper' as const

type GoogleImportClaimReaperDeps = Readonly<{
  reap: GoogleImportV2ClaimReaper
  logger: LoggerPort
}>

export const createGoogleImportClaimReaperHandler =
  (deps: GoogleImportClaimReaperDeps) =>
  async (_job: Job): Promise<void> =>
    trace(`job.${JOB_NAME}`, async () => {
      const outcome = await deps.reap()
      // Counts only — no organization, import job, item, property, provider
      // identifier, or claim fence reaches a log line.
      const level = outcome.itemFailures > 0 ? 'warn' : 'info'
      deps.logger[level](
        {
          job: JOB_NAME,
          dueItemsVisited: outcome.dueItemsVisited,
          claimsReleased: outcome.claimsReleased,
          itemsDispatched: outcome.itemsDispatched,
          completionChecks: outcome.completionChecks,
          itemFailures: outcome.itemFailures,
          claimsLost: outcome.claimsLost,
        },
        'Google import claim-lease reaper completed',
      )
    })
