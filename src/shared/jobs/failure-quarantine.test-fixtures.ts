import type { Job } from 'bullmq'
import {
  quarantineFinalAttemptJob,
  type QuarantineEnvelope,
  type QuarantineOutcome,
  type QueueAddPort,
} from './failure-quarantine'

const DEFAULT_ATTEMPTS = 3

/**
 * Put the dead letter of an already-failed job (attempt budget spent) into a
 * quarantine queue, as a confirmed failure. It runs the production final-attempt
 * staging for the attempt before the last and confirms the copy on write.
 */
export async function quarantineExhaustedJob(
  quarantineQueue: QueueAddPort,
  job: Job,
  err: unknown,
): Promise<QuarantineOutcome> {
  const configured = job.opts?.attempts
  const attempts =
    typeof configured === 'number' && configured > 0 ? configured : DEFAULT_ATTEMPTS
  if (job.attemptsMade < attempts) return { quarantined: false }

  const lastAttempt = Object.create(job, {
    attemptsMade: { value: job.attemptsMade - 1 },
  }) as Job
  return quarantineFinalAttemptJob(
    {
      add: (name, envelope, opts) =>
        quarantineQueue.add(
          name,
          { ...(envelope as QuarantineEnvelope), publicationState: 'confirmed_failed' },
          opts,
        ),
    },
    lastAttempt,
    err,
  )
}
