import { describe, expect, it } from 'vitest'
import {
  assessJobRuntime,
  heldRepairLatches,
  validateJobOperationalContracts,
  type JobOperationalContract,
  type JobRuntimeObservation,
} from './runtime-authority'

const NOW = new Date('2026-08-27T03:00:00.000Z')
const STARTED = new Date('2026-08-27T02:30:00.000Z')

function scheduledContract(
  overrides: Partial<JobOperationalContract> = {},
): JobOperationalContract {
  return {
    jobName: 'review-lifecycle-sweep',
    owner: 'review',
    processor: 'src/contexts/review/infrastructure/jobs/review-lifecycle.job.ts',
    action: 'system:review.purge',
    capability: 'none',
    queue: 'background',
    retryAttempts: 3,
    retryBackoff: 'exponential:30000',
    timeoutMs: 120_000,
    workerConcurrency: 3,
    retention: 'completed:100,failed:50',
    routing: 'cell_local',
    posture: 'active',
    schedule: 'every:300000',
    lastSuccessObjectiveMs: 10 * 60_000,
    maximumQueueAgeMs: 5 * 60_000,
    repairCommand: 'pnpm ops purge reviews --operator <registered-operator>',
    runbook: 'docs/operations/runbooks.md',
    ...overrides,
  }
}

function observation(
  overrides: Partial<JobRuntimeObservation> = {},
): JobRuntimeObservation {
  return {
    jobName: 'review-lifecycle-sweep',
    handlerRegistered: true,
    schedulerRegistered: true,
    lastStartedAt: new Date('2026-08-27T02:56:00.000Z'),
    lastSucceededAt: new Date('2026-08-27T02:57:00.000Z'),
    lastOnDemandFailureAt: null,
    lastScheduleFailureAt: null,
    lastRepairAt: null,
    lastStalledAt: null,
    lastDeniedAt: null,
    lastScheduleDeniedAt: null,
    oldestWaitingAt: null,
    deadLetterCount: 0,
    ...overrides,
  }
}

