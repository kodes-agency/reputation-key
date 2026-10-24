import { describe, expect, it } from 'vitest'
import type { JobOperationalContract } from './runtime-authority'
import {
  createFakeJobRuntimeRedis,
  fakeRuntimeQueue as queue,
} from '#/shared/testing/fake-job-runtime'
import {
  createJobRuntimeObservationStore,
  createJobRuntimeReportReader,
} from './runtime-observations'

const NOW = new Date('2026-08-27T06:00:00.000Z')

function contract(
  overrides: Partial<JobOperationalContract> = {},
): JobOperationalContract {
  return {
    jobName: 'health-check',
    owner: 'platform',
    processor: 'src/shared/jobs/health-check.job.ts',
    action: 'system:health.check',
    capability: 'none',
    queue: 'background',
    retryAttempts: 3,
    retryBackoff: 'exponential:30000',
    timeoutMs: 30_000,
    workerConcurrency: 3,
    retention: 'completed:100,failed:50',
    routing: 'cell_local',
    posture: 'active',
    schedule: 'every:300000',
    lastSuccessObjectiveMs: 600_000,
    maximumQueueAgeMs: 300_000,
    repairCommand:
      'pnpm ops quarantine redrive <quarantineJobId> --operator <registered-operator> --reason <incident-reason> --apply',
    runbook: 'docs/operations/runbooks.md',
    ...overrides,
  }
}

