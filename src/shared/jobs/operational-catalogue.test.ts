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
        retention: 'completed:100,failed:50',
        routing: 'cell_local',
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

  it.each([
    'leaderboard.reconcile',
    'ai-authorization-derivative-erasure',
    'ai-review-analysis-backfill-advance',
    'portal-upload-source-cleanup',
  ])('retains a removal tombstone for the retired %s scheduler', (jobName) => {
    const plan = createOperationalSchedulerPlan()

    expect(
      JOB_OPERATIONAL_CONTRACTS.find((contract) => contract.jobName === jobName),
    ).toBeUndefined()
    expect(plan.managedJobNames).toContain(jobName)
    expect(plan.desired.map((schedule) => schedule.jobName)).not.toContain(jobName)
  })

  it('preserves exact interval offsets and cron patterns from governance', () => {
    const desired = createOperationalSchedulerPlan().desired
    expect(desired.find((row) => row.jobName === 'retention-sweep')?.repeat).toEqual({
      every: 86_400_000,
      offset: 10_800_000,
    })
    expect(desired.find((row) => row.jobName === 'digest-notification')?.repeat).toEqual({
      pattern: '0 * * * *',
    })
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
      schedule: 'every:60000',
      queue: 'background',
    })
    expect(schedule).toMatchObject({
      schedulerId: 'ai-review-analysis-enrollment-sweep-recurring',
      repeat: { every: 60_000 },
    })
  })

  describe('repair command', () => {
    const activeScheduled = JOB_OPERATIONAL_CONTRACTS.filter(
      ({ posture, schedule }) => posture === 'active' && schedule !== 'none',
    )
    const activeOnDemand = JOB_OPERATIONAL_CONTRACTS.filter(
      ({ posture, schedule }) => posture === 'active' && schedule === 'none',
    )
    const quarantined = JOB_OPERATIONAL_CONTRACTS.filter(
      ({ posture }) => posture === 'quarantined',
    )

    it('covers each kind of family', () => {
      expect(activeScheduled.length).toBeGreaterThan(0)
      expect(activeOnDemand.length).toBeGreaterThan(0)
      expect(quarantined.length).toBeGreaterThan(0)
    })

    it('gives on-demand and quarantined work an executable redrive command rather than a report-only listing', () => {
      for (const contract of [...activeOnDemand, ...quarantined]) {
        expect(contract.repairCommand).toContain('pnpm ops quarantine redrive')
        expect(contract.repairCommand).toContain('--apply')
        expect(contract.repairCommand).not.toContain('quarantine list')
      }
    })

    // A firing is never dead-lettered, so a redrive command would send the
    // operator to a quarantine that holds nothing for it.
    it('sends an active scheduled family to its next successful firing, not to a redrive', () => {
      for (const contract of activeScheduled) {
        expect(contract.repairCommand).not.toContain('quarantine redrive')
        expect(contract.repairCommand).toContain('next successful firing')
        expect(contract.repairCommand).toContain('docs/operations/runbooks.md §17')
        expect(contract.repairCommand).not.toBe('none')
      }
    })
  })
})
