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
import { isGateDeniedResult, type GateDeniedExecutionKind } from './gate-denial'
import {
  assessJobRuntime,
  type JobOperationalContract,
  type JobRuntimeObservation,
  type JobRuntimeReadinessReason,
} from './runtime-authority'
import { executionKindOf, type JobExecutionKind } from './schedule-firing'

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

type JobRuntimeDenialEvent = JobRuntimeEvent &
  Readonly<{
    /** A denied schedule firing is a dead cadence; a denied job is routine. */
    executionKind: GateDeniedExecutionKind
  }>

type JobRuntimeFailureEvent = JobRuntimeEvent &
  Readonly<{
    /**
     * A failed firing is answered by any later success; failed on-demand work
     * is dead-lettered and answered only by its redrive.
     */
    executionKind: JobExecutionKind
  }>

export type JobRuntimeObservationSink = Readonly<{
  recordStarted(event: JobRuntimeEvent): Promise<void>
  recordSucceeded(event: JobRuntimeSuccessEvent): Promise<void>
  /** A terminal gate denial: BullMQ completed the job, but nothing ran. */
  recordDenied(event: JobRuntimeDenialEvent): Promise<void>
  recordTerminalFailure(event: JobRuntimeFailureEvent): Promise<void>
  recordStalled(
    event: Readonly<{ queue: string; jobId: string; at: Date }>,
  ): Promise<void>
}>

export type StoredJobRuntimeObservation = Readonly<{
  observation: JobRuntimeObservation
  runtimeStartedAt: Date
  /**
   * A terminal failure recorded before failures were split by execution kind,
   * in the head's old `lastTerminalFailureAt` field. Which kind it was is not
   * recorded; the report reads it by the family's schedule.
   */
  unsplitFailureAt: Date | null
}>

export type JobRuntimeObservationStore = JobRuntimeObservationSink &
  Readonly<{
    /**
     * An operator's acknowledgement that a family's failure is answered: it
     * writes `lastRepairAt` and nothing else. The worker never calls it; a
     * governed redrive's success writes the same field through `recordSucceeded`.
     */
    recordRepairAcknowledged(
      event: Readonly<{ jobName: string; at: Date }>,
    ): Promise<void>
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

function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`invalid job-runtime key segment '${value}'`)
  }
  return value
}

function observationKey(jobName: string): string {
  return `repkey:job-runtime:v1:${safeSegment(jobName)}`
}

