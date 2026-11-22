import { describe, expect, it } from 'vitest'
import {
  bootJobRuntime,
  fakeRuntimeQueue as queue,
} from '#/shared/testing/fake-job-runtime'
import {
  BOOT_DEFAULTS,
  contract,
  HEALTH_CHECK_SCHEDULERS as scheduled,
  retainedJob,
} from './runtime-observations.test-fixtures'

describe('durable job runtime observations', () => {
  describe('terminal gate denials', () => {
    const deniedFiring = {
      gate: 'denied',
      reason: 'missing_scope',
      executionKind: 'schedule',
    } as const

    it('records a denied schedule firing as a denial that fails the family until a later success', async () => {
      const { store, read: readReport } = await bootJobRuntime({
        ...BOOT_DEFAULTS,
        startedAt: new Date('2026-08-27T05:00:00.000Z'),
      })
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
      const read = () => readReport({ background: queue({ schedulers: scheduled }) })

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
      const { read } = await bootJobRuntime({
        ...BOOT_DEFAULTS,
        startedAt: new Date('2026-08-27T05:00:00.000Z'),
      })

      const report = await read({
        background: queue({
          schedulers: scheduled,
          jobs: {
            completed: [
              retainedJob('health-check', '2026-08-27T05:50:02.000Z', {
                returnvalue: deniedFiring,
              }),
              retainedJob('health-check', '2026-08-27T05:55:02.000Z', {
                returnvalue: deniedFiring,
              }),
            ],
          },
        }),
      })

      expect(report).toMatchObject({ ready: false, scheduleDenied: 1, gateDenials: 2 })
      expect(report.rows[0]).toMatchObject({
        reasons: ['schedule_denied', 'success_never_observed'],
        lastSucceededAt: null,
        lastDeniedAt: '2026-08-27T05:55:02.000Z',
        deniedCount: 2,
      })
    })

    it('counts a denial of on-demand work without failing the family', async () => {
      const { read } = await bootJobRuntime({
        ...BOOT_DEFAULTS,
        contracts: [
          contract({
            jobName: 'insert-notification',
            queue: 'default',
            schedule: 'none',
            lastSuccessObjectiveMs: null,
          }),
        ],
        startedAt: new Date('2026-08-27T05:00:00.000Z'),
      })

      const report = await read({
        background: null,
        default: queue({
          jobs: {
            completed: [
              retainedJob('insert-notification', '2026-08-27T05:55:02.000Z', {
                returnvalue: { ...deniedFiring, executionKind: 'worker' },
              }),
            ],
          },
        }),
      })

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
    type RetainedJobs = Partial<
      Record<'completed' | 'failed', Array<Record<string, unknown>>>
    >

    async function booted(contracts = [contract()]) {
      const runtime = await bootJobRuntime({
        ...BOOT_DEFAULTS,
        contracts,
        startedAt: new Date('2026-08-27T05:00:00.000Z'),
      })
      const read = (jobs: RetainedJobs = {}, schedulers = scheduled) =>
        runtime.read({ background: queue({ schedulers, jobs }) })
      return { redis: runtime.redis, store: runtime.store, read }
    }

    /** A retained `health-check` job; a scheduler firing carries its scheduler key. */
    function retained(at: string, kind: 'firing' | 'on-demand') {
      return retainedJob(
        'health-check',
        at,
        kind === 'firing' ? { repeatJobKey: 'health-check-recurring' } : {},
      )
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
})
