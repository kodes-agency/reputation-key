// BQC-3.6 — per-job enqueue policy derived from the event/job family catalogue.
//
// The catalogue (JOB_FAMILY_ROWS) is the single source of truth for
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
import {
  EVENT_FAMILY_ROWS,
  JOB_FAMILY_ROWS,
  type JobFamilyRow,
} from '#/shared/governance/event-job-catalogue'

/**
 * Backoff jitter fraction (BullMQ BackoffOptions.jitter: "percentage of
 * jitter usage", 0–1). 0.5 spreads retries ±50% around the exponential delay
 * so a fleet of failed jobs doesn't retry in lockstep.
 */
const BACKOFF_JITTER = 0.5

/** Fallback when a job has no catalogue row (defensive — readiness prevents it). */
const DEFAULT_TIMEOUT_MS = 120_000

/** The catalogue row for a job name, or undefined. */
export function jobFamilyRow(jobName: string): JobFamilyRow | undefined {
  return JOB_FAMILY_ROWS.find((r) => r.jobName === jobName)
}

/**
 * True when the name is catalogue-known work: a job family OR an event
 * family (dispatcher jobs are named by eventType). All catalogue-known
 * payloads are identifier-only by construction — the failure quarantine
 * relies on this for its no-redaction proof.
 */
export function isCatalogueKnownWork(name: string): boolean {
  return (
    JOB_FAMILY_ROWS.some((r) => r.jobName === name) ||
    EVENT_FAMILY_ROWS.some((r) => r.eventType === name)
  )
}

/**
 * Catalogue-declared execution timeout for a job. Enforced by the gated
 * dispatch closure — BullMQ v5 has no job-level timeout option.
 */
export function jobTimeoutMs(jobName: string): number {
  return jobFamilyRow(jobName)?.timeoutMs ?? DEFAULT_TIMEOUT_MS
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
  const row = jobFamilyRow(jobName)
  if (!row) {
    throw new Error(
      `unknown job '${jobName}' — no JOB_FAMILY_ROWS entry; add the family to the event/job catalogue (BQC-3.6)`,
    )
  }
  const backoff = parseRetryBackoff(row.retryBackoff)
  return {
    attempts: row.retryAttempts,
    backoff: { type: backoff.type, delay: backoff.delay, jitter: BACKOFF_JITTER },
  }
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
