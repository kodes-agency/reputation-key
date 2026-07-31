// Quarantine TTL sweep job — BQC-7.8: bounded expiry for the dead-letter
// failure-quarantine queue.
//
// The quarantine queue is the dead letter (BQC-3.6): NO worker ever consumes
// it; entries wait for operator inspection/redrive. Without a TTL, redacted
// envelopes accumulate forever — unbounded Redis growth holding failure
// metadata past its usefulness. This sweep is the lifecycle bound:
//
//   - Pages the quarantine queue (bounded page size), re-reading the HEAD
//     each round: removals shift the list, so re-reading avoids skipping
//     entries; a round with zero removals or a short page ends the scan.
//     Entries cluster oldest-first (FIFO dead letter), so an all-fresh head
//     page means the tail is fresher still.
//   - Removes entries older than the TTL (QUARANTINE_TTL_DAYS, default 30d)
//     via job.remove() — NEVER obliterate/clean (the queue-quarantine.ts
//     containment constraint: deletion is per-entry, never a bulk wipe).
//   - One CONTENT-FREE log line per removed entry (jobName + queue + age —
//     never the payload and never the job id: jobId/quarantineJobId are
//     banned log keys per the BQC-7.3 observability schema; jobName/queue/
//     age are the approved content-free fields).
//   - Redrive-raced safety: job.remove() on a locked/active job fails (an
//     operator redrive holds the lock) — caught, counted, warn-logged, and
//     skipped; the entry survives for the operator.
//   - Count-capped per run; a capped run continues on the next scheduled
//     run (daily, offset after the retention sweep).
//   - Evidence: one retention_runs row per run (subject 'quarantine.ttl') —
//     a failed run therefore trips the retention.failure alert.
//
// The 24h queue.quarantine-growth alert (operator redrive SLA) is unchanged
// and orthogonal: the SLA asks operators to drain; the TTL is the last-resort
// bound when they don't.

import type { Job } from 'bullmq'
import type pino from 'pino'
import type { Database } from '#/shared/db'
import {
  closeRetentionRun,
  failRetentionRun,
  openRetentionRun,
} from '#/shared/db/retention/evidence'
import { QUARANTINE_QUEUE_NAME } from '#/shared/jobs/failure-quarantine'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export const JOB_NAME = 'quarantine-ttl-sweep' as const

/** The retention_runs evidence subject for this sweep. */
export const QUARANTINE_TTL_SUBJECT = 'quarantine.ttl' as const

/** Structural job handle — BullMQ Job satisfies this. No payload access. */
export type QuarantineTtlJobHandle = Readonly<{
  id?: string
  name: string
  /** BullMQ creation timestamp (ms epoch) — the quarantine-entry age source. */
  timestamp: number
  remove(): Promise<void>
}>

/** Structural queue read port — BullMQ Queue satisfies this. */
export type QuarantineTtlQueuePort = Readonly<{
  getJobs(
    types?: import('bullmq').JobType | import('bullmq').JobType[],
    start?: number,
    end?: number,
  ): Promise<QuarantineTtlJobHandle[]>
}>

export type QuarantineTtlResult = Readonly<{
  scanned: number
  removed: number
  skipped: number
  /** True when the run stopped at the removal cap with entries remaining. */
  capped: boolean
}>

type QuarantineTtlDeps = Readonly<{
  queue: QuarantineTtlQueuePort
  clock: () => Date
  /** Entries older than this are removed (QUARANTINE_TTL_DAYS × day). */
  ttlMs: number
  /** Evidence rows land when present (same posture as the purge job). */
  db?: Database
  /** Page size per queue read (default 100). */
  pageSize?: number
  /** Per-run removal cap (default 500 — retention-batch parity). */
  maxRemovals?: number
}>

// The quarantine queue has no worker: entries sit in 'waiting' (the add path
// sets no delay/priority); the other two states are covered defensively.
const QUARANTINE_JOB_TYPES = ['waiting', 'delayed', 'prioritized'] as const

type SweepCounters = {
  removed: number
  skipped: number
  capped: boolean
}

/**
 * Remove one expired entry; returns true when it was removed. A locked/active
 * entry (operator redrive in flight) fails job.remove() — counted as skipped
 * and left for the operator, never forced.
 */
async function removeExpiredEntry(
  job: QuarantineTtlJobHandle,
  ageMs: number,
  maxRemovals: number,
  counters: SweepCounters,
  logger: pino.Logger,
): Promise<boolean> {
  try {
    await job.remove()
  } catch (err) {
    counters.skipped += 1
    logger.warn(
      { err, jobName: job.name, queue: QUARANTINE_QUEUE_NAME },
      'quarantine TTL removal skipped — entry locked/active (redrive in flight?)',
    )
    return false
  }
  counters.removed += 1
  logger.info(
    { jobName: job.name, queue: QUARANTINE_QUEUE_NAME, ageMs },
    'quarantine TTL expired — entry removed',
  )
  if (counters.removed >= maxRemovals) counters.capped = true
  return true
}

/** Process one head page; returns how many entries it removed. */
async function processHeadPage(
  deps: QuarantineTtlDeps & { maxRemovals: number },
  page: ReadonlyArray<QuarantineTtlJobHandle>,
  counters: SweepCounters,
  logger: pino.Logger,
): Promise<number> {
  let removedThisPage = 0
  for (const job of page) {
    if (counters.capped) break
    const ageMs = deps.clock().getTime() - job.timestamp
    if (ageMs <= deps.ttlMs) continue
    if (await removeExpiredEntry(job, ageMs, deps.maxRemovals, counters, logger)) {
      removedThisPage += 1
    }
  }
  return removedThisPage
}

export const createQuarantineTtlSweepHandler = (deps: QuarantineTtlDeps) => {
  const pageSize = deps.pageSize ?? 100
  const maxRemovals = deps.maxRemovals ?? 500
  const boundDeps = { ...deps, maxRemovals }

  return async (_job: Job): Promise<QuarantineTtlResult> => {
    return trace('job.quarantineTtlSweep', async () => {
      const logger = getLogger()
      const startedAt = deps.clock()
      const runId = deps.db
        ? await openRetentionRun(deps.db, QUARANTINE_TTL_SUBJECT, pageSize, startedAt)
        : null

      const counters: SweepCounters = { removed: 0, skipped: 0, capped: false }
      let scanned = 0
      let pages = 0

      try {
        for (;;) {
          // Re-read the HEAD each round: every removal shifts the list down,
          // so absolute paging would skip entries.
          const page = await deps.queue.getJobs(
            [...QUARANTINE_JOB_TYPES],
            0,
            pageSize - 1,
          )
          pages += 1
          if (page.length === 0) break
          scanned += page.length

          const removedThisPage = await processHeadPage(boundDeps, page, counters, logger)
          // Short page = the tail is reached; a full page with no removals =
          // the head is fresh (FIFO dead letter — the tail is fresher).
          if (counters.capped || page.length < pageSize || removedThisPage === 0) break
        }
      } catch (err) {
        if (deps.db && runId) await failRetentionRun(deps.db, runId, deps.clock(), err)
        throw err
      }

      if (deps.db && runId) {
        await closeRetentionRun(deps.db, runId, {
          finishedAt: deps.clock(),
          batches: pages,
          rowsDeleted: counters.removed,
          outcome: 'completed',
        })
      }

      return {
        scanned,
        removed: counters.removed,
        skipped: counters.skipped,
        capped: counters.capped,
      }
    })
  }
}
