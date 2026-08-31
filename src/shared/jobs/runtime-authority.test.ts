import { describe, expect, it } from 'vitest'
import {
  assessJobRuntime,
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
    repairCommand: 'pnpm ops:review-lifecycle report',
    runbook: 'docs/operations/review-lifecycle.md',
    ...overrides,
  }
}

function observation(
  overrides: Partial<JobRuntimeObservation> = {},
): JobRuntimeObservation {
  return {
    jobName: 'review-lifecycle-sweep',
    cell: 'europe',
    handlerRegistered: true,
    schedulerRegistered: true,
    lastStartedAt: new Date('2026-08-27T02:56:00.000Z'),
    lastSucceededAt: new Date('2026-08-27T02:57:00.000Z'),
    lastTerminalFailureAt: null,
    lastRepairAt: null,
    lastStalledAt: null,
    oldestWaitingAt: null,
    deadLetterCount: 0,
    ...overrides,
  }
}

describe('job runtime authority', () => {
  it('accepts a healthy cell-local scheduled job', () => {
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
          lastTerminalFailureAt: new Date('2026-08-27T02:58:00.000Z'),
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

  it('keeps a poison item visible until a later repair is observed', () => {
    const failedAt = new Date('2026-08-27T02:58:00.000Z')
    const poisoned = observation({
      lastTerminalFailureAt: failedAt,
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
