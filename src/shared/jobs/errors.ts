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
 * static form of the same mismatch.
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
 * The delayed execution gate denied a job with a RETRYABLE reason
 * (policy_unavailable): protected work must never run without a decision,
 * and an unavailable policy is transient, not a revocation — so the job
 * throws and BullMQ retries with backoff. Carries the gate's deny reason so
 * the failure quarantine can record it as `policyReason`.
 */
export class GateDenyRetryError extends Error {
  readonly reason: string

  constructor(jobName: string, reason: string) {
    super(`delayed execution denied — retry (${reason}) for job '${jobName}'`)
    this.name = 'GateDenyRetryError'
    this.reason = reason
  }
}

/**
 * A job exceeded its catalogue-declared timeout (BQC-3.6). BullMQ v5 removed
 * the job-level `timeout` option, so the gated dispatch closure enforces the
 * catalogue's timeoutMs with a race — the job fails (and retries/quarantines)
 * like any other failure. The underlying handler promise is NOT cancelled
 * (no AbortController threading yet); retries must stay idempotent.
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
