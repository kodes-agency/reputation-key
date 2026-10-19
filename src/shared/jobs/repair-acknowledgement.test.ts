import { describe, expect, it } from 'vitest'
import {
  createFakeJobRuntimeRedis,
  fakeRuntimeQueue,
} from '#/shared/testing/fake-job-runtime'
import { createJobRepairAcknowledger } from './repair-acknowledgement'
import type { JobOperationalContract } from './runtime-authority'
import { createJobRuntimeObservationStore } from './runtime-observations'

// The closed beta's case: an on-demand family latched by failures whose dead
// letters can never be redriven to success, though every later run completed.
const FAMILY = 'sync-property-reviews'
const OTHER = 'import-property-v2'
const KEY = `repkey:job-runtime:v1:${FAMILY}`
const NOW = new Date('2026-10-19T12:00:00.000Z')
const BOOTED = new Date('2026-10-19T07:00:00.000Z')
const FAILED = new Date('2026-10-19T08:00:00.000Z')
const LATER_FAILURE = new Date('2026-10-19T10:00:00.000Z')
const SUCCEEDED = new Date('2026-10-19T09:00:00.000Z')

function contract(
  overrides: Partial<JobOperationalContract> = {},
): JobOperationalContract {
  return {
    jobName: FAMILY,
    owner: 'review',
    processor: 'src/contexts/review/infrastructure/jobs/sync-property-reviews.job.ts',
    action: 'system:review.sync',
    capability: 'property.connect_gbp',
    queue: 'default',
    retryAttempts: 3,
    retryBackoff: 'exponential:30000',
    timeoutMs: 300_000,
    workerConcurrency: 3,
    retention: 'completed:100,failed:50',
    routing: 'cell_local',
    posture: 'active',
    schedule: 'none',
    lastSuccessObjectiveMs: null,
    maximumQueueAgeMs: 900_000,
    repairCommand: 'pnpm ops quarantine redrive <quarantineJobId>',
    runbook: 'docs/operations/runbooks.md',
    ...overrides,
  }
}

const OTHER_CONTRACT = contract({ jobName: OTHER })

type World = Readonly<{
  completed?: ReadonlyArray<Record<string, unknown>>
  failed?: ReadonlyArray<Record<string, unknown>>
  /** Quarantine entries as [job name, dead-letter id]. */
  deadLetters?: ReadonlyArray<readonly [string, string]>
  contracts?: readonly JobOperationalContract[]
  /** Scheduler names the default queue registers. */
  schedulers?: readonly string[]
}>

const completedAt = (name: string, at: Date) => ({
  name,
  processedOn: at.getTime() - 1_000,
  finishedOn: at.getTime(),
})
const failedAt = (name: string, at: Date) => ({
  name,
  id: `${name}-failed-${at.getTime()}`,
  processedOn: at.getTime() - 1_000,
  finishedOn: at.getTime(),
})

async function setup(world: World = {}) {
  const redis = createFakeJobRuntimeRedis()
  const store = createJobRuntimeObservationStore({ redis })
  const contracts = world.contracts ?? [contract(), OTHER_CONTRACT]
  await store.recordBoot({
    contracts,
    registeredHandlers: new Set(contracts.map((c) => c.jobName)),
    registeredSchedulers: new Set(),
    runtimeStartedAt: BOOTED,
  })
  const acknowledger = createJobRepairAcknowledger({
    contracts,
    store,
    queues: {
      default: fakeRuntimeQueue({
        schedulers: (world.schedulers ?? []).map((name) => ({
          key: `${name}-recurring`,
          name,
        })),
        jobs: {
          completed: [...(world.completed ?? [])],
          failed: [...(world.failed ?? [])],
        },
      }),
      background: fakeRuntimeQueue(),
    },
    quarantine: fakeRuntimeQueue({
      jobs: {
        waiting: (world.deadLetters ?? []).map(([name, id]) => ({
          name,
          id,
          timestamp: FAILED.getTime(),
        })),
      },
    }),
    clock: () => NOW,
  })
  const failOnDemand = (at: Date, jobName = FAMILY) =>
    store.recordTerminalFailure({
      queue: 'default',
      jobName,
      jobId: `job-${at.getTime()}`,
      at,
      executionKind: 'worker',
    })
  return { redis, store, acknowledger, failOnDemand }
}

