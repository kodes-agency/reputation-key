/**
 * Durable, content-free job-runtime observations.
 *
 * Registration and execution heads live in Queue Redis, beside BullMQ's own
 * scheduler/job state. They survive a worker restart without pretending Redis
 * is application recovery authority: canonical work is still rebuilt from
 * PostgreSQL/outbox facts. Reads merge those heads with the live BullMQ
 * scheduler, retained job, waiting-job, and dead-letter sets.
 */

import { createHash } from 'node:crypto'
import {
  assessJobRuntime,
  type JobOperationalContract,
  type JobRuntimeObservation,
  type JobRuntimeReadinessReason,
} from './runtime-authority'

const OBSERVATION_VERSION = '1'
const ACTIVE_JOB_INDEX_TTL_MS = 7 * 24 * 60 * 60_000
const SCAN_PAGE_SIZE = 500

export type JobRuntimeRedisPort = Readonly<{
  hset(key: string, ...fields: string[]): Promise<number>
  hgetall(key: string): Promise<Record<string, string>>
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>
  get(key: string): Promise<string | null>
  del(key: string): Promise<number>
}>

type JobRuntimeEvent = Readonly<{
  queue: string
  jobName: string
  jobId: string
  at: Date
}>

type JobRuntimeSuccessEvent = JobRuntimeEvent &
  Readonly<{
    /** True only when this execution came from the governed quarantine redrive. */
    repair: boolean
  }>

export type JobRuntimeObservationSink = Readonly<{
  recordStarted(event: JobRuntimeEvent): Promise<void>
  recordSucceeded(event: JobRuntimeSuccessEvent): Promise<void>
  recordTerminalFailure(event: JobRuntimeEvent): Promise<void>
  recordStalled(
    event: Readonly<{ queue: string; jobId: string; at: Date }>,
  ): Promise<void>
}>

export type StoredJobRuntimeObservation = Readonly<{
  observation: JobRuntimeObservation
  runtimeStartedAt: Date
}>

export type JobRuntimeObservationStore = JobRuntimeObservationSink &
  Readonly<{
    recordBoot(
      input: Readonly<{
        contracts: readonly JobOperationalContract[]
        registeredHandlers: ReadonlySet<string>
        registeredSchedulers: ReadonlySet<string>
        runtimeStartedAt: Date
      }>,
    ): Promise<void>
    read(jobName: string): Promise<StoredJobRuntimeObservation | null>
  }>

export type JobRuntimeQueueRedisSource = Readonly<{
  client: Promise<unknown>
}>

/** Adapt BullMQ's existing Queue connection; no second Redis client is opened. */
export function createQueueJobRuntimeObservationStore(
  input: Readonly<{
    queue: JobRuntimeQueueRedisSource
    cell: string
  }>,
): JobRuntimeObservationStore {
  const redis = {
    hset: async (key: string, ...fields: string[]) =>
      ((await input.queue.client) as JobRuntimeRedisPort).hset(key, ...fields),
    hgetall: async (key: string) =>
      ((await input.queue.client) as JobRuntimeRedisPort).hgetall(key),
    set: async (key: string, value: string, mode: 'PX', ttlMs: number) =>
      ((await input.queue.client) as JobRuntimeRedisPort).set(key, value, mode, ttlMs),
    get: async (key: string) =>
      ((await input.queue.client) as JobRuntimeRedisPort).get(key),
    del: async (key: string) =>
      ((await input.queue.client) as JobRuntimeRedisPort).del(key),
  } satisfies JobRuntimeRedisPort
  return createJobRuntimeObservationStore({ redis, cell: input.cell })
}

function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`invalid job-runtime key segment '${value}'`)
  }
  return value
}

function observationKey(cell: string, jobName: string): string {
  return `repkey:job-runtime:v1:${safeSegment(cell)}:${safeSegment(jobName)}`
}

function activeJobKey(cell: string, queue: string, jobId: string): string {
  const digest = createHash('sha256').update(`${queue}\0${jobId}`, 'utf8').digest('hex')
  return `repkey:job-runtime:v1:${safeSegment(cell)}:active:${digest}`
}

function asIso(at: Date): string {
  if (Number.isNaN(at.getTime())) throw new Error('job-runtime timestamp is invalid')
  return at.toISOString()
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date(Number.NaN) : parsed
}

