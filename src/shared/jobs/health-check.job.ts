// Health-check background job — verifies DB and Redis connectivity.
// Per architecture: "Sample health-check background job that runs every 5 minutes."
// Idempotent: running twice produces the same output.
//
// BQC-3.7: the job now also evaluates outbox/quarantine alert thresholds and
// emits structured warn logs (alert substrate). No alert-dispatch infra
// exists yet — BQC-7 owns real alerting; these logs are the signal source.

import type { Job } from 'bullmq'
import pino from 'pino'
import type { QueueDepth } from '#/shared/health/queue-depth'

export const JOB_NAME = 'health-check' as const

// ── BQC-3.7 alert thresholds (named, deliberate) ────────────────────

/**
 * The relay polls every 5s; an unpublished event older than 15min means the
 * relay is down, Redis is unreachable, or a backlog is growing.
 */
export const OLDEST_UNPUBLISHED_WARN_MS = 15 * 60 * 1000

/**
 * A quarantined (dead-lettered) job should get an operator redrive decision
 * within a day; older than 24h means the dead letter is being ignored.
 */
export const OLDEST_QUARANTINED_WARN_MS = 24 * 60 * 60 * 1000

// stalledLeaseCount > 0 and quarantineCount > 0 warn at ANY nonzero value:
// a stalled lease means a claim stopped mid-flight beyond 2× its lease, and
// quarantined work always needs an operator decision.

// fallow-ignore-next-line unused-type
export type OpsMetricsSample = Readonly<{
  oldestUnpublishedAgeMs: number | null
  stalledLeaseCount: number
  quarantineCount: number
  oldestQuarantinedAgeMs: number | null
}>

// fallow-ignore-next-line unused-type
export type HealthCheckResult = Readonly<{
  db: boolean
  redis: boolean
  timestamp: string
  /** BQC-3.7: present when the ops sampler is wired (worker). */
  opsMetrics?: OpsMetricsSample
}>

export type HealthCheckDeps = Readonly<{
  dbHealthy: () => Promise<boolean>
  redisHealthy: () => Promise<boolean>
  logger: pino.Logger
  clock: () => Date
  /** BQR-6.2: optional Redis heartbeat so metrics can detect worker stalls. */
  recordHeartbeat?: () => Promise<void>
  /** BQC-3.7: outbox/quarantine metric sample for threshold evaluation. */
  sampleOpsMetrics?: () => Promise<OpsMetricsSample>
  /** BQC-3.7: queue-depth read incl. domain-events + quarantine. */
  readQueueDepths?: () => Promise<ReadonlyArray<QueueDepth>>
}>

/** Structured warn per breached threshold — BQC-7 turns these into alerts. */
function warnOnOpsThresholds(logger: pino.Logger, m: OpsMetricsSample): void {
  if (
    m.oldestUnpublishedAgeMs != null &&
    m.oldestUnpublishedAgeMs > OLDEST_UNPUBLISHED_WARN_MS
  ) {
    logger.warn(
      {
        metric: 'oldestUnpublishedAgeMs',
        value: m.oldestUnpublishedAgeMs,
        thresholdMs: OLDEST_UNPUBLISHED_WARN_MS,
      },
      '[health-check] outbox backlog: oldest unpublished event exceeds threshold',
    )
  }
  if (m.stalledLeaseCount > 0) {
    logger.warn(
      { metric: 'stalledLeaseCount', value: m.stalledLeaseCount },
      '[health-check] stalled outbox leases detected (claim held beyond 2x lease)',
    )
  }
  if (m.quarantineCount > 0) {
    logger.warn(
      { metric: 'quarantineCount', value: m.quarantineCount },
      '[health-check] quarantined jobs await operator redrive',
    )
  }
  if (
    m.oldestQuarantinedAgeMs != null &&
    m.oldestQuarantinedAgeMs > OLDEST_QUARANTINED_WARN_MS
  ) {
    logger.warn(
      {
        metric: 'oldestQuarantinedAgeMs',
        value: m.oldestQuarantinedAgeMs,
        thresholdMs: OLDEST_QUARANTINED_WARN_MS,
      },
      '[health-check] oldest quarantined job exceeds 24h redrive SLA',
    )
  }
}

export function createHealthCheckHandler(deps: HealthCheckDeps) {
  return async (_job: Job): Promise<HealthCheckResult> => {
    const [db, redis] = await Promise.all([
      deps.dbHealthy().catch((err) => {
        deps.logger.error({ err }, '[health-check] db check failed')
        return false
      }),
      deps.redisHealthy().catch((err) => {
        deps.logger.error({ err }, '[health-check] redis check failed')
        return false
      }),
    ])

    if (deps.recordHeartbeat) {
      try {
        await deps.recordHeartbeat()
      } catch (err) {
        deps.logger.warn({ err }, '[health-check] heartbeat write failed')
      }
    }

    // BQC-3.7: ops metric sample + threshold evaluation (warn-only substrate).
    let opsMetrics: OpsMetricsSample | undefined
    if (deps.sampleOpsMetrics) {
      try {
        opsMetrics = await deps.sampleOpsMetrics()
        warnOnOpsThresholds(deps.logger, opsMetrics)
      } catch (err) {
        deps.logger.warn({ err }, '[health-check] ops metrics sampling failed')
      }
    }

    if (deps.readQueueDepths) {
      try {
        const depths = await deps.readQueueDepths()
        deps.logger.info({ queues: depths }, '[health-check] queue depths')
      } catch (err) {
        deps.logger.warn({ err }, '[health-check] queue depth read failed')
      }
    }

    const result: HealthCheckResult = {
      db,
      redis,
      timestamp: deps.clock().toISOString(),
      ...(opsMetrics ? { opsMetrics } : {}),
    }

    deps.logger.info(result, '[health-check] status')
    return result
  }
}