describe('acknowledging a failed family once its cause is fixed', () => {
  it('refuses a job name the catalogue does not govern, and writes nothing', async () => {
    const { redis, acknowledger } = await setup()
    const before = structuredClone([...redis.hashes])

    const result = await acknowledger.acknowledge('sync-property-review')

    expect(result).toEqual({
      written: false,
      assessment: { outcome: 'unknown_job', knownJobs: [OTHER, FAMILY] },
    })
    expect([...redis.hashes]).toEqual(before)
  })

  it('refuses a family whose worker never wrote a runtime head, and creates none', async () => {
    const redis = createFakeJobRuntimeRedis()
    const acknowledger = createJobRepairAcknowledger({
      contracts: [contract()],
      store: createJobRuntimeObservationStore({ redis }),
      queues: { default: fakeRuntimeQueue(), background: fakeRuntimeQueue() },
      quarantine: fakeRuntimeQueue(),
      clock: () => NOW,
    })

    expect(await acknowledger.acknowledge(FAMILY)).toEqual({
      written: false,
      assessment: { outcome: 'no_runtime_head' },
    })
    expect(redis.hashes.size).toBe(0)
  })

  describe('a failed on-demand run that a later run followed with a success', () => {
    const world = { completed: [completedAt(FAMILY, SUCCEEDED)] }

    it('reports what it would change and why the family is unready, without writing', async () => {
      const { redis, acknowledger, failOnDemand } = await setup(world)
      await failOnDemand(FAILED)
      const before = await redis.hgetall(KEY)

      const assessment = await acknowledger.assess(FAMILY)

      expect(assessment).toEqual({
        outcome: 'acknowledgeable',
        setsLastRepairAt: FAILED.toISOString(),
        family: {
          jobName: FAMILY,
          posture: 'active',
          schedule: 'none',
          ready: false,
          reasons: ['repair_required'],
          lastSucceededAt: SUCCEEDED.toISOString(),
          lastOnDemandFailureAt: FAILED.toISOString(),
          lastScheduleFailureAt: null,
          lastRepairAt: null,
        },
      })
      expect(await redis.hgetall(KEY)).toEqual(before)
    })

    it('sets lastRepairAt to the failure it acknowledges, touches no other field, and makes the family ready', async () => {
      const { redis, store, acknowledger, failOnDemand } = await setup(world)
      await failOnDemand(FAILED)
      const before = await redis.hgetall(KEY)

      const result = await acknowledger.acknowledge(FAMILY)

      expect(await redis.hgetall(KEY)).toEqual({
        ...before,
        lastRepairAt: FAILED.toISOString(),
      })
      expect(result).toMatchObject({
        written: true,
        before: { lastRepairAt: null },
        after: {
          outcome: 'nothing_to_acknowledge',
          family: {
            ready: true,
            reasons: [],
            lastRepairAt: FAILED.toISOString(),
            // The failure stays on record.
            lastOnDemandFailureAt: FAILED.toISOString(),
          },
        },
      })
      expect((await store.read(FAMILY))?.observation.lastRepairAt).toEqual(FAILED)
    })

    it('acknowledges a failure recorded before failures were split by execution kind', async () => {
      const { redis, acknowledger } = await setup(world)
      await redis.hset(KEY, 'lastTerminalFailureAt', FAILED.toISOString())

      expect(await acknowledger.assess(FAMILY)).toMatchObject({
        outcome: 'acknowledgeable',
        setsLastRepairAt: FAILED.toISOString(),
      })
      expect(await acknowledger.acknowledge(FAMILY)).toMatchObject({
        written: true,
        after: { family: { ready: true } },
      })
    })

    // The failure it acknowledges is the newest it saw, not the clock's now: a
    // failure that lands after the read is later than lastRepairAt, so the
    // acknowledgement cannot hide it.
    it('leaves a failure that lands afterwards latched', async () => {
      const { acknowledger, failOnDemand } = await setup(world)
      await failOnDemand(FAILED)
      await acknowledger.acknowledge(FAMILY)

      await failOnDemand(new Date(FAILED.getTime() + 1))

      expect(await acknowledger.assess(FAMILY)).toMatchObject({
        outcome: 'acknowledgeable',
        setsLastRepairAt: new Date(FAILED.getTime() + 1).toISOString(),
        family: { ready: false, reasons: ['repair_required'] },
      })
    })

    it('is idempotent: a second acknowledgement has nothing left to write', async () => {
      const { acknowledger, failOnDemand } = await setup(world)
      await failOnDemand(FAILED)
      await acknowledger.acknowledge(FAMILY)

      expect(await acknowledger.acknowledge(FAMILY)).toMatchObject({
        written: false,
        assessment: { outcome: 'nothing_to_acknowledge' },
      })
    })

    it('ignores a failure of another family', async () => {
      const { acknowledger, failOnDemand } = await setup(world)
      await failOnDemand(FAILED)
      await failOnDemand(LATER_FAILURE, OTHER)

      expect(await acknowledger.assess(FAMILY)).toMatchObject({
        outcome: 'acknowledgeable',
        setsLastRepairAt: FAILED.toISOString(),
      })
    })
  })

  describe('while the family still has a dead letter', () => {
    it('refuses, names every dead letter of the family, and writes nothing', async () => {
      const { redis, acknowledger, failOnDemand } = await setup({
        completed: [completedAt(FAMILY, SUCCEEDED)],
        deadLetters: [
          [FAMILY, 'quarantine:default:1'],
          [OTHER, 'quarantine:default:2'],
          [FAMILY, 'quarantine:default:3'],
        ],
      })
      await failOnDemand(FAILED)
      const before = await redis.hgetall(KEY)

      const result = await acknowledger.acknowledge(FAMILY)

      expect(result).toMatchObject({
        written: false,
        assessment: {
          outcome: 'blocked',
          blockers: {
            deadLetterIds: ['quarantine:default:1', 'quarantine:default:3'],
            unrecoveredFailures: 0,
          },
          family: { ready: false, reasons: ['repair_required', 'dead_letter_present'] },
        },
      })
      expect(await redis.hgetall(KEY)).toEqual(before)
    })
  })

  describe('while a retained failed job is newer than the latest success', () => {
    it('refuses and counts them', async () => {
      const { redis, acknowledger, failOnDemand } = await setup({
        completed: [completedAt(FAMILY, SUCCEEDED)],
        failed: [
          failedAt(FAMILY, FAILED),
          failedAt(FAMILY, LATER_FAILURE),
          failedAt(OTHER, LATER_FAILURE),
        ],
      })
      await failOnDemand(LATER_FAILURE)
      const before = await redis.hgetall(KEY)

      const result = await acknowledger.acknowledge(FAMILY)

      expect(result).toMatchObject({
        written: false,
        assessment: {
          outcome: 'blocked',
          blockers: { deadLetterIds: [], unrecoveredFailures: 1 },
        },
      })
      expect(await redis.hgetall(KEY)).toEqual(before)
    })

    it('refuses when the family has never succeeded', async () => {
      const { acknowledger, failOnDemand } = await setup({
        failed: [failedAt(FAMILY, FAILED)],
      })
      await failOnDemand(FAILED)

      expect(await acknowledger.assess(FAMILY)).toMatchObject({
        outcome: 'blocked',
        blockers: { unrecoveredFailures: 1 },
      })
    })

    it('reports a dead letter and a newer failed job together', async () => {
      const { acknowledger, failOnDemand } = await setup({
        completed: [completedAt(FAMILY, SUCCEEDED)],
        failed: [failedAt(FAMILY, LATER_FAILURE)],
        deadLetters: [[FAMILY, 'quarantine:default:1']],
      })
      await failOnDemand(LATER_FAILURE)

      expect(await acknowledger.assess(FAMILY)).toMatchObject({
        outcome: 'blocked',
        blockers: { deadLetterIds: ['quarantine:default:1'], unrecoveredFailures: 1 },
      })
    })

    // BullMQ keeps a bounded failed set, so the head can hold a failure no
    // retained job shows any more. Nothing shows its cause fixed, and stamping
    // its time would also answer a stall recorded before it.
    it('refuses a head failure newer than the latest success that BullMQ no longer retains', async () => {
      const { redis, store, acknowledger, failOnDemand } = await setup({
        completed: [completedAt(FAMILY, SUCCEEDED)],
      })
      await store.recordStarted({
        queue: 'default',
        jobName: FAMILY,
        jobId: 'stuck-1',
        at: new Date('2026-10-19T09:20:00.000Z'),
      })
      await store.recordStalled({
        queue: 'default',
        jobId: 'stuck-1',
        at: new Date('2026-10-19T09:30:00.000Z'),
      })
      await failOnDemand(LATER_FAILURE)
      const before = await redis.hgetall(KEY)

      const result = await acknowledger.acknowledge(FAMILY)

      expect(result).toMatchObject({
        written: false,
        assessment: {
          outcome: 'blocked',
          blockers: {
            deadLetterIds: [],
            unrecoveredFailures: 0,
            failureNewerThanLatestSuccess: true,
          },
          family: {
            reasons: ['repair_required', 'stalled_work_observed'],
            lastOnDemandFailureAt: LATER_FAILURE.toISOString(),
            lastSucceededAt: SUCCEEDED.toISOString(),
          },
        },
      })
      expect(await redis.hgetall(KEY)).toEqual(before)
    })

    it('does not flag a failure that a later success followed', async () => {
      const { acknowledger, failOnDemand } = await setup({
        completed: [completedAt(FAMILY, SUCCEEDED)],
      })
      await failOnDemand(FAILED)

      expect(await acknowledger.assess(FAMILY)).toMatchObject({
        outcome: 'acknowledgeable',
      })
    })

    it('does not count a failed job that a later success followed', async () => {
      const { acknowledger, failOnDemand } = await setup({
        completed: [completedAt(FAMILY, SUCCEEDED)],
        failed: [failedAt(FAMILY, FAILED)],
      })
      await failOnDemand(FAILED)

      expect((await acknowledger.assess(FAMILY)).outcome).toBe('acknowledgeable')
    })
  })

  describe('when the on-demand latch is not what holds the family', () => {
    it('has nothing to acknowledge for a family that never failed', async () => {
      const { redis, acknowledger } = await setup()
      const before = await redis.hgetall(KEY)

      expect(await acknowledger.acknowledge(FAMILY)).toMatchObject({
        written: false,
        assessment: { outcome: 'nothing_to_acknowledge', family: { ready: true } },
      })
      expect(await redis.hgetall(KEY)).toEqual(before)
    })

    it('has nothing to acknowledge once a governed redrive has succeeded', async () => {
      const { store, acknowledger, failOnDemand } = await setup()
      await failOnDemand(FAILED)
      await store.recordSucceeded({
        queue: 'default',
        jobName: FAMILY,
        jobId: 'redrive-1',
        at: SUCCEEDED,
        repair: true,
      })

      expect((await acknowledger.assess(FAMILY)).outcome).toBe('nothing_to_acknowledge')
    })

    it('has nothing to acknowledge for a dark family, whose readiness never reads the latch', async () => {
      const { acknowledger, failOnDemand } = await setup({
        contracts: [contract({ posture: 'dark' })],
      })
      await failOnDemand(FAILED)

      expect(await acknowledger.assess(FAMILY)).toMatchObject({
        outcome: 'nothing_to_acknowledge',
        family: { posture: 'dark' },
      })
    })

    // A failed firing is answered by a later success, never by an operator:
    // acknowledging must not hide a schedule that is still failing.
    describe('on an active schedule whose latest run is a failed firing', () => {
      const scheduled = contract({
        schedule: 'every:3600000',
        lastSuccessObjectiveMs: 7_500_000,
      })
      const succeeded = new Date('2026-10-19T11:30:00.000Z')
      const firingFailed = new Date('2026-10-19T11:45:00.000Z')
      const failFiring = (store: ReturnType<typeof createJobRuntimeObservationStore>) =>
        store.recordTerminalFailure({
          queue: 'default',
          jobName: FAMILY,
          jobId: 'repeat:firing:1',
          at: firingFailed,
          executionKind: 'schedule',
        })
      const world = {
        contracts: [scheduled],
        schedulers: [FAMILY],
        completed: [completedAt(FAMILY, succeeded)],
      }

      it('leaves the failed firing to the next success', async () => {
        const { redis, store, acknowledger } = await setup(world)
        await failFiring(store)
        const before = await redis.hgetall(KEY)

        const result = await acknowledger.acknowledge(FAMILY)

        expect(result).toMatchObject({
          written: false,
          assessment: {
            outcome: 'nothing_to_acknowledge',
            family: {
              ready: false,
              reasons: ['repair_required'],
              lastScheduleFailureAt: firingFailed.toISOString(),
              lastOnDemandFailureAt: null,
            },
          },
        })
        expect(await redis.hgetall(KEY)).toEqual(before)
      })

      it('has nothing to acknowledge when only the firing holds, though a manual run failed earlier and was answered', async () => {
        const { store, acknowledger, failOnDemand } = await setup(world)
        await failOnDemand(FAILED)
        await store.recordSucceeded({
          queue: 'default',
          jobName: FAMILY,
          jobId: 'redrive-1',
          at: new Date('2026-10-19T09:00:00.000Z'),
          repair: true,
        })
        await failFiring(store)

        expect(await acknowledger.acknowledge(FAMILY)).toMatchObject({
          written: false,
          assessment: {
            outcome: 'nothing_to_acknowledge',
            family: { ready: false, reasons: ['repair_required'] },
          },
        })
      })

      it('acknowledges a failed manual run without answering the firing', async () => {
        const { store, acknowledger, failOnDemand } = await setup(world)
        await failOnDemand(FAILED)
        await failFiring(store)

        const result = await acknowledger.acknowledge(FAMILY)

        expect(result).toMatchObject({
          written: true,
          after: {
            outcome: 'nothing_to_acknowledge',
            family: {
              ready: false,
              reasons: ['repair_required'],
              lastRepairAt: FAILED.toISOString(),
            },
          },
        })
      })
    })
  })
})
