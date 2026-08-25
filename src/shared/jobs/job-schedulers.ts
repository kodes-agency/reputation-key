// BullMQ Job Scheduler reconciliation. This is the only production seam for
// recurring registration: stable scheduler IDs make cadence changes an update,
// and boot-time reconciliation removes legacy repeat keys and capability-dark
// schedules before any enabled scheduler is upserted.

import type { JobsOptions, Queue, RepeatOptions } from 'bullmq'

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
