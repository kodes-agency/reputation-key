// Acknowledging a repair against a real BullMQ worker and Redis. The unit fakes
// hold whatever jobs a test hands them; only a real worker and queues show that
// what the command refuses on is what BullMQ and the dead-letter queue really
// retain, and that a failure after the acknowledgement latches the family again.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Queue, type Job } from 'bullmq'
import { fakeRuntimeQueue } from '#/shared/testing/fake-job-runtime'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import { createJobRepairAcknowledger } from './repair-acknowledgement'
import type { JobOperationalContract } from './runtime-authority'
import {
  createJobRuntimeObservationStore,
  createJobRuntimeReportReader,
} from './runtime-observations'
import { createJobWorker } from './worker'

// Suite-unique names: the shared local Redis hosts other suites' queues and
// runtime heads, so nothing here may collide with a governed family.
const RUN = randomUUID().slice(0, 8)
const QUEUE = `ack-repair-it-${RUN}`
const QUARANTINE = `ack-repair-it-quarantine-${RUN}`
const FAMILY = `ack-repair-it-family-${RUN}`
const WAIT = { timeout: 15_000, interval: 50 } as const
const ONE_ATTEMPT = { attempts: 1, removeOnFail: { count: 10 } } as const

const CONTRACT: JobOperationalContract = {
  jobName: FAMILY,
  owner: 'platform',
  processor: 'src/shared/jobs/repair-acknowledgement.integration.test.ts',
  action: 'system:health.check',
  capability: 'none',
  queue: 'default',
  retryAttempts: 1,
  retryBackoff: 'exponential:30000',
  timeoutMs: 30_000,
  workerConcurrency: 1,
  retention: 'completed:100,failed:50',
  routing: 'cell_local',
  posture: 'active',
  schedule: 'none',
  lastSuccessObjectiveMs: null,
  maximumQueueAgeMs: 900_000,
  repairCommand: 'pnpm ops quarantine redrive <quarantineJobId> --apply',
  runbook: 'docs/operations/runbooks.md',
}

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
    await queue.obliterate({ force: true })
    await queue.close()
  }
  if (quarantine) {
    await quarantine.obliterate({ force: true })
    await quarantine.close()
  }
  await lease?.redis?.del(`repkey:job-runtime:v1:${FAMILY}`)
  lease?.release()
})

describe('acknowledging a repair (real BullMQ worker)', () => {
  it('refuses while the dead letter stands, then answers the failure, and a later failure latches again', async () => {
    const redis = lease?.redis
    if (!redis || !queue || !quarantine) return
    const store = createJobRuntimeObservationStore({ redis })
    await store.recordBoot({
      contracts: [CONTRACT],
      registeredHandlers: new Set([FAMILY]),
      registeredSchedulers: new Set(),
      runtimeStartedAt: new Date(),
    })
    const acknowledger = createJobRepairAcknowledger({
      contracts: [CONTRACT],
      store,
      queues: { default: queue, background: fakeRuntimeQueue() },
      quarantine,
      clock: () => new Date(),
    })
    const readRow = async () =>
      (
        await createJobRuntimeReportReader({
          contracts: [CONTRACT],
          store,
          queues: { default: queue ?? null, background: null },
          quarantine: quarantine ?? null,
          clock: () => new Date(),
        }).read()
      ).rows[0]

    let failing = true
    const worker = createJobWorker(
      QUEUE,
      async (_job: Job) => {
        if (failing) throw new Error('synthetic terminal failure')
      },
      1,
      quarantine,
      store,
    )
    if (!worker) throw new Error('worker unavailable (queue Redis missing)')

    try {
      // A run that fails, is dead-lettered, and is followed by a run that works.
      const failed = await queue.add(FAMILY, {}, ONE_ATTEMPT)
      const deadLetterId = `quarantine:${QUEUE}:${failed.id}`
      await vi.waitFor(async () => {
        expect(
          (await store.read(FAMILY))?.observation.lastOnDemandFailureAt,
        ).toBeInstanceOf(Date)
        expect((await quarantine?.getJob(deadLetterId))?.progress).toEqual({
          quarantinePublication: 'confirmed_failed',
          version: 1,
        })
      }, WAIT)
      failing = false
      await queue.add(FAMILY, {}, ONE_ATTEMPT)
      await vi.waitFor(async () => {
        expect((await store.read(FAMILY))?.observation.lastSucceededAt).toBeInstanceOf(
          Date,
        )
      }, WAIT)
      expect(await readRow()).toMatchObject({
        ready: false,
        reasons: ['repair_required', 'dead_letter_present'],
        failedCount: 1,
      })

      // The dead letter is a failure someone can still see: nothing is written.
      expect(await acknowledger.acknowledge(FAMILY)).toMatchObject({
        written: false,
        assessment: {
          outcome: 'blocked',
          blockers: { deadLetterIds: [deadLetterId], unrecoveredFailures: 0 },
        },
      })
      expect((await store.read(FAMILY))?.observation.lastRepairAt).toBeNull()

      // Discarding it does not clear the latch; the acknowledgement does.
      await (await quarantine.getJob(deadLetterId))?.remove()
      expect(await readRow()).toMatchObject({ reasons: ['repair_required'] })
      expect(await acknowledger.acknowledge(FAMILY)).toMatchObject({
        written: true,
        after: { outcome: 'nothing_to_acknowledge', family: { ready: true } },
      })
      expect(await readRow()).toMatchObject({ ready: true, reasons: [] })

      // The failure stays on record, and a new one is not hidden by it.
      failing = true
      await queue.add(FAMILY, {}, ONE_ATTEMPT)
      await vi.waitFor(async () => {
        expect(await readRow()).toMatchObject({
          ready: false,
          reasons: ['repair_required', 'dead_letter_present'],
        })
      }, WAIT)
      expect((await acknowledger.assess(FAMILY)).outcome).toBe('blocked')
    } finally {
      await worker.close()
    }
  })
})
