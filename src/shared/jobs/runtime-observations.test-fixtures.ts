import type { JobOperationalContract } from './runtime-authority'

export const NOW = new Date('2026-08-27T06:00:00.000Z')

export const HEALTH_CHECK_SCHEDULERS = [
  { key: 'health-check-recurring', name: 'health-check' },
]

export function contract(
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

/** A retained BullMQ job that finished at `finishedAt`, two seconds after it was added. */
export function retainedJob(
  name: string,
  finishedAt: string | number,
  extra: Record<string, unknown> = {},
) {
  const finishedOn = typeof finishedAt === 'number' ? finishedAt : Date.parse(finishedAt)
  return {
    name,
    timestamp: finishedOn - 2_000,
    processedOn: finishedOn - 1_000,
    finishedOn,
    ...extra,
  }
}

/** The boot options the runtime observation suites share: one `health-check` family. */
export const BOOT_DEFAULTS = { contracts: [contract()], now: NOW }
