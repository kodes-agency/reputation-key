/**
 * Operational authority for every governed BullMQ family.
 *
 * JOB_FAMILY_ROWS remains the product/governance declaration. This module is
 * its one executable operational projection: registration posture, scheduler
 * reconciliation, freshness/queue-age objectives, owner, and report-first
 * repair ownership are derived and validated together. Worker code must not
 * maintain a second hand-written scheduler list.
 */

import {
  JOB_FAMILY_ROWS,
  type JobFamilyRow,
} from '#/shared/governance/event-job-catalogue'
import { jobEnqueueOptions } from './job-policy'
import {
  validateJobOperationalContracts,
  type JobOperationalContract,
} from './runtime-authority'
import type { JobSchedulerRegistration } from './job-schedulers'

const DEFAULT_MAXIMUM_QUEUE_AGE_MS = 15 * 60_000
const GENERIC_REPAIR_COMMAND =
  'pnpm ops:quarantine redrive <quarantineJobId> --operator <registered-operator> --reason <incident-reason> --apply'
const GENERIC_RUNBOOK = 'docs/operations/runbooks.md'

/**
 * Removal-only scheduler ownership for families that no longer have a runtime
 * contract. Keep a tombstone through at least one deployed reconciliation so
 * BullMQ cannot preserve a scheduler installed by an older release.
 */
export const RETIRED_SCHEDULER_JOB_NAMES = Object.freeze([
  'leaderboard.reconcile',
] as const)

/**
 * Queue-level execution budget. The worker factory consumes this same value;
 * operational evidence and the live BullMQ concurrency cannot drift.
 */
export const JOB_OPERATIONAL_QUEUE_CONCURRENCY = Object.freeze({
  default: 4,
  background: 3,
  'domain-events': 20,
} as const)

function ownerFor(row: JobFamilyRow): string {
  const context = /src\/contexts\/([^/]+)\//.exec(row.processor)?.[1]
  if (context) return context
  return 'platform'
}

function postureFor(
  registration: JobFamilyRow['registration'],
): JobOperationalContract['posture'] {
  if (registration === 'enabled') return 'active'
  if (registration === 'quarantined') return 'quarantined'
  return 'dark'
}

function intervalForObjective(schedule: string): number | null {
  if (schedule === 'none') return null
  if (schedule.startsWith('every:')) {
    const interval = Number(schedule.slice('every:'.length).split(',')[0])
    return Number.isSafeInteger(interval) && interval > 0 ? interval : null
  }
  if (schedule.startsWith('cron:')) {
    const pattern = schedule.slice('cron:'.length)
    // Every cron expression in the governed catalogue is an hourly minute
    // offset. Refuse a silent guess when a different cadence is introduced.
    if (/^(?:[0-5]?\d) \* \* \* \*$/.test(pattern)) return 60 * 60_000
  }
  return null
}

function lastSuccessObjective(row: JobFamilyRow): number | null {
  const interval = intervalForObjective(row.schedule)
  if (row.schedule === 'none') return null
  if (interval === null) {
    throw new Error(
      `${row.jobName}: operational catalogue cannot derive objective from '${row.schedule}'`,
    )
  }
  // Two missed firings plus one complete execution budget. The objective is
  // deliberately wider than a single cadence so a rolling deploy/restart does
  // not page while still detecting a dead scheduler promptly.
  return interval * 2 + row.timeoutMs
}

function operationalContract(row: JobFamilyRow): JobOperationalContract {
  return {
    jobName: row.jobName,
    owner: ownerFor(row),
    processor: row.processor,
    action: row.action,
    capability: row.capability,
    queue: row.queue,
    retryAttempts: row.retryAttempts,
    retryBackoff: row.retryBackoff,
    timeoutMs: row.timeoutMs,
    workerConcurrency: JOB_OPERATIONAL_QUEUE_CONCURRENCY[row.queue],
    retention: row.retention,
    routing: row.region,
    posture: postureFor(row.registration),
    schedule: row.schedule,
    lastSuccessObjectiveMs: lastSuccessObjective(row),
    maximumQueueAgeMs: DEFAULT_MAXIMUM_QUEUE_AGE_MS,
    repairCommand: GENERIC_REPAIR_COMMAND,
    runbook: GENERIC_RUNBOOK,
  }
}

