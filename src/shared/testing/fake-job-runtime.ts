// In-memory stand-ins for what the job-runtime observation store and report
// read (src/shared/jobs/runtime-observations.ts): the Queue Redis commands the
// heads use, and the BullMQ queue methods the retained-job scan uses. Test-only.

import type { JobOperationalContract } from '#/shared/jobs/runtime-authority'
import {
  createJobRuntimeObservationStore,
  createJobRuntimeReportReader,
} from '#/shared/jobs/runtime-observations'
import type {
  JobRuntimeQueuePort,
  JobRuntimeRedisPort,
} from '#/shared/jobs/runtime-observations'

export type FakeJobRuntimeRedis = JobRuntimeRedisPort &
  Readonly<{
    /** Every head, by key, for a test to read what a write left behind. */
    hashes: Map<string, Map<string, string>>
  }>

export function createFakeJobRuntimeRedis(): FakeJobRuntimeRedis {
  const hashes = new Map<string, Map<string, string>>()
  const strings = new Map<string, string>()
  return {
    hashes,
    async hset(key, ...fields) {
      const hash = hashes.get(key) ?? new Map<string, string>()
      for (let index = 0; index < fields.length; index += 2) {
        hash.set(fields[index]!, fields[index + 1]!)
      }
      hashes.set(key, hash)
      return fields.length / 2
    },
    async hgetall(key) {
      return Object.fromEntries(hashes.get(key) ?? [])
    },
    async set(key, value) {
      strings.set(key, value)
      return 'OK'
    },
    async get(key) {
      return strings.get(key) ?? null
    },
    async del(key) {
      return strings.delete(key) ? 1 : 0
    },
  }
}

/** A queue holding `jobs` by BullMQ state, with the schedulers it registers. */
export function fakeRuntimeQueue(
  options: Readonly<{
    schedulers?: Array<{ key: string; name: string }>
    jobs?: Partial<Record<string, Array<Record<string, unknown>>>>
  }> = {},
): JobRuntimeQueuePort {
  return {
    getJobSchedulers: async () => options.schedulers ?? [],
    getJobs: async (types, start = 0, end = -1) => {
      const type = (Array.isArray(types) ? types[0] : types) ?? 'waiting'
      const rows = options.jobs?.[type] ?? []
      return rows.slice(start, end < 0 ? undefined : end + 1) as never
    },
  }
}

type ReadQueues = Readonly<{
  background?: JobRuntimeQueuePort | null
  default?: JobRuntimeQueuePort | null
  quarantine?: JobRuntimeQueuePort | null
  clock?: () => Date
}>

/**
 * Boots the observation store over a fake Queue Redis and returns a `read` for
 * the runtime report. Handlers and schedulers default to every contract's job.
 */
export async function bootJobRuntime(
  options: Readonly<{
    contracts: Array<JobOperationalContract>
    /** What the report reader's clock returns unless a read passes its own. */
    now: Date
    startedAt?: Date
    handlers?: ReadonlySet<string>
    schedulers?: ReadonlySet<string>
  }>,
) {
  const contracts = options.contracts
  const jobNames = contracts.map((c) => c.jobName)
  const redis = createFakeJobRuntimeRedis()
  const store = createJobRuntimeObservationStore({ redis })
  await store.recordBoot({
    contracts,
    registeredHandlers: options.handlers ?? new Set(jobNames),
    registeredSchedulers: options.schedulers ?? new Set(jobNames),
    runtimeStartedAt: options.startedAt ?? new Date('2026-08-27T05:59:00.000Z'),
  })
  const read = ({
    background = fakeRuntimeQueue(),
    default: defaultQueue = null,
    quarantine = null,
    clock = () => options.now,
  }: ReadQueues = {}) =>
    createJobRuntimeReportReader({
      contracts,
      store,
      queues: { background, default: defaultQueue },
      quarantine,
      clock,
    }).read()
  return { redis, store, contracts, read }
}
