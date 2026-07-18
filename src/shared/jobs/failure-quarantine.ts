// BQC-3.6 — failure quarantine with redrive metadata.
//
// Max-attempt jobs move to a dedicated 'quarantine' BullMQ queue. NO worker
// ever processes that queue — it IS the dead letter. BQC-4.2 adds a second,
// direct path (quarantineJobDirect): dispatch-time gates that reject a job
// without running it (routing blocked / wrong cell) park it here immediately
// — no retry burn — with the gate's reason in policyReason. The envelope is
// content-safe by construction:
//
//   - data passes through ONLY for catalogue-known work (every catalogued job
//     payload and event envelope is identifier-only by construction — the 3.1
//     catalogue and the schema allowlists pin this); anything else is
//     replaced with { redacted: true };
//   - failedReason is the error name + first message line, capped at 200
//     chars — never a stack, never protected content;
//   - policyReason carries the gate's deny reason when the failure came from
//     the delayed execution gate (GateDenyRetryError).
//
// Redrive is an explicit operator action: the quarantined job is re-added to
// its ORIGINAL queue with a fresh attempt budget (catalogue policy for known
// jobs) and redriveMetadata in the payload, then removed from quarantine.
// Redacted envelopes cannot be redriven — the payload is gone; they exist
// for operator inspection only.
//
// Distinct from queue-quarantine.ts (BQC-0.4), which PAUSES a live queue as
// a containment stop-control — different concept, do not confuse.

import type { Job, JobsOptions } from 'bullmq'
import { GateDenyRetryError } from './errors'
import { isCatalogueKnownWork, jobEnqueueOptions, jobFamilyRow } from './job-policy'

/** The dead-letter queue name. Created in the worker; never processed. */
export const QUARANTINE_QUEUE_NAME = 'quarantine'

/**
 * Fallback attempt budget matching queue.ts defaultJobOptions.attempts.
 * Only used when a job carries no explicit attempts opt (legacy producers).
 */
const DEFAULT_ATTEMPTS = 3

export type QuarantineEnvelope = Readonly<{
  /** Queue the failed job came from ('default' | 'background' | 'domain-events'). */
  originalQueue: string
  /** BullMQ job id of the exhausted job. */
  originalJobId: string
  /** Original job name (the quarantined job is added under this name). */
  jobName: string
  /** Identifier-only payload, or { redacted: true } for unknown work. */
  data: unknown
  /** Error name + first message line, ≤ 200 chars. No stack. */
  failedReason: string
  attemptsMade: number
  /** Gate deny reason when the failure came from the delayed execution gate. */
  policyReason?: string
  /** ISO timestamp of quarantine. */
  quarantinedAt: string
}>

export type RedriveMetadata = Readonly<{
  redrivenAt: string
  redrivenFrom: typeof QUARANTINE_QUEUE_NAME
  originalQuarantineId: string
}>

// ── Structural ports (BullMQ Queue/Job satisfy these) ───────────────

export type QueueAddPort = {
  add(name: string, data: unknown, opts?: JobsOptions): Promise<unknown>
}

export type QuarantinedJobHandle = Readonly<{
  id?: string
  name: string
  data: unknown
  remove(): Promise<void>
}>

export type QuarantineReadPort = {
  getJob(id: string): Promise<QuarantinedJobHandle | undefined>
  getJobs(
    types?: import('bullmq').JobType | import('bullmq').JobType[],
    start?: number,
    end?: number,
  ): Promise<QuarantinedJobHandle[]>
}

// ── Envelope helpers ────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Error name + first message line, ≤ 200 chars. No stack, no second line. */
function sanitizeFailedReason(err: unknown): string {
  if (err instanceof Error) {
    const firstLine = (err.message ?? '').split('\n')[0] ?? ''
    return `${err.name}: ${firstLine}`.slice(0, 200)
  }
  return `UnknownError: ${String(err)}`.slice(0, 200)
}

/** True when the job's configured attempt budget is spent. */
function isAttemptsExhausted(job: Job): boolean {
  const configured = job.opts?.attempts
  const attempts =
    typeof configured === 'number' && configured > 0 ? configured : DEFAULT_ATTEMPTS
  return job.attemptsMade >= attempts
}

function parseQuarantineEnvelope(data: unknown): QuarantineEnvelope | null {
  if (!isRecord(data)) return null
  const {
    originalQueue,
    originalJobId,
    jobName,
    failedReason,
    attemptsMade,
    quarantinedAt,
  } = data
  if (typeof originalQueue !== 'string' || originalQueue.length === 0) return null
  if (typeof originalJobId !== 'string' || originalJobId.length === 0) return null
  if (typeof jobName !== 'string' || jobName.length === 0) return null
  if (typeof failedReason !== 'string') return null
  if (typeof attemptsMade !== 'number') return null
  if (typeof quarantinedAt !== 'string') return null
  if (!('data' in data)) return null
  return data as unknown as QuarantineEnvelope
}

function isRedacted(data: unknown): boolean {
  return isRecord(data) && data.redacted === true && Object.keys(data).length === 1
}

// ── Quarantine ──────────────────────────────────────────────────────

export type QuarantineOutcome = Readonly<{
  quarantined: boolean
  quarantineJobId?: string
}>

/** Content-safe quarantine envelope: catalogue-known payloads pass through
 * (identifier-only by construction); unknown work is redacted. */
