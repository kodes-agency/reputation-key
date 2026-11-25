// BQC-3.6 — typed job-runtime errors.
//
// The failure taxonomy (phase BQC-3 §4) distinguishes deployment/config
// failures from transient ones. These two error types carry that distinction
// through BullMQ's generic Error channel so the quarantine layer can record
// a content-safe reason without parsing log text.

/**
 * A job arrived at a worker with no registered handler. This is a
 * deployment/config failure (stale queue entry, typo'd producer, skewed
 * rollout) — NEVER a success. The job fails, burns its attempts, and lands
 * in the failure quarantine; boot-time readiness (readiness.ts) catches the
 * static form of the same mismatch. On-demand work only: a schedule firing is
 * logged and captured instead (failure-quarantine.ts).
 */
export class UnknownJobError extends Error {
  readonly jobName: string
  readonly jobId: string | undefined

  constructor(jobName: string, jobId?: string) {
    super(
      `unknown job '${jobName}' (id ${jobId ?? 'unknown'}) — no handler registered; deployment/config failure`,
    )
    this.name = 'UnknownJobError'
    this.jobName = jobName
    this.jobId = jobId
  }
}

/**
 * A job exceeded its catalogue deadline. The gate aborts its handler and
 * waits for cleanup before failing the attempt. Work that outlives the grace
 * period terminates the worker while its BullMQ slot is still occupied.
 */
export class JobTimeoutError extends Error {
  readonly jobName: string
  readonly timeoutMs: number

  constructor(jobName: string, timeoutMs: number) {
    super(`job '${jobName}' exceeded its ${timeoutMs}ms timeout (BQC-3.6)`)
    this.name = 'JobTimeoutError'
    this.jobName = jobName
    this.timeoutMs = timeoutMs
  }
}