export function createJobRuntimeObservationStore(
  input: Readonly<{
    redis: JobRuntimeRedisPort
    cell: string
  }>,
): JobRuntimeObservationStore {
  const cell = safeSegment(input.cell)
  const { redis } = input

  const writeEvent = async (
    event: JobRuntimeEvent,
    field: 'lastStartedAt' | 'lastSucceededAt' | 'lastTerminalFailureAt',
  ): Promise<void> => {
    const at = asIso(event.at)
    await redis.hset(observationKey(cell, event.jobName), field, at)
  }

  return {
    async recordBoot({
      contracts,
      registeredHandlers,
      registeredSchedulers,
      runtimeStartedAt,
    }) {
      const startedAt = asIso(runtimeStartedAt)
      await Promise.all(
        contracts.map((contract) =>
          redis.hset(
            observationKey(cell, contract.jobName),
            'version',
            OBSERVATION_VERSION,
            'jobName',
            contract.jobName,
            'cell',
            cell,
            'handlerRegistered',
            registeredHandlers.has(contract.jobName) ? '1' : '0',
            'schedulerRegisteredAtBoot',
            registeredSchedulers.has(contract.jobName) ? '1' : '0',
            'runtimeStartedAt',
            startedAt,
          ),
        ),
      )
    },

    async recordStarted(event) {
      await Promise.all([
        writeEvent(event, 'lastStartedAt'),
        redis.set(
          activeJobKey(cell, event.queue, event.jobId),
          event.jobName,
          'PX',
          ACTIVE_JOB_INDEX_TTL_MS,
        ),
      ])
    },

    async recordSucceeded(event) {
      const at = asIso(event.at)
      await redis.hset(
        observationKey(cell, event.jobName),
        'lastSucceededAt',
        at,
        ...(event.repair ? ['lastRepairAt', at] : []),
      )
      await redis.del(activeJobKey(cell, event.queue, event.jobId))
    },

    async recordTerminalFailure(event) {
      await writeEvent(event, 'lastTerminalFailureAt')
      await redis.del(activeJobKey(cell, event.queue, event.jobId))
    },

    async recordStalled(event) {
      const jobName = await redis.get(activeJobKey(cell, event.queue, event.jobId))
      if (!jobName) return
      await redis.hset(observationKey(cell, jobName), 'lastStalledAt', asIso(event.at))
    },

    async read(jobName) {
      const row = await redis.hgetall(observationKey(cell, jobName))
      if (
        row.version !== OBSERVATION_VERSION ||
        row.jobName !== jobName ||
        row.cell !== cell ||
        !row.runtimeStartedAt
      ) {
        return null
      }
      const runtimeStartedAt = parseDate(row.runtimeStartedAt)
      if (runtimeStartedAt === null) return null
      return {
        runtimeStartedAt,
        observation: {
          jobName,
          cell,
          handlerRegistered: row.handlerRegistered === '1',
          schedulerRegistered: row.schedulerRegisteredAtBoot === '1',
          lastStartedAt: parseDate(row.lastStartedAt),
          lastSucceededAt: parseDate(row.lastSucceededAt),
          lastTerminalFailureAt: parseDate(row.lastTerminalFailureAt),
          lastRepairAt: parseDate(row.lastRepairAt),
          lastStalledAt: parseDate(row.lastStalledAt),
          oldestWaitingAt: null,
          deadLetterCount: 0,
        },
      }
    },
  }
}

type RuntimeJobState =
  | 'waiting'
  | 'delayed'
  | 'prioritized'
  | 'waiting-children'
  | 'active'
  | 'completed'
  | 'failed'

export type JobRuntimeQueueJob = Readonly<{
  name: string
  timestamp?: number
  /** BullMQ delay from timestamp; only overdue delayed work contributes age. */
  delay?: number
  processedOn?: number
  finishedOn?: number
}>

export type JobRuntimeQueuePort = Readonly<{
  getJobSchedulers(
    start?: number,
    end?: number,
    asc?: boolean,
  ): Promise<Array<Readonly<{ key: string; name: string }>>>
  getJobs(
    types?: RuntimeJobState | RuntimeJobState[],
    start?: number,
    end?: number,
    asc?: boolean,
  ): Promise<JobRuntimeQueueJob[]>
}>

type QueueEvidence = {
  schedulerNames: Set<string>
  lastStartedAt: Map<string, Date>
  lastSucceededAt: Map<string, Date>
  lastTerminalFailureAt: Map<string, Date>
  oldestWaitingAt: Map<string, Date>
}

function dateFromEpoch(value: number | undefined): Date | null {
  if (!Number.isSafeInteger(value) || value === undefined || value < 0) return null
  return new Date(value)
}

function keepLatest(map: Map<string, Date>, name: string, candidate: Date | null): void {
  if (!candidate) return
  const current = map.get(name)
  if (!current || candidate.getTime() > current.getTime()) map.set(name, candidate)
}

