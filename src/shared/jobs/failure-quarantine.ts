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

import type { Job, JobProgress, JobsOptions } from 'bullmq'
import { GateDenyRetryError } from './errors'
import {
  isCatalogueKnownWork,
  isDomainRedriveOnlyJob,
  jobEnqueueOptions,
  jobFamilyRow,
} from './job-policy'
import {
  sanitizeIdentityInvitationQuarantineFields,
  sanitizeIdentityInvitationRedriveData,
} from '#/shared/outbox/identity-invitation-fact-contract'

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
  /**
   * A pre-failure copy is not redrivable until BullMQ confirms the original
   * transition. Missing means a legacy, already-confirmed envelope.
   */
  publicationState?: 'pending_failure' | 'confirmed_failed'
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
  progress?: JobProgress
  updateProgress(progress: JobProgress): Promise<void>
  remove(): Promise<void>
}>

type QuarantineConfirmationHandle = Readonly<{
  progress?: JobProgress
  updateProgress(progress: JobProgress): Promise<void>
}>

export type QuarantineBarrierPort = QueueAddPort &
  Readonly<{
    getJob(id: string): Promise<QuarantineConfirmationHandle | undefined>
  }>

export type QuarantineReadPort = {
  getJob(id: string): Promise<QuarantinedJobHandle | undefined>
  getJobs(
    types?: import('bullmq').JobType | import('bullmq').JobType[],
    start?: number,
    end?: number,
  ): Promise<QuarantinedJobHandle[]>
}

type OriginalJobStateHandle = Readonly<{
  getState(): Promise<string>
}>

export type RedriveTargetQueue = QueueAddPort &
  Readonly<{
    getJob(id: string): Promise<OriginalJobStateHandle | undefined>
  }>

// ── Envelope helpers ────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Error name + complete first message line. No stack and no second line. */
function sanitizeFailedReason(err: unknown): string {
  if (err instanceof Error) {
    const firstLine = (err.message ?? '').split('\n')[0] ?? ''
    return `${err.name}: ${firstLine}`
  }
  return `UnknownError: ${String(err).split('\n')[0] ?? ''}`
}

/** True when the job's configured attempt budget is spent. */
function isAttemptsExhausted(job: Job): boolean {
  const configured = job.opts?.attempts
  const attempts =
    typeof configured === 'number' && configured > 0 ? configured : DEFAULT_ATTEMPTS
  return job.attemptsMade >= attempts
}

/**
 * True while the handler is executing the attempt that would spend the
 * remaining retry budget. Quarantining before that handler rejects keeps the
 * normally live attempt unsettled until the dead-letter write has completed or
 * failed. Invitation privacy is independently enforced before the add because
 * a suspended process can outlive its BullMQ lock.
 */
function isFinalAttempt(job: Job): boolean {
  const configured = job.opts?.attempts
  const attempts =
    typeof configured === 'number' && configured > 0 ? configured : DEFAULT_ATTEMPTS
  return job.attemptsMade + 1 >= attempts
}

const NON_FAILURE_CONTROL_ERRORS = new Set([
  'DelayedError',
  'WaitingError',
  'WaitingChildrenError',
])

/** Mirror BullMQ's terminal-vs-control-flow decision before moveToFailed. */
function isTerminalFailure(job: Job, err: unknown): boolean {
  if (err instanceof Error) {
    if (NON_FAILURE_CONTROL_ERRORS.has(err.name)) return false
    if (err.name === 'RateLimitError' || err.message === 'bullmq:rateLimitExceeded') {
      return false
    }
    if (err.name === 'UnrecoverableError') return true
  }
  return isFinalAttempt(job)
}

/**
 * BullMQ emits `failed` after both terminal failures and failures that it has
 * already moved back to a retry state. At that point `attemptsMade` has been
 * incremented, so confirmation must use this post-transition predicate rather
 * than the handler-time predicate above.
 */
export function isTerminalFailedEvent(job: Job, err: unknown): boolean {
  return (
    (err instanceof Error && err.name === 'UnrecoverableError') ||
    isAttemptsExhausted(job)
  )
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
    publicationState,
  } = data
  if (typeof originalQueue !== 'string' || originalQueue.length === 0) return null
  if (typeof originalJobId !== 'string' || originalJobId.length === 0) return null
  if (typeof jobName !== 'string' || jobName.length === 0) return null
  if (typeof failedReason !== 'string') return null
  if (typeof attemptsMade !== 'number') return null
  if (typeof quarantinedAt !== 'string') return null
  if (
    publicationState !== undefined &&
    publicationState !== 'pending_failure' &&
    publicationState !== 'confirmed_failed'
  ) {
    return null
  }
  if (!('data' in data)) return null
  return data as unknown as QuarantineEnvelope
}

function isRedacted(data: unknown): boolean {
  return isRecord(data) && data.redacted === true && Object.keys(data).length === 1
}

function publicationIsConfirmed(
  envelope: QuarantineEnvelope,
  progress: JobProgress | undefined,
): boolean {
  if (envelope.publicationState !== 'pending_failure') return true
  return (
    isRecord(progress) &&
    progress.quarantinePublication === 'confirmed_failed' &&
    progress.version === 1
  )
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
  fields: Readonly<{
    failedReason: string
    policyReason?: string
    attemptsMade?: number
    publicationState?: QuarantineEnvelope['publicationState']
  }>,
): QuarantineEnvelope {
  const rawData = isCatalogueKnownWork(job.name) ? job.data : { redacted: true }
  const safe = sanitizeIdentityInvitationQuarantineFields(
    job.name,
    rawData,
    fields.failedReason,
  )
  return {
    originalQueue: job.queueName ?? 'unknown',
    originalJobId: job.id ?? 'unknown',
    jobName: job.name,
    data: safe.data,
    failedReason: safe.failedReason.slice(0, 200),
    attemptsMade: fields.attemptsMade ?? job.attemptsMade,
    policyReason: fields.policyReason,
    quarantinedAt: new Date().toISOString(),
    publicationState: fields.publicationState,
  }
}

