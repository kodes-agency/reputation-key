import { describe, expect, it } from 'vitest'
import {
  bootJobRuntime,
  fakeRuntimeQueue as queue,
} from '#/shared/testing/fake-job-runtime'
import {
  BOOT_DEFAULTS,
  HEALTH_CHECK_SCHEDULERS as scheduled,
  NOW,
  retainedJob,
} from './runtime-observations.test-fixtures'

describe('durable job runtime observations', () => {
  it('does not count a future delayed execution as queue backlog', async () => {
    const { read } = await bootJobRuntime(BOOT_DEFAULTS)

    const report = await read({
      background: queue({
        schedulers: scheduled,
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
    })

    expect(report.rows[0]).toMatchObject({ ready: true, oldestWaitingAt: null })
  })

  describe('while work runs during the read', () => {
    it('does not mistake work that finished mid-read for a timestamp from the future', async () => {
      const { read } = await bootJobRuntime(BOOT_DEFAULTS)
      // The scans take three seconds; a job finishes two seconds in.
      const clockReads = [NOW, new Date(NOW.getTime() + 3_000)]

      const report = await read({
        background: queue({
          schedulers: scheduled,
          jobs: {
            completed: [
              {
                ...retainedJob('health-check', NOW.getTime() + 2_000),
                timestamp: NOW.getTime() - 1_000,
                processedOn: NOW.getTime() + 1_000,
              },
            ],
          },
        }),
        clock: () => clockReads.shift() ?? new Date(NOW.getTime() + 3_000),
      })

      expect(report).toMatchObject({ ready: true, invalidObservations: 0 })
    })

    it('still counts a head from the future as invalid', async () => {
      const { store, read } = await bootJobRuntime(BOOT_DEFAULTS)
      await store.recordSucceeded({
        queue: 'background',
        jobName: 'health-check',
        jobId: 'from-the-future',
        repair: false,
        at: new Date(NOW.getTime() + 10 * 60_000),
      })

      const report = await read({ background: queue({ schedulers: scheduled }) })

      expect(report).toMatchObject({ ready: false, failing: 1, invalidObservations: 1 })
      expect(report.rows[0]?.reasons).toEqual(['invalid_observation'])
    })

    it('ages a delayed job from when it became due, not from when it was added', async () => {
      const { read } = await bootJobRuntime(BOOT_DEFAULTS)

      // Added 19 minutes ago with a 15-minute delay; BullMQ zeroed `delay` when it
      // promoted the job to waiting four minutes ago.
      const report = await read({
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
      })

      expect(report.rows[0]).toMatchObject({
        ready: true,
        oldestWaitingAt: new Date(NOW.getTime() - 4 * 60_000).toISOString(),
      })
    })

    describe('a delayed job promoted between the listing and the read', () => {
      const MINUTE = 60_000
      type QueuedState = 'waiting' | 'delayed' | 'prioritized' | 'waiting-children'

      async function readQueued(state: QueuedState, job: Record<string, unknown>) {
        const { read } = await bootJobRuntime(BOOT_DEFAULTS)
        const report = await read({
          background: queue({
            schedulers: scheduled,
            jobs: { [state]: [{ name: 'health-check', ...job }] },
          }),
        })
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
        [
          'delayed with a live delay that differs from opts.delay',
          'delayed',
          1 * MINUTE,
          3 * MINUTE,
          1 * MINUTE,
        ],
        ['promoted to waiting', 'waiting', 0, 3 * MINUTE, 3 * MINUTE],
        ['promoted to prioritized', 'prioritized', 0, 3 * MINUTE, 3 * MINUTE],
        [
          'waiting on children with an add-time delay',
          'waiting-children',
          0,
          3 * MINUTE,
          3 * MINUTE,
        ],
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
      const { read } = await bootJobRuntime(BOOT_DEFAULTS)

      const report = await read({
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
      })

      expect(report.rows[0]).toMatchObject({ ready: true, oldestWaitingAt: null })
    })
  })
})