function keepOldest(map: Map<string, Date>, name: string, candidate: Date | null): void {
  if (!candidate) return
  const current = map.get(name)
  if (!current || candidate.getTime() < current.getTime()) map.set(name, candidate)
}

async function scanState(
  queue: JobRuntimeQueuePort,
  state: RuntimeJobState,
  visit: (job: JobRuntimeQueueJob) => void,
): Promise<void> {
  for (let start = 0; ; start += SCAN_PAGE_SIZE) {
    const jobs = await queue.getJobs(state, start, start + SCAN_PAGE_SIZE - 1, true)
    for (const job of jobs) visit(job)
    if (jobs.length < SCAN_PAGE_SIZE) return
  }
}

async function readQueueEvidence(
  queues: ReadonlyArray<JobRuntimeQueuePort>,
  now: Date,
): Promise<QueueEvidence> {
  const evidence: QueueEvidence = {
    schedulerNames: new Set(),
    lastStartedAt: new Map(),
    lastSucceededAt: new Map(),
    lastTerminalFailureAt: new Map(),
    oldestWaitingAt: new Map(),
  }
  await Promise.all(
    queues.map(async (queue) => {
      const schedulers = await queue.getJobSchedulers(0, -1, true)
      for (const scheduler of schedulers) {
        if (scheduler.key === `${scheduler.name}-recurring`) {
          evidence.schedulerNames.add(scheduler.name)
        }
      }
      await Promise.all([
        ...(['waiting', 'delayed', 'prioritized', 'waiting-children'] as const).map(
          (state) =>
            scanState(queue, state, (job) => {
              const timestamp = dateFromEpoch(job.timestamp)
              if (!timestamp) return
              const rawDelay = job.delay
              const delay =
                state === 'delayed' &&
                typeof rawDelay === 'number' &&
                Number.isSafeInteger(rawDelay) &&
                rawDelay > 0
                  ? rawDelay
                  : 0
              const dueAt = new Date(timestamp.getTime() + delay)
              // A future delayed job is scheduled work, not queue backlog.
              if (dueAt.getTime() <= now.getTime()) {
                keepOldest(evidence.oldestWaitingAt, job.name, dueAt)
              }
            }),
        ),
        ...(['active', 'completed', 'failed'] as const).map((state) =>
          scanState(queue, state, (job) => {
            keepLatest(evidence.lastStartedAt, job.name, dateFromEpoch(job.processedOn))
            if (state === 'completed') {
              keepLatest(
                evidence.lastSucceededAt,
                job.name,
                dateFromEpoch(job.finishedOn),
              )
            }
            if (state === 'failed') {
              keepLatest(
                evidence.lastTerminalFailureAt,
                job.name,
                dateFromEpoch(job.finishedOn),
              )
            }
          }),
        ),
      ])
    }),
  )
  return evidence
}

async function deadLettersByJob(
  quarantine: JobRuntimeQueuePort | null,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (!quarantine) return counts
  for (const state of ['waiting', 'delayed', 'prioritized'] as const) {
    await scanState(quarantine, state, (job) => {
      counts.set(job.name, (counts.get(job.name) ?? 0) + 1)
    })
  }
  return counts
}

function latest(left: Date | null, right: Date | undefined): Date | null {
  if (!right) return left
  if (!left || right.getTime() > left.getTime()) return right
  return left
}

export type JobRuntimeReportRow = Readonly<{
  jobName: string
  owner: string
  /** Observed processing cell; null means the durable boot head is missing. */
  cell: string | null
  processor: string
  action: string
  routing: JobOperationalContract['routing']
  capability: string
  posture: JobOperationalContract['posture']
  queue: JobOperationalContract['queue']
  schedule: string
  retryAttempts: number
  retryBackoff: string
  timeoutMs: number
  workerConcurrency: number
  retention: string
  lastSuccessObjectiveMs: number | null
  maximumQueueAgeMs: number
  ready: boolean
  reasons: readonly JobRuntimeReadinessReason[]
  lastSucceededAt: string | null
  oldestWaitingAt: string | null
  deadLetterCount: number
  repairCommand: string
  runbook: string
}>

export type JobRuntimeReport = Readonly<{
  ready: boolean
  total: number
  active: number
  dark: number
  quarantined: number
  failing: number
  missingObservations: number
  handlerMissing: number
  schedulerMissing: number
  forbiddenDarkWork: number
  quarantinedSchedulers: number
  missedObjectives: number
  queueAgeMissed: number
  stalled: number
  repairRequired: number
  deadLetters: number
  rows: readonly JobRuntimeReportRow[]
}>

function countReason(
  rows: readonly JobRuntimeReportRow[],
  reason: JobRuntimeReadinessReason,
): number {
  return rows.filter((row) => row.reasons.includes(reason)).length
}

