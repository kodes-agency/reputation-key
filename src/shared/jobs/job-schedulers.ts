// BullMQ Job Scheduler reconciliation. This is the only production seam for
// recurring registration: stable scheduler IDs make cadence changes an update,
// and boot-time reconciliation removes off-key schedulers and capability-dark
// schedules before any enabled scheduler is upserted. A running worker's
// watchdog then restores schedulers that vanish with Queue Redis state.

import type { JobsOptions, Queue, RepeatOptions } from 'bullmq'
import type pino from 'pino'

export type JobSchedulerRegistration = Readonly<{
  schedulerId: string
  jobName: string
  repeat: Omit<RepeatOptions, 'key'>
  jobOptions: JobsOptions
  data?: unknown
}>

type ReconcileInput = Readonly<{
  queue: Queue
  /** Every job name owned by this registration seam, including disabled jobs. */
  managedJobNames: readonly string[]
  /** Enabled schedules that must exist after reconciliation. */
  desired: readonly JobSchedulerRegistration[]
}>

export type JobSchedulerReconciliation = Readonly<{
  removedSchedulerIds: readonly string[]
  upsertedSchedulerIds: readonly string[]
}>

function validate(input: ReconcileInput): void {
  const managed = new Set(input.managedJobNames)
  const schedulerIds = new Set<string>()
  const jobNames = new Set<string>()

  for (const schedule of input.desired) {
    if (!schedule.schedulerId || schedulerIds.has(schedule.schedulerId)) {
      throw new Error(`Duplicate or empty scheduler ID '${schedule.schedulerId}'`)
    }
    if (!schedule.jobName || jobNames.has(schedule.jobName)) {
      throw new Error(`Duplicate or empty scheduled job name '${schedule.jobName}'`)
    }
    if (!managed.has(schedule.jobName)) {
      throw new Error(`Scheduled job '${schedule.jobName}' is not managed by this seam`)
    }
    const hasEvery = schedule.repeat.every !== undefined
    const hasPattern = schedule.repeat.pattern !== undefined
    if (hasEvery === hasPattern) {
      throw new Error(
        `Schedule '${schedule.schedulerId}' must define exactly one of every or pattern`,
      )
    }
    schedulerIds.add(schedule.schedulerId)
    jobNames.add(schedule.jobName)
  }
}

/**
 * Reconcile one queue to its complete desired scheduler set.
 *
 * Existing entries are removed when their job name is managed but disabled or
 * their key is not the stable desired ID. A desired ID bound to the wrong name
 * is also removed. Unrelated operator-owned schedulers are preserved.
 */
export async function reconcileJobSchedulers(
  input: ReconcileInput,
): Promise<JobSchedulerReconciliation> {
  validate(input)
  const managed = new Set(input.managedJobNames)
  const desiredById = new Map(
    input.desired.map((schedule) => [schedule.schedulerId, schedule] as const),
  )
  const existing = await input.queue.getJobSchedulers(0, -1, true)
  const removedSchedulerIds: string[] = []

  for (const scheduler of existing) {
    const desired = desiredById.get(scheduler.key)
    const isCurrent = desired?.jobName === scheduler.name
    if (isCurrent) continue
    if (!managed.has(scheduler.name) && desired === undefined) continue
    await input.queue.removeJobScheduler(scheduler.key)
    removedSchedulerIds.push(scheduler.key)
  }

  const upsertedSchedulerIds: string[] = []
  for (const schedule of input.desired) {
    await input.queue.upsertJobScheduler(schedule.schedulerId, schedule.repeat, {
      name: schedule.jobName,
      data: schedule.data ?? {},
      opts: schedule.jobOptions,
    })
    upsertedSchedulerIds.push(schedule.schedulerId)
  }

  return { removedSchedulerIds, upsertedSchedulerIds }
}

export type JobSchedulerRestore = Readonly<{
  restoredSchedulerIds: readonly string[]
}>

/**
 * Re-install every desired scheduler whose stable ID is missing — and only
 * those. A scheduler that exists is never re-upserted: in BullMQ 6 upserting
 * an unchanged cron scheduler drops its pending overdue iteration, so a
 * blanket reconcile landing just after the hour would skip that hour's
 * digest. Stale or mis-bound entries stay boot reconciliation's job.
 */
export async function restoreMissingJobSchedulers(
  input: Readonly<{
    queue: Queue
    desired: readonly JobSchedulerRegistration[]
  }>,
): Promise<JobSchedulerRestore> {
  const present = new Set(
    (await input.queue.getJobSchedulers(0, -1, true)).map((scheduler) => scheduler.key),
  )
  const restoredSchedulerIds: string[] = []
  for (const schedule of input.desired) {
    if (present.has(schedule.schedulerId)) continue
    await input.queue.upsertJobScheduler(schedule.schedulerId, schedule.repeat, {
      name: schedule.jobName,
      data: schedule.data ?? {},
      opts: schedule.jobOptions,
    })
    restoredSchedulerIds.push(schedule.schedulerId)
  }
  return { restoredSchedulerIds }
}

/**
 * How often a running worker checks that its schedulers still exist. A lost
 * health-check scheduler is also lost heartbeat and alert evaluation, so the
 * gap should stay well inside the 10-minute heartbeat-stale window.
 */
export const JOB_SCHEDULER_WATCHDOG_INTERVAL_MS = 60_000

/**
 * Keep the desired schedulers installed while the worker runs. They live only
 * in Queue Redis, which needs no persistence (ADR 0053): a restart without it,
 * or a failover to an empty replica, leaves a reconnected worker with none —
 * no digest, no repair sweep, and no health-check to report it. Each tick
 * restores what is missing; `onRestored` lets the caller rebuild other
 * Redis-resident boot state lost with them. A failed tick is logged, never
 * thrown. Returns the stop function.
 */
export function startJobSchedulerWatchdog(
  input: Readonly<{
    queue: Queue
    desired: readonly JobSchedulerRegistration[]
    intervalMs: number
    logger: pino.Logger
    onRestored: (restore: JobSchedulerRestore) => Promise<void>
  }>,
): () => void {
  let inFlight = false
  const tick = async () => {
    if (inFlight) return
    inFlight = true
    try {
      const restore = await restoreMissingJobSchedulers(input)
      if (restore.restoredSchedulerIds.length === 0) return
      input.logger.warn(
        { restoredSchedulerIds: restore.restoredSchedulerIds },
        'Job schedulers missing from Queue Redis were restored',
      )
      await input.onRestored(restore)
    } catch (err) {
      input.logger.warn({ err }, 'Job scheduler watchdog check failed')
    } finally {
      inFlight = false
    }
  }
  const timer = setInterval(() => void tick(), input.intervalMs)
  return () => clearInterval(timer)
}