/** Deterministic id: re-quarantining the same job is idempotent. */
function quarantineJobIdFor(envelope: QuarantineEnvelope): string {
  return `${QUARANTINE_QUEUE_NAME}:${envelope.originalQueue}:${envelope.originalJobId}`
}

/**
 * Move an already-failed job to the dead-letter quarantine queue when its
 * attempt budget is spent. Retained for explicit repair/test paths; the live
 * worker uses `quarantineFinalAttemptJob` before leaving the active set.
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
    publicationState: 'confirmed_failed',
  })

  const quarantineJobId = quarantineJobIdFor(envelope)
  await quarantineQueue.add(envelope.jobName, envelope, { jobId: quarantineJobId })
  return { quarantined: true, quarantineJobId }
}

/**
 * Stage a non-redrivable dead-letter copy before a terminal handler rejection
 * moves the original job out of BullMQ's active set. The worker confirms the
 * copy only after BullMQ emits `failed`; the post-failure helper above remains
 * for repair/tests of already-failed jobs.
 */
export async function quarantineFinalAttemptJob(
  quarantineQueue: QueueAddPort,
  job: Job,
  err: unknown,
): Promise<QuarantineOutcome> {
  if (!isTerminalFailure(job, err)) return { quarantined: false }

  const envelope = buildQuarantineEnvelope(job, {
    failedReason: sanitizeFailedReason(err),
    policyReason: err instanceof GateDenyRetryError ? err.reason : undefined,
    attemptsMade: job.attemptsMade + 1,
    publicationState: 'pending_failure',
  })
  const quarantineJobId = quarantineJobIdFor(envelope)
  await quarantineQueue.add(envelope.jobName, envelope, { jobId: quarantineJobId })
  return { quarantined: true, quarantineJobId }
}

const CONFIRMED_FAILURE_PROGRESS = Object.freeze({
  quarantinePublication: 'confirmed_failed',
  version: 1,
})

/**
 * Confirm a provisional copy only after BullMQ emitted `failed`, which means
 * moveToFailed completed. Confirmation is isolated in the job progress field,
 * so it can never overwrite payload redaction racing in the operator scrub.
 */
export async function confirmQuarantineFailure(
  quarantineQueue: QuarantineBarrierPort,
  job: Job,
): Promise<boolean> {
  const quarantineJobId = `${QUARANTINE_QUEUE_NAME}:${job.queueName ?? 'unknown'}:${job.id ?? 'unknown'}`
  const quarantined = await quarantineQueue.getJob(quarantineJobId)
  if (!quarantined) return false
  await quarantined.updateProgress(CONFIRMED_FAILURE_PROGRESS)
  return true
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
    publicationState: 'confirmed_failed',
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
        | 'failure-not-confirmed'
        | 'target-queue-unavailable'
        | 'domain-redrive-required'
    }>

/**
 * Build the ops-callable redrive function: move a quarantined job back to its
 * original queue with a fresh attempt budget and redriveMetadata in the
 * payload, then remove it from quarantine (move, not copy).
 */
export function createRedriveJob(
  quarantineQueue: QuarantineReadPort,
  resolveTargetQueue: (queueName: string) => RedriveTargetQueue | undefined,
): (quarantineJobId: string) => Promise<RedriveResult> {
  return async (quarantineJobId) => {
    const quarantined = await quarantineQueue.getJob(quarantineJobId)
    if (!quarantined) return { redriven: false, reason: 'quarantine-job-not-found' }

    const envelope = parseQuarantineEnvelope(quarantined.data)
    if (!envelope) return { redriven: false, reason: 'malformed-quarantine-envelope' }
    if (isRedacted(envelope.data)) return { redriven: false, reason: 'payload-redacted' }
    if (isDomainRedriveOnlyJob(envelope.jobName)) {
      return { redriven: false, reason: 'domain-redrive-required' }
    }

    const target = resolveTargetQueue(envelope.originalQueue)
    if (!target) return { redriven: false, reason: 'target-queue-unavailable' }

    if (!publicationIsConfirmed(envelope, quarantined.progress)) {
      const original = await target.getJob(envelope.originalJobId)
      if (!original || (await original.getState()) !== 'failed') {
        return { redriven: false, reason: 'failure-not-confirmed' }
      }
      // Proof-based, idempotent repair: only an original BullMQ job that is
      // still terminally failed can promote the staged copy. A recovered,
      // waiting, active, completed, or missing original remains inert.
      await quarantined.updateProgress(CONFIRMED_FAILURE_PROGRESS)
    }

    const redriveMetadata: RedriveMetadata = {
      redrivenAt: new Date().toISOString(),
      redrivenFrom: QUARANTINE_QUEUE_NAME,
      originalQuarantineId: quarantined.id ?? quarantineJobId,
    }
    const safeData = sanitizeIdentityInvitationRedriveData(
      envelope.jobName,
      envelope.data,
    )
    const data = { ...(safeData as Record<string, unknown>), redriveMetadata }
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
  publicationState: 'pending_failure' | 'confirmed_failed'
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
    if (envelope) {
      out.push({
        quarantineJobId: job.id ?? 'unknown',
        envelope,
        publicationState: publicationIsConfirmed(envelope, job.progress)
          ? 'confirmed_failed'
          : 'pending_failure',
      })
    }
  }
  return out
}
