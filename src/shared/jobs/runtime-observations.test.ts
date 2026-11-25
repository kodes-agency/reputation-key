import { describe, expect, it } from 'vitest'
import {
  bootJobRuntime,
  fakeRuntimeQueue as queue,
} from '#/shared/testing/fake-job-runtime'
import {
  BOOT_DEFAULTS,
  contract,
  HEALTH_CHECK_SCHEDULERS as scheduled,
  NOW,
  retainedJob,
} from './runtime-observations.test-fixtures'

describe('durable job runtime observations', () => {
  it('preserves the latest success across a worker restart', async () => {
    const { store, contracts } = await bootJobRuntime({
      ...BOOT_DEFAULTS,
      startedAt: new Date('2026-08-27T05:00:00.000Z'),
    })
    await store.recordStarted({
      queue: 'background',
      jobName: 'health-check',
      jobId: 'run-1',
      at: new Date('2026-08-27T05:04:00.000Z'),
    })
    await store.recordSucceeded({
      queue: 'background',
      jobName: 'health-check',
      jobId: 'run-1',
      at: new Date('2026-08-27T05:04:01.000Z'),
      repair: false,
    })

    await store.recordBoot({
      contracts,
      registeredHandlers: new Set(['health-check']),
      registeredSchedulers: new Set(['health-check']),
      runtimeStartedAt: new Date('2026-08-27T05:59:00.000Z'),
    })

    const stored = await store.read('health-check')
    expect(stored?.runtimeStartedAt.toISOString()).toBe('2026-08-27T05:59:00.000Z')
    expect(stored?.observation.lastSucceededAt?.toISOString()).toBe(
      '2026-08-27T05:04:01.000Z',
    )
  })

  it('uses the live scheduler set instead of trusting a stale boot flag', async () => {
    const { read } = await bootJobRuntime(BOOT_DEFAULTS)

    const report = await read()

    expect(report.ready).toBe(false)
    expect(report.rows[0]).toMatchObject({
      processor: 'src/shared/jobs/health-check.job.ts',
      action: 'system:health.check',
      routing: 'cell_local',
      schedule: 'every:300000',
      retryAttempts: 3,
      retryBackoff: 'exponential:30000',
      timeoutMs: 30_000,
      workerConcurrency: 3,
      retention: 'completed:100,failed:50',
      maximumQueueAgeMs: 300_000,
      lastSuccessObjectiveMs: 600_000,
      reasons: ['scheduler_missing'],
    })
  })

  it('detects missed success and over-age queued work from retained BullMQ state', async () => {
    const { read } = await bootJobRuntime({
      ...BOOT_DEFAULTS,
      startedAt: new Date('2026-08-27T04:00:00.000Z'),
    })

    const report = await read({
      background: queue({
        schedulers: scheduled,
        jobs: {
          completed: [retainedJob('health-check', '2026-08-27T05:30:02.000Z')],
          waiting: [
            {
              name: 'health-check',
              timestamp: Date.parse('2026-08-27T05:40:00.000Z'),
            },
          ],
        },
      }),
    })

    expect(report.rows[0]?.reasons).toEqual([
      'last_success_objective_missed',
      'queue_age_objective_missed',
    ])
  })

  it('keeps poison work assigned to repair until a later successful redrive', async () => {
    const { store, read } = await bootJobRuntime(BOOT_DEFAULTS)
    await store.recordTerminalFailure({
      queue: 'background',
      jobName: 'health-check',
      jobId: 'poison-1',
      at: new Date('2026-08-27T05:59:30.000Z'),
      executionKind: 'worker',
    })

    const healthyScheduler = queue({ schedulers: scheduled })
    const poisonReport = await read({
      background: healthyScheduler,
      quarantine: queue({
        jobs: { waiting: [{ name: 'health-check', timestamp: NOW.getTime() }] },
      }),
    })
    expect(poisonReport.rows[0]).toMatchObject({
      ready: false,
      reasons: ['repair_required', 'dead_letter_present'],
      repairCommand: expect.stringContaining('pnpm ops quarantine redrive'),
    })

    await store.recordSucceeded({
      queue: 'background',
      jobName: 'health-check',
      jobId: 'redrive-1',
      at: new Date('2026-08-27T05:59:50.000Z'),
      repair: true,
    })
    const repaired = await read({ background: healthyScheduler })
    expect(repaired.rows[0]).toMatchObject({ ready: true, reasons: [] })
  })

  it('records an acknowledged repair in lastRepairAt and in no other field of the head', async () => {
    const { redis, store } = await bootJobRuntime(BOOT_DEFAULTS)
    await store.recordTerminalFailure({
      queue: 'background',
      jobName: 'health-check',
      jobId: 'poison-1',
      at: new Date('2026-08-27T05:59:30.000Z'),
      executionKind: 'worker',
    })
    const key = 'repkey:job-runtime:v1:health-check'
    const before = await redis.hgetall(key)

    await store.recordRepairAcknowledged({
      jobName: 'health-check',
      at: new Date('2026-08-27T05:59:30.000Z'),
    })

    expect(await redis.hgetall(key)).toEqual({
      ...before,
      lastRepairAt: '2026-08-27T05:59:30.000Z',
    })
    const stored = await store.read('health-check')
    expect(stored?.observation.lastRepairAt?.toISOString()).toBe(
      '2026-08-27T05:59:30.000Z',
    )
  })

  it('lets a later firing clear a failed schedule, but not failed on-demand work', async () => {
    // The closed beta's case, as the worker now records it: a firing that
    // failed terminally days ago, no dead letter to redrive, and the same
    // schedule completing every minute.
    const { store, read } = await bootJobRuntime({
      ...BOOT_DEFAULTS,
      contracts: [
        contract(),
        contract({
          jobName: 'sync-property-reviews',
          queue: 'default',
          schedule: 'none',
          lastSuccessObjectiveMs: null,
        }),
      ],
      handlers: new Set(['health-check', 'sync-property-reviews']),
      schedulers: new Set(['health-check']),
      startedAt: new Date('2026-08-27T05:50:00.000Z'),
    })
    for (const jobName of ['health-check', 'sync-property-reviews']) {
      await store.recordTerminalFailure({
        queue: 'background',
        jobName,
        jobId: `${jobName}-failed`,
        at: new Date('2026-08-20T05:03:00.000Z'),
        executionKind: jobName === 'health-check' ? 'schedule' : 'worker',
      })
      await store.recordSucceeded({
        queue: 'background',
        jobName,
        jobId: `${jobName}-later`,
        at: new Date('2026-08-27T05:59:00.000Z'),
        repair: false,
      })
    }

    const report = await read({ background: queue({ schedulers: scheduled }) })

    expect(report.rows).toMatchObject([
      { jobName: 'health-check', ready: true, reasons: [] },
      { jobName: 'sync-property-reviews', ready: false, reasons: ['repair_required'] },
    ])
    expect(report).toMatchObject({ failing: 1, repairRequired: 1, deadLetters: 0 })
  })

  it('allows a quarantined safety handler but rejects its scheduler', async () => {
    const { read } = await bootJobRuntime({
      ...BOOT_DEFAULTS,
      contracts: [contract({ posture: 'quarantined' })],
      schedulers: new Set(),
      startedAt: NOW,
    })

    const report = await read()
    expect(report.rows[0]).toMatchObject({ ready: true, reasons: [] })
  })
})