function activeJobKey(queue: string, jobId: string): string {
  const digest = createHash('sha256').update(`${queue}\0${jobId}`, 'utf8').digest('hex')
  return `repkey:job-runtime:v1:active:${digest}`
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
  }>,
): JobRuntimeObservationStore {
  const { redis } = input

  const writeEvent = async (
    event: JobRuntimeEvent,
    field: 'lastStartedAt' | 'lastOnDemandFailureAt' | 'lastScheduleFailureAt',
  ): Promise<void> => {
    const at = asIso(event.at)
    await redis.hset(observationKey(event.jobName), field, at)
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
            observationKey(contract.jobName),
            'version',
            OBSERVATION_VERSION,
            'jobName',
            contract.jobName,
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
          activeJobKey(event.queue, event.jobId),
          event.jobName,
          'PX',
          ACTIVE_JOB_INDEX_TTL_MS,
        ),
      ])
    },

    async recordSucceeded(event) {
      const at = asIso(event.at)
      await redis.hset(
        observationKey(event.jobName),
        'lastSucceededAt',
        at,
        ...(event.repair ? ['lastRepairAt', at] : []),
      )
      await redis.del(activeJobKey(event.queue, event.jobId))
    },

    async recordDenied(event) {
      const at = asIso(event.at)
      await redis.hset(
        observationKey(event.jobName),
        'lastDeniedAt',
        at,
        ...(event.executionKind === 'schedule' ? ['lastScheduleDeniedAt', at] : []),
      )
      await redis.del(activeJobKey(event.queue, event.jobId))
    },

    async recordTerminalFailure(event) {
      await writeEvent(
        event,
        event.executionKind === 'schedule'
          ? 'lastScheduleFailureAt'
          : 'lastOnDemandFailureAt',
      )
      await redis.del(activeJobKey(event.queue, event.jobId))
    },

    async recordRepairAcknowledged(event) {
      await redis.hset(observationKey(event.jobName), 'lastRepairAt', asIso(event.at))
    },

    async recordStalled(event) {
      const jobName = await redis.get(activeJobKey(event.queue, event.jobId))
      if (!jobName) return
      await redis.hset(observationKey(jobName), 'lastStalledAt', asIso(event.at))
    },

    async read(jobName) {
      const row = await redis.hgetall(observationKey(jobName))
      if (
        row.version !== OBSERVATION_VERSION ||
        row.jobName !== jobName ||
        !row.runtimeStartedAt
      ) {
        return null
      }
      const runtimeStartedAt = parseDate(row.runtimeStartedAt)
      if (runtimeStartedAt === null) return null
      return {
        runtimeStartedAt,
        unsplitFailureAt: parseDate(row.lastTerminalFailureAt),
        observation: {
          jobName,
          handlerRegistered: row.handlerRegistered === '1',
          schedulerRegistered: row.schedulerRegisteredAtBoot === '1',
          lastStartedAt: parseDate(row.lastStartedAt),
          lastSucceededAt: parseDate(row.lastSucceededAt),
          lastOnDemandFailureAt: parseDate(row.lastOnDemandFailureAt),
          lastScheduleFailureAt: parseDate(row.lastScheduleFailureAt),
          lastRepairAt: parseDate(row.lastRepairAt),
          lastStalledAt: parseDate(row.lastStalledAt),
          lastDeniedAt: parseDate(row.lastDeniedAt),
          lastScheduleDeniedAt: parseDate(row.lastScheduleDeniedAt),
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
  id?: string
  /** Set on a scheduler firing; tells a failed firing from failed on-demand work. */
  repeatJobKey?: string
  timestamp?: number
  /** BullMQ delay from timestamp; only overdue delayed work contributes age. */
  delay?: number
  /**
   * Add-time options. BullMQ zeroes `delay` on promotion, also for a job listed
   * as delayed but promoted before it was read; `opts.delay` keeps it.
   */
  opts?: Readonly<{ delay?: number; jobId?: string }>
  processedOn?: number
  finishedOn?: number
  /** A completed job's result; a gate denial marks a completion that did not run. */
  returnvalue?: unknown
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

export type QueueEvidence = {
  schedulerNames: Set<string>
  lastStartedAt: Map<string, Date>
  lastSucceededAt: Map<string, Date>
  lastOnDemandFailureAt: Map<string, Date>
  lastScheduleFailureAt: Map<string, Date>
  /**
   * When each retained failed job of a family finished (null when BullMQ
   * recorded no time), firings and on-demand runs alike.
   */
  failures: Map<string, Array<Date | null>>
  lastDeniedAt: Map<string, Date>
  lastScheduleDeniedAt: Map<string, Date>
  /** Retained completed jobs the gate denied, per family. */
  deniedCount: Map<string, number>
  oldestWaitingAt: Map<string, Date>
}

function dateFromEpoch(value: number | undefined): Date | null {
  if (!Number.isSafeInteger(value) || value === undefined || value < 0) return null
  return new Date(value)
}

function positiveDelay(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
}

type QueuedJobState = 'waiting' | 'delayed' | 'prioritized' | 'waiting-children'

/**
 * When queued work became runnable. BullMQ keeps a job's creation `timestamp`
 * through delays and retries, and zeroes `delay` when it promotes a delayed job
 * to waiting, so the add-time `opts.delay` places a first attempt. BullMQ lists
 * job ids first and reads each hash afterwards, so a job listed as delayed can
 * be promoted in between and arrive here still 'delayed' with `delay` zeroed:
 * its live `delay` places it while it waits, and `opts.delay` once promotion has
 * cleared it. A job that has started before was requeued by a retry whose due
 * time BullMQ does not record: it gives no queue age rather than a false one,
 * and its failures already surface as repair or stall reasons.
 */
function runnableSince(job: JobRuntimeQueueJob, state: QueuedJobState): Date | null {
  const timestamp = dateFromEpoch(job.timestamp)
  if (!timestamp || dateFromEpoch(job.processedOn) !== null) return null
  const addTimeDelay = positiveDelay(job.opts?.delay)
  const delay =
    state === 'delayed' ? positiveDelay(job.delay) || addTimeDelay : addTimeDelay
  return new Date(timestamp.getTime() + delay)
}

function keepLatest(map: Map<string, Date>, name: string, candidate: Date | null): void {
  if (!candidate) return
  const current = map.get(name)
  if (!current || candidate.getTime() > current.getTime()) map.set(name, candidate)
}

function increment(map: Map<string, number>, name: string): void {
  map.set(name, (map.get(name) ?? 0) + 1)
}

/** Add to a family's list in place: a quarantine can hold thousands of entries. */
function appendTo<T>(map: Map<string, T[]>, name: string, value: T): void {
  const list = map.get(name)
  if (list) list.push(value)
  else map.set(name, [value])
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

/** A completed job is a success unless the gate denied it before it ran. */
function recordCompletion(evidence: QueueEvidence, job: JobRuntimeQueueJob): void {
  const finishedAt = dateFromEpoch(job.finishedOn)
  if (!isGateDeniedResult(job.returnvalue)) {
    keepLatest(evidence.lastSucceededAt, job.name, finishedAt)
    return
  }
  increment(evidence.deniedCount, job.name)
  keepLatest(evidence.lastDeniedAt, job.name, finishedAt)
  if (job.returnvalue.executionKind === 'schedule') {
    keepLatest(evidence.lastScheduleDeniedAt, job.name, finishedAt)
  }
}

/** A retained failed job failed terminally; the kind of run decides its latch. */
function recordFailure(evidence: QueueEvidence, job: JobRuntimeQueueJob): void {
  const finishedAt = dateFromEpoch(job.finishedOn)
  appendTo(evidence.failures, job.name, finishedAt)
  keepLatest(
    executionKindOf(job) === 'schedule'
      ? evidence.lastScheduleFailureAt
      : evidence.lastOnDemandFailureAt,
    job.name,
    finishedAt,
  )
}

/** What the live queues show: schedulers, and every retained job by outcome. */
export async function readQueueEvidence(
  queues: ReadonlyArray<JobRuntimeQueuePort>,
  now: Date,
): Promise<QueueEvidence> {
  const evidence: QueueEvidence = {
    schedulerNames: new Set(),
    lastStartedAt: new Map(),
    lastSucceededAt: new Map(),
    lastOnDemandFailureAt: new Map(),
    lastScheduleFailureAt: new Map(),
    failures: new Map(),
    lastDeniedAt: new Map(),
    lastScheduleDeniedAt: new Map(),
    deniedCount: new Map(),
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
              const dueAt = runnableSince(job, state)
              // A future delayed job is scheduled work, not queue backlog.
              if (dueAt && dueAt.getTime() <= now.getTime()) {
                keepOldest(evidence.oldestWaitingAt, job.name, dueAt)
              }
            }),
        ),
        ...(['active', 'completed', 'failed'] as const).map((state) =>
          scanState(queue, state, (job) => {
            keepLatest(evidence.lastStartedAt, job.name, dateFromEpoch(job.processedOn))
            if (state === 'completed') recordCompletion(evidence, job)
            if (state === 'failed') recordFailure(evidence, job)
          }),
        ),
      ])
    }),
  )
  return evidence
}

