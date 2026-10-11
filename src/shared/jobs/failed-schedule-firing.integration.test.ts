// A schedule firing that fails past its retry budget is not dead-lettered, and
// the next firing that succeeds repairs its family. The unit fakes store any
// job id, so only a real worker and Redis prove what the closed beta showed:
// BullMQ refuses a dead-letter id built from a firing id
// (`repeat:<scheduler>:<timestamp>`), and no redrive can ever clear the family.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Queue, type Job } from 'bullmq'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import type { JobOperationalContract } from './runtime-authority'
import {
  createJobRuntimeObservationStore,
  createJobRuntimeReportReader,
} from './runtime-observations'
import { createJobWorker } from './worker'

// Suite-unique names: the shared local Redis hosts other suites' queues and
// runtime heads, so nothing here may collide with a governed family — the
// dead-letter queue included.
const RUN = randomUUID().slice(0, 8)
const QUEUE = `failed-firing-it-${RUN}`
const QUARANTINE = `failed-firing-it-quarantine-${RUN}`
const SCHEDULED_JOB = `failed-firing-it-scheduled-${RUN}`
const ON_DEMAND_JOB = `failed-firing-it-on-demand-${RUN}`
const SCHEDULER = `${SCHEDULED_JOB}-recurring`
const WAIT = { timeout: 15_000, interval: 50 } as const
const ONE_ATTEMPT = { attempts: 1, removeOnFail: { count: 10 } } as const

const SCHEDULED: JobOperationalContract = {
  jobName: SCHEDULED_JOB,
  owner: 'platform',
  processor: 'src/shared/jobs/failed-schedule-firing.integration.test.ts',
  action: 'system:health.check',
  capability: 'none',
  queue: 'background',
  retryAttempts: 1,
  retryBackoff: 'exponential:30000',
  timeoutMs: 30_000,
  workerConcurrency: 1,
  retention: 'completed:100,failed:50',
  routing: 'cell_local',
  posture: 'active',
  schedule: 'every:3600000',
  lastSuccessObjectiveMs: 2 * 3_600_000 + 30_000,
  maximumQueueAgeMs: 900_000,
  repairCommand: 'pnpm ops quarantine redrive <quarantineJobId> --apply',
  runbook: 'docs/operations/runbooks.md',
}
const ON_DEMAND: JobOperationalContract = {
  ...SCHEDULED,
  jobName: ON_DEMAND_JOB,
  schedule: 'none',
  lastSuccessObjectiveMs: null,
}
const CONTRACTS = [SCHEDULED, ON_DEMAND]

let lease: RedisTestLease | undefined
let queue: Queue | undefined
let quarantine: Queue | undefined

beforeAll(async () => {
  lease = await acquireRedisTestLease()
  if (!lease.redis) return
  const connection = lease.redis as unknown as import('bullmq').ConnectionOptions
  queue = new Queue(QUEUE, { connection })
  quarantine = new Queue(QUARANTINE, { connection })
})

afterAll(async () => {
  if (queue) {
    await queue.removeJobScheduler(SCHEDULER)
    await queue.obliterate({ force: true })
    await queue.close()
  }
  if (quarantine) {
    await quarantine.obliterate({ force: true })
    await quarantine.close()
  }
  await lease?.redis?.del(
    `repkey:job-runtime:v1:${SCHEDULED_JOB}`,
    `repkey:job-runtime:v1:${ON_DEMAND_JOB}`,
  )
  lease?.release()
})

/** Both families' terminal-failure heads, written by the worker's `failed` listener. */
async function waitForFailureHeads(
  store: ReturnType<typeof createJobRuntimeObservationStore>,
): Promise<void> {
  await vi.waitFor(async () => {
    for (const jobName of [SCHEDULED_JOB, ON_DEMAND_JOB]) {
      const head = await store.read(jobName)
      expect(head?.observation.lastTerminalFailureAt).toBeInstanceOf(Date)
    }
  }, WAIT)
}

describe('terminally failed work (real BullMQ worker)', () => {
  it('dead-letters on-demand work but not a schedule firing, which the next firing repairs', async () => {
    const redis = lease?.redis
    if (!redis || !queue || !quarantine) return
    const store = createJobRuntimeObservationStore({ redis })
    await store.recordBoot({
      contracts: CONTRACTS,
      registeredHandlers: new Set([SCHEDULED_JOB, ON_DEMAND_JOB]),
      registeredSchedulers: new Set([SCHEDULED_JOB]),
      runtimeStartedAt: new Date(),
    })
    const readReport = () =>
      createJobRuntimeReportReader({
        contracts: CONTRACTS,
        store,
        queues: { background: queue ?? null, default: null },
        quarantine: quarantine ?? null,
        clock: () => new Date(),
      }).read()

    let failing = true
    const firingIds: string[] = []
    const worker = createJobWorker(
      QUEUE,
      async (job: Job) => {
        if (job.name === SCHEDULED_JOB) firingIds.push(job.id ?? '')
        if (failing) throw new Error('synthetic terminal failure')
      },
      1,
      quarantine,
      store,
    )
    if (!worker) throw new Error('worker unavailable (queue Redis missing)')

    try {
      // An `every` scheduler fires its first job at once, carrying repeatJobKey.
      await queue.upsertJobScheduler(
        SCHEDULER,
        { every: 3_600_000 },
        { name: SCHEDULED_JOB, opts: ONE_ATTEMPT },
      )
      const onDemand = await queue.add(ON_DEMAND_JOB, {}, ONE_ATTEMPT)

      await waitForFailureHeads(store)
      expect(firingIds).toEqual([expect.stringMatching(/^repeat:.+:\d+$/)])

      // The staged copy is confirmed after BullMQ's failed transition.
      const deadLetterId = `quarantine:${QUEUE}:${onDemand.id}`
      await vi.waitFor(async () => {
        const deadLetter = await quarantine?.getJob(deadLetterId)
        expect(deadLetter?.progress).toEqual({
          quarantinePublication: 'confirmed_failed',
          version: 1,
        })
      }, WAIT)
      const deadLetters = await quarantine.getJobs(['waiting', 'delayed', 'prioritized'])
      expect(deadLetters.map((job) => job.name)).toEqual([ON_DEMAND_JOB])

      const failed = await readReport()
      expect(failed.rows).toMatchObject([
        { jobName: SCHEDULED_JOB, reasons: ['repair_required'], deadLetterCount: 0 },
        {
          jobName: ON_DEMAND_JOB,
          reasons: ['repair_required', 'dead_letter_present'],
          deadLetterCount: 1,
        },
      ])

      // The scheduler queued the next firing when the failed one started.
      failing = false
      const [nextFiring] = await queue.getJobs('delayed')
      expect(nextFiring?.name).toBe(SCHEDULED_JOB)
      await nextFiring?.promote()

      await vi.waitFor(async () => {
        expect((await readReport()).rows[0]).toMatchObject({
          jobName: SCHEDULED_JOB,
          ready: true,
          reasons: [],
        })
      }, WAIT)

      // On-demand work is one unit: a later job of the family succeeding
      // does not repair the one that was lost.
      await queue.add(ON_DEMAND_JOB, {}, ONE_ATTEMPT)
      await vi.waitFor(async () => {
        const head = await store.read(ON_DEMAND_JOB)
        expect(head?.observation.lastSucceededAt).toBeInstanceOf(Date)
      }, WAIT)
      expect((await readReport()).rows[1]).toMatchObject({
        jobName: ON_DEMAND_JOB,
        ready: false,
        reasons: ['repair_required', 'dead_letter_present'],
      })
    } finally {
      await worker.close()
    }
  })
})
