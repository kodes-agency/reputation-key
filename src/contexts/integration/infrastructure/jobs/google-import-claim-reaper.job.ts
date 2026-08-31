// Google import v2 claim-lease reaper job.
//
// One bounded repeatable run per cadence tick. All recovery logic lives in
// `../../application/google-import-v2-claim-reaper`, which routes every stale
// claim through the store's existing CAS helpers; this module is only the
// queue seam plus content-free observability.
//
// The reaper is injected rather than constructed here so composition owns the
// store wiring, matching the permit start-deadline sweep seam.
//
// Cadence rationale: the claim lease is 60s, so a 60s cadence bounds worst-case
// recovery at roughly two lease widths. The scan is a bounded 100-row read over
// the active-item index and does nothing when no claim is stale.

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
      deps.logger.info(
        {
          job: JOB_NAME,
          staleClaimsVisited: outcome.staleClaimsVisited,
          claimsReleased: outcome.claimsReleased,
          itemsTerminalized: outcome.itemsTerminalized,
          claimsLost: outcome.claimsLost,
        },
        'Google import claim-lease reaper completed',
      )
    })