/** The quarantine entries of each family: the dead letters nothing consumes. */
export async function deadLettersByJob(
  quarantine: JobRuntimeQueuePort | null,
): Promise<Map<string, string[]>> {
  const ids = new Map<string, string[]>()
  if (!quarantine) return ids
  for (const state of ['waiting', 'delayed', 'prioritized'] as const) {
    await scanState(quarantine, state, (job) => {
      appendTo(ids, job.name, job.id ?? 'unknown')
    })
  }
  return ids
}

function latest(left: Date | null, right: Date | null | undefined): Date | null {
  if (!right) return left
  if (!left || right.getTime() > left.getTime()) return right
  return left
}

/**
 * Before failures were split by execution kind, one head field held both. A
 * scheduled family's was judged as a firing then, so it still is; an
 * unscheduled family runs only on demand. A family whose schedule was removed
 * after a firing failed keeps that old failure as on-demand work; at the split
 * the closed beta's only such latch was `sync-property-reviews`, a real one.
 */
function unsplitFailure(
  contract: JobOperationalContract,
  record: StoredJobRuntimeObservation,
): Readonly<{ onDemand: Date | null; schedule: Date | null }> {
  return contract.schedule === 'none'
    ? { onDemand: record.unsplitFailureAt, schedule: null }
    : { onDemand: null, schedule: record.unsplitFailureAt }
}

/**
 * One family's observation: its durable head joined to what the live queues
 * show. Where a time is in both, the later one wins, so a head that missed an
 * event (a worker that died before writing it) never hides a retained job.
 */
