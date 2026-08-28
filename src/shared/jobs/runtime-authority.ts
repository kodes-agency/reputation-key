/**
 * Executable operational contract for retained BullMQ work.
 *
 * The event/job catalogue owns what may execute. This authority adds the
 * runtime claims that the catalogue historically could not prove: where the
 * job may run, how fresh a successful run must be, how long queued work may
 * wait, and which report-first repair/runbook owns a terminal failure.
 * Observations are deliberately identifier-only; error messages and payloads
 * never belong in this model.
 */

export type JobRuntimePosture = 'active' | 'dark' | 'quarantined'
export type JobRoutingOwnership = 'cell_local' | 'global_control_plane'
export type JobOperationalQueue = 'default' | 'background' | 'domain-events'

export type JobOperationalContract = Readonly<{
  jobName: string
  owner: string
  /** Repository-relative executable processor owning the handler. */
  processor: string
  /** Current system action re-authorized at delayed execution. */
  action: string
  /** Governing capability, retained in the operational report. */
  capability: string
  queue: JobOperationalQueue
  /** Exact enqueue/execution policy, projected from the governed job row. */
  retryAttempts: number
  retryBackoff: string
  timeoutMs: number
  workerConcurrency: number
  retention: string
  routing: JobRoutingOwnership
  posture: JobRuntimePosture
  /** Catalogue cadence (`none`, `every:<ms>`, or `cron:<pattern>`). */
  schedule: string
  /** Null only for genuinely on-demand work. */
  lastSuccessObjectiveMs: number | null
  maximumQueueAgeMs: number
  /** A report-first command. Active work may not use the `none` sentinel. */
  repairCommand: string
  /** Repository-relative operational runbook. */
  runbook: string
}>

/** Durable, content-free head for one job family in one processing cell. */
export type JobRuntimeObservation = Readonly<{
  jobName: string
  cell: string
  handlerRegistered: boolean
  schedulerRegistered: boolean
  lastStartedAt: Date | null
  lastSucceededAt: Date | null
  lastTerminalFailureAt: Date | null
  lastRepairAt: Date | null
  lastStalledAt: Date | null
  oldestWaitingAt: Date | null
  deadLetterCount: number
}>

export type JobRuntimeReadinessReason =
  | 'observation_missing'
  | 'handler_missing'
  | 'scheduler_missing'
  | 'dark_handler_registered'
  | 'dark_scheduler_registered'
  | 'quarantined_scheduler_registered'
  | 'success_never_observed'
  | 'last_success_objective_missed'
  | 'queue_age_objective_missed'
  | 'repair_required'
  | 'dead_letter_present'
  | 'stalled_work_observed'
  | 'dark_queue_work_present'
  | 'dark_execution_observed'
  | 'invalid_observation'

export type JobRuntimeReadiness = Readonly<{
  ready: boolean
  reasons: readonly JobRuntimeReadinessReason[]
}>

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function isScheduled(schedule: string): boolean {
  return schedule !== 'none'
}

function isPositiveDecimal(value: string): boolean {
  return (
    value.length > 0 &&
    value[0] !== '0' &&
    [...value].every((character) => character >= '0' && character <= '9')
  )
}

function isValidSchedule(schedule: string): boolean {
  if (schedule === 'none') return true
  if (schedule.startsWith('cron:')) {
    const pattern = schedule.slice('cron:'.length)
    return pattern.length > 0 && pattern.trim() === pattern
  }
  if (!schedule.startsWith('every:')) return false
  const [interval, offset, extra] = schedule.slice('every:'.length).split(',')
  if (extra !== undefined || !isPositiveDecimal(interval ?? '')) return false
  return (
    offset === undefined ||
    (offset.startsWith('offset:') && isPositiveDecimal(offset.slice('offset:'.length)))
  )
}