describe('job runtime authority', () => {
  it('accepts a healthy scheduled job', () => {
    expect(
      assessJobRuntime({
        contract: scheduledContract(),
        observation: observation(),
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({ ready: true, reasons: [] })
  })

  it('fails readiness when an active handler or scheduler is absent', () => {
    expect(
      assessJobRuntime({
        contract: scheduledContract(),
        observation: observation({
          handlerRegistered: false,
          schedulerRegistered: false,
        }),
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({
      ready: false,
      reasons: ['handler_missing', 'scheduler_missing'],
    })
  })

  it('does not let a dark capability retain executable work', () => {
    const result = assessJobRuntime({
      contract: scheduledContract({ posture: 'dark' }),
      observation: observation(),
      runtimeStartedAt: STARTED,
      now: NOW,
    })

    expect(result).toEqual({
      ready: false,
      reasons: [
        'dark_handler_registered',
        'dark_scheduler_registered',
        'dark_execution_observed',
      ],
    })
  })

  it('detects dark work that started after boot even without a retained handler', () => {
    expect(
      assessJobRuntime({
        contract: scheduledContract({ posture: 'dark' }),
        observation: observation({
          handlerRegistered: false,
          schedulerRegistered: false,
          lastStartedAt: new Date('2026-08-27T02:45:00.000Z'),
        }),
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({ ready: false, reasons: ['dark_execution_observed'] })
  })

  it('allows a quarantined report handler but never a recurring scheduler', () => {
    expect(
      assessJobRuntime({
        contract: scheduledContract({ posture: 'quarantined' }),
        observation: observation({ schedulerRegistered: false }),
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({ ready: true, reasons: [] })

    expect(
      assessJobRuntime({
        contract: scheduledContract({ posture: 'quarantined' }),
        observation: observation(),
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({ ready: false, reasons: ['quarantined_scheduler_registered'] })
  })

  it('keeps poison work visible for a quarantined safety family', () => {
    expect(
      assessJobRuntime({
        contract: scheduledContract({ posture: 'quarantined' }),
        observation: observation({
          schedulerRegistered: false,
          lastOnDemandFailureAt: new Date('2026-08-27T02:58:00.000Z'),
          deadLetterCount: 1,
        }),
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({
      ready: false,
      reasons: ['repair_required', 'dead_letter_present'],
    })
  })

  it('allows one objective window after restart before requiring a first success', () => {
    const noSuccess = observation({
      lastStartedAt: null,
      lastSucceededAt: null,
    })

    expect(
      assessJobRuntime({
        contract: scheduledContract(),
        observation: noSuccess,
        runtimeStartedAt: new Date('2026-08-27T02:55:00.000Z'),
        now: NOW,
      }),
    ).toEqual({ ready: true, reasons: [] })

    expect(
      assessJobRuntime({
        contract: scheduledContract(),
        observation: noSuccess,
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({ ready: false, reasons: ['success_never_observed'] })
  })

  it('retains a prior durable success across a process restart', () => {
    expect(
      assessJobRuntime({
        contract: scheduledContract(),
        observation: observation({
          lastSucceededAt: new Date('2026-08-27T02:55:00.000Z'),
        }),
        runtimeStartedAt: new Date('2026-08-27T02:59:00.000Z'),
        now: NOW,
      }),
    ).toEqual({ ready: true, reasons: [] })
  })

  it('detects one missed success objective and an over-age queue', () => {
    expect(
      assessJobRuntime({
        contract: scheduledContract(),
        observation: observation({
          lastSucceededAt: new Date('2026-08-27T02:40:00.000Z'),
          oldestWaitingAt: new Date('2026-08-27T02:50:00.000Z'),
        }),
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({
      ready: false,
      reasons: ['last_success_objective_missed', 'queue_age_objective_missed'],
    })
  })

  it('tolerates a second of clock skew between hosts, not a head from the future', () => {
    const assess = (lastSucceededAt: Date, runtimeStartedAt = STARTED) =>
      assessJobRuntime({
        contract: scheduledContract(),
        observation: observation({ lastSucceededAt }),
        runtimeStartedAt,
        now: NOW,
      })
    const skewed = new Date(NOW.getTime() + 500)
    const future = new Date(NOW.getTime() + 5_000)

    expect(assess(skewed)).toEqual({ ready: true, reasons: [] })
    expect(assess(future)).toEqual({ ready: false, reasons: ['invalid_observation'] })
    expect(assess(NOW, skewed)).toEqual({ ready: true, reasons: [] })
    expect(assess(NOW, future)).toEqual({
      ready: false,
      reasons: ['invalid_observation'],
    })
  })

  it('keeps a poison item visible until a later repair is observed', () => {
    const failedAt = new Date('2026-08-27T02:58:00.000Z')
    const poisoned = observation({
      lastOnDemandFailureAt: failedAt,
      deadLetterCount: 1,
    })

    expect(
      assessJobRuntime({
        contract: scheduledContract(),
        observation: poisoned,
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({ ready: false, reasons: ['repair_required', 'dead_letter_present'] })

    expect(
      assessJobRuntime({
        contract: scheduledContract(),
        observation: {
          ...poisoned,
          lastRepairAt: new Date('2026-08-27T02:59:00.000Z'),
          deadLetterCount: 0,
        },
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({ ready: true, reasons: [] })
  })

  // A firing and an on-demand run fail into separate latches. A firing is never
  // dead-lettered and the next one repeats the whole pass, so a later success
  // answers it while the family is an active schedule. On-demand work is
  // dead-lettered, so only a governed quarantine redrive answers it.
  describe('terminal failures, by execution kind', () => {
    const FAILED_AT = new Date('2026-08-27T02:56:30.000Z')
    const REDRIVEN_AT = new Date('2026-08-27T02:57:00.000Z')
    const onDemand = scheduledContract({ schedule: 'none', lastSuccessObjectiveMs: null })
    const assess = (contract: JobOperationalContract, observed: JobRuntimeObservation) =>
      assessJobRuntime({
        contract,
        observation: observed,
        runtimeStartedAt: STARTED,
        now: NOW,
      })
    const firingFailedThenSucceeded = observation({
      lastScheduleFailureAt: FAILED_AT,
      lastSucceededAt: new Date('2026-08-27T02:57:00.000Z'),
    })

    it('clears a failed firing of an active schedule on a later success', () => {
      expect(assess(scheduledContract(), firingFailedThenSucceeded)).toEqual({
        ready: true,
        reasons: [],
      })
    })

    it('keeps an active schedule in repair while its latest run is the failed firing', () => {
      expect(
        assess(scheduledContract(), {
          ...firingFailedThenSucceeded,
          lastScheduleFailureAt: new Date('2026-08-27T02:58:00.000Z'),
        }),
      ).toEqual({ ready: false, reasons: ['repair_required'] })
    })

    it('keeps on-demand work in repair after a plain success, until a governed redrive succeeds', () => {
      const failed = observation({
        schedulerRegistered: false,
        lastOnDemandFailureAt: FAILED_AT,
      })

      expect(assess(onDemand, failed)).toEqual({
        ready: false,
        reasons: ['repair_required'],
      })
      expect(assess(onDemand, { ...failed, lastRepairAt: REDRIVEN_AT })).toEqual({
        ready: true,
        reasons: [],
      })
    })

    // `pnpm ops refresh` and `pnpm ops purge` enqueue a scheduled family's job
    // on demand. That run is dead-lettered like any on-demand work, and a later
    // firing succeeding does not answer it.
    it('keeps a failed manual run of an active schedule in repair after a firing succeeds', () => {
      const manualRunFailed = observation({ lastOnDemandFailureAt: FAILED_AT })

      expect(assess(scheduledContract(), manualRunFailed)).toEqual({
        ready: false,
        reasons: ['repair_required'],
      })
      expect(
        assess(scheduledContract(), { ...manualRunFailed, lastRepairAt: REDRIVEN_AT }),
      ).toEqual({ ready: true, reasons: [] })
    })

    it('does not let a later firing failure and success hide an unanswered on-demand failure', () => {
      expect(
        assess(scheduledContract(), {
          ...firingFailedThenSucceeded,
          lastOnDemandFailureAt: new Date('2026-08-27T02:56:00.000Z'),
        }),
      ).toEqual({ ready: false, reasons: ['repair_required'] })
    })

    // The dead end the first fix left: a firing failed, then a release moved the
    // family out of the active schedule. No firing could succeed after that, and
    // the failed firing left no dead letter to redrive.
    describe.each([
      ['quarantined', { posture: 'quarantined' }],
      ['made on-demand', { schedule: 'none', lastSuccessObjectiveMs: null }],
    ] as const)('a family %s after a failed firing', (_, change) => {
      const left = scheduledContract(change)
      const firingFailedLast = observation({
        schedulerRegistered: false,
        lastScheduleFailureAt: new Date('2026-08-27T02:58:00.000Z'),
      })

      it('is not held in repair by the old firing failure', () => {
        expect(assess(left, firingFailedLast)).toEqual({ ready: true, reasons: [] })
      })

      it('still waits for a redrive of its own on-demand failure', () => {
        expect(
          assess(left, {
            ...firingFailedLast,
            lastOnDemandFailureAt: FAILED_AT,
            deadLetterCount: 1,
          }),
        ).toEqual({ ready: false, reasons: ['repair_required', 'dead_letter_present'] })
      })

      it('counts the firing failure again once it is an active schedule, until a success', () => {
        expect(
          assess(scheduledContract(), { ...firingFailedLast, schedulerRegistered: true }),
        ).toEqual({ ready: false, reasons: ['repair_required'] })
      })
    })
  })

  // `repair_required` is one reason with two causes. Which latch holds decides
  // what answers it: a redrive (or an operator's acknowledgement) for on-demand
  // work, a later success for a failed firing.
  describe('which repair latch holds', () => {
    const FAILED_AT = new Date('2026-08-27T02:56:30.000Z')
    const AFTER_FAILURE = new Date('2026-08-27T02:57:00.000Z')
    const onDemand = scheduledContract({ schedule: 'none', lastSuccessObjectiveMs: null })
    const held = (
      contract: JobOperationalContract,
      overrides: Partial<JobRuntimeObservation>,
    ) => heldRepairLatches(contract, observation(overrides))

    it('holds neither latch for a family with no failure', () => {
      expect(held(scheduledContract(), {})).toEqual({ onDemand: false, schedule: false })
    })

    it('holds the on-demand latch from a failure that no repair has answered', () => {
      expect(held(onDemand, { lastOnDemandFailureAt: FAILED_AT })).toEqual({
        onDemand: true,
        schedule: false,
      })
      // A plain success is not a repair.
      expect(
        held(onDemand, {
          lastOnDemandFailureAt: FAILED_AT,
          lastSucceededAt: AFTER_FAILURE,
        }).onDemand,
      ).toBe(true)
    })

    it('releases the on-demand latch once a repair is as recent as the failure', () => {
      expect(
        held(onDemand, { lastOnDemandFailureAt: FAILED_AT, lastRepairAt: FAILED_AT })
          .onDemand,
      ).toBe(false)
    })

    it('holds the schedule latch only for an active schedule, until a later success', () => {
      const failedFiring = { lastScheduleFailureAt: FAILED_AT, lastSucceededAt: null }

      expect(held(scheduledContract(), failedFiring)).toEqual({
        onDemand: false,
        schedule: true,
      })
      expect(
        held(scheduledContract(), { ...failedFiring, lastSucceededAt: AFTER_FAILURE })
          .schedule,
      ).toBe(false)
      expect(held(onDemand, failedFiring).schedule).toBe(false)
      expect(
        held(scheduledContract({ posture: 'quarantined' }), failedFiring).schedule,
      ).toBe(false)
    })

    it('holds both when a manual run and a firing both failed unanswered', () => {
      expect(
        held(scheduledContract(), {
          lastOnDemandFailureAt: FAILED_AT,
          lastScheduleFailureAt: FAILED_AT,
          lastSucceededAt: null,
        }),
      ).toEqual({ onDemand: true, schedule: true })
    })
  })

  it('keeps stalled work visible until a later success or repair is observed', () => {
    const stalled = observation({
      lastStalledAt: new Date('2026-08-27T02:58:00.000Z'),
    })

    expect(
      assessJobRuntime({
        contract: scheduledContract(),
        observation: stalled,
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({ ready: false, reasons: ['stalled_work_observed'] })

    expect(
      assessJobRuntime({
        contract: scheduledContract(),
        observation: {
          ...stalled,
          lastSucceededAt: new Date('2026-08-27T02:59:00.000Z'),
        },
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({ ready: true, reasons: [] })
  })

  it('fails a scheduled family whose firing the gate denied until a later success', () => {
    // A schedule is enumeration-only (tenant-cross or unscoped), so a terminal
    // denial there is a catalogue or configuration defect: the cadence is dead.
    const deniedAt = new Date('2026-08-27T02:58:00.000Z')
    const denied = observation({ lastDeniedAt: deniedAt, lastScheduleDeniedAt: deniedAt })

    expect(
      assessJobRuntime({
        contract: scheduledContract(),
        observation: denied,
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({ ready: false, reasons: ['schedule_denied'] })

    expect(
      assessJobRuntime({
        contract: scheduledContract(),
        observation: {
          ...denied,
          lastSucceededAt: new Date('2026-08-27T02:59:00.000Z'),
        },
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({ ready: true, reasons: [] })
  })

  it('counts, but does not fail on, a terminal denial of on-demand work', () => {
    expect(
      assessJobRuntime({
        contract: scheduledContract({ schedule: 'none', lastSuccessObjectiveMs: null }),
        observation: observation({
          schedulerRegistered: false,
          lastDeniedAt: new Date('2026-08-27T02:58:00.000Z'),
        }),
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({ ready: true, reasons: [] })
  })

  it.each(['lastOnDemandFailureAt', 'lastScheduleFailureAt'] as const)(
    'treats a %s head from the future as an invalid observation',
    (field) => {
      expect(
        assessJobRuntime({
          contract: scheduledContract(),
          observation: observation({ [field]: new Date(NOW.getTime() + 60_000) }),
          runtimeStartedAt: STARTED,
          now: NOW,
        }),
      ).toEqual({ ready: false, reasons: ['invalid_observation'] })
    },
  )

  it('treats a denial head from the future as an invalid observation', () => {
    expect(
      assessJobRuntime({
        contract: scheduledContract(),
        observation: observation({ lastDeniedAt: new Date(NOW.getTime() + 60_000) }),
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({ ready: false, reasons: ['invalid_observation'] })
  })

  it('requires an observation to prove that dark work is absent', () => {
    expect(
      assessJobRuntime({
        contract: scheduledContract({ posture: 'dark' }),
        observation: null,
        runtimeStartedAt: STARTED,
        now: NOW,
      }),
    ).toEqual({ ready: false, reasons: ['observation_missing'] })
  })

  it('validates unique, owned, repairable operational contracts', () => {
    expect(() =>
      validateJobOperationalContracts([
        scheduledContract(),
        scheduledContract({ jobName: 'notification-repair', owner: 'notification' }),
      ]),
    ).not.toThrow()

    expect(() =>
      validateJobOperationalContracts([
        scheduledContract(),
        scheduledContract({ owner: 'other' }),
      ]),
    ).toThrow(/duplicate job operational contract/i)
    expect(() =>
      validateJobOperationalContracts([scheduledContract({ runbook: '' })]),
    ).toThrow(/runbook/i)
    expect(() =>
      validateJobOperationalContracts([scheduledContract({ retryAttempts: 0 })]),
    ).toThrow(/retry attempts/i)
    expect(() =>
      validateJobOperationalContracts([
        scheduledContract({ retryBackoff: 'unknown:30000' }),
      ]),
    ).toThrow(/retry backoff/i)
    expect(() =>
      validateJobOperationalContracts([scheduledContract({ timeoutMs: 0 })]),
    ).toThrow(/timeout/i)
    expect(() =>
      validateJobOperationalContracts([scheduledContract({ workerConcurrency: 0 })]),
    ).toThrow(/concurrency/i)
    expect(() =>
      validateJobOperationalContracts([
        scheduledContract({ repairCommand: 'none', posture: 'active' }),
      ]),
    ).toThrow(/repair command/i)
  })
})
