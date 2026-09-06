import { describe, expect, it } from 'vitest'
import type { JobOperationalContract } from './runtime-authority'
import {
  createJobRuntimeObservationStore,
  createJobRuntimeReportReader,
  type JobRuntimeRedisPort,
  type JobRuntimeQueuePort,
} from './runtime-observations'

class MemoryRedis implements JobRuntimeRedisPort {
  readonly hashes = new Map<string, Map<string, string>>()
  readonly strings = new Map<string, string>()

  async hset(key: string, ...fields: string[]): Promise<number> {
    const hash = this.hashes.get(key) ?? new Map<string, string>()
    for (let index = 0; index < fields.length; index += 2) {
      hash.set(fields[index]!, fields[index + 1]!)
    }
    this.hashes.set(key, hash)
    return fields.length / 2
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key) ?? [])
  }

  async set(key: string, value: string, _mode: 'PX', _ttl: number): Promise<'OK'> {
    this.strings.set(key, value)
    return 'OK'
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null
  }

  async del(key: string): Promise<number> {
    return this.strings.delete(key) ? 1 : 0
  }
}

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
      'pnpm ops:quarantine redrive <quarantineJobId> --operator <registered-operator> --reason <incident-reason> --apply',
    runbook: 'docs/operations/runbooks.md',
    ...overrides,
  }
}

function queue(
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

describe('durable job runtime observations', () => {
  it('preserves the latest success across a worker restart', async () => {
    const redis = new MemoryRedis()
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
    const redis = new MemoryRedis()
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
    const redis = new MemoryRedis()
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
    const redis = new MemoryRedis()
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
    const redis = new MemoryRedis()
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
      repairCommand: expect.stringContaining('ops:quarantine redrive'),
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

  it('allows a quarantined safety handler but rejects its scheduler', async () => {
    const redis = new MemoryRedis()
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
    const redis = new MemoryRedis()
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
})
