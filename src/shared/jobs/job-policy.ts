// BQC-3.6 — per-job enqueue policy derived from the job definitions.
//
// The definitions (JOB_DEFINITIONS) are the single source of truth for
// attempts/backoff/timeout, pinned by the 3.1 guard and by the unit tests on
// this module. Every enqueue site applies jobEnqueueOptions so retry policy
// is explicit per job instead of an implicit queue-wide default.
//
// Backoff carries BullMQ's native jitter (BackoffOptions.jitter — verified
// against node_modules/bullmq v5 types). NOTE: a worker-level custom
// backoffStrategy would override these job opts — createJobWorker therefore
// deliberately sets none.
//
// Timeout is NOT a BullMQ v5 job option (removed in v5) — the catalogue's
// timeoutMs is enforced by the gated dispatch closure (delayed-execution-gate)
// via jobTimeoutMs, not by Redis.

import type { JobsOptions, Queue } from 'bullmq'
import { EVENT_TYPES } from '#/shared/events/consumer-definitions'
import { JOB_DEFINITIONS, type JobDefinition } from './job-definitions'

/**
 * Backoff jitter fraction (BullMQ BackoffOptions.jitter: "percentage of
 * jitter usage", 0–1). BullMQ only shortens a delay with it: the exponential
 * strategy draws uniformly from [delay × (1 − jitter), delay)
 * (node_modules/bullmq/dist/esm/classes/backoffs.js, `exponential`). At 0.5 a
 * 30 s first backoff lands between 15 and 30 s, never later, so a fleet of
 * failed jobs doesn't retry in lockstep.
 */
const BACKOFF_JITTER = 0.5

/** Fallback when a job has no catalogue row (defensive — readiness prevents it). */
const DEFAULT_TIMEOUT_MS = 120_000

/** The definition of a job by name, or undefined. */
export function jobDefinition(jobName: string): JobDefinition | undefined {
  return JOB_DEFINITIONS.find((def) => def.name === jobName)
}

/** Work that must converge through its owning domain state machine. */
export function isDomainRedriveOnlyJob(jobName: string): boolean {
  return jobDefinition(jobName)?.redrive === 'domain'
}

/**
 * True when the name is catalogue-known work: a job family OR an event
 * family (dispatcher jobs are named by eventType). All catalogue-known
 * payloads are identifier-only by construction — the failure quarantine
 * relies on this for its no-redaction proof.
 */
export function isCatalogueKnownWork(name: string): boolean {
  return JOB_DEFINITIONS.some((def) => def.name === name) || EVENT_TYPES.includes(name)
}

/**
 * Catalogue-declared execution timeout for a job. Enforced by the gated
 * dispatch closure — BullMQ v5 has no job-level timeout option.
 */
export function jobTimeoutMs(jobName: string): number {
  return jobDefinition(jobName)?.timeoutMs ?? DEFAULT_TIMEOUT_MS
}

function parseRetryBackoff(retryBackoff: string): {
  type: 'exponential' | 'fixed'
  delay: number
} {
  const [type, delay] = retryBackoff.split(':')
  if ((type !== 'exponential' && type !== 'fixed') || !/^\d+$/.test(delay ?? '')) {
    throw new Error(
      `malformed retryBackoff '${retryBackoff}' — expected 'exponential:<ms>' or 'fixed:<ms>'`,
    )
  }
  return { type, delay: Number(delay) }
}

/**
 * Explicit per-job BullMQ options from the catalogue: attempts and
 * exponential/fixed backoff with jitter. Throws on an unknown job name — a
 * typo'd producer is a config failure, never a silent default.
 */
export function jobEnqueueOptions(jobName: string): JobsOptions {
  const def = jobDefinition(jobName)
  if (!def) {
    throw new Error(
      `unknown job '${jobName}' — no job definition; add it to src/shared/jobs/job-definitions.ts`,
    )
  }
  const backoff = parseRetryBackoff(def.backoff)
  return {
    attempts: def.attempts,
    backoff: { type: backoff.type, delay: backoff.delay, jitter: BACKOFF_JITTER },
  }
}

/**
 * Options for re-enqueueing a quarantined job: the same attempts and backoff a
 * first enqueue gets, so a redrive restores the job's whole attempt budget.
 * A job without a definition gets the queue defaults (its handler must exist
 * after a redeploy anyway).
 */
export function jobRedriveOptions(jobName: string): JobsOptions {
  return jobDefinition(jobName) ? jobEnqueueOptions(jobName) : {}
}

/**
 * Maximum delay BullMQ may apply after the current attempt fails. Jitter only
 * lowers this value, so callers can prove a retry will not cross a deadline.
 */
export function jobRetryDelayUpperBoundMs(
  jobName: string,
  attemptOrdinal: number,
): number {
  if (!Number.isSafeInteger(attemptOrdinal) || attemptOrdinal < 1) {
    throw new Error(`invalid attempt ordinal '${attemptOrdinal}'`)
  }
  const def = jobDefinition(jobName)
  if (!def) {
    throw new Error(
      `unknown job '${jobName}' — no job definition; add it to src/shared/jobs/job-definitions.ts`,
    )
  }
  const backoff = parseRetryBackoff(def.backoff)
  const delay =
    backoff.type === 'exponential'
      ? Math.round(2 ** (attemptOrdinal - 1) * backoff.delay)
      : backoff.delay
  if (!Number.isSafeInteger(delay)) {
    throw new Error(`retry delay for '${jobName}' exceeds the safe integer range`)
  }
  return delay
}

/**
 * Wrap a queue so `add` merges the catalogue policy into every enqueue;
 * explicit call-site opts win. Non-mutating (the original queue is the
 * prototype, only `add` is shadowed) — used at the handler-registration seam
 * so the activity/notification insert handlers inherit the policy without
 * editing every per-tag handler file.
 */
export function withCatalogueJobOptions(queue: Queue): Queue {
  const wrapped = Object.create(queue) as Queue
  wrapped.add = ((name: string, data: unknown, opts?: JobsOptions) =>
    queue.add(name, data, { ...jobEnqueueOptions(name), ...opts })) as Queue['add']
  return wrapped
}