function assertNonEmpty(value: string, label: string, jobName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${jobName || '<unnamed>'}: ${label} must not be empty`)
  }
}

/** Fail fast before any queue, worker, or scheduler is created. */
export function validateJobOperationalContracts(
  contracts: readonly JobOperationalContract[],
): void {
  const names = new Set<string>()
  for (const contract of contracts) {
    assertNonEmpty(contract.jobName, 'job name', contract.jobName)
    if (names.has(contract.jobName)) {
      throw new Error(`duplicate job operational contract: ${contract.jobName}`)
    }
    names.add(contract.jobName)

    assertNonEmpty(contract.owner, 'owner', contract.jobName)
    assertNonEmpty(contract.processor, 'processor', contract.jobName)
    assertNonEmpty(contract.action, 'action', contract.jobName)
    assertNonEmpty(contract.runbook, 'runbook', contract.jobName)
    assertNonEmpty(contract.repairCommand, 'repair command', contract.jobName)
    if (contract.posture === 'active' && contract.repairCommand === 'none') {
      throw new Error(`${contract.jobName}: active work requires a repair command`)
    }
    if (!isPositiveSafeInteger(contract.maximumQueueAgeMs)) {
      throw new Error(`${contract.jobName}: maximum queue age must be positive`)
    }
    if (!isPositiveSafeInteger(contract.retryAttempts)) {
      throw new Error(`${contract.jobName}: retry attempts must be positive`)
    }
    if (!/^(?:exponential|fixed):[1-9]\d*$/.test(contract.retryBackoff)) {
      throw new Error(`${contract.jobName}: retry backoff is malformed`)
    }
    if (!isPositiveSafeInteger(contract.timeoutMs)) {
      throw new Error(`${contract.jobName}: timeout must be positive`)
    }
    if (!isPositiveSafeInteger(contract.workerConcurrency)) {
      throw new Error(`${contract.jobName}: worker concurrency must be positive`)
    }
    if (!/^completed:[1-9]\d*,failed:[1-9]\d*$/.test(contract.retention)) {
      throw new Error(`${contract.jobName}: retention is malformed`)
    }
    if (
      contract.lastSuccessObjectiveMs !== null &&
      !isPositiveSafeInteger(contract.lastSuccessObjectiveMs)
    ) {
      throw new Error(`${contract.jobName}: last-success objective must be positive`)
    }
    if (isScheduled(contract.schedule) && contract.lastSuccessObjectiveMs === null) {
      throw new Error(
        `${contract.jobName}: scheduled work requires a last-success objective`,
      )
    }
    if (!isValidSchedule(contract.schedule)) {
      throw new Error(`${contract.jobName}: malformed schedule '${contract.schedule}'`)
    }
  }
}

function after(left: Date | null, right: Date | null): boolean {
  return left !== null && (right === null || left.getTime() > right.getTime())
}

function invalidObservation(observation: JobRuntimeObservation, now: Date): boolean {
  const dates = [
    observation.lastStartedAt,
    observation.lastSucceededAt,
    observation.lastTerminalFailureAt,
    observation.lastRepairAt,
    observation.lastStalledAt,
    observation.oldestWaitingAt,
  ]
  return (
    observation.cell.trim().length === 0 ||
    !Number.isSafeInteger(observation.deadLetterCount) ||
    observation.deadLetterCount < 0 ||
    dates.some((value) => value !== null && value.getTime() > now.getTime())
  )
}

function appendWorkHealthReasons(
  contract: JobOperationalContract,
  observation: JobRuntimeObservation,
  now: Date,
  reasons: JobRuntimeReadinessReason[],
): void {
  if (
    observation.oldestWaitingAt !== null &&
    now.getTime() - observation.oldestWaitingAt.getTime() > contract.maximumQueueAgeMs
  ) {
    reasons.push('queue_age_objective_missed')
  }
  if (after(observation.lastTerminalFailureAt, observation.lastRepairAt)) {
    reasons.push('repair_required')
  }
  if (
    after(observation.lastStalledAt, observation.lastSucceededAt) &&
    after(observation.lastStalledAt, observation.lastRepairAt)
  ) {
    reasons.push('stalled_work_observed')
  }
  if (observation.deadLetterCount > 0) reasons.push('dead_letter_present')
}

/**
 * Derive worker readiness from the declared contract and one durable cell head.
 * A process restart supplies a new `runtimeStartedAt`, while the observation
 * survives; therefore restart does not erase a healthy recent success.
 */
export function assessJobRuntime(
  input: Readonly<{
    contract: JobOperationalContract
    observation: JobRuntimeObservation | null
    runtimeStartedAt: Date
    now: Date
  }>,
): JobRuntimeReadiness {
  const { contract, observation, runtimeStartedAt, now } = input
  const reasons: JobRuntimeReadinessReason[] = []

  if (observation === null || observation.jobName !== contract.jobName) {
    return { ready: false, reasons: ['observation_missing'] }
  }
  if (
    invalidObservation(observation, now) ||
    runtimeStartedAt.getTime() > now.getTime()
  ) {
    return { ready: false, reasons: ['invalid_observation'] }
  }

  if (contract.posture === 'dark') {
    if (observation.handlerRegistered) reasons.push('dark_handler_registered')
    if (observation.schedulerRegistered) reasons.push('dark_scheduler_registered')
    if (observation.oldestWaitingAt !== null) reasons.push('dark_queue_work_present')
    if (
      observation.lastStartedAt !== null &&
      observation.lastStartedAt.getTime() >= runtimeStartedAt.getTime()
    ) {
      reasons.push('dark_execution_observed')
    }
    if (observation.deadLetterCount > 0) reasons.push('dead_letter_present')
    return { ready: reasons.length === 0, reasons }
  }
  if (contract.posture === 'quarantined') {
    if (observation.schedulerRegistered) reasons.push('quarantined_scheduler_registered')
    appendWorkHealthReasons(contract, observation, now, reasons)
    return { ready: reasons.length === 0, reasons }
  }

  if (!observation.handlerRegistered) reasons.push('handler_missing')
  if (isScheduled(contract.schedule) && !observation.schedulerRegistered) {
    reasons.push('scheduler_missing')
  }

  const objective = contract.lastSuccessObjectiveMs
  if (objective !== null) {
    if (observation.lastSucceededAt === null) {
      if (now.getTime() - runtimeStartedAt.getTime() > objective) {
        reasons.push('success_never_observed')
      }
    } else if (now.getTime() - observation.lastSucceededAt.getTime() > objective) {
      reasons.push('last_success_objective_missed')
    }
  }

  appendWorkHealthReasons(contract, observation, now, reasons)

  return { ready: reasons.length === 0, reasons }
}