export const JOB_OPERATIONAL_CONTRACTS: readonly JobOperationalContract[] = Object.freeze(
  JOB_FAMILY_ROWS.map(operationalContract),
)

export function validateOperationalCatalogueCoverage(): void {
  validateJobOperationalContracts(JOB_OPERATIONAL_CONTRACTS)
  const byName = new Map(
    JOB_OPERATIONAL_CONTRACTS.map((contract) => [contract.jobName, contract]),
  )
  if (byName.size !== JOB_FAMILY_ROWS.length) {
    throw new Error('operational catalogue does not cover every job family exactly once')
  }
  for (const row of JOB_FAMILY_ROWS) {
    const contract = byName.get(row.jobName)
    if (!contract) throw new Error(`missing operational contract: ${row.jobName}`)
    if (
      contract.queue !== row.queue ||
      contract.processor !== row.processor ||
      contract.action !== row.action ||
      contract.retryAttempts !== row.retryAttempts ||
      contract.retryBackoff !== row.retryBackoff ||
      contract.timeoutMs !== row.timeoutMs ||
      contract.retention !== row.retention ||
      contract.schedule !== row.schedule ||
      contract.routing !== row.region ||
      contract.capability !== row.capability ||
      contract.posture !== postureFor(row.registration)
    ) {
      throw new Error(`operational contract drift: ${row.jobName}`)
    }
  }
  for (const retiredName of RETIRED_SCHEDULER_JOB_NAMES) {
    if (byName.has(retiredName)) {
      throw new Error(
        `retired scheduler still has an operational contract: ${retiredName}`,
      )
    }
  }
}

function parseSchedule(schedule: string): JobSchedulerRegistration['repeat'] {
  if (schedule.startsWith('cron:')) {
    return { pattern: schedule.slice('cron:'.length) }
  }
  const [intervalText, offsetText] = schedule.slice('every:'.length).split(',')
  const every = Number(intervalText)
  if (!Number.isSafeInteger(every) || every <= 0) {
    throw new Error(`malformed operational interval '${schedule}'`)
  }
  if (offsetText === undefined) return { every }
  const offset = Number(offsetText.slice('offset:'.length))
  if (!offsetText.startsWith('offset:') || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error(`malformed operational interval offset '${schedule}'`)
  }
  return { every, offset }
}

export type OperationalSchedulerPlan = Readonly<{
  /** Every governed family is owned, so any accidental/stale repeat is removed. */
  managedJobNames: string[]
  /** Only active families with a declared cadence may be installed. */
  desired: JobSchedulerRegistration[]
}>

export function createOperationalSchedulerPlan(): OperationalSchedulerPlan {
  validateOperationalCatalogueCoverage()
  const misplacedSchedule = JOB_OPERATIONAL_CONTRACTS.find(
    (contract) => contract.schedule !== 'none' && contract.queue !== 'background',
  )
  if (misplacedSchedule) {
    throw new Error(
      `${misplacedSchedule.jobName}: recurring work must use the background queue`,
    )
  }
  return {
    managedJobNames: [
      ...JOB_OPERATIONAL_CONTRACTS.map((contract) => contract.jobName),
      ...RETIRED_SCHEDULER_JOB_NAMES,
    ],
    desired: JOB_OPERATIONAL_CONTRACTS.flatMap((contract) => {
      if (contract.posture !== 'active' || contract.schedule === 'none') return []
      return [
        {
          schedulerId: `${contract.jobName}-recurring`,
          jobName: contract.jobName,
          repeat: parseSchedule(contract.schedule),
          jobOptions: jobEnqueueOptions(contract.jobName),
        },
      ]
    }),
  }
}
