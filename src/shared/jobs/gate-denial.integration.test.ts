// A schedule firing the delayed-execution gate denies completes in BullMQ, so
// it never retries. This suite proves, against a real worker and Redis, that
// the completion is recorded as a denial by both the worker's live listener and
// the retained completed-set scan, and never as a success that keeps a dead
// cadence fresh.

import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Queue } from 'bullmq'
import {
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import { createGatedJobHandler } from './delayed-execution-gate'
import { createJobRegistry } from './registry'
import type { JobOperationalContract } from './runtime-authority'
import {
  createJobRuntimeObservationStore,
  createJobRuntimeReportReader,
} from './runtime-observations'
import { createJobWorker } from './worker'

// Suite-unique names: the shared local Redis hosts other suites' queues and
// runtime heads, so nothing here may collide with a governed family.
const RUN = randomUUID().slice(0, 8)
const QUEUE = `gate-denial-it-${RUN}`
const JOB = `gate-denial-it-job-${RUN}`
const SCHEDULER = `${JOB}-recurring`
const WAIT = { timeout: 15_000, interval: 50 } as const

const CONTRACT: JobOperationalContract = {
  jobName: JOB,
  owner: 'platform',
  processor: 'src/shared/jobs/gate-denial.integration.test.ts',
  action: 'system:goal.maintain',
  capability: 'goal.use',
  queue: 'background',
  retryAttempts: 3,
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

let lease: RedisTestLease | undefined
let queue: Queue | undefined

beforeAll(async () => {
  lease = await acquireRedisTestLease()
  if (!lease.redis) return
  queue = new Queue(QUEUE, {
    connection: lease.redis as unknown as import('bullmq').ConnectionOptions,
  })
})

afterEach(() => {
  resetDelayedExecutionPolicy()
})

afterAll(async () => {
  if (queue) {
    await queue.removeJobScheduler(SCHEDULER)
    await queue.obliterate({ force: true })
    await queue.close()
  }
  await lease?.redis?.del(`repkey:job-runtime:v1:${JOB}`)
  lease?.release()
})

describe('gate-denied schedule firing (real BullMQ worker)', () => {
  it('is recorded as a denial that fails the family, never as a success', async () => {
    const redis = lease?.redis
    if (!redis || !queue) return
    initDelayedExecutionPolicy({
      decide: async () => ({
        outcome: 'deny',
        allowed: false,
        reason: 'missing_scope',
        action: 'system:goal.maintain',
        policyVersion: 'gate-denial-it',
        freshRead: false,
      }),
    })
    const handler = vi.fn(async () => ({ maintained: 1 }))
    const registry = createJobRegistry()
    registry.register(JOB, handler)
    const store = createJobRuntimeObservationStore({ redis })
    const runtimeStartedAt = new Date()
    await store.recordBoot({
      contracts: [CONTRACT],
      registeredHandlers: new Set([JOB]),
      registeredSchedulers: new Set([JOB]),
      runtimeStartedAt,
    })
    const worker = createJobWorker(
      QUEUE,
      createGatedJobHandler('background', registry),
      1,
      undefined,
      store,
    )
    if (!worker) throw new Error('worker unavailable (queue Redis missing)')

    try {
      // An `every` scheduler fires its first job at once, carrying repeatJobKey.
      await queue.upsertJobScheduler(
        SCHEDULER,
        { every: 3_600_000 },
        { name: JOB, opts: { removeOnComplete: { count: 10 } } },
      )

      await vi.waitFor(async () => {
        const stored = await store.read(JOB)
        expect(stored?.observation.lastScheduleDeniedAt).toBeInstanceOf(Date)
      }, WAIT)
      const stored = await store.read(JOB)
      expect(stored?.observation.lastSucceededAt).toBeNull()
      expect(handler).not.toHaveBeenCalled()

      const [completed] = await queue.getJobs('completed')
      expect(completed?.returnvalue).toEqual({
        gate: 'denied',
        reason: 'missing_scope',
        executionKind: 'schedule',
      })

      const report = await createJobRuntimeReportReader({
        contracts: [CONTRACT],
        store,
        queues: { background: queue, default: null },
        quarantine: null,
        clock: () => new Date(),
      }).read()
      expect(report).toMatchObject({
        ready: false,
        scheduleDenied: 1,
        gateDenials: 1,
      })
      expect(report.rows[0]).toMatchObject({
        reasons: ['schedule_denied'],
        lastSucceededAt: null,
        deniedCount: 1,
      })
    } finally {
      await worker.close()
    }
  })
})
