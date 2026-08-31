// Health-check background job — verifies DB and Redis connectivity.
// Per architecture: "Sample health-check background job that runs every 5 minutes."
// Idempotent: running twice produces the same output.
//
// BQC-7.4: the job is the alert EVALUATION point. Each run it reads the full
// OperationsSnapshot (BQC-7.3) plus the aux alert reads, evaluates every
// implemented alert definition (shared/observability/alert-definitions.ts —
// pure), and dispatches newly-firing alerts through the container-owned
// AlertDispatcher (shared/observability/alert-dispatcher.ts). Hysteresis is
// edge-trigger + 24h re-notify via the Redis firing-state store
// (shared/health/alert-state.ts); recovery clears the state. This supersedes
// the BQC-3.7 warn-only threshold logs (warnOnOpsThresholds), whose four
// signals are now formal definitions (queue.oldest-age, queue.stalled,
// queue.quarantine-growth).

import type { Job } from 'bullmq'
import pino from 'pino'
import type { QueueDepth } from '#/shared/health/queue-depth'
import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'
import {
  evaluateAlerts,
  implementedAlertNames,
  type AlertAuxReads,
} from '#/shared/observability/alert-definitions'
import type { AlertDispatcher } from '#/shared/observability/alert-dispatcher'
import type { AlertStateStore } from '#/shared/health/alert-state'

export const JOB_NAME = 'health-check' as const

export type HealthCheckResult = Readonly<{
  db: boolean
  redis: boolean
  timestamp: string
  /** BQC-7.4: present when the alert evaluation wiring is in place (worker). */
  alerts?: Readonly<{
    /** All alerts currently firing (dispatched or already notified). */
    firing: readonly string[]
    /** Alerts dispatched on THIS run (ok→firing edges). */
    dispatched: readonly string[]
  }>
}>

export type HealthCheckDeps = Readonly<{
  dbHealthy: () => Promise<boolean>
  redisHealthy: () => Promise<boolean>
  logger: pino.Logger
  clock: () => Date
  /** BQR-6.2: optional Redis heartbeat so metrics can detect worker stalls. */
  recordHeartbeat?: () => Promise<void>
  /** BQC-3.7: queue-depth read incl. domain-events + quarantine. */
  readQueueDepths?: () => Promise<ReadonlyArray<QueueDepth>>
  /** BQC-7.4: the full operations snapshot read (container-owned reader). */
  readOperationsSnapshot?: () => Promise<OperationsSnapshot>
  /** BQC-7.4: aux alert reads (retention / policy / routing / feedback triage). */
  readAlertAux?: () => Promise<AlertAuxReads>
  /** BQC-7.4: firing-state store (edge-trigger + 24h re-notify hysteresis). */
  alertState?: AlertStateStore
  /** BQC-7.4: dispatch destination (container-owned port). */
  alertDispatcher?: AlertDispatcher
}>

/**
 * BQC-7.4 alert evaluation pass: evaluate every implemented definition
 * against the snapshot + aux reads, dispatch the newly-firing edges, then
 * reconcile the firing-state store (mark dispatched, clear recovered).
 * Dispatch and state writes never throw into the job — the health check's
 * own result is never hostage to the alerting path. Hysteresis-store loss
 * evaluates with an empty prior set and still dispatches: duplicate pages are
 * safer than making the Redis-unavailable condition itself invisible.
 */
async function evaluateAndDispatch(
  deps: Readonly<{
    logger: pino.Logger
    readOperationsSnapshot: () => Promise<OperationsSnapshot>
    readAlertAux: () => Promise<AlertAuxReads>
    alertState?: AlertStateStore
    alertDispatcher: AlertDispatcher
  }>,
): Promise<HealthCheckResult['alerts']> {
  const [snapshot, aux] = await Promise.all([
    deps.readOperationsSnapshot(),
    deps.readAlertAux(),
  ])

  // The 7.3 per-reason denial split, emitted on the evaluation cadence
  // (routing.denials / policy.denials — metrics-schema).
  deps.logger.info(
    {
      policyDenialsByReason: aux.policyDenialsByReason,
      routingBlockedByReason: aux.routingBlockedByReason,
      betaFeedbackTriage: aux.betaFeedbackTriage,
    },
    '[health-check] content-free auxiliary alert readings',
  )

  let previouslyFiring: ReadonlySet<string>
  try {
    previouslyFiring = deps.alertState
      ? await deps.alertState.currentlyFiring(implementedAlertNames())
      : new Set()
  } catch {
    previouslyFiring = new Set()
    deps.logger.warn(
      '[health-check] alert hysteresis state unavailable — evaluating fail-visible',
    )
  }
  const { toDispatch, firing } = evaluateAlerts(snapshot, aux, previouslyFiring)

  const dispatched: string[] = []
  for (const event of toDispatch) {
    try {
      await deps.alertDispatcher.dispatch(event)
    } catch (err) {
      // The production dispatcher never throws; foreign implementations get
      // one more containment layer here so the state store still marks the
      // edge (no 5-min re-page loop while a webhook is down).
      deps.logger.warn({ err, alert: event.name }, '[health-check] alert dispatch failed')
    }
    if (deps.alertState) {
      try {
        await deps.alertState.markFiring(event.name)
      } catch {
        deps.logger.warn(
          { alert: event.name },
          '[health-check] alert hysteresis state write unavailable',
        )
      }
    }
    dispatched.push(event.name)
  }

  const firingSet = new Set(firing)
  for (const name of previouslyFiring) {
    if (!firingSet.has(name) && deps.alertState) {
      try {
        await deps.alertState.clearFiring(name)
      } catch {
        deps.logger.warn(
          { alert: name },
          '[health-check] alert hysteresis state clear unavailable',
        )
      }
    }
  }

  return { firing, dispatched }
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

    // BQC-7.4: alert evaluation (supersedes the 3.7 warn-only thresholds).
    // Runs when the worker wired the snapshot, aux reader, and dispatcher.
    // Hysteresis state is optional so absent Cache Redis cannot disable the
    // alert that reports its own monitoring degradation.
    let alerts: HealthCheckResult['alerts']
    const { readOperationsSnapshot, readAlertAux, alertState, alertDispatcher } = deps
    if (readOperationsSnapshot && readAlertAux && alertDispatcher) {
      try {
        alerts = await evaluateAndDispatch({
          logger: deps.logger,
          readOperationsSnapshot,
          readAlertAux,
          alertState,
          alertDispatcher,
        })
      } catch (err) {
        deps.logger.warn({ err }, '[health-check] alert evaluation failed')
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
      ...(alerts ? { alerts } : {}),
    }

    deps.logger.info(result, '[health-check] status')
    return result
  }
}
