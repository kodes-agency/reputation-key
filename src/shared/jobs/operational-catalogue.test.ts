import { describe, expect, it } from 'vitest'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import {
  JOB_OPERATIONAL_CONTRACTS,
  RETIRED_SCHEDULER_JOB_NAMES,
  createOperationalSchedulerPlan,
  validateOperationalCatalogueCoverage,
} from './operational-catalogue'

describe('job operational catalogue', () => {
  it('covers every governed job family exactly once with its declared posture', () => {
    expect(() => validateOperationalCatalogueCoverage()).not.toThrow()
    expect(JOB_OPERATIONAL_CONTRACTS.map((row) => row.jobName).sort()).toEqual(
      JOB_FAMILY_ROWS.map((row) => row.jobName).sort(),
    )

    for (const family of JOB_FAMILY_ROWS) {
      const operational = JOB_OPERATIONAL_CONTRACTS.find(
        (row) => row.jobName === family.jobName,
      )
      expect(operational).toMatchObject({
        processor: family.processor,
        action: family.action,
        capability: family.capability,
        queue: family.queue,
        retryAttempts: family.retryAttempts,
        retryBackoff: family.retryBackoff,
        timeoutMs: family.timeoutMs,
        retention: family.retention,
        schedule: family.schedule,
        posture:
          family.registration === 'enabled'
            ? 'active'
            : family.registration === 'quarantined'
              ? 'quarantined'
              : 'dark',
      })
      expect(operational?.workerConcurrency).toBeGreaterThan(0)
    }
  })

  it('derives the complete scheduler plan and excludes dark or quarantined work', () => {
    const plan = createOperationalSchedulerPlan()
    const scheduledFamilies = JOB_FAMILY_ROWS.filter((row) => row.schedule !== 'none')

    expect(plan.managedJobNames.sort()).toEqual(
      [
        ...JOB_FAMILY_ROWS.map((row) => row.jobName),
        ...RETIRED_SCHEDULER_JOB_NAMES,
      ].sort(),
    )
    expect(plan.desired.map((row) => row.jobName).sort()).toEqual(
      scheduledFamilies
        .filter((row) => row.registration === 'enabled')
        .map((row) => row.jobName)
        .sort(),
    )
    expect(plan.desired).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jobName: 'purge-expired-reviews' }),
        expect.objectContaining({ jobName: 'leaderboard.reconcile' }),
      ]),
    )
  })

  it('retains a removal tombstone for the retired Leaderboard scheduler', () => {
    const plan = createOperationalSchedulerPlan()

    expect(
      JOB_OPERATIONAL_CONTRACTS.find(
        (contract) => contract.jobName === 'leaderboard.reconcile',
      ),
    ).toBeUndefined()
    expect(plan.managedJobNames).toContain('leaderboard.reconcile')
    expect(plan.desired.map((schedule) => schedule.jobName)).not.toContain(
      'leaderboard.reconcile',
    )
  })

  it('preserves exact interval offsets and cron patterns from governance', () => {
    const desired = createOperationalSchedulerPlan().desired
    expect(desired.find((row) => row.jobName === 'retention-sweep')?.repeat).toEqual({
      every: 86_400_000,
      offset: 10_800_000,
    })
    expect(
      desired.find((row) => row.jobName === 'refresh-daily-inbox-metrics')?.repeat,
    ).toEqual({ pattern: '5 * * * *' })
  })

  it('keeps exhaustive Review Analysis enrollment recovery unconditional and bounded', () => {
    const contract = JOB_OPERATIONAL_CONTRACTS.find(
      (row) => row.jobName === 'ai-review-analysis-enrollment-sweep',
    )
    const schedule = createOperationalSchedulerPlan().desired.find(
      (row) => row.jobName === 'ai-review-analysis-enrollment-sweep',
    )

    expect(contract).toMatchObject({
      action: 'system:ai.review_analysis_enrollment_sweep',
      capability: 'none',
      posture: 'active',
      schedule: 'every:300000',
      queue: 'background',
    })
    expect(schedule).toMatchObject({
      schedulerId: 'ai-review-analysis-enrollment-sweep-recurring',
      repeat: { every: 300_000 },
    })
  })

  it('gives active work an executable redrive command rather than a report-only listing', () => {
    for (const contract of JOB_OPERATIONAL_CONTRACTS.filter(
      ({ posture }) => posture === 'active',
    )) {
      expect(contract.repairCommand).toContain('ops:quarantine redrive')
      expect(contract.repairCommand).toContain('--apply')
      expect(contract.repairCommand).not.toContain('quarantine list')
    }
  })
})