export function observeFamily(
  contract: JobOperationalContract,
  record: StoredJobRuntimeObservation,
  evidence: QueueEvidence,
  deadLetterCount: number,
): JobRuntimeObservation {
  const unsplit = unsplitFailure(contract, record)
  const { jobName } = contract
  return {
    ...record.observation,
    schedulerRegistered: evidence.schedulerNames.has(jobName),
    lastStartedAt: latest(
      record.observation.lastStartedAt,
      evidence.lastStartedAt.get(jobName),
    ),
    lastSucceededAt: latest(
      record.observation.lastSucceededAt,
      evidence.lastSucceededAt.get(jobName),
    ),
    lastOnDemandFailureAt: latest(
      latest(record.observation.lastOnDemandFailureAt, unsplit.onDemand),
      evidence.lastOnDemandFailureAt.get(jobName),
    ),
    lastScheduleFailureAt: latest(
      latest(record.observation.lastScheduleFailureAt, unsplit.schedule),
      evidence.lastScheduleFailureAt.get(jobName),
    ),
    lastDeniedAt: latest(
      record.observation.lastDeniedAt,
      evidence.lastDeniedAt.get(jobName),
    ),
    lastScheduleDeniedAt: latest(
      record.observation.lastScheduleDeniedAt,
      evidence.lastScheduleDeniedAt.get(jobName),
    ),
    oldestWaitingAt: evidence.oldestWaitingAt.get(jobName) ?? null,
    deadLetterCount,
  }
}

export type JobRuntimeReportRow = Readonly<{
  jobName: string
  owner: string
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
  /** Latest terminal failure of on-demand work, a manual run included. */
  lastOnDemandFailureAt: string | null
  /** Latest terminal failure of a schedule firing. */
  lastScheduleFailureAt: string | null
  /**
   * Retained failed jobs of the family, firings and on-demand runs alike;
   * counted, never paged on. It keeps a schedule that fails most firings
   * visible after a success answers the latest one.
   */
  failedCount: number
  lastDeniedAt: string | null
  /** Retained completed jobs the gate denied; counted, never paged on. */
  deniedCount: number
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
  /** Heads whose timestamps lie in the future or whose counts are malformed. */
  invalidObservations: number
  handlerMissing: number
  schedulerMissing: number
  /** Scheduled families whose latest firing the gate denied. */
  scheduleDenied: number
  forbiddenDarkWork: number
  quarantinedSchedulers: number
  missedObjectives: number
  queueAgeMissed: number
  stalled: number
  repairRequired: number
  deadLetters: number
  /**
   * Retained completed jobs the gate denied, across families. Informational:
   * a denied on-demand job is routine (a suspended organization, a disabled
   * capability), so only `scheduleDenied` affects readiness.
   */
  gateDenials: number
  /**
   * Retained failed jobs, across families. Informational, like `gateDenials`:
   * an unanswered failure already fails readiness as `repair_required`.
   */
  terminalFailures: number
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
      const collectedFrom = input.clock()
      const queues = [input.queues.default, input.queues.background].filter(
        (queue): queue is JobRuntimeQueuePort => queue !== null,
      )
      const [evidence, deadLetters, stored] = await Promise.all([
        readQueueEvidence(queues, collectedFrom),
        deadLettersByJob(input.quarantine),
        Promise.all(
          input.contracts.map((contract) => input.store.read(contract.jobName)),
        ),
      ])
      // Work keeps starting and finishing while the scans run. Judge the evidence
      // against a clock read after it was collected, so a job that finished
      // mid-read is not mistaken for a timestamp from the future.
      const now = input.clock()
      const rows = input.contracts.map((contract, index): JobRuntimeReportRow => {
        const record = stored[index] ?? null
        const observation = record
          ? observeFamily(
              contract,
              record,
              evidence,
              deadLetters.get(contract.jobName)?.length ?? 0,
            )
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
          lastOnDemandFailureAt:
            observation?.lastOnDemandFailureAt?.toISOString() ?? null,
          lastScheduleFailureAt:
            observation?.lastScheduleFailureAt?.toISOString() ?? null,
          failedCount: evidence.failures.get(contract.jobName)?.length ?? 0,
          lastDeniedAt: observation?.lastDeniedAt?.toISOString() ?? null,
          deniedCount: evidence.deniedCount.get(contract.jobName) ?? 0,
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
        invalidObservations: countReason(rows, 'invalid_observation'),
        handlerMissing: countReason(rows, 'handler_missing'),
        schedulerMissing: countReason(rows, 'scheduler_missing'),
        scheduleDenied: countReason(rows, 'schedule_denied'),
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
        gateDenials: rows.reduce((sum, row) => sum + row.deniedCount, 0),
        terminalFailures: rows.reduce((sum, row) => sum + row.failedCount, 0),
        rows,
      }
    },
  }
}
