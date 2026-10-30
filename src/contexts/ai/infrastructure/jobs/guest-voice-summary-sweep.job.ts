import type { Job } from 'bullmq'
import { z } from 'zod/v4'
import { redriveMetadataSchema } from '#/shared/jobs/failure-quarantine'
import {
  GuestVoiceSummarySweepError,
  type AuthorizeGuestVoiceSummaryScope,
  type GuestVoiceSummarySweepStats,
} from '../../application/use-cases/run-guest-voice-summary-sweep'

/**
 * The hourly sweep behind the Monday email (decision 11 of the v3 contract). Each run
 * lists the Properties whose Monday morning it is, 08:00 to 10:59 on their own clock, and
 * records a Guest voice summary for each that has something to say; Feed mails it to the
 * managers who asked for it. The fact's id is the Property's and the Monday's, so the
 * later runs of the same morning record nothing twice.
 *
 * The tenant-cross schedule is only the enumeration boundary: each Property's
 * Organization and Property are decided again by `authorizeScope` (capability,
 * suspension, allowlist) before anything of it is read, and job data carries no
 * authority. A Property that fails is counted and logged by count only; the others are
 * decided all the same, and the run then fails so the queue retries it.
 */
export const GUEST_VOICE_SUMMARY_SWEEP_JOB_NAME = 'ai-guest-voice-summary-sweep'

// Empty but for what a quarantine redrive adds.
const sweepJobData = z
  .object({ redriveMetadata: redriveMetadataSchema.optional() })
  .strict()

export type GuestVoiceSummarySweepJobDependencies = Readonly<{
  sweep: (
    input: Readonly<{ authorizeScope: AuthorizeGuestVoiceSummaryScope }>,
  ) => Promise<GuestVoiceSummarySweepStats>
  authorizeScope: AuthorizeGuestVoiceSummaryScope
  logger: Readonly<{
    info: (fields: Record<string, unknown>, message: string) => void
    warn: (fields: Record<string, unknown>, message: string) => void
  }>
}>

export const createGuestVoiceSummarySweepJobHandler = (
  dependencies: GuestVoiceSummarySweepJobDependencies,
): ((job: Job) => Promise<void>) => {
  return async (job) => {
    sweepJobData.parse(job.data ?? {})
    try {
      const stats = await dependencies.sweep({
        authorizeScope: dependencies.authorizeScope,
      })
      if (stats.inspected === 0) return
      dependencies.logger.info(
        { job: GUEST_VOICE_SUMMARY_SWEEP_JOB_NAME, ...stats },
        'Guest voice summary sweep completed',
      )
    } catch (error) {
      if (error instanceof GuestVoiceSummarySweepError) {
        dependencies.logger.warn(
          { job: GUEST_VOICE_SUMMARY_SWEEP_JOB_NAME, ...error.stats },
          'Guest voice summary sweep: Properties failed',
        )
      }
      throw error
    }
  }
}