const DARK_EXECUTION_REASONS: readonly JobRuntimeReadinessReason[] = [
  'dark_handler_registered',
  'dark_scheduler_registered',
  'dark_queue_work_present',
  'dark_execution_observed',
]

export function createJobRuntimeReportReader(
  input: Readonly<{
    contracts: readonly JobOperationalContract[]
    store: JobRuntimeObservationStore
    queues: Readonly<{
      default: JobRuntimeQueuePort | null
      background: JobRuntimeQueuePort | null
    }>
    quarantine: JobRuntimeQueuePort | null
    clock: () => Date
  }>,
): Readonly<{ read(): Promise<JobRuntimeReport> }> {
  return {
    async read() {
      const now = input.clock()
      const queues = [input.queues.default, input.queues.background].filter(
        (queue): queue is JobRuntimeQueuePort => queue !== null,
      )
      const [evidence, deadLetters, stored] = await Promise.all([
        readQueueEvidence(queues, now),
        deadLettersByJob(input.quarantine),
        Promise.all(
          input.contracts.map((contract) => input.store.read(contract.jobName)),
        ),
      ])
      const rows = input.contracts.map((contract, index): JobRuntimeReportRow => {
        const record = stored[index] ?? null
        const observation = record
          ? {
              ...record.observation,
              schedulerRegistered: evidence.schedulerNames.has(contract.jobName),
              lastStartedAt: latest(
                record.observation.lastStartedAt,
                evidence.lastStartedAt.get(contract.jobName),
              ),
              lastSucceededAt: latest(
                record.observation.lastSucceededAt,
                evidence.lastSucceededAt.get(contract.jobName),
              ),
              lastTerminalFailureAt: latest(
                record.observation.lastTerminalFailureAt,
                evidence.lastTerminalFailureAt.get(contract.jobName),
              ),
              oldestWaitingAt: evidence.oldestWaitingAt.get(contract.jobName) ?? null,
              deadLetterCount: deadLetters.get(contract.jobName) ?? 0,
            }
          : null
        const readiness = assessJobRuntime({
          contract,
          observation,
          runtimeStartedAt: record?.runtimeStartedAt ?? now,
          now,
        })
        return {
          jobName: contract.jobName,
          owner: contract.owner,
          cell: record?.observation.cell ?? null,
          processor: contract.processor,
          action: contract.action,
          routing: contract.routing,
          capability: contract.capability,
          posture: contract.posture,
          queue: contract.queue,
          schedule: contract.schedule,
          retryAttempts: contract.retryAttempts,
          retryBackoff: contract.retryBackoff,
          timeoutMs: contract.timeoutMs,
          workerConcurrency: contract.workerConcurrency,
          retention: contract.retention,
          lastSuccessObjectiveMs: contract.lastSuccessObjectiveMs,
          maximumQueueAgeMs: contract.maximumQueueAgeMs,
          ready: readiness.ready,
          reasons: readiness.reasons,
          lastSucceededAt: observation?.lastSucceededAt?.toISOString() ?? null,
          oldestWaitingAt: observation?.oldestWaitingAt?.toISOString() ?? null,
          deadLetterCount: observation?.deadLetterCount ?? 0,
          repairCommand: contract.repairCommand,
          runbook: contract.runbook,
        }
      })
      return {
        ready: rows.every((row) => row.ready),
        total: rows.length,
        active: input.contracts.filter((contract) => contract.posture === 'active')
          .length,
        dark: input.contracts.filter((contract) => contract.posture === 'dark').length,
        quarantined: input.contracts.filter(
          (contract) => contract.posture === 'quarantined',
        ).length,
        failing: rows.filter((row) => !row.ready).length,
        missingObservations: countReason(rows, 'observation_missing'),
        handlerMissing: countReason(rows, 'handler_missing'),
        schedulerMissing: countReason(rows, 'scheduler_missing'),
        forbiddenDarkWork: rows.filter((row) =>
          row.reasons.some((reason) => DARK_EXECUTION_REASONS.includes(reason)),
        ).length,
        quarantinedSchedulers: countReason(rows, 'quarantined_scheduler_registered'),
        missedObjectives:
          countReason(rows, 'success_never_observed') +
          countReason(rows, 'last_success_objective_missed'),
        queueAgeMissed: countReason(rows, 'queue_age_objective_missed'),
        stalled: countReason(rows, 'stalled_work_observed'),
        repairRequired: countReason(rows, 'repair_required'),
        deadLetters: rows.reduce((sum, row) => sum + row.deadLetterCount, 0),
        rows,
      }
    },
  }
}