describe('durable job runtime observations', () => {
  it('preserves the latest success across a worker restart', async () => {
    const redis = createFakeJobRuntimeRedis()
    const store = createJobRuntimeObservationStore({ redis })
    const contracts = [contract()]

    await store.recordBoot({
      contracts,
      registeredHandlers: new Set(['health-check']),
      registeredSchedulers: new Set(['health-check']),
      runtimeStartedAt: new Date('2026-08-27T05:00:00.000Z'),
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
    const redis = createFakeJobRuntimeRedis()
    const store = createJobRuntimeObservationStore({ redis })
    const contracts = [contract()]
    await store.recordBoot({
      contracts,
      registeredHandlers: new Set(['health-check']),
      registeredSchedulers: new Set(['health-check']),
      runtimeStartedAt: new Date('2026-08-27T05:59:00.000Z'),
    })

    const report = await createJobRuntimeReportReader({
      contracts,
      store,
      queues: { background: queue(), default: null },
      quarantine: null,
      clock: () => NOW,
    }).read()

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
    const redis = createFakeJobRuntimeRedis()
    const store = createJobRuntimeObservationStore({ redis })
    const contracts = [contract()]
    await store.recordBoot({
      contracts,
      registeredHandlers: new Set(['health-check']),
      registeredSchedulers: new Set(['health-check']),
      runtimeStartedAt: new Date('2026-08-27T04:00:00.000Z'),
    })

    const report = await createJobRuntimeReportReader({
      contracts,
      store,
      queues: {
        default: null,
        background: queue({
          schedulers: [{ key: 'health-check-recurring', name: 'health-check' }],
          jobs: {
            completed: [
              {
                name: 'health-check',
                timestamp: Date.parse('2026-08-27T05:30:00.000Z'),
                processedOn: Date.parse('2026-08-27T05:30:01.000Z'),
                finishedOn: Date.parse('2026-08-27T05:30:02.000Z'),
              },
            ],
            waiting: [
              {
                name: 'health-check',
                timestamp: Date.parse('2026-08-27T05:40:00.000Z'),
              },
            ],
          },
        }),
      },
      quarantine: null,
      clock: () => NOW,
    }).read()

    expect(report.rows[0]?.reasons).toEqual([
      'last_success_objective_missed',
      'queue_age_objective_missed',
    ])
  })

  it('does not count a future delayed execution as queue backlog', async () => {
    const redis = createFakeJobRuntimeRedis()
    const store = createJobRuntimeObservationStore({ redis })
    const contracts = [contract()]
    await store.recordBoot({
      contracts,
      registeredHandlers: new Set(['health-check']),
      registeredSchedulers: new Set(['health-check']),
      runtimeStartedAt: new Date('2026-08-27T05:59:00.000Z'),
    })

    const report = await createJobRuntimeReportReader({
      contracts,
      store,
      queues: {
        default: null,
        background: queue({
          schedulers: [{ key: 'health-check-recurring', name: 'health-check' }],
          jobs: {
            delayed: [
              {
                name: 'health-check',
                timestamp: Date.parse('2026-08-27T05:00:00.000Z'),
                delay: 2 * 60 * 60_000,
              },
            ],
          },
        }),
      },
      quarantine: null,
      clock: () => NOW,
    }).read()

    expect(report.rows[0]).toMatchObject({ ready: true, oldestWaitingAt: null })
  })

  it('keeps poison work assigned to repair until a later successful redrive', async () => {
    const redis = createFakeJobRuntimeRedis()
    const store = createJobRuntimeObservationStore({ redis })
    const contracts = [contract()]
    const startedAt = new Date('2026-08-27T05:59:00.000Z')
    await store.recordBoot({
      contracts,
      registeredHandlers: new Set(['health-check']),
      registeredSchedulers: new Set(['health-check']),
      runtimeStartedAt: startedAt,
    })
    await store.recordTerminalFailure({
      queue: 'background',
      jobName: 'health-check',
      jobId: 'poison-1',
      at: new Date('2026-08-27T05:59:30.000Z'),
      executionKind: 'worker',
    })

    const healthyScheduler = queue({
      schedulers: [{ key: 'health-check-recurring', name: 'health-check' }],
    })
    const poisonReport = await createJobRuntimeReportReader({
      contracts,
      store,
      queues: { background: healthyScheduler, default: null },
      quarantine: queue({
        jobs: { waiting: [{ name: 'health-check', timestamp: NOW.getTime() }] },
      }),
      clock: () => NOW,
    }).read()
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
    const repaired = await createJobRuntimeReportReader({
      contracts,
      store,
      queues: { background: healthyScheduler, default: null },
      quarantine: null,
      clock: () => NOW,
    }).read()
    expect(repaired.rows[0]).toMatchObject({ ready: true, reasons: [] })
  })

  it('records an acknowledged repair in lastRepairAt and in no other field of the head', async () => {
    const redis = createFakeJobRuntimeRedis()
    const store = createJobRuntimeObservationStore({ redis })
    await store.recordBoot({
      contracts: [contract()],
      registeredHandlers: new Set(['health-check']),
      registeredSchedulers: new Set(['health-check']),
      runtimeStartedAt: new Date('2026-08-27T05:59:00.000Z'),
    })
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
    const redis = createFakeJobRuntimeRedis()
    const store = createJobRuntimeObservationStore({ redis })
    const contracts = [
      contract(),
      contract({
        jobName: 'sync-property-reviews',
        queue: 'default',
        schedule: 'none',
        lastSuccessObjectiveMs: null,
      }),
    ]
    await store.recordBoot({
      contracts,
      registeredHandlers: new Set(['health-check', 'sync-property-reviews']),
      registeredSchedulers: new Set(['health-check']),
      runtimeStartedAt: new Date('2026-08-27T05:50:00.000Z'),
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

    const report = await createJobRuntimeReportReader({
      contracts,
      store,
      queues: {
        background: queue({
          schedulers: [{ key: 'health-check-recurring', name: 'health-check' }],
        }),
        default: null,
      },
      quarantine: null,
      clock: () => NOW,
    }).read()

    expect(report.rows).toMatchObject([
      { jobName: 'health-check', ready: true, reasons: [] },
      { jobName: 'sync-property-reviews', ready: false, reasons: ['repair_required'] },
    ])
    expect(report).toMatchObject({ failing: 1, repairRequired: 1, deadLetters: 0 })
  })

  describe('terminal gate denials', () => {
    const scheduled = [{ key: 'health-check-recurring', name: 'health-check' }]
    const deniedFiring = {
      gate: 'denied',
      reason: 'missing_scope',
      executionKind: 'schedule',
    } as const

    async function booted(contracts = [contract()]) {
      const redis = createFakeJobRuntimeRedis()
      const store = createJobRuntimeObservationStore({ redis })
      await store.recordBoot({
        contracts,
        registeredHandlers: new Set(contracts.map((c) => c.jobName)),
        registeredSchedulers: new Set(contracts.map((c) => c.jobName)),
        runtimeStartedAt: new Date('2026-08-27T05:00:00.000Z'),
      })
      return { store, contracts }
    }

    it('records a denied schedule firing as a denial that fails the family until a later success', async () => {
      const { store, contracts } = await booted()
      const succeededAt = new Date('2026-08-27T05:50:00.000Z')
      await store.recordSucceeded({
        queue: 'background',
        jobName: 'health-check',
        jobId: 'run-1',
        at: succeededAt,
        repair: false,
      })
      await store.recordDenied({
        queue: 'background',
        jobName: 'health-check',
        jobId: 'run-2',
        at: new Date('2026-08-27T05:55:00.000Z'),
        executionKind: 'schedule',
      })
      const read = () =>
        createJobRuntimeReportReader({
          contracts,
          store,
          queues: { background: queue({ schedulers: scheduled }), default: null },
          quarantine: null,
          clock: () => NOW,
        }).read()

      const denied = await read()
      expect(denied).toMatchObject({ ready: false, failing: 1, scheduleDenied: 1 })
      expect(denied.rows[0]).toMatchObject({
        ready: false,
        reasons: ['schedule_denied'],
        lastSucceededAt: succeededAt.toISOString(),
        lastDeniedAt: '2026-08-27T05:55:00.000Z',
      })

      await store.recordSucceeded({
        queue: 'background',
        jobName: 'health-check',
        jobId: 'run-3',
        at: new Date('2026-08-27T05:58:00.000Z'),
        repair: false,
      })
      expect(await read()).toMatchObject({ ready: true, scheduleDenied: 0 })
    })

    it('does not take freshness from denied firings in the retained completed set', async () => {
      const { store, contracts } = await booted()

      const report = await createJobRuntimeReportReader({
        contracts,
        store,
        queues: {
          default: null,
          background: queue({
            schedulers: scheduled,
            jobs: {
              completed: [
                {
                  name: 'health-check',
                  timestamp: Date.parse('2026-08-27T05:50:00.000Z'),
                  processedOn: Date.parse('2026-08-27T05:50:01.000Z'),
                  finishedOn: Date.parse('2026-08-27T05:50:02.000Z'),
                  returnvalue: deniedFiring,
                },
                {
                  name: 'health-check',
                  timestamp: Date.parse('2026-08-27T05:55:00.000Z'),
                  processedOn: Date.parse('2026-08-27T05:55:01.000Z'),
                  finishedOn: Date.parse('2026-08-27T05:55:02.000Z'),
                  returnvalue: deniedFiring,
                },
              ],
            },
          }),
        },
        quarantine: null,
        clock: () => NOW,
      }).read()

      expect(report).toMatchObject({ ready: false, scheduleDenied: 1, gateDenials: 2 })
      expect(report.rows[0]).toMatchObject({
        reasons: ['schedule_denied', 'success_never_observed'],
        lastSucceededAt: null,
        lastDeniedAt: '2026-08-27T05:55:02.000Z',
        deniedCount: 2,
      })
    })

    it('counts a denial of on-demand work without failing the family', async () => {
      const { store, contracts } = await booted([
        contract({
          jobName: 'insert-notification',
          queue: 'default',
          schedule: 'none',
          lastSuccessObjectiveMs: null,
        }),
      ])

      const report = await createJobRuntimeReportReader({
        contracts,
        store,
        queues: {
          background: null,
          default: queue({
            jobs: {
              completed: [
                {
                  name: 'insert-notification',
                  timestamp: Date.parse('2026-08-27T05:55:00.000Z'),
                  processedOn: Date.parse('2026-08-27T05:55:01.000Z'),
                  finishedOn: Date.parse('2026-08-27T05:55:02.000Z'),
                  returnvalue: { ...deniedFiring, executionKind: 'worker' },
                },
              ],
            },
          }),
        },
        quarantine: null,
        clock: () => NOW,
      }).read()

      expect(report).toMatchObject({ ready: true, scheduleDenied: 0, gateDenials: 1 })
      expect(report.rows[0]).toMatchObject({
        ready: true,
        reasons: [],
        lastSucceededAt: null,
        lastDeniedAt: '2026-08-27T05:55:02.000Z',
        deniedCount: 1,
      })
    })
  })

  describe('terminal failure evidence', () => {
    const scheduled = [{ key: 'health-check-recurring', name: 'health-check' }]
    type RetainedJobs = Partial<
      Record<'completed' | 'failed', Array<Record<string, unknown>>>
    >

    async function booted(contracts = [contract()]) {
      const redis = createFakeJobRuntimeRedis()
      const store = createJobRuntimeObservationStore({ redis })
      await store.recordBoot({
        contracts,
        registeredHandlers: new Set(contracts.map((c) => c.jobName)),
        registeredSchedulers: new Set(contracts.map((c) => c.jobName)),
        runtimeStartedAt: new Date('2026-08-27T05:00:00.000Z'),
      })
      const read = (jobs: RetainedJobs = {}, schedulers = scheduled) =>
        createJobRuntimeReportReader({
          contracts,
          store,
          queues: { background: queue({ schedulers, jobs }), default: null },
          quarantine: null,
          clock: () => NOW,
        }).read()
      return { redis, store, read }
    }

    /** A retained `health-check` job; a scheduler firing carries its scheduler key. */
    function retained(at: string, kind: 'firing' | 'on-demand') {
      const finishedOn = Date.parse(at)
      return {
        name: 'health-check',
        timestamp: finishedOn - 2_000,
        processedOn: finishedOn - 1_000,
        finishedOn,
        ...(kind === 'firing' ? { repeatJobKey: 'health-check-recurring' } : {}),
      }
    }

    it('shows a schedule that fails most firings, though its latest firing succeeded', async () => {
      const { read } = await booted()
      const failedFirings = Array.from({ length: 9 }, (_, index) =>
        retained(`2026-08-27T05:${10 + index}:00.000Z`, 'firing'),
      )

      const report = await read({
        failed: failedFirings,
        completed: [retained('2026-08-27T05:55:00.000Z', 'firing')],
      })

      // Readiness asks whether the cadence works now; the count keeps the history.
      expect(report).toMatchObject({
        ready: true,
        repairRequired: 0,
        terminalFailures: 9,
      })
      expect(report.rows[0]).toMatchObject({
        ready: true,
        reasons: [],
        lastSucceededAt: '2026-08-27T05:55:00.000Z',
        lastScheduleFailureAt: '2026-08-27T05:18:00.000Z',
        lastOnDemandFailureAt: null,
        failedCount: 9,
      })
    })

    it('keeps a retained failed manual run in repair after a later firing succeeds', async () => {
      const { read } = await booted()

      const report = await read({
        failed: [retained('2026-08-27T05:40:00.000Z', 'on-demand')],
        completed: [retained('2026-08-27T05:55:00.000Z', 'firing')],
      })

      expect(report).toMatchObject({
        ready: false,
        repairRequired: 1,
        terminalFailures: 1,
      })
      expect(report.rows[0]).toMatchObject({
        reasons: ['repair_required'],
        lastScheduleFailureAt: null,
        lastOnDemandFailureAt: '2026-08-27T05:40:00.000Z',
        failedCount: 1,
      })
    })

    it('keeps the heads of a failed firing and a failed manual run apart', async () => {
      const { store, read } = await booted()
      await store.recordTerminalFailure({
        queue: 'background',
        jobName: 'health-check',
        jobId: 'repeat:health-check-recurring:1',
        at: new Date('2026-08-27T05:30:00.000Z'),
        executionKind: 'schedule',
      })
      await store.recordTerminalFailure({
        queue: 'background',
        jobName: 'health-check',
        jobId: 'manual-1',
        at: new Date('2026-08-27T05:40:00.000Z'),
        executionKind: 'worker',
      })
      await store.recordSucceeded({
        queue: 'background',
        jobName: 'health-check',
        jobId: 'repeat:health-check-recurring:2',
        at: new Date('2026-08-27T05:50:00.000Z'),
        repair: false,
      })

      const failed = await read()
      expect(failed.rows[0]).toMatchObject({
        ready: false,
        reasons: ['repair_required'],
        lastScheduleFailureAt: '2026-08-27T05:30:00.000Z',
        lastOnDemandFailureAt: '2026-08-27T05:40:00.000Z',
        // Counted from the retained failed set only; the heads keep the times.
        failedCount: 0,
      })

      await store.recordSucceeded({
        queue: 'background',
        jobName: 'health-check',
        jobId: 'redrive-1',
        at: new Date('2026-08-27T05:52:00.000Z'),
        repair: true,
      })
      expect((await read()).rows[0]).toMatchObject({ ready: true, reasons: [] })
    })

    it('does not hold a family that left the active schedule on its failed firings', async () => {
      const { store, read } = await booted([contract({ posture: 'quarantined' })])
      await store.recordTerminalFailure({
        queue: 'background',
        jobName: 'health-check',
        jobId: 'repeat:health-check-recurring:1',
        at: new Date('2026-08-27T05:30:00.000Z'),
        executionKind: 'schedule',
      })

      const report = await read(
        { failed: [retained('2026-08-27T05:31:00.000Z', 'firing')] },
        [],
      )

      expect(report).toMatchObject({
        ready: true,
        repairRequired: 0,
        terminalFailures: 1,
      })
      expect(report.rows[0]).toMatchObject({
        ready: true,
        reasons: [],
        lastScheduleFailureAt: '2026-08-27T05:31:00.000Z',
        failedCount: 1,
      })
    })

    // Before the split, one head field held every terminal failure. A scheduled
    // family's was judged as a firing, an unscheduled family's as on-demand work.
    it('reads a failure recorded before the split by the family schedule', async () => {
      const onDemand = contract({
        jobName: 'sync-property-reviews',
        queue: 'default',
        schedule: 'none',
        lastSuccessObjectiveMs: null,
      })
      const leftSchedule = contract({ jobName: 'purge-exports', posture: 'quarantined' })
      const { redis, store, read } = await booted([contract(), leftSchedule, onDemand])
      const jobNames = ['health-check', 'purge-exports', 'sync-property-reviews']
      for (const jobName of jobNames) {
        await redis.hset(
          `repkey:job-runtime:v1:${jobName}`,
          'lastTerminalFailureAt',
          '2026-08-27T05:30:00.000Z',
        )
      }

      // Unanswered, the active schedule's old failure still holds it.
      expect((await read()).rows).toMatchObject([
        {
          jobName: 'health-check',
          reasons: ['success_never_observed', 'repair_required'],
        },
        { jobName: 'purge-exports', ready: true },
        { jobName: 'sync-property-reviews', reasons: ['repair_required'] },
      ])

      for (const jobName of jobNames) {
        await store.recordSucceeded({
          queue: 'background',
          jobName,
          jobId: `${jobName}-later`,
          at: new Date('2026-08-27T05:50:00.000Z'),
          repair: false,
        })
      }

      const report = await read()

      expect(report.rows).toMatchObject([
        {
          jobName: 'health-check',
          ready: true,
          lastScheduleFailureAt: '2026-08-27T05:30:00.000Z',
          lastOnDemandFailureAt: null,
        },
        {
          jobName: 'purge-exports',
          ready: true,
          lastScheduleFailureAt: '2026-08-27T05:30:00.000Z',
          lastOnDemandFailureAt: null,
        },
        {
          jobName: 'sync-property-reviews',
          ready: false,
          reasons: ['repair_required'],
          lastScheduleFailureAt: null,
          lastOnDemandFailureAt: '2026-08-27T05:30:00.000Z',
        },
      ])
    })
  })

  it('allows a quarantined safety handler but rejects its scheduler', async () => {
    const redis = createFakeJobRuntimeRedis()
    const store = createJobRuntimeObservationStore({ redis })
    const contracts = [contract({ posture: 'quarantined' })]
    await store.recordBoot({
      contracts,
      registeredHandlers: new Set(['health-check']),
      registeredSchedulers: new Set(),
      runtimeStartedAt: NOW,
    })

    const report = await createJobRuntimeReportReader({
      contracts,
      store,
      queues: { background: queue(), default: null },
      quarantine: null,
      clock: () => NOW,
    }).read()
    expect(report.rows[0]).toMatchObject({ ready: true, reasons: [] })
  })

  it('surfaces forbidden queued or started work for a dark family', async () => {
    const redis = createFakeJobRuntimeRedis()
    const store = createJobRuntimeObservationStore({ redis })
    const contracts = [
      contract({
        jobName: 'leaderboard.reconcile',
        posture: 'dark',
        schedule: 'cron:30 * * * *',
      }),
    ]
    await store.recordBoot({
      contracts,
      registeredHandlers: new Set(),
      registeredSchedulers: new Set(),
      runtimeStartedAt: new Date('2026-08-27T05:55:00.000Z'),
    })
    await store.recordStarted({
      queue: 'background',
      jobName: 'leaderboard.reconcile',
      jobId: 'forbidden-1',
      at: new Date('2026-08-27T05:56:00.000Z'),
    })

    const report = await createJobRuntimeReportReader({
      contracts,
      store,
      queues: {
        default: null,
        background: queue({
          jobs: {
            waiting: [
              {
                name: 'leaderboard.reconcile',
                timestamp: Date.parse('2026-08-27T05:59:00.000Z'),
              },
            ],
          },
        }),
      },
      quarantine: null,
      clock: () => NOW,
    }).read()

    expect(report.forbiddenDarkWork).toBe(1)
    expect(report.rows[0]?.reasons).toEqual([
      'dark_queue_work_present',
      'dark_execution_observed',
    ])
  })

  describe('while work runs during the read', () => {
    async function bootedHealthCheck() {
      const redis = createFakeJobRuntimeRedis()
      const store = createJobRuntimeObservationStore({ redis })
      const contracts = [contract()]
      await store.recordBoot({
        contracts,
        registeredHandlers: new Set(['health-check']),
        registeredSchedulers: new Set(['health-check']),
        runtimeStartedAt: new Date('2026-08-27T05:59:00.000Z'),
      })
      return { store, contracts }
    }

    const scheduled = [{ key: 'health-check-recurring', name: 'health-check' }]

    it('does not mistake work that finished mid-read for a timestamp from the future', async () => {
      const { store, contracts } = await bootedHealthCheck()
      // The scans take three seconds; a job finishes two seconds in.
      const clockReads = [NOW, new Date(NOW.getTime() + 3_000)]

      const report = await createJobRuntimeReportReader({
        contracts,
        store,
        queues: {
          default: null,
          background: queue({
            schedulers: scheduled,
            jobs: {
              completed: [
                {
                  name: 'health-check',
                  timestamp: NOW.getTime() - 1_000,
                  processedOn: NOW.getTime() + 1_000,
                  finishedOn: NOW.getTime() + 2_000,
                },
              ],
            },
          }),
        },
        quarantine: null,
        clock: () => clockReads.shift() ?? new Date(NOW.getTime() + 3_000),
      }).read()

      expect(report).toMatchObject({ ready: true, invalidObservations: 0 })
    })

    it('still counts a head from the future as invalid', async () => {
      const { store, contracts } = await bootedHealthCheck()
      await store.recordSucceeded({
        queue: 'background',
        jobName: 'health-check',
        jobId: 'from-the-future',
        repair: false,
        at: new Date(NOW.getTime() + 10 * 60_000),
      })

      const report = await createJobRuntimeReportReader({
        contracts,
        store,
        queues: { default: null, background: queue({ schedulers: scheduled }) },
        quarantine: null,
        clock: () => NOW,
      }).read()

      expect(report).toMatchObject({ ready: false, failing: 1, invalidObservations: 1 })
      expect(report.rows[0]?.reasons).toEqual(['invalid_observation'])
    })

    it('ages a delayed job from when it became due, not from when it was added', async () => {
      const { store, contracts } = await bootedHealthCheck()

      // Added 19 minutes ago with a 15-minute delay; BullMQ zeroed `delay` when it
      // promoted the job to waiting four minutes ago.
      const report = await createJobRuntimeReportReader({
        contracts,
        store,
        queues: {
          default: null,
          background: queue({
            schedulers: scheduled,
            jobs: {
              waiting: [
                {
                  name: 'health-check',
                  timestamp: NOW.getTime() - 19 * 60_000,
                  delay: 0,
                  opts: { delay: 15 * 60_000 },
                },
              ],
            },
          }),
        },
        quarantine: null,
        clock: () => NOW,
      }).read()

      expect(report.rows[0]).toMatchObject({
        ready: true,
        oldestWaitingAt: new Date(NOW.getTime() - 4 * 60_000).toISOString(),
      })
    })

    describe('a delayed job promoted between the listing and the read', () => {
      const MINUTE = 60_000
      type QueuedState = 'waiting' | 'delayed' | 'prioritized' | 'waiting-children'

      async function readQueued(state: QueuedState, job: Record<string, unknown>) {
        const { store, contracts } = await bootedHealthCheck()
        const report = await createJobRuntimeReportReader({
          contracts,
          store,
          queues: {
            default: null,
            background: queue({
              schedulers: scheduled,
              jobs: { [state]: [{ name: 'health-check', ...job }] },
            }),
          },
          quarantine: null,
          clock: () => NOW,
        }).read()
        return report.rows[0]
      }

      it('ages a job listed as delayed but read after promotion from its due time', async () => {
        // BullMQ lists job ids first and reads each hash afterwards. The job was
        // delayed when listed and promoted a moment before its hash was read, so it
        // arrives with `delay` zeroed, no `processedOn`, and the add-time `opts.delay`.
        // It became due 500 ms ago; its creation was a full cadence earlier.
        const row = await readQueued('delayed', {
          timestamp: NOW.getTime() - (15 * MINUTE + 500),
          delay: 0,
          opts: { delay: 15 * MINUTE },
        })

        expect(row).toMatchObject({
          ready: true,
          reasons: [],
          oldestWaitingAt: new Date(NOW.getTime() - 500).toISOString(),
        })
      })

      it.each([
        ['still delayed', 'delayed', 3 * MINUTE, 3 * MINUTE, 3 * MINUTE],
        ['promoted before it was read', 'delayed', 0, 3 * MINUTE, 3 * MINUTE],
        ['rescheduled while delayed', 'delayed', 1 * MINUTE, 3 * MINUTE, 1 * MINUTE],
        ['promoted to waiting', 'waiting', 0, 3 * MINUTE, 3 * MINUTE],
        ['promoted to prioritized', 'prioritized', 0, 3 * MINUTE, 3 * MINUTE],
        ['promoted to waiting-children', 'waiting-children', 0, 3 * MINUTE, 3 * MINUTE],
        ['added without a delay to waiting', 'waiting', 0, undefined, 0],
        ['added without a delay to prioritized', 'prioritized', 0, undefined, 0],
        [
          'added without a delay to waiting-children',
          'waiting-children',
          0,
          undefined,
          0,
        ],
      ] as const)(
        'dates a job that is %s from its add-time due time (%s, delay %s, opts.delay %s)',
        async (_situation, state, delay, optsDelay, expectedDueAfterAddMs) => {
          // Added four minutes ago; every combination here is already due.
          const addedAt = NOW.getTime() - 4 * MINUTE

          const row = await readQueued(state, {
            timestamp: addedAt,
            delay,
            opts: optsDelay === undefined ? {} : { delay: optsDelay },
          })

          expect(row).toMatchObject({
            ready: true,
            oldestWaitingAt: new Date(addedAt + expectedDueAfterAddMs).toISOString(),
          })
        },
      )

      it.each([
        ['still delayed', 15 * MINUTE],
        ['promoted before it was read', 0],
      ])(
        'still raises the queue age alert for a job that is %s and overdue past the objective',
        async (_situation, delay) => {
          // Due 400 s ago against a 300 s objective: the worker is not keeping up.
          const dueAt = NOW.getTime() - 400_000

          const row = await readQueued('delayed', {
            timestamp: dueAt - 15 * MINUTE,
            delay,
            opts: { delay: 15 * MINUTE },
          })

          expect(row).toMatchObject({
            ready: false,
            reasons: ['queue_age_objective_missed'],
            oldestWaitingAt: new Date(dueAt).toISOString(),
          })
        },
      )

      it('ignores a delayed job that is not yet due', async () => {
        const row = await readQueued('delayed', {
          timestamp: NOW.getTime() - 5 * MINUTE,
          delay: 15 * MINUTE,
          opts: { delay: 15 * MINUTE },
        })

        expect(row).toMatchObject({ ready: true, oldestWaitingAt: null })
      })
    })

    it('gives a job requeued by a retry no queue age', async () => {
      const { store, contracts } = await bootedHealthCheck()

      const report = await createJobRuntimeReportReader({
        contracts,
        store,
        queues: {
          default: null,
          background: queue({
            schedulers: scheduled,
            jobs: {
              waiting: [
                {
                  name: 'health-check',
                  timestamp: NOW.getTime() - 60 * 60_000,
                  delay: 0,
                  processedOn: NOW.getTime() - 55 * 60_000,
                },
              ],
            },
          }),
        },
        quarantine: null,
        clock: () => NOW,
      }).read()

      expect(report.rows[0]).toMatchObject({ ready: true, oldestWaitingAt: null })
    })
  })
})