function buildQuarantineEnvelope(
  job: Job,
  fields: Readonly<{ failedReason: string; policyReason?: string }>,
): QuarantineEnvelope {
  return {
    originalQueue: job.queueName ?? 'unknown',
    originalJobId: job.id ?? 'unknown',
    jobName: job.name,
    data: isCatalogueKnownWork(job.name) ? job.data : { redacted: true },
    failedReason: fields.failedReason.slice(0, 200),
    attemptsMade: job.attemptsMade,
    policyReason: fields.policyReason,
    quarantinedAt: new Date().toISOString(),
  }
}

/** Deterministic id: re-quarantining the same job is idempotent. */
function quarantineJobIdFor(envelope: QuarantineEnvelope): string {
  return `${QUARANTINE_QUEUE_NAME}:${envelope.originalQueue}:${envelope.originalJobId}`
}

/**
 * Move a job to the dead-letter quarantine queue when its attempt budget is
 * spent. Called from the BullMQ worker 'failed' handler (wired in
 * createJobWorker); a no-op while attempts remain.
 */
export async function quarantineExhaustedJob(
  quarantineQueue: QueueAddPort,
  job: Job,
  err: unknown,
): Promise<QuarantineOutcome> {
  if (!isAttemptsExhausted(job)) return { quarantined: false }

  const envelope = buildQuarantineEnvelope(job, {
    failedReason: sanitizeFailedReason(err),
    policyReason: err instanceof GateDenyRetryError ? err.reason : undefined,
  })

  const quarantineJobId = quarantineJobIdFor(envelope)
  await quarantineQueue.add(envelope.jobName, envelope, { jobId: quarantineJobId })
  return { quarantined: true, quarantineJobId }
}

/**
 * BQC-4.2: quarantine a job DIRECTLY — no attempt budget check. Used by the
 * dispatch-time gates that reject a job without running it (routing blocked,
 * wrong cell): the job must not burn retries on a decision that will not
 * change within its attempt budget, so it parks in the dead-letter queue
 * immediately (operator-visible via the 3.7 quarantine metrics) with the
 * gate's reason in policyReason.
 */
export async function quarantineJobDirect(
  quarantineQueue: QueueAddPort,
  job: Job,
  policyReason: string,
): Promise<QuarantineOutcome> {
  const envelope = buildQuarantineEnvelope(job, {
    failedReason: `GateRejected: ${policyReason}`,
    policyReason,
  })

  const quarantineJobId = quarantineJobIdFor(envelope)
  await quarantineQueue.add(envelope.jobName, envelope, { jobId: quarantineJobId })
  return { quarantined: true, quarantineJobId }
}

// ── Redrive ─────────────────────────────────────────────────────────

export type RedriveResult =
  | Readonly<{ redriven: true; targetQueue: string; jobId: string | undefined }>
  | Readonly<{
      redriven: false
      reason:
        | 'quarantine-job-not-found'
        | 'malformed-quarantine-envelope'
        | 'payload-redacted'
        | 'target-queue-unavailable'
    }>

/**
 * Build the ops-callable redrive function: move a quarantined job back to its
 * original queue with a fresh attempt budget and redriveMetadata in the
 * payload, then remove it from quarantine (move, not copy).
 */
export function createRedriveJob(
  quarantineQueue: QuarantineReadPort,
  resolveTargetQueue: (queueName: string) => QueueAddPort | undefined,
): (quarantineJobId: string) => Promise<RedriveResult> {
  return async (quarantineJobId) => {
    const quarantined = await quarantineQueue.getJob(quarantineJobId)
    if (!quarantined) return { redriven: false, reason: 'quarantine-job-not-found' }

    const envelope = parseQuarantineEnvelope(quarantined.data)
    if (!envelope) return { redriven: false, reason: 'malformed-quarantine-envelope' }
    if (isRedacted(envelope.data)) return { redriven: false, reason: 'payload-redacted' }

    const target = resolveTargetQueue(envelope.originalQueue)
    if (!target) return { redriven: false, reason: 'target-queue-unavailable' }

    const redriveMetadata: RedriveMetadata = {
      redrivenAt: new Date().toISOString(),
      redrivenFrom: QUARANTINE_QUEUE_NAME,
      originalQuarantineId: quarantined.id ?? quarantineJobId,
    }
    const data = { ...(envelope.data as Record<string, unknown>), redriveMetadata }
    // Fresh attempt budget from the catalogue policy; unknown jobs fall back
    // to the queue defaults (their handler must exist post-redeploy anyway).
    const opts = jobFamilyRow(envelope.jobName) ? jobEnqueueOptions(envelope.jobName) : {}

    const job = (await target.add(envelope.jobName, data, opts)) as Job
    await quarantined.remove()
    return { redriven: true, targetQueue: envelope.originalQueue, jobId: job?.id }
  }
}

// ── Listing (ops report) ────────────────────────────────────────────

export type QuarantinedEntry = Readonly<{
  quarantineJobId: string
  envelope: QuarantineEnvelope
}>

/** List quarantined jobs (waiting/delayed — the quarantine queue has no worker). */
export async function listQuarantinedJobs(
  quarantineQueue: QuarantineReadPort,
  limit = 100,
): Promise<ReadonlyArray<QuarantinedEntry>> {
  const jobs = await quarantineQueue.getJobs(
    ['waiting', 'delayed', 'prioritized'],
    0,
    limit - 1,
  )
  const out: QuarantinedEntry[] = []
  for (const job of jobs) {
    const envelope = parseQuarantineEnvelope(job.data)
    if (envelope) out.push({ quarantineJobId: job.id ?? 'unknown', envelope })
  }
  return out
}
