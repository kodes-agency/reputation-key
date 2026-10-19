// In-memory stand-ins for what the job-runtime observation store and report
// read (src/shared/jobs/runtime-observations.ts): the Queue Redis commands the
// heads use, and the BullMQ queue methods the retained-job scan uses. Test-only.

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
